import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, btnSecondary } from "@/components/ui";
import { driveStatus, costFolderId, templateFolderId } from "@/lib/drive";
import { sheetsSpreadsheetId } from "@/lib/sheets";

export const metadata = { title: "การเชื่อมต่อ" };
export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await requireSession();
  if (!can(session.role, "settings", "admin")) notFound();

  const status = await driveStatus();
  const [sheetId, costFolder, tmplFolder] = await Promise.all([
    sheetsSpreadsheetId(), costFolderId(), templateFolderId(),
  ]);

  const items = [
    {
      href: "/settings/sheets",
      icon: "📊",
      title: "Google Sheets",
      desc: "ซิงก์ข้อมูลทั้งระบบขึ้น Google Sheets และแก้ข้อมูลหลักจาก Sheets ได้",
      connected: !!sheetId,
      detail: sheetId ? "ผูกไฟล์แล้ว" : "ยังไม่ได้ผูกไฟล์",
    },
    {
      href: "/settings/drive",
      icon: "📁",
      title: "Google Drive",
      desc: "อ่าน Excel Template เดิมจาก Drive และส่งไฟล์ต้นทุนกลับขึ้นโฟลเดอร์",
      connected: !!(costFolder || tmplFolder),
      detail: costFolder || tmplFolder ? "ตั้งค่าโฟลเดอร์แล้ว" : "ยังไม่ได้ตั้งค่าโฟลเดอร์",
    },
    {
      href: "/settings/excel-template",
      icon: "📗",
      title: "Excel Template",
      desc: "กำหนดว่า Field ในระบบไปลงคอลัมน์ไหนของไฟล์ต้นทุน — แก้ได้โดยไม่ต้องแก้โค้ด",
      connected: true,
      detail: "พร้อมใช้งาน",
    },
    {
      href: "/master/import",
      icon: "📥",
      title: "นำเข้าข้อมูลจาก Excel",
      desc: "อัปโหลดวัตถุดิบ เมนู ผู้ขาย และ BOM ทีละหลายร้อยรายการ",
      connected: true,
      detail: "พร้อมใช้งาน",
    },
  ];

  return (
    <>
      <PageHeader title="การเชื่อมต่อระบบภายนอก"
        subtitle="เชื่อม Google Sheets / Google Drive และตั้งค่าไฟล์ Excel — เป็นงานตั้งค่าทางเทคนิค ทำครั้งเดียวจบ"
        actions={<Link href="/settings" className={btnSecondary}>← ตั้งค่า</Link>} />

      <Card className={`p-4 mb-4 ${status.configured ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
        {status.configured ? (
          <>
            <div className="font-semibold text-green-900 mb-1">🟢 เชื่อมต่อบัญชี Google แล้ว</div>
            <p className="text-sm text-green-800">
              Service Account:{" "}
              <code className="bg-white/70 px-1.5 py-0.5 rounded font-mono text-xs">{status.clientEmail}</code>
            </p>
            <p className="text-xs text-green-700 mt-2">
              แชร์ไฟล์/โฟลเดอร์ใน Google ให้อีเมลนี้ (สิทธิ์ Editor) แล้วระบบจะเข้าถึงได้
            </p>
          </>
        ) : (
          <>
            <div className="font-semibold text-amber-900 mb-1">🟡 ยังไม่ได้เชื่อมบัญชี Google</div>
            <p className="text-sm text-amber-800">{status.reason}</p>
            <p className="text-xs text-amber-700 mt-2">
              ระบบใช้งานได้ครบทุกอย่างตามปกติ — ส่วนนี้เพิ่มเข้ามาเมื่อต้องการให้ข้อมูลไปอยู่ใน Google Sheets/Drive
            </p>
          </>
        )}
      </Card>

      <div className="grid sm:grid-cols-2 gap-3">
        {items.map((it) => (
          <Link key={it.href} href={it.href}>
            <Card className="p-4 h-full hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div className="text-2xl">{it.icon}</div>
                <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                  it.connected ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                }`}>
                  {it.detail}
                </span>
              </div>
              <div className="font-semibold text-[#1e3a5f] mt-2">{it.title}</div>
              <p className="text-sm text-gray-600 mt-1">{it.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
