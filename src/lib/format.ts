import type { PlanStatus, PoStatus, Shift, TaskStatus, TaskPriority } from "@prisma/client";

export function fmtDate(dt: Date | string | null | undefined): string {
  if (!dt) return "-";
  const date = typeof dt === "string" ? new Date(dt) : dt;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtDateShort(dt: Date | string): string {
  const date = typeof dt === "string" ? new Date(dt) : dt;
  return date.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtDateTime(dt: Date | string | null | undefined): string {
  if (!dt) return "-";
  const date = typeof dt === "string" ? new Date(dt) : dt;
  return date.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

export function fmtNum(n: number | string | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return "-";
  const v = typeof n === "string" ? parseFloat(n) : n;
  return v.toLocaleString("th-TH", { maximumFractionDigits: digits });
}

export function fmtBaht(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return "-";
  const v = typeof n === "string" ? parseFloat(n) : n;
  return "฿" + v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ymd(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** Monday of the week containing `dt` (UTC-based dates) */
export function mondayOf(dt: Date): Date {
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(dt);
  m.setUTCDate(m.getUTCDate() + diff);
  m.setUTCHours(0, 0, 0, 0);
  return m;
}

export const SHIFT_LABEL: Record<Shift, string> = { MORNING: "รอบเช้า", NIGHT: "รอบดึก" };

export const PLAN_STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-gray-100 text-gray-700" },
  SUBMITTED: { label: "รอตรวจสอบ", cls: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "อนุมัติแล้ว", cls: "bg-green-100 text-green-800" },
};

export const PO_STATUS: Record<PoStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-gray-100 text-gray-700" },
  REVIEWED: { label: "ตรวจสอบแล้ว", cls: "bg-sky-100 text-sky-800" },
  APPROVED: { label: "อนุมัติแล้ว", cls: "bg-indigo-100 text-indigo-800" },
  ORDERED: { label: "สั่งแล้ว", cls: "bg-blue-100 text-blue-800" },
  PARTIAL: { label: "ส่งไม่ครบ", cls: "bg-red-100 text-red-800" },
  RECEIVED: { label: "รับของแล้ว", cls: "bg-green-100 text-green-800" },
  COMPLETED: { label: "เสร็จสิ้น", cls: "bg-green-100 text-green-800" },
  CANCELLED: { label: "ยกเลิก", cls: "bg-gray-200 text-gray-500" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; cls: string }> = {
  NOT_STARTED: { label: "ยังไม่เริ่ม", cls: "bg-gray-100 text-gray-700" },
  IN_PROGRESS: { label: "กำลังทำ", cls: "bg-amber-100 text-amber-800" },
  COMPLETED: { label: "เสร็จแล้ว", cls: "bg-green-100 text-green-800" },
  CANCELLED: { label: "ยกเลิก", cls: "bg-gray-200 text-gray-500" },
};

export const TASK_PRIORITY: Record<TaskPriority, { label: string; cls: string }> = {
  LOW: { label: "ต่ำ", cls: "bg-gray-100 text-gray-600" },
  NORMAL: { label: "ปกติ", cls: "bg-sky-100 text-sky-700" },
  HIGH: { label: "สูง", cls: "bg-amber-100 text-amber-800" },
  URGENT: { label: "ด่วน", cls: "bg-red-100 text-red-800" },
};
