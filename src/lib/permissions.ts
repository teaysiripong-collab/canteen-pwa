/**
 * Permission catalogue. Codes are `module.action` and are the only thing the server
 * checks — roles are just bundles of these codes.
 */
export const PERMISSIONS = {
  // master data
  ITEM_VIEW: "item.view",
  ITEM_MANAGE: "item.manage",
  LOCATION_VIEW: "location.view",
  LOCATION_MANAGE: "location.manage",
  SUPPLIER_VIEW: "supplier.view",
  SUPPLIER_MANAGE: "supplier.manage",

  // menu & recipe
  MENU_VIEW: "menu.view",
  MENU_MANAGE: "menu.manage",
  RECIPE_VIEW: "recipe.view",
  RECIPE_MANAGE: "recipe.manage",

  // inventory
  STOCK_VIEW: "stock.view",
  RECEIVE_CREATE: "receive.create",
  ISSUE_CREATE: "issue.create",
  ISSUE_ADJUST_QTY: "issue.adjust_qty",
  TRANSFER_CREATE: "transfer.create",
  ADJUSTMENT_CREATE: "adjustment.create",
  FEFO_OVERRIDE: "fefo.override",
  STOCK_COUNT_CREATE: "stock_count.create",
  STOCK_COUNT_APPROVE: "stock_count.approve",

  // purchasing
  PO_VIEW: "po.view",
  PO_MANAGE: "po.manage",
  PO_APPROVE: "po.approve",

  // cost & reporting
  COST_VIEW: "cost.view",
  REPORT_VIEW: "report.view",
  REPORT_EXPORT: "report.export",

  // administration
  USER_MANAGE: "user.manage",
  AUDIT_VIEW: "audit.view",
  SETTINGS_MANAGE: "settings.manage",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_LABELS_TH: Record<PermissionCode, string> = {
  [PERMISSIONS.ITEM_VIEW]: "ดูข้อมูลวัตถุดิบ",
  [PERMISSIONS.ITEM_MANAGE]: "จัดการข้อมูลวัตถุดิบ",
  [PERMISSIONS.LOCATION_VIEW]: "ดูข้อมูลสถานที่",
  [PERMISSIONS.LOCATION_MANAGE]: "จัดการข้อมูลสถานที่",
  [PERMISSIONS.SUPPLIER_VIEW]: "ดูข้อมูลผู้ขาย",
  [PERMISSIONS.SUPPLIER_MANAGE]: "จัดการข้อมูลผู้ขาย",
  [PERMISSIONS.MENU_VIEW]: "ดูเมนู",
  [PERMISSIONS.MENU_MANAGE]: "จัดการเมนูและแผนเมนู",
  [PERMISSIONS.RECIPE_VIEW]: "ดูสูตรอาหาร",
  [PERMISSIONS.RECIPE_MANAGE]: "จัดการสูตรอาหาร",
  [PERMISSIONS.STOCK_VIEW]: "ดูสต๊อก",
  [PERMISSIONS.RECEIVE_CREATE]: "รับสินค้า",
  [PERMISSIONS.ISSUE_CREATE]: "เบิกสินค้า",
  [PERMISSIONS.ISSUE_ADJUST_QTY]: "แก้จำนวนตอนเบิก",
  [PERMISSIONS.TRANSFER_CREATE]: "โอนสินค้า",
  [PERMISSIONS.ADJUSTMENT_CREATE]: "ปรับปรุงสต๊อก",
  [PERMISSIONS.FEFO_OVERRIDE]: "เลือก Lot เองแทน FEFO",
  [PERMISSIONS.STOCK_COUNT_CREATE]: "ตรวจนับสต๊อก",
  [PERMISSIONS.STOCK_COUNT_APPROVE]: "อนุมัติผลตรวจนับ",
  [PERMISSIONS.PO_VIEW]: "ดูใบสั่งซื้อ",
  [PERMISSIONS.PO_MANAGE]: "จัดการใบสั่งซื้อ",
  [PERMISSIONS.PO_APPROVE]: "อนุมัติใบสั่งซื้อ",
  [PERMISSIONS.COST_VIEW]: "ดูต้นทุน",
  [PERMISSIONS.REPORT_VIEW]: "ดูรายงาน",
  [PERMISSIONS.REPORT_EXPORT]: "ส่งออกรายงาน",
  [PERMISSIONS.USER_MANAGE]: "จัดการผู้ใช้และสิทธิ์",
  [PERMISSIONS.AUDIT_VIEW]: "ดู Audit Log",
  [PERMISSIONS.SETTINGS_MANAGE]: "จัดการการตั้งค่า",
};

export const PERMISSION_MODULES: Record<PermissionCode, string> = Object.fromEntries(
  Object.values(PERMISSIONS).map((code) => [code, code.split(".")[0]!]),
) as Record<PermissionCode, string>;

export const ROLES = {
  STAFF: "STAFF",
  STORE: "STORE",
  MANAGER: "MANAGER",
  ADMIN: "ADMIN",
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

/** Frontline kitchen staff: they move stock, they never maintain master data. */
const STAFF_PERMISSIONS: PermissionCode[] = [
  PERMISSIONS.ITEM_VIEW,
  PERMISSIONS.LOCATION_VIEW,
  PERMISSIONS.SUPPLIER_VIEW,
  PERMISSIONS.MENU_VIEW,
  PERMISSIONS.RECIPE_VIEW,
  PERMISSIONS.STOCK_VIEW,
  PERMISSIONS.RECEIVE_CREATE,
  PERMISSIONS.ISSUE_CREATE,
  PERMISSIONS.TRANSFER_CREATE,
];

/** Store keepers own the stockroom: adjustments, counts and the purchasing paperwork they receive against. */
const STORE_PERMISSIONS: PermissionCode[] = [
  ...STAFF_PERMISSIONS,
  PERMISSIONS.ISSUE_ADJUST_QTY,
  PERMISSIONS.ADJUSTMENT_CREATE,
  PERMISSIONS.STOCK_COUNT_CREATE,
  PERMISSIONS.PO_VIEW,
  PERMISSIONS.REPORT_VIEW,
];

/** Managers plan and approve: master data, menus, BOM, purchasing and cost. */
const MANAGER_PERMISSIONS: PermissionCode[] = [
  ...STORE_PERMISSIONS,
  PERMISSIONS.ITEM_MANAGE,
  PERMISSIONS.LOCATION_MANAGE,
  PERMISSIONS.SUPPLIER_MANAGE,
  PERMISSIONS.MENU_MANAGE,
  PERMISSIONS.RECIPE_MANAGE,
  PERMISSIONS.FEFO_OVERRIDE,
  PERMISSIONS.STOCK_COUNT_APPROVE,
  PERMISSIONS.PO_MANAGE,
  PERMISSIONS.PO_APPROVE,
  PERMISSIONS.COST_VIEW,
  PERMISSIONS.REPORT_EXPORT,
];

const ADMIN_PERMISSIONS: PermissionCode[] = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  [ROLES.STAFF]: STAFF_PERMISSIONS,
  [ROLES.STORE]: STORE_PERMISSIONS,
  [ROLES.MANAGER]: MANAGER_PERMISSIONS,
  [ROLES.ADMIN]: ADMIN_PERMISSIONS,
};

export const ROLE_LABELS_TH: Record<RoleCode, string> = {
  [ROLES.STAFF]: "พนักงานหน้างาน",
  [ROLES.STORE]: "พนักงานคลัง",
  [ROLES.MANAGER]: "ผู้จัดการโรงอาหาร",
  [ROLES.ADMIN]: "ผู้ดูแลระบบ",
};

export const ROLE_RANKS: Record<RoleCode, number> = {
  [ROLES.STAFF]: 10,
  [ROLES.STORE]: 20,
  [ROLES.MANAGER]: 30,
  [ROLES.ADMIN]: 40,
};

export const ROLE_CODES = Object.values(ROLES);

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}

export function hasPermission(
  granted: readonly string[],
  required: PermissionCode | PermissionCode[],
): boolean {
  const list = Array.isArray(required) ? required : [required];
  return list.every((code) => granted.includes(code));
}

export function hasAnyPermission(
  granted: readonly string[],
  required: readonly PermissionCode[],
): boolean {
  return required.some((code) => granted.includes(code));
}

export function permissionsForRoles(roleCodes: readonly string[]): PermissionCode[] {
  const set = new Set<PermissionCode>();
  for (const roleCode of roleCodes) {
    for (const permission of ROLE_PERMISSIONS[roleCode as RoleCode] ?? []) {
      set.add(permission);
    }
  }
  return [...set];
}
