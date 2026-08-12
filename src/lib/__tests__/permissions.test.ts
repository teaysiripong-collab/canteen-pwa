import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLES,
  ROLE_CODES,
  hasPermission,
  isRoleCode,
  permissionsForRoles,
} from "../permissions";

describe("role permissions", () => {
  it("lets staff issue stock but not manage purchase orders", () => {
    const granted = permissionsForRoles([ROLES.STAFF]);
    expect(hasPermission(granted, PERMISSIONS.ISSUE_CREATE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.PO_MANAGE)).toBe(false);
    expect(hasPermission(granted, PERMISSIONS.ITEM_MANAGE)).toBe(false);
  });

  it("gives a store keeper stock adjustment and report access on top of staff", () => {
    const granted = permissionsForRoles([ROLES.STORE]);
    expect(hasPermission(granted, PERMISSIONS.ISSUE_CREATE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.ADJUSTMENT_CREATE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.STOCK_COUNT_CREATE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.REPORT_VIEW)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.PO_APPROVE)).toBe(false);
  });

  it("gives a manager purchasing, BOM and FEFO override", () => {
    const granted = permissionsForRoles([ROLES.MANAGER]);
    expect(hasPermission(granted, PERMISSIONS.PO_APPROVE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.RECIPE_MANAGE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.FEFO_OVERRIDE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.STOCK_COUNT_APPROVE)).toBe(true);
  });

  it("keeps user administration out of every role except admin", () => {
    for (const role of ROLE_CODES.filter((code) => code !== ROLES.ADMIN)) {
      expect(hasPermission(permissionsForRoles([role]), PERMISSIONS.USER_MANAGE)).toBe(false);
    }
    expect(hasPermission(permissionsForRoles([ROLES.ADMIN]), PERMISSIONS.USER_MANAGE)).toBe(true);
  });

  it("gives an admin every permission", () => {
    const granted = permissionsForRoles([ROLES.ADMIN]);
    expect(hasPermission(granted, Object.values(PERMISSIONS))).toBe(true);
  });

  it("merges permissions when a user holds several roles", () => {
    const granted = permissionsForRoles([ROLES.STAFF, ROLES.MANAGER]);
    expect(hasPermission(granted, PERMISSIONS.PO_APPROVE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.ISSUE_CREATE)).toBe(true);
  });

  it("grants nothing for an unknown role", () => {
    expect(permissionsForRoles(["NOT_A_ROLE"])).toEqual([]);
  });

  it("requires every permission when given a list", () => {
    const granted = permissionsForRoles([ROLES.STAFF]);
    expect(hasPermission(granted, [PERMISSIONS.ISSUE_CREATE, PERMISSIONS.PO_APPROVE])).toBe(false);
  });

  it("recognises only the four roadmap role codes", () => {
    expect(ROLE_CODES).toEqual(["STAFF", "STORE", "MANAGER", "ADMIN"]);
    expect(isRoleCode("MANAGER")).toBe(true);
    expect(isRoleCode("SUPERVISOR")).toBe(false);
  });
});
