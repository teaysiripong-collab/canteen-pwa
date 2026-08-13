import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 6: B16 → B1. Both legs must land in one posting under one reference, the lots
 * must be chosen by FEFO, and the source can never be driven negative.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-transfer@canteen.local",
  fullName: "Integration Transfer",
  defaultLocationId: null,
  defaultLocationName: null,
  roleCodes: ["STORE"] as RoleCode[],
  permissions: Object.values(PERMISSIONS) as PermissionCode[],
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async (required: string | string[]) => {
    const list = Array.isArray(required) ? required : [required];
    if (!list.every((code) => (actor.permissions as string[]).includes(code))) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("FORBIDDEN");
    }
    return actor;
  }),
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
  items,
  locations,
  organizations,
  stockBalances,
  stockTransferItems,
  stockTransfers,
  units,
  users,
} = await import("@/database/schema");
const { createStockTransfer, previewTransfer } = await import("@/services/transfer-service");
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { listStockMovements } = await import("@/repositories/inventory-repository");

const ITEM_CODE = "TEST-TF-001";

let itemId = "";
let fromLocationId = "";
let toLocationId = "";
let lotSoon = "";
let lotLater = "";
let keyCounter = 0;

const nextKey = () => `test-tf:${(keyCounter += 1)}:${Date.now()}`;

async function balanceAt(locationId: string): Promise<number> {
  const rows = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.locationId, locationId)));
  return rows.reduce((sum, row) => sum + Number(row.baseQty), 0);
}

async function lotBalance(lotId: string, locationId: string): Promise<number> {
  const [row] = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.lotId, lotId), eq(stockBalances.locationId, locationId)))
    .limit(1);
  return Number(row?.baseQty ?? 0);
}

async function purge() {
  if (!itemId) return;

  const transfers = await db
    .select({ id: stockTransfers.id })
    .from(stockTransfers)
    .where(eq(stockTransfers.organizationId, actor.organizationId));
  const transferIds = transfers.map((row) => row.id);

  const lots = await db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(eq(inventoryLots.itemId, itemId));
  const lotIds = lots.map((lot) => lot.id);

  if (lotIds.length > 0) {
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
      await db.delete(inventoryPostings).where(inArray(inventoryPostings.id, postingIds));
    }
    await db.delete(inventoryLots).where(inArray(inventoryLots.id, lotIds));
  }

  if (transferIds.length > 0) {
    await db
      .delete(stockTransferItems)
      .where(inArray(stockTransferItems.stockTransferId, transferIds));
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, transferIds));
    await db.delete(stockTransfers).where(inArray(stockTransfers.id, transferIds));
  }
}

/** Puts `qty` of a lot at the source so the transfer has something to move. */
async function stockUp(lotId: string, qty: number, locationId = fromLocationId) {
  await postMovementAs(actor, {
    idempotencyKey: nextKey(),
    referenceType: "GOODS_RECEIPT",
    lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: qty }],
  });
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
  const locationRows = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.holdsStock, true)));
  fromLocationId = locationRows.find((row) => row.code === "B16")!.id;
  toLocationId = locationRows.find((row) => row.code === "B1")!.id;

  const [existing] = await db
    .select()
    .from(items)
    .where(and(eq(items.organizationId, organization.id), eq(items.code, ITEM_CODE)))
    .limit(1);

  if (existing) {
    itemId = existing.id;
  } else {
    const [created] = await db
      .insert(items)
      .values({
        organizationId: organization.id,
        code: ITEM_CODE,
        nameTh: "หมูบด (ทดสอบโอน)",
        baseUnitId: kg!.id,
        purchaseUnitId: kg!.id,
        purchaseConversion: "1",
      })
      .returning();
    itemId = created!.id;
  }
});

beforeEach(async () => {
  await purge();

  const later = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `TF-LATER-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 160,
    expiryDate: "2026-09-30",
  });
  const soon = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `TF-SOON-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 165,
    expiryDate: "2026-08-20",
  });

  lotLater = later.id;
  lotSoon = soon.id;
});

