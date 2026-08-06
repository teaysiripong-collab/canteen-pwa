"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

async function requireEdit() {
  const s = await requireSession();
  if (!can(s.role, "bom", "edit")) throw new Error("FORBIDDEN");
  return s;
}

export async function updateBomLine(lineId: string, formData: FormData) {
  const s = await requireEdit();
  const qty = parseFloat(String(formData.get("qty")));
  if (!Number.isFinite(qty) || qty < 0) throw new Error("จำนวนไม่ถูกต้อง");
  const line = await db.bomLine.findUniqueOrThrow({ where: { id: lineId }, include: { ingredient: true } });
  await db.bomLine.update({ where: { id: lineId }, data: { qty } });
  await audit({
    userId: s.userId, entity: "BomLine", entityId: lineId, action: "UPDATE",
    field: "qty", oldValue: Number(line.qty), newValue: qty,
    detail: `แก้ BOM ${line.ingredient.name} ${Number(line.qty)} → ${qty}`,
  });
  revalidatePath("/bom");
}

export async function deleteBomLine(lineId: string) {
  const s = await requireEdit();
  const line = await db.bomLine.findUniqueOrThrow({ where: { id: lineId }, include: { ingredient: true } });
  await db.bomLine.delete({ where: { id: lineId } });
  await audit({ userId: s.userId, entity: "BomLine", entityId: lineId, action: "DELETE", detail: `ลบ ${line.ingredient.name} ออกจาก BOM` });
  revalidatePath("/bom");
}

export async function addBomLine(planEntryId: string, formData: FormData) {
  const s = await requireEdit();
  const ingredientId = String(formData.get("ingredientId") ?? "");
  const qty = parseFloat(String(formData.get("qty")));
  if (!ingredientId || !Number.isFinite(qty) || qty <= 0) throw new Error("ข้อมูลไม่ครบ");
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  const line = await db.bomLine.create({
    data: { planEntryId, ingredientId, qty, unitId: ing.stockUnitId },
  });
  await audit({ userId: s.userId, entity: "BomLine", entityId: line.id, action: "CREATE", detail: `เพิ่ม ${ing.name} ${qty} ใน BOM` });
  revalidatePath("/bom");
}

// BOM Learning: Supervisor confirms suggested qty -> update the MASTER template (never automatic).
export async function applySuggestedBom(menuId: string, ingredientId: string, suggestedQty: number) {
  const s = await requireEdit();
  const tmpl = await db.bomTemplate.findFirst({
    where: { menuId, isCurrent: true },
    include: { items: true },
  });
  if (!tmpl) throw new Error("ไม่พบ BOM Template");
  const item = tmpl.items.find((i) => i.ingredientId === ingredientId);
  if (!item) throw new Error("ไม่พบวัตถุดิบใน Template");
  await db.bomTemplateItem.update({ where: { id: item.id }, data: { qty: suggestedQty } });
  const ing = await db.ingredient.findUnique({ where: { id: ingredientId } });
  await audit({
    userId: s.userId, entity: "BomTemplateItem", entityId: item.id, action: "UPDATE",
    field: "qty", oldValue: Number(item.qty), newValue: suggestedQty,
    detail: `ยืนยัน Suggested BOM: ${ing?.name} ${Number(item.qty)} → ${suggestedQty} (จาก Actual Usage)`,
  });
  revalidatePath("/bom");
}
