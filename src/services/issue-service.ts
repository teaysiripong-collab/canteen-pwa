import { and, asc, desc, eq } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  inventoryPostings,
  items,
  mealPeriods,
  menus,
  recipeItemPeriodQuantities,
  recipeItems,
  recipeVersions,
  recipes,
  stockIssueItems,
  stockIssues,
  units,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { addQty, compareQty, divQty, mulQty, toNumericString } from "@/lib/quantity";
import type { IssueInput } from "@/schemas/issue";
import { writeAuditLog } from "./audit-service";
import { nextDocumentNumber, retryOnDuplicateNumber } from "./document-number-service";
import {
  listUsableLots,
  planFefoAllocation,
  planManualAllocation,
  type AllocationPlan,
} from "./inventory-allocation-service";
import { postMovementAs, type MovementLine } from "./inventory-ledger-service";

export type IssueStandardLine = {
  itemId: string;
  itemCode: string;
  itemNameTh: string;
  unitCode: string | null;
  /** What the BOM asks for this shift, already scaled by servings. */
  standardBaseQty: string;
  /** On hand and issuable at the location right now. */
  availableBaseQty: string;
  expiredBaseQty: string;
};

/**
 * The pick list for a menu: every BOM line for the chosen shift, scaled by how many times
 * the recipe is being made, with what is actually on the shelf next to it.
 *
 * This is the screen's starting point — staff adjust the numbers rather than typing them.
 */
export async function getIssueStandard(input: {
  organizationId: string;
  menuId: string;
  mealPeriodId: string;
  locationId: string;
  servings?: number;
}): Promise<{ recipeVersionId: string; versionNo: number; lines: IssueStandardLine[] }> {
  await requirePermission(PERMISSIONS.ISSUE_CREATE);

  const [version] = await db
    .select({ id: recipeVersions.id, versionNo: recipeVersions.versionNo, yieldQty: recipeVersions.yieldQty })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(menus, eq(menus.id, recipes.menuId))
    .where(
      and(
        eq(menus.id, input.menuId),
        eq(menus.organizationId, input.organizationId),
        eq(recipeVersions.isPublished, true),
      ),
    )
    .orderBy(desc(recipeVersions.effectiveFrom), desc(recipeVersions.versionNo))
    .limit(1);

  if (!version) throw new AppError("NOT_FOUND", "เมนูนี้ยังไม่มีสูตรที่เผยแพร่");

  const bomRows = await db
    .select({
      recipeItemId: recipeItems.id,
      itemId: items.id,
      itemCode: items.code,
      itemNameTh: items.nameTh,
      unitCode: units.code,
      periodQty: recipeItemPeriodQuantities.quantity,
    })
    .from(recipeItems)
    .innerJoin(items, eq(items.id, recipeItems.itemId))
    .leftJoin(units, eq(units.id, recipeItems.unitId))
    .innerJoin(
      recipeItemPeriodQuantities,
      and(
        eq(recipeItemPeriodQuantities.recipeItemId, recipeItems.id),
        eq(recipeItemPeriodQuantities.mealPeriodId, input.mealPeriodId),
      ),
    )
    .where(eq(recipeItems.recipeVersionId, version.id))
    .orderBy(asc(items.code));

  const scale =
    input.servings === undefined || Number(version.yieldQty) <= 0
      ? "1"
      : divQty(input.servings, version.yieldQty);

  const lines: IssueStandardLine[] = [];

  for (const row of bomRows) {
    const standard = mulQty(row.periodQty, scale);
    // Skip ingredients this shift does not use at all.
    if (compareQty(standard, "0") <= 0) continue;

    const lots = await listUsableLots(input.organizationId, row.itemId, input.locationId);
    const totals = lots.reduce(
      (acc, lot) => ({
        usable: lot.isExpired ? acc.usable : addQty(acc.usable, lot.availableBaseQty),
        expired: lot.isExpired ? addQty(acc.expired, lot.availableBaseQty) : acc.expired,
      }),
      { usable: "0", expired: "0" },
    );

    lines.push({
      itemId: row.itemId,
      itemCode: row.itemCode,
      itemNameTh: row.itemNameTh,
      unitCode: row.unitCode,
      standardBaseQty: standard,
      availableBaseQty: toNumericString(totals.usable),
      expiredBaseQty: toNumericString(totals.expired),
    });
  }

  return { recipeVersionId: version.id, versionNo: version.versionNo, lines };
}