afterAll(async () => {
  await purge();
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("stock transfer", () => {
  it("moves stock out of the source and into the destination", async () => {
    await stockUp(lotSoon, 60);

    const result = await createStockTransfer({
      idempotencyKey: nextKey(),
      fromLocationId,
      toLocationId,
      lines: [{ itemId, baseQty: 25 }],
    });

    expect(result.transferNumber).toMatch(/^TF-\d{8}-\d{3}$/);
    expect(await balanceAt(fromLocationId)).toBe(35);
    expect(await balanceAt(toLocationId)).toBe(25);
  });

  it("writes both legs into one posting under the same reference", async () => {
    await stockUp(lotSoon, 40);

    const result = await createStockTransfer({
      idempotencyKey: nextKey(),
      fromLocationId,
      toLocationId,
      lines: [{ itemId, baseQty: 10 }],
    });

    const { rows } = await listStockMovements(actor.organizationId, {
      postingId: result.postingId,
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.transactionType).sort()).toEqual([
      "TRANSFER_IN",
      "TRANSFER_OUT",
    ]);
    expect(new Set(rows.map((row) => row.referenceNumber))).toEqual(
      new Set([result.transferNumber]),
    );
    expect(rows.every((row) => row.postingId === result.postingId)).toBe(true);
  });

  it("takes the lot that expires first", async () => {
    await stockUp(lotLater, 50);
    await stockUp(lotSoon, 50);

    await createStockTransfer({
      idempotencyKey: nextKey(),
      fromLocationId,
      toLocationId,
      lines: [{ itemId, baseQty: 20 }],
    });

    // 20 Aug goes before 30 Sep.
    expect(await lotBalance(lotSoon, fromLocationId)).toBe(30);
    expect(await lotBalance(lotLater, fromLocationId)).toBe(50);
    expect(await lotBalance(lotSoon, toLocationId)).toBe(20);
  });

  it("splits across lots and keeps each lot's identity at the destination", async () => {
    await stockUp(lotSoon, 15);
    await stockUp(lotLater, 40);

    await createStockTransfer({
      idempotencyKey: nextKey(),
      fromLocationId,
      toLocationId,
      lines: [{ itemId, baseQty: 30 }],
    });

    expect(await lotBalance(lotSoon, toLocationId)).toBe(15);
    expect(await lotBalance(lotLater, toLocationId)).toBe(15);
    expect(await lotBalance(lotSoon, fromLocationId)).toBe(0);
    expect(await lotBalance(lotLater, fromLocationId)).toBe(25);
  });

  it("refuses to move more than the source holds and changes nothing", async () => {
    await stockUp(lotSoon, 10);

    await expect(
      createStockTransfer({
        idempotencyKey: nextKey(),
        fromLocationId,
        toLocationId,
        lines: [{ itemId, baseQty: 40 }],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await balanceAt(fromLocationId)).toBe(10);
    expect(await balanceAt(toLocationId)).toBe(0);

    const transfers = await db
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.organizationId, actor.organizationId));
    expect(transfers).toHaveLength(0);
  });

  it("rolls back every line when one of them is short", async () => {
    await stockUp(lotSoon, 12);

    await expect(
      createStockTransfer({
        idempotencyKey: nextKey(),
        fromLocationId,
        toLocationId,
        lines: [{ itemId, baseQty: 500 }],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await balanceAt(fromLocationId)).toBe(12);
    expect(await balanceAt(toLocationId)).toBe(0);
  });

  it("rejects a transfer to the same location", async () => {
    await stockUp(lotSoon, 10);

    await expect(
      createStockTransfer({
        idempotencyKey: nextKey(),
        fromLocationId,
        toLocationId: fromLocationId,
        lines: [{ itemId, baseQty: 1 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("moves once when the same submission arrives twice", async () => {
    await stockUp(lotSoon, 30);

    const payload = {
      idempotencyKey: nextKey(),
      fromLocationId,
      toLocationId,
      lines: [{ itemId, baseQty: 10 }],
    };

    const first = await createStockTransfer(payload);
    const second = await createStockTransfer(payload);

    expect(second.replayed).toBe(true);
    expect(second.transferId).toBe(first.transferId);
    expect(await balanceAt(toLocationId)).toBe(10);
  });

  it("requires transfer.create", async () => {
    await stockUp(lotSoon, 10);
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(
      createStockTransfer({
        idempotencyKey: nextKey(),
        fromLocationId,
        toLocationId,
        lines: [{ itemId, baseQty: 1 }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
    expect(await balanceAt(toLocationId)).toBe(0);
  });
});

describe("transfer preview", () => {
  it("reports the balance at both ends before and after", async () => {
    await stockUp(lotSoon, 40);
    await stockUp(lotSoon, 5, toLocationId);

    const [line] = await previewTransfer({
      fromLocationId,
      toLocationId,
      lines: [{ itemId, baseQty: 12 }],
    });

    expect(line!.fromBefore).toBe("40.0000");
    expect(line!.fromAfter).toBe("28.0000");
    expect(line!.toBefore).toBe("5.0000");
    expect(line!.toAfter).toBe("17.0000");
    expect(line!.shortfallBaseQty).toBe("0.0000");
    expect(line!.lots).toHaveLength(1);
  });

  it("flags a shortfall without moving anything", async () => {
    await stockUp(lotSoon, 3);

    const [line] = await previewTransfer({
      fromLocationId,
      toLocationId,
      lines: [{ itemId, baseQty: 10 }],
    });

    expect(line!.shortfallBaseQty).toBe("7.0000");
    // A preview never changes the balance.
    expect(await balanceAt(fromLocationId)).toBe(3);
  });
});
