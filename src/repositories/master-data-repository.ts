import { and, asc, count, eq, ilike, inArray, or, type Column, type SQL } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  itemAliases,
  itemCategories,
  items,
  locations,
  suppliers,
  units,
} from "@/database/schema";
import type { ListQuery } from "@/schemas/common";

function statusFilter(column: Column, status: ListQuery["status"]): SQL | undefined {
  if (status === "active") return eq(column, true);
  if (status === "inactive") return eq(column, false);
  return undefined;
}

/* ----------------------------------------------------------------- locations */

export async function listLocations(organizationId: string, query: ListQuery) {
  const filters = [eq(locations.organizationId, organizationId)];
  const status = statusFilter(locations.isActive, query.status);
  if (status) filters.push(status);
  if (query.q) {
    const search = `%${query.q}%`;
    filters.push(or(ilike(locations.code, search), ilike(locations.nameTh, search))!);
  }

  return db
    .select()
    .from(locations)
    .where(and(...filters))
    .orderBy(asc(locations.code));
}

export async function getLocationById(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.organizationId, organizationId), eq(locations.id, id)))
    .limit(1);
  return row ?? null;
}

/* ----------------------------------------------------------------- suppliers */

export async function listSuppliers(organizationId: string, query: ListQuery) {
  const filters = [eq(suppliers.organizationId, organizationId)];
  const status = statusFilter(suppliers.isActive, query.status);
  if (status) filters.push(status);
  if (query.q) {
    const search = `%${query.q}%`;
    filters.push(
      or(
        ilike(suppliers.code, search),
        ilike(suppliers.nameTh, search),
        ilike(suppliers.contactName, search),
      )!,
    );
  }

  return db
    .select()
    .from(suppliers)
    .where(and(...filters))
    .orderBy(asc(suppliers.code));
}

export async function getSupplierById(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, id)))
    .limit(1);
  return row ?? null;
}

/* --------------------------------------------------------------------- items */

export type ItemListRow = Awaited<ReturnType<typeof listItems>>["rows"][number];

export async function listItems(organizationId: string, query: ListQuery) {
  const filters = [eq(items.organizationId, organizationId)];
  const status = statusFilter(items.isActive, query.status);
  if (status) filters.push(status);

  if (query.q) {
    const search = `%${query.q}%`;
    // Alias search runs as a sub-select so "ไก่สับ" also finds "ไก่ตัวสับ".
    const aliasMatches = db
      .select({ itemId: itemAliases.itemId })
      .from(itemAliases)
      .where(ilike(itemAliases.alias, search));

    filters.push(
      or(
        ilike(items.code, search),
        ilike(items.nameTh, search),
        ilike(items.nameEn, search),
        ilike(items.barcode, search),
        inArray(items.id, aliasMatches),
      )!,
    );
  }

  const where = and(...filters);
  const offset = (query.page - 1) * query.pageSize;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: items.id,
        code: items.code,
        nameTh: items.nameTh,
        nameEn: items.nameEn,
        isActive: items.isActive,
        minimumStock: items.minimumStock,
        reorderPoint: items.reorderPoint,
        purchaseConversion: items.purchaseConversion,
        categoryName: itemCategories.nameTh,
        baseUnitCode: units.code,
        supplierName: suppliers.nameTh,
      })
      .from(items)
      .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
      .leftJoin(units, eq(units.id, items.baseUnitId))
      .leftJoin(suppliers, eq(suppliers.id, items.preferredSupplierId))
      .where(where)
      .orderBy(asc(items.code))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ value: count() }).from(items).where(where),
  ]);

  return { rows, total: total?.value ?? 0 };
}

export async function getItemById(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(items)
    .where(and(eq(items.organizationId, organizationId), eq(items.id, id)))
    .limit(1);
  if (!row) return null;

  const aliases = await db
    .select({ alias: itemAliases.alias })
    .from(itemAliases)
    .where(eq(itemAliases.itemId, id))
    .orderBy(asc(itemAliases.alias));

  return { ...row, aliases: aliases.map((entry) => entry.alias) };
}

export async function replaceItemAliases(
  executor: DbExecutor,
  itemId: string,
  aliases: string[],
): Promise<void> {
  await executor.delete(itemAliases).where(eq(itemAliases.itemId, itemId));
  const unique = [...new Set(aliases)];
  if (unique.length > 0) {
    await executor.insert(itemAliases).values(unique.map((alias) => ({ itemId, alias })));
  }
}

/* -------------------------------------------------------------- form options */

export async function getMasterDataOptions(organizationId: string) {
  const [unitOptions, categoryOptions, supplierOptions, locationOptions] = await Promise.all([
    db.select().from(units).where(eq(units.isActive, true)).orderBy(asc(units.code)),
    db
      .select()
      .from(itemCategories)
      .where(and(eq(itemCategories.organizationId, organizationId), eq(itemCategories.isActive, true)))
      .orderBy(asc(itemCategories.sortOrder)),
    db
      .select({ id: suppliers.id, code: suppliers.code, nameTh: suppliers.nameTh })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.isActive, true)))
      .orderBy(asc(suppliers.code)),
    db
      .select({ id: locations.id, code: locations.code, nameTh: locations.nameTh })
      .from(locations)
      .where(and(eq(locations.organizationId, organizationId), eq(locations.isActive, true)))
      .orderBy(asc(locations.code)),
  ]);

  return { units: unitOptions, categories: categoryOptions, suppliers: supplierOptions, locations: locationOptions };
}

export async function countMasterData(organizationId: string) {
  const [itemCount, supplierCount, locationCount] = await Promise.all([
    db
      .select({ value: count() })
      .from(items)
      .where(and(eq(items.organizationId, organizationId), eq(items.isActive, true))),
    db
      .select({ value: count() })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.isActive, true))),
    db
      .select({ value: count() })
      .from(locations)
      .where(and(eq(locations.organizationId, organizationId), eq(locations.isActive, true))),
  ]);

  return {
    items: itemCount[0]?.value ?? 0,
    suppliers: supplierCount[0]?.value ?? 0,
    locations: locationCount[0]?.value ?? 0,
  };
}
