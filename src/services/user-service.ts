import { and, eq } from "drizzle-orm";
import { db } from "@/database/client";
import { users } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError, isUniqueViolation } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { getUserById, replaceUserRoles } from "@/repositories/user-repository";
import type { UserInput } from "@/schemas/user";
import { writeAuditLog } from "./audit-service";

const DUPLICATE_EMAIL = () =>
  new AppError("CONFLICT", "อีเมลนี้ถูกใช้งานแล้ว", {
    fieldErrors: { email: ["อีเมลนี้ถูกใช้งานแล้ว"] },
  });

function toRow(input: UserInput) {
  return {
    email: input.email,
    fullName: input.fullName,
    phone: input.phone ?? null,
    defaultLocationId: input.defaultLocationId,
    isActive: input.isActive,
  };
}

export async function createUser(input: UserInput) {
  const actor = await requirePermission(PERMISSIONS.USER_MANAGE);

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ organizationId: actor.organizationId, ...toRow(input) })
        .returning();

      await replaceUserRoles(tx, created!.id, input.roleCodes);

      await writeAuditLog(tx, {
        organizationId: actor.organizationId,
        userId: actor.id,
        action: "CREATE",
        entityType: "user",
        entityId: created!.id,
        afterData: { ...created, roleCodes: input.roleCodes },
      });

      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw DUPLICATE_EMAIL();
    throw error;
  }
}

export async function updateUser(id: string, input: UserInput) {
  const actor = await requirePermission(PERMISSIONS.USER_MANAGE);

  const before = await getUserById(actor.organizationId, id);
  if (!before) throw new AppError("NOT_FOUND", "ไม่พบผู้ใช้งาน");

  const rolesChanged =
    [...before.roleCodes].sort().join(",") !== [...new Set(input.roleCodes)].sort().join(",");

  // An admin must not be able to lock themselves out of user administration.
  if (actor.id === id && before.roleCodes.includes("ADMIN") && !input.roleCodes.includes("ADMIN")) {
    throw new AppError("VALIDATION", "ไม่สามารถถอดบทบาทผู้ดูแลระบบของตนเองได้", {
      fieldErrors: { roleCodes: ["ไม่สามารถถอดบทบาทผู้ดูแลระบบของตนเองได้"] },
    });
  }

  try {
    return await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ ...toRow(input), updatedAt: new Date() })
        .where(and(eq(users.id, id), eq(users.organizationId, actor.organizationId)))
        .returning();

      if (!updated) throw new AppError("NOT_FOUND", "ไม่พบผู้ใช้งาน");

      await replaceUserRoles(tx, id, input.roleCodes);

      await writeAuditLog(tx, {
        organizationId: actor.organizationId,
        userId: actor.id,
        // Role changes are logged as PERMISSION_CHANGE so they stand out in the audit trail.
        action: rolesChanged ? "PERMISSION_CHANGE" : "UPDATE",
        entityType: "user",
        entityId: id,
        beforeData: before,
        afterData: { ...updated, roleCodes: input.roleCodes },
        note: rolesChanged
          ? `บทบาท: ${before.roleCodes.join(", ") || "-"} -> ${input.roleCodes.join(", ")}`
          : null,
      });

      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw DUPLICATE_EMAIL();
    throw error;
  }
}

/** Accounts are deactivated, never deleted, so their audit trail and documents stay intact. */
export async function setUserActive(id: string, isActive: boolean) {
  const actor = await requirePermission(PERMISSIONS.USER_MANAGE);

  if (actor.id === id && !isActive) {
    throw new AppError("VALIDATION", "ไม่สามารถปิดใช้งานบัญชีของตนเองได้");
  }

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, actor.organizationId)))
      .limit(1);

    if (!before) throw new AppError("NOT_FOUND", "ไม่พบผู้ใช้งาน");

    const [updated] = await tx
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    await writeAuditLog(tx, {
      organizationId: actor.organizationId,
      userId: actor.id,
      action: "UPDATE",
      entityType: "user",
      entityId: id,
      beforeData: before,
      afterData: updated,
      note: isActive ? "เปิดใช้งานบัญชี" : "ปิดใช้งานบัญชี",
    });

    return updated!;
  });
}
