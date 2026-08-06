"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { importWorkbook, type ImportReport } from "@/lib/import";
import { downloadAsXlsx } from "@/lib/drive";

export type ImportState = { error?: string; report?: ImportReport } | null;

export async function runImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const s = await requireSession();
  if (!can(s.role, "master", "admin")) return { error: "คุณไม่มีสิทธิ์นำเข้าข้อมูลหลัก" };

  const dryRun = formData.get("dryRun") === "on";
  const driveFileId = String(formData.get("driveFileId") ?? "").trim();
  const file = formData.get("file");

  let buffer: Buffer;
  if (driveFileId) {
    try {
      buffer = await downloadAsXlsx(driveFileId);
    } catch (e) {
      return { error: `อ่านไฟล์จาก Google Drive ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else if (file instanceof File && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) return { error: "ไฟล์ใหญ่เกิน 10 MB" };
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      return { error: "รองรับเฉพาะไฟล์ .xlsx หรือ .xlsm (ถ้าเป็น .csv ให้บันทึกเป็น Excel ก่อน)" };
    }
    buffer = Buffer.from(await file.arrayBuffer());
  } else {
    return { error: "กรุณาเลือกไฟล์ หรือเลือกไฟล์จาก Google Drive" };
  }

  let report: ImportReport;
  try {
    report = await importWorkbook(buffer, dryRun);
  } catch (e) {
    return { error: `อ่านไฟล์ไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
  }

  const total = Object.values(report.created).reduce((a, b) => a + b, 0) +
    Object.values(report.updated).reduce((a, b) => a + b, 0);

  if (!dryRun && report.issues.length === 0 && total > 0) {
    await audit({
      userId: s.userId, entity: "MasterData", entityId: "import", action: "CREATE",
      detail: `นำเข้าข้อมูลหลัก ${total} รายการ (${Object.entries(report.created).map(([k, v]) => `${k} +${v}`).join(", ") || "—"})`,
    });
    revalidatePath("/master");
  }

  return { report };
}
