import { describe, expect, it } from "vitest";
import { z } from "zod";
import { booleanFlagSchema } from "@/schemas/common";
import { AppError } from "../errors";
import { idOf, parseFormData } from "../form-data";

const schema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อ"),
  isActive: booleanFlagSchema.default(true),
  roleCodes: z.array(z.string()).default([]),
});

function formDataOf(entries: [string, string][]): FormData {
  const formData = new FormData();
  for (const [key, value] of entries) formData.append(key, value);
  return formData;
}

describe("parseFormData", () => {
  it("treats an absent checkbox as false instead of falling back to the schema default", () => {
    // An unchecked box is simply missing from the payload; without normalisation the
    // `.default(true)` above would silently keep the record active.
    const parsed = parseFormData(schema, formDataOf([["name", "ไก่บด"]]), {
      checkboxes: ["isActive"],
    });

    expect(parsed.isActive).toBe(false);
  });

  it("reads a checked box as true", () => {
    const parsed = parseFormData(
      schema,
      formDataOf([
        ["name", "ไก่บด"],
        ["isActive", "on"],
      ]),
      { checkboxes: ["isActive"] },
    );

    expect(parsed.isActive).toBe(true);
  });

  it("collects every value of a repeated field", () => {
    const parsed = parseFormData(
      schema,
      formDataOf([
        ["name", "สมชาย"],
        ["roleCodes", "STORE"],
        ["roleCodes", "MANAGER"],
      ]),
      { multiValue: ["roleCodes"] },
    );

    expect(parsed.roleCodes).toEqual(["STORE", "MANAGER"]);
  });

  it("returns an empty list when a repeated field was left untouched", () => {
    const parsed = parseFormData(schema, formDataOf([["name", "สมชาย"]]), {
      multiValue: ["roleCodes"],
    });

    expect(parsed.roleCodes).toEqual([]);
  });

  it("turns validation failures into Thai field errors", () => {
    expect.assertions(3);
    try {
      parseFormData(schema, formDataOf([["name", ""]]), {});
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("VALIDATION");
      expect((error as AppError).fieldErrors?.name).toEqual(["กรุณากรอกชื่อ"]);
    }
  });

  it("reads the edit id and treats a blank one as a create", () => {
    expect(idOf(formDataOf([["id", "abc"]]))).toBe("abc");
    expect(idOf(formDataOf([["id", ""]]))).toBeNull();
    expect(idOf(formDataOf([]))).toBeNull();
  });
});
