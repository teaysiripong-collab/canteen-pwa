import { z } from "zod";

export const uuidSchema = z.string().uuid("รหัสอ้างอิงไม่ถูกต้อง");

export const codeSchema = z
  .string()
  .trim()
  .min(1, "กรุณากรอกรหัส")
  .max(32, "รหัสยาวเกินไป")
  .regex(/^[A-Za-z0-9_-]+$/, "รหัสใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข - และ _");

export const nameThSchema = z.string().trim().min(1, "กรุณากรอกชื่อ").max(200, "ชื่อยาวเกินไป");

export const optionalTextSchema = z
  .string()
  .trim()
  .max(500, "ข้อความยาวเกินไป")
  .optional()
  .transform((value) => (value === "" ? undefined : value));

/** Accepts the string that an <input type="number"> posts and validates it as a quantity. */
export const nonNegativeQtySchema = z.coerce
  .number({ invalid_type_error: "กรุณากรอกตัวเลข" })
  .min(0, "ต้องไม่ติดลบ")
  .max(99_999_999, "ตัวเลขมากเกินไป");

export const positiveQtySchema = z.coerce
  .number({ invalid_type_error: "กรุณากรอกตัวเลข" })
  .positive("ต้องมากกว่า 0")
  .max(99_999_999, "ตัวเลขมากเกินไป");

export const optionalUuidSchema = z
  .union([uuidSchema, z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? null : value));

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "inactive"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});

export type ListQuery = z.infer<typeof listQuerySchema>;
