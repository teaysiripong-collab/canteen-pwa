import ExcelJS from "exceljs";
import { db } from "./db";

/**
 * Master-data import from the spreadsheets the canteen already keeps.
 *
 * One workbook, one sheet per master. Sheets that are absent are simply skipped,
 * so a file with only "วัตถุดิบ" is perfectly valid. Import order matters:
 * units/categories/vendors/locations must exist before ingredients reference them.
 */

export type SheetKey = "units" | "categories" | "vendors" | "locations" | "ingredients" | "menus" | "bom";

export type ColumnSpec = { key: string; header: string; required?: boolean; note?: string };

export const SHEETS: { key: SheetKey; sheetName: string; label: string; columns: ColumnSpec[] }[] = [
  {
    key: "units", sheetName: "หน่วยนับ", label: "หน่วยนับ (Unit)",
    columns: [
      { key: "code", header: "รหัสหน่วย", required: true, note: "เช่น kg" },
      { key: "name", header: "ชื่อหน่วย", required: true, note: "เช่น กิโลกรัม" },
    ],
  },
  {
    key: "categories", sheetName: "หมวดหมู่", label: "หมวดหมู่ (Category)",
    columns: [
      { key: "type", header: "ประเภท", required: true, note: "INGREDIENT หรือ MENU" },
      { key: "name", header: "ชื่อหมวด", required: true },
    ],
  },
  {
    key: "vendors", sheetName: "ผู้ขาย", label: "ผู้ขาย (Vendor)",
    columns: [
      { key: "code", header: "รหัสผู้ขาย", required: true },
      { key: "name", header: "ชื่อผู้ขาย", required: true },
      { key: "contactName", header: "ผู้ติดต่อ" },
      { key: "phone", header: "เบอร์โทร" },
      { key: "email", header: "อีเมล" },
      { key: "minOrder", header: "ยอดสั่งขั้นต่ำ" },
      { key: "leadTimeDays", header: "Lead Time (วัน)" },
      { key: "deliveryDays", header: "รอบส่ง", note: "เช่น จ,พ,ศ" },
      { key: "active", header: "ใช้งาน", note: "Y / N (เว้นว่าง = Y)" },
    ],
  },
  {
    key: "locations", sheetName: "สถานที่จัดเก็บ", label: "สถานที่จัดเก็บ (Location)",
    columns: [
      { key: "code", header: "รหัสสถานที่", required: true },
      { key: "name", header: "ชื่อสถานที่", required: true },
      { key: "parentCode", header: "อยู่ภายใต้ (รหัส)", note: "เว้นว่าง = ระดับบนสุด" },
    ],
  },
  {
    key: "ingredients", sheetName: "วัตถุดิบ", label: "วัตถุดิบ (Ingredient)",
    columns: [
      { key: "code", header: "รหัสวัตถุดิบ", required: true },
      { key: "name", header: "ชื่อวัตถุดิบ", required: true },
      { key: "category", header: "หมวด" },
      { key: "stockUnit", header: "หน่วยนับ", required: true, note: "ต้องมีในชีตหน่วยนับ" },
      { key: "purchaseUnit", header: "หน่วยสั่งซื้อ" },
      { key: "conversionFactor", header: "ตัวคูณแปลงหน่วย", note: "1 หน่วยสั่ง = ? หน่วยนับ" },
      { key: "vendorCode", header: "รหัสผู้ขายหลัก" },
      { key: "storageCode", header: "รหัสที่จัดเก็บ" },
      { key: "minStock", header: "Stock ขั้นต่ำ" },
      { key: "lastPrice", header: "ราคาล่าสุด/หน่วยสั่งซื้อ" },
      { key: "active", header: "ใช้งาน", note: "Y / N" },
    ],
  },
  {
    key: "menus", sheetName: "เมนู", label: "เมนู (Menu)",
    columns: [
      { key: "code", header: "รหัสเมนู", required: true },
      { key: "name", header: "ชื่อเมนู", required: true },
      { key: "category", header: "หมวด" },
      { key: "favorite", header: "Favorite", note: "Y / N" },
      { key: "active", header: "ใช้งาน", note: "Y / N" },
    ],
  },
  {
    key: "bom", sheetName: "BOM มาตรฐาน", label: "BOM มาตรฐานต่อเมนู",
    columns: [
      { key: "menuCode", header: "รหัสเมนู", required: true },
      { key: "ingredientCode", header: "รหัสวัตถุดิบ", required: true },
      { key: "qty", header: "ปริมาณต่อรอบ", required: true },
      { key: "unit", header: "หน่วย", note: "เว้นว่าง = ใช้หน่วยนับของวัตถุดิบ" },
    ],
  },
];

