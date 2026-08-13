"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/database/client";
import { menus } from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError, actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { idOf, parseFormData, toValidationError } from "@/lib/form-data";
import { PERMISSIONS } from "@/lib/permissions";
import { menuInputSchema, publishBomSchema, saveBomSchema } from "@/schemas/bom";
import { writeAuditLog } from "@/services/audit-service";
import { openDraftVersion, publishBomVersion, saveBomDraft } from "@/services/bom-service";

/* --------------------------------------------------------------------- menus */

export async function saveMenuAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = parseFormData(menuInputSchema, formData, { checkboxes: ["isActive"] });
    const user = await requirePermission(PERMISSIONS.MENU_MANAGE);
    const id = idOf(formData);

    const saved = await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx
          .select()
          .from(menus)
          .where(and(eq(menus.id, id), eq(menus.organizationId, user.organizationId)))
          .limit(1);
        if (!before) throw new AppError("NOT_FOUND", "ไม่พบเมนู");

        const [updated] = await tx
          .update(menus)
          .set({
            code: input.code.toUpperCase(),
            nameTh: input.nameTh,
            nameEn: input.nameEn ?? null,
            categoryId: input.categoryId,
            isActive: input.isActive,
            note: input.note ?? null,
            updatedAt: new Date(),
          })
          .where(eq(menus.id, id))
          .returning();

        await writeAuditLog(tx, {
          organizationId: user.organizationId,
          userId: user.id,
          action: "UPDATE",
          entityType: "menu",
          entityId: id,
          beforeData: before,
          afterData: updated,
        });

        return updated!;
      }

      const [created] = await tx
        .insert(menus)
        .values({
          organizationId: user.organizationId,
          code: input.code.toUpperCase(),
          nameTh: input.nameTh,
          nameEn: input.nameEn ?? null,
          categoryId: input.categoryId,
          isActive: input.isActive,
          note: input.note ?? null,
        })
        .returning();

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entityType: "menu",
        entityId: created!.id,
        afterData: created,
      });

      return created!;
    });

    revalidatePath("/menu/master");
    return actionSuccess({ id: saved.id });
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}

/* ----------------------------------------------------------------------- bom */

export async function openDraftVersionAction(
  menuId: string,
): Promise<ActionResult<{ recipeVersionId: string }>> {
  try {
    const version = await openDraftVersion(menuId);
    revalidatePath(`/menu/recipes/${menuId}`);
    return actionSuccess({ recipeVersionId: version.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveBomAction(
  raw: unknown,
): Promise<ActionResult<{ recipeVersionId: string }>> {
  try {
    const input = saveBomSchema.parse(raw);
    const result = await saveBomDraft(input);
    revalidatePath("/menu/recipes");
    return actionSuccess({ recipeVersionId: result.recipeVersionId });
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}

export async function publishBomAction(raw: unknown): Promise<ActionResult<{ versionNo: number }>> {
  try {
    const input = publishBomSchema.parse(raw);
    const published = await publishBomVersion(input.recipeVersionId, input.effectiveFrom);
    revalidatePath("/menu/recipes");
    return actionSuccess({ versionNo: published.versionNo });
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}
