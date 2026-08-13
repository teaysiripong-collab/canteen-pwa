import { z } from "zod";
import { optionalTextSchema, positiveQtySchema, uuidSchema } from "./common";

export const transferLineSchema = z.object({
  itemId: uuidSchema,
  /** Always in the item's base unit — transfers move stock, not purchase packs. */
  baseQty: positiveQtySchema,
  note: optionalTextSchema,
});

export const transferInputSchema = z
  .object({
    /** Generated when the form opens, so a double tap moves the stock only once. */
    idempotencyKey: z.string().trim().min(8, "รหัสอ้างอิงไม่ถูกต้อง").max(120),
    fromLocationId: uuidSchema,
    toLocationId: uuidSchema,
    note: optionalTextSchema,
    lines: z.array(transferLineSchema).min(1, "กรุณาเพิ่มรายการอย่างน้อย 1 รายการ"),
  })
  .refine((input) => input.fromLocationId !== input.toLocationId, {
    message: "สถานที่ต้นทางและปลายทางต้องไม่ใช่ที่เดียวกัน",
    path: ["toLocationId"],
  })
  .refine(
    (input) => new Set(input.lines.map((line) => line.itemId)).size === input.lines.length,
    { message: "มีวัตถุดิบซ้ำกันในรายการ", path: ["lines"] },
  );

export type TransferInput = z.infer<typeof transferInputSchema>;
export type TransferLineInput = z.infer<typeof transferLineSchema>;

/** Payload for the preview call the form makes before showing the confirm button. */
export const transferPreviewSchema = z.object({
  fromLocationId: uuidSchema,
  toLocationId: uuidSchema,
  lines: z.array(transferLineSchema),
});

export type TransferPreviewInput = z.infer<typeof transferPreviewSchema>;
