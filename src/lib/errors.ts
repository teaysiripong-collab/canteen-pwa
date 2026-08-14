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

const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  INTERNAL: 500,
};

/**
 * The HTTP status a route handler should answer with.
 *
 * Kept beside the codes so a new error code cannot quietly default to 500 — "the server is
 * broken" and "you may not do that" are different facts, and monitoring reads the difference.
 */
export function httpStatusFor(error: unknown): number {
  return error instanceof AppError ? HTTP_STATUS[error.code] : 500;
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
