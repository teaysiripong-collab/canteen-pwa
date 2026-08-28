import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/database/client";
import {
  items,
  locations,
  mealPeriods,
  menus,
  recipeVersions,
  stockIssueItems,
  stockIssues,
  units,
  users,
} from "@/database/schema";

export async function listStockIssues(
  organizationId: string,
  query: { page?: number; pageSize?: number } = {},
) {
  const where = eq(stockIssues.organizationId, organizationId);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: stockIssues.id,
        issueNumber: stockIssues.issueNumber,
        issuedAt: stockIssues.issuedAt,
        locationCode: locations.code,
        menuNameTh: menus.nameTh,
        periodNameTh: mealPeriods.nameTh,
        userName: users.fullName,
        lineCount: count(stockIssueItems.id),
      })
      .from(stockIssues)
      .innerJoin(locations, eq(locations.id, stockIssues.locationId))
      .leftJoin(menus, eq(menus.id, stockIssues.menuId))
      .leftJoin(mealPeriods, eq(mealPeriods.id, stockIssues.mealPeriodId))
      .leftJoin(users, eq(users.id, stockIssues.createdBy))
      .leftJoin(stockIssueItems, eq(stockIssueItems.stockIssueId, stockIssues.id))
      .where(where)
      .groupBy(
        stockIssues.id,
        stockIssues.issueNumber,
        stockIssues.issuedAt,
        locations.code,
        menus.nameTh,
        mealPeriods.nameTh,
        users.fullName,
      )
      .orderBy(desc(stockIssues.issuedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(stockIssues).where(where),
  ]);

  return { rows, total: total?.value ?? 0 };
}

export async function getStockIssueById(organizationId: string, id: string) {
  const [issue] = await db
    .select({
      id: stockIssues.id,
      issueNumber: stockIssues.issueNumber,
      issuedAt: stockIssues.issuedAt,
      servings: stockIssues.servings,
      note: stockIssues.note,
      locationCode: locations.code,
      locationNameTh: locations.nameTh,
      menuNameTh: menus.nameTh,
      periodNameTh: mealPeriods.nameTh,
      versionNo: recipeVersions.versionNo,
      userName: users.fullName,
    })
    .from(stockIssues)
    .innerJoin(locations, eq(locations.id, stockIssues.locationId))
    .leftJoin(menus, eq(menus.id, stockIssues.menuId))
    .leftJoin(mealPeriods, eq(mealPeriods.id, stockIssues.mealPeriodId))
    .leftJoin(recipeVersions, eq(recipeVersions.id, stockIssues.recipeVersionId))
    .leftJoin(users, eq(users.id, stockIssues.createdBy))
    .where(and(eq(stockIssues.id, id), eq(stockIssues.organizationId, organizationId)))
    .limit(1);

  if (!issue) return null;

  const lines = await db
    .select({
      id: stockIssueItems.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitCode: units.code,
      requestedBaseQty: stockIssueItems.requestedBaseQty,
      issuedBaseQty: stockIssueItems.issuedBaseQty,
      unitCost: stockIssueItems.unitCost,
      fefoOverridden: stockIssueItems.fefoOverridden,
      note: stockIssueItems.note,
    })
    .from(stockIssueItems)
    .innerJoin(items, eq(items.id, stockIssueItems.itemId))
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .where(eq(stockIssueItems.stockIssueId, id))
    .orderBy(asc(items.code));

  return { issue, lines };
}
