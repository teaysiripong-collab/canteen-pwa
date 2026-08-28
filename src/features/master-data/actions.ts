"use server";

import { revalidatePath } from "next/cache";
import { AppError, actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { idOf, parseFormData } from "@/lib/form-data";
import {
  itemInputSchema,
  locationInputSchema,
  supplierInputSchema,
  supplierItemInputSchema,
} from "@/schemas/master-data";
import { createItem, setItemActive, updateItem } from "@/services/item-service";
import { createLocation, setLocationActive, updateLocation } from "@/services/location-service";
import {
  createSupplierItem,
  setSupplierItemActive,
  updateSupplierItem,
} from "@/services/supplier-item-service";
import { createSupplier, setSupplierActive, updateSupplier } from "@/services/supplier-service";

/* ----------------------------------------------------------------- locations */

export async function saveLocationAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = parseFormData(locationInputSchema, formData, {
      checkboxes: ["holdsStock", "isActive"],
    });
    const id = idOf(formData);
    const saved = id ? await updateLocation(id, input) : await createLocation(input);

    revalidatePath("/locations");
    return actionSuccess({ id: saved.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function setLocationActiveAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = idOf(formData);
    if (!id) throw new AppError("VALIDATION");
    await setLocationActive(id, formData.get("isActive") === "true");
    revalidatePath("/locations");
    return actionSuccess();
  } catch (error) {
    return toActionError(error);
  }
}

/* ----------------------------------------------------------------- suppliers */

export async function saveSupplierAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = parseFormData(supplierInputSchema, formData, { checkboxes: ["isActive"] });
    const id = idOf(formData);
    const saved = id ? await updateSupplier(id, input) : await createSupplier(input);

    revalidatePath("/suppliers");
    return actionSuccess({ id: saved.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function setSupplierActiveAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = idOf(formData);
    if (!id) throw new AppError("VALIDATION");
    await setSupplierActive(id, formData.get("isActive") === "true");
    revalidatePath("/suppliers");
    return actionSuccess();
  } catch (error) {
    return toActionError(error);
  }
}

/* --------------------------------------------------------------------- items */

export async function saveItemAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = parseFormData(itemInputSchema, formData, { checkboxes: ["isActive"] });
    const id = idOf(formData);
    const saved = id ? await updateItem(id, input) : await createItem(input);

    revalidatePath("/items");
    return actionSuccess({ id: saved.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function setItemActiveAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = idOf(formData);
    if (!id) throw new AppError("VALIDATION");
    await setItemActive(id, formData.get("isActive") === "true");
    revalidatePath("/items");
    return actionSuccess();
  } catch (error) {
    return toActionError(error);
  }
}

/* --------------------------------------------------------- supplier ↔ item map */

export async function saveSupplierItemAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = parseFormData(supplierItemInputSchema, formData, {
      checkboxes: ["isPreferred", "isActive"],
    });
    const id = idOf(formData);
    const saved = id ? await updateSupplierItem(id, input) : await createSupplierItem(input);

    revalidatePath(`/suppliers/${input.supplierId}`);
    revalidatePath("/items");
    return actionSuccess({ id: saved.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function setSupplierItemActiveAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = idOf(formData);
    if (!id) throw new AppError("VALIDATION");
    const updated = await setSupplierItemActive(id, formData.get("isActive") === "true");
    revalidatePath(`/suppliers/${updated.supplierId}`);
    return actionSuccess();
  } catch (error) {
    return toActionError(error);
  }
}
