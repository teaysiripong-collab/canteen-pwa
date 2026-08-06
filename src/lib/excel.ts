import ExcelJS from "exceljs";
import { db } from "./db";

export type MappingField = {
  field: string;   // system field key
  column: string;  // Excel column letter, e.g. "B"
  label: string;   // header text written into the template
  formula?: string; // optional Excel formula pattern, e.g. "E*G" -> =E2*G2
};

export const AVAILABLE_FIELDS: { key: string; label: string; source: string }[] = [
  { key: "date", label: "วันที่", source: "Menu Plan" },
  { key: "shift", label: "รอบ (เช้า/ดึก)", source: "Menu Plan" },
  { key: "menuName", label: "ชื่อเมนู", source: "Menu Master" },
  { key: "ingredientCode", label: "รหัสวัตถุดิบ", source: "Ingredient Master" },
  { key: "ingredientName", label: "ชื่อวัตถุดิบ", source: "Ingredient Master" },
  { key: "qty", label: "ปริมาณตาม BOM", source: "BOM" },
  { key: "unit", label: "หน่วย", source: "Unit Master" },
  { key: "vendor", label: "Vendor หลัก", source: "Vendor Master" },
  { key: "price", label: "ราคา/หน่วย (จัดซื้อกรอก)", source: "Procurement Input" },
  { key: "amount", label: "รวมเงิน (สูตร Excel)", source: "คำนวณใน Excel" },
];

export function parseMapping(json: string): MappingField[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Column letter -> 1-based index ("A"->1, "AB"->28) */
export function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) {
    if (ch < "A" || ch > "Z") continue;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n || 1;
}

type CostRow = {
  date: string; shift: string; menuName: string;
  ingredientCode: string; ingredientName: string;
  qty: number; unit: string; vendor: string; price: number | null;
};

/** Pull Menu + BOM rows for a period — the data that used to be copy-pasted into Excel by hand. */
export async function buildCostRows(from: Date, to: Date): Promise<CostRow[]> {
  const lines = await db.bomLine.findMany({
    where: { planEntry: { date: { gte: from, lte: to } } },
    include: {
      unit: true,
      ingredient: { include: { defaultVendor: true } },
      planEntry: { include: { menu: true } },
    },
    orderBy: [{ planEntry: { date: "asc" } }],
  });
  return lines.map((l) => ({
    date: l.planEntry.date.toISOString().slice(0, 10),
    shift: l.planEntry.shift === "MORNING" ? "รอบเช้า" : "รอบดึก",
    menuName: l.planEntry.menu.name,
    ingredientCode: l.ingredient.code,
    ingredientName: l.ingredient.name,
    qty: Number(l.qty),
    unit: l.unit.code,
    vendor: l.ingredient.defaultVendor?.name ?? "",
    price: l.ingredient.lastPrice ? Number(l.ingredient.lastPrice) / Number(l.ingredient.conversionFactor) : null,
  }));
}

/**
 * Write cost rows into the organisation's own column layout.
 * The mapping is data (ExcelTemplate.mappingJson), so changing the template
 * layout is an Admin config change — never a code change.
 */
export async function generateCostWorkbook(opts: {
  templateName: string;
  mapping: MappingField[];
  headerRow: number;
  rows: CostRow[];
  periodLabel: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Canteen Management System";
  const ws = wb.addWorksheet("Cost");

  // Title above the header row
  if (opts.headerRow > 1) {
    ws.getCell(1, 1).value = `${opts.templateName} — ${opts.periodLabel}`;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
  }

  for (const m of opts.mapping) {
    const c = colIndex(m.column);
    const cell = ws.getCell(opts.headerRow, c);
    cell.value = m.label;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF4" } };
    cell.border = { bottom: { style: "thin" } };
    ws.getColumn(c).width = Math.max(12, m.label.length + 4);
  }

  opts.rows.forEach((row, i) => {
    const r = opts.headerRow + 1 + i;
    for (const m of opts.mapping) {
      const c = colIndex(m.column);
      const cell = ws.getCell(r, c);
      if (m.formula) {
        // Rewrite column letters in the pattern to this row: "E*G" -> "=E5*G5"
        cell.value = { formula: m.formula.replace(/([A-Z]+)/g, (mm) => `${mm}${r}`) };
        cell.numFmt = "#,##0.00";
      } else if (m.field === "price") {
        // Left blank on purpose — procurement fills this in, same as the old workflow
        const v = row.price;
        if (v != null) cell.value = Math.round(v * 100) / 100;
        cell.numFmt = "#,##0.00";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E0" } };
      } else if (m.field === "qty") {
        cell.value = row.qty;
        cell.numFmt = "#,##0.00";
      } else {
        cell.value = (row as unknown as Record<string, string | number | null>)[m.field] ?? "";
      }
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
