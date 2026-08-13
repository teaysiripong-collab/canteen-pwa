import { addQty, compareQty, divQty, mulQty, subQty, toNumericString, type Numeric } from "@/lib/quantity";

export type CostEntry = {
  baseQty: Numeric;
  unitCost: Numeric;
};

/**
 * Weighted average cost per base unit.
 *
 * All arithmetic goes through the scaled-integer helpers in `lib/quantity`, so repeatedly
 * averaging prices like 88.5 and 4.2667 cannot drift the way binary floating point does.
 * An empty or zero-quantity set has no average to report and comes back as zero.
 */
export function weightedAverageCost(entries: readonly CostEntry[]): string {
  let value = "0";
  let quantity = "0";

  for (const entry of entries) {
    if (compareQty(entry.baseQty, "0") <= 0) continue;
    value = addQty(value, mulQty(entry.baseQty, entry.unitCost));
    quantity = addQty(quantity, entry.baseQty);
  }

  return compareQty(quantity, "0") > 0 ? divQty(value, quantity) : "0.0000";
}

/** Total money represented by a set of quantities at their own costs. */
export function totalCostValue(entries: readonly CostEntry[]): string {
  return entries.reduce<string>(
    (total, entry) => addQty(total, mulQty(entry.baseQty, entry.unitCost)),
    "0",
  );
}

export type CostVariance = {
  standardCost: string;
  actualCost: string;
  varianceValue: string;
  /** Percentage over or under standard; null when there is no standard to compare to. */
  variancePercent: number | null;
};

/**
 * Actual minus standard, in money. Derived on read from the two figures, never stored,
 * so it cannot disagree with them.
 */
export function costVariance(standardCost: Numeric, actualCost: Numeric): CostVariance {
  const standard = toNumericString(standardCost);
  const actual = toNumericString(actualCost);
  const variance = subQty(actual, standard);

  return {
    standardCost: standard,
    actualCost: actual,
    varianceValue: variance,
    variancePercent:
      Number(standard) === 0 ? null : (Number(variance) / Number(standard)) * 100,
  };
}
