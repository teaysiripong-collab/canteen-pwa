"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { Shift } from "@prisma/client";

async function requireStock() {
  const s = await requireSession();
  if (!can(s.role, "stock", "edit")) throw new Error("FORBIDDEN");
  return s;
}

export type IssueValues = {
  qty?: string; shift?: string; lotId?: string;
  locationId?: string; menuId?: string; note?: string; force?: string;
};
/** `values` echoes the rejected submission back so the form can restore it. */
export type ActionState = { error: string; values: IssueValues; stamp: string } | null;

function reject(error: string, formData: FormData): ActionState {
  const f = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return {
    error,
    stamp: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    values: {
      qty: f("qty"), shift: f("shift"), lotId: f("lotId"),
      locationId: f("locationId"), menuId: f("menuId"), note: f("note"), force: f("force"),
    },
  };
}

/**
 * เบิกของ: Stock ลดอัตโนมัติ + ถ้าระบุเมนู จะบันทึก Actual Usage ให้ด้วย (Enter once, use everywhere)
 * คืนค่า { error } แทนการ throw เพื่อให้ข้อความ validation แสดงถึงผู้ใช้ได้จริงบน production
 * (Next.js ซ่อนข้อความจาก error ที่ throw ใน Server Action)
 */
export async function issueStock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const s = await requireStock();
  const ingredientId = String(formData.get("ingredientId") ?? "");
  const qty = parseFloat(String(formData.get("qty")));
  const lotId = String(formData.get("lotId") ?? "") || null;
  const locationId = String(formData.get("locationId") ?? "");
  const shift = (String(formData.get("shift") ?? "") || null) as Shift | null;
  const menuId = String(formData.get("menuId") ?? "") || null;
  const note = String(formData.get("note") ?? "");
  const force = formData.get("force") === "on";
  if (!ingredientId || !locationId) return reject("กรุณาเลือกวัตถุดิบและ Location", formData);
  if (!Number.isFinite(qty) || qty <= 0) return reject("จำนวนต้องมากกว่า 0", formData);

  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });

  // เบิกเกินยอดคงเหลือของ Location นั้นมักเกิดจากเลือก Location ผิด — เตือนพร้อมบอกว่าของอยู่ที่ไหน
  // ไม่ Block ถาวร: ติ๊ก "ยืนยันเบิกเกินยอด" เพื่อบันทึกได้ และระบบจะบันทึกไว้ใน Audit Log
  if (!force) {
    const atLocation = await db.stockTransaction.aggregate({
      where: { ingredientId, locationId },
      _sum: { qty: true },
    });
    const available = Number(atLocation._sum.qty ?? 0);
    if (qty > available + 0.0001) {
      const others = await db.stockTransaction.groupBy({
        by: ["locationId"],
        where: { ingredientId },
        _sum: { qty: true },
      });
      const locs = await db.location.findMany({ where: { id: { in: others.map((o) => o.locationId) } } });
      const locName = new Map(locs.map((l) => [l.id, l.name]));
      const where = others
        .filter((o) => Number(o._sum.qty ?? 0) > 0.0001 && o.locationId !== locationId)
        .map((o) => `${locName.get(o.locationId)} (${Number(o._sum.qty ?? 0)})`)
        .join(", ");
      return reject(
        `${ing.name} ที่ Location นี้เหลือ ${available} — เบิก ${qty} ไม่ได้` +
          (where ? `\nของอยู่ที่: ${where}` : "") +
          `\nหากของจริงมีอยู่แต่ระบบยังไม่ตรง ให้ติ๊ก "ยืนยันเบิกเกินยอดคงเหลือ" แล้วบันทึกอีกครั้ง`,
        formData
      );
    }
  }
  await db.stockTransaction.create({
    data: {
      type: "ISSUE", ingredientId, lotId, locationId, qty: -qty, unitId: ing.stockUnitId,
      shift, refType: menuId ? "MENU" : null, refId: menuId,
      note: force && note ? `${note} (เบิกเกินยอด)` : force ? "เบิกเกินยอดคงเหลือ" : note,
      userId: s.userId,
    },
  });
  if (menuId && shift) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    await db.usageRecord.create({
      data: { date: today, shift, menuId, ingredientId, qty, unitId: ing.stockUnitId, recordedById: s.userId },
    });
  }
  await audit({
    userId: s.userId, entity: "StockTransaction", entityId: ingredientId,
    action: force ? "OVERRIDE" : "CREATE",
    detail: `เบิก ${ing.name} ${qty}${force ? " (ยืนยันเบิกเกินยอดคงเหลือ)" : ""}`,
  });
  revalidatePath("/stock");
  redirect("/stock?done=issue");
}

