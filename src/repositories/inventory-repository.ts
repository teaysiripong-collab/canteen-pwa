import { and, asc, count, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/database/client";
import {
  inventoryLots,
  inventoryPostings,
  inventoryTransactions,
  itemCategories,
  items,
  locations,
  stockBalances,
  units,
  users,
} from "@/database/schema";
import { addDays } from "@/lib/date";

/* ------------------------------------------------------------------ balances */

export type StockBalanceRow = {
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  categoryName: string | null;
  baseUnitCode: string | null;
  locationId: string;
  locationCode: string;
  locationNameTh: string;
  baseQty: string;
  lotCount: number;
  minimumStock: string;
  reorderPoint: string;
};

export type StockQuery = {
  q?: string;
  locationId?: string;
  /** Hide items whose balance is zero at every location. */
  onlyInStock?: boolean;
  /** Only items at or below their reorder point. */
  onlyBelowReorder?: boolean;
};

/**
 * Current stock rolled up to item × location. The balances table is already per lot, so
 * this is a plain aggregate — the ledger stays the source of truth behind it.
 */
export async function listStockBalances(
  organizationId: string,
  query: StockQuery = {},
): Promise<StockBalanceRow[]> {
  const filters: SQL[] = [eq(stockBalances.organizationId, organizationId)];

  if (query.locationId) filters.push(eq(stockBalances.locationId, query.locationId));
  if (query.onlyInStock) filters.push(gt(stockBalances.baseQty, "0"));
  if (query.q) {
    const search = `%${query.q}%`;
    filters.push(or(ilike(items.code, search), ilike(items.nameTh, search))!);
  }

  const rows = await db
    .select({
      itemId: items.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      categoryName: itemCategories.nameTh,
      baseUnitCode: units.code,
      locationId: locations.id,
      locationCode: locations.code,
      locationNameTh: locations.nameTh,
      baseQty: sql<string>`sum(${stockBalances.baseQty})`,
      lotCount: sql<number>`count(*) filter (where ${stockBalances.baseQty} > 0)`,
      minimumStock: items.minimumStock,
      reorderPoint: items.reorderPoint,
    })
    .from(stockBalances)
    .innerJoin(items, eq(items.id, stockBalances.itemId))
    .innerJoin(locations, eq(locations.id, stockBalances.locationId))
    .leftJoin(itemCategories, eq(itemCategories.id, items.categoryId))
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .where(and(...filters))
    .groupBy(
      items.id,
      items.code,
      items.nameTh,
      itemCategories.nameTh,
      units.code,
      locations.id,
      locations.code,
      locations.nameTh,
      items.minimumStock,
      items.reorderPoint,
    )
    .orderBy(asc(items.code), asc(locations.code));

  const mapped = rows.map((row) => ({ ...row, lotCount: Number(row.lotCount) }));

  return query.onlyBelowReorder
    ? mapped.filter((row) => Number(row.baseQty) <= Number(row.reorderPoint))
    : mapped;
}

/** Per-lot detail behind one item × location balance, oldest expiry first (FEFO order). */
export async function listLotBalances(
  organizationId: string,
  itemId: string,
  locationId?: string,
) {
  const filters: SQL[] = [
    eq(stockBalances.organizationId, organizationId),
    eq(stockBalances.itemId, itemId),
    gt(stockBalances.baseQty, "0"),
  ];
  if (locationId) filters.push(eq(stockBalances.locationId, locationId));

  return db
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      expiryDate: inventoryLots.expiryDate,
      receivedDate: inventoryLots.receivedDate,
      unitCost: inventoryLots.unitCost,
      locationId: locations.id,
      locationCode: locations.code,
      locationNameTh: locations.nameTh,
      baseQty: stockBalances.baseQty,
    })
    .from(stockBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockBalances.lotId))
    .innerJoin(locations, eq(locations.id, stockBalances.locationId))
    .where(and(...filters))
    .orderBy(
      sql`${inventoryLots.expiryDate} asc nulls last`,
      asc(inventoryLots.receivedDate),
      asc(inventoryLots.id),
    );
}

export async function getItemStockSummary(organizationId: string, itemId: string) {
  const [row] = await db
    .select({
      baseQty: sql<string>`coalesce(sum(${stockBalances.baseQty}), 0)`,
    })
    .from(stockBalances)
    .where(
      and(eq(stockBalances.organizationId, organizationId), eq(stockBalances.itemId, itemId)),
    );

  return { baseQty: row?.baseQty ?? "0" };
}

/* ---------------------------------------------------------- movement history */

