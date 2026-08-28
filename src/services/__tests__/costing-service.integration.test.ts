import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 11. The point of this file is the boundary between two questions that look alike:
 * "what is this worth now" moves with today's prices, and "what did that day cost" must not.
 * The second reads the unit cost frozen onto the ledger row at posting time, so a delivery
 * this morning cannot rewrite last week's report.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-cost@canteen.local",
  fullName: "Integration Coster",
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
  menus,
  organizations,
  recipeItemPeriodQuantities,
  recipeItems,
  recipeVersions,
  recipes,
  stockBalances,
  stockIssueItems,
  stockIssues,
  units,
  users,
} = await import("@/database/schema");
const { openDraftVersion, publishBomVersion, saveBomDraft, listMealPeriods } = await import(
  "@/services/bom-service"
);
const { createStockIssue } = await import("@/services/issue-service");
const { postMovementAs, reversePosting } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const {
  getDailyCosts,
  getIssueCostVariance,
  getIssueCosts,
  getItemCosts,
  getMenuStandardCost,
  getMonthlyCosts,
  getPriceHistory,
} = await import("@/services/costing-service");

const MENU_CODE = "TEST-COST-MENU";

let menuId = "";
let recipeVersionId = "";
let porkId = "";
let riceId = "";
let locationId = "";
let otherLocationId = "";
let kgUnitId = "";
let dayPeriodId = "";
let nightPeriodId = "";
let cheapLotId = "";
let dearLotId = "";
let riceLotId = "";
let keyCounter = 0;

const nextKey = () => `test-cost:${(keyCounter += 1)}:${Date.now()}`;

/** A Bangkok business date, `days` before today. */
function businessDay(days: number): string {
  const at = new Date(Date.now() - days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Noon Bangkok on a business day, so the instant can never drift into a neighbouring day. */
function noonOn(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00+07:00`);
}

async function purge() {
  const testItemIds = [porkId, riceId].filter(Boolean);
  if (testItemIds.length === 0) return;

  const issueRows = await db
    .select({ id: stockIssues.id })
    .from(stockIssues)
    .where(eq(stockIssues.organizationId, actor.organizationId));
  const issueIds = issueRows.map((row) => row.id);

  const lots = await db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(inArray(inventoryLots.itemId, testItemIds));
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

  if (issueIds.length > 0) {
    await db.delete(stockIssueItems).where(inArray(stockIssueItems.stockIssueId, issueIds));
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, issueIds));
    await db.delete(stockIssues).where(inArray(stockIssues.id, issueIds));
  }
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

async function receive(lotId: string, itemId: string, qty: number, at?: Date) {
  return postMovementAs(actor, {
    idempotencyKey: nextKey(),
    referenceType: "GOODS_RECEIPT",
    transactionAt: at,
    lines: [{ type: "RECEIVE", itemId, lotId, locationId, baseQty: qty }],
  });
}

async function consume(
  type: "ISSUE" | "WASTE",
  lotId: string,
  itemId: string,
  qty: number,
  at: Date,
) {
  return postMovementAs(actor, {
    idempotencyKey: nextKey(),
    referenceType: type === "ISSUE" ? "STOCK_ISSUE" : "MANUAL_ADJUSTMENT",
    transactionAt: at,
    lines: [{ type, itemId, lotId, locationId, baseQty: qty }],
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
  kgUnitId = kg!.id;

  const [b16] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.code, "B16")))
    .limit(1);
  locationId = b16!.id;

  const [b1] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.code, "B1")))
    .limit(1);
  otherLocationId = b1!.id;

  const periods = await listMealPeriods(organization.id);
  dayPeriodId = periods[0]!.id;
  nightPeriodId = periods[1]!.id;

  const [pork] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: "TEST-COST-PORK",
      nameTh: "หมูสับ (ทดสอบต้นทุน)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "หมูสับ (ทดสอบต้นทุน)" },
    })
    .returning();
  porkId = pork!.id;

  const [rice] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: "TEST-COST-RICE",
      nameTh: "ข้าวสาร (ทดสอบต้นทุน)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "ข้าวสาร (ทดสอบต้นทุน)" },
    })
    .returning();
  riceId = rice!.id;

  const [menu] = await db
    .insert(menus)
    .values({
      organizationId: organization.id,
      code: MENU_CODE,
      nameTh: "ข้าวหมูสับ (ทดสอบต้นทุน)",
    })
    .onConflictDoUpdate({
      target: [menus.organizationId, menus.code],
      set: { nameTh: "ข้าวหมูสับ (ทดสอบต้นทุน)" },
    })
    .returning();
  menuId = menu!.id;

  await purge();
  await purgeRecipes();

  // หมูสับ 30+20, ข้าวสาร 10+10.
  const draft = await openDraftVersion(menuId);
  await saveBomDraft({
    recipeVersionId: draft.id,
    yieldQty: 1,
    yieldUnitId: null,
    lines: [
      { itemId: porkId, unitId: kgUnitId, quantityInput: "30+20", wasteFactor: 0 },
      { itemId: riceId, unitId: kgUnitId, quantityInput: "10+10", wasteFactor: 0 },
    ],
  });
  await publishBomVersion(draft.id, "2020-01-01");
  recipeVersionId = draft.id;
});

beforeEach(async () => {
  actor.permissions = Object.values(PERMISSIONS) as PermissionCode[];
  await purge();

  // 20 kg at 90 and 10 kg at 80 -> weighted average 86.6667, not the 85 a plain mean gives.
  const dear = await createLot({
    organizationId: actor.organizationId,
    itemId: porkId,
    lotNumber: `COST-DEAR-${Date.now()}`,
    receivedBaseQty: 20,
    unitCost: 90,
    receivedDate: businessDay(3),
    expiryDate: "2030-12-31",
  });
  const cheap = await createLot({
    organizationId: actor.organizationId,
    itemId: porkId,
    lotNumber: `COST-CHEAP-${Date.now()}`,
    receivedBaseQty: 10,
    unitCost: 80,
    receivedDate: businessDay(1),
    expiryDate: "2030-06-30",
  });
  const rice = await createLot({
    organizationId: actor.organizationId,
    itemId: riceId,
    lotNumber: `COST-RICE-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 25,
    receivedDate: businessDay(2),
    expiryDate: "2030-12-31",
  });

  dearLotId = dear.id;
  cheapLotId = cheap.id;
  riceLotId = rice.id;

  await receive(dearLotId, porkId, 20, noonOn(businessDay(3)));
  await receive(cheapLotId, porkId, 10, noonOn(businessDay(1)));
  await receive(riceLotId, riceId, 100, noonOn(businessDay(2)));
});

