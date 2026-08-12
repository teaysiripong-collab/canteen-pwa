import { describe, expect, it } from "vitest";
import {
  convertQuantity,
  fromBaseQuantity,
  resolveConversionFactor,
  toBaseQuantity,
  UnitConversionError,
  type ConversionRule,
} from "../units";

const KG = "unit-kg";
const G = "unit-g";
const CASE = "unit-case";
const BOTTLE = "unit-bottle";
const PACK = "unit-pack";
const BAG = "unit-bag";

const rules: ConversionRule[] = [
  { itemId: null, fromUnitId: KG, toUnitId: G, factor: "1000" },
  { itemId: null, fromUnitId: CASE, toUnitId: BOTTLE, factor: "12" },
  { itemId: null, fromUnitId: PACK, toUnitId: BAG, factor: "10" },
];

describe("resolveConversionFactor", () => {
  it("returns 1 for the same unit", () => {
    expect(resolveConversionFactor(KG, KG, rules)).toBe("1.0000");
  });

  it("converts along a direct rule", () => {
    expect(resolveConversionFactor(KG, G, rules)).toBe("1000.0000");
  });

  it("converts in the reverse direction", () => {
    expect(resolveConversionFactor(G, KG, rules)).toBe("0.0010");
  });

  it("walks a chained path", () => {
    // 1 pallet = 4 cases, 1 case = 12 bottles -> 1 pallet = 48 bottles
    const chained: ConversionRule[] = [
      ...rules,
      { itemId: null, fromUnitId: "unit-pallet", toUnitId: CASE, factor: "4" },
    ];
    expect(resolveConversionFactor("unit-pallet", BOTTLE, chained)).toBe("48.0000");
  });

  it("throws when no path exists", () => {
    expect(() => resolveConversionFactor(KG, BOTTLE, rules)).toThrow(UnitConversionError);
  });

  it("lets an item-specific rule override the global one", () => {
    const withOverride: ConversionRule[] = [
      ...rules,
      { itemId: "item-1", fromUnitId: CASE, toUnitId: BOTTLE, factor: "24" },
    ];
    expect(resolveConversionFactor(CASE, BOTTLE, withOverride, "item-1")).toBe("24.0000");
    expect(resolveConversionFactor(CASE, BOTTLE, withOverride, "item-2")).toBe("12.0000");
  });
});

describe("convertQuantity", () => {
  it("converts 1 ลัง to 12 ขวด", () => {
    expect(convertQuantity("1", CASE, BOTTLE, rules)).toBe("12.0000");
  });

  it("converts 2.5 แพ็ก to 25 ถุง", () => {
    expect(convertQuantity("2.5", PACK, BAG, rules)).toBe("25.0000");
  });

  it("converts 250 g back to 0.25 kg", () => {
    expect(convertQuantity("250", G, KG, rules)).toBe("0.2500");
  });
});

describe("purchase unit conversion", () => {
  it("turns a purchase quantity into base units", () => {
    // 3 แผงไข่ at 30 ฟอง per แผง
    expect(toBaseQuantity("3", "30")).toBe("90.0000");
  });

  it("turns base units back into purchase units", () => {
    expect(fromBaseQuantity("90", "30")).toBe("3.0000");
  });

  it("keeps fractional purchase quantities exact", () => {
    expect(toBaseQuantity("0.5", "12")).toBe("6.0000");
  });
});
