"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { toValidationError } from "@/lib/form-data";
import { issueInputSchema } from "@/schemas/issue";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import {
  createStockIssue,
  getIssueStandard,
  type IssueStandardLine,
} from "@/services/issue-service";

export async function loadIssueStandardAction(input: {
  menuId: string;
  mealPeriodId: string;
  locationId: string;
  servings?: number;
}): Promise<ActionResult<{ versionNo: number; lines: IssueStandardLine[] }>> {
  try {
    const user = await requirePermission(PERMISSIONS.ISSUE_CREATE);
    const standard = await getIssueStandard({ organizationId: user.organizationId, ...input });
    return actionSuccess({ versionNo: standard.versionNo, lines: standard.lines });
  } catch (error) {
    return toActionError(error);
  }
}

export async function submitIssueAction(
  raw: unknown,
): Promise<ActionResult<{ issueId: string; issueNumber: string }>> {
  try {
    const input = issueInputSchema.parse(raw);
    const result = await createStockIssue(input);

    revalidatePath("/inventory/issue");
    revalidatePath("/inventory/stock");
    revalidatePath("/dashboard");

    return actionSuccess({ issueId: result.issueId, issueNumber: result.issueNumber });
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}
