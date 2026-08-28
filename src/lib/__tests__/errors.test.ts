import { describe, expect, it } from "vitest";
import { AppError, httpStatusFor, toActionError } from "../errors";

describe("httpStatusFor", () => {
  it("separates not-allowed from broken", () => {
    expect(httpStatusFor(new AppError("FORBIDDEN"))).toBe(403);
    expect(httpStatusFor(new AppError("UNAUTHENTICATED"))).toBe(401);
    expect(httpStatusFor(new AppError("NOT_FOUND"))).toBe(404);
    expect(httpStatusFor(new AppError("VALIDATION"))).toBe(400);
  });

  it("treats a stock shortfall as a conflict, not a bad request", () => {
    // The request was well formed; the world just changed underneath it.
    expect(httpStatusFor(new AppError("INSUFFICIENT_STOCK"))).toBe(409);
  });

  it("falls back to 500 for anything that is not an AppError", () => {
    expect(httpStatusFor(new Error("boom"))).toBe(500);
    expect(httpStatusFor("boom")).toBe(500);
  });
});

describe("toActionError", () => {
  it("passes an AppError message through to the client", () => {
    const result = toActionError(new AppError("FORBIDDEN"));

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(result.message).toContain("ไม่มีสิทธิ์");
  });

  it("never leaks an unexpected error's message", () => {
    const result = toActionError(new Error('duplicate key value violates "users_email_key"'));

    expect(result.code).toBe("INTERNAL");
    expect(result.message).not.toContain("users_email_key");
  });
});
