import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 16. Writing stock off is the action the expiry alert points at, so it has to actually
 * remove the stock, cost the lot that spoiled rather than an average, and keep the reason as
 * data instead of prose. The posting is the document — there is no waste table to check.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-waste@canteen.local",
  fullName: "Integration Binner",
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
  units,
  users,
} = await import("@/database/schema");
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { getWasteByReason, listWastableLots, listWasteHistory, recordWaste } = await import(
  "@/services/waste-service"
);

const ITEM_CODE = "TEST-WASTE-ITEM";
const TODAY = "2026-12-01";

let itemId = "";
let locationId = "";
let kgUnitId = "";
let cheapLotId = "";
let dearLotId = "";
let keyCounter = 0;

const nextKey = () => `test-waste:${(keyCounter += 1)}:${Date.now()}`;

async function onHand(): Promise<number> {
  const rows = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.locationId, locationId)));
  return rows.reduce((sum, row) => sum + Number(row.baseQty), 0);
}

async function purge() {
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

  // Its own location, so "what could be written off here" is exactly this file's fixtures.
  const [location] = await db
    .insert(locations)
    .values({
      organizationId: organization.id,
      code: "TEST-WASTE-STORE",
      nameTh: "สโตร์ทดสอบของเสีย",
      holdsStock: true,
    })
    .onConflictDoUpdate({
      target: [locations.organizationId, locations.code],
      set: { nameTh: "สโตร์ทดสอบของเสีย" },
    })
    .returning();
  locationId = location!.id;
  actor.defaultLocationId = locationId;

  const [item] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: ITEM_CODE,
      nameTh: "ผักทดสอบของเสีย",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "ผักทดสอบของเสีย" },
    })
    .returning();
  itemId = item!.id;
});

beforeEach(async () => {
  actor.permissions = Object.values(PERMISSIONS) as PermissionCode[];
  await purge();

  // Two lots at different prices: writing off the dear one must cost the dear price.
  const dear = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `WASTE-DEAR-${(keyCounter += 1)}-${Date.now()}`,
    receivedBaseQty: 10,
    unitCost: 100,
    expiryDate: "2026-11-01",
  });
  const cheap = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `WASTE-CHEAP-${(keyCounter += 1)}-${Date.now()}`,
    receivedBaseQty: 10,
    unitCost: 20,
    expiryDate: "2030-01-01",
  });
  dearLotId = dear.id;
  cheapLotId = cheap.id;

  for (const [lotId, qty] of [
    [dearLotId, 10],
    [cheapLotId, 10],
  ] as const) {
    await postMovementAs(actor, {
      idempotencyKey: nextKey(),
      referenceType: "GOODS_RECEIPT",
      lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: qty }],
    });
  }
});

afterAll(async () => {
  await purge();
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
  await db.delete(locations).where(eq(locations.id, locationId));
});

