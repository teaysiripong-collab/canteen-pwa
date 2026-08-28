import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PERMISSIONS, type PermissionCode, type RoleCode } from "@/lib/permissions";

/**
 * Phase 8. Two things have to hold: a plan only becomes demand once it is confirmed, and
 * the requirement rolls up per meal period so DAY and NIGHT stay separate all the way
 * from the BOM to the pick list.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-plan@canteen.local",
  fullName: "Integration Planner",
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
  items,
  locations,
  menuPlanItems,
  menuPlanTemplateItems,
  menuPlanTemplates,
  menuPlans,
  menus,
  organizations,
  recipeItemPeriodQuantities,
  recipeItems,
  recipeVersions,
  recipes,
  units,
  users,
} = await import("@/database/schema");
const { openDraftVersion, publishBomVersion, saveBomDraft, listMealPeriods } = await import(
  "@/services/bom-service"
);
const {
  copyIntoPlan,
  getOrCreatePlan,
  savePlanAsTemplate,
  applyTemplateToPlan,
  setPlanMenus,
  setPlanStatus,
} = await import("@/services/menu-plan-service");
const { getMaterialRequirements } = await import("@/services/menu-requirement-service");

const PLAN_DATE = "2026-08-20";
const MENU_A = "TEST-PLAN-MENU-A";
const MENU_B = "TEST-PLAN-MENU-B";

let menuAId = "";
let menuBId = "";
let chickenId = "";
let basilId = "";
let locationId = "";
let kgUnitId = "";
let dayPeriodId = "";
let nightPeriodId = "";

async function purgePlans() {
  const planRows = await db
    .select({ id: menuPlans.id })
    .from(menuPlans)
    .where(eq(menuPlans.organizationId, actor.organizationId));
  const planIds = planRows.map((row) => row.id);

  if (planIds.length > 0) {
    await db.delete(menuPlanItems).where(inArray(menuPlanItems.menuPlanId, planIds));
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, planIds));
    await db.delete(menuPlans).where(inArray(menuPlans.id, planIds));
  }

  const templateRows = await db
    .select({ id: menuPlanTemplates.id })
    .from(menuPlanTemplates)
    .where(eq(menuPlanTemplates.organizationId, actor.organizationId));
  if (templateRows.length > 0) {
    const ids = templateRows.map((row) => row.id);
    await db.delete(menuPlanTemplateItems).where(inArray(menuPlanTemplateItems.templateId, ids));
    await db.delete(menuPlanTemplates).where(inArray(menuPlanTemplates.id, ids));
  }
}

async function purgeRecipes() {
  const recipeRows = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(inArray(recipes.menuId, [menuAId, menuBId].filter(Boolean)));
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

/** Publishes a one-line BOM for a menu, e.g. "30+20" of minced chicken. */
async function publishRecipe(menuId: string, itemId: string, shorthand: string) {
  const draft = await openDraftVersion(menuId);
  await saveBomDraft({
    recipeVersionId: draft.id,
    yieldQty: 1,
    yieldUnitId: null,
    lines: [{ itemId, unitId: kgUnitId, quantityInput: shorthand, wasteFactor: 0 }],
  });
  return publishBomVersion(draft.id, "2026-01-01");
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
      code: "TEST-PLAN-CHICKEN",
      nameTh: "ไก่บด (ทดสอบแผน)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "ไก่บด (ทดสอบแผน)" },
    })
    .returning();
  chickenId = chicken!.id;

  const [basil] = await db
    .insert(items)
    .values({
      organizationId: organization.id,
      code: "TEST-PLAN-BASIL",
      nameTh: "ใบกะเพรา (ทดสอบแผน)",
      baseUnitId: kgUnitId,
      purchaseUnitId: kgUnitId,
      purchaseConversion: "1",
    })
    .onConflictDoUpdate({
      target: [items.organizationId, items.code],
      set: { nameTh: "ใบกะเพรา (ทดสอบแผน)" },
    })
    .returning();
  basilId = basil!.id;

  for (const [code, nameTh] of [
    [MENU_A, "กะเพราไก่ (ทดสอบแผน)"],
    [MENU_B, "ผัดผักรวม (ทดสอบแผน)"],
  ] as const) {
    const [menu] = await db
      .insert(menus)
      .values({ organizationId: organization.id, code, nameTh })
      .onConflictDoUpdate({ target: [menus.organizationId, menus.code], set: { nameTh } })
      .returning();
    if (code === MENU_A) menuAId = menu!.id;
    else menuBId = menu!.id;
  }

  await purgePlans();
  await purgeRecipes();

  await publishRecipe(menuAId, chickenId, "30+20");
  await publishRecipe(menuBId, basilId, "4+1");
});

beforeEach(async () => {
  await purgePlans();
});

