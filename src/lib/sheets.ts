import { google, type sheets_v4 } from "googleapis";
import { db } from "./db";
import { getGoogleAuth } from "./drive";
import { getStockLevels } from "./stock";
import { SHEETS, applyImport, rowsFromGrid, type ParsedSheets, type ImportReport } from "./import";
import { SETTING_KEYS, getSetting, setSetting } from "./settings";

/**
 * Google Sheets as the shared data surface.
 *
 * PUSH  — every table is written into one spreadsheet, a tab per entity, so the
 *         canteen's data genuinely lives in Google Sheets and can be opened,
 *         filtered, charted and shared like any other sheet.
 * PULL  — the master-data tabs can be edited in Sheets and read back in. They go
 *         through exactly the same validation as the Excel upload path, so a typo
 *         in Sheets is reported by tab and row number instead of corrupting data.
 *
 * Transactional tabs (stock ledger, purchase orders, audit log) are written as a
 * read-only mirror. Sheets has no transactions or row locking: two people issuing
 * stock in the same minute would overwrite each other's row and the ledger would
 * silently lose quantities. Those writes therefore stay in PostgreSQL, and Sheets
 * always shows the true balance.
 */

async function getSheets(): Promise<sheets_v4.Sheets | null> {
  const auth = await getGoogleAuth();
  if (!auth) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return google.sheets({ version: "v4", auth: auth as any });
}

export type TabSpec = {
  name: string;
  editable: boolean;
  headers: string[];
  rows: (string | number)[][];
};

const NOTE_READONLY = "⚠️ แท็บนี้ระบบเขียนทับทุกครั้งที่ซิงก์ — แก้ที่นี่แล้วจะหาย ให้แก้ในระบบแทน";

/** Master tabs keep the exact headers the importer expects, so a round-trip works. */
export async function buildMasterTabs(): Promise<TabSpec[]> {
  const [units, categories, vendors, locations, ingredients, menus, bomTemplates] = await Promise.all([
    db.unit.findMany({ orderBy: { code: "asc" } }),
    db.category.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.vendor.findMany({ orderBy: { code: "asc" } }),
    db.location.findMany({ include: { parent: true }, orderBy: { code: "asc" } }),
    db.ingredient.findMany({
      include: { category: true, stockUnit: true, purchaseUnit: true, defaultVendor: true, storage: true },
      orderBy: { code: "asc" },
    }),
    db.menu.findMany({ include: { category: true }, orderBy: { code: "asc" } }),
    db.bomTemplate.findMany({
      where: { isCurrent: true },
      include: { menu: true, items: { include: { ingredient: true, unit: true } } },
      orderBy: { menu: { code: "asc" } },
    }),
  ]);

  const headersOf = (key: string) => SHEETS.find((s) => s.key === key)!.columns.map((c) => c.header);
  const yn = (b: boolean) => (b ? "Y" : "N");

  const bomRows: (string | number)[][] = [];
  for (const t of bomTemplates) {
    for (const it of t.items) {
      bomRows.push([t.menu.code, it.ingredient.code, Number(it.qty), it.unit.code]);
    }
  }

  return [
    {
      name: "หน่วยนับ", editable: true, headers: headersOf("units"),
      rows: units.map((u) => [u.code, u.name]),
    },
    {
      name: "หมวดหมู่", editable: true, headers: headersOf("categories"),
      rows: categories.map((c) => [c.type, c.name]),
    },
    {
      name: "ผู้ขาย", editable: true, headers: headersOf("vendors"),
      rows: vendors.map((v) => [
        v.code, v.name, v.contactName ?? "", v.phone ?? "", v.email ?? "",
        v.minOrder ? Number(v.minOrder) : "", v.leadTimeDays, v.deliveryDays ?? "", yn(v.active),
      ]),
    },
    {
      name: "สถานที่จัดเก็บ", editable: true, headers: headersOf("locations"),
      rows: locations.map((l) => [l.code, l.name, l.parent?.code ?? ""]),
    },
    {
      name: "วัตถุดิบ", editable: true, headers: headersOf("ingredients"),
      rows: ingredients.map((i) => [
        i.code, i.name, i.category?.name ?? "", i.stockUnit.code, i.purchaseUnit?.code ?? "",
        Number(i.conversionFactor), i.defaultVendor?.code ?? "", i.storage?.code ?? "",
        Number(i.minStock), i.lastPrice ? Number(i.lastPrice) : "", yn(i.active),
      ]),
    },
    {
      name: "เมนู", editable: true, headers: headersOf("menus"),
      rows: menus.map((m) => [m.code, m.name, m.category?.name ?? "", yn(m.favorite), yn(m.active)]),
    },
    { name: "BOM มาตรฐาน", editable: true, headers: headersOf("bom"), rows: bomRows },
  ];
}

