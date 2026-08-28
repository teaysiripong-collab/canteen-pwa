import { describe, expect, it } from "vitest";
import { addQty, compareQty, divQty, mulQty, subQty, sumQty, toNumericString } from "../quantity";

describe("quantity arithmetic", () => {
  it("adds without floating point drift", () => {
    expect(addQty("0.1", "0.2")).toBe("0.3000");
  });

  it("keeps a long chain of additions exact", () => {
    const total = Array.from({ length: 10 }).reduce<string>((sum) => addQty(sum, "0.1"), "0");
    expect(total).toBe("1.0000");
  });

  it("subtracts to exactly zero", () => {
    expect(subQty("49", "49")).toBe("0.0000");
  });

  it("multiplies purchase quantities", () => {
    expect(mulQty("2.5", "12")).toBe("30.0000");
  });

  it("divides base quantities", () => {
    expect(divQty("90", "30")).toBe("3.0000");
  });

  it("rejects division by zero", () => {
    expect(() => divQty("1", "0")).toThrow();
  });

  it("sums a list", () => {
    expect(sumQty(["1.25", "2.5", "0.25"])).toBe("4.0000");
  });

  it("compares quantities", () => {
    expect(compareQty("32", "49")).toBe(-1);
    expect(compareQty("49", "49")).toBe(0);
    expect(compareQty("50", "49")).toBe(1);
  });

  it("normalises input to the stored form", () => {
    expect(toNumericString(12)).toBe("12.0000");
    expect(toNumericString("0.5")).toBe("0.5000");
  });

  it("rejects values that are not numbers", () => {
    expect(() => toNumericString("abc")).toThrow();
  });
});
