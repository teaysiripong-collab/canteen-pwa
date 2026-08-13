"use server";

import { revalidatePath } from "next/cache";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import {
  applyTemplateToPlan,
  copyIntoPlan,
  getOrCreatePlan,
  savePlanAsTemplate,
  setPlanMenus,
  setPlanStatus,
  type CopySource,
  type PlanMenuInput,
} from "@/services/menu-plan-service";

function revalidatePlanner() {
  revalidatePath("/menu/planner");
  revalidatePath("/dashboard");
}

export async function savePlanMenusAction(input: {
  planDate: string;
  locationId: string;
  mealPeriodId: string;
  menus: PlanMenuInput[];
}): Promise<ActionResult<{ planId: string }>> {
  try {
    const plan = await getOrCreatePlan(input);
    const result = await setPlanMenus(plan.id, input.menus);
    revalidatePlanner();
    return actionSuccess({ planId: result.planId });
  } catch (error) {
    return toActionError(error);
  }
}

export async function setPlanStatusAction(input: {
  planDate: string;
  locationId: string;
  mealPeriodId: string;
  status: "DRAFT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
}): Promise<ActionResult<{ status: string }>> {
  try {
    const plan = await getOrCreatePlan(input);
    const updated = await setPlanStatus(plan.id, input.status);
    revalidatePlanner();
    return actionSuccess({ status: updated.status });
  } catch (error) {
    return toActionError(error);
  }
}

export async function copyPlanAction(input: {
  planDate: string;
  locationId: string;
  mealPeriodId: string;
  source: CopySource;
  replace?: boolean;
}): Promise<ActionResult<{ menus: number }>> {
  try {
    const plan = await getOrCreatePlan(input);
    const result = await copyIntoPlan({
      planId: plan.id,
      source: input.source,
      replace: input.replace,
    });
    revalidatePlanner();
    return actionSuccess({ menus: result.menus });
  } catch (error) {
    return toActionError(error);
  }
}

export async function savePlanTemplateAction(input: {
  planDate: string;
  locationId: string;
  mealPeriodId: string;
  nameTh: string;
}): Promise<ActionResult<{ templateId: string }>> {
  try {
    const plan = await getOrCreatePlan(input);
    const template = await savePlanAsTemplate({ planId: plan.id, nameTh: input.nameTh });
    revalidatePlanner();
    return actionSuccess({ templateId: template.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function applyTemplateAction(input: {
  planDate: string;
  locationId: string;
  mealPeriodId: string;
  templateId: string;
  replace?: boolean;
}): Promise<ActionResult<{ menus: number }>> {
  try {
    const plan = await getOrCreatePlan(input);
    const result = await applyTemplateToPlan({
      planId: plan.id,
      templateId: input.templateId,
      replace: input.replace,
    });
    revalidatePlanner();
    return actionSuccess({ menus: result.menus });
  } catch (error) {
    return toActionError(error);
  }
}
