import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 15. Two properties matter here. A count measures against the balance frozen when the
 * sheet opened, not against whatever the balance is when someone finishes writing — otherwise
 * an issue posted mid-count silently becomes a "variance". And approval posts a movement
 * through the ledger rather than setting a balance, so the change stays explainable.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-count@canteen.local",
  fullName: "Integration Counter",
  defaultLocationId: null as string | null,
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
  stockCountItems,
  stockCountSessions,
  units,
  users,
} = await import("@/database/schema");
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const {
  approveCountSession,
  cancelCountSession,
  getCountSession,
  openCountSession,
  saveCountLines,
} = await import("@/services/stock-count-service");

const ITEM_CODE = "TEST-COUNT-ITEM";

let itemId = "";
let locationId = "";
let kgUnitId = "";
let lotId = "";
let keyCounter = 0;

const nextKey = () => `test-count:${(keyCounter += 1)}:${Date.now()}`;

async function onHand(): Promise<number> {
  const rows = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.locationId, locationId)));
  return rows.reduce((sum, row) => sum + Number(row.baseQty), 0);
}

async function purge() {
  const sessionRows = await db
    .select({ id: stockCountSessions.id })
    .from(stockCountSessions)
    .where(eq(stockCountSessions.organizationId, actor.organizationId));
  const sessionIds = sessionRows.map((row) => row.id);
  if (sessionIds.length > 0) {
    await db
      .delete(stockCountItems)
      .where(inArray(stockCountItems.stockCountSessionId, sessionIds));
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, sessionIds));
    await db.delete(stockCountSessions).where(inArray(stockCountSessions.id, sessionIds));
  }

  if (!itemId) return;
  const lots = await db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(eq(inventoryLots.itemId, itemId));
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
  kgUnitId = kg!.id;

  /**
   * A count sheet snapshots an entire location, so sharing a seeded one would put the
   * canteen's own stock on every sheet. This location exists only for this file.
   */
  const [location] = await db
    .insert(locations)
    .values({
      organizationId: organization.id,
      code: "TEST-COUNT-STORE",
      nameTh: "สโตร์ทดสอบตรวจนับ",
      holdsStock: true,
    })
    .onConflictDoUpdate({
      target: [locations.organizationId, locations.code],
      set: { nameTh: "สโตร์ทดสอบตรวจนับ" },
    })
    .returning();
  locationId = location!.id;
  actor.defaultLocationId = locationId;

  const [item] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: ITEM_CODE,
      nameTh: "วัตถุดิบทดสอบตรวจนับ",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "วัตถุดิบทดสอบตรวจนับ" },
    })
    .returning();
  itemId = item!.id;
});

