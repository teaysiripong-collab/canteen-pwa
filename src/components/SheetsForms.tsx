"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { SheetsState } from "@/app/(app)/settings/sheets/actions";

type Action = (prev: SheetsState, fd: FormData) => Promise<SheetsState>;

function Submit({ label, busy, variant = "primary" }: { label: string; busy: string; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "bg-[#1e3a5f] text-white hover:bg-[#2d5580]"
      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
  return (
    <button type="submit" disabled={pending}
      className={`btn inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${cls}`}>
      {pending ? busy : label}
    </button>
  );
}

function Result({ state }: { state: SheetsState }) {
  if (!state) return null;
  const report = state.report;

  if (report) {
    const created = Object.values(report.created).reduce((a, b) => a + b, 0);
    const updated = Object.values(report.updated).reduce((a, b) => a + b, 0);
    return (
      <div className="mt-3 space-y-2">
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          report.issues.length > 0
            ? "bg-red-50 border-red-300 text-red-800"
            : report.dryRun
              ? "bg-sky-50 border-sky-300 text-sky-900"
              : "bg-green-50 border-green-300 text-green-800"
        }`}>
          {report.issues.length > 0 ? (
            <><b>🔴 พบ {report.issues.length} แถวที่มีปัญหา — ยังไม่ได้บันทึกอะไร</b>
              <div className="text-xs mt-1">แก้ใน Google Sheets แล้วกดดึงข้อมูลอีกครั้ง</div></>
          ) : report.dryRun ? (
            <><b>🔵 ตรวจสอบผ่าน — ยังไม่ได้บันทึก</b>
              <div className="text-xs mt-1">จะเพิ่มใหม่ {created} รายการ, อัปเดต {updated} รายการ — เอาเครื่องหมายออกแล้วกดอีกครั้งเพื่อบันทึกจริง</div></>
          ) : (
            <><b>🟢 ดึงข้อมูลเข้าระบบแล้ว</b> — เพิ่มใหม่ {created}, อัปเดต {updated} รายการ</>
          )}
        </div>
        {report.issues.length > 0 && (
          <div className="max-h-72 overflow-y-auto border border-red-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-red-50">
                <tr className="text-left text-red-800 border-b border-red-200">
                  <th className="py-2 px-3">แท็บ</th><th className="py-2 px-3">แถวที่</th><th className="py-2 px-3">ปัญหา</th>
                </tr>
              </thead>
              <tbody>
                {report.issues.map((iss, i) => (
                  <tr key={i} className="border-b border-red-100 last:border-0">
                    <td className="py-2 px-3 whitespace-nowrap">{iss.sheet}</td>
                    <td className="py-2 px-3 font-mono">{iss.row}</td>
                    <td className="py-2 px-3">{iss.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (!state.message) return null;
  return (
    <div className={`rounded-lg text-sm px-4 py-3 mt-3 border ${
      state.ok ? "bg-green-50 border-green-300 text-green-800" : "bg-red-50 border-red-300 text-red-800"
    }`}>
      {state.ok ? "🟢 " : "🔴 "}{state.message}
      {state.url && (
        <a href={state.url} target="_blank" rel="noreferrer" className="ml-2 underline font-medium">เปิดใน Google Sheets ↗</a>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono";

export function LinkSheetForm({ action, spreadsheetId, autoPush }: {
  action: Action; spreadsheetId: string; autoPush: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-sm">
        <span className="block text-xs text-gray-500 mb-1">Spreadsheet ID หรือวาง URL ทั้งอันก็ได้</span>
        <input name="spreadsheetId" defaultValue={spreadsheetId}
          placeholder="https://docs.google.com/spreadsheets/d/…" className={inputCls} />
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" name="autoPush" defaultChecked={autoPush} className="w-4 h-4 mt-0.5" />
        <span>ส่งข้อมูลขึ้น Sheets อัตโนมัติทุกครั้งที่มีการเปลี่ยนแปลงสำคัญ</span>
      </label>
      <Submit label="💾 บันทึก" busy="กำลังบันทึก…" />
      <Result state={state} />
    </form>
  );
}

export function TestSheetForm({ action, spreadsheetId }: { action: Action; spreadsheetId: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-wrap gap-2 items-end">
      <input type="hidden" name="spreadsheetId" value={spreadsheetId} />
      <Submit label="🔍 ทดสอบการเชื่อมต่อ" busy="กำลังตรวจสอบ…" variant="secondary" />
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}

export function CreateSheetForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-wrap gap-2 items-end">
      <label className="text-sm flex-1 min-w-56">
        <span className="block text-xs text-gray-500 mb-1">ชื่อไฟล์</span>
        <input name="title" defaultValue="Canteen Management System — ฐานข้อมูล"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </label>
      <Submit label="✨ สร้างไฟล์ใหม่ให้เลย" busy="กำลังสร้าง…" />
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}

export function PushForm({ action }: { action: () => Promise<SheetsState> }) {
  const [state, formAction] = useActionState(async () => action(), null);
  return (
    <form action={formAction}>
      <Submit label="⬆ ส่งข้อมูลขึ้น Sheets เดี๋ยวนี้" busy="กำลังส่ง…" />
      <Result state={state} />
    </form>
  );
}

export function PullForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" name="dryRun" defaultChecked className="w-4 h-4 mt-0.5" />
        <span><b>ตรวจสอบอย่างเดียว (ไม่บันทึก)</b> — แนะนำให้ทำรอบแรกเสมอ</span>
      </label>
      <Submit label="⬇ ดึงข้อมูลจาก Sheets เข้าระบบ" busy="กำลังดึง…" variant="secondary" />
      <Result state={state} />
    </form>
  );
}
