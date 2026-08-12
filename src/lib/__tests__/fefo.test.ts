import { describe, expect, it } from "vitest";
import { allocateFefo, bucketExpiry, sortLotsByFefo, type AllocatableLot } from "../fefo";

const lot = (overrides: Partial<AllocatableLot> & { lotId: string }): AllocatableLot => ({
  expiryDate: null,
  receivedDate: "2026-01-01",
  availableBaseQty: "0",
  unitCost: "0",
  ...overrides,
});

describe("sortLotsByFefo", () => {
  it("puts the earliest expiry first", () => {
    const sorted = sortLotsByFefo([
      lot({ lotId: "b", expiryDate: "2026-03-10" }),
      lot({ lotId: "a", expiryDate: "2026-03-01" }),
    ]);
    expect(sorted.map((entry) => entry.lotId)).toEqual(["a", "b"]);
  });

  it("puts lots without an expiry date last", () => {
    const sorted = sortLotsByFefo([
      lot({ lotId: "no-expiry", expiryDate: null }),
      lot({ lotId: "expiring", expiryDate: "2026-12-31" }),
    ]);
    expect(sorted.map((entry) => entry.lotId)).toEqual(["expiring", "no-expiry"]);
  });

  it("breaks an expiry tie with the received date", () => {
    const sorted = sortLotsByFefo([
      lot({ lotId: "newer", expiryDate: "2026-03-01", receivedDate: "2026-02-10" }),
      lot({ lotId: "older", expiryDate: "2026-03-01", receivedDate: "2026-02-01" }),
    ]);
    expect(sorted.map((entry) => entry.lotId)).toEqual(["older", "newer"]);
  });
});

describe("allocateFefo", () => {
  const lots = [
    lot({ lotId: "l2", expiryDate: "2026-03-10", availableBaseQty: "20", unitCost: "62" }),
    lot({ lotId: "l1", expiryDate: "2026-03-01", availableBaseQty: "12", unitCost: "60" }),
    lot({ lotId: "l3", expiryDate: null, availableBaseQty: "50", unitCost: "65" }),
  ];

  it("consumes the earliest-expiring lot first", () => {
    const result = allocateFefo("10", lots);
    expect(result.allocations).toEqual([{ lotId: "l1", baseQty: "10.0000", unitCost: "60" }]);
    expect(result.shortfallBaseQty).toBe("0.0000");
  });

  it("spills over into the next lot when one is not enough", () => {
    const result = allocateFefo("30", lots);
    expect(result.allocations).toEqual([
      { lotId: "l1", baseQty: "12.0000", unitCost: "60" },
      { lotId: "l2", baseQty: "18.0000", unitCost: "62" },
    ]);
    expect(result.shortfallBaseQty).toBe("0.0000");
  });

  it("never allocates more than a lot holds", () => {
    const result = allocateFefo("100", lots);
    const total = result.allocations.reduce((sum, entry) => sum + Number(entry.baseQty), 0);
    expect(total).toBe(82);
    expect(result.allocations.every((entry) => Number(entry.baseQty) > 0)).toBe(true);
  });

  it("reports a shortfall instead of going negative", () => {
    const result = allocateFefo("100", lots);
    expect(result.shortfallBaseQty).toBe("18.0000");
    expect(result.availableBaseQty).toBe("82.0000");
  });

  it("skips empty lots", () => {
    const result = allocateFefo("5", [
      lot({ lotId: "empty", expiryDate: "2026-01-01", availableBaseQty: "0" }),
      lot({ lotId: "stocked", expiryDate: "2026-02-01", availableBaseQty: "5" }),
    ]);
    expect(result.allocations).toEqual([{ lotId: "stocked", baseQty: "5.0000", unitCost: "0" }]);
  });

  it("returns nothing for a zero request", () => {
    expect(allocateFefo("0", lots).allocations).toEqual([]);
  });

  it("keeps fractional quantities exact across many lots", () => {
    const fractional = Array.from({ length: 10 }, (_, index) =>
      lot({ lotId: `f${index}`, expiryDate: `2026-01-0${index % 9 || 1}`, availableBaseQty: "0.1" }),
    );
    const result = allocateFefo("1", fractional);
    expect(result.shortfallBaseQty).toBe("0.0000");
  });
});

describe("bucketExpiry", () => {
  const today = "2026-08-12";

  it("flags a past date as expired", () => {
    expect(bucketExpiry("2026-08-11", today, 7)).toBe("EXPIRED");
  });

  it("flags today", () => {
    expect(bucketExpiry(today, today, 7)).toBe("TODAY");
  });

  it("flags a date inside the configured window", () => {
    expect(bucketExpiry("2026-08-15", today, 7)).toBe("SOON");
  });

  it("respects a narrower window", () => {
    expect(bucketExpiry("2026-08-15", today, 1)).toBe("OK");
  });

  it("treats a lot without an expiry date as fine", () => {
    expect(bucketExpiry(null, today, 7)).toBe("OK");
  });
});
