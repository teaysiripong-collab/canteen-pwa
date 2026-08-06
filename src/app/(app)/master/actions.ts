"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";

async function requireAdmin() {
  const s = await requireSession();
  if (!can(s.role, "master", "admin")) throw new Error("FORBIDDEN");
  return s;
}

export async function saveIngredient(id: string | null, formData: FormData) {
  const s = await requireAdmin();
  const data = {
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    categoryId: String(formData.get("categoryId") ?? "") || null,
    stockUnitId: String(formData.get("stockUnitId") ?? ""),
    purchaseUnitId: String(formData.get("purchaseUnitId") ?? "") || null,
    conversionFactor: parseFloat(String(formData.get("conversionFactor") ?? "1")) || 1,
    defaultVendorId: String(formData.get("defaultVendorId") ?? "") || null,
    storageId: String(formData.get("storageId") ?? "") || null,
    minStock: parseFloat(String(formData.get("minStock") ?? "0")) || 0,
    active: formData.get("active") === "on",
  };
  if (!data.code || !data.name || !data.stockUnitId) throw new Error("ข้อมูลไม่ครบ");

  if (id) {
    const old = await db.ingredient.findUniqueOrThrow({ where: { id } });
    await db.ingredient.update({ where: { id }, data });
    await audit({ userId: s.userId, entity: "Ingredient", entityId: id, action: "UPDATE", oldValue: old.name, newValue: data.name, detail: `แก้ไขวัตถุดิบ ${data.name}` });
  } else {
    const created = await db.ingredient.create({ data });
    await audit({ userId: s.userId, entity: "Ingredient", entityId: created.id, action: "CREATE", detail: `เพิ่มวัตถุดิบ ${data.name}` });
  }
  revalidatePath("/master");
}

/** Soft delete only — transaction history must stay intact. */
export async function deactivateIngredient(id: string) {
  const s = await requireAdmin();
  const ing = await db.ingredient.findUniqueOrThrow({ where: { id } });
  await db.ingredient.update({ where: { id }, data: { active: false } });
  await audit({ userId: s.userId, entity: "Ingredient", entityId: id, action: "UPDATE", field: "active", oldValue: "true", newValue: "false", detail: `ปิดใช้งาน ${ing.name}` });
  revalidatePath("/master");
}

export async function saveVendor(id: string | null, formData: FormData) {
  const s = await requireAdmin();
  const minOrderRaw = String(formData.get("minOrder") ?? "").trim();
  const data = {
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    contactName: String(formData.get("contactName") ?? "") || null,
    phone: String(formData.get("phone") ?? "") || null,
    email: String(formData.get("email") ?? "") || null,
    minOrder: minOrderRaw ? parseFloat(minOrderRaw) : null,
    leadTimeDays: parseInt(String(formData.get("leadTimeDays") ?? "1"), 10) || 1,
    deliveryDays: String(formData.get("deliveryDays") ?? "") || null,
    active: formData.get("active") === "on",
  };
  if (!data.code || !data.name) throw new Error("ข้อมูลไม่ครบ");

  if (id) {
    await db.vendor.update({ where: { id }, data });
    await audit({ userId: s.userId, entity: "Vendor", entityId: id, action: "UPDATE", detail: `แก้ไข Vendor ${data.name}` });
  } else {
    const created = await db.vendor.create({ data });
    await audit({ userId: s.userId, entity: "Vendor", entityId: created.id, action: "CREATE", detail: `เพิ่ม Vendor ${data.name}` });
  }
  revalidatePath("/master");
}

export async function saveMenu(id: string | null, formData: FormData) {
  const s = await requireAdmin();
  const data = {
    code: String(formData.get("code") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    categoryId: String(formData.get("categoryId") ?? "") || null,
    favorite: formData.get("favorite") === "on",
    active: formData.get("active") === "on",
  };
  if (!data.code || !data.name) throw new Error("ข้อมูลไม่ครบ");
  if (id) {
    await db.menu.update({ where: { id }, data });
    await audit({ userId: s.userId, entity: "Menu", entityId: id, action: "UPDATE", detail: `แก้ไขเมนู ${data.name}` });
  } else {
    const created = await db.menu.create({ data });
    await audit({ userId: s.userId, entity: "Menu", entityId: created.id, action: "CREATE", detail: `เพิ่มเมนู ${data.name}` });
  }
  revalidatePath("/master");
}

export async function saveLocation(formData: FormData) {
  const s = await requireAdmin();
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "") || null;
  if (!code || !name) throw new Error("ข้อมูลไม่ครบ");
  const created = await db.location.create({ data: { code, name, parentId } });
  await audit({ userId: s.userId, entity: "Location", entityId: created.id, action: "CREATE", detail: `เพิ่ม Location ${name}` });
  revalidatePath("/master");
}

export async function saveUnit(formData: FormData) {
  const s = await requireAdmin();
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!code || !name) throw new Error("ข้อมูลไม่ครบ");
  const created = await db.unit.create({ data: { code, name } });
  await audit({ userId: s.userId, entity: "Unit", entityId: created.id, action: "CREATE", detail: `เพิ่มหน่วย ${code}` });
  revalidatePath("/master");
}

export async function saveCategory(formData: FormData) {
  const s = await requireAdmin();
  const type = String(formData.get("type") ?? "INGREDIENT");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("ข้อมูลไม่ครบ");
  const created = await db.category.create({ data: { type, name } });
  await audit({ userId: s.userId, entity: "Category", entityId: created.id, action: "CREATE", detail: `เพิ่มหมวด ${name}` });
  revalidatePath("/master");
}
