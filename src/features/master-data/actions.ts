"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { AppError, actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import {
  itemInputSchema,
  locationInputSchema,
  supplierInputSchema,
} from "@/schemas/master-data";
import { createItem, setItemActive, updateItem } from "@/services/item-service";
import { createLocation, setLocationActive, updateLocation } from "@/services/location-service";
import { createSupplier, setSupplierActive, updateSupplier } from "@/services/supplier-service";

/** Zod issues become field errors the form renders in Thai next to the offending input. */
function toValidationError(error: ZodError): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return new AppError("VALIDATION", "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", { fieldErrors });
}

function parse<T>(schema: { parse: (value: unknown) => T }, formData: FormData): T {
  const raw = Object.fromEntries(formData.entries());
  // Unchecked checkboxes are absent from FormData; normalise them to false.
  for (const key of ["isActive", "holdsStock"]) {
    if (key in raw) raw[key] = raw[key] === "on" || raw[key] === "true" ? "true" : "false";
  }
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) throw toValidationError(error);
    throw error;
  }
}

function idOf(formData: FormData): string | null {
  const id = formData.get("id");
  return typeof id === "string" && id.length > 0 ? id : null;
}

/* ----------------------------------------------------------------- locations */

export async function saveLocationAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = parse(locationInputSchema, formData);
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
    const input = parse(supplierInputSchema, formData);
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
    const input = parse(itemInputSchema, formData);
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
