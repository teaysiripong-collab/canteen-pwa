import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 14. Alerts are derived, so the only honest way to test them is to create the real
 * condition, see the alert appear, fix the condition, and see it go — there is no row to
 * assert on in between. Each test does exactly that for one alert.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-alerts@canteen.local",
  fullName: "Integration Watcher",
  defaultLocationId: null as string | null,
  defaultLocationName: null,
  roleCodes: ["MANAGER"] as RoleCode[],
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
  menuPlanItems,
  menuPlans,
  mealPeriods,
  menus,
  organizations,
  purchaseOrderItems,
  purchaseOrders,
  stockBalances,
  suppliers,
  units,
  users,
} = await import("@/database/schema");
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { getAlerts, urgentAlerts } = await import("@/services/alert-service");

const TODAY = "2026-11-10";
const ORG_CODE = "TEST-ALERT-ORG";
const ITEM_CODE = "TEST-ALERT-ITEM";
const MENU_CODE = "TEST-ALERT-MENU";

let itemId = "";
let menuId = "";
let locationId = "";
let supplierId = "";
let kgUnitId = "";
let dayPeriodId = "";
let keyCounter = 0;

const alertIds = async () => (await getAlerts({ today: TODAY })).alerts.map((alert) => alert.id);

async function purgeStock() {
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

async function purgeOrders() {
  const orderRows = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.organizationId, actor.organizationId));
  const orderIds = orderRows.map((row) => row.id);
  if (orderIds.length === 0) return;
  await db.delete(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, orderIds));
  await db.delete(auditLogs).where(inArray(auditLogs.entityId, orderIds));
  await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
}

async function purgePlans() {
  const planRows = await db
    .select({ id: menuPlans.id })
    .from(menuPlans)
    .where(eq(menuPlans.organizationId, actor.organizationId));
  const planIds = planRows.map((row) => row.id);
  if (planIds.length === 0) return;
  await db.delete(menuPlanItems).where(inArray(menuPlanItems.menuPlanId, planIds));
  await db.delete(auditLogs).where(inArray(auditLogs.entityId, planIds));
  await db.delete(menuPlans).where(inArray(menuPlans.id, planIds));
}

/** Puts stock on hand with a chosen expiry date. */
async function stockWithExpiry(expiryDate: string, qty = 10) {
  const lot = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `ALERT-${(keyCounter += 1)}-${Date.now()}`,
    receivedBaseQty: qty,
    unitCost: 50,
    expiryDate,
  });
  await postMovementAs(actor, {
    idempotencyKey: `test-alert:${(keyCounter += 1)}:${Date.now()}`,
    referenceType: "GOODS_RECEIPT",
    lines: [{ type: "RECEIVE", itemId, lotId: lot.id, locationId, baseQty: qty }],
  });
  return lot;
}

async function makeOrder(status: "PENDING" | "APPROVED", expectedDate: string | null) {
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      organizationId: actor.organizationId,
      poNumber: `TEST-ALERT-PO-${(keyCounter += 1)}-${Date.now()}`,
      supplierId,
      deliverToLocationId: locationId,
      status,
      orderDate: TODAY,
      expectedDate,
    })
    .returning();

  await db.insert(purchaseOrderItems).values({
    purchaseOrderId: order!.id,
    itemId,
    orderedQty: "10",
    purchaseUnitId: kgUnitId,
    conversionToBase: "1",
    orderedBaseQty: "10",
    receivedBaseQty: "0",
    unitPrice: "50",
  });

  return order!;
}

async function makePlan(planDate: string, status: "DRAFT" | "CONFIRMED") {
  const [plan] = await db
    .insert(menuPlans)
    .values({
      organizationId: actor.organizationId,
      planDate,
      locationId,
      mealPeriodId: dayPeriodId,
      status,
    })
    .returning();

  await db.insert(menuPlanItems).values({
    menuPlanId: plan!.id,
    menuId,
    plannedServings: "1",
  });

  return plan!;
}

