import { alias } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/database/client";
import {
  items,
  locations,
  stockBalances,
  stockTransferItems,
  stockTransfers,
  units,
  users,
} from "@/database/schema";

const fromLocation = alias(locations, "from_location");
const toLocation = alias(locations, "to_location");

/** Items that actually have stock at the source — the only ones worth offering to move. */
export async function listTransferableItems(organizationId: string, fromLocationId: string) {
  return db
    .select({
      id: items.id,
      code: items.code,
      nameTh: items.nameTh,
      baseUnitCode: units.code,
      availableBaseQty: stockBalances.baseQty,
    })
    .from(stockBalances)
    .innerJoin(items, eq(items.id, stockBalances.itemId))
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .where(
      and(
        eq(stockBalances.organizationId, organizationId),
        eq(stockBalances.locationId, fromLocationId),
      ),
    )
    .orderBy(asc(items.code));
}

export async function listStockTransfers(
  organizationId: string,
  query: { page?: number; pageSize?: number } = {},
) {
  const where = eq(stockTransfers.organizationId, organizationId);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: stockTransfers.id,
        transferNumber: stockTransfers.transferNumber,
        transferredAt: stockTransfers.transferredAt,
        fromCode: fromLocation.code,
        toCode: toLocation.code,
        userName: users.fullName,
        lineCount: count(stockTransferItems.id),
      })
      .from(stockTransfers)
      .innerJoin(fromLocation, eq(fromLocation.id, stockTransfers.fromLocationId))
      .innerJoin(toLocation, eq(toLocation.id, stockTransfers.toLocationId))
      .leftJoin(users, eq(users.id, stockTransfers.createdBy))
      .leftJoin(stockTransferItems, eq(stockTransferItems.stockTransferId, stockTransfers.id))
      .where(where)
      .groupBy(
        stockTransfers.id,
        stockTransfers.transferNumber,
        stockTransfers.transferredAt,
        fromLocation.code,
        toLocation.code,
        users.fullName,
      )
      .orderBy(desc(stockTransfers.transferredAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(stockTransfers).where(where),
  ]);

  return { rows, total: total?.value ?? 0 };
}

export async function getStockTransferById(organizationId: string, id: string) {
  const [transfer] = await db
    .select({
      id: stockTransfers.id,
      transferNumber: stockTransfers.transferNumber,
      transferredAt: stockTransfers.transferredAt,
      note: stockTransfers.note,
      fromCode: fromLocation.code,
      fromName: fromLocation.nameTh,
      toCode: toLocation.code,
      toName: toLocation.nameTh,
      userName: users.fullName,
    })
    .from(stockTransfers)
    .innerJoin(fromLocation, eq(fromLocation.id, stockTransfers.fromLocationId))
    .innerJoin(toLocation, eq(toLocation.id, stockTransfers.toLocationId))
    .leftJoin(users, eq(users.id, stockTransfers.createdBy))
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.organizationId, organizationId)))
    .limit(1);

  if (!transfer) return null;

  const lines = await db
    .select({
      id: stockTransferItems.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      baseUnitCode: units.code,
      transferBaseQty: stockTransferItems.transferBaseQty,
      note: stockTransferItems.note,
    })
    .from(stockTransferItems)
    .innerJoin(items, eq(items.id, stockTransferItems.itemId))
    .leftJoin(units, eq(units.id, items.baseUnitId))
    .where(eq(stockTransferItems.stockTransferId, id))
    .orderBy(asc(items.code));

  return { transfer, lines };
}
