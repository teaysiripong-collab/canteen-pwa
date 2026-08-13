import { describe, expect, it } from "vitest";
import {
  applyOrderRules,
  orderByDate,
  roundUpToPack,
  suggestOrderQuantity,
} from "../purchasing/order-quantity";

describe("pack rounding", () => {
  it("rounds up to the next whole pack", () => {
    // 3.4 trays of eggs is not a thing you can buy.
    expect(roundUpToPack("3.4", "1")).toBe("4.0000");
    expect(roundUpToPack("11", "5")).toBe("15.0000");
  });

  it("leaves an exact multiple alone", () => {
    expect(roundUpToPack("15", "5")).toBe("15.0000");
  });

  it("leaves the quantity alone when the supplier sells any amount", () => {
    expect(roundUpToPack("3.4", null)).toBe("3.4000");
    expect(roundUpToPack("3.4")).toBe("3.4000");
  });

  it("does not divide by a zero pack size", () => {
    expect(roundUpToPack("3.4", "0")).toBe("3.4000");
  });
});

describe("order rules", () => {
  it("lifts a small order up to the minimum", () => {
    expect(applyOrderRules("2", { moq: "10" })).toBe("10.0000");
  });

  it("applies the minimum and the pack multiple together", () => {
    // Minimum 10, sold in 4s -> 12, not 10.
    expect(applyOrderRules("2", { moq: "10", packSize: "4" })).toBe("12.0000");
  });

  it("does not invent an order when nothing is short", () => {
    expect(applyOrderRules("0", { moq: "10" })).toBe("0.0000");
    expect(applyOrderRules("-5", { moq: "10" })).toBe("0.0000");
  });
});

describe("order suggestion", () => {
  it("converts a stock shortfall into the supplier's purchase unit", () => {
    // 30 kg short, sold by the 5 kg bag.
    const suggestion = suggestOrderQuantity({
      shortfallBaseQty: "30",
      conversionToBase: "5",
    });

    expect(suggestion.purchaseQty).toBe("6.0000");
    expect(suggestion.orderedBaseQty).toBe("30.0000");
    expect(suggestion.surplusBaseQty).toBe("0.0000");
  });

  it("reports how much the rules forced on top of the need", () => {
    // 2 kg short but the sack is 25 kg.
    const suggestion = suggestOrderQuantity({
      shortfallBaseQty: "2",
      conversionToBase: "25",
      rules: { moq: "1" },
    });

    expect(suggestion.purchaseQty).toBe("1.0000");
    expect(suggestion.orderedBaseQty).toBe("25.0000");
    expect(suggestion.surplusBaseQty).toBe("23.0000");
  });

  it("suggests nothing when there is no shortfall", () => {
    expect(
      suggestOrderQuantity({ shortfallBaseQty: "0", conversionToBase: "5" }),
    ).toEqual({ purchaseQty: "0.0000", orderedBaseQty: "0.0000", surplusBaseQty: "0.0000" });
  });

  it("refuses to divide by a missing conversion", () => {
    expect(
      suggestOrderQuantity({ shortfallBaseQty: "30", conversionToBase: "0" }).purchaseQty,
    ).toBe("0.0000");
  });
});

describe("order-by date", () => {
  it("counts the lead time back from the day the food is needed", () => {
    expect(orderByDate("2026-03-10", 3)).toBe("2026-03-07");
  });

  it("orders on the day itself when the supplier delivers same-day", () => {
    expect(orderByDate("2026-03-10", 0)).toBe("2026-03-10");
  });

  it("treats a negative lead time as same-day rather than a date in the future", () => {
    expect(orderByDate("2026-03-10", -2)).toBe("2026-03-10");
  });

  it("crosses a month boundary correctly", () => {
    expect(orderByDate("2026-03-02", 5)).toBe("2026-02-25");
  });
});