afterAll(async () => {
  await purge();
  await purgeRecipes();
  await db.delete(menus).where(eq(menus.id, menuId));
  await db.delete(items).where(inArray(items.id, [porkId, riceId]));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("current item cost", () => {
  it("weights the lots on hand by quantity", async () => {
    const costs = await getItemCosts(actor.organizationId, { itemId: porkId });
    const pork = costs.find((row) => row.itemId === porkId)!;

    expect(pork.baseQty).toBe("30.0000");
    expect(Number(pork.weightedAverageCost)).toBeCloseTo(86.6667, 4);
    expect(Number(pork.stockValue)).toBeCloseTo(2600, 2);
  });

  it("follows the price down as cheaper stock replaces dearer stock", async () => {
    const before = await getItemCosts(actor.organizationId, { itemId: porkId });

    // The dear lot is consumed; only the 80-baht stock is left.
    await consume("ISSUE", dearLotId, porkId, 20, new Date());

    const after = await getItemCosts(actor.organizationId, { itemId: porkId });

    expect(Number(before[0]!.weightedAverageCost)).toBeCloseTo(86.6667, 4);
    expect(after[0]!.weightedAverageCost).toBe("80.0000");
  });

  it("counts only the location asked for", async () => {
    const elsewhere = await getItemCosts(actor.organizationId, {
      itemId: porkId,
      locationId: otherLocationId,
    });

    expect(elsewhere).toHaveLength(0);
  });

  it("refuses a user without permission to see costs", async () => {
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(getItemCosts(actor.organizationId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("daily cost", () => {
  it("does not change when the purchase price changes afterwards", async () => {
    const consumedOn = businessDay(2);
    await consume("ISSUE", dearLotId, porkId, 10, noonOn(consumedOn));

    const before = await getDailyCosts(actor.organizationId, {
      fromDate: consumedOn,
      toDate: consumedOn,
    });
    expect(Number(before[0]!.issueCost)).toBeCloseTo(900, 2);

    // Prices double: the lot is re-costed and a much dearer delivery arrives today.
    await db.update(inventoryLots).set({ unitCost: "180" }).where(eq(inventoryLots.id, dearLotId));
    const today = await createLot({
      organizationId: actor.organizationId,
      itemId: porkId,
      lotNumber: `COST-SPIKE-${Date.now()}`,
      receivedBaseQty: 50,
      unitCost: 200,
      expiryDate: "2030-12-31",
    });
    await receive(today.id, porkId, 50);

    const after = await getDailyCosts(actor.organizationId, {
      fromDate: consumedOn,
      toDate: consumedOn,
    });

    expect(after).toEqual(before);

    // The live valuation, in contrast, is expected to move.
    const costs = await getItemCosts(actor.organizationId, { itemId: porkId });
    expect(Number(costs[0]!.weightedAverageCost)).toBeGreaterThan(100);
  });

  it("separates waste from consumption and totals the two", async () => {
    const day = businessDay(2);
    await consume("ISSUE", dearLotId, porkId, 10, noonOn(day));
    await consume("WASTE", dearLotId, porkId, 2, noonOn(day));

    const [row] = await getDailyCosts(actor.organizationId, { fromDate: day, toDate: day });

    expect(Number(row!.issueCost)).toBeCloseTo(900, 2);
    expect(Number(row!.wasteCost)).toBeCloseTo(180, 2);
    expect(Number(row!.totalCost)).toBeCloseTo(1080, 2);
  });

  it("does not count a transfer as a cost", async () => {
    const day = businessDay(2);
    await postMovementAs(actor, {
      idempotencyKey: nextKey(),
      referenceType: "STOCK_TRANSFER",
      transactionAt: noonOn(day),
      lines: [
        { type: "TRANSFER_OUT", itemId: porkId, lotId: dearLotId, locationId, baseQty: 5 },
        {
          type: "TRANSFER_IN",
          itemId: porkId,
          lotId: dearLotId,
          locationId: otherLocationId,
          baseQty: 5,
        },
      ],
    });

    const rows = await getDailyCosts(actor.organizationId, { fromDate: day, toDate: day });

    expect(rows).toHaveLength(0);
  });

  it("takes a reversal off the day it was reversed, not the day of the mistake", async () => {
    const mistakeDay = businessDay(2);
    const posting = await consume("ISSUE", dearLotId, porkId, 10, noonOn(mistakeDay));

    await reversePosting(posting.postingId, "ลงผิดใบ");

    const originalDay = await getDailyCosts(actor.organizationId, {
      fromDate: mistakeDay,
      toDate: mistakeDay,
    });
    const withReversal = await getDailyCosts(actor.organizationId, {
      fromDate: mistakeDay,
      toDate: businessDay(0),
    });

    // The closed day keeps the number that was reported at the time.
    expect(Number(originalDay[0]!.issueCost)).toBeCloseTo(900, 2);
    // Across the window including today, the two cancel out.
    const net = withReversal.reduce((sum, row) => sum + Number(row.issueCost), 0);
    expect(net).toBeCloseTo(0, 2);
  });

  it("keeps a night-shift movement on its Bangkok date", async () => {
    // 23:00 Bangkok is 16:00 UTC the same day; 01:00 Bangkok is 18:00 UTC the day before.
    const day = businessDay(2);
    await consume("ISSUE", dearLotId, porkId, 1, new Date(`${day}T23:00:00+07:00`));
    await consume("ISSUE", dearLotId, porkId, 1, new Date(`${day}T01:00:00+07:00`));

    const rows = await getDailyCosts(actor.organizationId, { fromDate: day, toDate: day });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.costDate).toBe(day);
    expect(Number(rows[0]!.issueCost)).toBeCloseTo(180, 2);
  });

  it("rolls the days up into months", async () => {
    const day = businessDay(2);
    await consume("ISSUE", dearLotId, porkId, 10, noonOn(day));

    const months = await getMonthlyCosts(actor.organizationId, { fromDate: day, toDate: day });

    expect(months).toHaveLength(1);
    expect(months[0]!.month).toBe(day.slice(0, 7));
    expect(Number(months[0]!.totalCost)).toBeCloseTo(900, 2);
  });
});

describe("menu standard cost", () => {
  it("prices the shift's own half of the BOM split", async () => {
    const day = await getMenuStandardCost({
      organizationId: actor.organizationId,
      recipeVersionId,
      mealPeriodId: dayPeriodId,
    });
    const night = await getMenuStandardCost({
      organizationId: actor.organizationId,
      recipeVersionId,
      mealPeriodId: nightPeriodId,
    });

    // Day: 30 kg pork at 86.6667 + 10 kg rice at 25 = 2850.
    expect(Number(day.totalCost)).toBeCloseTo(2850, 2);
    // Night: 20 kg pork + 10 kg rice = 1983.33.
    expect(Number(night.totalCost)).toBeCloseTo(1983.33, 1);
    expect(day.menuNameTh).toBe("ข้าวหมูสับ (ทดสอบต้นทุน)");
  });

  it("prices the whole recipe when no shift is chosen", async () => {
    const whole = await getMenuStandardCost({
      organizationId: actor.organizationId,
      recipeVersionId,
    });

    // 50 kg pork + 20 kg rice.
    expect(Number(whole.totalCost)).toBeCloseTo(4833.33, 1);
  });

  it("does not price a recipe belonging to another organization", async () => {
    await expect(
      getMenuStandardCost({
        organizationId: "00000000-0000-0000-0000-000000000000",
        recipeVersionId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("issue cost and variance", () => {
  it("costs an issue from the lots it actually took", async () => {
    // FEFO takes the cheap lot first: it expires 2030-06-30, the dear one 2030-12-31.
    const issue = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: porkId, standardBaseQty: 30, actualBaseQty: 30, lotPicks: [] }],
    });

    const [row] = await getIssueCosts(actor.organizationId, {
      fromDate: businessDay(0),
      toDate: businessDay(0),
    });

    expect(row!.issueId).toBe(issue.issueId);
    // 10 kg at 80 + 20 kg at 90 = 2600, whichever order FEFO walked them in.
    expect(Number(row!.actualCost)).toBeCloseTo(2600, 2);
  });

  it("reports taking more than the recipe asked for as an over-variance", async () => {
    const issue = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: porkId, standardBaseQty: 20, actualBaseQty: 25, note: "หม้อใหญ่กว่าปกติ", lotPicks: [] }],
    });

    const variance = (await getIssueCostVariance(actor.organizationId, issue.issueId))!;

    expect(Number(variance.actualCost)).toBeGreaterThan(Number(variance.standardCost));
    expect(variance.variancePercent).toBeCloseTo(25, 4);
    expect(variance.issueNumber).toBe(issue.issueNumber);
  });

  it("has no variance for an issue taken exactly to the recipe", async () => {
    const issue = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: porkId, standardBaseQty: 30, actualBaseQty: 30, lotPicks: [] }],
    });

    const variance = (await getIssueCostVariance(actor.organizationId, issue.issueId))!;

    expect(Number(variance.varianceValue)).toBeCloseTo(0, 4);
  });

  it("returns nothing for an issue in another organization", async () => {
    const issue = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: porkId, standardBaseQty: 5, actualBaseQty: 5, lotPicks: [] }],
    });

    await expect(
      getIssueCostVariance("00000000-0000-0000-0000-000000000000", issue.issueId),
    ).resolves.toBeNull();
  });
});

describe("price history", () => {
  it("lists what each delivery cost, newest first", async () => {
    const rows = await getPriceHistory(actor.organizationId, {
      itemId: porkId,
      fromDate: businessDay(10),
      toDate: businessDay(0),
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]!.receivedDate).toBe(businessDay(1));
    expect(rows[0]!.unitCost).toBe("80.0000");
    expect(rows[1]!.unitCost).toBe("90.0000");
  });

  it("keeps every delivery even when the lot has since been used up", async () => {
    await consume("ISSUE", dearLotId, porkId, 20, new Date());

    const rows = await getPriceHistory(actor.organizationId, { itemId: porkId });

    expect(rows.map((row) => row.unitCost)).toContain("90.0000");
  });
});
