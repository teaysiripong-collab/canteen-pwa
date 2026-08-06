"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { Role } from "@prisma/client";

async function requireAdmin() {
  const s = await requireSession();
  if (!can(s.role, "settings", "admin")) throw new Error("FORBIDDEN");
  return s;
}

export async function createUser(formData: FormData) {
  const s = await requireAdmin();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "STAFF") as Role;
  if (!username || !name || password.length < 4) throw new Error("ข้อมูลไม่ครบ หรือรหัสผ่านสั้นเกินไป");

  const exists = await db.user.findUnique({ where: { username } });
  if (exists) throw new Error("มีชื่อผู้ใช้นี้แล้ว");

  const user = await db.user.create({
    data: { username, name, role, passwordHash: await bcrypt.hash(password, 10) },
  });
  await audit({ userId: s.userId, entity: "User", entityId: user.id, action: "CREATE", detail: `เพิ่มผู้ใช้ ${username} (${role})` });
  revalidatePath("/settings");
}

export async function updateUser(userId: string, formData: FormData) {
  const s = await requireAdmin();
  const old = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? old.role) as Role;
  const active = formData.get("active") === "on";
  const password = String(formData.get("password") ?? "");

  const data: { name: string; role: Role; active: boolean; passwordHash?: string } = { name, role, active };
  if (password) {
    if (password.length < 4) throw new Error("รหัสผ่านสั้นเกินไป");
    data.passwordHash = await bcrypt.hash(password, 10);
  }
  await db.user.update({ where: { id: userId }, data });

  if (old.role !== role) {
    await audit({ userId: s.userId, entity: "User", entityId: userId, action: "UPDATE", field: "role", oldValue: old.role, newValue: role, detail: `เปลี่ยนบทบาท ${old.username}` });
  }
  if (old.active !== active) {
    await audit({ userId: s.userId, entity: "User", entityId: userId, action: "UPDATE", field: "active", oldValue: String(old.active), newValue: String(active), detail: old.username });
  }
  if (password) {
    await audit({ userId: s.userId, entity: "User", entityId: userId, action: "UPDATE", field: "password", detail: `รีเซ็ตรหัสผ่าน ${old.username}` });
  }
  revalidatePath("/settings");
}
