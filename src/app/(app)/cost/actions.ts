"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { CostFileStatus } from "@prisma/client";

export async function createCostFile(formData: FormData) {
  const s = await requireSession();
  if (!can(s.role, "cost", "edit")) throw new Error("FORBIDDEN");
  const templateId = String(formData.get("templateId") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  if (!templateId || !from || !to) throw new Error("ข้อมูลไม่ครบ");

  const tmpl = await db.excelTemplate.findUniqueOrThrow({ where: { id: templateId } });
  const file = await db.costFile.create({
    data: {
      templateId,
      name: `${tmpl.name} ${from} ถึง ${to}`,
      periodStart: new Date(from + "T00:00:00Z"),
      periodEnd: new Date(to + "T00:00:00Z"),
      status: "PRICING",
    },
  });
  // แจ้งจัดซื้อว่ามีไฟล์ให้กรอกราคา
  const proc = await db.user.findMany({ where: { role: { in: ["PROCUREMENT"] }, active: true } });
  await db.notification.createMany({
    data: proc.map((u) => ({
      userId: u.id, type: "COST_PENDING", title: "มี Cost File รอกรอกราคา",
      message: file.name, link: "/cost",
    })),
  });
  await audit({ userId: s.userId, entity: "CostFile", entityId: file.id, action: "CREATE", detail: `สร้าง Cost Working File: ${file.name}` });
  revalidatePath("/cost");
}

export async function setCostFileStatus(fileId: string, status: CostFileStatus) {
  const s = await requireSession();
  if (!can(s.role, "cost", "edit")) throw new Error("FORBIDDEN");
  const f = await db.costFile.findUniqueOrThrow({ where: { id: fileId } });
  await db.costFile.update({ where: { id: fileId }, data: { status } });
  await audit({ userId: s.userId, entity: "CostFile", entityId: fileId, action: "STATUS", oldValue: f.status, newValue: status });
  revalidatePath("/cost");
}

export async function saveTemplateMapping(templateId: string, formData: FormData) {
  const s = await requireSession();
  if (!can(s.role, "settings", "admin")) throw new Error("FORBIDDEN");
  const mappingJson = String(formData.get("mappingJson") ?? "");
  const headerRow = parseInt(String(formData.get("headerRow") ?? "1"), 10);
  try {
    JSON.parse(mappingJson);
  } catch {
    throw new Error("Mapping JSON ไม่ถูกต้อง");
  }
  const old = await db.excelTemplate.findUniqueOrThrow({ where: { id: templateId } });
  await db.excelTemplate.update({
    where: { id: templateId },
    data: { mappingJson, headerRow: Number.isFinite(headerRow) ? headerRow : 1 },
  });
  await audit({
    userId: s.userId, entity: "ExcelTemplate", entityId: templateId, action: "UPDATE",
    field: "mapping", oldValue: old.mappingJson.slice(0, 200), newValue: mappingJson.slice(0, 200),
    detail: "แก้ Mapping ของ Excel Template",
  });
  revalidatePath("/settings/excel-template");
  revalidatePath("/cost");
}

export async function createTemplate(formData: FormData) {
  const s = await requireSession();
  if (!can(s.role, "settings", "admin")) throw new Error("FORBIDDEN");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("ต้องระบุชื่อ Template");
  const tmpl = await db.excelTemplate.create({
    data: {
      name,
      description: String(formData.get("description") ?? "") || null,
      headerRow: 1,
      mappingJson: JSON.stringify([
        { field: "date", column: "A", label: "วันที่" },
        { field: "menuName", column: "B", label: "เมนู" },
        { field: "ingredientName", column: "C", label: "วัตถุดิบ" },
        { field: "qty", column: "D", label: "ปริมาณ" },
        { field: "unit", column: "E", label: "หน่วย" },
        { field: "price", column: "F", label: "ราคา/หน่วย" },
        { field: "amount", column: "G", label: "รวมเงิน", formula: "D*F" },
      ]),
    },
  });
  await audit({ userId: s.userId, entity: "ExcelTemplate", entityId: tmpl.id, action: "CREATE", detail: `สร้าง Template: ${name}` });
  revalidatePath("/settings/excel-template");
}
