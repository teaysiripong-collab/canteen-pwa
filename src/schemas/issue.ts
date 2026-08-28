import { z } from "zod";
import { optionalTextSchema, optionalUuidSchema, positiveQtySchema, uuidSchema } from "./common";

export const issueLineSchema = z.object({
  itemId: uuidSchema,
  /** What the BOM asked for; null on a manual line that has no standard. */
  standardBaseQty: z.coerce.number().min(0).optional(),
  /** What the kitchen actually takes. */
  actualBaseQty: positiveQtySchema,
  /** Lots chosen by hand; empty means let FEFO decide. Requires fefo.override. */
  lotPicks: z
    .array(z.object({ lotId: uuidSchema, baseQty: positiveQtySchema }))
    .optional()
    .default([]),
  note: optionalTextSchema,
});

export const issueInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8, "รหัสอ้างอิงไม่ถูกต้อง").max(120),
    locationId: uuidSchema,
    /** Present when issuing against a menu; absent for a manual issue. */
    menuId: optionalUuidSchema.optional(),
    mealPeriodId: optionalUuidSchema.optional(),
    servings: positiveQtySchema.optional(),
    note: optionalTextSchema,
    lines: z.array(issueLineSchema).min(1, "กรุณาเพิ่มรายการอย่างน้อย 1 รายการ"),
  })
  .refine((input) => !input.menuId || input.mealPeriodId, {
    message: "กรุณาเลือกมื้ออาหาร",
    path: ["mealPeriodId"],
  })
  .refine(
    (input) => new Set(input.lines.map((line) => line.itemId)).size === input.lines.length,
    { message: "มีวัตถุดิบซ้ำกันในรายการ", path: ["lines"] },
  );

export type IssueInput = z.infer<typeof issueInputSchema>;
export type IssueLineInput = z.infer<typeof issueLineSchema>;