export type MovementQuery = {
  itemId?: string;
  locationId?: string;
  lotId?: string;
  postingId?: string;
  /** Bangkok business days, inclusive on both ends. */
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

/**
 * The audit view of the ledger: who moved what, when, and under which document.
 * Rows are immutable, so this is a straight read with no derivation.
 */
export async function listStockMovements(organizationId: string, query: MovementQuery = {}) {
  const filters: SQL[] = [eq(inventoryTransactions.organizationId, organizationId)];

  if (query.itemId) filters.push(eq(inventoryTransactions.itemId, query.itemId));
  if (query.locationId) filters.push(eq(inventoryTransactions.locationId, query.locationId));
  if (query.lotId) filters.push(eq(inventoryTransactions.lotId, query.lotId));
  // Bangkok day bounds, so a night-shift movement lands in the day the kitchen worked.
  if (query.fromDate) {
    filters.push(
      sql`${inventoryTransactions.transactionAt} >= (${query.fromDate}::timestamp at time zone 'Asia/Bangkok')`,
    );
  }
  if (query.toDate) {
    filters.push(
      sql`${inventoryTransactions.transactionAt} < ((${query.toDate}::timestamp + interval '1 day') at time zone 'Asia/Bangkok')`,
    );
  }
  if (query.postingId) filters.push(eq(inventoryTransactions.postingId, query.postingId));

  const where = and(...filters);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: inventoryTransactions.id,
        postingId: inventoryTransactions.postingId,
        transactionType: inventoryTransactions.transactionType,
        direction: inventoryTransactions.direction,
        baseQty: inventoryTransactions.baseQty,
        unitCost: inventoryTransactions.unitCost,
        transactionAt: inventoryTransactions.transactionAt,
        referenceType: inventoryTransactions.referenceType,
        referenceNumber: inventoryTransactions.referenceNumber,
        note: inventoryTransactions.note,
        itemCode: items.code,
        itemNameTh: items.nameTh,
        baseUnitCode: units.code,
        lotNumber: inventoryLots.lotNumber,
        expiryDate: inventoryLots.expiryDate,
        locationCode: locations.code,
        locationNameTh: locations.nameTh,
        userName: users.fullName,
      })
      .from(inventoryTransactions)
      .innerJoin(items, eq(items.id, inventoryTransactions.itemId))
      .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryTransactions.lotId))
      .innerJoin(locations, eq(locations.id, inventoryTransactions.locationId))
      .leftJoin(units, eq(units.id, inventoryTransactions.baseUnitId))
      .leftJoin(users, eq(users.id, inventoryTransactions.userId))
      .where(where)
      .orderBy(desc(inventoryTransactions.transactionAt), desc(inventoryTransactions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(inventoryTransactions).where(where),
  ]);

  return { rows, total: total?.value ?? 0 };
}

export async function getPostingWithLines(organizationId: string, postingId: string) {
  const [posting] = await db
    .select()
    .from(inventoryPostings)
    .where(
      and(
        eq(inventoryPostings.id, postingId),
        eq(inventoryPostings.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!posting) return null;

  const { rows } = await listStockMovements(organizationId, { postingId, pageSize: 200 });
  return { posting, lines: rows };
}

/**
 * Lots that are already expired or will expire within `days` of the given business date,
 * worst first. The date is passed in rather than read from the database, because the
 * server's `current_date` is UTC and the canteen's day is Bangkok's.
 */
export async function listExpiringLots(organizationId: string, days: number, today: string) {
  return db
    .select({
      lotId: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      expiryDate: inventoryLots.expiryDate,
      itemId: items.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      baseUnitCode: units.code,
      locationCode: locations.code,
      locationNameTh: locations.nameTh,
      baseQty: stockBalances.baseQty,
    })
    .from(stockBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockBalances.lotId))
    .innerJoin(items, eq(items.id, stockBalances.itemId))
    .innerJoin(locations, eq(locations.id, stockBalances.locationId))
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .where(
      and(
        eq(stockBalances.organizationId, organizationId),
        gt(stockBalances.baseQty, "0"),
        sql`${inventoryLots.expiryDate} is not null`,
        sql`${inventoryLots.expiryDate} <= ${addDays(today, days)}::date`,
      ),
    )
    .orderBy(asc(inventoryLots.expiryDate), asc(items.code));
}

export async function listStockLocations(organizationId: string) {
  return db
    .select({ id: locations.id, code: locations.code, nameTh: locations.nameTh })
    .from(locations)
    .where(
      and(
        eq(locations.organizationId, organizationId),
        eq(locations.isActive, true),
        eq(locations.holdsStock, true),
      ),
    )
    .orderBy(asc(locations.code));
}

/** Used by the tests and by future workflows that need a lot id for a known item. */
export async function listLotsForItems(organizationId: string, itemIds: string[]) {
  if (itemIds.length === 0) return [];
  return db
    .select({ id: inventoryLots.id, itemId: inventoryLots.itemId, lotNumber: inventoryLots.lotNumber })
    .from(inventoryLots)
    .where(
      and(eq(inventoryLots.organizationId, organizationId), inArray(inventoryLots.itemId, itemIds)),
    );
}
