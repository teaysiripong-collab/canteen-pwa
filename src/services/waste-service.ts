import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/database/client";
import { inventoryLots, inventoryTransactions, items, locations, units, users } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { BUSINESS_TIME_ZONE, todayIso } from "@/lib/date";
import { AppError } from "@/lib/errors";
import { WASTE_REASON_LABELS_TH, type WasteReason } from "@/lib/inventory/transaction-types";
import { PERMISSIONS } from "@/lib/permissions";
import { addQty, compareQty, mulQty, toNumericString } from "@/lib/quantity";
import { postMovement } from "./inventory-ledger-service";

/**
 * Writing stock off.
 *
 * The ledger posting *is* the document — there is no separate waste header table, because a
 * posting already carries who, when, which lots and a reason per line. A second table would
 * be a copy of that with its own opportunity to disagree.
 *
 * Waste is always recorded against a specific lot rather than an item total. Which lot spoiled
 * is the whole point: it is what makes the cost real (that lot's price, not an average) and
 * what lets the expiry alert clear.
 */

export type WasteLineInput = {
  lotId: string;
  baseQty: number | string;
  note?: string | null;
};

export type WasteInput = {
  idempotencyKey: string;
  locationId: string;
  reason: WasteReason;
  note?: string | null;
  lines: WasteLineInput[];
};

export type WasteResult = {
  postingId: string;
  replayed: boolean;
  totalValue: string;
};

export async function recordWaste(input: WasteInput): Promise<WasteResult> {
  const user = await requirePermission(PERMISSIONS.ADJUSTMENT_CREATE);

  if (input.lines.length === 0) {
    throw new AppError("VALIDATION", "กรุณาเลือกลอตที่ต้องการตัดออกอย่างน้อย 1 รายการ");
  }

  for (const line of input.lines) {
    if (compareQty(line.baseQty, "0") <= 0) {
      throw new AppError("VALIDATION", "จำนวนที่ตัดออกต้องมากกว่า 0");
    }
  }

  // Lots are read up front so the cost of the write-off can be reported back to the user.
  const lotIds = input.lines.map((line) => line.lotId);
  const lots = await db
    .select({
      id: inventoryLots.id,
      itemId: inventoryLots.itemId,
      unitCost: inventoryLots.unitCost,
    })
    .from(inventoryLots)
    .where(
      and(eq(inventoryLots.organizationId, user.organizationId), inArray(inventoryLots.id, lotIds)),
    );

  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  let totalValue = "0";

  const movementLines = input.lines.map((line) => {
    const lot = lotById.get(line.lotId);
    if (!lot) throw new AppError("NOT_FOUND", "ไม่พบลอตที่เลือก");

    totalValue = addQty(totalValue, mulQty(line.baseQty, lot.unitCost));

    return {
      type: "WASTE" as const,
      itemId: lot.itemId,
      lotId: line.lotId,
      locationId: input.locationId,
      baseQty: toNumericString(line.baseQty),
      wasteReason: input.reason,
      note: line.note ?? input.note ?? null,
    };
  });

  const posted = await postMovement({
    idempotencyKey: input.idempotencyKey,
    referenceType: "MANUAL_ADJUSTMENT",
    note: `ตัดของเสีย: ${WASTE_REASON_LABELS_TH[input.reason]}${input.note ? ` — ${input.note}` : ""}`,
    lines: movementLines,
  });

  return { postingId: posted.postingId, replayed: posted.replayed, totalValue };
}

export type WastableLot = {
  lotId: string;
  lotNumber: string;
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  unitCode: string | null;
  expiryDate: string | null;
  baseQty: string;
  unitCost: string;
  isExpired: boolean;
};

/**
 * Lots that could be written off at a location, expired ones first — those are the reason
 * someone opened this screen.
 */
export async function listWastableLots(
  organizationId: string,
  locationId: string,
  options: { today?: string; itemQuery?: string } = {},
): Promise<WastableLot[]> {
  await requirePermission(PERMISSIONS.STOCK_VIEW);
  const today = options.today ?? todayIso();

  const { stockBalances } = await import("@/database/schema");
  const filters = [
    eq(stockBalances.organizationId, organizationId),
    eq(stockBalances.locationId, locationId),
    gt(stockBalances.baseQty, "0"),
  ];

  if (options.itemQuery) {
    const search = `%${options.itemQuery}%`;
    filters.push(sql`(${items.nameTh} ilike ${search} or ${items.code} ilike ${search})`);
  }

  const rows = await db
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      itemId: items.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitCode: units.code,
      expiryDate: inventoryLots.expiryDate,
      baseQty: stockBalances.baseQty,
      unitCost: inventoryLots.unitCost,
    })
    .from(stockBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockBalances.lotId))
    .innerJoin(items, eq(items.id, stockBalances.itemId))
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .where(and(...filters))
    .orderBy(asc(inventoryLots.expiryDate), asc(items.code))
    .limit(200);

  return rows.map((row) => ({
    ...row,
    isExpired: row.expiryDate !== null && row.expiryDate < today,
  }));
}

