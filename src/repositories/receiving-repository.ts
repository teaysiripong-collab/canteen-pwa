import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/database/client";
import {
  goodsReceiptItems,
  goodsReceipts,
  items,
  locations,
  supplierItems,
  suppliers,
  units,
  users,
} from "@/database/schema";

/**
 * Everything the receiving form needs to fill itself in: which unit an item is bought in,
 * how many base units that holds, its shelf life, and the supplier's own terms where they
 * differ. Loading it up front is what lets the phone form work with almost no typing.
 */
export async function getReceivingFormData(organizationId: string) {
  const [supplierRows, locationRows, unitRows, itemRows, mappingRows] = await Promise.all([
    db
      .select({ id: suppliers.id, code: suppliers.code, nameTh: suppliers.nameTh })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.isActive, true)))
      .orderBy(asc(suppliers.code)),
    db
      .select({ id: locations.id, code: locations.code, nameTh: locations.nameTh })
      .from(locations)
      .where(
        and(
          eq(locations.organizationId, organizationId),
          eq(locations.isActive, true),
          eq(locations.holdsStock, true),
        ),
      )
      .orderBy(asc(locations.code)),
    db
      .select({ id: units.id, code: units.code, nameTh: units.nameTh })
      .from(units)
      .where(eq(units.isActive, true))
      .orderBy(asc(units.code)),
    db
      .select({
        id: items.id,
        code: items.code,
        nameTh: items.nameTh,
        baseUnitId: items.baseUnitId,
        purchaseUnitId: items.purchaseUnitId,
        purchaseConversion: items.purchaseConversion,
        shelfLifeDays: items.shelfLifeDays,
        preferredSupplierId: items.preferredSupplierId,
      })
      .from(items)
      .where(and(eq(items.organizationId, organizationId), eq(items.isActive, true)))
      .orderBy(asc(items.code)),
    db
      .select({
        supplierId: supplierItems.supplierId,
        itemId: supplierItems.itemId,
        purchaseUnitId: supplierItems.purchaseUnitId,
        purchaseConversion: supplierItems.purchaseConversion,
        lastPrice: supplierItems.lastPrice,
      })
      .from(supplierItems)
      .innerJoin(items, eq(items.id, supplierItems.itemId))
      .where(and(eq(items.organizationId, organizationId), eq(supplierItems.isActive, true))),
  ]);

  return {
    suppliers: supplierRows,
    locations: locationRows,
    units: unitRows,
    items: itemRows,
    supplierItems: mappingRows,
  };
}

export type ReceivingFormData = Awaited<ReturnType<typeof getReceivingFormData>>;

export async function listGoodsReceipts(
  organizationId: string,
  query: { locationId?: string; page?: number; pageSize?: number } = {},
) {
  const filters = [eq(goodsReceipts.organizationId, organizationId)];
  if (query.locationId) filters.push(eq(goodsReceipts.locationId, query.locationId));

  const where = and(...filters);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: goodsReceipts.id,
        receiptNumber: goodsReceipts.receiptNumber,
        status: goodsReceipts.status,
        receivedAt: goodsReceipts.receivedAt,
        supplierDocNumber: goodsReceipts.supplierDocNumber,
        supplierName: suppliers.nameTh,
        locationCode: locations.code,
        receiverName: users.fullName,
        lineCount: count(goodsReceiptItems.id),
      })
      .from(goodsReceipts)
      .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
      .innerJoin(locations, eq(locations.id, goodsReceipts.locationId))
      .leftJoin(users, eq(users.id, goodsReceipts.createdBy))
      .leftJoin(goodsReceiptItems, eq(goodsReceiptItems.goodsReceiptId, goodsReceipts.id))
      .where(where)
      .groupBy(
        goodsReceipts.id,
        goodsReceipts.receiptNumber,
        goodsReceipts.status,
        goodsReceipts.receivedAt,
        goodsReceipts.supplierDocNumber,
        suppliers.nameTh,
        locations.code,
        users.fullName,
      )
      .orderBy(desc(goodsReceipts.receivedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(goodsReceipts).where(where),
  ]);

  return { rows, total: total?.value ?? 0 };
}

export async function getGoodsReceiptById(organizationId: string, id: string) {
  const [receipt] = await db
    .select({
      id: goodsReceipts.id,
      receiptNumber: goodsReceipts.receiptNumber,
      status: goodsReceipts.status,
      receivedAt: goodsReceipts.receivedAt,
      supplierDocNumber: goodsReceipts.supplierDocNumber,
      note: goodsReceipts.note,
      supplierName: suppliers.nameTh,
      supplierCode: suppliers.code,
      locationCode: locations.code,
      locationNameTh: locations.nameTh,
      receiverName: users.fullName,
    })
    .from(goodsReceipts)
    .innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
    .innerJoin(locations, eq(locations.id, goodsReceipts.locationId))
    .leftJoin(users, eq(users.id, goodsReceipts.createdBy))
    .where(and(eq(goodsReceipts.id, id), eq(goodsReceipts.organizationId, organizationId)))
    .limit(1);

  if (!receipt) return null;

  const lines = await db
    .select({
      id: goodsReceiptItems.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      receivedQty: goodsReceiptItems.receivedQty,
      receiptUnitCode: units.code,
      conversionToBase: goodsReceiptItems.conversionToBase,
      receivedBaseQty: goodsReceiptItems.receivedBaseQty,
      rejectedBaseQty: goodsReceiptItems.rejectedBaseQty,
      lineStatus: goodsReceiptItems.lineStatus,
      unitCost: goodsReceiptItems.unitCost,
      lotNumber: goodsReceiptItems.lotNumber,
      expiryDate: goodsReceiptItems.expiryDate,
      note: goodsReceiptItems.note,
    })
    .from(goodsReceiptItems)
    .innerJoin(items, eq(items.id, goodsReceiptItems.itemId))
    .leftJoin(units, eq(units.id, goodsReceiptItems.receiptUnitId))
    .where(eq(goodsReceiptItems.goodsReceiptId, id))
    .orderBy(asc(items.code));

  return { receipt, lines };
}
