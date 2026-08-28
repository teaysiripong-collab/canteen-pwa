import { addDays } from "@/lib/date";
import {
  compareQty,
  divQty,
  mulQty,
  subQty,
  toNumericString,
  type Numeric,
} from "@/lib/quantity";

/**
 * A supplier does not sell 3.4 trays of eggs. Everything here rounds *up*: buying slightly
 * more than the shortfall leaves stock in the store, while buying slightly less means the
 * kitchen runs out mid-service, which is the failure that actually costs something.
 */

export type OrderRules = {
  /** Minimum the supplier will accept, in the purchase unit. Zero means no minimum. */
  moq?: Numeric | null;
  /** Sold in multiples of this, in the purchase unit. Null means any quantity. */
  packSize?: Numeric | null;
};

/** Smallest multiple of `packSize` that is at least `qty`. */
export function roundUpToPack(qty: Numeric, packSize?: Numeric | null): string {
  const quantity = toNumericString(qty);
  if (packSize === undefined || packSize === null) return quantity;

  const pack = toNumericString(packSize);
  if (compareQty(pack, "0") <= 0) return quantity;

  const packs = Math.ceil(Number(divQty(quantity, pack)));
  return mulQty(packs, pack);
}

/** Applies the minimum first, then the pack multiple, so both hold at once. */
export function applyOrderRules(qty: Numeric, rules: OrderRules): string {
  const quantity = toNumericString(qty);
  if (compareQty(quantity, "0") <= 0) return "0.0000";

  const moq = rules.moq === undefined || rules.moq === null ? "0" : toNumericString(rules.moq);
  const atLeastMinimum = compareQty(quantity, moq) < 0 ? moq : quantity;

  return roundUpToPack(atLeastMinimum, rules.packSize);
}

export type OrderSuggestion = {
  /** How much to write on the purchase order, in the supplier's purchase unit. */
  purchaseQty: string;
  /** What that works out to in stock units. */
  orderedBaseQty: string;
  /** How much more than the shortfall the rules forced; zero when the fit was exact. */
  surplusBaseQty: string;
};

/**
 * Turns a shortfall in stock units into a quantity a supplier will actually accept.
 * The surplus is reported rather than hidden — a 2 kg need that becomes a 25 kg sack is
 * something the buyer should see before approving, not discover at the loading bay.
 */
export function suggestOrderQuantity(input: {
  shortfallBaseQty: Numeric;
  conversionToBase: Numeric;
  rules?: OrderRules;
}): OrderSuggestion {
  const shortfall = toNumericString(input.shortfallBaseQty);
  const conversion = toNumericString(input.conversionToBase);

  if (compareQty(shortfall, "0") <= 0 || compareQty(conversion, "0") <= 0) {
    return { purchaseQty: "0.0000", orderedBaseQty: "0.0000", surplusBaseQty: "0.0000" };
  }

  const purchaseQty = applyOrderRules(divQty(shortfall, conversion), input.rules ?? {});
  const orderedBaseQty = mulQty(purchaseQty, conversion);
  const surplus = subQty(orderedBaseQty, shortfall);

  return {
    purchaseQty,
    orderedBaseQty,
    surplusBaseQty: compareQty(surplus, "0") > 0 ? surplus : "0.0000",
  };
}

/**
 * The last day an order can be placed and still arrive in time. A date already in the past
 * means the window has closed — the planner says so rather than printing a date that quietly
 * cannot be met.
 */
export function orderByDate(neededDate: string, leadTimeDays: number): string {
  return addDays(neededDate, -Math.max(0, leadTimeDays));
}
