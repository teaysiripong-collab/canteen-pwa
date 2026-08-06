import { google, type drive_v3 } from "googleapis";
import { Readable } from "stream";
import { SETTING_KEYS, getSetting } from "./settings";

/**
 * Google Drive integration (service account, server-to-server).
 *
 * Setup, once, by an admin:
 *   1. Google Cloud Console → create a Service Account → create a JSON key.
 *   2. Put the JSON into GOOGLE_SERVICE_ACCOUNT_KEY (raw JSON or base64), or
 *      point GOOGLE_APPLICATION_CREDENTIALS at the file. On Cloud Run the
 *      attached runtime service account is picked up automatically.
 *   3. In Google Drive, share the target folder with the service account's
 *      email (Editor). Shared Drives work too — add it as a member.
 *   4. Paste the folder IDs on /settings/drive.
 *
 * Everything here degrades gracefully: if Drive is not configured the app keeps
 * working and simply reports that the integration is off.
 */

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];

export type DriveStatus =
  | { configured: false; reason: string }
  | { configured: true; clientEmail: string };

function readCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) return null;
  try {
    // Accept both raw JSON and base64-encoded JSON (easier to put in a secret).
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      // Secret managers commonly escape the newlines in the PEM body.
      private_key: String(parsed.private_key).replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

export async function getGoogleAuth() {
  return getAuth();
}

async function getAuth() {
  const creds = readCredentials();
  if (creds) {
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: SCOPES,
    });
  }
  // Application Default Credentials — the normal path on Cloud Run / GCE.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE) {
    const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
    return auth.getClient();
  }
  return null;
}

async function getDrive(): Promise<drive_v3.Drive | null> {
  const auth = await getAuth();
  if (!auth) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return google.drive({ version: "v3", auth: auth as any });
}

export async function driveStatus(): Promise<DriveStatus> {
  const creds = readCredentials();
  if (creds) return { configured: true, clientEmail: creds.client_email };
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE) {
    return { configured: true, clientEmail: "(Application Default Credentials)" };
  }
  return {
    configured: false,
    reason: "ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_KEY หรือ Application Default Credentials",
  };
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GSHEET_MIME = "application/vnd.google-apps.spreadsheet";

/** Verify credentials + folder access. Returns a human-readable result. */
export async function testDriveAccess(folderId: string): Promise<{ ok: boolean; message: string }> {
  const drive = await getDrive();
  if (!drive) return { ok: false, message: "ยังไม่ได้ตั้งค่า Credential ของ Google Cloud" };
  if (!folderId) return { ok: false, message: "ยังไม่ได้ระบุ Folder ID" };
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType",
      supportsAllDrives: true,
    });
    if (res.data.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, message: `ID นี้ไม่ใช่โฟลเดอร์ (เป็น ${res.data.mimeType})` };
    }
    return { ok: true, message: `เชื่อมต่อสำเร็จ — โฟลเดอร์ "${res.data.name}"` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404")) {
      return {
        ok: false,
        message: "ไม่พบโฟลเดอร์ หรือยังไม่ได้แชร์โฟลเดอร์ให้ Service Account (ต้องให้สิทธิ์ Editor)",
      };
    }
    return { ok: false, message: `เชื่อมต่อไม่สำเร็จ: ${msg}` };
  }
}

/** List spreadsheet files in a folder (xlsx + Google Sheets). */
export async function listSpreadsheets(folderId: string): Promise<DriveFile[]> {
  const drive = await getDrive();
  if (!drive || !folderId) return [];
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and (mimeType = '${XLSX_MIME}' or mimeType = '${GSHEET_MIME}')`,
    fields: "files(id, name, mimeType, modifiedTime, webViewLink, size)",
    orderBy: "modifiedTime desc",
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    modifiedTime: f.modifiedTime ?? undefined,
    webViewLink: f.webViewLink ?? undefined,
    size: f.size ?? undefined,
  }));
}

/** Download a Drive file as xlsx (Google Sheets are exported on the fly). */
export async function downloadAsXlsx(fileId: string): Promise<Buffer> {
  const drive = await getDrive();
  if (!drive) throw new Error("ยังไม่ได้ตั้งค่า Google Drive");
  const meta = await drive.files.get({ fileId, fields: "mimeType, name", supportsAllDrives: true });

  const res =
    meta.data.mimeType === GSHEET_MIME
      ? await drive.files.export({ fileId, mimeType: XLSX_MIME }, { responseType: "arraybuffer" })
      : await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });

  return Buffer.from(res.data as ArrayBuffer);
}

/** Upload (or replace, when name matches) a workbook into a folder. */
export async function uploadXlsx(opts: {
  folderId: string;
  name: string;
  data: Buffer;
  replaceExisting?: boolean;
}): Promise<{ id: string; link: string }> {
  const drive = await getDrive();
  if (!drive) throw new Error("ยังไม่ได้ตั้งค่า Google Drive");
  if (!opts.folderId) throw new Error("ยังไม่ได้ระบุ Folder ID ปลายทาง");

  const body = Readable.from(opts.data);
  const media = { mimeType: XLSX_MIME, body };

  if (opts.replaceExisting) {
    const existing = await drive.files.list({
      q: `'${opts.folderId}' in parents and name = '${opts.name.replace(/'/g, "\\'")}' and trashed = false`,
      fields: "files(id)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const hit = existing.data.files?.[0];
    if (hit?.id) {
      const updated = await drive.files.update({
        fileId: hit.id,
        media,
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      return { id: updated.data.id!, link: updated.data.webViewLink ?? "" };
    }
  }

  const created = await drive.files.create({
    requestBody: { name: opts.name, parents: [opts.folderId] },
    media,
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  return { id: created.data.id!, link: created.data.webViewLink ?? "" };
}

/** Resolve the configured folder for a purpose, falling back to env defaults. */
export async function costFolderId() {
  return getSetting(SETTING_KEYS.DRIVE_COST_FOLDER, process.env.DRIVE_COST_FOLDER_ID ?? "");
}
export async function templateFolderId() {
  return getSetting(SETTING_KEYS.DRIVE_TEMPLATE_FOLDER, process.env.DRIVE_TEMPLATE_FOLDER_ID ?? "");
}
export async function docsFolderId() {
  return getSetting(SETTING_KEYS.DRIVE_DOCS_FOLDER, process.env.DRIVE_DOCS_FOLDER_ID ?? "");
}