export type RowIssue = { sheet: string; row: number; message: string };
export type ImportReport = {
  created: Record<string, number>;
  updated: Record<string, number>;
  issues: RowIssue[];
  skippedSheets: string[];
  dryRun: boolean;
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("result" in v) return String((v as { result: unknown }).result ?? "").trim();
    if ("richText" in v) {
      return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("").trim();
    }
  }
  return String(v).trim();
}

function toNum(s: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toBool(s: string, dflt = true): boolean {
  if (!s) return dflt;
  return /^(y|yes|true|1|ใช่|ใช้งาน)$/i.test(s);
}

/** Read a sheet into objects keyed by our column keys, matching on header text. */
function readSheet(ws: ExcelJS.Worksheet, columns: ColumnSpec[]): { rows: Record<string, string>[]; rowNumbers: number[] } {
  const headerRow = ws.getRow(1);
  const colByKey = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellText(cell.value).toLowerCase();
    const spec = columns.find(
      (c) => c.header.toLowerCase() === text || c.key.toLowerCase() === text
    );
    if (spec && !colByKey.has(spec.key)) colByKey.set(spec.key, colNumber);
  });

  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let any = false;
    for (const [key, colNumber] of colByKey) {
      const val = cellText(row.getCell(colNumber).value);
      obj[key] = val;
      if (val) any = true;
    }
    if (any) {
      rows.push(obj);
      rowNumbers.push(rowNumber);
    }
  });
  return { rows, rowNumbers };
}

/** Rows already extracted from a source (Excel file, Google Sheet, ...). */
export type SheetRows = { rows: Record<string, string>[]; rowNumbers: number[] };
export type ParsedSheets = Partial<Record<SheetKey, SheetRows>>;

/**
 * Validate + apply parsed rows. Source-agnostic so an Excel upload and a Google
 * Sheets pull go through exactly the same rules. With dryRun the database is
 * left untouched but every row is still checked.
 */
