import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";

/**
 * The guard's whole job is to answer with the right status. `forbidden()` and `unauthorized()`
 * work by throwing a sentinel Next recognises, so the test asserts on which sentinel escaped —
 * a guard that swallowed one would render a 200 page to someone with no right to it.
 */
vi.mock("next/navigation", () => ({
  forbidden: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  }),
  unauthorized: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;401");
  }),
}));

let currentUser: { permissions: PermissionCode[] } | null = null;

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: vi.fn(async () => currentUser),
}));

const { requirePageUser, requirePagePermission } = await import("../page-guard");

beforeEach(() => {
  currentUser = { permissions: [PERMISSIONS.STOCK_VIEW] };
});

describe("requirePageUser", () => {
  it("answers 401 when nobody is signed in", async () => {
    currentUser = null;

    await expect(requirePageUser()).rejects.toThrow("401");
  });

  it("returns the user when signed in", async () => {
    await expect(requirePageUser()).resolves.toBe(currentUser);
  });
});

describe("requirePagePermission", () => {
  it("answers 403 rather than 500 when the permission is missing", async () => {
    await expect(requirePagePermission(PERMISSIONS.SETTINGS_MANAGE)).rejects.toThrow("403");
  });

  it("answers 401 before 403 when nobody is signed in", async () => {
    // Not signed in is a different fact from not allowed, and the fix differs too.
    currentUser = null;

    await expect(requirePagePermission(PERMISSIONS.SETTINGS_MANAGE)).rejects.toThrow("401");
  });

  it("lets a user through when they hold the permission", async () => {
    await expect(requirePagePermission(PERMISSIONS.STOCK_VIEW)).resolves.toBe(currentUser);
  });

  it("requires every permission when given a list", async () => {
    currentUser = { permissions: [PERMISSIONS.STOCK_VIEW, PERMISSIONS.REPORT_VIEW] };

    await expect(
      requirePagePermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.REPORT_EXPORT]),
    ).rejects.toThrow("403");
    await expect(
      requirePagePermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.REPORT_VIEW]),
    ).resolves.toBe(currentUser);
  });
});
