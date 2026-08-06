import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, btnSecondary } from "@/components/ui";
import { SETTING_KEYS, getSettings } from "@/lib/settings";
import { driveStatus } from "@/lib/drive";
import { sheetsSpreadsheetId } from "@/lib/sheets";
import { SHEETS } from "@/lib/import";
import { fmtDateTime } from "@/lib/format";
import {
  saveSheetsSettings, testSpreadsheet, createAndLinkSpreadsheet, pushNow, pullNow,
} from "./actions";
import {
  LinkSheetForm, TestSheetForm, CreateSheetForm, PushForm, PullForm,
} from "@/components/SheetsForms";

export const metadata = { title: "Google Sheets" };
export const dynamic = "force-dynamic";

const READONLY_TABS = [
  "แผนเมนู", "BOM รายวัน", "ใบสั่งซื้อ", "Stock คงเหลือ",
  "ประวัติ Stock", "การใช้จริง", "งานที่มอบหมาย", "Audit Log",
];

export default async function SheetsSettingsPage() {
  const session = await requireSession();
  if (!can(session.role, "settings", "admin")) notFound();

  const status = await driveStatus();
  const s = await getSettings([
    SETTING_KEYS.SHEETS_SPREADSHEET_ID,
    SETTING_KEYS.SHEETS_AUTO_PUSH,
    SETTING_KEYS.SHEETS_LAST_PUSH,
    SETTING_KEYS.SHEETS_LAST_PULL,
  ]);
  const sheetId = await sheetsSpreadsheetId();
  const sheetUrl = sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}` : "";

  return (
    <>
      <PageHeader title="Google Sheets — ฐานข้อมูลที่เปิดดูได้"
        subtitle="ข้อมูลทั้งระบบอยู่ใน Google Sheets ของคุณ เปิดดู กรอง ทำกราฟ และแก้ข้อมูลหลักได้จาก Sheets โดยตรง"
        actions={<Link href="/settings" className={btnSecondary}>← ตั้งค่า</Link>} />

      {!status.configured && (
        <Card className="p-4 mb-4 border-amber-300 bg-amber-50">
          <div className="font-semibold text-amber-900 mb-1">🟡 ต้องตั้งค่า Credential ของ Google ก่อน</div>
          <p className="text-sm text-amber-800">{status.reason}</p>
          <Link href="/settings/drive" className="text-sm underline font-medium text-amber-900 mt-2 inline-block">
            ไปหน้าตั้งค่า Google →
          </Link>
        </Card>
      )}

      {/* How it works — the honest split */}
      <Card className="p-4 mb-4 border-sky-300 bg-sky-50">
        <div className="font-semibold text-sky-900 mb-2">ระบบทำงานยังไง</div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm text-sky-900">
          <div className="bg-white/70 rounded-lg p-3">
            <div className="font-medium mb-1">✏️ แท็บที่แก้ใน Sheets ได้ (ข้อมูลหลัก)</div>
            <div className="text-xs">{SHEETS.map((x) => x.sheetName).join(" · ")}</div>
            <div className="text-xs mt-1.5 text-sky-700">
              แก้ใน Sheets แล้วกด &quot;ดึงข้อมูลเข้าระบบ&quot; — ตรวจความถูกต้องด้วยกฎเดียวกับการนำเข้า Excel
            </div>
          </div>
          <div className="bg-white/70 rounded-lg p-3">
            <div className="font-medium mb-1">👁 แท็บที่ระบบเขียนให้ (อ่านอย่างเดียว)</div>
            <div className="text-xs">{READONLY_TABS.join(" · ")}</div>
            <div className="text-xs mt-1.5 text-sky-700">
              เห็นยอด Stock ประวัติการเบิก ใบสั่งซื้อ และ Audit Log ครบ — แต่ให้บันทึกผ่านระบบเพื่อไม่ให้ยอดชนกัน
            </div>
          </div>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="🔗 ผูกกับไฟล์ Google Sheets">
          {sheetId ? (
            <>
              <div className="rounded-lg bg-green-50 border border-green-300 px-4 py-3 text-sm text-green-900 mb-3">
                🟢 ผูกไว้แล้ว —{" "}
                <a href={sheetUrl} target="_blank" rel="noreferrer" className="underline font-medium">
                  เปิดไฟล์ใน Google Sheets ↗
                </a>
                <div className="text-xs mt-1.5 space-y-0.5">
                  <div>ส่งขึ้นล่าสุด: {s[SETTING_KEYS.SHEETS_LAST_PUSH] ? fmtDateTime(s[SETTING_KEYS.SHEETS_LAST_PUSH]) : "ยังไม่เคย"}</div>
                  <div>ดึงเข้าล่าสุด: {s[SETTING_KEYS.SHEETS_LAST_PULL] ? fmtDateTime(s[SETTING_KEYS.SHEETS_LAST_PULL]) : "ยังไม่เคย"}</div>
                </div>
              </div>
              <TestSheetForm action={testSpreadsheet} spreadsheetId={sheetId} />
            </>
          ) : (
            <p className="text-sm text-gray-600 mb-3">
              ยังไม่ได้ผูกไฟล์ — สร้างไฟล์ใหม่ให้อัตโนมัติ (ด้านล่าง) หรือวาง ID ของไฟล์ที่มีอยู่แล้วก็ได้
            </p>
          )}
          <div className="mt-3">
            <LinkSheetForm
              action={saveSheetsSettings}
              spreadsheetId={s[SETTING_KEYS.SHEETS_SPREADSHEET_ID]}
              autoPush={s[SETTING_KEYS.SHEETS_AUTO_PUSH] === "1"}
            />
          </div>
          {status.configured && (
            <p className="text-xs text-gray-400 mt-3">
              ถ้าใช้ไฟล์เดิม อย่าลืมแชร์ไฟล์นั้นให้{" "}
              <code className="bg-gray-100 px-1 rounded font-mono">{status.clientEmail}</code> สิทธิ์ <b>Editor</b>
            </p>
          )}
        </Section>

        <Section title="✨ ยังไม่มีไฟล์? สร้างให้เลย">
          <p className="text-sm text-gray-600 mb-3">
            ระบบจะสร้าง Google Sheets ใหม่ ใส่ทุกแท็บ พร้อมข้อมูลปัจจุบันทั้งหมด และผูกให้อัตโนมัติ
            {" "}(ไฟล์จะเป็นของ Service Account — จำไว้ว่าต้องแชร์ต่อให้ทีมของคุณเอง)
          </p>
          <CreateSheetForm action={createAndLinkSpreadsheet} />
        </Section>
      </div>

      {sheetId && (
        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          <Section title="⬆ ส่งข้อมูลจากระบบขึ้น Sheets">
            <p className="text-sm text-gray-600 mb-3">
              เขียนทับทุกแท็บด้วยข้อมูลล่าสุดของระบบ — ใช้เมื่ออยากให้ Sheets ตรงกับระบบ ณ ตอนนี้
            </p>
            <PushForm action={pushNow} />
          </Section>

          <Section title="⬇ ดึงข้อมูลหลักจาก Sheets เข้าระบบ">
            <p className="text-sm text-gray-600 mb-3">
              อ่านเฉพาะแท็บข้อมูลหลัก ({SHEETS.length} แท็บ) — รหัสซ้ำจะอัปเดตของเดิม
              และถ้ามีแถวผิดจะไม่บันทึกทั้งหมด
            </p>
            <PullForm action={pullNow} />
          </Section>
        </div>
      )}

      <Section title="📘 ทำไมยอด Stock ถึงให้บันทึกผ่านระบบ">
        <div className="text-sm text-gray-700 space-y-2">
          <p>
            Google Sheets ไม่มีระบบ <b>transaction</b> และ <b>row lock</b> แบบฐานข้อมูล
            ถ้าพนักงาน 2 คนกดเบิกของพร้อมกันตอนรอบเช้า การเขียนของคนหลังจะทับของคนแรก
            ยอดที่หายไปจะไม่มีใครรู้ เพราะไม่มี error ขึ้นเลย
          </p>
          <p>
            ระบบนี้จึงบันทึกรายการเบิก-รับ-โอน-ปรับ ลง PostgreSQL ซึ่งรับประกันว่าทุกธุรกรรมไม่ชนกัน
            แล้ว<b>สะท้อนผลขึ้น Sheets ให้เห็นครบทุกแถว</b> — คุณยังเปิด Sheets แล้วเห็นยอดจริง
            ประวัติการเบิก และ Audit Log ได้ทั้งหมดเหมือนเดิม
          </p>
          <p className="text-gray-500 text-xs">
            ส่วนข้อมูลหลัก (วัตถุดิบ เมนู ผู้ขาย BOM) แก้ใน Sheets ได้เต็มที่ เพราะไม่ใช่ข้อมูลที่หลายคน
            แก้พร้อมกันตลอดเวลา และมีการตรวจสอบก่อนบันทึกทุกครั้ง
          </p>
        </div>
      </Section>
    </>
  );
}