export type IssueResult = {
  issueId: string;
  issueNumber: string;
  postingId: string;
  replayed: boolean;
};

/** Weighted cost per base unit of the lots a line actually consumed. */
function weightedUnitCost(plan: AllocationPlan): string {
  let value = "0";
  let quantity = "0";
  for (const line of plan.lines) {
    value = addQty(value, mulQty(line.baseQty, line.unitCost));
    quantity = addQty(quantity, line.baseQty);
  }
  return compareQty(quantity, "0") > 0 ? divQty(value, quantity) : "0.0000";
}

/**
 * Posts an issue.
 *
 * The document keeps the standard quantity from the BOM next to what was actually taken,
 * so variance is a fact about the day rather than something reconstructed later from a
 * recipe that may since have changed. Variance itself is derived on read — storing it too
 * would just be a number that can drift away from its own inputs.
 *
 * Lot selection is FEFO unless the user has `fefo.override` and picked lots by hand; an
 * override that actually departs from the FEFO order is recorded on the line and in the
 * audit trail.
 */
export async function createStockIssue(input: IssueInput): Promise<IssueResult> {
  const user = await requirePermission(PERMISSIONS.ISSUE_CREATE);

  const existing = await findIssueByIdempotencyKey(user.organizationId, input.idempotencyKey);
  if (existing) return existing;

  // Adjusting away from the BOM standard is its own permission.
  const canAdjust = hasPermission(user.permissions, PERMISSIONS.ISSUE_ADJUST_QTY);
  for (const line of input.lines) {
    if (
      line.standardBaseQty !== undefined &&
      compareQty(line.actualBaseQty, line.standardBaseQty) !== 0 &&
      !canAdjust
    ) {
      throw new AppError("FORBIDDEN", "คุณไม่มีสิทธิ์แก้จำนวนที่เบิกให้ต่างจากสูตร");
    }
    if (line.lotPicks.length > 0 && !hasPermission(user.permissions, PERMISSIONS.FEFO_OVERRIDE)) {
      throw new AppError("FORBIDDEN", "คุณไม่มีสิทธิ์เลือกลอตเอง");
    }
  }

  return retryOnDuplicateNumber(() =>
    db.transaction(async (tx) => {
      const context = await resolveIssueContext(tx, user.organizationId, input);

      const issueNumber = await nextDocumentNumber(tx, user.organizationId, "stockIssue");
      const issuedAt = new Date();

      const [issue] = await tx
        .insert(stockIssues)
        .values({
          organizationId: user.organizationId,
          issueNumber,
          locationId: input.locationId,
          menuId: input.menuId ?? null,
          recipeVersionId: context.recipeVersionId,
          mealPeriodId: input.mealPeriodId ?? null,
          servings: input.servings === undefined ? null : toNumericString(input.servings),
          status: "CONFIRMED",
          issuedAt,
          note: input.note ?? null,
          createdBy: user.id,
          confirmedBy: user.id,
          confirmedAt: issuedAt,
        })
        .returning();

      const movementLines: MovementLine[] = [];
      const overrides: string[] = [];

      for (const line of input.lines) {
        const [item] = await tx
          .select({ id: items.id, nameTh: items.nameTh })
          .from(items)
          .where(and(eq(items.id, line.itemId), eq(items.organizationId, user.organizationId)))
          .limit(1);
        if (!item) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");

        const plan =
          line.lotPicks.length > 0
            ? await planManualAllocation({
                organizationId: user.organizationId,
                itemId: line.itemId,
                locationId: input.locationId,
                picks: line.lotPicks,
              })
            : await planFefoAllocation({
                organizationId: user.organizationId,
                itemId: line.itemId,
                locationId: input.locationId,
                baseQty: line.actualBaseQty,
                executor: tx,
              });

        if (compareQty(plan.shortfallBaseQty, "0") > 0) {
          throw new AppError(
            "INSUFFICIENT_STOCK",
            `จำนวนที่ต้องการเบิกมากกว่าสต๊อกคงเหลือ: ${item.nameTh} ต้องการ ${toNumericString(line.actualBaseQty)} แต่เบิกได้ ${plan.usableBaseQty}`,
          );
        }

        if (plan.overridesFefo) overrides.push(item.nameTh);

        await tx.insert(stockIssueItems).values({
          stockIssueId: issue!.id,
          itemId: line.itemId,
          requestedBaseQty:
            line.standardBaseQty === undefined ? null : toNumericString(line.standardBaseQty),
          issuedBaseQty: toNumericString(line.actualBaseQty),
          unitCost: weightedUnitCost(plan),
          fefoOverridden: plan.overridesFefo,
          note: line.note ?? null,
        });

        for (const allocation of plan.lines) {
          movementLines.push({
            type: "ISSUE",
            itemId: line.itemId,
            lotId: allocation.lotId,
            locationId: input.locationId,
            baseQty: allocation.baseQty,
            unitCost: allocation.unitCost,
          });
        }
      }

      const posted = await postMovementAs(
        user,
        {
          idempotencyKey: input.idempotencyKey,
          referenceType: "STOCK_ISSUE",
          referenceId: issue!.id,
          referenceNumber: issueNumber,
          transactionAt: issuedAt,
          note: input.note ?? null,
          lines: movementLines,
        },
        tx,
      );

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CONFIRM",
        entityType: "stock_issue",
        entityId: issue!.id,
        afterData: {
          issueNumber,
          menuId: input.menuId ?? null,
          mealPeriodId: input.mealPeriodId ?? null,
          lines: input.lines.length,
        },
      });

      if (overrides.length > 0) {
        await writeAuditLog(tx, {
          organizationId: user.organizationId,
          userId: user.id,
          action: "OVERRIDE_FEFO",
          entityType: "stock_issue",
          entityId: issue!.id,
          afterData: { items: overrides },
          note: `เลือกลอตเองแทน FEFO: ${overrides.join(", ")}`,
        });
      }

      return {
        issueId: issue!.id,
        issueNumber,
        postingId: posted.postingId,
        replayed: false,
      };
    }),
  );
}

