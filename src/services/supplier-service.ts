import { and, eq } from "drizzle-orm";
import { db } from "@/database/client";
import { suppliers } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import type { SupplierInput } from "@/schemas/master-data";
import { writeAuditLog } from "./audit-service";

function toRow(input: SupplierInput) {
  return {
    code: input.code.toUpperCase(),
    nameTh: input.nameTh,
    nameEn: input.nameEn ?? null,
    contactName: input.contactName ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    leadTimeDays: input.leadTimeDays,
    paymentTerm: input.paymentTerm ?? null,
    remark: input.remark ?? null,
    isActive: input.isActive,
  };
}

const DUPLICATE_CODE = () =>
  new AppError("CONFLICT", "รหัสผู้ขายนี้ถูกใช้งานแล้ว", {
    fieldErrors: { code: ["รหัสผู้ขายนี้ถูกใช้งานแล้ว"] },
  });

export async function createSupplier(input: SupplierInput) {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(suppliers)
        .values({ organizationId: user.organizationId, ...toRow(input) })
        .returning();

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entityType: "supplier",
        entityId: created!.id,
        afterData: created,
      });

      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw DUPLICATE_CODE();
    throw error;
  }
}

export async function updateSupplier(id: string, input: SupplierInput) {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, user.organizationId)))
        .limit(1);

      if (!before) throw new AppError("NOT_FOUND", "ไม่พบผู้ขายที่ต้องการแก้ไข");

      const [updated] = await tx
        .update(suppliers)
        .set({ ...toRow(input), updatedAt: new Date() })
        .where(eq(suppliers.id, id))
        .returning();

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "UPDATE",
        entityType: "supplier",
        entityId: id,
        beforeData: before,
        afterData: updated,
      });

      return updated!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw DUPLICATE_CODE();
    throw error;
  }
}

export async function setSupplierActive(id: string, isActive: boolean) {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.organizationId, user.organizationId)))
      .limit(1);

    if (!before) throw new AppError("NOT_FOUND", "ไม่พบผู้ขายที่ต้องการแก้ไข");

    const [updated] = await tx
      .update(suppliers)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(suppliers.id, id))
      .returning();

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entityType: "supplier",
      entityId: id,
      beforeData: before,
      afterData: updated,
      note: isActive ? "เปิดใช้งานผู้ขาย" : "ปิดใช้งานผู้ขาย",
    });

    return updated!;
  });
}
