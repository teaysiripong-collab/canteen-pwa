import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  booleanFlagSchema,
  optionalDayCountSchema,
  optionalNonNegativeQtySchema,
  optionalPositiveQtySchema,
} from "../common";

describe("booleanFlagSchema", () => {
  it("reads the strings a checkbox actually posts", () => {
    expect(booleanFlagSchema.parse("on")).toBe(true);
    expect(booleanFlagSchema.parse("true")).toBe(true);
    expect(booleanFlagSchema.parse("1")).toBe(true);
  });

  it('treats "false" as false — the trap that z.coerce.boolean() falls into', () => {
    expect(booleanFlagSchema.parse("false")).toBe(false);
    expect(booleanFlagSchema.parse("")).toBe(false);
    expect(booleanFlagSchema.parse("off")).toBe(false);
  });

  it("passes real booleans through", () => {
    expect(booleanFlagSchema.parse(true)).toBe(true);
    expect(booleanFlagSchema.parse(false)).toBe(false);
  });

  it("falls back to the declared default only when the field is missing", () => {
    const schema = z.object({ isActive: booleanFlagSchema.default(true) });
    expect(schema.parse({}).isActive).toBe(true);
    expect(schema.parse({ isActive: "false" }).isActive).toBe(false);
  });
});

describe("optional numeric schemas", () => {
  it("keeps a blank field undefined instead of turning it into zero", () => {
    expect(optionalNonNegativeQtySchema.parse("")).toBeUndefined();
    expect(optionalPositiveQtySchema.parse("")).toBeUndefined();
    expect(optionalDayCountSchema.parse("")).toBeUndefined();
  });

  it("still parses real numbers", () => {
    expect(optionalNonNegativeQtySchema.parse("0")).toBe(0);
    expect(optionalPositiveQtySchema.parse("2.5")).toBe(2.5);
    expect(optionalDayCountSchema.parse("14")).toBe(14);
  });

  it("enforces the bounds it advertises", () => {
    expect(() => optionalNonNegativeQtySchema.parse("-1")).toThrow();
    expect(() => optionalPositiveQtySchema.parse("0")).toThrow();
    expect(() => optionalDayCountSchema.parse("1.5")).toThrow();
  });
});
