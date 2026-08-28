import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  locations,
  mealPeriods,
  menuPlanItems,
  menuPlanTemplateItems,
  menuPlanTemplates,
  menuPlans,
  menus,
  recipeVersions,
  recipes,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { addDays } from "@/lib/date";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { toNumericString } from "@/lib/quantity";
import { writeAuditLog } from "./audit-service";

export type PlanMenuInput = { menuId: string; plannedServings: number };

/** Statuses that still allow the line-up to be changed. */
const EDITABLE_STATUSES = new Set(["DRAFT", "CONFIRMED", "IN_PROGRESS"]);

/**
 * The published recipe version in force for a menu on a given date.
 *
 * Plans pin this at planning time, so a recipe published tomorrow cannot silently change
 * what today's plan meant.
 */
async function currentRecipeVersionId(
  executor: DbExecutor,
  menuId: string,
  onDate: string,
): Promise<string | null> {
  const rows = await executor
    .select({ id: recipeVersions.id, effectiveFrom: recipeVersions.effectiveFrom })
    .from(recipeVersions)
    .innerJoin(recipes, eq(recipes.id, recipeVersions.recipeId))
    .where(and(eq(recipes.menuId, menuId), eq(recipeVersions.isPublished, true)))
    .orderBy(desc(recipeVersions.effectiveFrom), desc(recipeVersions.versionNo));

  const effective = rows.find((row) => row.effectiveFrom <= onDate);
  return effective?.id ?? null;
}

async function assertPlanReferences(
  executor: DbExecutor,
  organizationId: string,
  locationId: string,
  mealPeriodId: string,
) {
  const [period] = await executor
    .select({ id: mealPeriods.id })
    .from(mealPeriods)
    .where(
      and(eq(mealPeriods.id, mealPeriodId), eq(mealPeriods.organizationId, organizationId)),
    )
    .limit(1);
  if (!period) throw new AppError("NOT_FOUND", "ไม่พบมื้ออาหาร");

  const [location] = await executor
    .select({ id: locations.id, isActive: locations.isActive })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.organizationId, organizationId)))
    .limit(1);
  if (!location) throw new AppError("NOT_FOUND", "ไม่พบสถานที่");
  if (!location.isActive) throw new AppError("VALIDATION", "สถานที่นี้ถูกปิดใช้งานแล้ว");
}

/** Finds the plan for a date/location/period, creating an empty draft when there is none. */
export async function getOrCreatePlan(input: {
  planDate: string;
  locationId: string;
  mealPeriodId: string;
}) {
  const user = await requirePermission(PERMISSIONS.MENU_MANAGE);

  return db.transaction(async (tx) => {
    await assertPlanReferences(
      tx,
      user.organizationId,
      input.locationId,
      input.mealPeriodId,
    );

    const [existing] = await tx
      .select()
      .from(menuPlans)
      .where(
        and(
          eq(menuPlans.organizationId, user.organizationId),
          eq(menuPlans.locationId, input.locationId),
          eq(menuPlans.planDate, input.planDate),
          eq(menuPlans.mealPeriodId, input.mealPeriodId),
        ),
      )
      .limit(1);

    if (existing) return existing;

    const [created] = await tx
      .insert(menuPlans)
      .values({
        organizationId: user.organizationId,
        locationId: input.locationId,
        planDate: input.planDate,
        mealPeriodId: input.mealPeriodId,
        status: "DRAFT",
        createdBy: user.id,
      })
      .returning();

    return created!;
  });
}

async function loadEditablePlan(
  executor: DbExecutor,
  organizationId: string,
  planId: string,
) {
  const [plan] = await executor
    .select()
    .from(menuPlans)
    .where(and(eq(menuPlans.id, planId), eq(menuPlans.organizationId, organizationId)))
    .limit(1);

  if (!plan) throw new AppError("NOT_FOUND", "ไม่พบแผนเมนู");
  if (!EDITABLE_STATUSES.has(plan.status)) {
    throw new AppError("VALIDATION", "แผนนี้ปิดแล้ว แก้ไขไม่ได้");
  }
  return plan;
}

/**
 * Replaces the menus planned for one meal period. Each menu is pinned to the recipe
 * version in force on the plan's date; a menu with no published recipe is rejected rather
 * than planned blind, because it would contribute nothing to the requirement.
 */
