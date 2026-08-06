"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import type { Shift } from "@prisma/client";

async function requireEdit() {
  const s = await requireSession();
  if (!can(s.role, "menu-plan", "edit")) throw new Error("FORBIDDEN");
  return s;
}

export async function createPlan(weekStart: string) {
  const s = await requireEdit();
  const plan = await db.menuPlan.create({
    data: { weekStart: new Date(weekStart), createdById: s.userId },
  });
  await audit({ userId: s.userId, entity: "MenuPlan", entityId: plan.id, action: "CREATE", detail: `สร้างแผนเมนูสัปดาห์ ${weekStart}` });
  revalidatePath("/menu-plan");
}

export async function addEntry(planId: string, date: string, shift: Shift, menuId: string) {
  const s = await requireEdit();
  const plan = await db.menuPlan.findUniqueOrThrow({ where: { id: planId } });
  if (plan.status === "APPROVED") throw new Error("แผนที่อนุมัติแล้วต้องปลดล็อกก่อนแก้ไข");
  const count = await db.menuPlanEntry.count({ where: { planId, date: new Date(date), shift } });
  const entry = await db.menuPlanEntry.create({
    data: { planId, date: new Date(date), shift, menuId, sortOrder: count },
  });
  // Enter once, use everywhere: pull standard BOM template automatically (editable later).
  const tmpl = await db.bomTemplate.findFirst({
    where: { menuId, isCurrent: true },
    include: { items: true },
  });
  if (tmpl) {
    const { nightFactor } = await getConfig();
    const factor = shift === "NIGHT" ? nightFactor : 1;
    await db.bomLine.createMany({
      data: tmpl.items.map((it) => ({
        planEntryId: entry.id,
        ingredientId: it.ingredientId,
        qty: Math.round(Number(it.qty) * factor * 100) / 100,
        unitId: it.unitId,
      })),
    });
  }
  const menu = await db.menu.findUnique({ where: { id: menuId } });
  await audit({ userId: s.userId, entity: "MenuPlanEntry", entityId: entry.id, action: "CREATE", detail: `เพิ่มเมนู ${menu?.name} วันที่ ${date} (${shift})` });
  revalidatePath("/menu-plan");
}

export async function removeEntry(entryId: string) {
  const s = await requireEdit();
  const entry = await db.menuPlanEntry.findUniqueOrThrow({ where: { id: entryId }, include: { menu: true, plan: true } });
  if (entry.plan.status === "APPROVED") throw new Error("แผนที่อนุมัติแล้วต้องปลดล็อกก่อนแก้ไข");
  await db.menuPlanEntry.delete({ where: { id: entryId } });
  await audit({ userId: s.userId, entity: "MenuPlanEntry", entityId: entryId, action: "DELETE", detail: `ลบเมนู ${entry.menu.name}` });
  revalidatePath("/menu-plan");
}

export async function copyLastWeek(planId: string, weekStart: string) {
  const s = await requireEdit();
  const prevStart = new Date(weekStart);
  prevStart.setUTCDate(prevStart.getUTCDate() - 7);
  const prev = await db.menuPlan.findFirst({
    where: { weekStart: prevStart },
    orderBy: { version: "desc" },
    include: { entries: { include: { bomLines: true } } },
  });
  if (!prev) throw new Error("ไม่พบแผนสัปดาห์ก่อน");
  for (const e of prev.entries) {
    const newDate = new Date(e.date);
    newDate.setUTCDate(newDate.getUTCDate() + 7);
    const entry = await db.menuPlanEntry.create({
      data: { planId, date: newDate, shift: e.shift, menuId: e.menuId, note: e.note, sortOrder: e.sortOrder },
    });
    await db.bomLine.createMany({
      data: e.bomLines.map((l) => ({ planEntryId: entry.id, ingredientId: l.ingredientId, qty: l.qty, unitId: l.unitId })),
    });
  }
  await audit({ userId: s.userId, entity: "MenuPlan", entityId: planId, action: "UPDATE", detail: "คัดลอกเมนูจากสัปดาห์ก่อน" });
  revalidatePath("/menu-plan");
}

export async function submitPlan(planId: string) {
  const s = await requireEdit();
  await db.menuPlan.update({ where: { id: planId }, data: { status: "SUBMITTED", submittedAt: new Date() } });
  // แจ้ง Manager ทุกคนให้ตรวจ
  const managers = await db.user.findMany({ where: { role: { in: ["MANAGER", "ADMIN"] }, active: true } });
  await db.notification.createMany({
    data: managers.map((m) => ({
      userId: m.id, type: "MENU_APPROVAL", title: "แผนเมนูรอตรวจสอบ",
      message: `${s.name} ส่งแผนเมนูให้ตรวจสอบ`, link: "/menu-plan",
    })),
  });
  await audit({ userId: s.userId, entity: "MenuPlan", entityId: planId, action: "STATUS", oldValue: "DRAFT", newValue: "SUBMITTED" });
  revalidatePath("/menu-plan");
}

export async function approvePlan(planId: string) {
  const s = await requireSession();
  if (!can(s.role, "menu-plan", "approve")) throw new Error("FORBIDDEN");
  await db.menuPlan.update({
    where: { id: planId },
    data: { status: "APPROVED", approvedById: s.userId, approvedAt: new Date() },
  });
  await audit({ userId: s.userId, entity: "MenuPlan", entityId: planId, action: "STATUS", oldValue: "SUBMITTED", newValue: "APPROVED" });
  revalidatePath("/menu-plan");
}

export async function reopenPlan(planId: string) {
  const s = await requireSession();
  if (!can(s.role, "menu-plan", "approve")) throw new Error("FORBIDDEN");
  const plan = await db.menuPlan.findUniqueOrThrow({ where: { id: planId } });
  await db.menuPlan.update({
    where: { id: planId },
    data: { status: "DRAFT", version: plan.version + 1, approvedById: null, approvedAt: null },
  });
  await audit({ userId: s.userId, entity: "MenuPlan", entityId: planId, action: "STATUS", oldValue: plan.status, newValue: "DRAFT", detail: `ปลดล็อกแก้ไข (version ${plan.version + 1})` });
  revalidatePath("/menu-plan");
}
