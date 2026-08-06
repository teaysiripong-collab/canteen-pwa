"use server";

import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { downloadAsXlsx, testDriveAccess } from "@/lib/drive";

async function requireAdmin() {
  const s = await requireSession();
  if (!can(s.role, "settings", "admin")) throw new Error("FORBIDDEN");
  return s;
}

export type DriveActionState = { ok?: boolean; message?: string } | null;

export async function saveDriveSettings(_prev: DriveActionState, formData: FormData): Promise<DriveActionState> {
  const s = await requireAdmin();
  const cost = String(formData.get("costFolderId") ?? "").trim();
  const template = String(formData.get("templateFolderId") ?? "").trim();
  const docs = String(formData.get("docsFolderId") ?? "").trim();
  const auto = formData.get("autoUpload") === "on" ? "1" : "0";

  await setSetting(SETTING_KEYS.DRIVE_COST_FOLDER, cost);
  await setSetting(SETTING_KEYS.DRIVE_TEMPLATE_FOLDER, template);
  await setSetting(SETTING_KEYS.DRIVE_DOCS_FOLDER, docs);
  await setSetting(SETTING_KEYS.DRIVE_AUTO_UPLOAD, auto);

  await audit({
    userId: s.userId, entity: "SystemSetting", entityId: "drive", action: "UPDATE",
    detail: "แก้ไขการตั้งค่า Google Drive",
  });
  revalidatePath("/settings/drive");
  return { ok: true, message: "บันทึกการตั้งค่าแล้ว" };
}

export async function testFolder(_prev: DriveActionState, formData: FormData): Promise<DriveActionState> {
  await requireAdmin();
  const folderId = String(formData.get("folderId") ?? "").trim();
  const res = await testDriveAccess(folderId);
  return { ok: res.ok, message: res.message };
}

/**
 * Import an Excel template that already lives in Drive: read its header row and
 * turn the columns the organisation already uses into a mapping — so nobody has
 * to retype a layout that exists.
 */
export async function importTemplateFromDrive(_prev: DriveActionState, formData: FormData): Promise<DriveActionState> {
  const s = await requireAdmin();
  const fileId = String(formData.get("fileId") ?? "").trim();
  const fileName = String(formData.get("fileName") ?? "").trim() || "Template จาก Drive";
  const headerRow = parseInt(String(formData.get("headerRow") ?? "1"), 10) || 1;
  if (!fileId) return { ok: false, message: "ไม่ได้ระบุไฟล์" };

  let buf: Buffer;
  try {
    buf = await downloadAsXlsx(fileId);
  } catch (e) {
    return { ok: false, message: `อ่านไฟล์จาก Drive ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, message: "ไฟล์นี้ไม่มีชีตข้อมูล" };

  // Guess which system field each existing column holds, from its header text.
  const GUESS: { keywords: string[]; field: string }[] = [
    { keywords: ["วันที่", "date"], field: "date" },
    { keywords: ["รอบ", "กะ", "shift"], field: "shift" },
    { keywords: ["เมนู", "menu", "รายการอาหาร"], field: "menuName" },
    { keywords: ["รหัสวัตถุดิบ", "item code", "code"], field: "ingredientCode" },
    { keywords: ["วัตถุดิบ", "ingredient", "รายการ"], field: "ingredientName" },
    { keywords: ["ปริมาณ", "จำนวน", "qty", "quantity"], field: "qty" },
    { keywords: ["หน่วย", "unit"], field: "unit" },
    { keywords: ["ผู้ขาย", "vendor", "ร้าน"], field: "vendor" },
    { keywords: ["ราคา", "price", "unit cost"], field: "price" },
    { keywords: ["รวมเงิน", "จำนวนเงิน", "amount", "total"], field: "amount" },
  ];

  const mapping: { field: string; column: string; label: string; formula?: string }[] = [];
  const used = new Set<string>();
  const row = ws.getRow(headerRow);
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const label = String(cell.value ?? "").trim();
    if (!label) return;
    const lower = label.toLowerCase();
    const hit = GUESS.find((g) => g.keywords.some((k) => lower.includes(k.toLowerCase())));
    if (!hit || used.has(hit.field)) return;
    used.add(hit.field);
    const letter = ws.getColumn(colNumber).letter;
    mapping.push({
      field: hit.field,
      column: letter,
      label,
      ...(hit.field === "amount" ? { formula: guessAmountFormula(mapping) } : {}),
    });
  });

  if (mapping.length === 0) {
    return {
      ok: false,
      message: `อ่านหัวตารางแถวที่ ${headerRow} แล้วไม่พบคอลัมน์ที่รู้จัก — ลองระบุแถวหัวตารางให้ถูกต้อง แล้วปรับ Mapping เองที่หน้า Excel Template Manager`,
    };
  }

  const tmpl = await db.excelTemplate.create({
    data: {
      name: fileName.replace(/\.(xlsx|xlsm|xltx)$/i, ""),
      description: `นำเข้าจาก Google Drive (file id: ${fileId})`,
      driveFileId: fileId,
      headerRow,
      mappingJson: JSON.stringify(mapping),
    },
  });
  await audit({
    userId: s.userId, entity: "ExcelTemplate", entityId: tmpl.id, action: "CREATE",
    detail: `นำเข้า Template จาก Google Drive: ${fileName} (${mapping.length} คอลัมน์)`,
  });
  revalidatePath("/settings/excel-template");
  revalidatePath("/settings/drive");
  return {
    ok: true,
    message: `นำเข้าสำเร็จ — จับคู่ได้ ${mapping.length} คอลัมน์: ${mapping.map((m) => `${m.label}→${m.column}`).join(", ")}. ตรวจสอบและปรับได้ที่ Excel Template Manager`,
  };
}

/** amount = qty column × price column, using whatever letters were detected. */
function guessAmountFormula(mapping: { field: string; column: string }[]): string | undefined {
  const qty = mapping.find((m) => m.field === "qty")?.column;
  const price = mapping.find((m) => m.field === "price")?.column;
  if (!qty || !price) return undefined;
  return `${qty}*${price}`;
}
