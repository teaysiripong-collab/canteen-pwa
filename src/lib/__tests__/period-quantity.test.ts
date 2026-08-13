import { describe, expect, it } from "vitest";
import {
  formatPeriodQuantities,
  parsePeriodQuantities,
  sumPeriodQuantities,
} from "../bom/period-quantity";

describe("30+20 notation", () => {
  it("splits the shorthand the kitchen writes into day and night", () => {
    // Gate 7: ไก่บด 30+20 -> เช้า 30, ดึก 20, รวม 50.
    const result = parsePeriodQuantities("30+20", 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.values).toEqual(["30.0000", "20.0000"]);
    expect(result.data.total).toBe("50.0000");
  });

  it("ignores the spaces people type around the plus", () => {
    const result = parsePeriodQuantities(" 30 + 20 ", 2);
    expect(result.ok && result.data.values).toEqual(["30.0000", "20.0000"]);
  });

  it("treats a single number as the first period only", () => {
    const result = parsePeriodQuantities("30", 2);
    expect(result.ok && result.data.values).toEqual(["30.0000", "0.0000"]);
    expect(result.ok && result.data.total).toBe("30.0000");
  });

  it("handles decimals", () => {
    const result = parsePeriodQuantities("2.5+1.5", 2);
    expect(result.ok && result.data.values).toEqual(["2.5000", "1.5000"]);
    expect(result.ok && result.data.total).toBe("4.0000");
  });

  it("supports a third shift when one is configured", () => {
    const result = parsePeriodQuantities("10+20+5", 3);
    expect(result.ok && result.data.values).toEqual(["10.0000", "20.0000", "5.0000"]);
    expect(result.ok && result.data.total).toBe("35.0000");
  });

  it("allows a zero on one shift as long as something is cooked", () => {
    const result = parsePeriodQuantities("0+20", 2);
    expect(result.ok && result.data.values).toEqual(["0.0000", "20.0000"]);
  });

  it("refuses more numbers than there are meal periods", () => {
    expect(parsePeriodQuantities("10+20+5", 2)).toEqual({ ok: false, error: "TOO_MANY_PARTS" });
  });

  it("refuses a half-typed entry rather than reading it as zero", () => {
    expect(parsePeriodQuantities("30+", 2)).toEqual({ ok: false, error: "NOT_A_NUMBER" });
  });

  it("refuses text and negatives", () => {
    expect(parsePeriodQuantities("สามสิบ", 2)).toEqual({ ok: false, error: "NOT_A_NUMBER" });
    expect(parsePeriodQuantities("30+abc", 2)).toEqual({ ok: false, error: "NOT_A_NUMBER" });
    expect(parsePeriodQuantities("-5+20", 2)).toEqual({ ok: false, error: "NEGATIVE" });
  });

  it("refuses an empty entry and an all-zero line", () => {
    expect(parsePeriodQuantities("", 2)).toEqual({ ok: false, error: "EMPTY" });
    expect(parsePeriodQuantities("   ", 2)).toEqual({ ok: false, error: "EMPTY" });
    expect(parsePeriodQuantities("0+0", 2)).toEqual({ ok: false, error: "ALL_ZERO" });
  });

  it("round-trips back into the shorthand for editing", () => {
    expect(formatPeriodQuantities(["30.0000", "20.0000"])).toBe("30+20");
    expect(formatPeriodQuantities(["2.5000", "1.5000"])).toBe("2.5+1.5");
    // A day-only line reads as plain "30", not "30+0".
    expect(formatPeriodQuantities(["30.0000", "0.0000"])).toBe("30");
    expect(formatPeriodQuantities(["0.0000", "20.0000"])).toBe("0+20");
  });

  it("sums period quantities without floating point drift", () => {
    expect(sumPeriodQuantities(["0.1000", "0.2000"])).toBe("0.3000");
    expect(sumPeriodQuantities(["30.0000", "20.0000"])).toBe("50.0000");
  });
});
