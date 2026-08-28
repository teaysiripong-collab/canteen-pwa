import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 12. The planner is one subtraction done honestly:
 *
 *     shortfall = requirement + safety stock − on hand − already on order
 *
 * These tests pull each term out one at a time and check it actually moves the answer, then
 * check that running the planner twice refreshes its draft instead of ordering everything
 * a second time.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-planner@canteen.local",
  fullName: "Integration Buyer",
  defaultLocationId: null,
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
  menus,
  organizations,
  purchaseOrderItems,
  purchaseOrders,
  recipeItemPeriodQuantities,
  recipeItems,
  recipeVersions,
  recipes,
  stockBalances,
  supplierItems,
  suppliers,
  units,
  users,
} = await import("@/database/schema");
const { openDraftVersion, publishBomVersion, saveBomDraft, listMealPeriods } = await import(
  "@/services/bom-service"
);
const { getOrCreatePlan, setPlanMenus, setPlanStatus } = await import(
  "@/services/menu-plan-service"
);
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { setPurchaseOrderStatus } = await import("@/services/purchase-order-service");
const { createDraftOrdersFromPlan, getPurchasePlan } = await import(
  "@/services/purchase-planner-service"
);

const PLAN_DATE = "2026-09-15";
const FROM = "2026-09-14";
const TO = "2026-09-16";
/** Well before the plan date, so nothing is "late" unless a test says so. */
const TODAY = "2026-09-01";

const MENU_CODE = "TEST-BUY-MENU";
const CHICKEN_CODE = "TEST-BUY-CHICKEN";
const RICE_CODE = "TEST-BUY-RICE";
const ORPHAN_CODE = "TEST-BUY-ORPHAN";
const SUPPLIER_A = "TEST-BUY-SUP-A";
const SUPPLIER_B = "TEST-BUY-SUP-B";

let menuId = "";
let chickenId = "";
let riceId = "";
let orphanId = "";
let supplierAId = "";
let supplierBId = "";
let locationId = "";
let kgUnitId = "";
let sackUnitId = "";
let dayPeriodId = "";
let keyCounter = 0;

const nextKey = () => `test-buy:${(keyCounter += 1)}:${Date.now()}`;

const plan = () =>
  getPurchasePlan({
    organizationId: actor.organizationId,
    fromDate: FROM,
    toDate: TO,
    locationId,
    today: TODAY,
  });

function lineFor(report: Awaited<ReturnType<typeof plan>>, itemId: string) {
  for (const group of report.groups) {
    const found = group.lines.find((line) => line.itemId === itemId);
    if (found) return found;
  }
  return report.unsourced.find((line) => line.itemId === itemId) ?? null;
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

async function purgeStock() {
  const testItemIds = [chickenId, riceId, orphanId].filter(Boolean);
  if (testItemIds.length === 0) return;

  const lots = await db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(inArray(inventoryLots.itemId, testItemIds));
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

async function purgeRecipes() {
  if (!menuId) return;
  const recipeRows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.menuId, menuId));
  const recipeIds = recipeRows.map((row) => row.id);
  if (recipeIds.length === 0) return;

  const versionRows = await db
    .select({ id: recipeVersions.id })
    .from(recipeVersions)
    .where(inArray(recipeVersions.recipeId, recipeIds));
  const versionIds = versionRows.map((row) => row.id);

  if (versionIds.length > 0) {
    const itemRows = await db
      .select({ id: recipeItems.id })
      .from(recipeItems)
      .where(inArray(recipeItems.recipeVersionId, versionIds));
    const itemIds = itemRows.map((row) => row.id);
    if (itemIds.length > 0) {
      await db
        .delete(recipeItemPeriodQuantities)
        .where(inArray(recipeItemPeriodQuantities.recipeItemId, itemIds));
      await db.delete(recipeItems).where(inArray(recipeItems.id, itemIds));
    }
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, versionIds));
    await db.delete(recipeVersions).where(inArray(recipeVersions.id, versionIds));
  }
  await db.delete(recipes).where(inArray(recipes.id, recipeIds));
}

/** A confirmed plan for the day shift: 1 serving of the menu, so the BOM applies as written. */
async function confirmPlan(servings = 1) {
  const created = await getOrCreatePlan({
    planDate: PLAN_DATE,
    locationId,
    mealPeriodId: dayPeriodId,
  });
  await setPlanMenus(created.id, [{ menuId, plannedServings: servings }]);
  await setPlanStatus(created.id, "CONFIRMED");
  return created;
}

