"use server";

import { revalidatePath } from "next/cache";
import { actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import {
  createDraftOrdersFromPlan,
  type DraftOrderResult,
} from "@/services/purchase-planner-service";

export async function createDraftOrdersAction(input: {
  fromDate: string;
  toDate: string;
  locationId: string;
  supplierIds: string[];
  excludedItemIds?: string[];
}): Promise<ActionResult<{ orders: DraftOrderResult[] }>> {
  try {
    const orders = await createDraftOrdersFromPlan(input);
    revalidatePath("/purchasing/orders");
    revalidatePath("/purchasing/planner");
    return actionSuccess({ orders });
  } catch (error) {
    return toActionError(error);
  }
}
