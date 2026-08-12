import { z } from "zod";
import {
  booleanFlagSchema,
  codeSchema,
  nameThSchema,
  nonNegativeQtySchema,
  optionalDayCountSchema,
  optionalNonNegativeQtySchema,
  optionalPositiveQtySchema,
  optionalTextSchema,
  optionalUuidSchema,
  positiveQtySchema,
  uuidSchema,
} from "./common";

/* ------------------------------------------------------------------ location */

export const locationKinds = ["STORE", "KITCHEN", "SERVICE_POINT", "OTHER"] as const;

export const LOCATION_KIND_LABELS_TH: Record<(typeof locationKinds)[number], string> = {
  STORE: "คลังเก็บของ",
  KITCHEN: "ครัว/ผลิต",
  SERVICE_POINT: "จุดให้บริการ",
  OTHER: "อื่นๆ",
};

export const locationInputSchema = z.object({
  code: codeSchema,
  nameTh: nameThSchema,
  nameEn: optionalTextSchema,
  kind: z.enum(locationKinds).default("STORE"),
  holdsStock: booleanFlagSchema.default(true),
  isActive: booleanFlagSchema.default(true),
  note: optionalTextSchema,
});

export type LocationInput = z.infer<typeof locationInputSchema>;

/* ------------------------------------------------------------------ supplier */

export const supplierInputSchema = z.object({
  code: codeSchema,
  nameTh: nameThSchema,
  nameEn: optionalTextSchema,
  contactName: optionalTextSchema,
  phone: z
    .string()
    .trim()
    .max(30, "เบอร์โทรยาวเกินไป")
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  email: z
    .string()
    .trim()
    .email("รูปแบบอีเมลไม่ถูกต้อง")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value === "" ? undefined : value)),
  address: optionalTextSchema,
  leadTimeDays: z.coerce.number().int().min(0, "ต้องไม่ติดลบ").max(365, "มากเกินไป").default(1),
  paymentTerm: optionalTextSchema,
  remark: optionalTextSchema,
  isActive: booleanFlagSchema.default(true),
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

/* ---------------------------------------------------------------------- item */

export const itemInputSchema = z
  .object({
    code: codeSchema,
    nameTh: nameThSchema,
    nameEn: optionalTextSchema,
    categoryId: optionalUuidSchema,
    baseUnitId: uuidSchema,
    purchaseUnitId: uuidSchema,
    purchaseConversion: positiveQtySchema.default(1),
    preferredSupplierId: optionalUuidSchema,
    defaultLocationId: optionalUuidSchema,
    minimumStock: nonNegativeQtySchema.default(0),
    reorderPoint: nonNegativeQtySchema.default(0),
    safetyStock: nonNegativeQtySchema.default(0),
    shelfLifeDays: optionalDayCountSchema,
    barcode: optionalTextSchema,
    isActive: booleanFlagSchema.default(true),
    note: optionalTextSchema,
    aliases: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((alias) => alias.trim())
          .filter((alias) => alias.length > 0),
      ),
  })
  .refine((value) => value.baseUnitId !== value.purchaseUnitId || value.purchaseConversion === 1, {
    message: "หน่วยซื้อเท่ากับหน่วยหลัก ตัวคูณต้องเป็น 1",
    path: ["purchaseConversion"],
  });

export type ItemInput = z.infer<typeof itemInputSchema>;

/* ------------------------------------------------------------- supplier item */

/**
 * The supplier-specific way to buy an item: which pack it comes in, how many base
 * units that pack holds, and the ordering constraints the purchase planner must respect.
 */
export const supplierItemInputSchema = z.object({
  supplierId: uuidSchema,
  itemId: uuidSchema,
  supplierItemCode: optionalTextSchema,
  supplierItemName: optionalTextSchema,
  purchaseUnitId: optionalUuidSchema,
  purchaseConversion: optionalPositiveQtySchema,
  moq: nonNegativeQtySchema.default(0),
  packSize: optionalPositiveQtySchema,
  leadTimeDays: optionalDayCountSchema,
  lastPrice: optionalNonNegativeQtySchema,
  isPreferred: booleanFlagSchema.default(false),
  isActive: booleanFlagSchema.default(true),
});

export type SupplierItemInput = z.infer<typeof supplierItemInputSchema>;
