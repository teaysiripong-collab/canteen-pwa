import { and, eq } from "drizzle-orm";
import { db } from "@/database/client";
import { items } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { toNumericString } from "@/lib/quantity";
import { replaceItemAliases } from "@/repositories/master-data-repository";
import type { ItemInput } from "@/schemas/master-data";
import { writeAuditLog } from "./audit-service";

function toRow(input: ItemInput) {
  return {
    code: input.code.toUpperCase(),
    nameTh: input.nameTh,
    nameEn: input.nameEn ?? null,
    categoryId: input.categoryId,
    baseUnitId: input.baseUnitId,
    purchaseUnitId: input.purchaseUnitId,
    purchaseConversion: toNumericString(input.purchaseConversion),
    preferredSupplierId: input.preferredSupplierId,
    defaultLocationId: input.defaultLocationId,
    minimumStock: toNumericString(input.minimumStock),
    reorderPoint: toNumericString(input.reorderPoint),
    safetyStock: toNumericString(input.safetyStock),
    shelfLifeDays: typeof input.shelfLifeDays === "number" ? input.shelfLifeDays : null,
    barcode: input.barcode ?? null,
    isActive: input.isActive,
    note: input.note ?? null,
  };
}

const DUPLICATE_CODE = () =>
  new AppError("CONFLICT", "รหัสวัตถุดิบนี้ถูกใช้งานแล้ว", {
    fieldErrors: { code: ["รหัสวัตถุดิบนี้ถูกใช้งานแล้ว"] },
  });

export async function createItem(input: ItemInput) {
  const user = await requirePermission(PERMISSIONS.ITEM_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(items)
        .values({ organizationId: user.organizationId, ...toRow(input) })
        .returning();

      await replaceItemAliases(tx, created!.id, input.aliases);

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entityType: "item",
        entityId: created!.id,
        afterData: { ...created, aliases: input.aliases },
      });

      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw DUPLICATE_CODE();
    throw error;
  }
}

export async function updateItem(id: string, input: ItemInput) {
  const user = await requirePermission(PERMISSIONS.ITEM_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, id), eq(items.organizationId, user.organizationId)))
        .limit(1);

      if (!before) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");

      const [updated] = await tx
        .update(items)
        .set({ ...toRow(input), updatedAt: new Date() })
        .where(eq(items.id, id))
        .returning();

      await replaceItemAliases(tx, id, input.aliases);

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "UPDATE",
        entityType: "item",
        entityId: id,
        beforeData: before,
        afterData: { ...updated, aliases: input.aliases },
      });

      return updated!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw DUPLICATE_CODE();
    throw error;
  }
}

export async function setItemActive(id: string, isActive: boolean) {
  const user = await requirePermission(PERMISSIONS.ITEM_MANAGE);

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.organizationId, user.organizationId)))
      .limit(1);

    if (!before) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");

    const [updated] = await tx
      .update(items)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(items.id, id))
      .returning();

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entityType: "item",
      entityId: id,
      beforeData: before,
      afterData: updated,
      note: isActive ? "เปิดใช้งานวัตถุดิบ" : "ปิดใช้งานวัตถุดิบ",
    });

    return updated!;
  });
}