export async function setPlanMenus(planId: string, menuInputs: PlanMenuInput[]) {
  const user = await requirePermission(PERMISSIONS.MENU_MANAGE);

  const seen = new Set<string>();
  for (const entry of menuInputs) {
    if (seen.has(entry.menuId)) throw new AppError("VALIDATION", "มีเมนูซ้ำกันในแผน");
    seen.add(entry.menuId);
    if (entry.plannedServings <= 0) {
      throw new AppError("VALIDATION", "จำนวนที่วางแผนต้องมากกว่า 0");
    }
  }

  return db.transaction(async (tx) => {
    const plan = await loadEditablePlan(tx, user.organizationId, planId);
    return setPlanMenusInternal(
      tx,
      user.organizationId,
      user.id,
      plan.id,
      plan.planDate,
      menuInputs,
    );
  });
}

/** Confirming is what turns a plan into demand the rest of the system may act on. */
export async function setPlanStatus(
  planId: string,
  status: "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED",
) {
  const user = await requirePermission(PERMISSIONS.MENU_MANAGE);

  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(menuPlans)
      .where(and(eq(menuPlans.id, planId), eq(menuPlans.organizationId, user.organizationId)))
      .limit(1);
    if (!plan) throw new AppError("NOT_FOUND", "ไม่พบแผนเมนู");

    if (status === "CONFIRMED") {
      const lines = await tx
        .select({ id: menuPlanItems.id })
        .from(menuPlanItems)
        .where(eq(menuPlanItems.menuPlanId, planId));
      if (lines.length === 0) {
        throw new AppError("VALIDATION", "แผนยังไม่มีเมนู ยืนยันไม่ได้");
      }
    }

    const [updated] = await tx
      .update(menuPlans)
      .set({
        status,
        confirmedBy: status === "CONFIRMED" ? user.id : plan.confirmedBy,
        confirmedAt: status === "CONFIRMED" ? new Date() : plan.confirmedAt,
        updatedAt: new Date(),
      })
      .where(eq(menuPlans.id, planId))
      .returning();

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: status === "CONFIRMED" ? "APPROVE" : status === "CANCELLED" ? "CANCEL" : "UPDATE",
      entityType: "menu_plan",
      entityId: planId,
      beforeData: { status: plan.status },
      afterData: { status },
    });

    return updated!;
  });
}

export type CopySource =
  | { kind: "PREVIOUS_DAY" }
  | { kind: "PREVIOUS_WEEK" }
  | { kind: "OTHER_PERIOD"; fromMealPeriodId: string }
  | { kind: "DATE"; fromDate: string };

/**
 * Copies a line-up onto a plan. The recipe version is resolved fresh for the target date
 * rather than copied, so copying last week's plan onto today uses today's published
 * recipe — the menus repeat, the recipe does not get frozen in the past.
 */
export async function copyIntoPlan(input: {
  planId: string;
  source: CopySource;
  replace?: boolean;
}) {
  const user = await requirePermission(PERMISSIONS.MENU_MANAGE);

  return db.transaction(async (tx) => {
    const plan = await loadEditablePlan(tx, user.organizationId, input.planId);

    const sourceDate =
      input.source.kind === "PREVIOUS_DAY"
        ? addDays(plan.planDate, -1)
        : input.source.kind === "PREVIOUS_WEEK"
          ? addDays(plan.planDate, -7)
          : input.source.kind === "DATE"
            ? input.source.fromDate
            : plan.planDate;

    const sourceMealPeriodId =
      input.source.kind === "OTHER_PERIOD" ? input.source.fromMealPeriodId : plan.mealPeriodId;

    const [sourcePlan] = await tx
      .select({ id: menuPlans.id })
      .from(menuPlans)
      .where(
        and(
          eq(menuPlans.organizationId, user.organizationId),
          eq(menuPlans.locationId, plan.locationId),
          eq(menuPlans.planDate, sourceDate),
          eq(menuPlans.mealPeriodId, sourceMealPeriodId),
        ),
      )
      .limit(1);

    if (!sourcePlan) throw new AppError("NOT_FOUND", "ไม่พบแผนต้นทางที่จะคัดลอก");

    const sourceItems = await tx
      .select({
        menuId: menuPlanItems.menuId,
        plannedServings: menuPlanItems.plannedServings,
      })
      .from(menuPlanItems)
      .where(eq(menuPlanItems.menuPlanId, sourcePlan.id));

    if (sourceItems.length === 0) {
      throw new AppError("VALIDATION", "แผนต้นทางไม่มีเมนูให้คัดลอก");
    }

    const existing = input.replace
      ? []
      : await tx
          .select({ menuId: menuPlanItems.menuId, plannedServings: menuPlanItems.plannedServings })
          .from(menuPlanItems)
          .where(eq(menuPlanItems.menuPlanId, plan.id));

    const merged = new Map<string, number>();
    for (const row of existing) merged.set(row.menuId, Number(row.plannedServings));
    for (const row of sourceItems) {
      if (!merged.has(row.menuId)) merged.set(row.menuId, Number(row.plannedServings));
    }

    return setPlanMenusInternal(
      tx,
      user.organizationId,
      user.id,
      plan.id,
      plan.planDate,
      [...merged.entries()].map(([menuId, plannedServings]) => ({ menuId, plannedServings })),
    );
  });
}

