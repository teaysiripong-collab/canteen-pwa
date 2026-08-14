"use server";

import { revalidatePath } from "next/cache";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import {
  approveCountSession,
  cancelCountSession,
  openCountSession,
  saveCountLines,
} from "@/services/stock-count-service";

export async function openCountAction(input: {
  locationId: string;
  note?: string;
}): Promise<ActionResult<{ sessionId: string; countNumber: string; lineCount: number }>> {
  try {
    const result = await openCountSession(input);
    revalidatePath("/inventory/count");
    return actionSuccess(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveCountAction(input: {
  sessionId: string;
  lines: Array<{ lineId: string; countedBaseQty: number | null }>;
}): Promise<ActionResult<{ saved: number }>> {
  try {
    const result = await saveCountLines(input.sessionId, input.lines);
    revalidatePath(`/inventory/count/${input.sessionId}`);
    return actionSuccess(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function approveCountAction(input: {
  sessionId: string;
  idempotencyKey: string;
}): Promise<ActionResult<{ adjustedLines: number; postingId: string | null }>> {
  try {
    const result = await approveCountSession(input.sessionId, input.idempotencyKey);

    // Approving moves stock, so everything that reads balances is now stale.
    revalidatePath("/inventory/count");
    revalidatePath(`/inventory/count/${input.sessionId}`);
    revalidatePath("/inventory/stock");
    revalidatePath("/alerts");
    revalidatePath("/dashboard");

    return actionSuccess({ adjustedLines: result.adjustedLines, postingId: result.postingId });
  } catch (error) {
    return toActionError(error);
  }
}

export async function cancelCountAction(input: {
  sessionId: string;
  reason: string;
}): Promise<ActionResult<{ cancelled: true }>> {
  try {
    await cancelCountSession(input.sessionId, input.reason);
    revalidatePath("/inventory/count");
    return actionSuccess({ cancelled: true } as const);
  } catch (error) {
    return toActionError(error);
  }
}
