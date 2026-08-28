import { ZodError } from "zod";
import { AppError } from "@/lib/errors";

/** Zod issues become field errors the form renders in Thai next to the offending input. */
export function toValidationError(error: ZodError): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return new AppError("VALIDATION", "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", { fieldErrors });
}

type ParseOptions = {
  /**
   * Checkbox field names. An unchecked box is absent from FormData entirely, so each
   * declared name is normalised to an explicit "true"/"false" — otherwise a schema
   * default would silently turn "unchecked" back into "true".
   */
  checkboxes?: readonly string[];
  /** Fields that may appear several times (multi-select, checkbox groups). */
  multiValue?: readonly string[];
};

export function parseFormData<T>(
  schema: { parse: (value: unknown) => T },
  formData: FormData,
  options: ParseOptions = {},
): T {
  const raw: Record<string, unknown> = Object.fromEntries(formData.entries());

  for (const name of options.multiValue ?? []) {
    raw[name] = formData.getAll(name).filter((value) => value !== "");
  }

  for (const name of options.checkboxes ?? []) {
    const value = formData.get(name);
    raw[name] = value === "on" || value === "true" ? "true" : "false";
  }

  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) throw toValidationError(error);
    throw error;
  }
}

export function idOf(formData: FormData): string | null {
  const id = formData.get("id");
  return typeof id === "string" && id.length > 0 ? id : null;
}