/** Read-only mirror of everything the canteen actually does day to day. */
export async function buildReportTabs(): Promise<TabSpec[]> {
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const dt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  const shift = (s: string | null) => (s === "MORNING" ? "รอบเช้า" : s === "NIGHT" ? "รอบดึก" : "");

  const [planEntries, bomLines, pos, levels, txns, usage, tasks, audits] = await Promise.all([
    db.menuPlanEntry.findMany({
      include: { menu: true, plan: true },
      orderBy: [{ date: "desc" }, { shift: "asc" }],
      take: 2000,
    }),
    db.bomLine.findMany({
      include: { ingredient: true, unit: true, planEntry: { include: { menu: true } } },
      orderBy: { planEntry: { date: "desc" } },
      take: 5000,
    }),
    db.purchaseOrder.findMany({
      include: { vendor: true, items: { include: { ingredient: true, unit: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    getStockLevels(),
    db.stockTransaction.findMany({
      include: { ingredient: true, unit: true, location: true, lot: true, user: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    db.usageRecord.findMany({
      include: { ingredient: true, unit: true, menu: true, recordedBy: true },
      orderBy: { date: "desc" },
      take: 5000,
    }),
    db.task.findMany({
      include: { assignee: true, createdBy: true, location: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    db.auditLog.findMany({ include: { user: true }, orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);

  const poRows: (string | number)[][] = [];
  for (const po of pos) {
    for (const it of po.items) {
      poRows.push([
        po.code, po.vendor.name, po.status,
        po.periodStart ? ymd(po.periodStart) : "", po.periodEnd ? ymd(po.periodEnd) : "",
        it.ingredient.name, Number(it.bomQty), Number(it.orderQty), Number(it.receivedQty),
        Math.max(0, Number(it.orderQty) - Number(it.receivedQty)),
        it.unit.code, it.price ? Number(it.price) : "",
      ]);
    }
  }

  return [
    {
      name: "แผนเมนู", editable: false,
      headers: ["วันที่", "รอบ", "เมนู", "สถานะแผน"],
      rows: planEntries.map((e) => [ymd(e.date), shift(e.shift), e.menu.name, e.plan.status]),
    },
    {
      name: "BOM รายวัน", editable: false,
      headers: ["วันที่", "รอบ", "เมนู", "วัตถุดิบ", "ปริมาณ", "หน่วย"],
      rows: bomLines.map((l) => [
        ymd(l.planEntry.date), shift(l.planEntry.shift), l.planEntry.menu.name,
        l.ingredient.name, Number(l.qty), l.unit.code,
      ]),
    },
    {
      name: "ใบสั่งซื้อ", editable: false,
      headers: ["เลขที่", "ผู้ขาย", "สถานะ", "ตั้งแต่", "ถึง", "วัตถุดิบ", "BOM ต้องใช้", "สั่งจริง", "รับแล้ว", "ค้างรับ", "หน่วย", "ราคา/หน่วย"],
      rows: poRows,
    },
    {
      name: "Stock คงเหลือ", editable: false,
      headers: ["รหัส", "วัตถุดิบ", "คงเหลือ", "หน่วย", "ขั้นต่ำ", "สถานะ", "อยู่ที่"],
      rows: levels.map((l) => [
        l.code, l.name, l.total, l.unit, l.minStock,
        l.total <= 0 ? "หมด" : l.total < l.minStock ? "ใกล้หมด" : "ปกติ",
        l.byLocation.map((b) => `${b.locationName} (${b.qty})`).join(" · "),
      ]),
    },
    {
      name: "ประวัติ Stock", editable: false,
      headers: ["เวลา", "ประเภท", "วัตถุดิบ", "จำนวน", "หน่วย", "สถานที่", "Lot", "ผู้ทำรายการ", "หมายเหตุ"],
      rows: txns.map((t) => [
        dt(t.createdAt), t.type, t.ingredient.name, Number(t.qty), t.unit.code,
        t.location.name, t.lot?.lotCode ?? "", t.user.name, t.note ?? "",
      ]),
    },
    {
      name: "การใช้จริง", editable: false,
      headers: ["วันที่", "รอบ", "เมนู", "วัตถุดิบ", "ปริมาณ", "หน่วย", "ผู้บันทึก"],
      rows: usage.map((u) => [
        ymd(u.date), shift(u.shift), u.menu?.name ?? "", u.ingredient.name,
        Number(u.qty), u.unit.code, u.recordedBy.name,
      ]),
    },
    {
      name: "งานที่มอบหมาย", editable: false,
      headers: ["งาน", "รายละเอียด", "ผู้รับผิดชอบ", "ผู้สั่ง", "สถานะ", "ความสำคัญ", "วันที่", "กำหนดเสร็จ", "สถานที่"],
      rows: tasks.map((t) => [
        t.title, t.description ?? "", t.assignee?.name ?? "", t.createdBy.name, t.status, t.priority,
        t.date ? ymd(t.date) : "", t.dueAt ? dt(t.dueAt) : "", t.location?.name ?? "",
      ]),
    },
    {
      name: "Audit Log", editable: false,
      headers: ["เวลา", "ผู้ใช้", "การกระทำ", "ตาราง", "ฟิลด์", "ค่าเดิม", "ค่าใหม่", "รายละเอียด"],
      rows: audits.map((a) => [
        dt(a.createdAt), a.user.name, a.action, a.entity, a.field ?? "",
        a.oldValue ?? "", a.newValue ?? "", a.detail ?? "",
      ]),
    },
  ];
}

export type PushResult = { tabs: { name: string; rows: number; editable: boolean }[]; total: number };

/** Make sure every tab exists, then overwrite its contents. */
export async function pushAllToSheets(spreadsheetId: string): Promise<PushResult> {
  const sheets = await getSheets();
  if (!sheets) throw new Error("ยังไม่ได้ตั้งค่า Credential ของ Google");
  if (!spreadsheetId) throw new Error("ยังไม่ได้ระบุ Spreadsheet ID");

  const tabs = [...(await buildMasterTabs()), ...(await buildReportTabs())];

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? ""));

  const missing = tabs.filter((t) => !existing.has(t.name));
  if (missing.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: missing.map((t) => ({ addSheet: { properties: { title: t.name } } })) },
    });
  }

  // Clear first so deleted rows don't linger below the new data.
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: tabs.map((t) => `'${t.name}'`) },
  });

  const data = tabs.map((t) => ({
    range: `'${t.name}'!A1`,
    values: t.editable
      ? [t.headers, ...t.rows]
      : [[NOTE_READONLY], t.headers, ...t.rows],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });

  // Freeze + bold the header row of every tab so the sheet reads like a table.
  const meta2 = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const idByTitle = new Map(
    (meta2.data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId ?? 0])
  );
  const formatRequests: sheets_v4.Schema$Request[] = [];
  for (const t of tabs) {
    const sheetId = idByTitle.get(t.name);
    if (sheetId === undefined) continue;
    const headerIndex = t.editable ? 0 : 1;
    formatRequests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: headerIndex + 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    });
    formatRequests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: headerIndex, endRowIndex: headerIndex + 1 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: t.editable
              ? { red: 0.91, green: 0.94, blue: 0.96 }
              : { red: 0.95, green: 0.95, blue: 0.95 },
          },
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    });
  }
  if (formatRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatRequests } });
  }

  await setSetting(SETTING_KEYS.SHEETS_LAST_PUSH, new Date().toISOString());

  return {
    tabs: tabs.map((t) => ({ name: t.name, rows: t.rows.length, editable: t.editable })),
    total: tabs.reduce((s, t) => s + t.rows.length, 0),
  };
}

