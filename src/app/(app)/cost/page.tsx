import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, Stat, Badge, EmptyState, btnPrimary, btnSecondary } from "@/components/ui";
import { fmtBaht, fmtNum, fmtDate, ymd, mondayOf } from "@/lib/format";
import { createCostFile, setCostFileStatus, uploadCostFileToDrive } from "./actions";
import { driveStatus, costFolderId } from "@/lib/drive";

export const metadata = { title: "ต้นทุน" };
export const dynamic = "force-dynamic";

const FILE_STATUS = {
  GENERATED: { label: "สร้างไฟล์แล้ว", cls: "bg-gray-100 text-gray-700" },
  PRICING: { label: "🟡 รอจัดซื้อกรอกราคา", cls: "bg-amber-100 text-amber-800" },
  COMPLETED: { label: "🟢 เสร็จสิ้น", cls: "bg-green-100 text-green-800" },
};

export default async function CostPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await requireSession();
  const editable = can(session.role, "cost", "edit");
  const { from, to } = await searchParams;

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const weekStart = mondayOf(today);
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 5);
  const fromD = from ? new Date(from + "T00:00:00Z") : weekStart;
  const toD = to ? new Date(to + "T00:00:00Z") : weekEnd;

  const [bomLines, usage, templates, files] = await Promise.all([
    db.bomLine.findMany({
      where: { planEntry: { date: { gte: fromD, lte: toD } } },
      include: { ingredient: true, planEntry: { include: { menu: true } } },
    }),
    db.usageRecord.findMany({
      where: { date: { gte: fromD, lte: toD } },
      include: { ingredient: true, menu: true },
    }),
    db.excelTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.costFile.findMany({ include: { template: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const drive = await driveStatus();
  const driveFolder = await costFolderId();
  const driveReady = drive.configured && !!driveFolder;

  const unitPrice = (ing: { lastPrice: unknown; conversionFactor: unknown }) =>
    ing.lastPrice ? Number(ing.lastPrice) / Number(ing.conversionFactor) : 0;

  const plannedCost = bomLines.reduce((s, l) => s + Number(l.qty) * unitPrice(l.ingredient), 0);
  const actualCost = usage.reduce((s, u) => s + Number(u.qty) * unitPrice(u.ingredient), 0);
  const missingPrice = [...new Set(bomLines.filter((l) => !l.ingredient.lastPrice).map((l) => l.ingredient.name))];

  // ต้นทุนรายวัน
  const byDay = new Map<string, number>();
  for (const l of bomLines) {
    const k = ymd(l.planEntry.date);
    byDay.set(k, (byDay.get(k) ?? 0) + Number(l.qty) * unitPrice(l.ingredient));
  }
  // ต้นทุนรายเมนู
  const byMenu = new Map<string, number>();
  for (const l of bomLines) {
    const k = l.planEntry.menu.name;
    byMenu.set(k, (byMenu.get(k) ?? 0) + Number(l.qty) * unitPrice(l.ingredient));
  }

  const variance = actualCost > 0 ? actualCost - plannedCost : 0;

  return (
    <>
      <PageHeader title="ต้นทุน (Cost Management)"
        subtitle="ต้นทุนตามแผน BOM × ราคาล่าสุด — และสร้าง Excel Working File ตาม Template เดิมขององค์กร"
        actions={session.role === "ADMIN" ? <Link href="/settings/excel-template" className={btnSecondary}>⚙️ Excel Template Manager</Link> : undefined} />

      <form method="get" className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">จากวันที่</span>
          <input type="date" name="from" defaultValue={ymd(fromD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">ถึงวันที่</span>
          <input type="date" name="to" defaultValue={ymd(toD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
        </label>
        <button className={btnSecondary}>แสดง</button>
      </form>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="ต้นทุนตามแผน (BOM)" value={fmtBaht(plannedCost)} tone="blue" />
        <Stat label="ต้นทุนจากการใช้จริง" value={actualCost > 0 ? fmtBaht(actualCost) : "—"} sub={actualCost > 0 ? undefined : "ยังไม่มีข้อมูลใช้จริง"} />
        <Stat label="ผลต่าง (จริง − แผน)"
          value={actualCost > 0 ? (variance >= 0 ? "+" : "") + fmtBaht(variance) : "—"}
          tone={actualCost === 0 ? "default" : variance > plannedCost * 0.05 ? "red" : "green"} />
        <Stat label="รายการที่ยังไม่มีราคา" value={missingPrice.length} tone={missingPrice.length > 0 ? "amber" : "green"} />
      </div>

      {missingPrice.length > 0 && (
        <Card className="p-4 mb-4 border-amber-300 bg-amber-50">
          <div className="font-semibold text-amber-900 mb-1">🟡 ต้นทุนยังไม่ครบ — วัตถุดิบเหล่านี้ยังไม่มีราคาล่าสุด</div>
          <p className="text-sm text-amber-800 mb-1">{missingPrice.join(", ")}</p>
          <p className="text-xs text-amber-700">ราคาจะถูกเติมอัตโนมัติเมื่อฝ่ายจัดซื้อกรอกราคาในใบสั่งซื้อ</p>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <Section title="📅 ต้นทุนรายวัน (ตามแผน)">
          {byDay.size === 0 ? <EmptyState text="ไม่มีข้อมูลในช่วงที่เลือก" /> : (
            <table className="w-full text-sm">
              <tbody>
                {[...byDay.entries()].sort().map(([d, v]) => (
                  <tr key={d} className="border-b border-gray-100 last:border-0">
                    <td className="py-2">{fmtDate(new Date(d + "T00:00:00Z"))}</td>
                    <td className="py-2 text-right font-medium">{fmtBaht(v)}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="py-2">รวมทั้งช่วง</td>
                  <td className="py-2 text-right">{fmtBaht(plannedCost)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </Section>

        <Section title="🍚 ต้นทุนรายเมนู (ตามแผน)">
          {byMenu.size === 0 ? <EmptyState text="ไม่มีข้อมูล" /> : (
            <table className="w-full text-sm">
              <tbody>
                {[...byMenu.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => (
                  <tr key={m} className="border-b border-gray-100 last:border-0">
                    <td className="py-2">{m}</td>
                    <td className="py-2 text-right font-medium">{fmtBaht(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      {/* Excel workflow */}
      <Section title="📗 Excel Cost Working File — ใช้ Template เดิมขององค์กร">
        <p className="text-sm text-gray-600 mb-3">
          ระบบเติมข้อมูล Menu + BOM ลงในคอลัมน์ตามที่ Admin กำหนดไว้ แล้วเว้นช่องราคาให้ฝ่ายจัดซื้อกรอก —
          ไม่ต้อง Copy/Paste ด้วยมือ และไม่ต้องเปลี่ยนรูปแบบเอกสารเดิม
        </p>
        <div className={`rounded-lg text-sm px-4 py-2.5 mb-3 border ${driveReady ? "bg-green-50 border-green-300 text-green-800" : "bg-gray-50 border-gray-200 text-gray-600"}`}>
          {driveReady
            ? "🟢 เชื่อม Google Drive แล้ว — ไฟล์ต้นทุนถูกส่งเข้าโฟลเดอร์ที่ตั้งไว้ ฝ่ายจัดซื้อเปิดกรอกราคาได้จาก Drive โดยตรง"
            : "🔵 ยังไม่ได้เชื่อม Google Drive — ใช้ปุ่มดาวน์โหลด Excel ได้ตามปกติ" }
          {session.role === "ADMIN" && !driveReady && (
            <Link href="/settings/drive" className="ml-2 underline font-medium">ตั้งค่า Drive →</Link>
          )}
        </div>

        {editable && templates.length > 0 && (
          <form action={createCostFile} className="flex flex-wrap items-end gap-2 mb-4 pb-4 border-b border-gray-100">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">Template</span>
              <select name="templateId" required defaultValue={templates[0]?.id} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">จากวันที่</span>
              <input type="date" name="from" required defaultValue={ymd(fromD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">ถึงวันที่</span>
              <input type="date" name="to" required defaultValue={ymd(toD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
            </label>
            <button className={btnPrimary}>+ สร้าง Cost Working File</button>
          </form>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {templates.map((t) => (
            <a key={t.id} href={`/api/export/cost?template=${t.id}&from=${ymd(fromD)}&to=${ymd(toD)}`} className={btnSecondary}>
              ⬇ ดาวน์โหลด Excel ({t.name})
            </a>
          ))}
        </div>

        {files.length === 0 ? <EmptyState text="ยังไม่มี Cost File" /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2">ไฟล์</th>
                <th className="py-2">ช่วงวันที่</th>
                <th className="py-2">สถานะ</th>
                <th className="py-2 text-right">ดาวน์โหลด</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const st = FILE_STATUS[f.status];
                return (
                  <tr key={f.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5 font-medium">{f.name}</td>
                    <td className="py-2.5 text-gray-500">{fmtDate(f.periodStart)} – {fmtDate(f.periodEnd)}</td>
                    <td className="py-2.5"><Badge label={st.label} cls={st.cls} /></td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <a href={`/api/export/cost?template=${f.templateId}&from=${ymd(f.periodStart)}&to=${ymd(f.periodEnd)}`}
                        className="text-sky-700 text-xs font-medium">⬇ Excel</a>
                      {f.driveLink ? (
                        <a href={f.driveLink} target="_blank" rel="noreferrer" className="text-green-700 text-xs font-medium ml-2">
                          📁 เปิดใน Drive ↗
                        </a>
                      ) : editable && driveReady ? (
                        <form action={uploadCostFileToDrive.bind(null, f.id)} className="inline-block ml-2">
                          <button className="text-sky-700 text-xs font-medium" style={{ minHeight: "auto" }}>📤 ส่งขึ้น Drive</button>
                        </form>
                      ) : null}
                      {editable && f.status === "PRICING" && (
                        <form action={setCostFileStatus.bind(null, f.id, "COMPLETED")} className="inline-block ml-2">
                          <button className="text-green-700 text-xs font-medium" style={{ minHeight: "auto" }}>✓ ปิดงาน</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      {usage.length > 0 && (
        <div className="mt-4">
          <Section title="⚖️ เทียบแผน vs ใช้จริง (รายวัตถุดิบ)">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2">วัตถุดิบ</th>
                  <th className="py-2 text-right">แผน (BOM)</th>
                  <th className="py-2 text-right">ใช้จริง</th>
                  <th className="py-2 text-right">ผลต่าง</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const plan = new Map<string, number>();
                  for (const l of bomLines) plan.set(l.ingredient.name, (plan.get(l.ingredient.name) ?? 0) + Number(l.qty));
                  const act = new Map<string, number>();
                  for (const u of usage) act.set(u.ingredient.name, (act.get(u.ingredient.name) ?? 0) + Number(u.qty));
                  return [...act.keys()].map((name) => {
                    const p = plan.get(name) ?? 0, a = act.get(name) ?? 0, d = a - p;
                    return (
                      <tr key={name} className="border-b border-gray-100 last:border-0">
                        <td className="py-2.5 font-medium">{name}</td>
                        <td className="py-2.5 text-right">{fmtNum(p)}</td>
                        <td className="py-2.5 text-right">{fmtNum(a)}</td>
                        <td className={`py-2.5 text-right font-medium ${Math.abs(d) < 0.01 ? "text-gray-400" : d > 0 ? "text-red-700" : "text-green-700"}`}>
                          {d > 0 ? "+" : ""}{fmtNum(d)}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </Section>
        </div>
      )}
    </>
  );
}
