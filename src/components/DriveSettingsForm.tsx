"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { DriveActionState } from "@/app/(app)/settings/drive/actions";

type Action = (prev: DriveActionState, fd: FormData) => Promise<DriveActionState>;

function Submit({ label, variant = "primary" }: { label: string; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "bg-[#1e3a5f] text-white hover:bg-[#2d5580]"
      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
  return (
    <button type="submit" disabled={pending}
      className={`btn inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${cls}`}>
      {pending ? "กำลังทำงาน…" : label}
    </button>
  );
}

function Result({ state }: { state: DriveActionState }) {
  if (!state?.message) return null;
  return (
    <div className={`rounded-lg text-sm px-4 py-3 mt-3 whitespace-pre-line border ${
      state.ok ? "bg-green-50 border-green-300 text-green-800" : "bg-red-50 border-red-300 text-red-800"
    }`}>
      {state.ok ? "🟢 " : "🔴 "}{state.message}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono";

export function SaveSettingsForm({
  action, cost, template, docs, autoUpload,
}: {
  action: Action; cost: string; template: string; docs: string; autoUpload: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-sm">
        <span className="block text-xs text-gray-500 mb-1">โฟลเดอร์เก็บไฟล์ต้นทุน (Cost Working File)</span>
        <input name="costFolderId" defaultValue={cost} placeholder="เช่น 1AbC...xyz" className={inputCls} />
      </label>
      <label className="block text-sm">
        <span className="block text-xs text-gray-500 mb-1">โฟลเดอร์ที่เก็บ Excel Template เดิมขององค์กร</span>
        <input name="templateFolderId" defaultValue={template} placeholder="เช่น 1AbC...xyz" className={inputCls} />
      </label>
      <label className="block text-sm">
        <span className="block text-xs text-gray-500 mb-1">โฟลเดอร์เก็บเอกสารอื่น (ใบสั่งซื้อ ฯลฯ)</span>
        <input name="docsFolderId" defaultValue={docs} placeholder="เช่น 1AbC...xyz" className={inputCls} />
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" name="autoUpload" defaultChecked={autoUpload} className="w-4 h-4 mt-0.5" />
        <span>อัปโหลดไฟล์ต้นทุนขึ้น Drive อัตโนมัติเมื่อสร้าง Cost Working File</span>
      </label>
      <Submit label="💾 บันทึกการตั้งค่า" />
      <Result state={state} />
    </form>
  );
}

export function TestFolderForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-wrap gap-2 items-end">
      <label className="text-sm flex-1 min-w-56">
        <span className="block text-xs text-gray-500 mb-1">Folder ID ที่ต้องการทดสอบ</span>
        <input name="folderId" required placeholder="วาง Folder ID แล้วกดทดสอบ" className={inputCls} />
      </label>
      <Submit label="🔍 ทดสอบการเชื่อมต่อ" variant="secondary" />
      <div className="w-full"><Result state={state} /></div>
    </form>
  );
}

export function ImportTemplateForm({
  action, files,
}: {
  action: Action;
  files: { id: string; name: string; modifiedTime?: string; webViewLink?: string }[];
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-3">
      <label className="block text-sm">
        <span className="block text-xs text-gray-500 mb-1">เลือกไฟล์ Template จากโฟลเดอร์ที่ตั้งค่าไว้</span>
        <select name="fileId" required defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          onChange={(e) => {
            const form = e.currentTarget.form;
            const opt = e.currentTarget.selectedOptions[0];
            if (form) (form.elements.namedItem("fileName") as HTMLInputElement).value = opt?.dataset.name ?? "";
          }}>
          <option value="" disabled>เลือกไฟล์…</option>
          {files.map((f) => (
            <option key={f.id} value={f.id} data-name={f.name}>{f.name}</option>
          ))}
        </select>
      </label>
      <input type="hidden" name="fileName" />
      <label className="block text-sm max-w-40">
        <span className="block text-xs text-gray-500 mb-1">หัวตารางอยู่แถวที่</span>
        <input name="headerRow" type="number" min="1" defaultValue={1}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </label>
      <Submit label="📥 อ่าน Template และสร้าง Mapping" />
      <Result state={state} />
    </form>
  );
}
