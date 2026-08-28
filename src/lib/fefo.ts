import { addQty, compareQty, subQty, toNumericString, type Numeric } from "./quantity";

export type AllocatableLot = {
  lotId: string;
  /** ISO date (YYYY-MM-DD) or null for lots without an expiry date. */
  expiryDate: string | null;
  /** ISO date used as the tie-breaker so the oldest delivery leaves first. */
  receivedDate: string;
  availableBaseQty: string;
  unitCost: string;
};

export type Allocation = {
  lotId: string;
  baseQty: string;
  unitCost: string;
};

export type AllocationResult = {
  allocations: Allocation[];
  /** Zero when the request was fully covered. */
  shortfallBaseQty: string;
  availableBaseQty: string;
};

/**
 * FEFO ordering: earliest expiry first, lots without an expiry date last,
 * then oldest received date, then lot id so the order is deterministic.
 */
export function sortLotsByFefo<T extends AllocatableLot>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiryDate !== b.expiryDate) {
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    }
    if (a.receivedDate !== b.receivedDate) {
      return a.receivedDate < b.receivedDate ? -1 : 1;
    }
    return a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0;
  });
}

/**
 * Suggests which lots to consume for a requested quantity.
 * Never allocates more than a lot holds and never returns negative quantities;
 * an uncoverable request comes back as a shortfall for the caller to reject.
 */
export function allocateFefo(
  requestedBaseQty: Numeric,
  lots: readonly AllocatableLot[],
): AllocationResult {
  const available = lots.reduce<string>(
    (total, lot) => addQty(total, lot.availableBaseQty),
    "0",
  );

  if (compareQty(requestedBaseQty, "0") <= 0) {
    return {
      allocations: [],
      shortfallBaseQty: "0.0000",
      availableBaseQty: available,
    };
  }

  let remaining = toNumericString(requestedBaseQty);
  const allocations: Allocation[] = [];

  for (const lot of sortLotsByFefo(lots)) {
    if (compareQty(remaining, "0") <= 0) break;
    if (compareQty(lot.availableBaseQty, "0") <= 0) continue;

    const take = compareQty(lot.availableBaseQty, remaining) <= 0 ? lot.availableBaseQty : remaining;
    allocations.push({
      lotId: lot.lotId,
      baseQty: toNumericString(take),
      unitCost: lot.unitCost,
    });
    remaining = subQty(remaining, take);
  }

  return {
    allocations,
    shortfallBaseQty: compareQty(remaining, "0") > 0 ? remaining : "0.0000",
    availableBaseQty: available,
  };
}

export type ExpiryBucket = "EXPIRED" | "TODAY" | "SOON" | "OK";

/** Buckets a lot for the expiry alerts; `warningDays` comes from settings, never hardcoded. */
export function bucketExpiry(
  expiryDate: string | null,
  today: string,
  warningDays: number,
): ExpiryBucket {
  if (expiryDate === null) return "OK";
  if (expiryDate < today) return "EXPIRED";
  if (expiryDate === today) return "TODAY";

  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + warningDays);
  return expiryDate <= limit.toISOString().slice(0, 10) ? "SOON" : "OK";
}