export async function applyImport(parsed: ParsedSheets, dryRun: boolean): Promise<ImportReport> {
  const report: ImportReport = { created: {}, updated: {}, issues: [], skippedSheets: [], dryRun };
  const bump = (bucket: Record<string, number>, key: string) => (bucket[key] = (bucket[key] ?? 0) + 1);

  const run = async (tx: typeof db) => {
    for (const sheet of SHEETS) {
      const parsedSheet = parsed[sheet.key];
      if (!parsedSheet) {
        report.skippedSheets.push(sheet.sheetName);
        continue;
      }
      const { rows, rowNumbers } = parsedSheet;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowNo = rowNumbers[i];
        const fail = (message: string) => report.issues.push({ sheet: sheet.sheetName, row: rowNo, message });

        const missing = sheet.columns.filter((c) => c.required && !r[c.key]);
        if (missing.length) {
          fail(`ขาดข้อมูลที่จำเป็น: ${missing.map((m) => m.header).join(", ")}`);
          continue;
        }

        try {
          switch (sheet.key) {
            case "units": {
              const existing = await tx.unit.findUnique({ where: { code: r.code } });
              if (existing) {
                await tx.unit.update({ where: { code: r.code }, data: { name: r.name } });
                bump(report.updated, sheet.label);
              } else {
                await tx.unit.create({ data: { code: r.code, name: r.name } });
                bump(report.created, sheet.label);
              }
              break;
            }
            case "categories": {
              const type = r.type.toUpperCase();
              if (type !== "INGREDIENT" && type !== "MENU") {
                fail(`ประเภทต้องเป็น INGREDIENT หรือ MENU (พบ "${r.type}")`);
                continue;
              }
              const existing = await tx.category.findUnique({ where: { type_name: { type, name: r.name } } });
              if (existing) bump(report.updated, sheet.label);
              else {
                await tx.category.create({ data: { type, name: r.name } });
                bump(report.created, sheet.label);
              }
              break;
            }
            case "vendors": {
              const data = {
                name: r.name,
                contactName: r.contactName || null,
                phone: r.phone || null,
                email: r.email || null,
                minOrder: toNum(r.minOrder),
                leadTimeDays: toNum(r.leadTimeDays) ?? 1,
                deliveryDays: r.deliveryDays || null,
                active: toBool(r.active),
              };
              const existing = await tx.vendor.findUnique({ where: { code: r.code } });
              if (existing) {
                await tx.vendor.update({ where: { code: r.code }, data });
                bump(report.updated, sheet.label);
              } else {
                await tx.vendor.create({ data: { code: r.code, ...data } });
                bump(report.created, sheet.label);
              }
              break;
            }
            case "locations": {
              let parentId: string | null = null;
              if (r.parentCode) {
                const parent = await tx.location.findUnique({ where: { code: r.parentCode } });
                if (!parent) {
                  fail(`ไม่พบสถานที่แม่รหัส "${r.parentCode}" (ใส่แถวของสถานที่แม่ไว้ก่อน)`);
                  continue;
                }
                parentId = parent.id;
              }
              const existing = await tx.location.findUnique({ where: { code: r.code } });
              if (existing) {
                await tx.location.update({ where: { code: r.code }, data: { name: r.name, parentId } });
                bump(report.updated, sheet.label);
              } else {
                await tx.location.create({ data: { code: r.code, name: r.name, parentId } });
                bump(report.created, sheet.label);
              }
              break;
            }
            case "ingredients": {
              const unit = await tx.unit.findUnique({ where: { code: r.stockUnit } });
              if (!unit) {
                fail(`ไม่พบหน่วยนับ "${r.stockUnit}" — เพิ่มในชีต "หน่วยนับ" ก่อน`);
                continue;
              }
              let purchaseUnitId: string | null = unit.id;
              if (r.purchaseUnit) {
                const pu = await tx.unit.findUnique({ where: { code: r.purchaseUnit } });
                if (!pu) {
                  fail(`ไม่พบหน่วยสั่งซื้อ "${r.purchaseUnit}"`);
                  continue;
                }
                purchaseUnitId = pu.id;
              }
              let categoryId: string | null = null;
              if (r.category) {
                const cat = await tx.category.findUnique({
                  where: { type_name: { type: "INGREDIENT", name: r.category } },
                });
                if (!cat) {
                  fail(`ไม่พบหมวดวัตถุดิบ "${r.category}"`);
                  continue;
                }
                categoryId = cat.id;
              }
              let defaultVendorId: string | null = null;
              if (r.vendorCode) {
                const v = await tx.vendor.findUnique({ where: { code: r.vendorCode } });
                if (!v) {
                  fail(`ไม่พบผู้ขายรหัส "${r.vendorCode}"`);
                  continue;
                }
                defaultVendorId = v.id;
              }
              let storageId: string | null = null;
              if (r.storageCode) {
                const loc = await tx.location.findUnique({ where: { code: r.storageCode } });
                if (!loc) {
                  fail(`ไม่พบสถานที่จัดเก็บรหัส "${r.storageCode}"`);
                  continue;
                }
                storageId = loc.id;
              }
              const data = {
                name: r.name,
                categoryId,
                stockUnitId: unit.id,
                purchaseUnitId,
                conversionFactor: toNum(r.conversionFactor) ?? 1,
                defaultVendorId,
                storageId,
                minStock: toNum(r.minStock) ?? 0,
                lastPrice: toNum(r.lastPrice),
                active: toBool(r.active),
              };
              const existing = await tx.ingredient.findUnique({ where: { code: r.code } });
              if (existing) {
                await tx.ingredient.update({ where: { code: r.code }, data });
                bump(report.updated, sheet.label);
              } else {
                await tx.ingredient.create({ data: { code: r.code, ...data } });
                bump(report.created, sheet.label);
              }
              break;
            }
            case "menus": {
              let categoryId: string | null = null;
              if (r.category) {
                const cat = await tx.category.findUnique({
                  where: { type_name: { type: "MENU", name: r.category } },
                });
                if (!cat) {
                  fail(`ไม่พบหมวดเมนู "${r.category}"`);
                  continue;
                }
                categoryId = cat.id;
              }
              const data = {
                name: r.name,
                categoryId,
                favorite: toBool(r.favorite, false),
                active: toBool(r.active),
              };
              const existing = await tx.menu.findUnique({ where: { code: r.code } });
              if (existing) {
                await tx.menu.update({ where: { code: r.code }, data });
                bump(report.updated, sheet.label);
              } else {
                await tx.menu.create({ data: { code: r.code, ...data } });
                bump(report.created, sheet.label);
              }
              break;
            }
            case "bom": {
              const menu = await tx.menu.findUnique({ where: { code: r.menuCode } });
              if (!menu) {
                fail(`ไม่พบเมนูรหัส "${r.menuCode}"`);
                continue;
              }
              const ingredient = await tx.ingredient.findUnique({ where: { code: r.ingredientCode } });
              if (!ingredient) {
                fail(`ไม่พบวัตถุดิบรหัส "${r.ingredientCode}"`);
                continue;
              }
              const qty = toNum(r.qty);
              if (qty === null || qty <= 0) {
                fail(`ปริมาณไม่ถูกต้อง: "${r.qty}"`);
                continue;
              }
              let unitId = ingredient.stockUnitId;
              if (r.unit) {
                const u = await tx.unit.findUnique({ where: { code: r.unit } });
                if (!u) {
                  fail(`ไม่พบหน่วย "${r.unit}"`);
                  continue;
                }
                unitId = u.id;
              }
              let template = await tx.bomTemplate.findFirst({
                where: { menuId: menu.id, isCurrent: true },
              });
              if (!template) {
                template = await tx.bomTemplate.create({ data: { menuId: menu.id, version: 1 } });
              }
              const item = await tx.bomTemplateItem.findFirst({
                where: { templateId: template.id, ingredientId: ingredient.id },
              });
              if (item) {
                await tx.bomTemplateItem.update({ where: { id: item.id }, data: { qty, unitId } });
                bump(report.updated, sheet.label);
              } else {
                await tx.bomTemplateItem.create({
                  data: { templateId: template.id, ingredientId: ingredient.id, qty, unitId },
                });
                bump(report.created, sheet.label);
              }
              break;
            }
          }
        } catch (e) {
          fail(e instanceof Error ? e.message : String(e));
        }
      }
    }
  };

  // Everything in one transaction: a dry run always rolls back, and a real import
  // is all-or-nothing so a bad row can never leave master data half-updated.
  try {
    await db.$transaction(async (tx) => {
      await run(tx as unknown as typeof db);
      if (dryRun || report.issues.length > 0) {
        throw new ROLLBACK();
      }
    });
  } catch (e) {
    if (!(e instanceof ROLLBACK)) throw e;
  }

  return report;
}

