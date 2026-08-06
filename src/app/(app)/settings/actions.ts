"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { CONFIG_KEYS, getConfig, nextEmployeeCode, saveConfig } from "@/lib/config";
import type { Role } from "@prisma/client";

async function requireAdmin() {
  const s = await requireSession();
  if (!can(s.role, "settings", "admin")) throw new Error("FORBIDDEN");
  return s;
}

export type SettingsState = { ok?: boolean; error?: string; message?: string } | null;

// ───────────────────────── พนักงาน ─────────────────────────

function readEmployee(formData: FormData) {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  return {
    employeeCode: str("employeeCode") || null,
    name: str("name"),
    nickname: str("nickname") || null,
    department: str("department") || null,
    phone: str("phone") || null,
    startDate: str("startDate") ? new Date(str("startDate") + "T00:00:00Z") : null,
    role: (str("role") || "STAFF") as Role,
    active: formData.get("active") === "on",
  };
}

export async function createEmployee(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const s = await requireAdmin();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const data = readEmployee(formData);

  if (!username || !data.name) return { error: "กรุณากรอกชื่อผู้ใช้และชื่อ-นามสกุล" };
  if (password.length < 4) return { error: "รหัสผ่านต้องยาวอย่างน้อย 4 ตัวอักษร" };
  if (await db.user.findUnique({ where: { username } })) {
    return { error: `มีชื่อผู้ใช้ "${username}" อยู่แล้ว` };
  }
  if (data.employeeCode && (await db.user.findUnique({ where: { employeeCode: data.employeeCode } }))) {
    return { error: `รหัสพนักงาน "${data.employeeCode}" ถูกใช้ไปแล้ว` };
  }

  // Assign the next running code when the admin leaves it blank.
  if (!data.employeeCode) {
    const cfg = await getConfig();
    data.employeeCode = await nextEmployeeCode(cfg.employeePrefix);
  }

  const user = await db.user.create({
    data: { ...data, username, passwordHash: await bcrypt.hash(password, 10) },
  });
  await audit({
    userId: s.userId, entity: "User", entityId: user.id, action: "CREATE",
    detail: `เพิ่มพนักงาน ${data.employeeCode} ${data.name} (${data.role})`,
  });
  revalidatePath("/settings");
  return { ok: true, message: `เพิ่มพนักงาน ${data.employeeCode} — ${data.name} แล้ว` };
}

export async function updateEmployee(userId: string, _prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const s = await requireAdmin();
  const old = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const data = readEmployee(formData);
  const password = String(formData.get("password") ?? "");

  if (!data.name) return { error: "กรุณากรอกชื่อ-นามสกุล" };
  if (data.employeeCode && data.employeeCode !== old.employeeCode) {
    const clash = await db.user.findUnique({ where: { employeeCode: data.employeeCode } });
    if (clash) return { error: `รหัสพนักงาน "${data.employeeCode}" ถูกใช้ไปแล้ว` };
  }
  // Never let an admin lock everyone out by demoting or disabling the last admin.
  if (old.role === "ADMIN" && (data.role !== "ADMIN" || !data.active)) {
    const admins = await db.user.count({ where: { role: "ADMIN", active: true } });
    if (admins <= 1) return { error: "ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน" };
  }

  const payload: Record<string, unknown> = { ...data };
  if (password) {
    if (password.length < 4) return { error: "รหัสผ่านต้องยาวอย่างน้อย 4 ตัวอักษร" };
    payload.passwordHash = await bcrypt.hash(password, 10);
  }
  await db.user.update({ where: { id: userId }, data: payload });

  if (old.employeeCode !== data.employeeCode) {
    await audit({ userId: s.userId, entity: "User", entityId: userId, action: "UPDATE", field: "employeeCode", oldValue: old.employeeCode, newValue: data.employeeCode, detail: data.name });
  }
  if (old.role !== data.role) {
    await audit({ userId: s.userId, entity: "User", entityId: userId, action: "UPDATE", field: "role", oldValue: old.role, newValue: data.role, detail: data.name });
  }
  if (old.active !== data.active) {
    await audit({ userId: s.userId, entity: "User", entityId: userId, action: "UPDATE", field: "active", oldValue: String(old.active), newValue: String(data.active), detail: data.name });
  }
  if (password) {
    await audit({ userId: s.userId, entity: "User", entityId: userId, action: "UPDATE", field: "password", detail: `รีเซ็ตรหัสผ่าน ${old.username}` });
  }
  revalidatePath("/settings");
  return { ok: true, message: `บันทึกข้อมูล ${data.name} แล้ว` };
}

