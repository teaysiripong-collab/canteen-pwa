import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Gate 4 of the roadmap: with a lot expiring 15 Aug and one expiring 20 Aug, the system
 * must consume 15 Aug first — proven against real balances rather than an in-memory list.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-fefo@canteen.local",
  fullName: "Integration FEFO",
  defaultLocationId: null,
  defaultLocationName: null,
  roleCodes: ["MANAGER"] as RoleCode[],
  permissions: Object.values(PERMISSIONS) as PermissionCode[],
};

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
const {
  listUsableLots,
  planFefoAllocation,
  planManualAllocation,
  toMovementLines,
} = await import("@/services/inventory-allocation-service");
const { getExpiryAlerts } = await import("@/services/expiry-service");

const ITEM_CODE = "TEST-FEFO-001";
const TODAY = "2026-08-13";

let itemId = "";
let locationId = "";
let lotAugust15 = "";
let lotAugust20 = "";
let lotExpired = "";
let keyCounter = 0;

const nextKey = (label: string) => `test-fefo:${label}:${(keyCounter += 1)}:${Date.now()}`;

async function balanceOf(lotId: string): Promise<string> {
  const [row] = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.lotId, lotId), eq(stockBalances.locationId, locationId)))
    .limit(1);
  return row?.baseQty ?? "0";
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

