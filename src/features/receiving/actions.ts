"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { toValidationError } from "@/lib/form-data";
import { receivingInputSchema } from "@/schemas/receiving";
import { createGoodsReceipt } from "@/services/receiving-service";

export type ReceivingActionResult = ActionResult<{
  receiptId: string;
  receiptNumber: string;
  replayed: boolean;
}>;

/**
 * The receiving form posts a structured object rather than FormData, because its lines are
 * a dynamic list. Validation still happens here on the server — the client shape is never
 * trusted.
 */
export async function submitReceivingAction(raw: unknown): Promise<ReceivingActionResult> {
  try {
    const input = receivingInputSchema.parse(raw);
    const result = await createGoodsReceipt(input);

    revalidatePath("/inventory/receiving");
    revalidatePath("/inventory/stock");
    revalidatePath("/dashboard");

    return actionSuccess({
      receiptId: result.receiptId,
      receiptNumber: result.receiptNumber,
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}
