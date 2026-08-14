"use server";

import { revalidatePath } from "next/cache";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { updateSetting } from "@/services/settings-service";

export async function saveExpiryThresholdsAction(
  days: number[],
): Promise<ActionResult<{ saved: true }>> {
  try {
    await updateSetting("expiry_alert_days", days);
    // Thresholds change what counts as urgent, so every screen that reads them is stale.
    revalidatePath("/settings");
    revalidatePath("/inventory/expiry");
    revalidatePath("/alerts");
    revalidatePath("/dashboard");
    return actionSuccess({ saved: true } as const);
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveDocumentPrefixesAction(
  prefixes: Record<string, string>,
): Promise<ActionResult<{ saved: true }>> {
  try {
    await updateSetting("document_prefixes", prefixes);
    revalidatePath("/settings");
    return actionSuccess({ saved: true } as const);
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveNegativeStockAction(
  allow: boolean,
): Promise<ActionResult<{ saved: true }>> {
  try {
    await updateSetting("allow_negative_stock", allow);
    revalidatePath("/settings");
    return actionSuccess({ saved: true } as const);
  } catch (error) {
    return toActionError(error);
  }
}
