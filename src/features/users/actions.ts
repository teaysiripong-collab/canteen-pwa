"use server";

import { revalidatePath } from "next/cache";
import { AppError, actionSuccess, toActionError, type ActionResult } from "@/lib/errors";
import { idOf, parseFormData } from "@/lib/form-data";
import { userInputSchema } from "@/schemas/user";
import { createUser, setUserActive, updateUser } from "@/services/user-service";

export async function saveUserAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = parseFormData(userInputSchema, formData, {
      checkboxes: ["isActive"],
      multiValue: ["roleCodes"],
    });
    const id = idOf(formData);
    const saved = id ? await updateUser(id, input) : await createUser(input);

    revalidatePath("/users");
    return actionSuccess({ id: saved.id });
  } catch (error) {
    return toActionError(error);
  }
}

export async function setUserActiveAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const id = idOf(formData);
    if (!id) throw new AppError("VALIDATION");
    await setUserActive(id, formData.get("isActive") === "true");
    revalidatePath("/users");
    return actionSuccess();
  } catch (error) {
    return toActionError(error);
  }
}
