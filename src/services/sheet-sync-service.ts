import { desc, eq } from "drizzle-orm";
import { db } from "@/database/client";
import { sheetSyncRuns, users } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { defaultSheetsClient, type SheetsClient } from "@/lib/sheets/client";
import { isSheetsConfigured } from "@/lib/sheets/config";
import { writeAuditLog } from "./audit-service";
import { buildReportTable, REPORTS_BY_KEY, type ReportKey } from "./report-service";

/**
 * One-way export to Google Sheets.
 *
 * The direction matters and is not an implementation detail: PostgreSQL is the system of
 * record, and a spreadsheet anyone can edit must never be able to write back into it. Nothing
 * in this module reads from Sheets.
 *
 * The rows come from `buildReportTable`, the same function behind the CSV download, so the tab
 * in the shared spreadsheet and the file on someone's laptop cannot disagree about what a
 * column means.
 *
 * Every attempt leaves a row in `sheet_sync_runs`, including the ones that fail. A sync that
 * silently did nothing is the failure mode that matters here — somebody reads a stale tab for
 * a week and never learns the export stopped running.
 */

export type SyncTarget = (typeof sheetSyncRuns.target.enumValues)[number];

/** Which tab each report writes to. The tab name doubles as the target's Thai-facing label. */
const REPORT_TARGETS: Record<ReportKey, { target: SyncTarget; sheetName: string }> = {
  stock_on_hand: { target: "INVENTORY_BALANCE", sheetName: "Stock On Hand" },
  stock_movements: { target: "STOCK_MOVEMENT", sheetName: "Stock Movements" },
  daily_cost: { target: "DAILY_COST", sheetName: "Daily Cost" },
  waste: { target: "WASTE", sheetName: "Waste" },
  price_history: { target: "PRICE_HISTORY", sheetName: "Price History" },
};

export type SyncResult = {
  runId: string;
  status: "SUCCESS" | "FAILED";
  rowCount: number;
  sheetName: string;
  errorMessage: string | null;
};

export type SyncDeps = { client?: SheetsClient | null };

/**
 * Pushes one report to its tab.
 *
 * Requires `report.export` on top of the report's own permission, for the same reason the CSV
 * download does: a shared spreadsheet is data leaving the building.
 */
export async function syncReportToSheet(
  key: ReportKey,
  input: { fromDate: string; toDate: string; locationId?: string },
  deps: SyncDeps = {},
): Promise<SyncResult> {
  const definition = REPORTS_BY_KEY.get(key);
  if (!definition) throw new AppError("NOT_FOUND", "ไม่พบรายงานที่เลือก");

  const user = await requirePermission([PERMISSIONS.REPORT_EXPORT, definition.permission]);

  // An explicit `client: null` means "pretend there are no credentials" — otherwise the test
  // for that case would pass or fail depending on whose machine it runs on.
  const client = "client" in deps ? deps.client : defaultSheetsClient();
  if (!client) {
    // Refused before any run row is written: nothing was attempted, so there is nothing to
    // record, and an operator seeing "FAILED" would go looking for a bug that isn't there.
    throw new AppError(
      "VALIDATION",
      "ยังไม่ได้ตั้งค่าการเชื่อมต่อ Google Sheets กรุณาตั้งค่า credential ก่อนใช้งาน",
    );
  }

  const { target, sheetName } = REPORT_TARGETS[key];
  const table = await buildReportTable(key, user.organizationId, input);
  const values = [table.headers, ...table.rows];

  const [run] = await db
    .insert(sheetSyncRuns)
    .values({
      organizationId: user.organizationId,
      target,
      status: "PENDING",
      sheetName,
      triggeredBy: user.id,
    })
    .returning();

  const runId = run!.id;

  try {
    const { spreadsheetId } = await client.replaceSheet(sheetName, values);

    await db
      .update(sheetSyncRuns)
      .set({
        status: "SUCCESS",
        spreadsheetId,
        rowCount: String(table.rows.length),
        finishedAt: new Date(),
      })
      .where(eq(sheetSyncRuns.id, runId));

    await writeAuditLog(db, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "EXPORT",
      entityType: "sheet_sync_run",
      entityId: runId,
      afterData: { report: key, target, sheetName, rows: table.rows.length },
    });

    return { runId, status: "SUCCESS", rowCount: table.rows.length, sheetName, errorMessage: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db
      .update(sheetSyncRuns)
      .set({ status: "FAILED", errorMessage, finishedAt: new Date() })
      .where(eq(sheetSyncRuns.id, runId));

    // The run row carries the reason; the caller gets a sentence a canteen manager can act on.
    throw new AppError("INTERNAL", "ส่งข้อมูลไป Google Sheets ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", {
      cause: error,
    });
  }
}

export type SyncRunSummary = {
  id: string;
  target: SyncTarget;
  status: "PENDING" | "SUCCESS" | "FAILED";
  sheetName: string | null;
  rowCount: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  triggeredByName: string | null;
};

/** Recent runs, so the screen can show when a tab was last refreshed and by whom. */
export async function listSyncRuns(
  organizationId: string,
  limit = 10,
): Promise<SyncRunSummary[]> {
  return db
    .select({
      id: sheetSyncRuns.id,
      target: sheetSyncRuns.target,
      status: sheetSyncRuns.status,
      sheetName: sheetSyncRuns.sheetName,
      rowCount: sheetSyncRuns.rowCount,
      errorMessage: sheetSyncRuns.errorMessage,
      startedAt: sheetSyncRuns.startedAt,
      finishedAt: sheetSyncRuns.finishedAt,
      triggeredByName: users.fullName,
    })
    .from(sheetSyncRuns)
    .leftJoin(users, eq(users.id, sheetSyncRuns.triggeredBy))
    .where(eq(sheetSyncRuns.organizationId, organizationId))
    .orderBy(desc(sheetSyncRuns.startedAt))
    .limit(limit);
}

export function sheetsConfigured(): boolean {
  return isSheetsConfigured();
}

export function sheetNameFor(key: ReportKey): string {
  return REPORT_TARGETS[key].sheetName;
}
