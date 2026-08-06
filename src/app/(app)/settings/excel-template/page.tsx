import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, btnPrimary, btnSecondary } from "@/components/ui";
import { AVAILABLE_FIELDS, parseMapping } from "@/lib/excel";
import { saveTemplateMapping, createTemplate } from "../../cost/actions";

export const metadata = { title: "Excel Template Manager" };
export const dynamic = "force-dynamic";

export default async function ExcelTemplatePage() {
  const session = await requireSession();
  if (!can(session.role, "settings", "admin")) notFound();

  const templates = await db.excelTemplate.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <>
      <PageHeader title="Excel Template Manager"
        subtitle="กำหนดว่า Field ในระบบไปลงคอลัมน์ไหนใน Excel — เมื่อ Template เปลี่ยน แก้ที่นี่ได้เลย ไม่ต้องแก้ Source Code"
        actions={<Link href="/settings" className={btnSecondary}>← ตั้งค่า</Link>} />

      <Card className="p-4 mb-4">
        <div className="font-semibold mb-2 text-sm">Field ที่ใช้ได้ในระบบ</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2">field key</th>
                <th className="py-2">ความหมาย</th>
                <th className="py-2">แหล่งข้อมูล</th>
              </tr>
            </thead>
            <tbody>
              {AVAILABLE_FIELDS.map((f) => (
                <tr key={f.key} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 font-mono text-xs">{f.key}</td>
                  <td className="py-2">{f.label}</td>
                  <td className="py-2 text-gray-500 text-xs">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {templates.map((t) => {
        const mapping = parseMapping(t.mappingJson);
        return (
          <div key={t.id} className="mb-4">
            <Section title={`📗 ${t.name}`}>
              {t.description && <p className="text-sm text-gray-500 mb-3">{t.description}</p>}

              <div className="overflow-x-auto mb-3">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-2">Field</th>
                      <th className="py-2">→ Column</th>
                      <th className="py-2">หัวตาราง</th>
                      <th className="py-2">สูตร</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.map((m, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 font-mono text-xs">{m.field}</td>
                        <td className="py-2 font-semibold">{m.column}</td>
                        <td className="py-2">{m.label}</td>
                        <td className="py-2 text-gray-500 font-mono text-xs">{m.formula ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <form action={saveTemplateMapping.bind(null, t.id)} className="space-y-2">
                <label className="text-sm block">
                  <span className="block text-xs text-gray-500 mb-1">Mapping JSON (แก้ไขได้โดยตรง)</span>
                  <textarea name="mappingJson" rows={8} defaultValue={JSON.stringify(mapping, null, 2)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs" />
                </label>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm">
                    <span className="block text-xs text-gray-500 mb-1">แถวหัวตาราง</span>
                    <input name="headerRow" type="number" min="1" defaultValue={t.headerRow}
                      className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                  <button className={btnPrimary}>💾 บันทึก Mapping</button>
                  <a href={`/api/export/cost?template=${t.id}&from=2026-08-03&to=2026-08-08`} className={btnSecondary}>
                    ⬇ ทดสอบ Export
                  </a>
                </div>
              </form>
            </Section>
          </div>
        );
      })}

      <Section title="+ เพิ่ม Template ใหม่">
        <form action={createTemplate} className="flex flex-wrap gap-2 items-end">
          <label className="text-sm flex-1 min-w-48">
            <span className="block text-xs text-gray-500 mb-1">ชื่อ Template *</span>
            <input name="name" required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm flex-1 min-w-48">
            <span className="block text-xs text-gray-500 mb-1">คำอธิบาย</span>
            <input name="description" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <button className={btnPrimary}>+ เพิ่ม</button>
        </form>
      </Section>
    </>
  );
}
