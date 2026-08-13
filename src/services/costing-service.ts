import { and, asc, between, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/database/client";
import {
  inventoryLots,
  inventoryTransactions,
  items,
  mealPeriods,
  menus,
  recipeItemPeriodQuantities,
  recipeItems,
  recipeVersions,
  recipes,
  stockBalances,
  stockIssueItems,
  stockIssues,
  units,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import {
  costVariance,
  weightedAverageCost,
  type CostVariance,
} from "@/lib/costing/weighted-average";
import { BUSINESS_TIME_ZONE } from "@/lib/date";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { addQty, mulQty, toNumericString } from "@/lib/quantity";

/**
 * Costing reads two different things depending on the question.
 *
 * "What is it worth now" uses the current lots on hand — a live number that moves as
 * prices move. "What did that day cost" reads the unit cost frozen onto the ledger row
 * when it was posted, so a report about last week never changes because a delivery this
 * morning was cheaper.
 */

/**
 * A report for "1–7 January" means seven Bangkok days, not seven UTC days. The two differ by
 * seven hours, which is exactly where the night shift lives, so the bounds are converted to
 * the instants that Bangkok midnight actually falls on. Comparing the column itself keeps
 * the range index usable, unlike casting every row to a local date.
 */
function bangkokDayRange(column: PgColumn, fromDate: string, toDate: string): SQL[] {
  return [
    sql`${column} >= (${fromDate}::timestamp at time zone ${BUSINESS_TIME_ZONE})`,
    sql`${column} < ((${toDate}::timestamp + interval '1 day') at time zone ${BUSINESS_TIME_ZONE})`,
  ];
}

export type ItemCostRow = {
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  unitCode: string | null;
  baseQty: string;
  weightedAverageCost: string;
  stockValue: string;
};

/** Current weighted average cost and stock value per item, from the lots actually on hand. */
export async function getItemCosts(
  organizationId: string,
  options: { locationId?: string; itemId?: string } = {},
): Promise<ItemCostRow[]> {
  await requirePermission(PERMISSIONS.COST_VIEW);

  const filters = [eq(stockBalances.organizationId, organizationId), gt(stockBalances.baseQty, "0")];
  if (options.locationId) filters.push(eq(stockBalances.locationId, options.locationId));
  if (options.itemId) filters.push(eq(stockBalances.itemId, options.itemId));

  const rows = await db
    .select({
      itemId: items.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitCode: units.code,
      baseQty: stockBalances.baseQty,
      unitCost: inventoryLots.unitCost,
    })
    .from(stockBalances)
    .innerJoin(items, eq(items.id, stockBalances.itemId))
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockBalances.lotId))
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .where(and(...filters))
    .orderBy(asc(items.code));

  const byItem = new Map<string, ItemCostRow & { entries: Array<{ baseQty: string; unitCost: string }> }>();

  for (const row of rows) {
    const existing = byItem.get(row.itemId) ?? {
      itemId: row.itemId,
      itemCode: row.itemCode,
      itemNameTh: row.itemNameTh,
      unitCode: row.unitCode,
      baseQty: "0",
      weightedAverageCost: "0.0000",
      stockValue: "0.0000",
      entries: [],
    };

    existing.baseQty = addQty(existing.baseQty, row.baseQty);
    existing.entries.push({ baseQty: row.baseQty, unitCost: row.unitCost });
    byItem.set(row.itemId, existing);
  }

  return [...byItem.values()].map((row) => {
    const average = weightedAverageCost(row.entries);
    return {
      itemId: row.itemId,
      itemCode: row.itemCode,
      itemNameTh: row.itemNameTh,
      unitCode: row.unitCode,
      baseQty: row.baseQty,
      weightedAverageCost: average,
      stockValue: mulQty(row.baseQty, average),
    };
  });
}

export type MenuCostLine = {
  itemId: string;
  itemNameTh: string;
  baseQty: string;
  unitCost: string;
  lineCost: string;
};