/** Read the editable master tabs back and run them through the import rules. */
export async function pullMasterFromSheets(spreadsheetId: string, dryRun: boolean): Promise<ImportReport> {
  const sheets = await getSheets();
  if (!sheets) throw new Error("ยังไม่ได้ตั้งค่า Credential ของ Google");
  if (!spreadsheetId) throw new Error("ยังไม่ได้ระบุ Spreadsheet ID");

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const present = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? ""));
  const wanted = SHEETS.filter((s) => present.has(s.sheetName));

  const parsed: ParsedSheets = {};
  if (wanted.length > 0) {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: wanted.map((s) => `'${s.sheetName}'`),
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    (res.data.valueRanges ?? []).forEach((vr, i) => {
      const spec = wanted[i];
      const grid = (vr.values ?? []).map((row) => (row ?? []).map((c) => (c === null || c === undefined ? "" : String(c))));
      parsed[spec.key] = rowsFromGrid(grid, spec.columns);
    });
  }

  const report = await applyImport(parsed, dryRun);
  if (!dryRun && report.issues.length === 0) {
    await setSetting(SETTING_KEYS.SHEETS_LAST_PULL, new Date().toISOString());
  }
  return report;
}

/** Create a new spreadsheet (optionally inside a Drive folder) and fill it. */
export async function createSpreadsheet(title: string, folderId?: string): Promise<{ id: string; url: string }> {
  const sheets = await getSheets();
  if (!sheets) throw new Error("ยังไม่ได้ตั้งค่า Credential ของ Google");

  const created = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
    fields: "spreadsheetId, spreadsheetUrl",
  });
  const id = created.data.spreadsheetId!;

  if (folderId) {
    const auth = await getGoogleAuth();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drive = google.drive({ version: "v3", auth: auth as any });
    await drive.files.update({ fileId: id, addParents: folderId, fields: "id", supportsAllDrives: true });
  }

  return { id, url: created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}` };
}

export async function sheetsSpreadsheetId() {
  return getSetting(SETTING_KEYS.SHEETS_SPREADSHEET_ID, process.env.SHEETS_SPREADSHEET_ID ?? "");
}

export async function checkSpreadsheet(spreadsheetId: string): Promise<{ ok: boolean; message: string }> {
  const sheets = await getSheets();
  if (!sheets) return { ok: false, message: "ยังไม่ได้ตั้งค่า Credential ของ Google" };
  if (!spreadsheetId) return { ok: false, message: "ยังไม่ได้ระบุ Spreadsheet ID" };
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "properties.title, sheets.properties.title" });
    const tabs = (res.data.sheets ?? []).length;
    return { ok: true, message: `เชื่อมต่อสำเร็จ — "${res.data.properties?.title}" (${tabs} แท็บ)` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404")) {
      return { ok: false, message: "ไม่พบไฟล์ หรือยังไม่ได้แชร์ Spreadsheet ให้ Service Account (ต้องให้สิทธิ์ Editor)" };
    }
    return { ok: false, message: `เชื่อมต่อไม่สำเร็จ: ${msg}` };
  }
}