describe("recording waste", () => {
  it("removes the stock and costs the lot that actually spoiled", async () => {
    const result = await recordWaste({
      idempotencyKey: nextKey(),
      locationId,
      reason: "EXPIRED",
      lines: [{ lotId: dearLotId, baseQty: 4 }],
    });

    expect(await onHand()).toBe(16);
    // 4 kg from the 100-baht lot, not the 60-baht average of the two lots.
    expect(Number(result.totalValue)).toBeCloseTo(400, 2);
  });

  it("keeps the reason as data rather than as a note", async () => {
    await recordWaste({
      idempotencyKey: nextKey(),
      locationId,
      reason: "CONTAMINATED",
      lines: [{ lotId: cheapLotId, baseQty: 2 }],
    });

    const [row] = await db
      .select({ reason: inventoryTransactions.wasteReason })
      .from(inventoryTransactions)
      .where(
        and(
          eq(inventoryTransactions.itemId, itemId),
          eq(inventoryTransactions.transactionType, "WASTE"),
        ),
      )
      .limit(1);

    expect(row!.reason).toBe("CONTAMINATED");
  });

  it("writes off several lots in one document", async () => {
    await recordWaste({
      idempotencyKey: nextKey(),
      locationId,
      reason: "SPOILED",
      lines: [
        { lotId: dearLotId, baseQty: 10 },
        { lotId: cheapLotId, baseQty: 5 },
      ],
    });

    expect(await onHand()).toBe(5);
  });

  it("cannot write off more than the lot holds", async () => {
    await expect(
      recordWaste({
        idempotencyKey: nextKey(),
        locationId,
        reason: "SPOILED",
        lines: [{ lotId: dearLotId, baseQty: 999 }],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await onHand()).toBe(20);
  });

  it("rejects a zero or negative quantity", async () => {
    await expect(
      recordWaste({
        idempotencyKey: nextKey(),
        locationId,
        reason: "OTHER",
        lines: [{ lotId: dearLotId, baseQty: 0 }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("does not write off twice when the button is pressed twice", async () => {
    const key = nextKey();
    await recordWaste({ idempotencyKey: key, locationId, reason: "EXPIRED", lines: [{ lotId: dearLotId, baseQty: 3 }] });
    const replay = await recordWaste({
      idempotencyKey: key,
      locationId,
      reason: "EXPIRED",
      lines: [{ lotId: dearLotId, baseQty: 3 }],
    });

    expect(replay.replayed).toBe(true);
    expect(await onHand()).toBe(17);
  });

  it("needs the adjustment permission", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(
      recordWaste({
        idempotencyKey: nextKey(),
        locationId,
        reason: "EXPIRED",
        lines: [{ lotId: dearLotId, baseQty: 1 }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await onHand()).toBe(20);
  });
});

describe("choosing what to write off", () => {
  it("lists lots with the expired ones first and flags them", async () => {
    const lots = await listWastableLots(actor.organizationId, locationId, { today: TODAY });

    expect(lots[0]!.lotId).toBe(dearLotId);
    expect(lots[0]!.isExpired).toBe(true);
    expect(lots[1]!.isExpired).toBe(false);
  });

  it("drops a lot once it has been fully written off", async () => {
    await recordWaste({
      idempotencyKey: nextKey(),
      locationId,
      reason: "EXPIRED",
      lines: [{ lotId: dearLotId, baseQty: 10 }],
    });

    const lots = await listWastableLots(actor.organizationId, locationId, { today: TODAY });

    expect(lots.map((lot) => lot.lotId)).not.toContain(dearLotId);
  });
});

describe("reporting", () => {
  it("splits the cost by cause", async () => {
    await recordWaste({
      idempotencyKey: nextKey(),
      locationId,
      reason: "EXPIRED",
      lines: [{ lotId: dearLotId, baseQty: 5 }],
    });
    await recordWaste({
      idempotencyKey: nextKey(),
      locationId,
      reason: "DAMAGED",
      lines: [{ lotId: cheapLotId, baseQty: 5 }],
    });

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    const byReason = await getWasteByReason(actor.organizationId, {
      fromDate: today,
      toDate: today,
    });

    const expired = byReason.find((entry) => entry.reason === "EXPIRED")!;
    const damaged = byReason.find((entry) => entry.reason === "DAMAGED")!;

    expect(Number(expired.value)).toBeCloseTo(500, 2);
    expect(Number(damaged.value)).toBeCloseTo(100, 2);
    // Sorted by cost, so the most expensive cause leads.
    expect(byReason[0]!.reason).toBe("EXPIRED");
  });

  it("shows the write-off in the history with who did it", async () => {
    await recordWaste({
      idempotencyKey: nextKey(),
      locationId,
      reason: "SPOILED",
      note: "ตู้เย็นเสีย",
      lines: [{ lotId: cheapLotId, baseQty: 3 }],
    });

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
    const history = await listWasteHistory(actor.organizationId, {
      fromDate: today,
      toDate: today,
      locationId,
    });

    expect(history).toHaveLength(1);
    expect(history[0]!.reason).toBe("SPOILED");
    expect(history[0]!.userName).toBe(actor.fullName);
    expect(history[0]!.note).toBe("ตู้เย็นเสีย");
    expect(Number(history[0]!.value)).toBeCloseTo(60, 2);
  });
});