beforeAll(async () => {
  const [seedOrg] = await db.select().from(organizations).limit(1);
  if (!seedOrg) throw new Error("Run `npm run db:seed` before the integration tests.");

  /**
   * Alerts are organization-wide on purpose — that is what an alert centre is — so the
   * seeded canteen's own expiring stock would drown out anything this file sets up.
   * A throwaway organization makes every assertion exact instead of a delta.
   */
  const [organization] = await db
    .insert(organizations)
    .values({ code: ORG_CODE, name: "โรงอาหารทดสอบแจ้งเตือน" })
    .onConflictDoUpdate({ target: organizations.code, set: { name: "โรงอาหารทดสอบแจ้งเตือน" } })
    .returning();
  actor.organizationId = organization!.id;

  const [kg] = await db.select().from(units).where(eq(units.code, "KG")).limit(1);
  kgUnitId = kg!.id;

  await db.delete(users).where(eq(users.email, actor.email));
  const [userRow] = await db
    .insert(users)
    .values({ organizationId: actor.organizationId, email: actor.email, fullName: actor.fullName })
    .returning();
  actor.id = userRow!.id;

  const [location] = await db
    .insert(locations)
    .values({
      organizationId: actor.organizationId,
      code: "ALERT-STORE",
      nameTh: "สโตร์ทดสอบแจ้งเตือน",
      holdsStock: true,
    })
    .onConflictDoUpdate({
      target: [locations.organizationId, locations.code],
      set: { nameTh: "สโตร์ทดสอบแจ้งเตือน" },
    })
    .returning();
  locationId = location!.id;
  actor.defaultLocationId = locationId;

  const [period] = await db
    .insert(mealPeriods)
    .values({
      organizationId: actor.organizationId,
      code: "DAY",
      nameTh: "เช้า",
      startTime: "06:00",
      sortOrder: 1,
    })
    .onConflictDoUpdate({
      target: [mealPeriods.organizationId, mealPeriods.code],
      set: { nameTh: "เช้า" },
    })
    .returning();
  dayPeriodId = period!.id;

  const [supplier] = await db
    .insert(suppliers)
    .values({
      organizationId: actor.organizationId,
      code: "ALERT-SUP",
      nameTh: "ผู้ขายทดสอบแจ้งเตือน",
    })
    .onConflictDoUpdate({
      target: [suppliers.organizationId, suppliers.code],
      set: { nameTh: "ผู้ขายทดสอบแจ้งเตือน" },
    })
    .returning();
  supplierId = supplier!.id;

  const [item] = await db
    .insert(items)
    .values({
      organizationId: actor.organizationId,
      code: ITEM_CODE,
      nameTh: "วัตถุดิบทดสอบแจ้งเตือน",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
      reorderPoint: "0",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "วัตถุดิบทดสอบแจ้งเตือน" },
    })
    .returning();
  itemId = item!.id;

  const [menu] = await db
    .insert(menus)
    .values({ organizationId: actor.organizationId, code: MENU_CODE, nameTh: "เมนูทดสอบแจ้งเตือน" })
    .onConflictDoUpdate({
      target: [menus.organizationId, menus.code],
      set: { nameTh: "เมนูทดสอบแจ้งเตือน" },
    })
    .returning();
  menuId = menu!.id;
});

beforeEach(async () => {
  actor.permissions = Object.values(PERMISSIONS) as PermissionCode[];
  await purgeStock();
  await purgeOrders();
  await purgePlans();
  await db.update(items).set({ reorderPoint: "0" }).where(eq(items.id, itemId));
});

afterAll(async () => {
  await purgeStock();
  await purgeOrders();
  await purgePlans();
  await db.delete(menus).where(eq(menus.id, menuId));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(eq(users.email, actor.email));
  await db.delete(suppliers).where(eq(suppliers.id, supplierId));
  await db.delete(mealPeriods).where(eq(mealPeriods.id, dayPeriodId));
  await db.delete(locations).where(eq(locations.id, locationId));
  await db.delete(organizations).where(eq(organizations.id, actor.organizationId));
});

describe("expired stock", () => {
  it("appears when a lot is past its date but still has quantity", async () => {
    await stockWithExpiry("2026-11-01");

    const report = await getAlerts({ today: TODAY });
    const alert = report.alerts.find((entry) => entry.id === "expired-stock")!;

    expect(alert).toBeDefined();
    expect(alert.severity).toBe("critical");
    expect(alert.exampleTh).toContain("วัตถุดิบทดสอบแจ้งเตือน");
  });

  it("goes away once the stock is written off", async () => {
    const lot = await stockWithExpiry("2026-11-01");
    expect(await alertIds()).toContain("expired-stock");

    await postMovementAs(actor, {
      idempotencyKey: `test-alert-waste:${(keyCounter += 1)}:${Date.now()}`,
      referenceType: "MANUAL_ADJUSTMENT",
      lines: [{ type: "WASTE", itemId, lotId: lot.id, locationId, baseQty: 10 }],
    });

    // Nothing was dismissed; the condition itself is gone.
    expect(await alertIds()).not.toContain("expired-stock");
  });

  it("does not fire for a lot that expires today", async () => {
    await stockWithExpiry(TODAY);

    const ids = await alertIds();

    expect(ids).not.toContain("expired-stock");
    expect(ids).toContain("expiring-soon");
  });

  it("ignores an expired lot with nothing left in it", async () => {
    const lot = await stockWithExpiry("2026-11-01");
    await postMovementAs(actor, {
      idempotencyKey: `test-alert-drain:${(keyCounter += 1)}:${Date.now()}`,
      referenceType: "MANUAL_ADJUSTMENT",
      lines: [{ type: "WASTE", itemId, lotId: lot.id, locationId, baseQty: 10 }],
    });

    expect(await alertIds()).not.toContain("expired-stock");
  });
});

