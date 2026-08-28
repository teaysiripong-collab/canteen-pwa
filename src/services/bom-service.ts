import { and, asc, desc, eq, max } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  items,
  mealPeriods,
  menus,
  recipeItemPeriodQuantities,
  recipeItems,
  recipeVersions,
  recipes,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import {
  PERIOD_QUANTITY_ERROR_MESSAGES_TH,
  parsePeriodQuantities,
} from "@/lib/bom/period-quantity";
import { todayIso } from "@/lib/date";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { toNumericString } from "@/lib/quantity";
import type { SaveBomInput } from "@/schemas/bom";
import { writeAuditLog } from "./audit-service";

/** Meal periods in display order — the order the "30+20" values map onto. */
export async function listMealPeriods(organizationId: string, executor: DbExecutor = db) {
  return executor
    .select({
      id: mealPeriods.id,
      code: mealPeriods.code,
      nameTh: mealPeriods.nameTh,
      sortOrder: mealPeriods.sortOrder,
    })
    .from(mealPeriods)
    .where(
      and(eq(mealPeriods.organizationId, organizationId), eq(mealPeriods.isActive, true)),
    )
    .orderBy(asc(mealPeriods.sortOrder), asc(mealPeriods.code));
}

async function assertMenu(executor: DbExecutor, organizationId: string, menuId: string) {
  const [menu] = await executor
    .select({ id: menus.id, nameTh: menus.nameTh })
    .from(menus)
    .where(and(eq(menus.id, menuId), eq(menus.organizationId, organizationId)))
    .limit(1);
  if (!menu) throw new AppError("NOT_FOUND", "ไม่พบเมนู");
  return menu;
}

/** One recipe per menu; created lazily the first time someone opens the BOM editor. */
async function getOrCreateRecipe(executor: DbExecutor, menuId: string, nameTh: string) {
  const [existing] = await executor
    .select()
    .from(recipes)
    .where(eq(recipes.menuId, menuId))
    .limit(1);
  if (existing) return existing;

  const [created] = await executor.insert(recipes).values({ menuId, nameTh }).returning();
  return created!;
}

async function copyLines(executor: DbExecutor, fromVersionId: string, toVersionId: string) {
  const sourceLines = await executor
    .select()
    .from(recipeItems)
    .where(eq(recipeItems.recipeVersionId, fromVersionId))
    .orderBy(asc(recipeItems.sortOrder));

  for (const line of sourceLines) {
    const [copied] = await executor
      .insert(recipeItems)
      .values({
        recipeVersionId: toVersionId,
        itemId: line.itemId,
        quantity: line.quantity,
        unitId: line.unitId,
        wasteFactor: line.wasteFactor,
        sortOrder: line.sortOrder,
        note: line.note,
      })
      .returning();

    const periods = await executor
      .select()
      .from(recipeItemPeriodQuantities)
      .where(eq(recipeItemPeriodQuantities.recipeItemId, line.id));

    if (periods.length > 0) {
      await executor.insert(recipeItemPeriodQuantities).values(
        periods.map((period) => ({
          recipeItemId: copied!.id,
          mealPeriodId: period.mealPeriodId,
          quantity: period.quantity,
        })),
      );
    }
  }
}

/**
 * Opens an editable version of a menu's BOM.
 *
 * If a draft already exists it is reused. Otherwise a new version is created — copied
 * from the current published one when there is one, so editing a published recipe means
 * *starting the next version*, never changing history. Past versions stay exactly as they
 * were cooked, which is what keeps historical cost reproducible.
 */
export async function openDraftVersion(menuId: string) {
  const user = await requirePermission(PERMISSIONS.RECIPE_MANAGE);

  return db.transaction(async (tx) => {
    const menu = await assertMenu(tx, user.organizationId, menuId);
    const recipe = await getOrCreateRecipe(tx, menuId, menu.nameTh);

    const [draft] = await tx
      .select()
      .from(recipeVersions)
      .where(
        and(eq(recipeVersions.recipeId, recipe.id), eq(recipeVersions.isPublished, false)),
      )
      .orderBy(desc(recipeVersions.versionNo))
      .limit(1);

    if (draft) return draft;

    const [latest] = await tx
      .select()
      .from(recipeVersions)
      .where(eq(recipeVersions.recipeId, recipe.id))
      .orderBy(desc(recipeVersions.versionNo))
      .limit(1);

    const [created] = await tx
      .insert(recipeVersions)
      .values({
        recipeId: recipe.id,
        versionNo: (latest?.versionNo ?? 0) + 1,
        yieldQty: latest?.yieldQty ?? "1",
        yieldUnitId: latest?.yieldUnitId ?? null,
        effectiveFrom: todayIso(),
        isPublished: false,
        createdBy: user.id,
      })
      .returning();

    if (latest) await copyLines(tx, latest.id, created!.id);

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "CREATE",
      entityType: "recipe_version",
      entityId: created!.id,
      afterData: { menuId, versionNo: created!.versionNo, copiedFrom: latest?.versionNo ?? null },
    });

    return created!;
  });
}

