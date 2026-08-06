"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ImportState } from "@/app/(app)/master/import/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="btn inline-flex items-center justify-center rounded-lg bg-[#1e3a5f] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[#2d5580] disabled:opacity-60">
      {pending ? "กำลังประมวลผล…" : "▶ เริ่มนำเข้า"}
    </button>
  );
}

export default function ImportForm({
  action, driveFiles,
}: {
  action: (prev: ImportState, fd: FormData) => Promise<ImportState>;
  driveFiles: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(action, null);
  const report = state?.report;
  const totalCreated = report ? Object.values(report.created).reduce((a, b) => a + b, 0) : 0;
  const totalUpdated = report ? Object.values(report.updated).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <label className="block text-sm">
          <span className="block text-xs text-gray-500 mb-1">ไฟล์ Excel (.xlsx)</span>
          <input type="file" name="file" accept=".xlsx,.xlsm"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm" />
        </label>

        {driveFiles.length > 0 && (
          <label className="block text-sm">
            <span className="block text-xs text-gray-500 mb-1">หรือเลือกจาก Google Drive</span>
            <select name="driveFileId" defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
              <option value="">— ไม่ใช้ Drive —</option>
              {driveFiles.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" name="dryRun" defaultChecked className="w-4 h-4 mt-0.5" />
          <span>
            <b>ตรวจสอบอย่างเดียว (ไม่บันทึก)</b> — แนะนำให้ทำรอบแรกเสมอ เพื่อดูว่าข้อมูลถูกต้องก่อนบันทึกจริง
          </span>
        </label>

        <Submit />
      </form>

      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-300 text-red-800 text-sm px-4 py-3">
          🔴 {state.error}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            report.issues.length > 0
              ? "bg-red-50 border-red-300 text-red-800"
              : report.dryRun
                ? "bg-sky-50 border-sky-300 text-sky-900"
                : "bg-green-50 border-green-300 text-green-800"
          }`}>
            {report.issues.length > 0 ? (
              <>
                🔴 <b>พบ {report.issues.length} แถวที่มีปัญหา — ยังไม่ได้บันทึกอะไรลงระบบ</b>
                <div className="text-xs mt-1">แก้ไขในไฟล์ Excel แล้วอัปโหลดใหม่ (ระบบทำแบบทั้งหมดหรือไม่ทำเลย)</div>
              </>
            ) : report.dryRun ? (
              <>
                🔵 <b>ตรวจสอบผ่าน — ยังไม่ได้บันทึก</b>
                <div className="text-xs mt-1">
                  ถ้าผลลัพธ์ถูกต้อง ให้เอาเครื่องหมาย &quot;ตรวจสอบอย่างเดียว&quot; ออก แล้วกดนำเข้าอีกครั้ง
                </div>
              </>
            ) : (
              <>🟢 <b>นำเข้าสำเร็จ</b> — เพิ่มใหม่ {totalCreated} รายการ, อัปเดต {totalUpdated} รายการ</>
            )}
          </div>

          {(Object.keys(report.created).length > 0 || Object.keys(report.updated).length > 0) && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2">ประเภทข้อมูล</th>
                    <th className="py-2 text-right">เพิ่มใหม่</th>
                    <th className="py-2 text-right">อัปเดตของเดิม</th>
                  </tr>
                </thead>
                <tbody>
                  {[...new Set([...Object.keys(report.created), ...Object.keys(report.updated)])].map((k) => (
                    <tr key={k} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 font-medium">{k}</td>
                      <td className="py-2 text-right text-green-700">{report.created[k] ?? 0}</td>
                      <td className="py-2 text-right text-sky-700">{report.updated[k] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.issues.length > 0 && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-red-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-red-50">
                  <tr className="text-left text-red-800 border-b border-red-200">
                    <th className="py-2 px-3">ชีต</th>
                    <th className="py-2 px-3">แถวที่</th>
                    <th className="py-2 px-3">ปัญหา</th>
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

          {report.skippedSheets.length > 0 && (
            <p className="text-xs text-gray-400">
              ไม่พบชีต (ข้ามไป): {report.skippedSheets.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