describe("reorder point", () => {
  it("fires when stock falls to the reorder point", async () => {
    await db.update(items).set({ reorderPoint: "20" }).where(eq(items.id, itemId));
    await stockWithExpiry("2030-01-01", 5);

    const alert = (await getAlerts({ today: TODAY })).alerts.find(
      (entry) => entry.id === "below-reorder",
    )!;

    expect(alert).toBeDefined();
    expect(alert.exampleTh).toContain("จุดสั่งซื้อ");
  });

  it("does not fire once stock is above the point", async () => {
    await db.update(items).set({ reorderPoint: "20" }).where(eq(items.id, itemId));
    await stockWithExpiry("2030-01-01", 50);

    expect(await alertIds()).not.toContain("below-reorder");
  });

  it("ignores items with no reorder point set", async () => {
    // Reorder point 0 means "not tracked", not "always below".
    await stockWithExpiry("2030-01-01", 0.0001);

    expect(await alertIds()).not.toContain("below-reorder");
  });
});

describe("purchase orders", () => {
  it("flags a delivery whose promised date has passed", async () => {
    await makeOrder("APPROVED", "2026-11-01");

    const alert = (await getAlerts({ today: TODAY })).alerts.find(
      (entry) => entry.id === "delivery-overdue",
    )!;

    expect(alert).toBeDefined();
    expect(alert.severity).toBe("critical");
  });

  it("stops flagging once every line has been received", async () => {
    const order = await makeOrder("APPROVED", "2026-11-01");
    expect(await alertIds()).toContain("delivery-overdue");

    await db
      .update(purchaseOrderItems)
      .set({ receivedBaseQty: "10" })
      .where(eq(purchaseOrderItems.purchaseOrderId, order.id));

    expect(await alertIds()).not.toContain("delivery-overdue");
  });

  it("does not flag an order that is not due yet", async () => {
    await makeOrder("APPROVED", "2026-12-01");

    expect(await alertIds()).not.toContain("delivery-overdue");
  });

  it("shows orders waiting for approval only to an approver", async () => {
    await makeOrder("PENDING", null);
    expect(await alertIds()).toContain("po-awaiting-approval");

    actor.permissions = [PERMISSIONS.PO_VIEW];
    expect(await alertIds()).not.toContain("po-awaiting-approval");
  });
});

describe("menu plans", () => {
  it("flags a draft plan for today", async () => {
    await makePlan(TODAY, "DRAFT");

    expect(await alertIds()).toContain("plan-unconfirmed");
  });

  it("stops flagging once the plan is confirmed", async () => {
    const plan = await makePlan(TODAY, "DRAFT");
    expect(await alertIds()).toContain("plan-unconfirmed");

    await db.update(menuPlans).set({ status: "CONFIRMED" }).where(eq(menuPlans.id, plan.id));

    const ids = await alertIds();
    expect(ids).not.toContain("plan-unconfirmed");
    // Confirmed but not yet issued is the next thing to do, so that one takes over.
    expect(ids).toContain("plan-not-issued");
  });

  it("ignores an empty draft plan with no menus on it", async () => {
    await db.insert(menuPlans).values({
      organizationId: actor.organizationId,
      planDate: TODAY,
      locationId,
      mealPeriodId: dayPeriodId,
      status: "DRAFT",
    });

    expect(await alertIds()).not.toContain("plan-unconfirmed");
  });

  it("does not flag a draft plan for next week", async () => {
    await makePlan("2026-11-20", "DRAFT");

    expect(await alertIds()).not.toContain("plan-unconfirmed");
  });
});

describe("permissions and ordering", () => {
  it("hides stock alerts from a user who cannot see stock", async () => {
    await stockWithExpiry("2026-11-01");
    actor.permissions = [PERMISSIONS.MENU_VIEW];

    expect(await alertIds()).not.toContain("expired-stock");
  });

  it("returns nothing at all for a user with no relevant permissions", async () => {
    await stockWithExpiry("2026-11-01");
    await makeOrder("APPROVED", "2026-11-01");
    actor.permissions = [PERMISSIONS.AUDIT_VIEW];

    const report = await getAlerts({ today: TODAY });

    expect(report.alerts).toHaveLength(0);
    expect(report.counts).toEqual({ critical: 0, warning: 0, info: 0 });
  });

  it("puts the things that spoil or cost money first", async () => {
    await stockWithExpiry("2026-11-01");
    await db.update(items).set({ reorderPoint: "20" }).where(eq(items.id, itemId));
    await makeOrder("PENDING", null);

    const report = await getAlerts({ today: TODAY });
    const rank = { critical: 0, warning: 1, info: 2 };
    const severities = report.alerts.map((alert) => alert.severity);

    expect(severities[0]).toBe("critical");
    // Non-decreasing by severity rank — alphabetical order would be a different thing.
    expect(severities.every((severity, index) =>
      index === 0 ? true : rank[severities[index - 1]!] <= rank[severity],
    )).toBe(true);
    expect(urgentAlerts(report).every((alert) => alert.severity !== "info")).toBe(true);
  });

  it("reports a clean canteen as having nothing to do", async () => {
    const report = await getAlerts({ today: TODAY });

    expect(report.alerts).toHaveLength(0);
    expect(report.today).toBe(TODAY);
  });
});
