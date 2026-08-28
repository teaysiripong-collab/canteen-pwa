import { describe, expect, it } from "vitest";
import {
  DIRECTIONAL_TRANSACTION_TYPES,
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS_TH,
  directionOfType,
  isDirectionalType,
  oppositeDirection,
} from "../inventory/transaction-types";

describe("transaction type directions", () => {
  it("puts stock in for every inbound type", () => {
    for (const type of ["OPENING_BALANCE", "RECEIVE", "TRANSFER_IN", "ADJUSTMENT_IN", "RETURN_TO_STOCK"] as const) {
      expect(directionOfType(type)).toBe("IN");
    }
  });

  it("takes stock out for every outbound type", () => {
    for (const type of ["ISSUE", "TRANSFER_OUT", "ADJUSTMENT_OUT", "WASTE", "RETURN_TO_SUPPLIER"] as const) {
      expect(directionOfType(type)).toBe("OUT");
    }
  });

  it("leaves the two ambiguous types out of the directly postable set", () => {
    // REVERSAL mirrors the row it cancels and a count adjustment can go either way,
    // so neither may be posted without an explicit direction.
    expect(isDirectionalType("REVERSAL")).toBe(false);
    expect(isDirectionalType("STOCK_COUNT_ADJUSTMENT")).toBe(false);
    expect(DIRECTIONAL_TRANSACTION_TYPES).toHaveLength(TRANSACTION_TYPES.length - 2);
  });

  it("gives every ledger type a Thai label", () => {
    for (const type of TRANSACTION_TYPES) {
      expect(TRANSACTION_TYPE_LABELS_TH[type]).toBeTruthy();
    }
  });

  it("mirrors a direction for reversals", () => {
    expect(oppositeDirection("IN")).toBe("OUT");
    expect(oppositeDirection("OUT")).toBe("IN");
  });

  it("rejects an unknown type", () => {
    expect(isDirectionalType("NOT_A_TYPE")).toBe(false);
  });
});
