import { describe, expect, it } from "vitest";
import { itemInputSchema, supplierItemInputSchema } from "../master-data";
import { userInputSchema } from "../user";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const UNIT_A = "33333333-3333-4333-8333-333333333333";
const UNIT_B = "44444444-4444-4444-8444-444444444444";

function itemPayload(overrides: Record<string, unknown> = {}) {
  return {
    code: "MEAT-004",
    nameTh: "ไก่บด",
    baseUnitId: UNIT_A,
    purchaseUnitId: UNIT_A,
    purchaseConversion: "1",
    ...overrides,
  };
}

function mappingPayload(overrides: Record<string, unknown> = {}) {
  return {
    supplierId: SUPPLIER_ID,
    itemId: ITEM_ID,
    ...overrides,
  };
}

describe("itemInputSchema", () => {
  it("defaults the stock thresholds to zero", () => {
    const parsed = itemInputSchema.parse(itemPayload());
    expect(parsed.minimumStock).toBe(0);
    expect(parsed.reorderPoint).toBe(0);
    expect(parsed.safetyStock).toBe(0);
  });

  it("keeps an empty shelf life undefined rather than coercing it to 0 days", () => {
    const parsed = itemInputSchema.parse(itemPayload({ shelfLifeDays: "" }));
    expect(parsed.shelfLifeDays).toBeUndefined();
  });

  it("accepts a real shelf life", () => {
    const parsed = itemInputSchema.parse(itemPayload({ shelfLifeDays: "3" }));
    expect(parsed.shelfLifeDays).toBe(3);
  });

  it("rejects a negative safety stock", () => {
    expect(() => itemInputSchema.parse(itemPayload({ safetyStock: "-1" }))).toThrow();
  });

  it("requires the conversion to be 1 when purchase unit equals base unit", () => {
    expect(() =>
      itemInputSchema.parse(itemPayload({ purchaseConversion: "12" })),
    ).toThrow();

    expect(
      itemInputSchema.parse(
        itemPayload({ purchaseUnitId: UNIT_B, purchaseConversion: "12" }),
      ).purchaseConversion,
    ).toBe(12);
  });

  it("splits the alias field on commas and drops blanks", () => {
    const parsed = itemInputSchema.parse(itemPayload({ aliases: "ไก่สับละเอียด, ไก่บดละเอียด, " }));
    expect(parsed.aliases).toEqual(["ไก่สับละเอียด", "ไก่บดละเอียด"]);
  });
});

describe("supplierItemInputSchema", () => {
  it("leaves optional purchasing terms undefined when the fields are blank", () => {
    // Blank must stay NULL: a 0 pack size or a 0 price would be read as real data by
    // the purchase planner and the price-change report.
    const parsed = supplierItemInputSchema.parse(
      mappingPayload({ packSize: "", leadTimeDays: "", lastPrice: "", purchaseConversion: "" }),
    );

    expect(parsed.packSize).toBeUndefined();
    expect(parsed.leadTimeDays).toBeUndefined();
    expect(parsed.lastPrice).toBeUndefined();
    expect(parsed.purchaseConversion).toBeUndefined();
    expect(parsed.moq).toBe(0);
  });

  it("parses the purchasing terms a buyer actually types", () => {
    const parsed = supplierItemInputSchema.parse(
      mappingPayload({
        purchaseUnitId: UNIT_B,
        purchaseConversion: "30",
        moq: "5",
        packSize: "1",
        leadTimeDays: "2",
        lastPrice: "128.50",
      }),
    );

    expect(parsed.purchaseConversion).toBe(30);
    expect(parsed.moq).toBe(5);
    expect(parsed.packSize).toBe(1);
    expect(parsed.leadTimeDays).toBe(2);
    expect(parsed.lastPrice).toBe(128.5);
  });

  it("keeps a zero price distinguishable from no price", () => {
    expect(supplierItemInputSchema.parse(mappingPayload({ lastPrice: "0" })).lastPrice).toBe(0);
  });

  it("rejects a pack size of zero", () => {
    expect(() => supplierItemInputSchema.parse(mappingPayload({ packSize: "0" }))).toThrow();
  });
});

describe("userInputSchema", () => {
  it("normalises the email and requires at least one role", () => {
    const parsed = userInputSchema.parse({
      email: "  Manager@Canteen.Local ",
      fullName: "สมชาย ใจดี",
      roleCodes: ["MANAGER"],
      isActive: "true",
    });

    expect(parsed.email).toBe("manager@canteen.local");
    expect(parsed.roleCodes).toEqual(["MANAGER"]);
  });

  it("refuses an account with no role", () => {
    expect(() =>
      userInputSchema.parse({ email: "a@b.co", fullName: "ก", roleCodes: [] }),
    ).toThrow();
  });

  it("refuses a role code outside the catalogue", () => {
    expect(() =>
      userInputSchema.parse({ email: "a@b.co", fullName: "ก", roleCodes: ["SUPERVISOR"] }),
    ).toThrow();
  });
});