/** Parse an uploaded .xlsx and import it. */
export async function importWorkbook(buffer: Buffer, dryRun: boolean): Promise<ImportReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const parsed: ParsedSheets = {};
  for (const sheet of SHEETS) {
    const ws = wb.getWorksheet(sheet.sheetName);
    if (ws) parsed[sheet.key] = readSheet(ws, sheet.columns);
  }
  return applyImport(parsed, dryRun);
}

/**
 * Turn a raw Google Sheets value grid (row 1 = headers) into the same shape the
 * Excel path produces, matching columns by header text.
 */
export function rowsFromGrid(grid: string[][], columns: ColumnSpec[]): SheetRows {
  const header = grid[0] ?? [];
  const colByKey = new Map<string, number>();
  header.forEach((cell, idx) => {
    const text = String(cell ?? "").trim().toLowerCase();
    const spec = columns.find((c) => c.header.toLowerCase() === text || c.key.toLowerCase() === text);
    if (spec && !colByKey.has(spec.key)) colByKey.set(spec.key, idx);
  });

  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  for (let r = 1; r < grid.length; r++) {
    const obj: Record<string, string> = {};
    let any = false;
    for (const [key, idx] of colByKey) {
      const val = String(grid[r]?.[idx] ?? "").trim();
      obj[key] = val;
      if (val) any = true;
    }
    if (any) {
      rows.push(obj);
      rowNumbers.push(r + 1); // 1-based, matching what the user sees in Sheets
    }
  }
  return { rows, rowNumbers };
}

