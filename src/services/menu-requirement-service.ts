import { and, asc, between, eq, inArray } from "drizzle-orm";
import { db } from "@/database/client";
import {
  items,
  mealPeriods,
  menuPlanItems,
  menuPlans,
  menus,
  recipeItemPeriodQuantities,
  recipeItems,
  units,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { addQty, divQty, mulQty, toNumericString } from "@/lib/quantity";
import { listMealPeriods } from "./bom-service";

export type RequirementContribution = {
  menuId: string;
  menuNameTh: string;
  mealPeriodId: string;
  /** The business date this contribution is cooked on; the purchase planner orders by it. */
  planDate: string;
  plannedServings: string;
  /** Quantity this menu contributes to the requirement, in the item's BOM unit. */
  baseQty: string;
};

export type RequirementRow = {
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  unitCode: string | null;
  /** Keyed by meal period id, in period order. */
  perPeriod: Record<string, string>;
  totalBaseQty: string;
  contributions: RequirementContribution[];
};

export type RequirementReport = {
  periods: Array<{ id: string; code: string; nameTh: string }>;
  rows: RequirementRow[];
  /** Plans that exist for the range but are not confirmed, so they are excluded. */
  unconfirmedPlans: number;
};

/**
 * What the kitchen has to draw from the store for a date range.
 *
 * Only CONFIRMED plans count. A draft is someone thinking out loud; letting it drive
 * purchasing or issuing would turn a maybe into an order.
 *
 * A recipe line's quantity is what gets taken from the store, scaled by how many times
 * the recipe is being made (`plannedServings / yieldQty`). The waste factor is not added
 * on top: the kitchen writes the gross amount it will collect, and the factor describes
 * how much of that is trim — it is used for yield analysis, not to inflate the pick list.
 */
export async function getMaterialRequirements(input: {
  organizationId: string;
  fromDate: string;
  toDate: string;
  locationId?: string;
}): Promise<RequirementReport> {
  await requirePermission(PERMISSIONS.MENU_VIEW);

  const periods = await listMealPeriods(input.organizationId);

  const planFilters = [
    eq(menuPlans.organizationId, input.organizationId),
    between(menuPlans.planDate, input.fromDate, input.toDate),
  ];
  if (input.locationId) planFilters.push(eq(menuPlans.locationId, input.locationId));

  const planRows = await db
    .select({
      planId: menuPlans.id,
      status: menuPlans.status,
      mealPeriodId: menuPlans.mealPeriodId,
      planDate: menuPlans.planDate,
    })
    .from(menuPlans)
    .where(and(...planFilters));

  // IN_PROGRESS and COMPLETED plans were confirmed at some point, so they still count.
  const countedStatuses = new Set(["CONFIRMED", "IN_PROGRESS", "COMPLETED"]);
  const counted = planRows.filter((plan) => countedStatuses.has(plan.status));
  const unconfirmedPlans = planRows.filter(
    (plan) => plan.status === "DRAFT" || plan.status === "CANCELLED",
  ).length;

  if (counted.length === 0) {
    return { periods, rows: [], unconfirmedPlans };
  }

  const planById = new Map(counted.map((plan) => [plan.planId, plan]));

  const planItemRows = await db
    .select({
      menuPlanId: menuPlanItems.menuPlanId,
      menuId: menus.id,
      menuNameTh: menus.nameTh,
      recipeVersionId: menuPlanItems.recipeVersionId,
      plannedServings: menuPlanItems.plannedServings,
    })
    .from(menuPlanItems)
    .innerJoin(menus, eq(menus.id, menuPlanItems.menuId))
    .where(
      inArray(
        menuPlanItems.menuPlanId,
        counted.map((plan) => plan.planId),
      ),
    );

  const versionIds = [
    ...new Set(
      planItemRows
        .map((row) => row.recipeVersionId)
        .filter((id): id is string => id !== null),
    ),
  ];

  if (versionIds.length === 0) {
    return { periods, rows: [], unconfirmedPlans };
  }

  const bomRows = await db
    .select({
      recipeVersionId: recipeItems.recipeVersionId,
      recipeItemId: recipeItems.id,
      itemId: items.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitCode: units.code,
      quantity: recipeItems.quantity,
    })
    .from(recipeItems)
    .innerJoin(items, eq(items.id, recipeItems.itemId))
    .leftJoin(units, eq(units.id, recipeItems.unitId))
    .where(inArray(recipeItems.recipeVersionId, versionIds))
    .orderBy(asc(items.code));

  const periodRows =
    bomRows.length === 0
      ? []
      : await db
          .select({
            recipeItemId: recipeItemPeriodQuantities.recipeItemId,
            mealPeriodId: recipeItemPeriodQuantities.mealPeriodId,
            quantity: recipeItemPeriodQuantities.quantity,
          })
          .from(recipeItemPeriodQuantities)
          .innerJoin(
            mealPeriods,
            eq(mealPeriods.id, recipeItemPeriodQuantities.mealPeriodId),
          )
          .where(
            inArray(
              recipeItemPeriodQuantities.recipeItemId,
              bomRows.map((row) => row.recipeItemId),
            ),
          );

  const periodByRecipeItem = new Map<string, Map<string, string>>();
  for (const row of periodRows) {
    const map = periodByRecipeItem.get(row.recipeItemId) ?? new Map<string, string>();
    map.set(row.mealPeriodId, row.quantity);
    periodByRecipeItem.set(row.recipeItemId, map);
  }

  const bomByVersion = new Map<string, typeof bomRows>();
  for (const row of bomRows) {
    const list = bomByVersion.get(row.recipeVersionId) ?? [];
    list.push(row);
    bomByVersion.set(row.recipeVersionId, list);
  }

  const accumulator = new Map<string, RequirementRow>();

  for (const planItem of planItemRows) {
    if (!planItem.recipeVersionId) continue;
    const plan = planById.get(planItem.menuPlanId);
    if (!plan) continue;

    const lines = bomByVersion.get(planItem.recipeVersionId) ?? [];

    for (const line of lines) {
      const row =
        accumulator.get(line.itemId) ??
        ({
          itemId: line.itemId,
          itemCode: line.itemCode,
          itemNameTh: line.itemNameTh,
          unitCode: line.unitCode,
          perPeriod: Object.fromEntries(periods.map((period) => [period.id, "0.0000"])),
          totalBaseQty: "0.0000",
          contributions: [],
        } satisfies RequirementRow);

      // The plan is for one meal period, so only that period's BOM quantity applies.
      const periodQuantities = periodByRecipeItem.get(line.recipeItemId);
      const forThisPeriod = periodQuantities?.get(plan.mealPeriodId) ?? "0";

      const scaled = mulQty(forThisPeriod, planItem.plannedServings);

      if (Number(scaled) > 0) {
        row.perPeriod[plan.mealPeriodId] = addQty(
          row.perPeriod[plan.mealPeriodId] ?? "0",
          scaled,
        );
        row.totalBaseQty = addQty(row.totalBaseQty, scaled);
        row.contributions.push({
          menuId: planItem.menuId,
          menuNameTh: planItem.menuNameTh,
          mealPeriodId: plan.mealPeriodId,
          planDate: plan.planDate,
          plannedServings: planItem.plannedServings,
          baseQty: scaled,
        });
      }

      accumulator.set(line.itemId, row);
    }
  }

  const rows = [...accumulator.values()]
    .filter((row) => Number(row.totalBaseQty) > 0)
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode));

  return { periods, rows, unconfirmedPlans };
}

/**
 * Scale factor for a menu: how many times the recipe is being made.
 * Exposed for the planner UI, which shows the multiplier next to each menu.
 */
export function servingScale(plannedServings: string, yieldQty: string): string {
  if (Number(yieldQty) <= 0) return toNumericString(0);
  return divQty(plannedServings, yieldQty);
}
