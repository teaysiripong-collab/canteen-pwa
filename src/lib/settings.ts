import { db } from "./db";

/** Admin-editable runtime settings. Env vars act as the fallback default. */
export const SETTING_KEYS = {
  DRIVE_COST_FOLDER: "drive.costFolderId",
  DRIVE_TEMPLATE_FOLDER: "drive.templateFolderId",
  DRIVE_DOCS_FOLDER: "drive.docsFolderId",
  DRIVE_AUTO_UPLOAD: "drive.autoUploadCost",
  SHEETS_SPREADSHEET_ID: "sheets.spreadsheetId",
  SHEETS_LAST_PUSH: "sheets.lastPush",
  SHEETS_LAST_PULL: "sheets.lastPull",
  SHEETS_AUTO_PUSH: "sheets.autoPush",
} as const;

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: keys } } });
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = rows.find((r) => r.key === k)?.value ?? "";
  return out;
}

export async function setSetting(key: string, value: string) {
  await db.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