async function loadEditableVersion(
  executor: DbExecutor,
  organizationId: string,
  recipeVersionId: string,
) {
  const [row] = await executor
    .select({
      version: recipeVersions,
      menuId: menus.id,
    })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(menus, eq(menus.id, recipes.menuId))
    .where(
      and(eq(recipeVersions.id, recipeVersionId), eq(menus.organizationId, organizationId)),
    )
    .limit(1);

  if (!row) throw new AppError("NOT_FOUND", "ไม่พบสูตรอาหาร");

  // The whole point of versioning: a published version is a historical record.
  if (row.version.isPublished) {
    throw new AppError(
      "VALIDATION",
      "สูตรเวอร์ชันนี้เผยแพร่แล้ว แก้ไขไม่ได้ กรุณาสร้างเวอร์ชันใหม่",
    );
  }

  return row;
}

/**
 * Replaces the lines of a draft version. Each line's "30+20" shorthand is parsed here,
 * against the organization's meal periods, and the per-period rows plus the total are
 * written together so they can never disagree.
 */
export async function saveBomDraft(input: SaveBomInput) {
  const user = await requirePermission(PERMISSIONS.RECIPE_MANAGE);

  return db.transaction(async (tx) => {
    const { version, menuId } = await loadEditableVersion(
      tx,
      user.organizationId,
      input.recipeVersionId,
    );

    const periods = await listMealPeriods(user.organizationId, tx);
    if (periods.length === 0) {
      throw new AppError("VALIDATION", "ยังไม่ได้ตั้งค่ามื้ออาหาร กรุณาตั้งค่าก่อน");
    }

    const seen = new Set<string>();
    const parsedLines = input.lines.map((line, index) => {
      if (seen.has(line.itemId)) {
        throw new AppError("VALIDATION", "มีวัตถุดิบซ้ำกันในสูตร", {
          fieldErrors: { [`lines.${index}.itemId`]: ["วัตถุดิบนี้ถูกเพิ่มไว้แล้ว"] },
        });
      }
      seen.add(line.itemId);

      const parsed = parsePeriodQuantities(line.quantityInput, periods.length);
      if (!parsed.ok) {
        throw new AppError("VALIDATION", PERIOD_QUANTITY_ERROR_MESSAGES_TH[parsed.error], {
          fieldErrors: {
            [`lines.${index}.quantityInput`]: [PERIOD_QUANTITY_ERROR_MESSAGES_TH[parsed.error]],
          },
        });
      }

      return { line, parsed: parsed.data };
    });

    for (const { line } of parsedLines) {
      const [item] = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, line.itemId), eq(items.organizationId, user.organizationId)))
        .limit(1);
      if (!item) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");
    }

    await tx.delete(recipeItems).where(eq(recipeItems.recipeVersionId, version.id));

    for (const [index, { line, parsed }] of parsedLines.entries()) {
      const [created] = await tx
        .insert(recipeItems)
        .values({
          recipeVersionId: version.id,
          itemId: line.itemId,
          // The stored total is always the sum of the period rows written below.
          quantity: parsed.total,
          unitId: line.unitId,
          wasteFactor: toNumericString(line.wasteFactor),
          sortOrder: index,
          note: line.note ?? null,
        })
        .returning();

      await tx.insert(recipeItemPeriodQuantities).values(
        periods.map((period, periodIndex) => ({
          recipeItemId: created!.id,
          mealPeriodId: period.id,
          quantity: parsed.values[periodIndex] ?? "0",
        })),
      );
    }

    await tx
      .update(recipeVersions)
      .set({
        yieldQty: toNumericString(input.yieldQty),
        yieldUnitId: input.yieldUnitId,
        note: input.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(recipeVersions.id, version.id));

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entityType: "recipe_version",
      entityId: version.id,
      afterData: { menuId, versionNo: version.versionNo, lines: input.lines.length },
    });

    return { recipeVersionId: version.id, lines: parsedLines.length };
  });
}

/** Freezes a draft. From here on it can only be superseded, never edited. */
export async function publishBomVersion(recipeVersionId: string, effectiveFrom?: string) {
  const user = await requirePermission(PERMISSIONS.RECIPE_MANAGE);

  return db.transaction(async (tx) => {
    const { version } = await loadEditableVersion(tx, user.organizationId, recipeVersionId);

    const [lineCount] = await tx
      .select({ value: max(recipeItems.sortOrder) })
      .from(recipeItems)
      .where(eq(recipeItems.recipeVersionId, version.id));

    if (lineCount?.value === null || lineCount?.value === undefined) {
      throw new AppError("VALIDATION", "สูตรยังไม่มีวัตถุดิบ เผยแพร่ไม่ได้");
    }

    const [published] = await tx
      .update(recipeVersions)
      .set({
        isPublished: true,
        effectiveFrom: effectiveFrom ?? todayIso(),
        updatedAt: new Date(),
      })
      .where(eq(recipeVersions.id, version.id))
      .returning();

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "APPROVE",
      entityType: "recipe_version",
      entityId: version.id,
      afterData: { versionNo: version.versionNo, effectiveFrom: published!.effectiveFrom },
      note: `เผยแพร่สูตรเวอร์ชัน ${version.versionNo}`,
    });

    return published!;
  });
}
