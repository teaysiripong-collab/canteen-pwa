/**
 * Every error surfaced to a user goes through AppError so the UI can show a Thai
 * message and never a raw database error.
 */
export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "INTERNAL";

const DEFAULT_MESSAGES_TH: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: "กรุณาเข้าสู่ระบบก่อนใช้งาน",
  FORBIDDEN: "คุณไม่มีสิทธิ์ทำรายการนี้",
  NOT_FOUND: "ไม่พบข้อมูลที่ต้องการ",
  VALIDATION: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
  CONFLICT: "ข้อมูลนี้ถูกใช้งานอยู่แล้ว",
  INSUFFICIENT_STOCK: "สต๊อกคงเหลือไม่เพียงพอ",
  INTERNAL: "ไม่สามารถบันทึกรายการได้ กรุณาลองใหม่",
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: AppErrorCode,
    message?: string,
    options?: { fieldErrors?: Record<string, string[]>; cause?: unknown },
  ) {
    super(message ?? DEFAULT_MESSAGES_TH[code], { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: AppErrorCode; message: string; fieldErrors?: Record<string, string[]> };

export function actionSuccess(): ActionResult;
export function actionSuccess<T>(data: T): ActionResult<T>;
export function actionSuccess<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

/**
 * Converts anything thrown inside a server action into a safe payload for the client.
 * Unknown errors are logged server-side and replaced with a generic Thai message.
 */
export function toActionError(error: unknown): Extract<ActionResult, { ok: false }> {
  if (error instanceof AppError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      fieldErrors: error.fieldErrors,
    };
  }

  console.error("[unhandled action error]", error);
  return {
    ok: false,
    code: "INTERNAL",
    message: DEFAULT_MESSAGES_TH.INTERNAL,
  };
}

/** Maps Postgres unique-violation errors onto a Thai message instead of leaking SQL. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
