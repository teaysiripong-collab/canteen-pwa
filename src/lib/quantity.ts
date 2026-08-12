/**
 * Quantities and money are stored as numeric(18,4) and come back from Postgres as strings.
 * All arithmetic here runs on integers scaled by 10^4 so repeated additions of values like
 * 0.1 kg cannot drift the way binary floating point does.
 */

export const QUANTITY_SCALE = 4;
const SCALE_FACTOR = 10 ** QUANTITY_SCALE;

export type Numeric = string | number;

export function toScaled(value: Numeric): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${String(value)}`);
  }
  return Math.round(parsed * SCALE_FACTOR);
}

export function fromScaled(scaled: number): string {
  return (scaled / SCALE_FACTOR).toFixed(QUANTITY_SCALE);
}

/** Normalises any numeric input to the canonical string form stored in the database. */
export function toNumericString(value: Numeric): string {
  return fromScaled(toScaled(value));
}

export function addQty(a: Numeric, b: Numeric): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subQty(a: Numeric, b: Numeric): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function mulQty(a: Numeric, b: Numeric): string {
  return fromScaled(Math.round((toScaled(a) * toScaled(b)) / SCALE_FACTOR));
}

export function divQty(a: Numeric, b: Numeric): string {
  const divisor = toScaled(b);
  if (divisor === 0) {
    throw new Error("Division by zero");
  }
  return fromScaled(Math.round((toScaled(a) * SCALE_FACTOR) / divisor));
}

export function sumQty(values: Numeric[]): string {
  return fromScaled(values.reduce<number>((total, value) => total + toScaled(value), 0));
}

/** -1 when a < b, 0 when equal, 1 when a > b. */
export function compareQty(a: Numeric, b: Numeric): -1 | 0 | 1 {
  const left = toScaled(a);
  const right = toScaled(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function isZero(value: Numeric): boolean {
  return toScaled(value) === 0;
}

export function isPositive(value: Numeric): boolean {
  return toScaled(value) > 0;
}

export function toNumber(value: Numeric): number {
  return toScaled(value) / SCALE_FACTOR;
}

/** Display helper: trims trailing zeros so 12.0000 reads as "12" and 0.5000 as "0.5". */
export function formatQty(value: Numeric, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat("th-TH", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(toNumber(value));
}

export function formatMoney(value: Numeric): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}