/** Shared writer used by both the direct edit and the copy paths. */
async function setPlanMenusInternal(
  tx: DbExecutor,
  organizationId: string,
  userId: string,
  planId: string,
  planDate: string,
  menuInputs: PlanMenuInput[],
) {
  await tx.delete(menuPlanItems).where(eq(menuPlanItems.menuPlanId, planId));

  for (const entry of menuInputs) {
    const [menu] = await tx
      .select({ id: menus.id, nameTh: menus.nameTh })
      .from(menus)
      .where(and(eq(menus.id, entry.menuId), eq(menus.organizationId, organizationId)))
      .limit(1);
    if (!menu) throw new AppError("NOT_FOUND", "ไม่พบเมนู");

    const recipeVersionId = await currentRecipeVersionId(tx, entry.menuId, planDate);
    if (!recipeVersionId) {
      throw new AppError(
        "VALIDATION",
        `เมนู ${menu.nameTh} ยังไม่มีสูตรที่เผยแพร่ จึงวางแผนไม่ได้`,
      );
    }

    await tx.insert(menuPlanItems).values({
      menuPlanId: planId,
      menuId: entry.menuId,
      recipeVersionId,
      plannedServings: toNumericString(entry.plannedServings),
    });
  }

  await writeAuditLog(tx, {
    organizationId,
    userId,
    action: "UPDATE",
    entityType: "menu_plan",
    entityId: planId,
    afterData: { planDate, menus: menuInputs.length },
  });

  return { planId, menus: menuInputs.length };
}

/* ----------------------------------------------------------------- templates */

