import { describe, expect, it } from "vitest";
import { computeVariance } from "../issue/variance";

describe("standard vs actual variance", () => {
  it("reports +2 kg and +6.67% when 32 is taken against a standard of 30", () => {
    // Gate 9 of the roadmap.
    const variance = computeVariance("30.0000", "32.0000");

    expect(variance.varianceBaseQty).toBe("2.0000");
    expect(variance.variancePercent).toBeCloseTo(6.666666, 4);
  });

  it("reports a negative variance when less is taken", () => {
    const variance = computeVariance("30.0000", "27.0000");

    expect(variance.varianceBaseQty).toBe("-3.0000");
    expect(variance.variancePercent).toBeCloseTo(-10, 6);
  });

  it("reports zero when the kitchen took exactly the standard", () => {
    const variance = computeVariance("30.0000", "30.0000");

    expect(variance.varianceBaseQty).toBe("0.0000");
    expect(variance.variancePercent).toBe(0);
  });

  it("has no variance to report on a manual line with no standard", () => {
    const variance = computeVariance(null, "5.0000");

    expect(variance.varianceBaseQty).toBeNull();
    expect(variance.variancePercent).toBeNull();
  });

  it("avoids dividing by zero when the standard is zero", () => {
    const variance = computeVariance("0.0000", "4.0000");

    expect(variance.varianceBaseQty).toBe("4.0000");
    expect(variance.variancePercent).toBeNull();
  });

  it("keeps decimal quantities exact", () => {
    const variance = computeVariance("2.5000", "2.8000");
    expect(variance.varianceBaseQty).toBe("0.3000");
  });
});
