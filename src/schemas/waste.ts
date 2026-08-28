import { z } from "zod";
import { WASTE_REASONS } from "@/lib/inventory/transaction-types";
import { optionalTextSchema, positiveQtySchema, uuidSchema } from "./common";

export const wasteLineSchema = z.object({
  lotId: uuidSchema,
  baseQty: positiveQtySchema,
  note: optionalTextSchema,
});

export const wasteInputSchema = z.object({
  idempotencyKey: z.string().trim().min(8, "รหัสอ้างอิงไม่ถูกต้อง").max(120),
  locationId: uuidSchema,
  reason: z.enum(WASTE_REASONS as [string, ...string[]], {
    errorMap: () => ({ message: "กรุณาเลือกสาเหตุ" }),
  }),
  note: optionalTextSchema,
  lines: z.array(wasteLineSchema).min(1, "กรุณาเลือกลอตอย่างน้อย 1 รายการ"),
});

export type WasteFormInput = z.infer<typeof wasteInputSchema>;
