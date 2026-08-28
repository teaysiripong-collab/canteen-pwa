import { db } from "@/database/client";
import { requirePermission } from "@/lib/auth/session";
import { toCsvTable, type CsvColumn } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { WASTE_REASON_LABELS_TH } from "@/lib/inventory/transaction-types";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { writeAuditLog } from "./audit-service";

/**
 * Reports and their export.
 *
 * Each report declares the permission it needs and builds its own rows from the same services
 * the screens use — an export that ran its own queries could quietly disagree with the page it
 * was downloaded from, and a figure in a spreadsheet is exactly where nobody would notice.
 *
 * Exporting is audited separately from viewing, because data leaving the building is a
 * different event from someone looking at it on screen.
 */

export type ReportKey =
  | "stock_on_hand"
  | "stock_movements"
  | "daily_cost"
  | "waste"
  | "price_history";

export type ReportDefinition = {
  key: ReportKey;
  titleTh: string;
  descriptionTh: string;
  permission: PermissionCode;
  /** True when the report reads a date window rather than a point in time. */
  ranged: boolean;
};

export const REPORTS: ReportDefinition[] = [
  {
    key: "stock_on_hand",
    titleTh: "สต๊อกคงเหลือ",
    descriptionTh: "ยอดคงเหลือแยกตามวัตถุดิบ ลอต และสถานที่ ณ ตอนนี้",
    permission: PERMISSIONS.STOCK_VIEW,
    ranged: false,
  },
  {
    key: "stock_movements",
    titleTh: "บัญชีเคลื่อนไหว",
    descriptionTh: "ทุกการรับ เบิก โอน ปรับปรุง และของเสียในช่วงที่เลือก",
    permission: PERMISSIONS.STOCK_VIEW,
    ranged: true,
  },
  {
    key: "daily_cost",
    titleTh: "ต้นทุนรายวัน",
    descriptionTh: "ต้นทุนที่ใช้ไปจริงต่อวัน แยกเบิกใช้กับของเสีย",
    permission: PERMISSIONS.COST_VIEW,
    ranged: true,
  },
  {
    key: "waste",
    titleTh: "ของเสีย",
    descriptionTh: "รายการที่ตัดออกพร้อมสาเหตุและมูลค่า",
    permission: PERMISSIONS.STOCK_VIEW,
    ranged: true,
  },
  {
    key: "price_history",
    titleTh: "ประวัติราคาซื้อ",
    descriptionTh: "ราคาต่อหน่วยของทุกลอตที่รับเข้ามา",
    permission: PERMISSIONS.COST_VIEW,
    ranged: true,
  },
];

export const REPORTS_BY_KEY = new Map(REPORTS.map((report) => [report.key, report]));

export function reportsForUser(permissions: readonly string[]): ReportDefinition[] {
  return REPORTS.filter((report) => permissions.includes(report.permission));
}

export type ReportExport = { filenamePrefix: string; csv: string; rowCount: number };

/**
 * A report flattened to header + text rows.
 *
 * CSV and the Google Sheets export both read this, so a column can never mean one thing in a
 * download and another thing in the shared spreadsheet.
 */
export type ReportTable = { filenamePrefix: string; headers: string[]; rows: string[][] };

