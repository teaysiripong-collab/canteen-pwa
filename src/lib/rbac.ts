import type { Role } from "@prisma/client";

// Permission Matrix — which roles can access which module, and at what level.
// view = read-only, edit = create/update, approve = workflow approval, admin = full control

export type ModuleKey =
  | "dashboard" | "menu-plan" | "recipes" | "bom" | "purchase" | "stock"
  | "cost" | "tasks" | "documents" | "reports" | "master" | "settings";

type Access = "none" | "view" | "edit" | "approve" | "admin";

const ALL: Role[] = ["ADMIN", "MANAGER", "SUPERVISOR", "PROCUREMENT", "STORE", "STAFF", "VIEWER"];

export const PERMISSIONS: Record<ModuleKey, Partial<Record<Role, Access>>> = {
  dashboard: Object.fromEntries(ALL.map((r) => [r, "view"])),
  "menu-plan": { ADMIN: "admin", MANAGER: "approve", SUPERVISOR: "edit", PROCUREMENT: "view", STORE: "view", STAFF: "view", VIEWER: "view" },
  recipes: { ADMIN: "admin", MANAGER: "view", SUPERVISOR: "edit", PROCUREMENT: "view", STORE: "view", STAFF: "view", VIEWER: "view" },
  bom: { ADMIN: "admin", MANAGER: "approve", SUPERVISOR: "edit", PROCUREMENT: "view", STORE: "view", VIEWER: "view" },
  purchase: { ADMIN: "admin", MANAGER: "approve", SUPERVISOR: "edit", PROCUREMENT: "edit", STORE: "view", VIEWER: "view" },
  stock: { ADMIN: "admin", MANAGER: "view", SUPERVISOR: "view", PROCUREMENT: "view", STORE: "edit", STAFF: "edit", VIEWER: "view" },
  cost: { ADMIN: "admin", MANAGER: "approve", SUPERVISOR: "view", PROCUREMENT: "edit", VIEWER: "view" },
  tasks: { ADMIN: "admin", MANAGER: "edit", SUPERVISOR: "edit", PROCUREMENT: "edit", STORE: "edit", STAFF: "edit", VIEWER: "view" },
  documents: { ADMIN: "admin", MANAGER: "view", SUPERVISOR: "view", PROCUREMENT: "view", STORE: "view", VIEWER: "view" },
  reports: { ADMIN: "admin", MANAGER: "view", SUPERVISOR: "view", PROCUREMENT: "view", STORE: "view", VIEWER: "view" },
  master: { ADMIN: "admin", MANAGER: "view", SUPERVISOR: "view", PROCUREMENT: "view" },
  settings: { ADMIN: "admin" },
};

export function can(role: Role, module: ModuleKey, level: Access = "view"): boolean {
  const a = PERMISSIONS[module][role] ?? "none";
  const order: Access[] = ["none", "view", "edit", "approve", "admin"];
  return order.indexOf(a) >= order.indexOf(level);
}

export const NAV_ITEMS: { key: ModuleKey; href: string; label: string; icon: string }[] = [
  { key: "dashboard", href: "/", label: "Dashboard", icon: "🏠" },
  { key: "menu-plan", href: "/menu-plan", label: "แผนเมนู", icon: "📅" },
  { key: "recipes", href: "/recipes", label: "คลังสูตรอาหาร", icon: "🍳" },
  { key: "bom", href: "/bom", label: "BOM วัตถุดิบ", icon: "📋" },
  { key: "purchase", href: "/purchase", label: "จัดซื้อ", icon: "🛒" },
  { key: "stock", href: "/stock", label: "Stock", icon: "📦" },
  { key: "cost", href: "/cost", label: "ต้นทุน", icon: "💰" },
  { key: "tasks", href: "/tasks", label: "งานที่มอบหมาย", icon: "✅" },
  { key: "documents", href: "/documents", label: "เอกสาร", icon: "📄" },
  { key: "reports", href: "/reports", label: "รายงาน", icon: "📊" },
  { key: "master", href: "/master", label: "Master Data", icon: "🗂️" },
  { key: "settings", href: "/settings", label: "ตั้งค่า", icon: "⚙️" },
];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการ",
  SUPERVISOR: "หัวหน้างาน",
  PROCUREMENT: "จัดซื้อ",
  STORE: "สโตร์/คลัง",
  STAFF: "พนักงาน",
  VIEWER: "ผู้ชม",
};
