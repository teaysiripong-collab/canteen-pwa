import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, btnSecondary } from "@/components/ui";
import { SHEETS } from "@/lib/import";
import { driveStatus, listSpreadsheets, templateFolderId } from "@/lib/drive";
import ImportForm from "@/components/ImportForm";
import { runImport } from "./actions";

export const metadata = { title: "นำเข้าข้อมูลหลัก" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await requireSession();
  if (!can(session.role, "master", "admin")) notFound();

  const status = await driveStatus();
  const folder = await templateFolderId();
  let driveFiles: { id: string; name: string }[] = [];
  if (status.configured && folder) {
    try {
      driveFiles = (await listSpreadsheets(folder)).map((f) => ({ id: f.id, name: f.name }));
    } catch {
      driveFiles = [];
    }
  }

  return (
    <>
      <PageHeader title="นำเข้าข้อมูลหลักจาก Excel"
        subtitle="กรอกข้อมูลจริงของแคนทีนลงแบบฟอร์มแล้วอัปโหลดครั้งเดียว — ไม่ต้องพิมพ์ทีละรายการ"
        actions={
          <>
            <a href="/api/import/template" className={btnSecondary}>⬇ ดาวน์โหลดแบบฟอร์ม</a>
            <Link href="/master" className={btnSecondary}>← Master Data</Link>
          </>
        } />

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="📤 อัปโหลดไฟล์">
          <ImportForm action={runImport} driveFiles={driveFiles} />
        </Section>

        <div className="space-y-4">
          <Card className="p-4 border-sky-300 bg-sky-50">
            <div className="font-semibold text-sky-900 mb-2">เริ่มยังไงดี</div>
            <ol className="text-sm text-sky-900 space-y-1.5 list-decimal pl-5">
              <li>กด <b>ดาวน์โหลดแบบฟอร์ม</b> ด้านบน จะได้ไฟล์ Excel ที่มีชีตและหัวตารางครบ</li>
              <li>กรอกข้อมูลจริง — ชีตไหนยังไม่มีข้อมูล ข้ามไปก่อนได้</li>
              <li>อัปโหลดโดย<b>ติ๊ก &quot;ตรวจสอบอย่างเดียว&quot;</b> เพื่อดูผลก่อน</li>
              <li>ถ้าไม่มีปัญหา เอาเครื่องหมายออกแล้วนำเข้าจริง</li>
            </ol>
          </Card>

          <Section title="📋 ชีตและคอลัมน์ที่ระบบอ่าน">
            <p className="text-xs text-gray-500 mb-3">
              ระบบนำเข้าตามลำดับนี้เสมอ เพราะข้อมูลอ้างอิงกัน (เช่น วัตถุดิบต้องมีหน่วยนับก่อน)
              — คอลัมน์ที่มี <span className="text-red-600 font-medium">*</span> คือจำเป็นต้องกรอก
            </p>
            <div className="space-y-3">
              {SHEETS.map((s, i) => (
                <div key={s.key} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">
                  <div className="font-medium text-sm">
                    <span className="text-gray-400 mr-1">{i + 1}.</span>
                    ชีต &quot;{s.sheetName}&quot; <span className="text-gray-400 font-normal">— {s.label}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {s.columns.map((c) => (
                      <span key={c.key} className="inline-block mr-2 whitespace-nowrap">
                        {c.header}{c.required && <span className="text-red-600">*</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Card className="p-4 text-sm text-gray-600">
            <div className="font-semibold text-gray-800 mb-1.5">ข้อควรรู้</div>
            <ul className="space-y-1 text-xs list-disc pl-4">
              <li>ถ้า<b>รหัสซ้ำ</b>กับที่มีอยู่ ระบบจะ<b>อัปเดตของเดิม</b> ไม่สร้างซ้ำ — อัปโหลดไฟล์เดิมซ้ำได้อย่างปลอดภัย</li>
              <li>ถ้ามีแถวใดผิด ระบบ<b>ไม่บันทึกทั้งไฟล์</b> เพื่อกันข้อมูลค้างครึ่งทาง</li>
              <li>การนำเข้าถูกบันทึกใน Activity Log ตรวจย้อนหลังได้</li>
              <li>ไฟล์ .csv ให้เปิดด้วย Excel แล้ว Save As เป็น .xlsx ก่อน</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