export type WasteHistoryRow = {
  transactionId: string;
  transactionAt: Date;
  itemNameTh: string;
  lotNumber: string;
  locationCode: string;
  baseQty: string;
  unitCode: string | null;
  value: string;
  reason: WasteReason | null;
  userName: string | null;
  note: string | null;
};

/** Every write-off in a window, newest first. Reads the ledger; there is nowhere else to look. */
export async function listWasteHistory(
  organizationId: string,
  input: { fromDate: string; toDate: string; locationId?: string },
): Promise<WasteHistoryRow[]> {
  await requirePermission(PERMISSIONS.STOCK_VIEW);

  const filters = [
    eq(inventoryTransactions.organizationId, organizationId),
    eq(inventoryTransactions.transactionType, "WASTE"),
    sql`${inventoryTransactions.transactionAt} >= (${input.fromDate}::timestamp at time zone ${BUSINESS_TIME_ZONE})`,
    sql`${inventoryTransactions.transactionAt} < ((${input.toDate}::timestamp + interval '1 day') at time zone ${BUSINESS_TIME_ZONE})`,
  ];
  if (input.locationId) filters.push(eq(inventoryTransactions.locationId, input.locationId));

  const rows = await db
    .select({
      transactionId: inventoryTransactions.id,
      transactionAt: inventoryTransactions.transactionAt,
      itemNameTh: items.nameTh,
      lotNumber: inventoryLots.lotNumber,
      locationCode: locations.code,
      baseQty: inventoryTransactions.baseQty,
      unitCode: units.code,
      value: sql<string>`${inventoryTransactions.baseQty} * ${inventoryTransactions.unitCost}`,
      reason: inventoryTransactions.wasteReason,
      userName: users.fullName,
      note: inventoryTransactions.note,
    })
    .from(inventoryTransactions)
    .innerJoin(items, eq(items.id, inventoryTransactions.itemId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryTransactions.lotId))
    .innerJoin(locations, eq(locations.id, inventoryTransactions.locationId))
    .leftJoin(units, eq(units.id, inventoryTransactions.baseUnitId))
    .leftJoin(users, eq(users.id, inventoryTransactions.userId))
    .where(and(...filters))
    .orderBy(desc(inventoryTransactions.transactionAt))
    .limit(200);

  return rows as WasteHistoryRow[];
}

export type WasteByReason = { reason: WasteReason; labelTh: string; value: string; baseQty: string };

/** What the waste cost, split by cause — the point of storing the reason as a column. */
export async function getWasteByReason(
  organizationId: string,
  input: { fromDate: string; toDate: string },
): Promise<WasteByReason[]> {
  await requirePermission(PERMISSIONS.COST_VIEW);

  const rows = await db
    .select({
      reason: inventoryTransactions.wasteReason,
      baseQty: sql<string>`sum(${inventoryTransactions.baseQty})`,
      value: sql<string>`sum(${inventoryTransactions.baseQty} * ${inventoryTransactions.unitCost})`,
    })
    .from(inventoryTransactions)
    .where(
      and(
        eq(inventoryTransactions.organizationId, organizationId),
        eq(inventoryTransactions.transactionType, "WASTE"),
        sql`${inventoryTransactions.transactionAt} >= (${input.fromDate}::timestamp at time zone ${BUSINESS_TIME_ZONE})`,
        sql`${inventoryTransactions.transactionAt} < ((${input.toDate}::timestamp + interval '1 day') at time zone ${BUSINESS_TIME_ZONE})`,
      ),
    )
    .groupBy(inventoryTransactions.wasteReason);

  return rows
    .map((row) => {
      const reason = (row.reason ?? "OTHER") as WasteReason;
      return {
        reason,
        labelTh: WASTE_REASON_LABELS_TH[reason],
        value: toNumericString(row.value),
        baseQty: toNumericString(row.baseQty),
      };
    })
    .sort((a, b) => Number(b.value) - Number(a.value));
}
