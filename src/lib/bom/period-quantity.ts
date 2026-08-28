import { addQty, compareQty, toNumericString } from "@/lib/quantity";

/**
 * The kitchen writes a BOM line as "30+20": 30 for the day shift, 20 for the night shift.
 * This turns that shorthand into numbers per meal period, and back again.
 *
 * Values map to meal periods **positionally**, in the order the periods are configured
 * (DAY then NIGHT with the shipped seed). Typing fewer numbers than there are periods
 * leaves the rest at zero — the caller shows a structured preview so the user can see
 * exactly what was understood before saving.
 */

export type ParsedPeriodQuantities = {
  /** One entry per configured meal period, in period order. */
  values: string[];
  total: string;
};

export type PeriodQuantityError =
  | "EMPTY"
  | "NOT_A_NUMBER"
  | "NEGATIVE"
  | "TOO_MANY_PARTS"
  | "ALL_ZERO";

export const PERIOD_QUANTITY_ERROR_MESSAGES_TH: Record<PeriodQuantityError, string> = {
  EMPTY: "กรุณากรอกจำนวน",
  NOT_A_NUMBER: "กรอกได้เฉพาะตัวเลข เช่น 30+20",
  NEGATIVE: "จำนวนต้องไม่ติดลบ",
  TOO_MANY_PARTS: "จำนวนที่กรอกมากกว่าจำนวนมื้อที่ตั้งไว้",
  ALL_ZERO: "ต้องมีอย่างน้อยหนึ่งมื้อที่มากกว่า 0",
};

export type ParseResult =
  | { ok: true; data: ParsedPeriodQuantities }
  | { ok: false; error: PeriodQuantityError };

/**
 * Accepts "30+20", "30 + 20", "2.5+1.5", or a single "30".
 * `periodCount` is however many meal periods the organization has configured.
 */
export function parsePeriodQuantities(input: string, periodCount: number): ParseResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "EMPTY" };

  const parts = trimmed.split("+").map((part) => part.trim());
  if (parts.length > periodCount) return { ok: false, error: "TOO_MANY_PARTS" };

  const values: string[] = [];

  for (const part of parts) {
    // An empty segment ("30+") is a half-typed entry, not a zero.
    if (part === "" || !/^\d*\.?\d+$/.test(part)) {
      return { ok: false, error: part.startsWith("-") ? "NEGATIVE" : "NOT_A_NUMBER" };
    }

    const parsed = Number(part);
    if (!Number.isFinite(parsed)) return { ok: false, error: "NOT_A_NUMBER" };
    if (parsed < 0) return { ok: false, error: "NEGATIVE" };

    values.push(toNumericString(parsed));
  }

  // Periods the user did not type stay at zero.
  while (values.length < periodCount) values.push(toNumericString(0));

  const total = values.reduce<string>((sum, value) => addQty(sum, value), "0");
  if (compareQty(total, "0") <= 0) return { ok: false, error: "ALL_ZERO" };

  return { ok: true, data: { values, total } };
}

/** Renders stored quantities back into the "30+20" shorthand for editing. */
export function formatPeriodQuantities(values: readonly string[]): string {
  const trimmed = [...values];
  // Drop trailing zeros so a day-only line reads "30" rather than "30+0".
  while (trimmed.length > 1 && compareQty(trimmed[trimmed.length - 1]!, "0") === 0) {
    trimmed.pop();
  }
  return trimmed.map((value) => stripTrailingZeros(value)).join("+");
}

function stripTrailingZeros(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/\.?0+$/, "");
}

export function sumPeriodQuantities(values: readonly string[]): string {
  return values.reduce<string>((sum, value) => addQty(sum, value), "0");
}
