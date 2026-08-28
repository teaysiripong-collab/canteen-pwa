import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/database/client";
import { todayIso } from "@/lib/date";
import { isUniqueViolation } from "@/lib/errors";
import { getSetting } from "./settings-service";

export type DocumentKind =
  | "goodsReceipt"
  | "stockIssue"
  | "stockTransfer"
  | "purchaseOrder"
  | "stockCount";

const TABLE_BY_KIND: Record<DocumentKind, { table: string; column: string }> = {
  goodsReceipt: { table: "goods_receipts", column: "receipt_number" },
  stockIssue: { table: "stock_issues", column: "issue_number" },
  stockTransfer: { table: "stock_transfers", column: "transfer_number" },
  purchaseOrder: { table: "purchase_orders", column: "po_number" },
  stockCount: { table: "stock_count_sessions", column: "count_number" },
};

/**
 * Builds the next document number for the day, e.g. `GR-20260813-004`.
 *
 * The number is derived from what is already stored rather than from a counter table,
 * and every document table has a unique index on (organization, number). Two people
 * submitting at the same moment can therefore both compute `-004`; the loser hits the
 * unique violation and the caller retries, which is what `withDocumentNumber` does.
 *
 * Prefixes come from `app_settings.document_prefixes`, so a site can rename them.
 */
export async function nextDocumentNumber(
  executor: DbExecutor,
  organizationId: string,
  kind: DocumentKind,
  today = todayIso(),
): Promise<string> {
  const prefixes = await getSetting(organizationId, "document_prefixes");
  const prefix = prefixes[kind];
  const datePart = today.replaceAll("-", "");
  const { table, column } = TABLE_BY_KIND[kind];
  const like = `${prefix}-${datePart}-%`;

  // The identifiers come from the closed map above, never from user input.
  const result = await executor.execute<{ last: string | null }>(
    sql`select max(${sql.raw(column)}) as last
        from ${sql.raw(table)}
        where organization_id = ${organizationId}
          and ${sql.raw(column)} like ${like}`,
  );

  const rows = result as unknown as Array<{ last: string | null }>;
  const last = rows[0]?.last ?? null;
  const sequence = last ? Number(last.slice(last.lastIndexOf("-") + 1)) + 1 : 1;

  return `${prefix}-${datePart}-${String(sequence).padStart(3, "0")}`;
}

/**
 * Retries a whole transaction when two submissions raced for the same document number.
 *
 * The retry has to wrap the transaction, not sit inside it: once a statement fails in
 * Postgres the transaction is aborted and every later statement fails too, so retrying
 * in place would only produce more errors.
 */
export async function retryOnDuplicateNumber<T>(
  attempt: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;

  for (let tries = 0; tries < maxAttempts; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isUniqueViolation(error) || !isDocumentNumberConflict(error)) throw error;
      lastError = error;
    }
  }

  throw lastError;
}

/** Only a clash on the document-number index is worth retrying; anything else is a real error. */
function isDocumentNumberConflict(error: unknown): boolean {
  const constraint =
    typeof error === "object" && error !== null && "constraint_name" in error
      ? String((error as { constraint_name?: unknown }).constraint_name)
      : "";
  return constraint.endsWith("_number_key");
}
