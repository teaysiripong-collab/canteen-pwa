import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader, Card, EmptyState, btnSecondary } from "@/components/ui";
import { fmtDate, fmtDateTime, ymd, PO_STATUS, PLAN_STATUS } from "@/lib/format";

export const metadata = { title: "เอกสาร" };
export const dynamic = "force-dynamic";

type Doc = {
  type: string; typeLabel: string; title: string; date: Date;
  status?: { label: string; cls: string };
  viewHref?: string; excelHref?: string; printHref?: string;
};

const TYPES = [
  { key: "", label: "ทั้งหมด" },
  { key: "MENU", label: "แผนเมนู" },
  { key: "PURCHASE", label: "ใบสั่งซื้อ" },
  { key: "RECEIVE", label: "รับของ" },
  { key: "ISSUE", label: "เบิกของ" },
  { key: "COST", label: "ต้นทุน / Excel" },
];

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ type?: string; from?: string; to?: string }> }) {
  await requireSession();
  const { type, from, to } = await searchParams;

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const defFrom = new Date(today); defFrom.setUTCDate(defFrom.getUTCDate() - 30);
  const fromD = from ? new Date(from + "T00:00:00Z") : defFrom;
  const toD = to ? new Date(to + "T23:59:59Z") : new Date(today.getTime() + 86400000 * 30);

  const [plans, pos, receives, issues, costFiles] = await Promise.all([
    db.menuPlan.findMany({ where: { weekStart: { gte: fromD, lte: toD } }, orderBy: { weekStart: "desc" } }),
    db.purchaseOrder.findMany({ where: { createdAt: { gte: fromD } }, include: { vendor: true }, orderBy: { createdAt: "desc" } }),
    db.stockTransaction.findMany({
      where: { type: "RECEIVE", createdAt: { gte: fromD } },
      include: { ingredient: true, user: true }, orderBy: { createdAt: "desc" }, take: 50,
    }),
    db.stockTransaction.findMany({
      where: { type: "ISSUE", createdAt: { gte: fromD } },
      include: { ingredient: true, user: true }, orderBy: { createdAt: "desc" }, take: 50,
    }),
    db.costFile.findMany({ where: { createdAt: { gte: fromD } }, include: { template: true }, orderBy: { createdAt: "desc" } }),
  ]);

  const docs: Doc[] = [
    ...plans.map((p) => ({
      type: "MENU", typeLabel: "แผนเมนู",
      title: `แผนเมนูสัปดาห์ ${fmtDate(p.weekStart)} (v${p.version})`,
      date: p.weekStart, status: PLAN_STATUS[p.status],
      viewHref: `/menu-plan?week=${ymd(p.weekStart)}`,
      printHref: `/menu-plan/print?week=${ymd(p.weekStart)}`,
      excelHref: `/api/export/menu-plan?week=${ymd(p.weekStart)}`,
    })),
    ...pos.map((p) => ({
      type: "PURCHASE", typeLabel: "ใบสั่งซื้อ",
      title: `${p.code} — ${p.vendor.name}`,
      date: p.createdAt, status: PO_STATUS[p.status],
      viewHref: `/purchase/${p.id}`,
      excelHref: `/api/export/po/${p.id}`,
    })),
    ...receives.map((t) => ({
      type: "RECEIVE", typeLabel: "รับของ",
      title: `รับ ${t.ingredient.name} โดย ${t.user.name}`,
      date: t.createdAt,
      viewHref: `/stock/history?ing=${t.ingredientId}&type=RECEIVE`,
    })),
    ...issues.map((t) => ({
      type: "ISSUE", typeLabel: "เบิกของ",
      title: `เบิก ${t.ingredient.name} โดย ${t.user.name}`,
      date: t.createdAt,
      viewHref: `/stock/history?ing=${t.ingredientId}&type=ISSUE`,
    })),
    ...costFiles.map((f) => ({
      type: "COST", typeLabel: "ต้นทุน / Excel",
      title: f.name, date: f.createdAt,
      viewHref: "/cost",
      excelHref: `/api/export/cost?template=${f.templateId}&from=${ymd(f.periodStart)}&to=${ymd(f.periodEnd)}`,
    })),
  ]
    .filter((d) => !type || d.type === type)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <>
      <PageHeader title="Document Center" subtitle="เอกสารทั้งหมดในระบบ — ค้นหาตามประเภทและช่วงวันที่" />

      <form method="get" className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">จากวันที่</span>
          <input type="date" name="from" defaultValue={ymd(fromD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">ถึงวันที่</span>
          <input type="date" name="to" defaultValue={ymd(today)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
        </label>
        <input type="hidden" name="type" value={type ?? ""} />
        <button className={btnSecondary}>กรอง</button>
      </form>

      <div className="flex flex-wrap gap-2 mb-4">
        {TYPES.map((t) => (
          <Link key={t.key} href={t.key ? `/documents?type=${t.key}` : "/documents"}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border ${(type ?? "") === t.key ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white border-gray-300 text-gray-600"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      <Card className="overflow-x-auto">
        {docs.length === 0 ? <EmptyState text="ไม่พบเอกสารในเงื่อนไขที่เลือก" /> : (
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 px-3">ประเภท</th>
                <th className="py-2.5 px-3">เอกสาร</th>
                <th className="py-2.5 px-3">วันที่</th>
                <th className="py-2.5 px-3">สถานะ</th>
                <th className="py-2.5 px-3 text-right">เปิด / ดาวน์โหลด</th>
              </tr>
            </thead>
            <tbody>
              {docs.slice(0, 100).map((d, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">{d.typeLabel}</td>
                  <td className="py-2.5 px-3 font-medium">{d.title}</td>
                  <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">{fmtDateTime(d.date)}</td>
                  <td className="py-2.5 px-3">
                    {d.status && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${d.status.cls}`}>{d.status.label}</span>}
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap space-x-2">
                    {d.viewHref && <Link href={d.viewHref} className="text-sky-700 text-xs font-medium">เปิด</Link>}
                    {d.printHref && <Link href={d.printHref} className="text-sky-700 text-xs font-medium">🖨️ PDF</Link>}
                    {d.excelHref && <a href={d.excelHref} className="text-green-700 text-xs font-medium">⬇ Excel</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
