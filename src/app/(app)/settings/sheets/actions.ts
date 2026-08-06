"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import {
  checkSpreadsheet, createSpreadsheet, pullMasterFromSheets, pushAllToSheets, sheetsSpreadsheetId,
} from "@/lib/sheets";
import { docsFolderId } from "@/lib/drive";
import type { ImportReport } from "@/lib/import";

async function requireAdmin() {
  const s = await requireSession();
  if (!can(s.role, "settings", "admin")) throw new Error("FORBIDDEN");
  return s;
}

export type SheetsState =
  | { ok?: boolean; message?: string; url?: string; report?: ImportReport }
  | null;

export async function saveSheetsSettings(_prev: SheetsState, formData: FormData): Promise<SheetsState> {
  const s = await requireAdmin();
  const raw = String(formData.get("spreadsheetId") ?? "").trim();
  // Accept a pasted full URL as well as a bare id.
  const id = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? raw;
  const autoPush = formData.get("autoPush") === "on" ? "1" : "0";

  await setSetting(SETTING_KEYS.SHEETS_SPREADSHEET_ID, id);
  await setSetting(SETTING_KEYS.SHEETS_AUTO_PUSH, autoPush);
  await audit({
    userId: s.userId, entity: "SystemSetting", entityId: "sheets", action: "UPDATE",
    detail: "แก้ไขการตั้งค่า Google Sheets",
  });
  revalidatePath("/settings/sheets");
  return { ok: true, message: id ? "บันทึกแล้ว" : "ล้างการตั้งค่าแล้ว" };
}

export async function testSpreadsheet(_prev: SheetsState, formData: FormData): Promise<SheetsState> {
  await requireAdmin();
  const raw = String(formData.get("spreadsheetId") ?? "").trim();
  const id = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? raw;
  const res = await checkSpreadsheet(id);
  return { ok: res.ok, message: res.message };
}

export async function createAndLinkSpreadsheet(_prev: SheetsState, formData: FormData): Promise<SheetsState> {
  const s = await requireAdmin();
  const title = String(formData.get("title") ?? "").trim() || "Canteen Management System — ฐานข้อมูล";
  try {
    const folder = await docsFolderId();
    const { id, url } = await createSpreadsheet(title, folder || undefined);
    await setSetting(SETTING_KEYS.SHEETS_SPREADSHEET_ID, id);
    const result = await pushAllToSheets(id);
    await audit({
      userId: s.userId, entity: "SystemSetting", entityId: "sheets", action: "CREATE",
      detail: `สร้าง Google Sheets ใหม่และซิงก์ข้อมูล ${result.total} แถว`,
    });
    revalidatePath("/settings/sheets");
    return {
      ok: true, url,
      message: `สร้างไฟล์ "${title}" และเขียนข้อมูล ${result.total} แถว ใน ${result.tabs.length} แท็บเรียบร้อย`,
    };
  } catch (e) {
    return { ok: false, message: `สร้างไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** DB → Sheets. Overwrites every tab with the current state of the system. */
export async function pushNow(): Promise<SheetsState> {
  const s = await requireAdmin();
  try {
    const id = await sheetsSpreadsheetId();
    const result = await pushAllToSheets(id);
    await audit({
      userId: s.userId, entity: "SystemSetting", entityId: "sheets", action: "UPDATE",
      detail: `ส่งข้อมูลขึ้น Google Sheets ${result.total} แถว`,
    });
    revalidatePath("/settings/sheets");
    return {
      ok: true,
      message: `ส่งขึ้น Sheets แล้ว ${result.total} แถว — ` +
        result.tabs.filter((t) => t.rows > 0).map((t) => `${t.name} ${t.rows}`).join(", "),
    };
  } catch (e) {
    return { ok: false, message: `ส่งข้อมูลไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Sheets → DB, master data only, through the same validation as the Excel import. */
export async function pullNow(_prev: SheetsState, formData: FormData): Promise<SheetsState> {
  const s = await requireAdmin();
  const dryRun = formData.get("dryRun") === "on";
  try {
    const id = await sheetsSpreadsheetId();
    const report = await pullMasterFromSheets(id, dryRun);
    const total =
      Object.values(report.created).reduce((a, b) => a + b, 0) +
      Object.values(report.updated).reduce((a, b) => a + b, 0);

    if (!dryRun && report.issues.length === 0 && total > 0) {
      await audit({
        userId: s.userId, entity: "MasterData", entityId: "sheets-pull", action: "UPDATE",
        detail: `ดึงข้อมูลหลักจาก Google Sheets ${total} รายการ`,
      });
      revalidatePath("/master");
    }
    revalidatePath("/settings/sheets");
    return { ok: report.issues.length === 0, report };
  } catch (e) {
    return { ok: false, message: `ดึงข้อมูลไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}` };
  }
}