export async function savePlanAsTemplate(input: { planId: string; nameTh: string }) {
  const user = await requirePermission(PERMISSIONS.MENU_MANAGE);

  return db.transaction(async (tx) => {
    const [plan] = await tx
      .select()
      .from(menuPlans)
      .where(
        and(eq(menuPlans.id, input.planId), eq(menuPlans.organizationId, user.organizationId)),
      )
      .limit(1);
    if (!plan) throw new AppError("NOT_FOUND", "ไม่พบแผนเมนู");

    const planItems = await tx
      .select({ menuId: menuPlanItems.menuId, plannedServings: menuPlanItems.plannedServings })
      .from(menuPlanItems)
      .where(eq(menuPlanItems.menuPlanId, plan.id));

    if (planItems.length === 0) {
      throw new AppError("VALIDATION", "แผนนี้ไม่มีเมนู บันทึกเป็นเทมเพลตไม่ได้");
    }

    const [template] = await tx
      .insert(menuPlanTemplates)
      .values({
        organizationId: user.organizationId,
        nameTh: input.nameTh.trim(),
        locationId: plan.locationId,
        mealPeriodId: plan.mealPeriodId,
        createdBy: user.id,
      })
      .onConflictDoUpdate({
        target: [menuPlanTemplates.organizationId, menuPlanTemplates.nameTh],
        set: {
          locationId: plan.locationId,
          mealPeriodId: plan.mealPeriodId,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning();

    await tx
      .delete(menuPlanTemplateItems)
      .where(eq(menuPlanTemplateItems.templateId, template!.id));

    await tx.insert(menuPlanTemplateItems).values(
      planItems.map((item, index) => ({
        templateId: template!.id,
        menuId: item.menuId,
        plannedServings: item.plannedServings,
        sortOrder: index,
      })),
    );

    return template!;
  });
}

export async function applyTemplateToPlan(input: {
  planId: string;
  templateId: string;
  replace?: boolean;
}) {
  const user = await requirePermission(PERMISSIONS.MENU_MANAGE);

  return db.transaction(async (tx) => {
    const plan = await loadEditablePlan(tx, user.organizationId, input.planId);

    const [template] = await tx
      .select()
      .from(menuPlanTemplates)
      .where(
        and(
          eq(menuPlanTemplates.id, input.templateId),
          eq(menuPlanTemplates.organizationId, user.organizationId),
        ),
      )
      .limit(1);
    if (!template) throw new AppError("NOT_FOUND", "ไม่พบเทมเพลต");

    const templateItems = await tx
      .select({
        menuId: menuPlanTemplateItems.menuId,
        plannedServings: menuPlanTemplateItems.plannedServings,
      })
      .from(menuPlanTemplateItems)
      .where(eq(menuPlanTemplateItems.templateId, template.id))
      .orderBy(asc(menuPlanTemplateItems.sortOrder));

    if (templateItems.length === 0) {
      throw new AppError("VALIDATION", "เทมเพลตนี้ไม่มีเมนู");
    }

    const existing = input.replace
      ? []
      : await tx
          .select({ menuId: menuPlanItems.menuId, plannedServings: menuPlanItems.plannedServings })
          .from(menuPlanItems)
          .where(eq(menuPlanItems.menuPlanId, plan.id));

    const merged = new Map<string, number>();
    for (const row of existing) merged.set(row.menuId, Number(row.plannedServings));
    for (const row of templateItems) {
      if (!merged.has(row.menuId)) merged.set(row.menuId, Number(row.plannedServings));
    }

    return setPlanMenusInternal(
      tx,
      user.organizationId,
      user.id,
      plan.id,
      plan.planDate,
      [...merged.entries()].map(([menuId, plannedServings]) => ({ menuId, plannedServings })),
    );
  });
}

export async function listPlanTemplates(organizationId: string) {
  return db
    .select({
      id: menuPlanTemplates.id,
      nameTh: menuPlanTemplates.nameTh,
      mealPeriodId: menuPlanTemplates.mealPeriodId,
    })
    .from(menuPlanTemplates)
    .where(
      and(
        eq(menuPlanTemplates.organizationId, organizationId),
        eq(menuPlanTemplates.isActive, true),
      ),
    )
    .orderBy(asc(menuPlanTemplates.nameTh));
}

/** The plans for one date and location, one per meal period, with their menus. */
export async function getDayPlan(organizationId: string, planDate: string, locationId: string) {
  const plans = await db
    .select({
      id: menuPlans.id,
      mealPeriodId: menuPlans.mealPeriodId,
      status: menuPlans.status,
      note: menuPlans.note,
    })
    .from(menuPlans)
    .where(
      and(
        eq(menuPlans.organizationId, organizationId),
        eq(menuPlans.planDate, planDate),
        eq(menuPlans.locationId, locationId),
      ),
    );

  if (plans.length === 0) return [];

  const planItemRows = await db
    .select({
      menuPlanId: menuPlanItems.menuPlanId,
      menuId: menus.id,
      menuCode: menus.code,
      menuNameTh: menus.nameTh,
      plannedServings: menuPlanItems.plannedServings,
      recipeVersionId: menuPlanItems.recipeVersionId,
      versionNo: recipeVersions.versionNo,
    })
    .from(menuPlanItems)
    .innerJoin(menus, eq(menus.id, menuPlanItems.menuId))
    .leftJoin(recipeVersions, eq(recipeVersions.id, menuPlanItems.recipeVersionId))
    .where(
      inArray(
        menuPlanItems.menuPlanId,
        plans.map((plan) => plan.id),
      ),
    )
    .orderBy(asc(menus.code));

  return plans.map((plan) => ({
    ...plan,
    items: planItemRows.filter((row) => row.menuPlanId === plan.id),
  }));
}
