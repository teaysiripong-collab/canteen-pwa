import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS } from "@/lib/permissions";

/**
 * Gate 3 of the roadmap, proven against a real Postgres:
 * receive 100 → issue 30 → balance 70, over-issue refused, a double submit posts once,
 * and two concurrent issues can never oversell.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-ledger@canteen.local",
  fullName: "Integration Store Keeper",
  defaultLocationId: null,
  defaultLocationName: null,
  roleCodes: ["STORE"],
  permissions: Object.values(PERMISSIONS) as string[],
};

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => actor),
  requireUser: vi.fn(async () => actor),
  getCurrentUser: vi.fn(async () => actor),
  getRequestMetadata: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "vitest" })),
}));

const { db } = await import("@/database/client");
const {
  auditLogs,
  inventoryLots,
  inventoryPostings,
  inventoryTransactions,
  itemCategories,
  items,
  locations,
  organizations,
  stockBalances,
  units,
  users,
} = await import("@/database/schema");
const { postMovement, reversePosting } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { listStockBalances, listStockMovements } = await import(
  "@/repositories/inventory-repository"
);

const ITEM_CODE = "TEST-LEDGER-001";

let itemId = "";
let locationId = "";
let otherLocationId = "";
let lotId = "";
let keyCounter = 0;

const nextKey = (label: string) => `test:${label}:${(keyCounter += 1)}:${Date.now()}`;

async function balanceOf(lot: string, location: string): Promise<string> {
  const [row] = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.lotId, lot), eq(stockBalances.locationId, location)))
    .limit(1);
  return row?.baseQty ?? "0";
}

async function purgeLedger() {
  const lots = await db.select({ id: inventoryLots.id }).from(inventoryLots).where(eq(inventoryLots.itemId, itemId || "00000000-0000-0000-0000-000000000000"));
  const lotIds = lots.map((lot) => lot.id);
  if (lotIds.length === 0) return;

  const postingIds = [
    ...new Set(
      (
        await db
          .select({ postingId: inventoryTransactions.postingId })
          .from(inventoryTransactions)
          .where(inArray(inventoryTransactions.lotId, lotIds))
      ).map((row) => row.postingId),
    ),
  ];

  await db.delete(inventoryTransactions).where(inArray(inventoryTransactions.lotId, lotIds));
  await db.delete(stockBalances).where(inArray(stockBalances.lotId, lotIds));
  if (postingIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, postingIds));
    // Reversal postings point at the posting they cancel, so clear those links first.
    await db
      .update(inventoryPostings)
      .set({ reversalOfPostingId: null })
      .where(inArray(inventoryPostings.id, postingIds));
    await db.delete(inventoryPostings).where(inArray(inventoryPostings.id, postingIds));
  }
  await db.delete(inventoryLots).where(inArray(inventoryLots.id, lotIds));
}

beforeAll(async () => {
  const [organization] = await db.select().from(organizations).limit(1);
  if (!organization) throw new Error("Run `npm run db:seed` before the integration tests.");
  actor.organizationId = organization.id;

  await db.delete(users).where(eq(users.email, actor.email));
  const [userRow] = await db
    .insert(users)
    .values({ organizationId: organization.id, email: actor.email, fullName: actor.fullName })
    .returning();
  actor.id = userRow!.id;

  const [kg] = await db.select().from(units).where(eq(units.code, "KG")).limit(1);
  const [category] = await db
    .select()
    .from(itemCategories)
    .where(eq(itemCategories.organizationId, organization.id))
    .limit(1);

  const stockLocations = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.holdsStock, true)));
  locationId = stockLocations.find((row) => row.code === "B16")!.id;
  otherLocationId = stockLocations.find((row) => row.code === "B1")!.id;

  // A dedicated item keeps the seeded catalogue untouched.
  const [existing] = await db
    .select()
    .from(items)
    .where(and(eq(items.organizationId, organization.id), eq(items.code, ITEM_CODE)))
    .limit(1);

  if (existing) {
    itemId = existing.id;
    await purgeLedger();
  } else {
    const [created] = await db
      .insert(items)
      .values({
        organizationId: organization.id,
        code: ITEM_CODE,
        nameTh: "ไก่บด (ทดสอบ)",
        categoryId: category?.id ?? null,
        baseUnitId: kg!.id,
        purchaseUnitId: kg!.id,
        purchaseConversion: "1",
      })
      .returning();
    itemId = created!.id;
  }
});

beforeEach(async () => {
  await purgeLedger();

  const lot = await createLot({
    organizationId: actor.organizationId,
    itemId,
    receivedBaseQty: 100,
    unitCost: 88.5,
    expiryDate: "2030-01-01",
  });
  lotId = lot.id;
});

afterAll(async () => {
  await purgeLedger();
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("inventory ledger", () => {
  it("receives 100, issues 30 and leaves 70", async () => {
    await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      referenceNumber: "GR-TEST-001",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 100 }],
    });

    expect(await balanceOf(lotId, locationId)).toBe("100.0000");

    await postMovement({
      idempotencyKey: nextKey("issue"),
      referenceType: "STOCK_ISSUE",
      referenceNumber: "IS-TEST-001",
      lines: [{ type: "ISSUE", itemId, lotId, locationId, baseQty: 30 }],
    });

    expect(await balanceOf(lotId, locationId)).toBe("70.0000");

    const { rows } = await listStockMovements(actor.organizationId, { itemId });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.transactionType).sort()).toEqual(["ISSUE", "RECEIVE"]);
    expect(rows.find((row) => row.transactionType === "ISSUE")!.direction).toBe("OUT");
  });

  it("refuses to issue more than the balance and leaves stock untouched", async () => {
    await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 100 }],
    });

    await expect(
      postMovement({
        idempotencyKey: nextKey("issue-too-much"),
        referenceType: "STOCK_ISSUE",
        lines: [{ type: "ISSUE", itemId, lotId, locationId, baseQty: 101 }],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await balanceOf(lotId, locationId)).toBe("100.0000");
  });

  it("reports how much is actually left, in Thai", async () => {
    await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 12 }],
    });

    await expect(
      postMovement({
        idempotencyKey: nextKey("issue-too-much"),
        referenceType: "STOCK_ISSUE",
        lines: [{ type: "ISSUE", itemId, lotId, locationId, baseQty: 20 }],
      }),
    ).rejects.toThrow(/จำนวนที่ต้องการเบิกมากกว่าสต๊อกคงเหลือ.*คงเหลือ 12/);
  });

  it("posts once when the same submission arrives twice", async () => {
    const key = nextKey("double-submit");
    const payload = {
      idempotencyKey: key,
      referenceType: "GOODS_RECEIPT" as const,
      lines: [{ type: "RECEIVE" as const, itemId, lotId, locationId, baseQty: 40 }],
    };

    const first = await postMovement(payload);
    const second = await postMovement(payload);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.postingId).toBe(first.postingId);
    expect(await balanceOf(lotId, locationId)).toBe("40.0000");

    const { total } = await listStockMovements(actor.organizationId, { itemId });
    expect(total).toBe(1);
  });

  it("never oversells when two issues run at the same time", async () => {
    await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 50 }],
    });

    // Both want 30 of the 50 on hand; exactly one of them must win.
    const results = await Promise.allSettled([
      postMovement({
        idempotencyKey: nextKey("race-a"),
        referenceType: "STOCK_ISSUE",
        lines: [{ type: "ISSUE", itemId, lotId, locationId, baseQty: 30 }],
      }),
      postMovement({
        idempotencyKey: nextKey("race-b"),
        referenceType: "STOCK_ISSUE",
        lines: [{ type: "ISSUE", itemId, lotId, locationId, baseQty: 30 }],
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });
    expect(await balanceOf(lotId, locationId)).toBe("20.0000");
  });

  it("moves both legs of a transfer in one posting", async () => {
    await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 60 }],
    });

    await postMovement({
      idempotencyKey: nextKey("transfer"),
      referenceType: "STOCK_TRANSFER",
      referenceNumber: "TF-TEST-001",
      lines: [
        { type: "TRANSFER_OUT", itemId, lotId, locationId, baseQty: 25 },
        { type: "TRANSFER_IN", itemId, lotId, locationId: otherLocationId, baseQty: 25 },
      ],
    });

    expect(await balanceOf(lotId, locationId)).toBe("35.0000");
    expect(await balanceOf(lotId, otherLocationId)).toBe("25.0000");
  });

  it("rolls the whole posting back when one line fails", async () => {
    await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 10 }],
    });

    await expect(
      postMovement({
        idempotencyKey: nextKey("bad-transfer"),
        referenceType: "STOCK_TRANSFER",
        lines: [
          { type: "TRANSFER_OUT", itemId, lotId, locationId, baseQty: 999 },
          { type: "TRANSFER_IN", itemId, lotId, locationId: otherLocationId, baseQty: 999 },
        ],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await balanceOf(lotId, locationId)).toBe("10.0000");
    expect(await balanceOf(lotId, otherLocationId)).toBe("0");

    // The failed attempt must not leave its idempotency claim behind either.
    const { total } = await listStockMovements(actor.organizationId, { itemId });
    expect(total).toBe(1);
  });

  it("reverses a posting with mirrored rows instead of deleting it", async () => {
    const receipt = await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 80 }],
    });

    const reversal = await reversePosting(receipt.postingId, "รับผิดวัตถุดิบ");

    expect(await balanceOf(lotId, locationId)).toBe("0.0000");

    const { rows } = await listStockMovements(actor.organizationId, { itemId });
    expect(rows).toHaveLength(2);

    const reversalRow = rows.find((row) => row.postingId === reversal.postingId)!;
    expect(reversalRow.transactionType).toBe("REVERSAL");
    expect(reversalRow.direction).toBe("OUT");
    expect(reversalRow.baseQty).toBe("80.0000");

    // The original row is still there, untouched.
    expect(rows.some((row) => row.transactionType === "RECEIVE")).toBe(true);
  });

  it("refuses to reverse the same posting twice", async () => {
    const receipt = await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 80 }],
    });

    await reversePosting(receipt.postingId, "ครั้งแรก");
    await expect(reversePosting(receipt.postingId, "ครั้งที่สอง")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("refuses a reversal whose stock has already been consumed", async () => {
    const receipt = await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 20 }],
    });

    await postMovement({
      idempotencyKey: nextKey("issue"),
      referenceType: "STOCK_ISSUE",
      lines: [{ type: "ISSUE", itemId, lotId, locationId, baseQty: 15 }],
    });

    await expect(reversePosting(receipt.postingId, "คืนของ")).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });

    expect(await balanceOf(lotId, locationId)).toBe("5.0000");
  });

  it("rejects a movement the user has no permission for", async () => {
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(
      postMovement({
        idempotencyKey: nextKey("forbidden"),
        referenceType: "GOODS_RECEIPT",
        lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 5 }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
  });

  it("rolls the stock balance report up per item and location", async () => {
    await postMovement({
      idempotencyKey: nextKey("receive"),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 90 }],
    });

    const balances = await listStockBalances(actor.organizationId, { onlyInStock: true });
    const row = balances.find((entry) => entry.itemId === itemId);

    expect(row).toBeDefined();
    expect(Number(row!.baseQty)).toBe(90);
    expect(row!.lotCount).toBe(1);
  });
});
