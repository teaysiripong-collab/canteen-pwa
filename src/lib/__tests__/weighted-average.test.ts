import { describe, expect, it } from "vitest";
import { costVariance, totalCostValue, weightedAverageCost } from "../costing/weighted-average";

describe("weighted average cost", () => {
  it("weights by quantity, not by how many lots there are", () => {
    // 20 kg at 90 and 10 kg at 80 -> (1800 + 800) / 30.
    const average = weightedAverageCost([
      { baseQty: "20", unitCost: "90" },
      { baseQty: "10", unitCost: "80" },
    ]);

    expect(Number(average)).toBeCloseTo(86.6667, 4);
  });

  it("returns the single price when there is only one lot", () => {
    expect(weightedAverageCost([{ baseQty: "12", unitCost: "88.5" }])).toBe("88.5000");
  });

  it("ignores lots with nothing left in them", () => {
    const average = weightedAverageCost([
      { baseQty: "0", unitCost: "999" },
      { baseQty: "10", unitCost: "50" },
    ]);

    expect(average).toBe("50.0000");
  });

  it("has no average to report for an empty set", () => {
    expect(weightedAverageCost([])).toBe("0.0000");
    expect(weightedAverageCost([{ baseQty: "0", unitCost: "10" }])).toBe("0.0000");
  });

  it("does not drift on repeated fractional prices", () => {
    // 4.2667 per egg is what 128 baht a tray works out to.
    const average = weightedAverageCost([
      { baseQty: "30", unitCost: "4.2667" },
      { baseQty: "30", unitCost: "4.2667" },
      { baseQty: "30", unitCost: "4.2667" },
    ]);

    expect(average).toBe("4.2667");
  });

  it("totals the money in a set of lots", () => {
    expect(
      totalCostValue([
        { baseQty: "20", unitCost: "90" },
        { baseQty: "10", unitCost: "80" },
      ]),
    ).toBe("2600.0000");
  });
});

describe("cost variance", () => {
  it("reports the money and the percentage over standard", () => {
    const variance = costVariance("1000", "1080");

    expect(variance.varianceValue).toBe("80.0000");
    expect(variance.variancePercent).toBeCloseTo(8, 6);
  });

  it("reports a saving as a negative variance", () => {
    const variance = costVariance("1000", "950");

    expect(variance.varianceValue).toBe("-50.0000");
    expect(variance.variancePercent).toBeCloseTo(-5, 6);
  });

  it("has no percentage when the standard is zero", () => {
    const variance = costVariance("0", "120");

    expect(variance.varianceValue).toBe("120.0000");
    expect(variance.variancePercent).toBeNull();
  });
});
