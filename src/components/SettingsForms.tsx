"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { SettingsState } from "@/app/(app)/settings/actions";

type Action = (prev: SettingsState, fd: FormData) => Promise<SettingsState>;

export const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
export const selectCls = inputCls + " bg-white";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="btn inline-flex items-center justify-center rounded-lg bg-[#1e3a5f] text-white px-4 py-2 text-sm font-semibold hover:bg-[#2d5580] disabled:opacity-60">
      {pending ? "กำลังบันทึก…" : label}
    </button>
  );
}

function Result({ state }: { state: SettingsState }) {
  if (!state?.message && !state?.error) return null;
  const bad = !!state.error;
  return (
    <div className={`rounded-lg text-sm px-4 py-2.5 border ${
      bad ? "bg-red-50 border-red-300 text-red-800" : "bg-green-50 border-green-300 text-green-800"
    }`}>
      {bad ? "🔴 " : "🟢 "}{state.error ?? state.message}
    </div>
  );
}

/** Generic settings form: children are the fields, this adds submit + result. */
export function SettingsForm({
  action, label, children, className = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
}: {
  action: Action; label: string; children: React.ReactNode; className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <Result state={state} />
      <div className={className}>{children}</div>
      <Submit label={label} />
    </form>
  );
}

export function EmployeeForm({
  action, label, roles, defaults, requireCredentials,
}: {
  action: Action;
  label: string;
  roles: { value: string; label: string }[];
  requireCredentials: boolean;
  defaults?: {
    employeeCode?: string | null; username?: string; name?: string; nickname?: string | null;
    department?: string | null; phone?: string | null; startDate?: string | null;
    role?: string; active?: boolean;
  };
}) {
  const [state, formAction] = useActionState(action, null);
  const d = defaults ?? {};
  return (
    <form action={formAction} className="space-y-3">
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">รหัสพนักงาน</span>
          <input name="employeeCode" defaultValue={d.employeeCode ?? ""} placeholder="เว้นว่าง = ออกให้อัตโนมัติ"
            className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">ชื่อ-นามสกุล *</span>
          <input name="name" required defaultValue={d.name ?? ""} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">ชื่อเล่น</span>
          <input name="nickname" defaultValue={d.nickname ?? ""} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">แผนก / หน้าที่</span>
          <input name="department" defaultValue={d.department ?? ""} placeholder="เช่น ครัวร้อน" className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">เบอร์โทร</span>
          <input name="phone" defaultValue={d.phone ?? ""} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">วันที่เริ่มงาน</span>
          <input name="startDate" type="date" defaultValue={d.startDate ?? ""} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">บทบาทในระบบ *</span>
          <select name="role" defaultValue={d.role ?? "STAFF"} className={selectCls}>
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className="text-sm flex items-center gap-2 pt-5">
          <input type="checkbox" name="active" defaultChecked={d.active ?? true} className="w-4 h-4" />
          <span>ยังทำงานอยู่</span>
        </label>

        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">
            ชื่อผู้ใช้ (สำหรับล็อกอิน){requireCredentials ? " *" : ""}
          </span>
          <input name="username" required={requireCredentials} defaultValue={d.username ?? ""}
            disabled={!requireCredentials}
            className={inputCls + (requireCredentials ? "" : " bg-gray-100 text-gray-500")} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">
            {requireCredentials ? "รหัสผ่าน *" : "รหัสผ่านใหม่ (เว้นว่าง = ไม่เปลี่ยน)"}
          </span>
          <input name="password" type="password" required={requireCredentials} className={inputCls} />
        </label>
      </div>
      <Submit label={label} />
    </form>
  );
}
