"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { toValidationError } from "@/lib/form-data";
import { transferInputSchema, transferPreviewSchema } from "@/schemas/transfer";
import {
  createStockTransfer,
  previewTransfer,
  type TransferPreviewLine,
} from "@/services/transfer-service";
import { listTransferableItems } from "@/repositories/transfer-repository";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";

export async function submitTransferAction(
  raw: unknown,
): Promise<ActionResult<{ transferId: string; transferNumber: string }>> {
  try {
    const input = transferInputSchema.parse(raw);
    const result = await createStockTransfer(input);

    revalidatePath("/inventory/transfer");
    revalidatePath("/inventory/stock");
    revalidatePath("/dashboard");

    return actionSuccess({
      transferId: result.transferId,
      transferNumber: result.transferNumber,
    });
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}

/** Read-only "what would happen" used by the confirm step. */
export async function previewTransferAction(
  raw: unknown,
): Promise<ActionResult<TransferPreviewLine[]>> {
  try {
    const input = transferPreviewSchema.parse(raw);
    if (input.lines.length === 0) return actionSuccess([]);
    return actionSuccess(await previewTransfer(input));
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}

/** Items with stock at the chosen source, reloaded whenever the source changes. */
export async function loadTransferableItemsAction(
  fromLocationId: string,
): Promise<ActionResult<Awaited<ReturnType<typeof listTransferableItems>>>> {
  try {
    const user = await requirePermission(PERMISSIONS.STOCK_VIEW);
    return actionSuccess(await listTransferableItems(user.organizationId, fromLocationId));
  } catch (error) {
    return toActionError(error);
  }
}
