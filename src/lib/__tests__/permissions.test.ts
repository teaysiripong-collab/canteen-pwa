import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, hasPermission, permissionsForRoles } from "../permissions";

describe("role permissions", () => {
  it("lets frontline staff issue stock but not manage purchase orders", () => {
    const granted = permissionsForRoles([ROLES.FRONTLINE]);
    expect(hasPermission(granted, PERMISSIONS.ISSUE_CREATE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.PO_MANAGE)).toBe(false);
    expect(hasPermission(granted, PERMISSIONS.ITEM_MANAGE)).toBe(false);
  });

  it("gives a leader stock adjustment and report access on top of frontline", () => {
    const granted = permissionsForRoles([ROLES.LEADER]);
    expect(hasPermission(granted, PERMISSIONS.ISSUE_CREATE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.ADJUSTMENT_CREATE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.REPORT_VIEW)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.PO_APPROVE)).toBe(false);
  });

  it("gives a supervisor purchasing, BOM and FEFO override", () => {
    const granted = permissionsForRoles([ROLES.SUPERVISOR]);
    expect(hasPermission(granted, PERMISSIONS.PO_APPROVE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.RECIPE_MANAGE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.FEFO_OVERRIDE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.USER_MANAGE)).toBe(false);
  });

  it("gives an admin every permission", () => {
    const granted = permissionsForRoles([ROLES.ADMIN]);
    expect(hasPermission(granted, Object.values(PERMISSIONS))).toBe(true);
  });

  it("merges permissions when a user holds several roles", () => {
    const granted = permissionsForRoles([ROLES.FRONTLINE, ROLES.SUPERVISOR]);
    expect(hasPermission(granted, PERMISSIONS.PO_APPROVE)).toBe(true);
    expect(hasPermission(granted, PERMISSIONS.ISSUE_CREATE)).toBe(true);
  });

  it("grants nothing for an unknown role", () => {
    expect(permissionsForRoles(["NOT_A_ROLE"])).toEqual([]);
  });

  it("requires every permission when given a list", () => {
    const granted = permissionsForRoles([ROLES.FRONTLINE]);
    expect(hasPermission(granted, [PERMISSIONS.ISSUE_CREATE, PERMISSIONS.PO_APPROVE])).toBe(false);
  });
});