export async function receiveStock(formData: FormData) {
  const s = await requireStock();
  const ingredientId = String(formData.get("ingredientId") ?? "");
  const qty = parseFloat(String(formData.get("qty")));
  const locationId = String(formData.get("locationId") ?? "");
  const lotCode = String(formData.get("lotCode") ?? "").trim();
  const expiry = String(formData.get("expiry") ?? "").trim();
  const note = String(formData.get("note") ?? "");
  if (!ingredientId || !locationId || !Number.isFinite(qty) || qty <= 0) throw new Error("ข้อมูลไม่ครบ");

  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  const lot = await db.lot.create({
    data: {
      ingredientId, lotCode: lotCode || `LOT-${Date.now().toString(36).toUpperCase()}`,
      expiryDate: expiry ? new Date(expiry + "T00:00:00Z") : null,
    },
  });
  await db.stockTransaction.create({
    data: { type: "RECEIVE", ingredientId, lotId: lot.id, locationId, qty, unitId: ing.stockUnitId, note, userId: s.userId },
  });
  await audit({ userId: s.userId, entity: "StockTransaction", entityId: ingredientId, action: "CREATE", detail: `รับ ${ing.name} ${qty}` });
  revalidatePath("/stock");
  redirect("/stock?done=receive");
}

export async function transferStock(formData: FormData) {
  const s = await requireStock();
  const ingredientId = String(formData.get("ingredientId") ?? "");
  const qty = parseFloat(String(formData.get("qty")));
  const fromId = String(formData.get("fromId") ?? "");
  const toId = String(formData.get("toId") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!ingredientId || !fromId || !toId || fromId === toId || !Number.isFinite(qty) || qty <= 0) throw new Error("ข้อมูลไม่ครบ");

  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  await db.$transaction([
    db.stockTransaction.create({
      data: { type: "TRANSFER_OUT", ingredientId, locationId: fromId, qty: -qty, unitId: ing.stockUnitId, note, userId: s.userId },
    }),
    db.stockTransaction.create({
      data: { type: "TRANSFER_IN", ingredientId, locationId: toId, qty, unitId: ing.stockUnitId, note, userId: s.userId },
    }),
  ]);
  await audit({ userId: s.userId, entity: "StockTransaction", entityId: ingredientId, action: "CREATE", detail: `โอน ${ing.name} ${qty}` });
  revalidatePath("/stock");
  redirect("/stock?done=transfer");
}

export async function adjustStock(formData: FormData) {
  const s = await requireStock();
  const ingredientId = String(formData.get("ingredientId") ?? "");
  const qty = parseFloat(String(formData.get("qty"))); // + หรือ -
  const locationId = String(formData.get("locationId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!ingredientId || !locationId || !Number.isFinite(qty) || qty === 0) throw new Error("ข้อมูลไม่ครบ");
  if (!note) throw new Error("การปรับ Stock ต้องระบุเหตุผลเสมอ");

  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  await db.stockTransaction.create({
    data: { type: "ADJUST", ingredientId, locationId, qty, unitId: ing.stockUnitId, note, userId: s.userId },
  });
  await audit({ userId: s.userId, entity: "StockTransaction", entityId: ingredientId, action: "CREATE", detail: `ปรับ ${ing.name} ${qty > 0 ? "+" : ""}${qty} (${note})` });
  revalidatePath("/stock");
  redirect("/stock?done=adjust");
}
