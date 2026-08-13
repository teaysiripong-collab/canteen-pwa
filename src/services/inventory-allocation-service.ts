import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/database/client";
import { inventoryLots, stockBalances } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { todayIso } from "@/lib/date";
import { AppError } from "@/lib/errors";
import { allocateFefo, sortLotsByFefo, type AllocatableLot } from "@/lib/fefo";
import type { MovementLine } from "@/services/inventory-ledger-service";
import type { DirectionalTransactionType } from "@/lib/inventory/transaction-types";
import { PERMISSIONS } from "@/lib/permissions";
import { addQty, compareQty, formatQty, toNumericString, type Numeric } from "@/lib/quantity";

export type UsableLot = AllocatableLot & {
  lotNumber: string;
  isExpired: boolean;
};

export type AllocationPlanLine = {
  lotId: string;
  lotNumber: string;
  expiryDate: string | null;
  baseQty: string;
  unitCost: string;
};

export type AllocationPlan = {
  itemId: string;
  locationId: string;
  requestedBaseQty: string;
  lines: AllocationPlanLine[];
  /** Zero when the request is fully covered by usable stock. */
  shortfallBaseQty: string;
  /** On hand and safe to issue. */
  usableBaseQty: string;
  /** On hand but past its expiry date, so it is deliberately left out of the plan. */
  expiredBaseQty: string;
  /** True when the caller picked lots by hand and that differs from the FEFO order. */
  overridesFefo: boolean;
};

/**
 * Everything on hand for one item at one location, newest information first from the
 * ledger's point of view: quantities come from `stock_balances`, dates from the lot.
 */
export async function listUsableLots(
  organizationId: string,
  itemId: string,
  locationId: string,
  today = todayIso(),
): Promise<UsableLot[]> {
  const rows = await db
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      expiryDate: inventoryLots.expiryDate,
      receivedDate: inventoryLots.receivedDate,
      availableBaseQty: stockBalances.baseQty,
      unitCost: inventoryLots.unitCost,
    })
    .from(stockBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockBalances.lotId))
    .where(
      and(
        eq(stockBalances.organizationId, organizationId),
        eq(stockBalances.itemId, itemId),
        eq(stockBalances.locationId, locationId),
        gt(stockBalances.baseQty, "0"),
        eq(inventoryLots.isActive, true),
      ),
    )
    .orderBy(sql`${inventoryLots.expiryDate} asc nulls last`, asc(inventoryLots.receivedDate));

  return rows.map((row) => ({
    ...row,
    isExpired: row.expiryDate !== null && row.expiryDate < today,
  }));
}

function summarise(lots: UsableLot[]) {
  return lots.reduce(
    (totals, lot) => ({
      usable: lot.isExpired ? totals.usable : addQty(totals.usable, lot.availableBaseQty),
      expired: lot.isExpired ? addQty(totals.expired, lot.availableBaseQty) : totals.expired,
    }),
    { usable: "0", expired: "0" },
  );
}

/**
 * Suggests which lots to take, earliest expiry first.
 *
 * Stock that is already past its expiry date is **not** offered: in a canteen it must be
 * written off as waste, not cooked. It is reported separately as `expiredBaseQty` so the
 * screen can tell the user why the number on the shelf and the number here differ.
 */
export async function planFefoAllocation(input: {
  organizationId: string;
  itemId: string;
  locationId: string;
  baseQty: Numeric;
  today?: string;
}): Promise<AllocationPlan> {
  await requirePermission(PERMISSIONS.STOCK_VIEW);

  const today = input.today ?? todayIso();
  const lots = await listUsableLots(input.organizationId, input.itemId, input.locationId, today);
  const totals = summarise(lots);

  const allocatable = lots.filter((lot) => !lot.isExpired);
  const result = allocateFefo(input.baseQty, allocatable);
  const byId = new Map(lots.map((lot) => [lot.lotId, lot]));

  return {
    itemId: input.itemId,
    locationId: input.locationId,
    requestedBaseQty: toNumericString(input.baseQty),
    lines: result.allocations.map((allocation) => ({
      lotId: allocation.lotId,
      lotNumber: byId.get(allocation.lotId)?.lotNumber ?? "",
      expiryDate: byId.get(allocation.lotId)?.expiryDate ?? null,
      baseQty: allocation.baseQty,
      unitCost: allocation.unitCost,
    })),
    shortfallBaseQty: result.shortfallBaseQty,
    usableBaseQty: toNumericString(totals.usable),
    expiredBaseQty: toNumericString(totals.expired),
    overridesFefo: false,
  };
}