/** Receives `qty` of a lot so the balance the allocator reads is real. */
async function receive(lotId: string, qty: number) {
  await postMovementAs(actor, {
    idempotencyKey: nextKey("receive"),
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
  const [b16] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.code, "B16")))
    .limit(1);
  locationId = b16!.id;

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
        nameTh: "กะหล่ำปลี (ทดสอบ FEFO)",
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

  // Deliberately created newest-expiry-first, so passing only proves the ordering works.
  const later = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `FEFO-B-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 25,
    expiryDate: "2026-08-20",
    receivedDate: "2026-08-01",
  });
  const sooner = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `FEFO-A-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 27,
    expiryDate: "2026-08-15",
    receivedDate: "2026-08-05",
  });
  const expired = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `FEFO-X-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 20,
    expiryDate: "2026-08-10",
    receivedDate: "2026-07-28",
  });

  lotAugust20 = later.id;
  lotAugust15 = sooner.id;
  lotExpired = expired.id;
});

afterAll(async () => {
  await purge();
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("FEFO allocation against real balances", () => {
  it("takes the lot expiring 15 Aug before the one expiring 20 Aug", async () => {
    await receive(lotAugust20, 40);
    await receive(lotAugust15, 40);

    const plan = await planFefoAllocation({
      organizationId: actor.organizationId,
      itemId,
      locationId,
      baseQty: 10,
      today: TODAY,
    });

    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]!.lotId).toBe(lotAugust15);
    expect(plan.lines[0]!.expiryDate).toBe("2026-08-15");
    expect(plan.shortfallBaseQty).toBe("0.0000");
  });

  it("spreads a request across lots when one is not enough", async () => {
    await receive(lotAugust15, 12);
    await receive(lotAugust20, 30);

    const plan = await planFefoAllocation({
      organizationId: actor.organizationId,
      itemId,
      locationId,
      baseQty: 20,
      today: TODAY,
    });

    expect(plan.lines.map((line) => [line.lotId, line.baseQty])).toEqual([
      [lotAugust15, "12.0000"],
      [lotAugust20, "8.0000"],
    ]);
    expect(plan.shortfallBaseQty).toBe("0.0000");
  });

  it("keeps expired stock out of the plan and reports it separately", async () => {
    await receive(lotExpired, 50);
    await receive(lotAugust15, 5);

    const plan = await planFefoAllocation({
      organizationId: actor.organizationId,
      itemId,
      locationId,
      baseQty: 20,
      today: TODAY,
    });

    // The expired lot has the earliest date but must never be cooked.
    expect(plan.lines.every((line) => line.lotId !== lotExpired)).toBe(true);
    expect(plan.usableBaseQty).toBe("5.0000");
    expect(plan.expiredBaseQty).toBe("50.0000");
    expect(plan.shortfallBaseQty).toBe("15.0000");
  });

  it("reports a shortfall instead of over-allocating", async () => {
    await receive(lotAugust15, 4);

    const plan = await planFefoAllocation({
      organizationId: actor.organizationId,
      itemId,
      locationId,
      baseQty: 10,
      today: TODAY,
    });

    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]!.baseQty).toBe("4.0000");
    expect(plan.shortfallBaseQty).toBe("6.0000");
  });

  it("produces lines the ledger accepts, and the balances match afterwards", async () => {
    await receive(lotAugust15, 12);
    await receive(lotAugust20, 30);

    const plan = await planFefoAllocation({
      organizationId: actor.organizationId,
      itemId,
      locationId,
      baseQty: 20,
      today: TODAY,
    });

    await postMovementAs(actor, {
      idempotencyKey: nextKey("issue-plan"),
      referenceType: "STOCK_ISSUE",
      lines: toMovementLines(plan, "ISSUE"),
    });

    expect(await balanceOf(lotAugust15)).toBe("0.0000");
    expect(await balanceOf(lotAugust20)).toBe("22.0000");
  });

  it("flags a manual pick that skips the earliest-expiring lot", async () => {
    await receive(lotAugust15, 20);
    await receive(lotAugust20, 20);

    const override = await planManualAllocation({
      organizationId: actor.organizationId,
      itemId,
      locationId,
      picks: [{ lotId: lotAugust20, baseQty: 5 }],
      today: TODAY,
    });

    expect(override.overridesFefo).toBe(true);
    expect(override.lines[0]!.lotId).toBe(lotAugust20);
  });

  it("does not call a manual pick an override when it matches FEFO", async () => {
    await receive(lotAugust15, 20);
    await receive(lotAugust20, 20);

    const same = await planManualAllocation({
      organizationId: actor.organizationId,
      itemId,
      locationId,
      picks: [{ lotId: lotAugust15, baseQty: 5 }],
      today: TODAY,
    });

    expect(same.overridesFefo).toBe(false);
  });

  it("refuses a manual pick larger than the lot holds", async () => {
    await receive(lotAugust15, 3);

    await expect(
      planManualAllocation({
        organizationId: actor.organizationId,
        itemId,
        locationId,
        picks: [{ lotId: lotAugust15, baseQty: 10 }],
        today: TODAY,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });

  it("requires fefo.override to pick lots by hand", async () => {
    await receive(lotAugust15, 10);
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.STOCK_VIEW, PERMISSIONS.ISSUE_CREATE];

    await expect(
      planManualAllocation({
        organizationId: actor.organizationId,
        itemId,
        locationId,
        picks: [{ lotId: lotAugust15, baseQty: 1 }],
        today: TODAY,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
  });

  it("only offers lots that still have stock at that location", async () => {
    await receive(lotAugust15, 6);

    const lots = await listUsableLots(actor.organizationId, itemId, locationId, TODAY);
    expect(lots.map((lot) => lot.lotId)).toEqual([lotAugust15]);
    expect(lots[0]!.availableBaseQty).toBe("6.0000");
  });
});

describe("expiry alerts", () => {
  it("groups lots into expired, today and the configured thresholds", async () => {
    await receive(lotExpired, 7);
    await receive(lotAugust15, 8);
    await receive(lotAugust20, 9);

    const alerts = await getExpiryAlerts(actor.organizationId, { today: TODAY });

    const ours = (key: number) =>
      alerts.groups.find((group) => group.key === key)?.lots.filter((lot) => lot.itemId === itemId) ??
      [];

    // 10 Aug is in the past, 15 Aug is 2 days out (the 3-day bucket), 20 Aug is 7 days out.
    expect(ours(-1).map((lot) => lot.lotId)).toEqual([lotExpired]);
    expect(ours(3).map((lot) => lot.lotId)).toEqual([lotAugust15]);
    expect(ours(7).map((lot) => lot.lotId)).toEqual([lotAugust20]);
    expect(alerts.thresholds).toEqual([1, 3, 7]);
  });

  it("counts the days left from the business date", async () => {
    await receive(lotAugust15, 5);

    const alerts = await getExpiryAlerts(actor.organizationId, { today: TODAY });
    const lot = alerts.groups.flatMap((group) => group.lots).find((row) => row.lotId === lotAugust15);

    expect(lot?.daysLeft).toBe(2);
  });

  it("marks an expired lot with a negative day count", async () => {
    await receive(lotExpired, 5);

    const alerts = await getExpiryAlerts(actor.organizationId, { today: TODAY });
    const lot = alerts.groups.flatMap((group) => group.lots).find((row) => row.lotId === lotExpired);

    expect(lot?.daysLeft).toBe(-3);
    expect(alerts.groups.find((group) => group.key === -1)?.tone).toBe("critical");
  });
});
