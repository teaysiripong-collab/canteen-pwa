import { z } from "zod";
import {
  nonNegativeQtySchema,
  optionalNonNegativeQtySchema,
  optionalTextSchema,
  optionalUuidSchema,
  positiveQtySchema,
  uuidSchema,
} from "./common";

export const receiptLineStatuses = [
  "ACCEPTED",
  "PARTIAL",
  "REJECTED",
  "DAMAGED",
  "WRONG_ITEM",
  "OVER_DELIVERED",
] as const;

export const RECEIPT_LINE_STATUS_LABELS_TH: Record<(typeof receiptLineStatuses)[number], string> = {
  ACCEPTED: "รับครบ",
  PARTIAL: "รับบางส่วน",
  REJECTED: "ปฏิเสธทั้งหมด",
  DAMAGED: "ของเสียหาย",
  WRONG_ITEM: "ส่งผิดรายการ",
  OVER_DELIVERED: "ส่งเกิน",
};

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const receivingLineSchema = z
  .object({
    itemId: uuidSchema,
    /** Quantity in the unit written on the delivery note, not the stock unit. */
    receivedQty: nonNegativeQtySchema,
    receiptUnitId: uuidSchema,
    /** How many base units one receipt unit holds (1 แผง = 30 ฟอง -> 30). */
    conversionToBase: positiveQtySchema.default(1),
    /** Refused at the door, in the same unit as receivedQty. Never enters stock. */
    rejectedQty: nonNegativeQtySchema.default(0),
    /** Price per receipt unit, the way it is printed on the invoice. */
    unitPrice: optionalNonNegativeQtySchema,
    /** Set when this line fulfils a purchase order line. */
    purchaseOrderItemId: optionalUuidSchema.optional(),
    lineStatus: z.enum(receiptLineStatuses).default("ACCEPTED"),
    lotNumber: optionalTextSchema,
    manufactureDate: isoDateSchema,
    expiryDate: isoDateSchema,
    note: optionalTextSchema,
  })
  .refine((line) => line.rejectedQty <= line.receivedQty, {
    message: "จำนวนที่ปฏิเสธมากกว่าจำนวนที่ส่งมา",
    path: ["rejectedQty"],
  })
  .refine((line) => line.receivedQty > 0, {
    message: "จำนวนต้องมากกว่า 0",
    path: ["receivedQty"],
  })
  .refine(
    (line) =>
      !line.expiryDate || !line.manufactureDate || line.expiryDate >= line.manufactureDate,
    { message: "วันหมดอายุต้องไม่ก่อนวันผลิต", path: ["expiryDate"] },
  );

export const receivingInputSchema = z.object({
  /**
   * Generated once when the form opens. Re-submitting the same key returns the receipt
   * that was already created instead of receiving the delivery twice.
   */
  idempotencyKey: z.string().trim().min(8, "รหัสอ้างอิงไม่ถูกต้อง").max(120),
  supplierId: uuidSchema,
  locationId: uuidSchema,
  /** Set when receiving against a purchase order; its lines carry purchaseOrderItemId. */
  purchaseOrderId: optionalUuidSchema.optional(),
  supplierDocNumber: optionalTextSchema,
  note: optionalTextSchema,
  lines: z.array(receivingLineSchema).min(1, "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ"),
});

export type ReceivingInput = z.infer<typeof receivingInputSchema>;
export type ReceivingLineInput = z.infer<typeof receivingLineSchema>;