async function putInStock(itemId: string, qty: number) {
  const lot = await createLot({
    organizationId: actor.organizationId,
    itemId,
    lotNumber: `BUY-${Date.now()}-${(keyCounter += 1)}`,
    receivedBaseQty: qty,
    unitCost: 50,
    expiryDate: "2030-12-31",
  });
  await postMovementAs(actor, {
    idempotencyKey: nextKey(),
    referenceType: "GOODS_RECEIPT",
    lines: [{ type: "RECEIVE", itemId, lotId: lot.id, locationId, baseQty: qty }],
  });
}

/** An outstanding purchase order line, moved past DRAFT so it counts as stock on its way. */
async function placeOrder(itemId: string, purchaseQty: number, conversion: number) {
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      organizationId: actor.organizationId,
      poNumber: `TEST-BUY-PO-${(keyCounter += 1)}-${Date.now()}`,
      supplierId: supplierAId,
      deliverToLocationId: locationId,
      status: "DRAFT",
      orderDate: TODAY,
      createdBy: actor.id,
    })
    .returning();

  await db.insert(purchaseOrderItems).values({
    purchaseOrderId: order!.id,
    itemId,
    orderedQty: String(purchaseQty),
    purchaseUnitId: kgUnitId,
    conversionToBase: String(conversion),
    orderedBaseQty: String(purchaseQty * conversion),
    unitPrice: "50",
  });

  await setPurchaseOrderStatus(order!.id, "PENDING");
  return order!;
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

  const [sack] = await db
    .insert(units)
    .values({ code: "TEST-SACK", nameTh: "กระสอบ (ทดสอบ)", dimension: "WEIGHT" })
    .onConflictDoUpdate({ target: units.code, set: { nameTh: "กระสอบ (ทดสอบ)" } })
    .returning();
  sackUnitId = sack!.id;

  const [b16] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.code, "B16")))
    .limit(1);
  locationId = b16!.id;

  const periods = await listMealPeriods(organization.id);
  dayPeriodId = periods[0]!.id;

  const itemSpecs = [
    { code: CHICKEN_CODE, nameTh: "ไก่บด (ทดสอบซื้อ)", safetyStock: "0" },
    { code: RICE_CODE, nameTh: "ข้าวสาร (ทดสอบซื้อ)", safetyStock: "0" },
    { code: ORPHAN_CODE, nameTh: "พริกไทย (ทดสอบซื้อ)", safetyStock: "0" },
  ];

  for (const spec of itemSpecs) {
    const [row] = await db
      .insert(items)
      .values({
        organizationId: organization.id,
        code: spec.code,
        nameTh: spec.nameTh,
        baseUnitId: kgUnitId,
        purchaseUnitId: kgUnitId,
        purchaseConversion: "1",
        safetyStock: spec.safetyStock,
      })
      .onConflictDoUpdate({
        target: [items.organizationId, items.code],
        set: { nameTh: spec.nameTh },
      })
      .returning();

    if (spec.code === CHICKEN_CODE) chickenId = row!.id;
    else if (spec.code === RICE_CODE) riceId = row!.id;
    else orphanId = row!.id;
  }

  for (const [code, nameTh, leadTime] of [
    [SUPPLIER_A, "ผู้ขาย ก (ทดสอบซื้อ)", 2],
    [SUPPLIER_B, "ผู้ขาย ข (ทดสอบซื้อ)", 30],
  ] as const) {
    const [row] = await db
      .insert(suppliers)
      .values({
        organizationId: organization.id,
        code,
        nameTh,
        leadTimeDays: leadTime,
      })
      .onConflictDoUpdate({
        target: [suppliers.organizationId, suppliers.code],
        set: { nameTh, leadTimeDays: leadTime },
      })
      .returning();
    if (code === SUPPLIER_A) supplierAId = row!.id;
    else supplierBId = row!.id;
  }

  const [menu] = await db
    .insert(menus)
    .values({ organizationId: organization.id, code: MENU_CODE, nameTh: "ข้าวไก่ (ทดสอบซื้อ)" })
    .onConflictDoUpdate({
      target: [menus.organizationId, menus.code],
      set: { nameTh: "ข้าวไก่ (ทดสอบซื้อ)" },
    })
    .returning();
  menuId = menu!.id;

  await purgeOrders();
  await purgePlans();
  await purgeStock();
  await purgeRecipes();

  // Day shift needs 30 kg chicken, 10 kg rice and 1 kg of the unsourced item.
  const draft = await openDraftVersion(menuId);
  await saveBomDraft({
    recipeVersionId: draft.id,
    yieldQty: 1,
    yieldUnitId: null,
    lines: [
      { itemId: chickenId, unitId: kgUnitId, quantityInput: "30+20", wasteFactor: 0 },
      { itemId: riceId, unitId: kgUnitId, quantityInput: "10+10", wasteFactor: 0 },
      { itemId: orphanId, unitId: kgUnitId, quantityInput: "1+1", wasteFactor: 0 },
    ],
  });
  await publishBomVersion(draft.id, "2020-01-01");
});

