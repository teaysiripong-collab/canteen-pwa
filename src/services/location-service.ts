import { and, eq } from "drizzle-orm";
import { db } from "@/database/client";
import { locations } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import type { LocationInput } from "@/schemas/master-data";
import { writeAuditLog } from "./audit-service";

export async function createLocation(input: LocationInput) {
  const user = await requirePermission(PERMISSIONS.LOCATION_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(locations)
        .values({
          organizationId: user.organizationId,
          code: input.code.toUpperCase(),
          nameTh: input.nameTh,
          nameEn: input.nameEn ?? null,
          kind: input.kind,
          holdsStock: input.holdsStock,
          isActive: input.isActive,
          note: input.note ?? null,
        })
        .returning();

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entityType: "location",
        entityId: created!.id,
        afterData: created,
      });

      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "รหัสสถานที่นี้ถูกใช้งานแล้ว", {
        fieldErrors: { code: ["รหัสสถานที่นี้ถูกใช้งานแล้ว"] },
      });
    }
    throw error;
  }
}

export async function updateLocation(id: string, input: LocationInput) {
  const user = await requirePermission(PERMISSIONS.LOCATION_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(locations)
        .where(and(eq(locations.id, id), eq(locations.organizationId, user.organizationId)))
        .limit(1);

      if (!before) throw new AppError("NOT_FOUND", "ไม่พบสถานที่ที่ต้องการแก้ไข");

      const [updated] = await tx
        .update(locations)
        .set({
          code: input.code.toUpperCase(),
          nameTh: input.nameTh,
          nameEn: input.nameEn ?? null,
          kind: input.kind,
          holdsStock: input.holdsStock,
          isActive: input.isActive,
          note: input.note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(locations.id, id))
        .returning();

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "UPDATE",
        entityType: "location",
        entityId: id,
        beforeData: before,
        afterData: updated,
      });

      return updated!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "รหัสสถานที่นี้ถูกใช้งานแล้ว", {
        fieldErrors: { code: ["รหัสสถานที่นี้ถูกใช้งานแล้ว"] },
      });
    }
    throw error;
  }
}

/** Master data is never hard-deleted; it is deactivated so history keeps resolving. */
export async function setLocationActive(id: string, isActive: boolean) {
  const user = await requirePermission(PERMISSIONS.LOCATION_MANAGE);

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.id, id), eq(locations.organizationId, user.organizationId)))
      .limit(1);

    if (!before) throw new AppError("NOT_FOUND", "ไม่พบสถานที่ที่ต้องการแก้ไข");

    const [updated] = await tx
      .update(locations)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(locations.id, id))
      .returning();

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entityType: "location",
      entityId: id,
      beforeData: before,
      afterData: updated,
      note: isActive ? "เปิดใช้งานสถานที่" : "ปิดใช้งานสถานที่",
    });

    return updated!;
  });
}
