import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, EmptyState, btnSecondary } from "@/components/ui";
import { SETTING_KEYS, getSettings } from "@/lib/settings";
import { driveStatus, listSpreadsheets, templateFolderId } from "@/lib/drive";
import { fmtDateTime } from "@/lib/format";
import { saveDriveSettings, testFolder, importTemplateFromDrive } from "./actions";
import { SaveSettingsForm, TestFolderForm, ImportTemplateForm } from "@/components/DriveSettingsForm";

export const metadata = { title: "Google Drive" };
export const dynamic = "force-dynamic";

export default async function DriveSettingsPage() {
  const session = await requireSession();
  if (!can(session.role, "settings", "admin")) notFound();

  const status = await driveStatus();
  const s = await getSettings([
    SETTING_KEYS.DRIVE_COST_FOLDER,
    SETTING_KEYS.DRIVE_TEMPLATE_FOLDER,
    SETTING_KEYS.DRIVE_DOCS_FOLDER,
    SETTING_KEYS.DRIVE_AUTO_UPLOAD,
  ]);

  const tmplFolder = await templateFolderId();
  let files: Awaited<ReturnType<typeof listSpreadsheets>> = [];
  let listError = "";
  if (status.configured && tmplFolder) {
    try {
      files = await listSpreadsheets(tmplFolder);
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <>
      <PageHeader title="เชื่อมต่อ Google Drive"
        subtitle="อ่าน Excel Template เดิมจาก Drive และส่งไฟล์ต้นทุน/เอกสารกลับขึ้น Drive อัตโนมัติ"
        actions={<Link href="/settings" className={btnSecondary}>← ตั้งค่า</Link>} />

      {/* Connection status */}
      <Card className={`p-4 mb-4 ${status.configured ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
        {status.configured ? (
          <>
            <div className="font-semibold text-green-900 mb-1">🟢 ตั้งค่า Credential แล้ว</div>
            <p className="text-sm text-green-800">
              Service Account: <code className="bg-white/70 px-1.5 py-0.5 rounded font-mono text-xs">{status.clientEmail}</code>
            </p>
            <p className="text-xs text-green-700 mt-2">
              อย่าลืม <b>แชร์โฟลเดอร์ใน Google Drive ให้อีเมลนี้ (สิทธิ์ Editor)</b> ไม่งั้นระบบจะมองไม่เห็นโฟลเดอร์
            </p>
          </>
        ) : (
          <>
            <div className="font-semibold text-amber-900 mb-1">🟡 ยังไม่ได้เชื่อมต่อ Google Drive</div>
            <p className="text-sm text-amber-800">{status.reason}</p>
            <p className="text-xs text-amber-700 mt-2">
              ระบบยังใช้งานได้ตามปกติทุกอย่าง — เพียงแต่ยังดาวน์โหลด/อัปโหลดผ่าน Drive ไม่ได้ ดูขั้นตอนตั้งค่าด้านล่าง
            </p>
          </>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Section title="⚙️ โฟลเดอร์ปลายทาง">
          <SaveSettingsForm
            action={saveDriveSettings}
            cost={s[SETTING_KEYS.DRIVE_COST_FOLDER]}
            template={s[SETTING_KEYS.DRIVE_TEMPLATE_FOLDER]}
            docs={s[SETTING_KEYS.DRIVE_DOCS_FOLDER]}
            autoUpload={s[SETTING_KEYS.DRIVE_AUTO_UPLOAD] === "1"}
          />
          <p className="text-xs text-gray-400 mt-3">
            Folder ID คือส่วนท้ายของ URL โฟลเดอร์ เช่น <code className="bg-gray-100 px-1 rounded">drive.google.com/drive/folders/<b>1AbC…xyz</b></code>
          </p>
        </Section>

        <Section title="🔍 ทดสอบการเข้าถึงโฟลเดอร์">
          <p className="text-sm text-gray-600 mb-3">
            ใช้ตรวจว่าแชร์โฟลเดอร์ให้ Service Account เรียบร้อยหรือยัง ก่อนเริ่มใช้งานจริง
          </p>
          <TestFolderForm action={testFolder} />
        </Section>
      </div>

      {/* Import template from Drive */}
      <div className="mb-4">
        <Section title="📥 นำ Excel Template เดิมจาก Drive เข้าระบบ">
          {!status.configured ? (
            <EmptyState text="ต้องตั้งค่า Credential ก่อนจึงจะอ่านไฟล์จาก Drive ได้" />
          ) : !tmplFolder ? (
            <EmptyState text="ยังไม่ได้ระบุโฟลเดอร์ Template — กรอก Folder ID แล้วบันทึกก่อน" />
          ) : listError ? (
            <div className="rounded-lg bg-red-50 border border-red-300 text-red-800 text-sm px-4 py-3">
              🔴 อ่านโฟลเดอร์ไม่สำเร็จ: {listError}
              <div className="text-xs mt-1">ตรวจว่าแชร์โฟลเดอร์ให้ Service Account แล้วหรือยัง</div>
            </div>
          ) : files.length === 0 ? (
            <EmptyState text="ไม่พบไฟล์ Excel หรือ Google Sheets ในโฟลเดอร์นี้" />
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-3">
                ระบบจะอ่าน<b>หัวตาราง</b>ของไฟล์ แล้วเดาว่าคอลัมน์ไหนคือข้อมูลอะไร เพื่อสร้าง Mapping ให้อัตโนมัติ —
                ไม่ต้องพิมพ์ Mapping เองตั้งแต่ต้น (ตรวจและแก้ได้ทีหลัง)
              </p>
              <ImportTemplateForm action={importTemplateFromDrive} files={files} />

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-2">ไฟล์ในโฟลเดอร์</th>
                      <th className="py-2">แก้ไขล่าสุด</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 font-medium">{f.name}</td>
                        <td className="py-2 text-gray-500">{f.modifiedTime ? fmtDateTime(f.modifiedTime) : "—"}</td>
                        <td className="py-2 text-right">
                          {f.webViewLink && (
                            <a href={f.webViewLink} target="_blank" rel="noreferrer" className="text-sky-700 text-xs font-medium">
                              เปิดใน Drive ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      </div>

      {/* Setup guide */}
      <Section title="📘 วิธีตั้งค่า (ทำครั้งเดียว)">
        <ol className="text-sm space-y-2 list-decimal pl-5 text-gray-700">
          <li>
            เข้า <b>Google Cloud Console</b> → เปิดใช้ <b>Google Drive API</b> ในโปรเจกต์ของบริษัท
          </li>
          <li>
            สร้าง <b>Service Account</b> แล้วสร้าง <b>JSON key</b> ดาวน์โหลดเก็บไว้
          </li>
          <li>
            นำเนื้อหาไฟล์ JSON ใส่ใน Environment Variable ชื่อ{" "}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-xs">GOOGLE_SERVICE_ACCOUNT_KEY</code>{" "}
            (ใส่เป็น JSON ตรงๆ หรือ base64 ก็ได้)
            <div className="text-xs text-gray-500 mt-1">
              ถ้า deploy บน Cloud Run ให้ผูก Service Account กับ service ได้เลย ไม่ต้องใส่ key
            </div>
          </li>
          <li>
            ใน Google Drive <b>แชร์โฟลเดอร์ที่ต้องการให้อีเมลของ Service Account (สิทธิ์ Editor)</b>
            <div className="text-xs text-gray-500 mt-1">
              ถ้าใช้ Shared Drive ให้เพิ่ม Service Account เป็นสมาชิกของ Shared Drive นั้น
            </div>
          </li>
          <li>กลับมาที่หน้านี้ วาง Folder ID แล้วกด &quot;ทดสอบการเชื่อมต่อ&quot;</li>
        </ol>
        <p className="text-xs text-gray-400 mt-3">
          ระบบขอสิทธิ์เฉพาะ <code className="bg-gray-100 px-1 rounded">drive.file</code> — เข้าถึงได้เฉพาะไฟล์ที่ระบบสร้างเอง
          และไฟล์/โฟลเดอร์ที่คุณแชร์ให้เท่านั้น ไม่เห็น Drive ทั้งหมดของคุณ
        </p>
      </Section>
    </>
  );
}
