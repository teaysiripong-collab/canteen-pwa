import { z } from "zod";
import { ROLE_CODES } from "@/lib/permissions";
import { booleanFlagSchema, nameThSchema, optionalUuidSchema } from "./common";

const roleCodeSchema = z.enum(ROLE_CODES as [string, ...string[]], {
  errorMap: () => ({ message: "บทบาทไม่ถูกต้อง" }),
});

export const userInputSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "กรุณากรอกอีเมล")
    .email("รูปแบบอีเมลไม่ถูกต้อง")
    .max(200, "อีเมลยาวเกินไป")
    .transform((value) => value.toLowerCase()),
  fullName: nameThSchema,
  phone: z
    .string()
    .trim()
    .max(30, "เบอร์โทรยาวเกินไป")
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
  defaultLocationId: optionalUuidSchema,
  /** At least one role, otherwise the account could sign in with no permissions at all. */
  roleCodes: z.array(roleCodeSchema).min(1, "กรุณาเลือกอย่างน้อย 1 บทบาท"),
  isActive: booleanFlagSchema.default(true),
});

export type UserInput = z.infer<typeof userInputSchema>;