class ROLLBACK extends Error {
  constructor() {
    super("rollback");
  }
}

/** Downloadable starter workbook with the expected sheets, headers and notes. */
export async function buildImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Canteen Management System";

  const guide = wb.addWorksheet("วิธีใช้");
  guide.getColumn(1).width = 100;
  const lines = [
    "แบบฟอร์มนำเข้าข้อมูลหลัก — Canteen Management System",
    "",
    "วิธีใช้",
    "1. กรอกข้อมูลในชีตที่ต้องการ (ชีตไหนไม่ใช้ ลบทิ้งหรือปล่อยว่างไว้ได้)",
    "2. ห้ามแก้ชื่อชีตและห้ามแก้ข้อความหัวตารางแถวที่ 1",
    "3. อัปโหลดไฟล์นี้ที่หน้า Master Data → นำเข้าข้อมูล",
    "4. ติ๊ก 'ตรวจสอบอย่างเดียว' เพื่อดูผลก่อน แล้วค่อยนำเข้าจริง",
    "",
    "ลำดับความสำคัญ — ระบบนำเข้าตามลำดับนี้เสมอ",
    "หน่วยนับ → หมวดหมู่ → ผู้ขาย → สถานที่จัดเก็บ → วัตถุดิบ → เมนู → BOM มาตรฐาน",
    "(เช่น วัตถุดิบอ้างถึงหน่วยนับ จึงต้องมีหน่วยนับก่อน)",
    "",
    "ถ้ารหัสซ้ำกับที่มีอยู่แล้ว ระบบจะ 'อัปเดต' ข้อมูลเดิม ไม่สร้างซ้ำ",
    "หากมีแถวใดผิดพลาด ระบบจะไม่บันทึกทั้งไฟล์ (ทั้งหมดหรือไม่ทำเลย) เพื่อกันข้อมูลค้างครึ่งทาง",
  ];
  lines.forEach((t, i) => {
    const cell = guide.getCell(i + 1, 1);
    cell.value = t;
    if (i === 0) cell.font = { bold: true, size: 14 };
    if (t.startsWith("วิธีใช้") || t.startsWith("ลำดับ")) cell.font = { bold: true };
  });

  for (const sheet of SHEETS) {
    const ws = wb.addWorksheet(sheet.sheetName);
    sheet.columns.forEach((c, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = c.header;
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: c.required ? "FFFFE0E0" : "FFE8EEF4" },
      };
      cell.border = { bottom: { style: "thin" } };
      if (c.note || c.required) {
        cell.note = `${c.required ? "จำเป็นต้องกรอก\n" : ""}${c.note ?? ""}`.trim();
      }
      ws.getColumn(i + 1).width = Math.max(16, c.header.length + 6);
      // Hint row (grey) so the user can see the expected shape, then delete it.
      const hint = ws.getCell(2, i + 1);
      hint.value = c.note ?? (c.required ? "(จำเป็น)" : "");
      hint.font = { italic: true, color: { argb: "FF999999" }, size: 9 };
    });
    ws.getCell(3, 1).value = "";
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
