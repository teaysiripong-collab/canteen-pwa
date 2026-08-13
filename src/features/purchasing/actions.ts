"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { toValidationError } from "@/lib/form-data";
import { purchaseOrderInputSchema, type PurchaseOrderStatus } from "@/schemas/purchase-order";
import {
  createPurchaseOrder,
  setPurchaseOrderStatus,
  updatePurchaseOrder,
} from "@/services/purchase-order-service";

export async function savePurchaseOrderAction(
  raw: unknown,
  purchaseOrderId?: string,
): Promise<ActionResult<{ purchaseOrderId: string }>> {
  try {
    const input = purchaseOrderInputSchema.parse(raw);
    const result = purchaseOrderId
      ? await updatePurchaseOrder(purchaseOrderId, input)
      : await createPurchaseOrder(input);

    revalidatePath("/purchasing/orders");
    return actionSuccess({ purchaseOrderId: result.purchaseOrderId });
  } catch (error) {
    if (error instanceof ZodError) return toActionError(toValidationError(error));
    return toActionError(error);
  }
}

export async function setPurchaseOrderStatusAction(input: {
  purchaseOrderId: string;
  status: PurchaseOrderStatus;
  reason?: string;
}): Promise<ActionResult<{ status: string }>> {
  try {
    const updated = await setPurchaseOrderStatus(
      input.purchaseOrderId,
      input.status,
      input.reason,
    );
    revalidatePath("/purchasing/orders");
    revalidatePath(`/purchasing/orders/${input.purchaseOrderId}`);
    return actionSuccess({ status: updated.status });
  } catch (error) {
    return toActionError(error);
  }
}
