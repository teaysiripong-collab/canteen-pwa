"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { toValidationError } from "@/lib/form-data";
import type { WasteReason } from "@/lib/inventory/transaction-types";
import { wasteInputSchema } from "@/schemas/waste";
import { recordWaste } from "@/services/waste-service";

export async function recordWasteAction(
  raw: unknown,
): Promise<ActionResult<{ postingId: string; totalValue: string; replayed: boolean }>> {
  try {
    const input = wasteInputSchema.parse(raw);
    const result = await recordWaste({ ...input, reason: input.reason as WasteReason });

    // Writing stock off changes balances, the expiry alert and the day's cost.
    revalidatePath("/inventory/waste");
    revalidatePath("/inventory/stock");
    revalidatePath("/inventory/expiry");
    revalidatePath("/alerts");
    revalidatePath("/dashboard");

    return actionSuccess(result);
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}