afterAll(async () => {
  await purgePlans();
  await purgeRecipes();
  await db.delete(menus).where(inArray(menus.id, [menuAId, menuBId]));
  await db.delete(items).where(inArray(items.id, [chickenId, basilId]));
  await db.delete(users).where(eq(users.email, actor.email));
});

async function planAndConfirm(mealPeriodId: string, menuInputs: Array<{ menuId: string; plannedServings: number }>) {
  const plan = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId });
  await setPlanMenus(plan.id, menuInputs);
  await setPlanStatus(plan.id, "CONFIRMED");
  return plan;
}

describe("daily menu plan", () => {
  it("pins the published recipe version when a menu is planned", async () => {
    const plan = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId });
    await setPlanMenus(plan.id, [{ menuId: menuAId, plannedServings: 1 }]);

    const [item] = await db
      .select()
      .from(menuPlanItems)
      .where(eq(menuPlanItems.menuPlanId, plan.id));

    expect(item!.recipeVersionId).not.toBeNull();
  });

  it("refuses to plan a menu that has no published recipe", async () => {
    const [orphan] = await db
      .insert(menus)
      .values({
        organizationId: actor.organizationId,
        code: "TEST-PLAN-NO-BOM",
        nameTh: "เมนูไม่มีสูตร",
      })
      .onConflictDoUpdate({
        target: [menus.organizationId, menus.code],
        set: { nameTh: "เมนูไม่มีสูตร" },
      })
      .returning();

    const plan = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId });

    await expect(
      setPlanMenus(plan.id, [{ menuId: orphan!.id, plannedServings: 1 }]),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await db.delete(menus).where(eq(menus.id, orphan!.id));
  });

  it("will not confirm an empty plan", async () => {
    const plan = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId });
    await expect(setPlanStatus(plan.id, "CONFIRMED")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("reuses the same plan for a date, location and period", async () => {
    const first = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId });
    const second = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId });
    expect(second.id).toBe(first.id);
  });

  it("rejects duplicate menus in one period", async () => {
    const plan = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId });
    await expect(
      setPlanMenus(plan.id, [
        { menuId: menuAId, plannedServings: 1 },
        { menuId: menuAId, plannedServings: 2 },
      ]),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("material requirements", () => {
  it("ignores a draft plan and counts it once confirmed", async () => {
    const plan = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId });
    await setPlanMenus(plan.id, [{ menuId: menuAId, plannedServings: 1 }]);

    const draftReport = await getMaterialRequirements({
      organizationId: actor.organizationId,
      fromDate: PLAN_DATE,
      toDate: PLAN_DATE,
      locationId,
    });
    expect(draftReport.rows).toHaveLength(0);
    expect(draftReport.unconfirmedPlans).toBe(1);

    await setPlanStatus(plan.id, "CONFIRMED");

    const confirmed = await getMaterialRequirements({
      organizationId: actor.organizationId,
      fromDate: PLAN_DATE,
      toDate: PLAN_DATE,
      locationId,
    });
    expect(confirmed.rows).toHaveLength(1);
    expect(confirmed.unconfirmedPlans).toBe(0);
  });

  it("takes only the planned period's half of the 30+20 split", async () => {
    await planAndConfirm(dayPeriodId, [{ menuId: menuAId, plannedServings: 1 }]);

    const report = await getMaterialRequirements({
      organizationId: actor.organizationId,
      fromDate: PLAN_DATE,
      toDate: PLAN_DATE,
      locationId,
    });

    const row = report.rows.find((entry) => entry.itemId === chickenId)!;
    // Planned for the day shift only, so 30 — not the 50 total.
    expect(row.perPeriod[dayPeriodId]).toBe("30.0000");
    expect(row.perPeriod[nightPeriodId]).toBe("0.0000");
    expect(row.totalBaseQty).toBe("30.0000");
  });

  it("keeps DAY and NIGHT separate and totals them", async () => {
    await planAndConfirm(dayPeriodId, [{ menuId: menuAId, plannedServings: 1 }]);
    await planAndConfirm(nightPeriodId, [{ menuId: menuAId, plannedServings: 1 }]);

    const report = await getMaterialRequirements({
      organizationId: actor.organizationId,
      fromDate: PLAN_DATE,
      toDate: PLAN_DATE,
      locationId,
    });

    const row = report.rows.find((entry) => entry.itemId === chickenId)!;
    expect(row.perPeriod[dayPeriodId]).toBe("30.0000");
    expect(row.perPeriod[nightPeriodId]).toBe("20.0000");
    expect(row.totalBaseQty).toBe("50.0000");
  });

  it("scales by how many times the recipe is made", async () => {
    await planAndConfirm(dayPeriodId, [{ menuId: menuAId, plannedServings: 2 }]);

    const report = await getMaterialRequirements({
      organizationId: actor.organizationId,
      fromDate: PLAN_DATE,
      toDate: PLAN_DATE,
      locationId,
    });

    expect(report.rows.find((entry) => entry.itemId === chickenId)!.totalBaseQty).toBe("60.0000");
  });

  it("adds up several menus and records what each contributed", async () => {
    await planAndConfirm(dayPeriodId, [
      { menuId: menuAId, plannedServings: 1 },
      { menuId: menuBId, plannedServings: 3 },
    ]);

    const report = await getMaterialRequirements({
      organizationId: actor.organizationId,
      fromDate: PLAN_DATE,
      toDate: PLAN_DATE,
      locationId,
    });

    const basil = report.rows.find((entry) => entry.itemId === basilId)!;
    expect(basil.totalBaseQty).toBe("12.0000");

    const chicken = report.rows.find((entry) => entry.itemId === chickenId)!;
    expect(chicken.contributions).toHaveLength(1);
    expect(chicken.contributions[0]!.menuId).toBe(menuAId);
    expect(chicken.contributions[0]!.baseQty).toBe("30.0000");
  });

  it("stops counting a cancelled plan", async () => {
    const plan = await planAndConfirm(dayPeriodId, [{ menuId: menuAId, plannedServings: 1 }]);
    await setPlanStatus(plan.id, "CANCELLED");

    const report = await getMaterialRequirements({
      organizationId: actor.organizationId,
      fromDate: PLAN_DATE,
      toDate: PLAN_DATE,
      locationId,
    });

    expect(report.rows).toHaveLength(0);
  });
});

