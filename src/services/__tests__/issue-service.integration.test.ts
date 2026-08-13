import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";
import { computeVariance } from "@/lib/issue/variance";

/**
 * Phase 9. The pick list comes from the BOM for the chosen shift, the kitchen adjusts it,
 * FEFO decides the lots, and the document keeps standard next to actual so variance is a
 * fact about the day rather than a reconstruction.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-issue@canteen.local",
  fullName: "Integration Issuer",
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
const { createStockIssue, getIssueStandard } = await import("@/services/issue-service");
const { postMovementAs } = await import("@/services/inventory-ledger-service");
const { createLot } = await import("@/services/inventory-lot-service");
const { listStockMovements } = await import("@/repositories/inventory-repository");

const MENU_CODE = "TEST-ISSUE-MENU";

let menuId = "";
let chickenId = "";
let basilId = "";
let locationId = "";
let kgUnitId = "";
let dayPeriodId = "";
let nightPeriodId = "";
let lotSoon = "";
let lotLater = "";
let keyCounter = 0;

const nextKey = () => `test-issue:${(keyCounter += 1)}:${Date.now()}`;

async function stockOf(itemId: string): Promise<number> {
  const rows = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.locationId, locationId)));
  return rows.reduce((sum, row) => sum + Number(row.baseQty), 0);
}

async function lotBalance(lotId: string): Promise<number> {
  const [row] = await db
    .select({ baseQty: stockBalances.baseQty })
    .from(stockBalances)
    .where(and(eq(stockBalances.lotId, lotId), eq(stockBalances.locationId, locationId)))
    .limit(1);
  return Number(row?.baseQty ?? 0);
}

async function purgeStock() {
  const testItemIds = [chickenId, basilId].filter(Boolean);
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

async function receive(lotId: string, itemId: string, qty: number) {
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
  kgUnitId = kg!.id;

  const [b16] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organization.id), eq(locations.code, "B16")))
    .limit(1);
  locationId = b16!.id;

  const periods = await listMealPeriods(organization.id);
  dayPeriodId = periods[0]!.id;
  nightPeriodId = periods[1]!.id;

  const [chicken] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: "TEST-ISSUE-CHICKEN",
      nameTh: "ไก่บด (ทดสอบเบิก)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "ไก่บด (ทดสอบเบิก)" },
    })
    .returning();
  chickenId = chicken!.id;

  const [basil] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: "TEST-ISSUE-BASIL",
      nameTh: "ใบกะเพรา (ทดสอบเบิก)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "ใบกะเพรา (ทดสอบเบิก)" },
    })
    .returning();
  basilId = basil!.id;

  const [menu] = await db
    .insert(menus)
    .values({
      organizationId: organization.id,
      code: MENU_CODE,
      nameTh: "กะเพราไก่ (ทดสอบเบิก)",
    })
    .onConflictDoUpdate({
      target: [menus.organizationId, menus.code],
      set: { nameTh: "กะเพราไก่ (ทดสอบเบิก)" },
    })
    .returning();
  menuId = menu!.id;

  await purgeStock();
  await purgeRecipes();

  // ไก่บด 30+20, ใบกะเพรา 2.5+1.5 — the BOM from the roadmap example.
  const draft = await openDraftVersion(menuId);
  await saveBomDraft({
    recipeVersionId: draft.id,
    yieldQty: 1,
    yieldUnitId: null,
    lines: [
      { itemId: chickenId, unitId: kgUnitId, quantityInput: "30+20", wasteFactor: 0 },
      { itemId: basilId, unitId: kgUnitId, quantityInput: "2.5+1.5", wasteFactor: 0 },
    ],
  });
  await publishBomVersion(draft.id, "2026-01-01");
});

beforeEach(async () => {
  await purgeStock();

  const later = await createLot({
    organizationId: actor.organizationId,
    itemId: chickenId,
    lotNumber: `ISS-LATER-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 80,
    expiryDate: "2026-12-31",
  });
  const soon = await createLot({
    organizationId: actor.organizationId,
    itemId: chickenId,
    lotNumber: `ISS-SOON-${Date.now()}`,
    receivedBaseQty: 100,
    unitCost: 90,
    expiryDate: "2026-09-01",
  });
  lotLater = later.id;
  lotSoon = soon.id;
});

afterAll(async () => {
  await purgeStock();
  await purgeRecipes();
  await db.delete(menus).where(eq(menus.id, menuId));
  await db.delete(items).where(inArray(items.id, [chickenId, basilId]));
  await db.delete(users).where(eq(users.email, actor.email));
});

describe("issue standard from BOM", () => {
  it("loads the day shift's half of the 30+20 split", async () => {
    await receive(lotSoon, chickenId, 100);

    const standard = await getIssueStandard({
      organizationId: actor.organizationId,
      menuId,
      mealPeriodId: dayPeriodId,
      locationId,
    });

    const chicken = standard.lines.find((line) => line.itemId === chickenId)!;
    expect(chicken.standardBaseQty).toBe("30.0000");
    expect(chicken.availableBaseQty).toBe("100.0000");
  });

  it("loads the night shift's half instead when the night is selected", async () => {
    const standard = await getIssueStandard({
      organizationId: actor.organizationId,
      menuId,
      mealPeriodId: nightPeriodId,
      locationId,
    });

    expect(standard.lines.find((line) => line.itemId === chickenId)!.standardBaseQty).toBe(
      "20.0000",
    );
    expect(standard.lines.find((line) => line.itemId === basilId)!.standardBaseQty).toBe(
      "1.5000",
    );
  });

  it("scales the standard by how many times the recipe is made", async () => {
    const standard = await getIssueStandard({
      organizationId: actor.organizationId,
      menuId,
      mealPeriodId: dayPeriodId,
      locationId,
      servings: 2,
    });

    expect(standard.lines.find((line) => line.itemId === chickenId)!.standardBaseQty).toBe(
      "60.0000",
    );
  });
});

describe("posting an issue", () => {
  it("records standard and actual, and reports +2 kg / +6.67% (Gate 9)", async () => {
    await receive(lotSoon, chickenId, 100);

    const result = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: chickenId, standardBaseQty: 30, actualBaseQty: 32, lotPicks: [] }],
    });

    expect(result.issueNumber).toMatch(/^IS-\d{8}-\d{3}$/);

    const [line] = await db
      .select()
      .from(stockIssueItems)
      .where(eq(stockIssueItems.stockIssueId, result.issueId));

    expect(line!.requestedBaseQty).toBe("30.0000");
    expect(line!.issuedBaseQty).toBe("32.0000");

    const variance = computeVariance(line!.requestedBaseQty, line!.issuedBaseQty);
    expect(variance.varianceBaseQty).toBe("2.0000");
    expect(variance.variancePercent).toBeCloseTo(6.6667, 3);

    expect(await stockOf(chickenId)).toBe(68);
  });

  it("stores which meal period and recipe version were used", async () => {
    await receive(lotSoon, chickenId, 50);

    const result = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: nightPeriodId,
      lines: [{ itemId: chickenId, standardBaseQty: 20, actualBaseQty: 20, lotPicks: [] }],
    });

    const [issue] = await db.select().from(stockIssues).where(eq(stockIssues.id, result.issueId));
    expect(issue!.mealPeriodId).toBe(nightPeriodId);
    expect(issue!.recipeVersionId).not.toBeNull();
  });

  it("takes the lot that expires first", async () => {
    await receive(lotLater, chickenId, 50);
    await receive(lotSoon, chickenId, 50);

    await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: chickenId, standardBaseQty: 30, actualBaseQty: 30, lotPicks: [] }],
    });

    expect(await lotBalance(lotSoon)).toBe(20);
    expect(await lotBalance(lotLater)).toBe(50);
  });

  it("snapshots the weighted cost of the lots consumed", async () => {
    // 20 from the 90-baht lot and 10 from the 80-baht lot -> (20*90 + 10*80) / 30.
    await receive(lotSoon, chickenId, 20);
    await receive(lotLater, chickenId, 50);

    const result = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: chickenId, standardBaseQty: 30, actualBaseQty: 30, lotPicks: [] }],
    });

    const [line] = await db
      .select()
      .from(stockIssueItems)
      .where(eq(stockIssueItems.stockIssueId, result.issueId));

    expect(Number(line!.unitCost)).toBeCloseTo(86.6667, 3);
  });

  it("refuses to issue more than is on hand and leaves stock alone", async () => {
    await receive(lotSoon, chickenId, 10);

    await expect(
      createStockIssue({
        idempotencyKey: nextKey(),
        locationId,
        menuId,
        mealPeriodId: dayPeriodId,
        lines: [{ itemId: chickenId, standardBaseQty: 30, actualBaseQty: 30, lotPicks: [] }],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    expect(await stockOf(chickenId)).toBe(10);
    const issues = await db
      .select()
      .from(stockIssues)
      .where(eq(stockIssues.organizationId, actor.organizationId));
    expect(issues).toHaveLength(0);
  });

  it("posts one ISSUE row per lot consumed, under the issue's reference", async () => {
    await receive(lotSoon, chickenId, 12);
    await receive(lotLater, chickenId, 50);

    const result = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: chickenId, standardBaseQty: 30, actualBaseQty: 30, lotPicks: [] }],
    });

    const { rows } = await listStockMovements(actor.organizationId, {
      postingId: result.postingId,
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.transactionType === "ISSUE")).toBe(true);
    expect(rows.every((row) => row.referenceNumber === result.issueNumber)).toBe(true);
  });

  it("issues once when the same submission arrives twice", async () => {
    await receive(lotSoon, chickenId, 100);

    const payload = {
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: chickenId, standardBaseQty: 30, actualBaseQty: 30, lotPicks: [] }],
    };

    const first = await createStockIssue(payload);
    const second = await createStockIssue(payload);

    expect(second.replayed).toBe(true);
    expect(second.issueId).toBe(first.issueId);
    expect(await stockOf(chickenId)).toBe(70);
  });

  it("supports a manual issue with no menu and no standard", async () => {
    await receive(lotSoon, chickenId, 40);

    const result = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      lines: [{ itemId: chickenId, actualBaseQty: 5, lotPicks: [] }],
    });

    const [issue] = await db.select().from(stockIssues).where(eq(stockIssues.id, result.issueId));
    expect(issue!.menuId).toBeNull();

    const [line] = await db
      .select()
      .from(stockIssueItems)
      .where(eq(stockIssueItems.stockIssueId, result.issueId));
    expect(line!.requestedBaseQty).toBeNull();
    expect(computeVariance(line!.requestedBaseQty, line!.issuedBaseQty).variancePercent).toBeNull();
  });
});

describe("permissions and overrides", () => {
  it("blocks changing the quantity without issue.adjust_qty", async () => {
    await receive(lotSoon, chickenId, 100);
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.ISSUE_CREATE, PERMISSIONS.STOCK_VIEW];

    await expect(
      createStockIssue({
        idempotencyKey: nextKey(),
        locationId,
        menuId,
        mealPeriodId: dayPeriodId,
        lines: [{ itemId: chickenId, standardBaseQty: 30, actualBaseQty: 32, lotPicks: [] }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
  });

  it("allows issuing exactly the standard without that permission", async () => {
    await receive(lotSoon, chickenId, 100);
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.ISSUE_CREATE, PERMISSIONS.STOCK_VIEW];

    const result = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      lines: [{ itemId: chickenId, standardBaseQty: 30, actualBaseQty: 30, lotPicks: [] }],
    });

    expect(result.issueId).toBeTruthy();
    actor.permissions = saved;
  });

  it("records a hand-picked lot that skips FEFO, and audits it", async () => {
    await receive(lotSoon, chickenId, 50);
    await receive(lotLater, chickenId, 50);

    const result = await createStockIssue({
      idempotencyKey: nextKey(),
      locationId,
      menuId,
      mealPeriodId: dayPeriodId,
      // lotLater expires later, so taking it first is a deliberate override.
      lines: [
        {
          itemId: chickenId,
          standardBaseQty: 30,
          actualBaseQty: 30,
          lotPicks: [{ lotId: lotLater, baseQty: 30 }],
        },
      ],
    });

    const [line] = await db
      .select()
      .from(stockIssueItems)
      .where(eq(stockIssueItems.stockIssueId, result.issueId));
    expect(line!.fefoOverridden).toBe(true);

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.entityId, result.issueId), eq(auditLogs.action, "OVERRIDE_FEFO")),
      );
    expect(entry).toBeDefined();

    expect(await lotBalance(lotLater)).toBe(20);
    expect(await lotBalance(lotSoon)).toBe(50);
  });

  it("blocks hand-picking lots without fefo.override", async () => {
    await receive(lotSoon, chickenId, 50);
    const saved = actor.permissions;
    actor.permissions = [
      PERMISSIONS.ISSUE_CREATE,
      PERMISSIONS.ISSUE_ADJUST_QTY,
      PERMISSIONS.STOCK_VIEW,
    ];

    await expect(
      createStockIssue({
        idempotencyKey: nextKey(),
        locationId,
        menuId,
        mealPeriodId: dayPeriodId,
        lines: [
          {
            itemId: chickenId,
            standardBaseQty: 30,
            actualBaseQty: 30,
            lotPicks: [{ lotId: lotSoon, baseQty: 30 }],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
  });

  it("requires issue.create", async () => {
    await receive(lotSoon, chickenId, 50);
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.STOCK_VIEW];

    await expect(
      createStockIssue({
        idempotencyKey: nextKey(),
        locationId,
        lines: [{ itemId: chickenId, actualBaseQty: 1, lotPicks: [] }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
  });
});