beforeEach(async () => {
  actor.permissions = Object.values(PERMISSIONS) as PermissionCode[];
  await purgeOrders();
  await purgePlans();
  await purgeStock();
  await db.delete(supplierItems).where(inArray(supplierItems.itemId, [chickenId, riceId]));
  await db
    .update(items)
    .set({ safetyStock: "0" })
    .where(inArray(items.id, [chickenId, riceId, orphanId]));

  // Supplier A sells chicken by the kilo, no minimum; rice comes in 25 kg sacks.
  await db.insert(supplierItems).values([
    {
      supplierId: supplierAId,
      itemId: chickenId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
      moq: "0",
      lastPrice: "90",
      isPreferred: true,
    },
    {
      supplierId: supplierAId,
      itemId: riceId,
      purchaseUnitId: sackUnitId,
      purchaseConversion: "25",
      moq: "1",
      lastPrice: "600",
      isPreferred: true,
    },
  ]);
});

afterAll(async () => {
  await purgeOrders();
  await purgePlans();
  await purgeStock();
  await purgeRecipes();
  await db.delete(supplierItems).where(inArray(supplierItems.itemId, [chickenId, riceId, orphanId]));
  await db.delete(menus).where(eq(menus.id, menuId));
  await db.delete(items).where(inArray(items.id, [chickenId, riceId, orphanId]));
  await db.delete(suppliers).where(inArray(suppliers.id, [supplierAId, supplierBId]));
  await db.delete(units).where(eq(units.id, sackUnitId));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("the shortfall calculation", () => {
  it("asks for the whole requirement when the store is empty", async () => {
    await confirmPlan();

    const report = await plan();
    const chicken = lineFor(report, chickenId)!;

    expect(chicken.requiredBaseQty).toBe("30.0000");
    expect(chicken.onHandBaseQty).toBe("0.0000");
    expect(chicken.shortfallBaseQty).toBe("30.0000");
    expect(chicken.suggestedPurchaseQty).toBe("30.0000");
  });

  it("subtracts what is already in the store", async () => {
    await confirmPlan();
    await putInStock(chickenId, 12);

    const chicken = lineFor(await plan(), chickenId)!;

    expect(chicken.onHandBaseQty).toBe("12.0000");
    expect(chicken.shortfallBaseQty).toBe("18.0000");
  });

  it("subtracts what has already been ordered and not yet delivered", async () => {
    await confirmPlan();
    await placeOrder(chickenId, 20, 1);

    const chicken = lineFor(await plan(), chickenId)!;

    expect(chicken.onOrderBaseQty).toBe("20.0000");
    expect(chicken.shortfallBaseQty).toBe("10.0000");
  });

  it("does not treat a draft order as stock on its way", async () => {
    await confirmPlan();
    const [order] = await db
      .insert(purchaseOrders)
      .values({
        organizationId: actor.organizationId,
        poNumber: `TEST-BUY-DRAFT-${Date.now()}`,
        supplierId: supplierAId,
        deliverToLocationId: locationId,
        status: "DRAFT",
        orderDate: TODAY,
      })
      .returning();
    await db.insert(purchaseOrderItems).values({
      purchaseOrderId: order!.id,
      itemId: chickenId,
      orderedQty: "30",
      purchaseUnitId: kgUnitId,
      conversionToBase: "1",
      orderedBaseQty: "30",
      unitPrice: "90",
    });

    const chicken = lineFor(await plan(), chickenId)!;

    // A draft is nobody's promise; the kitchen would still be 30 kg short.
    expect(chicken.onOrderBaseQty).toBe("0.0000");
    expect(chicken.shortfallBaseQty).toBe("30.0000");
  });

  it("adds safety stock on top of the requirement", async () => {
    await db.update(items).set({ safetyStock: "5" }).where(eq(items.id, chickenId));
    await confirmPlan();

    const chicken = lineFor(await plan(), chickenId)!;

    expect(chicken.safetyStockBaseQty).toBe("5.0000");
    expect(chicken.shortfallBaseQty).toBe("35.0000");
  });

  it("drops an item entirely once stock and orders cover it", async () => {
    await confirmPlan();
    await putInStock(chickenId, 20);
    await placeOrder(chickenId, 15, 1);

    const report = await plan();

    expect(lineFor(report, chickenId)).toBeNull();
    expect(report.coveredCount).toBeGreaterThan(0);
  });

  it("ignores a plan that is still a draft", async () => {
    const created = await getOrCreatePlan({
      planDate: PLAN_DATE,
      locationId,
      mealPeriodId: dayPeriodId,
    });
    await setPlanMenus(created.id, [{ menuId, plannedServings: 1 }]);

    const report = await plan();

    expect(report.groups).toHaveLength(0);
    expect(report.unconfirmedPlans).toBe(1);
  });

  it("scales with how many times the menu is cooked", async () => {
    await confirmPlan(3);

    expect(lineFor(await plan(), chickenId)!.shortfallBaseQty).toBe("90.0000");
  });
});

describe("supplier rules", () => {
  it("rounds up to a whole sack and says how much that overshoots", async () => {
    await confirmPlan();

    const rice = lineFor(await plan(), riceId)!;

    // 10 kg needed, sold in 25 kg sacks.
    expect(rice.shortfallBaseQty).toBe("10.0000");
    expect(rice.suggestedPurchaseQty).toBe("1.0000");
    expect(rice.suggestedBaseQty).toBe("25.0000");
    expect(rice.surplusBaseQty).toBe("15.0000");
  });

  it("lifts a small order up to the supplier's minimum", async () => {
    await db
      .update(supplierItems)
      .set({ moq: "50" })
      .where(and(eq(supplierItems.supplierId, supplierAId), eq(supplierItems.itemId, chickenId)));
    await confirmPlan();

    const chicken = lineFor(await plan(), chickenId)!;

    expect(chicken.shortfallBaseQty).toBe("30.0000");
    expect(chicken.suggestedPurchaseQty).toBe("50.0000");
    expect(chicken.surplusBaseQty).toBe("20.0000");
  });

  it("prefers the supplier marked preferred over the cheaper one", async () => {
    await db.insert(supplierItems).values({
      supplierId: supplierBId,
      itemId: chickenId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
      lastPrice: "40",
      isPreferred: false,
    });
    await confirmPlan();

    expect(lineFor(await plan(), chickenId)!.supplierId).toBe(supplierAId);
  });

  it("falls back to the cheapest known price when nobody is preferred", async () => {
    await db
      .update(supplierItems)
      .set({ isPreferred: false })
      .where(and(eq(supplierItems.supplierId, supplierAId), eq(supplierItems.itemId, chickenId)));
    await db.insert(supplierItems).values({
      supplierId: supplierBId,
      itemId: chickenId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
      lastPrice: "40",
      isPreferred: false,
    });
    await confirmPlan();

    expect(lineFor(await plan(), chickenId)!.supplierId).toBe(supplierBId);
  });

  it("ignores a supplier that has been deactivated", async () => {
    await db.update(suppliers).set({ isActive: false }).where(eq(suppliers.id, supplierAId));
    await confirmPlan();

    const report = await plan();
    await db.update(suppliers).set({ isActive: true }).where(eq(suppliers.id, supplierAId));

    expect(report.groups).toHaveLength(0);
    expect(report.unsourced.map((line) => line.itemId)).toContain(chickenId);
  });

  it("sets an item with no supplier aside instead of dropping it", async () => {
    await confirmPlan();

    const report = await plan();

    expect(report.unsourced.map((line) => line.itemId)).toContain(orphanId);
    expect(lineFor(report, orphanId)!.shortfallBaseQty).toBe("1.0000");
  });

  it("counts the lead time back to an order-by date", async () => {
    await confirmPlan();

    const chicken = lineFor(await plan(), chickenId)!;

    // Supplier A takes 2 days and the food is cooked on the 15th.
    expect(chicken.firstNeededDate).toBe(PLAN_DATE);
    expect(chicken.leadTimeDays).toBe(2);
    expect(chicken.orderByDate).toBe("2026-09-13");
    expect(chicken.isLate).toBe(false);
  });

  it("flags an order whose lead time no longer fits", async () => {
    await db
      .update(supplierItems)
      .set({ leadTimeDays: 60 })
      .where(and(eq(supplierItems.supplierId, supplierAId), eq(supplierItems.itemId, chickenId)));
    await confirmPlan();

    const report = await plan();
    const chicken = lineFor(report, chickenId)!;

    expect(chicken.isLate).toBe(true);
    expect(report.groups.find((group) => group.supplierId === supplierAId)!.isLate).toBe(true);
  });
});

describe("turning the plan into draft orders", () => {
  it("creates one draft per supplier with the suggested quantities", async () => {
    await confirmPlan();

    const orders = await createDraftOrdersFromPlan({
      fromDate: FROM,
      toDate: TO,
      locationId,
      supplierIds: [supplierAId],
    });

    expect(orders).toHaveLength(1);
    expect(orders[0]!.refreshed).toBe(false);

    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orders[0]!.purchaseOrderId));
    expect(order!.status).toBe("DRAFT");

    const lines = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orders[0]!.purchaseOrderId));

    const chickenLine = lines.find((line) => line.itemId === chickenId)!;
    expect(chickenLine.orderedQty).toBe("30.0000");
    expect(chickenLine.orderedBaseQty).toBe("30.0000");

    const riceLine = lines.find((line) => line.itemId === riceId)!;
    expect(riceLine.orderedQty).toBe("1.0000");
    expect(riceLine.orderedBaseQty).toBe("25.0000");
  });

  it("refreshes its own draft instead of ordering everything twice", async () => {
    await confirmPlan();

    const first = await createDraftOrdersFromPlan({
      fromDate: FROM,
      toDate: TO,
      locationId,
      supplierIds: [supplierAId],
    });
    const second = await createDraftOrdersFromPlan({
      fromDate: FROM,
      toDate: TO,
      locationId,
      supplierIds: [supplierAId],
    });

    expect(second[0]!.purchaseOrderId).toBe(first[0]!.purchaseOrderId);
    expect(second[0]!.refreshed).toBe(true);

    const orders = await db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.organizationId, actor.organizationId));
    expect(orders).toHaveLength(1);
  });

  it("stops suggesting what an approved order already covers", async () => {
    await confirmPlan();

    const first = await createDraftOrdersFromPlan({
      fromDate: FROM,
      toDate: TO,
      locationId,
      supplierIds: [supplierAId],
    });
    await setPurchaseOrderStatus(first[0]!.purchaseOrderId, "PENDING");
    await setPurchaseOrderStatus(first[0]!.purchaseOrderId, "APPROVED");

    // Approving turned the draft into stock on its way, so the need is met.
    const report = await plan();
    expect(report.groups).toHaveLength(0);

    await expect(
      createDraftOrdersFromPlan({
        fromDate: FROM,
        toDate: TO,
        locationId,
        supplierIds: [supplierAId],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("writes a second order rather than rewriting one the supplier has seen", async () => {
    await confirmPlan();

    const first = await createDraftOrdersFromPlan({
      fromDate: FROM,
      toDate: TO,
      locationId,
      supplierIds: [supplierAId],
    });
    await setPurchaseOrderStatus(first[0]!.purchaseOrderId, "PENDING");
    await setPurchaseOrderStatus(first[0]!.purchaseOrderId, "APPROVED");

    // Demand grows after the order went out, so there is a genuine new shortfall.
    await db.update(items).set({ safetyStock: "40" }).where(eq(items.id, chickenId));

    const second = await createDraftOrdersFromPlan({
      fromDate: FROM,
      toDate: TO,
      locationId,
      supplierIds: [supplierAId],
    });

    // The approved order is a promise to the supplier; it must not be rewritten.
    expect(second[0]!.purchaseOrderId).not.toBe(first[0]!.purchaseOrderId);
    expect(second[0]!.refreshed).toBe(false);

    const lines = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, second[0]!.purchaseOrderId));

    // Only the extra 40 kg, not another whole 30 kg on top of what is already coming.
    expect(lines.find((line) => line.itemId === chickenId)!.orderedBaseQty).toBe("40.0000");
  });

  it("leaves out the lines the buyer unticked", async () => {
    await confirmPlan();

    const orders = await createDraftOrdersFromPlan({
      fromDate: FROM,
      toDate: TO,
      locationId,
      supplierIds: [supplierAId],
      excludedItemIds: [riceId],
    });

    const lines = await db
      .select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orders[0]!.purchaseOrderId));

    expect(lines).toHaveLength(1);
    expect(lines[0]!.itemId).toBe(chickenId);
  });

  it("refuses when there is nothing left to order", async () => {
    await confirmPlan();

    await expect(
      createDraftOrdersFromPlan({
        fromDate: FROM,
        toDate: TO,
        locationId,
        supplierIds: [supplierAId],
        excludedItemIds: [chickenId, riceId],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses a user who may see the plan but not manage orders", async () => {
    await confirmPlan();
    actor.permissions = [PERMISSIONS.PO_VIEW, PERMISSIONS.MENU_VIEW];

    await expect(
      createDraftOrdersFromPlan({
        fromDate: FROM,
        toDate: TO,
        locationId,
        supplierIds: [supplierAId],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses to plan for a user without permission to see purchase orders", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(plan()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
