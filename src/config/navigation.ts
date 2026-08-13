import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
  /** Hidden when the user lacks this permission; the page still re-checks on the server. */
  permission?: PermissionCode;
  /** Modules that arrive in a later phase are shown as disabled so the roadmap is visible. */
  phase?: 2 | 3 | 4 | 5 | 6;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/** Desktop sidebar (Supervisor / Admin control centre). */
export const SIDEBAR_GROUPS: NavGroup[] = [
  {
    label: "ภาพรวม",
    items: [{ label: "แดชบอร์ด", href: "/dashboard" }],
  },
  {
    label: "เมนู",
    items: [
      { label: "แผนเมนู", href: "/menu/planner", permission: PERMISSIONS.MENU_VIEW, phase: 2 },
      { label: "รายการเมนู", href: "/menu/master", permission: PERMISSIONS.MENU_VIEW, phase: 2 },
      { label: "สูตรอาหาร / BOM", href: "/menu/recipes", permission: PERMISSIONS.RECIPE_VIEW, phase: 2 },
    ],
  },
  {
    label: "คลังสินค้า",
    items: [
      { label: "สต๊อกคงเหลือ", href: "/inventory/stock", permission: PERMISSIONS.STOCK_VIEW },
      { label: "บัญชีเคลื่อนไหว", href: "/inventory/movements", permission: PERMISSIONS.STOCK_VIEW },
      { label: "รับสินค้า", href: "/inventory/receiving", permission: PERMISSIONS.RECEIVE_CREATE, phase: 4 },
      { label: "เบิกสินค้า", href: "/inventory/issue", permission: PERMISSIONS.ISSUE_CREATE, phase: 4 },
      { label: "โอนสินค้า", href: "/inventory/transfer", permission: PERMISSIONS.TRANSFER_CREATE, phase: 4 },
      { label: "ตรวจนับสต๊อก", href: "/inventory/count", permission: PERMISSIONS.STOCK_COUNT_CREATE, phase: 5 },
      { label: "ของใกล้หมดอายุ", href: "/inventory/expiry", permission: PERMISSIONS.STOCK_VIEW },
    ],
  },
  {
    label: "จัดซื้อ",
    items: [
      { label: "ใบสั่งซื้อ", href: "/purchasing/orders", permission: PERMISSIONS.PO_VIEW, phase: 4 },
      { label: "ผู้ขาย", href: "/suppliers", permission: PERMISSIONS.SUPPLIER_VIEW },
    ],
  },
  {
    label: "ข้อมูลหลัก",
    items: [
      { label: "วัตถุดิบ", href: "/items", permission: PERMISSIONS.ITEM_VIEW },
      { label: "สถานที่", href: "/locations", permission: PERMISSIONS.LOCATION_VIEW },
    ],
  },
  {
    label: "ต้นทุน",
    items: [
      { label: "ต้นทุนรายวัน", href: "/cost/daily", permission: PERMISSIONS.COST_VIEW, phase: 5 },
      { label: "ต้นทุนต่อเมนู", href: "/cost/menu", permission: PERMISSIONS.COST_VIEW, phase: 5 },
      { label: "ประวัติราคา", href: "/cost/price-history", permission: PERMISSIONS.COST_VIEW, phase: 5 },
    ],
  },
  {
    label: "ระบบ",
    items: [
      { label: "รายงาน", href: "/reports", permission: PERMISSIONS.REPORT_VIEW, phase: 5 },
      { label: "ผู้ใช้งาน", href: "/users", permission: PERMISSIONS.USER_MANAGE },
      { label: "Audit Log", href: "/audit-log", permission: PERMISSIONS.AUDIT_VIEW },
      { label: "ตั้งค่า", href: "/settings", permission: PERMISSIONS.SETTINGS_MANAGE, phase: 2 },
    ],
  },
];

export type MobileNavItem = NavItem & { icon: "home" | "receive" | "issue" | "transfer" | "stock" };

/** Mobile bottom navigation: the four things frontline staff do all day, plus home. */
export const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { label: "หน้าหลัก", href: "/dashboard", icon: "home" },
  { label: "รับของ", href: "/inventory/receiving", icon: "receive", permission: PERMISSIONS.RECEIVE_CREATE, phase: 4 },
  { label: "เบิกของ", href: "/inventory/issue", icon: "issue", permission: PERMISSIONS.ISSUE_CREATE, phase: 4 },
  { label: "โอนของ", href: "/inventory/transfer", icon: "transfer", permission: PERMISSIONS.TRANSFER_CREATE, phase: 4 },
  { label: "เช็กสต๊อก", href: "/inventory/stock", icon: "stock", permission: PERMISSIONS.STOCK_VIEW },
];

export function visibleNavItems<T extends NavItem>(items: T[], granted: readonly string[]): T[] {
  return items.filter((item) => !item.permission || granted.includes(item.permission));
}