beforeEach(async () => {
  actor.permissions = Object.values(PERMISSIONS) as PermissionCode[];
  await purge();

  const lot = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `COUNT-${(keyCounter += 1)}-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 50,
    expiryDate: "2030-12-31",
  });
  lotId = lot.id;

  await postMovementAs(actor, {
    idempotencyKey: nextKey(),
    referenceType: "GOODS_RECEIPT",
    lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: 100 }],
  });
});

afterAll(async () => {
  await purge();
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
  await db.delete(locations).where(eq(locations.id, locationId));
});

describe("opening a sheet", () => {
  it("snapshots the balance of every lot on hand", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;

    const line = detail.lines.find((entry) => entry.lotId === lotId)!;
    expect(line.systemBaseQty).toBe("100.0000");
    expect(line.countedBaseQty).toBeNull();
  });

  it("refuses a second open sheet for the same location", async () => {
    await openCountSession({ locationId });

    await expect(openCountSession({ locationId })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("needs the counting permission", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(openCountSession({ locationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("variance", () => {
  it("measures against the snapshot, not against stock that moved during the count", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;
    const line = detail.lines.find((entry) => entry.lotId === lotId)!;

    // Someone issues 30 kg while the shelves are being counted.
    await postMovementAs(actor, {
      idempotencyKey: nextKey(),
      referenceType: "STOCK_ISSUE",
      lines: [{ type: "ISSUE", itemId, lotId, locationId, baseQty: 30 }],
    });

    // The counter saw 100 on the shelf before that issue left the store.
    await saveCountLines(opened.sessionId, [{ lineId: line.id, countedBaseQty: 100 }]);

    const after = (await getCountSession(actor.organizationId, opened.sessionId))!;
    const counted = after.lines.find((entry) => entry.lotId === lotId)!;

    // Zero variance: the count matched what the system believed when counting started.
    expect(counted.varianceBaseQty).toBe("0.0000");
    expect(after.totals.varianceLines).toBe(0);
  });

  it("reports a shortfall as a negative variance", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;

    await saveCountLines(opened.sessionId, [
      { lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 92 },
    ]);

    const after = (await getCountSession(actor.organizationId, opened.sessionId))!;

    expect(after.lines.find((entry) => entry.lotId === lotId)!.varianceBaseQty).toBe("-8.0000");
    expect(Number(after.totals.varianceValue)).toBeCloseTo(-400, 2);
  });

  it("clears a count back to not-yet-counted", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;

    await saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 92 }]);
    await saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: null }]);

    const after = (await getCountSession(actor.organizationId, opened.sessionId))!;
    expect(after.lines.find((entry) => entry.lotId === lotId)!.countedBaseQty).toBeNull();
    expect(after.totals.countedLines).toBe(0);
  });

  it("refuses a negative count", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;

    await expect(
      saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: -1 }]),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("approval", () => {
  it("posts the difference through the ledger and moves the balance", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;
    await saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 92 }]);

    const result = await approveCountSession(opened.sessionId, nextKey());

    expect(result.adjustedLines).toBe(1);
    expect(await onHand()).toBe(92);

    // The change is a movement, not a silent overwrite.
    const movements = await db
      .select({ type: inventoryTransactions.transactionType, baseQty: inventoryTransactions.baseQty })
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.postingId, result.postingId!));

    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe("ADJUSTMENT_OUT");
    expect(movements[0]!.baseQty).toBe("8.0000");
  });

  it("posts an increase when the shelf holds more than the system knew", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;
    await saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 105 }]);

    const result = await approveCountSession(opened.sessionId, nextKey());

    expect(await onHand()).toBe(105);
    const [movement] = await db
      .select({ type: inventoryTransactions.transactionType })
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.postingId, result.postingId!));
    expect(movement!.type).toBe("ADJUSTMENT_IN");
  });

  it("posts nothing when everything matched", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;
    await saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 100 }]);

    const result = await approveCountSession(opened.sessionId, nextKey());

    expect(result.adjustedLines).toBe(0);
    expect(result.postingId).toBeNull();
    expect(await onHand()).toBe(100);
  });

  it("refuses to approve a half-finished sheet", async () => {
    const opened = await openCountSession({ locationId });

    await expect(approveCountSession(opened.sessionId, nextKey())).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await onHand()).toBe(100);
  });

  it("needs the approval permission, which is separate from counting", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;
    await saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 92 }]);

    actor.permissions = [PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_COUNT_CREATE];

    await expect(approveCountSession(opened.sessionId, nextKey())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await onHand()).toBe(100);
  });

  it("cannot be approved twice", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;
    await saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 92 }]);

    await approveCountSession(opened.sessionId, nextKey());

    await expect(approveCountSession(opened.sessionId, nextKey())).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await onHand()).toBe(92);
  });

  it("locks the sheet against further edits once approved", async () => {
    const opened = await openCountSession({ locationId });
    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;
    await saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 92 }]);
    await approveCountSession(opened.sessionId, nextKey());

    await expect(
      saveCountLines(opened.sessionId, [{ lineId: detail.lines.find((entry) => entry.lotId === lotId)!.id, countedBaseQty: 50 }]),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("cancelling", () => {
  it("closes the sheet without moving any stock", async () => {
    const opened = await openCountSession({ locationId });

    await cancelCountSession(opened.sessionId, "นับผิดรอบ");

    const detail = (await getCountSession(actor.organizationId, opened.sessionId))!;
    expect(detail.session.status).toBe("CANCELLED");
    expect(await onHand()).toBe(100);

    // A cancelled sheet frees the location for a fresh one.
    await expect(openCountSession({ locationId })).resolves.toMatchObject({ lineCount: 1 });
  });
});
