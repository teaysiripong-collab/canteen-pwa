import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/database/client";
import {
  goodsReceipts,
  items,
  locations,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
  units,
  users,
} from "@/database/schema";
import { remainingBaseQty } from "@/services/purchase-order-service";

export async function listPurchaseOrders(
  organizationId: string,
  query: { status?: string; page?: number; pageSize?: number } = {},
) {
  const filters = [eq(purchaseOrders.organizationId, organizationId)];
  if (query.status && query.status !== "all") {
    filters.push(eq(purchaseOrders.status, query.status as "DRAFT"));
  }

  const where = and(...filters);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        orderDate: purchaseOrders.orderDate,
        expectedDate: purchaseOrders.expectedDate,
        supplierName: suppliers.nameTh,
        locationCode: locations.code,
        lineCount: count(purchaseOrderItems.id),
        totalValue: sql<string>`coalesce(sum(${purchaseOrderItems.orderedQty} * ${purchaseOrderItems.unitPrice}), 0)`,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(locations, eq(locations.id, purchaseOrders.deliverToLocationId))
      .leftJoin(purchaseOrderItems, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .where(where)
      .groupBy(
        purchaseOrders.id,
        purchaseOrders.poNumber,
        purchaseOrders.status,
        purchaseOrders.orderDate,
        purchaseOrders.expectedDate,
        suppliers.nameTh,
        locations.code,
      )
      .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(purchaseOrders).where(where),
  ]);

  return { rows, total: total?.value ?? 0 };
}

export type PurchaseOrderLineRow = {
  id: string;
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  unitCode: string | null;
  baseUnitCode: string | null;
  orderedQty: string;
  conversionToBase: string;
  orderedBaseQty: string;
  receivedBaseQty: string;
  remainingBaseQty: string;
  unitPrice: string;
  note: string | null;
};

/**
 * An order with ordered / received / remaining per line — the three numbers a receiver
 * needs at the door, and the ones the status is derived from.
 */
export async function getPurchaseOrderById(organizationId: string, id: string) {
  const [order] = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      status: purchaseOrders.status,
      orderDate: purchaseOrders.orderDate,
      expectedDate: purchaseOrders.expectedDate,
      note: purchaseOrders.note,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.nameTh,
      supplierCode: suppliers.code,
      deliverToLocationId: purchaseOrders.deliverToLocationId,
      locationCode: locations.code,
      locationNameTh: locations.nameTh,
      createdByName: users.fullName,
      approvedAt: purchaseOrders.approvedAt,
      cancelReason: purchaseOrders.cancelReason,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(locations, eq(locations.id, purchaseOrders.deliverToLocationId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, organizationId)))
    .limit(1);

  if (!order) return null;

  const baseUnits = units;
  const lineRows = await db
    .select({
      id: purchaseOrderItems.id,
      itemId: items.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitCode: units.code,
      baseUnitCode: sql<string | null>`(select code from units where id = ${items.baseUnitId})`,
      orderedQty: purchaseOrderItems.orderedQty,
      conversionToBase: purchaseOrderItems.conversionToBase,
      orderedBaseQty: purchaseOrderItems.orderedBaseQty,
      receivedBaseQty: purchaseOrderItems.receivedBaseQty,
      unitPrice: purchaseOrderItems.unitPrice,
      note: purchaseOrderItems.note,
    })
    .from(purchaseOrderItems)
    .innerJoin(items, eq(items.id, purchaseOrderItems.itemId))
    .leftJoin(baseUnits, eq(baseUnits.id, purchaseOrderItems.purchaseUnitId))
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(asc(items.code));

  const lines: PurchaseOrderLineRow[] = lineRows.map((line) => ({
    ...line,
    remainingBaseQty: remainingBaseQty(line.orderedBaseQty, line.receivedBaseQty),
  }));

  const receipts = await db
    .select({
      id: goodsReceipts.id,
      receiptNumber: goodsReceipts.receiptNumber,
      receivedAt: goodsReceipts.receivedAt,
    })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.purchaseOrderId, id))
    .orderBy(desc(goodsReceipts.receivedAt));

  return { order, lines, receipts };
}

/** Orders that can still receive goods — what the receiving screen offers to pick from. */
export async function listReceivablePurchaseOrders(
  organizationId: string,
  supplierId?: string,
) {
  const filters = [
    eq(purchaseOrders.organizationId, organizationId),
    inArray(purchaseOrders.status, ["APPROVED", "SENT", "PARTIALLY_RECEIVED"]),
  ];
  if (supplierId) filters.push(eq(purchaseOrders.supplierId, supplierId));

  return db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.nameTh,
      deliverToLocationId: purchaseOrders.deliverToLocationId,
      expectedDate: purchaseOrders.expectedDate,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(...filters))
    .orderBy(asc(purchaseOrders.expectedDate), asc(purchaseOrders.poNumber));
}