describe("copy and templates", () => {
  it("copies yesterday's line-up onto today", async () => {
    const yesterday = "2026-08-19";
    const source = await getOrCreatePlan({
      planDate: yesterday,
      locationId,
      mealPeriodId: dayPeriodId,
    });
    await setPlanMenus(source.id, [{ menuId: menuAId, plannedServings: 2 }]);

    const target = await getOrCreatePlan({
      planDate: PLAN_DATE,
      locationId,
      mealPeriodId: dayPeriodId,
    });
    const result = await copyIntoPlan({ planId: target.id, source: { kind: "PREVIOUS_DAY" } });

    expect(result.menus).toBe(1);
    const [copied] = await db
      .select()
      .from(menuPlanItems)
      .where(eq(menuPlanItems.menuPlanId, target.id));
    expect(copied!.menuId).toBe(menuAId);
    expect(Number(copied!.plannedServings)).toBe(2);
  });

  it("copies the day line-up into the night period", async () => {
    const day = await getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId });
    await setPlanMenus(day.id, [{ menuId: menuAId, plannedServings: 1 }]);

    const night = await getOrCreatePlan({
      planDate: PLAN_DATE,
      locationId,
      mealPeriodId: nightPeriodId,
    });
    await copyIntoPlan({
      planId: night.id,
      source: { kind: "OTHER_PERIOD", fromMealPeriodId: dayPeriodId },
    });

    const rows = await db.select().from(menuPlanItems).where(eq(menuPlanItems.menuPlanId, night.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.menuId).toBe(menuAId);
  });

  it("reports a missing source instead of silently doing nothing", async () => {
    const target = await getOrCreatePlan({
      planDate: PLAN_DATE,
      locationId,
      mealPeriodId: dayPeriodId,
    });

    await expect(
      copyIntoPlan({ planId: target.id, source: { kind: "PREVIOUS_WEEK" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves a line-up as a template and applies it to another day", async () => {
    const source = await getOrCreatePlan({
      planDate: PLAN_DATE,
      locationId,
      mealPeriodId: dayPeriodId,
    });
    await setPlanMenus(source.id, [
      { menuId: menuAId, plannedServings: 1 },
      { menuId: menuBId, plannedServings: 2 },
    ]);

    const template = await savePlanAsTemplate({ planId: source.id, nameTh: "ชุดวันจันทร์" });

    const other = await getOrCreatePlan({
      planDate: "2026-08-27",
      locationId,
      mealPeriodId: dayPeriodId,
    });
    const applied = await applyTemplateToPlan({ planId: other.id, templateId: template.id });

    expect(applied.menus).toBe(2);
    const rows = await db.select().from(menuPlanItems).where(eq(menuPlanItems.menuPlanId, other.id));
    expect(rows).toHaveLength(2);
  });

  it("requires menu.manage to plan", async () => {
    const saved = actor.permissions;
    actor.permissions = [PERMISSIONS.MENU_VIEW];

    await expect(
      getOrCreatePlan({ planDate: PLAN_DATE, locationId, mealPeriodId: dayPeriodId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    actor.permissions = saved;
  });
});
