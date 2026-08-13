import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/database/client";
import {
  itemCategories,
  items,
  mealPeriods,
  menuCategories,
  menus,
  recipeItemPeriodQuantities,
  recipeItems,
  recipeVersions,
  recipes,
  units,
} from "@/database/schema";
import type { ListQuery } from "@/schemas/common";

export async function listMenus(organizationId: string, query: ListQuery) {
  const filters = [eq(menus.organizationId, organizationId)];
  if (query.status === "active") filters.push(eq(menus.isActive, true));
  if (query.status === "inactive") filters.push(eq(menus.isActive, false));
  if (query.q) {
    const search = `%${query.q}%`;
    filters.push(or(ilike(menus.code, search), ilike(menus.nameTh, search))!);
  }

  return db
    .select({
      id: menus.id,
      code: menus.code,
      nameTh: menus.nameTh,
      isActive: menus.isActive,
      categoryName: menuCategories.nameTh,
      /** Highest published version number, or null when the BOM is still a draft. */
      publishedVersion: sql<number | null>`(
        select max(${recipeVersions.versionNo})
        from ${recipeVersions}
        join ${recipes} on ${recipes.id} = ${recipeVersions.recipeId}
        where ${recipes.menuId} = ${menus.id} and ${recipeVersions.isPublished} = true
      )`,
    })
    .from(menus)
    .leftJoin(menuCategories, eq(menuCategories.id, menus.categoryId))
    .where(and(...filters))
    .orderBy(asc(menus.code));
}

export async function getMenuById(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(menus)
    .where(and(eq(menus.id, id), eq(menus.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listMenuCategories(organizationId: string) {
  return db
    .select({ id: menuCategories.id, nameTh: menuCategories.nameTh })
    .from(menuCategories)
    .where(
      and(eq(menuCategories.organizationId, organizationId), eq(menuCategories.isActive, true)),
    )
    .orderBy(asc(menuCategories.sortOrder));
}

export async function listRecipeVersions(organizationId: string, menuId: string) {
  return db
    .select({
      id: recipeVersions.id,
      versionNo: recipeVersions.versionNo,
      isPublished: recipeVersions.isPublished,
      effectiveFrom: recipeVersions.effectiveFrom,
      yieldQty: recipeVersions.yieldQty,
      note: recipeVersions.note,
      updatedAt: recipeVersions.updatedAt,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(menus, eq(menus.id, recipes.menuId))
    .where(and(eq(menus.id, menuId), eq(menus.organizationId, organizationId)))
    .orderBy(desc(recipeVersions.versionNo));
}

export type BomLineRow = {
  id: string;
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  unitId: string;
  unitCode: string | null;
  quantity: string;
  wasteFactor: string;
  note: string | null;
  /** Per meal period, in period order. */
  periods: Array<{ mealPeriodId: string; code: string; nameTh: string; quantity: string }>;
};

/**
 * A version with its lines and the per-period split. Published versions are read back
 * exactly as they were saved — nothing here recomputes them from current master data.
 */
export async function getRecipeVersionDetail(organizationId: string, recipeVersionId: string) {
  const [version] = await db
    .select({
      id: recipeVersions.id,
      versionNo: recipeVersions.versionNo,
      isPublished: recipeVersions.isPublished,
      effectiveFrom: recipeVersions.effectiveFrom,
      yieldQty: recipeVersions.yieldQty,
      yieldUnitId: recipeVersions.yieldUnitId,
      note: recipeVersions.note,
      menuId: menus.id,
      menuCode: menus.code,
      menuNameTh: menus.nameTh,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(menus, eq(menus.id, recipes.menuId))
    .where(
      and(
        eq(recipeVersions.id, recipeVersionId),
        eq(menus.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!version) return null;

  const lineRows = await db
    .select({
      id: recipeItems.id,
      itemId: items.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitId: recipeItems.unitId,
      unitCode: units.code,
      quantity: recipeItems.quantity,
      wasteFactor: recipeItems.wasteFactor,
      note: recipeItems.note,
      sortOrder: recipeItems.sortOrder,
    })
    .from(recipeItems)
    .innerJoin(items, eq(items.id, recipeItems.itemId))
    .leftJoin(units, eq(units.id, recipeItems.unitId))
    .where(eq(recipeItems.recipeVersionId, recipeVersionId))
    .orderBy(asc(recipeItems.sortOrder));

  const periodRows =
    lineRows.length === 0
      ? []
      : await db
          .select({
            recipeItemId: recipeItemPeriodQuantities.recipeItemId,
            mealPeriodId: mealPeriods.id,
            code: mealPeriods.code,
            nameTh: mealPeriods.nameTh,
            sortOrder: mealPeriods.sortOrder,
            quantity: recipeItemPeriodQuantities.quantity,
          })
          .from(recipeItemPeriodQuantities)
          .innerJoin(mealPeriods, eq(mealPeriods.id, recipeItemPeriodQuantities.mealPeriodId))
          .where(
            inArray(
              recipeItemPeriodQuantities.recipeItemId,
              lineRows.map((line) => line.id),
            ),
          )
          .orderBy(asc(mealPeriods.sortOrder));

  const byItem = new Map<string, BomLineRow["periods"]>();
  for (const row of periodRows) {
    const list = byItem.get(row.recipeItemId) ?? [];
    list.push({
      mealPeriodId: row.mealPeriodId,
      code: row.code,
      nameTh: row.nameTh,
      quantity: row.quantity,
    });
    byItem.set(row.recipeItemId, list);
  }

  const lines: BomLineRow[] = lineRows.map((line) => ({
    id: line.id,
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemNameTh: line.itemNameTh,
    unitId: line.unitId,
    unitCode: line.unitCode,
    quantity: line.quantity,
    wasteFactor: line.wasteFactor,
    note: line.note,
    periods: byItem.get(line.id) ?? [],
  }));

  return { version, lines };
}

/** Ingredient picker options for the BOM editor. */
export async function listRecipeItemOptions(organizationId: string) {
  return db
    .select({
      id: items.id,
      code: items.code,
      nameTh: items.nameTh,
      baseUnitId: items.baseUnitId,
      baseUnitCode: units.code,
      categoryName: itemCategories.nameTh,
    })
    .from(items)
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .where(and(eq(items.organizationId, organizationId), eq(items.isActive, true)))
    .orderBy(asc(items.code));
}

/**
 * Published versions only, one row per menu version, for the cost screens. A draft has no
 * business being priced — it is not what the kitchen is cooking.
 */
export async function listPublishedRecipeVersionOptions(organizationId: string) {
  return db
    .select({
      id: recipeVersions.id,
      versionNo: recipeVersions.versionNo,
      menuCode: menus.code,
      menuNameTh: menus.nameTh,
      effectiveFrom: recipeVersions.effectiveFrom,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(menus, eq(menus.id, recipes.menuId))
    .where(
      and(
        eq(menus.organizationId, organizationId),
        eq(recipeVersions.isPublished, true),
        eq(menus.isActive, true),
      ),
    )
    .orderBy(asc(menus.code), desc(recipeVersions.versionNo));
}