/** Validates the menu/period context and returns the recipe version to record. */
async function resolveIssueContext(
  tx: DbExecutor,
  organizationId: string,
  input: IssueInput,
): Promise<{ recipeVersionId: string | null }> {
  if (!input.menuId) return { recipeVersionId: null };

  if (input.mealPeriodId) {
    const [period] = await tx
      .select({ id: mealPeriods.id })
      .from(mealPeriods)
      .where(
        and(
          eq(mealPeriods.id, input.mealPeriodId),
          eq(mealPeriods.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!period) throw new AppError("NOT_FOUND", "ไม่พบมื้ออาหาร");
  }

  const [version] = await tx
    .select({ id: recipeVersions.id })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .innerJoin(menus, eq(menus.id, recipes.menuId))
    .where(
      and(
        eq(menus.id, input.menuId),
        eq(menus.organizationId, organizationId),
        eq(recipeVersions.isPublished, true),
      ),
    )
    .orderBy(desc(recipeVersions.effectiveFrom), desc(recipeVersions.versionNo))
    .limit(1);

  if (!version) throw new AppError("NOT_FOUND", "เมนูนี้ยังไม่มีสูตรที่เผยแพร่");
  return { recipeVersionId: version.id };
}

async function findIssueByIdempotencyKey(
  organizationId: string,
  idempotencyKey: string,
): Promise<IssueResult | null> {
  const [posting] = await db
    .select({
      id: inventoryPostings.id,
      referenceId: inventoryPostings.referenceId,
      referenceNumber: inventoryPostings.referenceNumber,
    })
    .from(inventoryPostings)
    .where(
      and(
        eq(inventoryPostings.organizationId, organizationId),
        eq(inventoryPostings.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (!posting?.referenceId) return null;

  return {
    issueId: posting.referenceId,
    issueNumber: posting.referenceNumber ?? "",
    postingId: posting.id,
    replayed: true,
  };
}