function cellText(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function tabulate<T>(
  filenamePrefix: string,
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
): ReportTable {
  return {
    filenamePrefix,
    headers: columns.map((column) => column.header),
    rows: rows.map((row) => columns.map((column) => cellText(column.value(row)))),
  };
}

/**
 * Builds one report as CSV.
 *
 * Requires `report.export` *in addition to* the report's own permission — being allowed to
 * look at costs on screen and being allowed to walk out with the whole table are different
 * decisions, and only the second one is hard to take back.
 */
export async function exportReport(
  key: ReportKey,
  input: { fromDate: string; toDate: string; locationId?: string },
): Promise<ReportExport> {
  const definition = REPORTS_BY_KEY.get(key);
  if (!definition) throw new AppError("NOT_FOUND", "ไม่พบรายงานที่เลือก");

  const user = await requirePermission([PERMISSIONS.REPORT_EXPORT, definition.permission]);

  const table = await buildReportTable(key, user.organizationId, input);

  await writeAuditLog(db, {
    organizationId: user.organizationId,
    userId: user.id,
    action: "EXPORT",
    entityType: "report",
    entityId: user.organizationId,
    afterData: { report: key, rows: table.rows.length, from: input.fromDate, to: input.toDate },
  });

  return {
    filenamePrefix: table.filenamePrefix,
    csv: toCsvTable(table.headers, table.rows),
    rowCount: table.rows.length,
  };
}

export async function buildReportTable(
  key: ReportKey,
  organizationId: string,
  input: { fromDate: string; toDate: string; locationId?: string },
): Promise<ReportTable> {
  switch (key) {
    case "stock_on_hand": {
      const { listStockBalances } = await import("@/repositories/inventory-repository");
      const rows = await listStockBalances(organizationId, {
        onlyInStock: true,
        locationId: input.locationId,
      });

      const columns: CsvColumn<(typeof rows)[number]>[] = [
        { header: "รหัสวัตถุดิบ", value: (row) => row.itemCode },
        { header: "ชื่อวัตถุดิบ", value: (row) => row.itemNameTh },
        { header: "สถานที่", value: (row) => row.locationCode },
        { header: "คงเหลือ", value: (row) => row.baseQty },
        { header: "หน่วย", value: (row) => row.baseUnitCode },
        { header: "จุดสั่งซื้อ", value: (row) => row.reorderPoint },
      ];

      return tabulate("stock_on_hand", rows, columns);
    }

    case "stock_movements": {
      const { listStockMovements } = await import("@/repositories/inventory-repository");
      const page = await listStockMovements(organizationId, {
        fromDate: input.fromDate,
        toDate: input.toDate,
        locationId: input.locationId,
        pageSize: 5000,
      });
      const rows = page.rows;

      const columns: CsvColumn<(typeof rows)[number]>[] = [
        { header: "วันเวลา", value: (row) => row.transactionAt.toISOString() },
        { header: "ประเภท", value: (row) => row.transactionType },
        { header: "ทิศทาง", value: (row) => row.direction },
        { header: "วัตถุดิบ", value: (row) => row.itemNameTh },
        { header: "ลอต", value: (row) => row.lotNumber },
        { header: "สถานที่", value: (row) => row.locationCode },
        { header: "จำนวน", value: (row) => row.baseQty },
        { header: "หน่วย", value: (row) => row.baseUnitCode },
        { header: "เอกสารอ้างอิง", value: (row) => row.referenceNumber },
        { header: "ผู้ทำรายการ", value: (row) => row.userName },
        { header: "หมายเหตุ", value: (row) => row.note },
      ];

      return tabulate("stock_movements", rows, columns);
    }

    case "daily_cost": {
      const { getDailyCosts } = await import("./costing-service");
      const rows = await getDailyCosts(organizationId, input);

      const columns: CsvColumn<(typeof rows)[number]>[] = [
        { header: "วันที่", value: (row) => row.costDate },
        { header: "ต้นทุนเบิกใช้", value: (row) => row.issueCost },
        { header: "ต้นทุนของเสีย", value: (row) => row.wasteCost },
        { header: "รวม", value: (row) => row.totalCost },
      ];

      return tabulate("daily_cost", rows, columns);
    }

    case "waste": {
      const { listWasteHistory } = await import("./waste-service");
      const rows = await listWasteHistory(organizationId, input);

      const columns: CsvColumn<(typeof rows)[number]>[] = [
        { header: "วันเวลา", value: (row) => row.transactionAt.toISOString() },
        { header: "วัตถุดิบ", value: (row) => row.itemNameTh },
        { header: "ลอต", value: (row) => row.lotNumber },
        { header: "สถานที่", value: (row) => row.locationCode },
        { header: "จำนวน", value: (row) => row.baseQty },
        { header: "หน่วย", value: (row) => row.unitCode },
        { header: "มูลค่า", value: (row) => row.value },
        {
          header: "สาเหตุ",
          value: (row) => (row.reason ? WASTE_REASON_LABELS_TH[row.reason] : ""),
        },
        { header: "ผู้บันทึก", value: (row) => row.userName },
        { header: "หมายเหตุ", value: (row) => row.note },
      ];

      return tabulate("waste", rows, columns);
    }

    case "price_history": {
      const { getPriceHistory } = await import("./costing-service");
      const rows = await getPriceHistory(organizationId, {
        fromDate: input.fromDate,
        toDate: input.toDate,
        limit: 5000,
      });

      const columns: CsvColumn<(typeof rows)[number]>[] = [
        { header: "วันที่รับ", value: (row) => row.receivedDate },
        { header: "รหัสวัตถุดิบ", value: (row) => row.itemCode },
        { header: "ชื่อวัตถุดิบ", value: (row) => row.itemNameTh },
        { header: "ลอต", value: (row) => row.lotNumber },
        { header: "จำนวนที่รับ", value: (row) => row.baseQty },
        { header: "ราคาต่อหน่วย", value: (row) => row.unitCost },
      ];

      return tabulate("price_history", rows, columns);
    }
  }
}

export type ReportPreview = { key: ReportKey; rowCount: number; sampleTh: string | null };

/** A row count and one example line, so the screen can say what a download would contain. */
export async function previewReport(
  key: ReportKey,
  input: { fromDate: string; toDate: string; locationId?: string },
): Promise<ReportPreview> {
  const definition = REPORTS_BY_KEY.get(key);
  if (!definition) throw new AppError("NOT_FOUND", "ไม่พบรายงานที่เลือก");

  const user = await requirePermission(definition.permission);
  const table = await buildReportTable(key, user.organizationId, input);

  const first = table.rows[0];

  return {
    key,
    rowCount: table.rows.length,
    // Enough of the first row to recognise the data, not enough to be a download.
    sampleTh: first ? first.slice(0, 4).filter((cell) => cell !== "").join(" · ") : null,
  };
}

/** Formatted for the screen, where a raw scaled number would be unreadable. */
export function formatReportQty(value: string): string {
  return formatQty(value);
}