export type MenuCost = {
  recipeVersionId: string;
  versionNo: number;
  menuNameTh: string;
  mealPeriodId: string | null;
  lines: MenuCostLine[];
  totalCost: string;
};

/**
 * What a menu should cost: the BOM quantities for a shift, priced at today's weighted
 * average. This is the standard — a plan, not a record of what happened.
 */
export async function getMenuStandardCost(input: {
  organizationId: string;
  recipeVersionId: string;
  mealPeriodId?: string;
  locationId?: string;
}): Promise<MenuCost> {
  await requirePermission(PERMISSIONS.COST_VIEW);

  const [version] = await db
    .select({
      id: recipeVersions.id,
      versionNo: recipeVersions.versionNo,
      menuNameTh: menus.nameTh,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(menus, eq(menus.id, recipes.menuId))
    .where(
      and(
        eq(recipeVersions.id, input.recipeVersionId),
        eq(menus.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!version) throw new AppError("NOT_FOUND", "ไม่พบสูตรอาหาร");

  const bomRows = await db
    .select({
      recipeItemId: recipeItems.id,
      itemId: items.id,
      itemNameTh: items.nameTh,
      totalQty: recipeItems.quantity,
    })
    .from(recipeItems)
    .innerJoin(items, eq(items.id, recipeItems.itemId))
    .where(eq(recipeItems.recipeVersionId, input.recipeVersionId))
    .orderBy(asc(items.code));

  const periodRows =
    input.mealPeriodId && bomRows.length > 0
      ? await db
          .select({
            recipeItemId: recipeItemPeriodQuantities.recipeItemId,
            quantity: recipeItemPeriodQuantities.quantity,
          })
          .from(recipeItemPeriodQuantities)
          .where(
            and(
              eq(recipeItemPeriodQuantities.mealPeriodId, input.mealPeriodId),
              inArray(
                recipeItemPeriodQuantities.recipeItemId,
                bomRows.map((row) => row.recipeItemId),
              ),
            ),
          )
      : [];

  const periodByRecipeItem = new Map(periodRows.map((row) => [row.recipeItemId, row.quantity]));
  const costs = await getItemCosts(input.organizationId, { locationId: input.locationId });
  const costByItem = new Map(costs.map((row) => [row.itemId, row.weightedAverageCost]));

  const lines: MenuCostLine[] = [];
  let totalCost = "0";

  for (const row of bomRows) {
    // A shift's cost uses that shift's half of the split; without a shift, the whole line.
    const baseQty = input.mealPeriodId
      ? (periodByRecipeItem.get(row.recipeItemId) ?? "0")
      : row.totalQty;
    if (Number(baseQty) <= 0) continue;

    const unitCost = costByItem.get(row.itemId) ?? "0.0000";
    const lineCost = mulQty(baseQty, unitCost);
    totalCost = addQty(totalCost, lineCost);

    lines.push({
      itemId: row.itemId,
      itemNameTh: row.itemNameTh,
      baseQty: toNumericString(baseQty),
      unitCost,
      lineCost,
    });
  }

  return {
    recipeVersionId: version.id,
    versionNo: version.versionNo,
    menuNameTh: version.menuNameTh,
    mealPeriodId: input.mealPeriodId ?? null,
    lines,
    totalCost,
  };
}

export type IssueCostRow = {
  issueId: string;
  issueNumber: string;
  issuedAt: Date;
  menuNameTh: string | null;
  periodNameTh: string | null;
  recipeVersionId: string | null;
  actualCost: string;
};

/**
 * What an issue actually cost, from the unit costs frozen onto its lines when it posted.
 * Re-running this next year returns the same number.
 */
export async function getIssueCosts(
  organizationId: string,
  input: { fromDate: string; toDate: string; locationId?: string },
): Promise<IssueCostRow[]> {
  await requirePermission(PERMISSIONS.COST_VIEW);

  const filters = [
    eq(stockIssues.organizationId, organizationId),
    ...bangkokDayRange(stockIssues.issuedAt, input.fromDate, input.toDate),
  ];
  if (input.locationId) filters.push(eq(stockIssues.locationId, input.locationId));

  const rows = await db
    .select({
      issueId: stockIssues.id,
      issueNumber: stockIssues.issueNumber,
      issuedAt: stockIssues.issuedAt,
      menuNameTh: menus.nameTh,
      periodNameTh: mealPeriods.nameTh,
      recipeVersionId: stockIssues.recipeVersionId,
      actualCost: sql<string>`coalesce(sum(${stockIssueItems.issuedBaseQty} * ${stockIssueItems.unitCost}), 0)`,
    })
    .from(stockIssues)
    .leftJoin(menus, eq(menus.id, stockIssues.menuId))
    .leftJoin(mealPeriods, eq(mealPeriods.id, stockIssues.mealPeriodId))
    .leftJoin(stockIssueItems, eq(stockIssueItems.stockIssueId, stockIssues.id))
    .where(and(...filters))
    .groupBy(
      stockIssues.id,
      stockIssues.issueNumber,
      stockIssues.issuedAt,
      menus.nameTh,
      mealPeriods.nameTh,
      stockIssues.recipeVersionId,
    )
    .orderBy(desc(stockIssues.issuedAt));

  return rows;
}

export type DailyCostRow = {
  costDate: string;
  issueCost: string;
  wasteCost: string;
  totalCost: string;
};

/**
 * Cost per day, read from the ledger's own frozen unit costs.
 *
 * This is the number that must not move: it comes from `inventory_transactions.unit_cost`,
 * captured at posting time, not from what the lots would cost if bought today.
 *
 * Only consumption counts. A transfer out is not a cost — the stock is still the canteen's,
 * it just moved building. A reversal counts negatively on the day the reversal was posted,
 * not on the day of the mistake: a report someone already signed off does not get rewritten
 * behind them, which is the same reason the ledger reverses instead of editing.
 */
export async function getDailyCosts(
  organizationId: string,
  input: { fromDate: string; toDate: string; locationId?: string },
): Promise<DailyCostRow[]> {
  await requirePermission(PERMISSIONS.COST_VIEW);

  const original = alias(inventoryTransactions, "original_transaction");
  // A reversal carries type REVERSAL, so the kind of cost it cancels comes from its target.
  const effectiveType = sql<string>`coalesce(${original.transactionType}, ${inventoryTransactions.transactionType})`;
  const costDate = sql<string>`to_char(${inventoryTransactions.transactionAt} at time zone ${sql.raw(`'${BUSINESS_TIME_ZONE}'`)}, 'YYYY-MM-DD')`;

  const filters = [
    eq(inventoryTransactions.organizationId, organizationId),
    sql`${effectiveType} in ('ISSUE', 'WASTE')`,
    ...bangkokDayRange(inventoryTransactions.transactionAt, input.fromDate, input.toDate),
  ];
  if (input.locationId) filters.push(eq(inventoryTransactions.locationId, input.locationId));

  const rows = await db
    .select({
      costDate,
      transactionType: effectiveType,
      value: sql<string>`sum(
        ${inventoryTransactions.baseQty} * ${inventoryTransactions.unitCost}
        * case when ${inventoryTransactions.direction} = 'OUT' then 1 else -1 end
      )`,
    })
    .from(inventoryTransactions)
    .leftJoin(original, eq(original.id, inventoryTransactions.reversalOfTransactionId))
    .where(and(...filters))
    .groupBy(costDate, effectiveType);

  const byDate = new Map<string, DailyCostRow>();

  for (const row of rows) {
    const entry = byDate.get(row.costDate) ?? {
      costDate: row.costDate,
      issueCost: "0.0000",
      wasteCost: "0.0000",
      totalCost: "0.0000",
    };

    if (row.transactionType === "ISSUE") {
      entry.issueCost = addQty(entry.issueCost, row.value);
    } else if (row.transactionType === "WASTE") {
      entry.wasteCost = addQty(entry.wasteCost, row.value);
    } else {
      continue;
    }

    entry.totalCost = addQty(entry.issueCost, entry.wasteCost);
    byDate.set(row.costDate, entry);
  }

  return [...byDate.values()].sort((a, b) => a.costDate.localeCompare(b.costDate));
}

export type MonthlyCostRow = { month: string; totalCost: string };

export async function getMonthlyCosts(
  organizationId: string,
  input: { fromDate: string; toDate: string; locationId?: string },
): Promise<MonthlyCostRow[]> {
  const daily = await getDailyCosts(organizationId, input);

  const byMonth = new Map<string, string>();
  for (const row of daily) {
    const month = row.costDate.slice(0, 7);
    byMonth.set(month, addQty(byMonth.get(month) ?? "0", row.totalCost));
  }

  return [...byMonth.entries()]
    .map(([month, totalCost]) => ({ month, totalCost }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Standard versus actual for one issue, priced with the issue's own frozen unit costs on
 * both sides. Holding price constant isolates the part the kitchen controls — how much was
 * taken against how much the recipe asked for — instead of mixing in a price movement the
 * cook had nothing to do with. Lines issued without a standard (a manual issue) contribute
 * no variance rather than showing up as if the whole line were an overdraw.
 */
export async function getIssueCostVariance(
  organizationId: string,
  issueId: string,
): Promise<(CostVariance & { issueNumber: string }) | null> {
  await requirePermission(PERMISSIONS.COST_VIEW);

  const [issue] = await db
    .select({
      id: stockIssues.id,
      issueNumber: stockIssues.issueNumber,
      recipeVersionId: stockIssues.recipeVersionId,
      mealPeriodId: stockIssues.mealPeriodId,
      locationId: stockIssues.locationId,
    })
    .from(stockIssues)
    .where(and(eq(stockIssues.id, issueId), eq(stockIssues.organizationId, organizationId)))
    .limit(1);

  if (!issue) return null;

  const [actual] = await db
    .select({
      value: sql<string>`coalesce(sum(${stockIssueItems.issuedBaseQty} * ${stockIssueItems.unitCost}), 0)`,
      standard: sql<string>`coalesce(sum(coalesce(${stockIssueItems.requestedBaseQty}, ${stockIssueItems.issuedBaseQty}) * ${stockIssueItems.unitCost}), 0)`,
    })
    .from(stockIssueItems)
    .where(eq(stockIssueItems.stockIssueId, issueId));

  return {
    ...costVariance(actual?.standard ?? "0", actual?.value ?? "0"),
    issueNumber: issue.issueNumber,
  };
}

export type PriceHistoryRow = {
  receivedDate: string;
  lotNumber: string;
  itemCode: string;
  itemNameTh: string;
  unitCost: string;
  baseQty: string;
};

/** What each delivery of an item actually cost, newest first. */
export async function getPriceHistory(
  organizationId: string,
  input: { itemId?: string; fromDate?: string; toDate?: string; limit?: number } = {},
): Promise<PriceHistoryRow[]> {
  await requirePermission(PERMISSIONS.COST_VIEW);

  const filters = [eq(inventoryLots.organizationId, organizationId)];
  if (input.itemId) filters.push(eq(inventoryLots.itemId, input.itemId));
  if (input.fromDate && input.toDate) {
    filters.push(between(inventoryLots.receivedDate, input.fromDate, input.toDate));
  }

  return db
    .select({
      receivedDate: inventoryLots.receivedDate,
      lotNumber: inventoryLots.lotNumber,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitCost: inventoryLots.unitCost,
      baseQty: inventoryLots.receivedBaseQty,
    })
    .from(inventoryLots)
    .innerJoin(items, eq(items.id, inventoryLots.itemId))
    .where(and(...filters))
    .orderBy(desc(inventoryLots.receivedDate), asc(items.code))
    .limit(input.limit ?? 100);
}
