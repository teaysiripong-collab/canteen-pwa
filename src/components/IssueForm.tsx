"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/(app)/stock/actions";

type Option = { id: string; label: string };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn w-full rounded-lg bg-[#1e3a5f] text-white py-3 text-base font-semibold hover:bg-[#2d5580] disabled:opacity-60"
    >
      {pending ? "กำลังบันทึก…" : "✓ ยืนยันเบิก — Stock ลดอัตโนมัติ"}
    </button>
  );
}

export default function IssueForm({
  action,
  ingredientId,
  unitCode,
  lots,
  stockedLocations,
  emptyLocations,
  defaultLocationId,
  defaultLotId,
  todayMenus,
  userName,
  shiftLabels,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  ingredientId: string;
  unitCode: string;
  lots: Option[];
  stockedLocations: Option[];
  emptyLocations: Option[];
  defaultLocationId: string;
  defaultLotId: string;
  todayMenus: Option[];
  userName: string;
  shiftLabels: { morning: string; night: string };
}) {
  const [state, formAction] = useActionState(action, null);

  // React 19 clears an uncontrolled form once its action settles. When the server
  // rejects the entry, the action hands the values back so nothing the user typed
  // is lost — remounting via `key` makes the restored defaults take effect.
  const prev = state?.values;
  const selectCls = "w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white";

  return (
    <form key={state?.stamp ?? "new"} action={formAction} className="space-y-4">
      <input type="hidden" name="ingredientId" value={ingredientId} />

      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-300 text-red-800 text-sm px-4 py-3 whitespace-pre-line">
          🔴 {state.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">จำนวน ({unitCode}) *</span>
          <input name="qty" type="number" step="0.01" min="0.01" required autoFocus
            defaultValue={prev?.qty ?? ""}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-lg text-right" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">กะ</span>
          <select name="shift" defaultValue={prev?.shift ?? "MORNING"} className={selectCls}>
            <option value="MORNING">☀️ {shiftLabels.morning}</option>
            <option value="NIGHT">🌙 {shiftLabels.night}</option>
          </select>
        </label>
      </div>

      <label className="text-sm block">
        <span className="block text-xs text-gray-500 mb-1">Lot (FEFO เลือกให้แล้ว — เปลี่ยนได้)</span>
        <select name="lotId" defaultValue={prev?.lotId ?? defaultLotId} className={selectCls}>
          <option value="">ไม่ระบุ Lot</option>
          {lots.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>

      <label className="text-sm block">
        <span className="block text-xs text-gray-500 mb-1">เบิกจาก Location *</span>
        <select name="locationId" required defaultValue={prev?.locationId ?? defaultLocationId} className={selectCls}>
          <option value="" disabled>เลือก…</option>
          {stockedLocations.length > 0 && (
            <optgroup label="มีของอยู่">
              {stockedLocations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </optgroup>
          )}
          {emptyLocations.length > 0 && (
            <optgroup label="ไม่มีของ">
              {emptyLocations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </optgroup>
          )}
        </select>
      </label>

      <label className="text-sm block">
        <span className="block text-xs text-gray-500 mb-1">ใช้กับเมนู (บันทึก Actual Usage อัตโนมัติ)</span>
        <select name="menuId" defaultValue={prev?.menuId ?? ""} className={selectCls}>
          <option value="">— ไม่ระบุ —</option>
          {todayMenus.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>

      <input name="note" placeholder="หมายเหตุ (ถ้ามี)" defaultValue={prev?.note ?? ""}
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />

      <label className="flex items-start gap-2 text-sm text-gray-600">
        <input type="checkbox" name="force" defaultChecked={prev?.force === "on"} className="w-4 h-4 mt-0.5" />
        <span>ยืนยันเบิกเกินยอดคงเหลือ (ใช้เมื่อของจริงมีแต่ระบบยังไม่ตรง — บันทึกลง Audit Log)</span>
      </label>

      <SubmitButton />
      <p className="text-xs text-gray-400">ผู้เบิก: {userName}</p>
    </form>
  );
}