// ───────────────────────── ค่าตั้งระบบ ─────────────────────────

export async function saveOrgInfo(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const s = await requireAdmin();
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  if (!str("orgName")) return { error: "กรุณากรอกชื่อแคนทีน/หน่วยงาน" };

  await saveConfig({
    [CONFIG_KEYS.ORG_NAME]: str("orgName"),
    [CONFIG_KEYS.ORG_BRANCH]: str("orgBranch"),
    [CONFIG_KEYS.ORG_ADDRESS]: str("orgAddress"),
    [CONFIG_KEYS.ORG_PHONE]: str("orgPhone"),
    [CONFIG_KEYS.ORG_TAX_ID]: str("orgTaxId"),
  });
  await audit({ userId: s.userId, entity: "SystemSetting", entityId: "org", action: "UPDATE", detail: "แก้ไขข้อมูลแคนทีน" });
  revalidatePath("/settings");
  revalidatePath("/menu-plan/print");
  return { ok: true, message: "บันทึกข้อมูลแคนทีนแล้ว — จะแสดงบนเอกสารที่พิมพ์" };
}

export async function saveShiftConfig(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const s = await requireAdmin();
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const factor = parseFloat(str("nightFactor"));

  if (!str("morningLabel") || !str("nightLabel")) return { error: "กรุณากรอกชื่อรอบให้ครบ" };
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1) {
    return { error: "สัดส่วน BOM รอบดึกต้องอยู่ระหว่าง 0.01 ถึง 1 (เช่น 0.6 = 60% ของรอบเช้า)" };
  }

  await saveConfig({
    [CONFIG_KEYS.SHIFT_MORNING_LABEL]: str("morningLabel"),
    [CONFIG_KEYS.SHIFT_MORNING_TIME]: str("morningTime"),
    [CONFIG_KEYS.SHIFT_NIGHT_LABEL]: str("nightLabel"),
    [CONFIG_KEYS.SHIFT_NIGHT_TIME]: str("nightTime"),
    [CONFIG_KEYS.SHIFT_NIGHT_FACTOR]: String(factor),
  });
  await audit({ userId: s.userId, entity: "SystemSetting", entityId: "shift", action: "UPDATE", detail: "แก้ไขรอบการทำงาน" });
  revalidatePath("/settings");
  revalidatePath("/menu-plan");
  return { ok: true, message: "บันทึกรอบการทำงานแล้ว" };
}

export async function saveCalendarConfig(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const s = await requireAdmin();
  const days = formData.getAll("workingDays").map((d) => parseInt(String(d), 10)).filter(Number.isInteger);
  if (days.length === 0) return { error: "ต้องเลือกวันทำการอย่างน้อย 1 วัน" };

  await saveConfig({ [CONFIG_KEYS.WORKING_DAYS]: days.sort((a, b) => a - b).join(",") });
  await audit({ userId: s.userId, entity: "SystemSetting", entityId: "calendar", action: "UPDATE", detail: `วันทำการ: ${days.join(",")}` });
  revalidatePath("/settings");
  revalidatePath("/menu-plan");
  return { ok: true, message: `บันทึกแล้ว — ปฏิทินเมนูจะแสดง ${days.length} วัน` };
}

export async function saveDocConfig(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const s = await requireAdmin();
  const po = String(formData.get("poPrefix") ?? "").trim().toUpperCase();
  const emp = String(formData.get("employeePrefix") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,10}$/.test(po)) return { error: "คำนำหน้าใบสั่งซื้อ: ใช้ A–Z, 0–9 หรือ - ไม่เกิน 10 ตัว" };
  if (!/^[A-Z0-9-]{1,10}$/.test(emp)) return { error: "คำนำหน้ารหัสพนักงาน: ใช้ A–Z, 0–9 หรือ - ไม่เกิน 10 ตัว" };

  await saveConfig({ [CONFIG_KEYS.PO_PREFIX]: po, [CONFIG_KEYS.EMP_PREFIX]: emp });
  await audit({ userId: s.userId, entity: "SystemSetting", entityId: "doc", action: "UPDATE", detail: `คำนำหน้าเอกสาร PO=${po} พนักงาน=${emp}` });
  revalidatePath("/settings");
  return { ok: true, message: "บันทึกรูปแบบเลขที่เอกสารแล้ว" };
}
