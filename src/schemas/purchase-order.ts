import { z } from "zod";
import {
  optionalNonNegativeQtySchema,
  optionalTextSchema,
  positiveQtySchema,
  uuidSchema,
} from "./common";

/**
 * Workflow states. The stored enum keeps the names from the original specification —
 * PENDING / PARTIALLY_RECEIVED / RECEIVED — which are the same states the roadmap calls
 * SUBMITTED / PARTIAL / COMPLETED.
 */
export const purchaseOrderStatuses = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;

export type PurchaseOrderStatus = (typeof purchaseOrderStatuses)[number];

export const PO_STATUS_LABELS_TH: Record<PurchaseOrderStatus, string> = {
  DRAFT: "ฉบับร่าง",
  PENDING: "รออนุมัติ",
  APPROVED: "อนุมัติแล้ว",
  SENT: "ส่งให้ผู้ขายแล้ว",
  PARTIALLY_RECEIVED: "รับบางส่วน",
  RECEIVED: "รับครบแล้ว",
  CANCELLED: "ยกเลิก",
};

export const PO_STATUS_TONES: Record<PurchaseOrderStatus, "muted" | "info" | "warning" | "success"> =
  {
    DRAFT: "muted",
    PENDING: "warning",
    APPROVED: "info",
    SENT: "info",
    PARTIALLY_RECEIVED: "warning",
    RECEIVED: "success",
    CANCELLED: "muted",
  };

export const purchaseOrderLineSchema = z.object({
  itemId: uuidSchema,
  /** Ordered in the supplier's purchase unit. */
  orderedQty: positiveQtySchema,
  purchaseUnitId: uuidSchema,
  conversionToBase: positiveQtySchema.default(1),
  unitPrice: optionalNonNegativeQtySchema,
  note: optionalTextSchema,
});

export const purchaseOrderInputSchema = z
  .object({
    supplierId: uuidSchema,
    deliverToLocationId: uuidSchema,
    orderDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง"),
    expectedDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ไม่ถูกต้อง")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    note: optionalTextSchema,
    lines: z.array(purchaseOrderLineSchema).min(1, "ต้องมีรายการอย่างน้อย 1 รายการ"),
  })
  .refine(
    (input) => new Set(input.lines.map((line) => line.itemId)).size === input.lines.length,
    { message: "มีวัตถุดิบซ้ำกันในใบสั่งซื้อ", path: ["lines"] },
  )
  .refine((input) => !input.expectedDate || input.expectedDate >= input.orderDate, {
    message: "วันที่คาดว่าจะได้รับต้องไม่ก่อนวันที่สั่ง",
    path: ["expectedDate"],
  });

export type PurchaseOrderInput = z.infer<typeof purchaseOrderInputSchema>;
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;