/**
 * The same plan, but with lots the user chose by hand. Requires `fefo.override`, and the
 * returned plan is flagged when the choice deviates from what FEFO would have suggested
 * so the posting can record it in the audit trail.
 */
export async function planManualAllocation(input: {
  organizationId: string;
  itemId: string;
  locationId: string;
  picks: Array<{ lotId: string; baseQty: Numeric }>;
  today?: string;
}): Promise<AllocationPlan> {
  await requirePermission(PERMISSIONS.FEFO_OVERRIDE);

  if (input.picks.length === 0) {
    throw new AppError("VALIDATION", "กรุณาเลือกลอตอย่างน้อย 1 ลอต");
  }

  const today = input.today ?? todayIso();
  const lots = await listUsableLots(input.organizationId, input.itemId, input.locationId, today);
  const byId = new Map(lots.map((lot) => [lot.lotId, lot]));
  const totals = summarise(lots);

  let requested = "0";
  const lines: AllocationPlanLine[] = [];

  for (const pick of input.picks) {
    const lot = byId.get(pick.lotId);
    if (!lot) throw new AppError("NOT_FOUND", "ไม่พบลอตที่เลือกในสถานที่นี้");

    if (compareQty(pick.baseQty, "0") <= 0) {
      throw new AppError("VALIDATION", "จำนวนต้องมากกว่า 0");
    }

    if (compareQty(pick.baseQty, lot.availableBaseQty) > 0) {
      throw new AppError(
        "INSUFFICIENT_STOCK",
        `ลอต ${lot.lotNumber} คงเหลือ ${formatQty(lot.availableBaseQty)} ไม่พอสำหรับ ${formatQty(pick.baseQty)}`,
      );
    }

    requested = addQty(requested, pick.baseQty);
    lines.push({
      lotId: lot.lotId,
      lotNumber: lot.lotNumber,
      expiryDate: lot.expiryDate,
      baseQty: toNumericString(pick.baseQty),
      unitCost: lot.unitCost,
    });
  }

  return {
    itemId: input.itemId,
    locationId: input.locationId,
    requestedBaseQty: requested,
    lines,
    shortfallBaseQty: "0.0000",
    usableBaseQty: toNumericString(totals.usable),
    expiredBaseQty: toNumericString(totals.expired),
    overridesFefo: deviatesFromFefo(lines, lots),
  };
}

/**
 * A manual pick counts as an override when it skips a lot that FEFO would have consumed
 * first — picking the same lots FEFO would have picked is not an override.
 */
export function deviatesFromFefo(
  lines: Array<{ lotId: string; baseQty: string }>,
  lots: UsableLot[],
): boolean {
  const requested = lines.reduce<string>((total, line) => addQty(total, line.baseQty), "0");
  const expected = allocateFefo(
    requested,
    lots.filter((lot) => !lot.isExpired),
  );

  const expectedById = new Map(expected.allocations.map((a) => [a.lotId, a.baseQty]));
  if (expectedById.size !== lines.length) return true;

  return lines.some((line) => {
    const match = expectedById.get(line.lotId);
    return match === undefined || compareQty(match, line.baseQty) !== 0;
  });
}

/** Turns a plan into the lines `postMovement` consumes. */
export function toMovementLines(
  plan: AllocationPlan,
  type: DirectionalTransactionType,
  locationId = plan.locationId,
): MovementLine[] {
  return plan.lines.map((line) => ({
    type,
    itemId: plan.itemId,
    lotId: line.lotId,
    locationId,
    baseQty: line.baseQty,
    unitCost: line.unitCost,
  }));
}

/** Lots ordered the way FEFO would consume them — used by the pickers in later phases. */
export function fefoOrder(lots: UsableLot[]): UsableLot[] {
  return sortLotsByFefo(lots);
}
