import { and, eq, ne } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import { items, supplierItems, suppliers } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { toNumericString } from "@/lib/quantity";
import type { SupplierItemInput } from "@/schemas/master-data";
import { writeAuditLog } from "./audit-service";

/** Both sides of the mapping must belong to the caller's organization. */
async function assertOwnership(
  executor: DbExecutor,
  organizationId: string,
  input: SupplierItemInput,
): Promise<void> {
  const [supplier] = await executor
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.organizationId, organizationId)))
    .limit(1);

  if (!supplier) throw new AppError("NOT_FOUND", "ไม่พบผู้ขาย");

  const [item] = await executor
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, input.itemId), eq(items.organizationId, organizationId)))
    .limit(1);

  if (!item) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");
}

const DUPLICATE_MAPPING = () =>
  new AppError("CONFLICT", "ผู้ขายรายนี้มีวัตถุดิบนี้อยู่แล้ว", {
    fieldErrors: { itemId: ["ผู้ขายรายนี้มีวัตถุดิบนี้อยู่แล้ว"] },
  });

function toRow(input: SupplierItemInput) {
  return {
    supplierId: input.supplierId,
    itemId: input.itemId,
    supplierItemCode: input.supplierItemCode ?? null,
    supplierItemName: input.supplierItemName ?? null,
    purchaseUnitId: input.purchaseUnitId,
    purchaseConversion:
      input.purchaseConversion === undefined ? null : toNumericString(input.purchaseConversion),
    moq: toNumericString(input.moq),
    packSize: input.packSize === undefined ? null : toNumericString(input.packSize),
    leadTimeDays: input.leadTimeDays ?? null,
    lastPrice: input.lastPrice === undefined ? null : toNumericString(input.lastPrice),
    isPreferred: input.isPreferred,
    isActive: input.isActive,
  };
}

/**
 * Only one mapping per item may be the preferred source, otherwise the purchase planner
 * would have no deterministic supplier to fall back on.
 */
async function clearOtherPreferred(
  executor: DbExecutor,
  itemId: string,
  keepId: string,
): Promise<void> {
  await executor
    .update(supplierItems)
    .set({ isPreferred: false, updatedAt: new Date() })
    .where(and(eq(supplierItems.itemId, itemId), ne(supplierItems.id, keepId)));
}

export async function createSupplierItem(input: SupplierItemInput) {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      await assertOwnership(tx, user.organizationId, input);

      const row = toRow(input);
      const [created] = await tx
        .insert(supplierItems)
        .values({ ...row, lastPriceAt: row.lastPrice === null ? null : new Date() })
        .returning();

      if (input.isPreferred) await clearOtherPreferred(tx, input.itemId, created!.id);

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entityType: "supplier_item",
        entityId: created!.id,
        afterData: created,
      });

      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw DUPLICATE_MAPPING();
    throw error;
  }
}

export async function updateSupplierItem(id: string, input: SupplierItemInput) {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      await assertOwnership(tx, user.organizationId, input);

      const [before] = await tx
        .select()
        .from(supplierItems)
        .where(eq(supplierItems.id, id))
        .limit(1);

      if (!before) throw new AppError("NOT_FOUND", "ไม่พบรายการวัตถุดิบของผู้ขาย");

      const row = toRow(input);
      // The timestamp only moves when the price itself moves, so price-change reporting
      // in Phase 5 can trust it.
      const priceChanged = row.lastPrice !== before.lastPrice;

      const [updated] = await tx
        .update(supplierItems)
        .set({
          ...row,
          lastPriceAt: priceChanged
            ? row.lastPrice === null
              ? null
              : new Date()
            : before.lastPriceAt,
          updatedAt: new Date(),
        })
        .where(eq(supplierItems.id, id))
        .returning();

      if (input.isPreferred) await clearOtherPreferred(tx, input.itemId, id);

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "UPDATE",
        entityType: "supplier_item",
        entityId: id,
        beforeData: before,
        afterData: updated,
      });

      return updated!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw DUPLICATE_MAPPING();
    throw error;
  }
}

export async function setSupplierItemActive(id: string, isActive: boolean) {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(supplierItems).where(eq(supplierItems.id, id)).limit(1);
    if (!before) throw new AppError("NOT_FOUND", "ไม่พบรายการวัตถุดิบของผู้ขาย");

    // Re-check ownership through the supplier before mutating.
    await assertOwnership(tx, user.organizationId, {
      supplierId: before.supplierId,
      itemId: before.itemId,
    } as SupplierItemInput);

    const [updated] = await tx
      .update(supplierItems)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(supplierItems.id, id))
      .returning();

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entityType: "supplier_item",
      entityId: id,
      beforeData: before,
      afterData: updated,
      note: isActive ? "เปิดใช้งานวัตถุดิบของผู้ขาย" : "ปิดใช้งานวัตถุดิบของผู้ขาย",
    });

    return updated!;
  });
}
