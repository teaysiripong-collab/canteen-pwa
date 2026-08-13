import { z } from "zod";
import {
  codeSchema,
  nameThSchema,
  optionalTextSchema,
  optionalUuidSchema,
  positiveQtySchema,
  uuidSchema,
} from "./common";

export const menuInputSchema = z.object({
  code: codeSchema,
  nameTh: nameThSchema,
  nameEn: optionalTextSchema,
  categoryId: optionalUuidSchema,
  isActive: z.coerce.boolean().default(true),
  note: optionalTextSchema,
});

export type MenuInput = z.infer<typeof menuInputSchema>;

export const bomLineSchema = z.object({
  itemId: uuidSchema,
  unitId: uuidSchema,
  /**
   * The shorthand the kitchen writes, e.g. "30+20". Parsed on the server against the
   * organization's configured meal periods so the client can never invent a split.
   */
  quantityInput: z.string().trim().min(1, "กรุณากรอกจำนวน").max(60),
  wasteFactor: z.coerce
    .number({ invalid_type_error: "กรุณากรอกตัวเลข" })
    .min(0, "ต้องไม่ติดลบ")
    .lt(1, "ต้องน้อยกว่า 1 (0.05 = 5%)")
    .default(0),
  note: optionalTextSchema,
});

export const saveBomSchema = z.object({
  recipeVersionId: uuidSchema,
  yieldQty: positiveQtySchema.default(1),
  yieldUnitId: optionalUuidSchema,
  note: optionalTextSchema,
  lines: z.array(bomLineSchema).min(1, "สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ"),
});

export type SaveBomInput = z.infer<typeof saveBomSchema>;
export type BomLineInput = z.infer<typeof bomLineSchema>;

export const publishBomSchema = z.object({
  recipeVersionId: uuidSchema,
  effectiveFrom: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง")
    .optional(),
});

export type PublishBomInput = z.infer<typeof publishBomSchema>;
