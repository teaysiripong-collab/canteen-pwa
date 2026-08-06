import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getStockLevels } from "@/lib/stock";
import { PageHeader, Card, Section, EmptyState, btnPrimary, btnSecondary } from "@/components/ui";
import { fmtNum, ymd, mondayOf } from "@/lib/format";
import { generatePOs } from "../actions";

export const metadata = { title: "วางแผนสั่งซื้อ" };
export const dynamic = "force-dynamic";

export default async function PurchasePlanPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireSession();
  const { from, to } = await searchParams;

  const nextMonday = mondayOf(new Date());
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const nextSat = new Date(nextMonday); nextSat.setUTCDate(nextSat.getUTCDate() + 5);
  const fromD = from ? new Date(from + "T00:00:00Z") : nextMonday;
  const toD = to ? new Date(to + "T00:00:00Z") : nextSat;

  const lines = await db.bomLine.findMany({
    where: { planEntry: { date: { gte: fromD, lte: toD } } },
    include: { ingredient: { include: { defaultVendor: true, stockUnit: true } } },
  });

  const stock = await getStockLevels();
  const stockByIng = new Map(stock.map((x) => [x.ingredientId, x.total]));

  const existing = await db.purchaseOrderItem.findMany({
    where: { po: { status: { notIn: ["CANCELLED"] }, periodStart: { lte: toD }, periodEnd: { gte: fromD } } },
  });
  const orderedByIng = new Map<string, number>();
  for (const it of existing) orderedByIng.set(it.ingredientId, (orderedByIng.get(it.ingredientId) ?? 0) + Number(it.orderQty));

  // Aggregate + group by vendor
  type Row = { ingId: string; name: string; unit: string; bom: number; stock: number; ordered: number; suggested: number };
  const byIng = new Map<string, Row>();
  for (const l of lines) {
    const r = byIng.get(l.ingredientId) ?? {
      ingId: l.ingredientId, name: l.ingredient.name, unit: l.ingredient.stockUnit.code,
      bom: 0, stock: stockByIng.get(l.ingredientId) ?? 0,
      ordered: orderedByIng.get(l.ingredientId) ?? 0, suggested: 0,
    };
    r.bom += Number(l.qty);
    byIng.set(l.ingredientId, r);
  }
  const groups = new Map<string, { vendorName: string; rows: Row[] }>();
  for (const l of lines) {
    const vName = l.ingredient.defaultVendor?.name ?? "⚠️ ยังไม่กำหนด Vendor";
    const vId = l.ingredient.defaultVendorId ?? "NONE";
    if (!groups.has(vId)) groups.set(vId, { vendorName: vName, rows: [] });
    const g = groups.get(vId)!;
    const row = byIng.get(l.ingredientId)!;
    if (!g.rows.includes(row)) g.rows.push(row);
  }
  for (const r of byIng.values()) {
    r.suggested = Math.max(0, Math.round((r.bom - r.stock - r.ordered) * 100) / 100);
  }
  const noVendor = groups.get("NONE");

  return (
    <>
      <PageHeader
        title="วางแผนสั่งซื้อจาก BOM"
        subtitle="ระบบรวมวัตถุดิบจาก BOM ในช่วงวันที่เลือก แล้ว Group ตาม Vendor — Stock เป็นข้อมูลประกอบ ไม่หักจาก BOM อัตโนมัติ"
        actions={<Link href="/purchase" className={btnSecondary}>← รายการสั่งซื้อ</Link>}
      />

      <Card className="p-4 mb-4">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="text-sm">
            <span className="block text-xs text-gray-500 mb-1">จากวันที่</span>
            <input type="date" name="from" defaultValue={ymd(fromD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-gray-500 mb-1">ถึงวันที่</span>
            <input type="date" name="to" defaultValue={ymd(toD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
          </label>
          <button className={btnSecondary}>แสดงตัวอย่าง</button>
          {lines.length > 0 && (
            <span className="text-sm text-gray-500 ml-2">พบ {byIng.size} วัตถุดิบ จาก {groups.size} Vendor</span>
          )}
        </form>
      </Card>

      {lines.length === 0 ? (
        <Card className="p-4">
          <EmptyState text="ไม่มี BOM ในช่วงวันที่เลือก — จัดแผนเมนูและ BOM ก่อน" />
        </Card>
      ) : (
        <>
          {noVendor && (
            <Card className="p-4 mb-4 border-red-300 bg-red-50">
              <div className="font-semibold text-red-800 mb-1">🔴 วัตถุดิบที่ยังไม่กำหนด Vendor ({noVendor.rows.length} รายการ)</div>
              <p className="text-sm text-red-700 mb-2">รายการเหล่านี้จะไม่ถูกสร้างเป็นใบสั่งซื้อ — กำหนด Default Vendor ที่ Master Data ก่อน</p>
              <div className="text-sm">{noVendor.rows.map((r) => r.name).join(", ")}</div>
            </Card>
          )}

          <div className="space-y-4 mb-5">
            {[...groups.entries()].filter(([id]) => id !== "NONE").map(([vendorId, g]) => (
              <Section key={vendorId} title={`🏪 ${g.vendorName} (${g.rows.length} รายการ)`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-200">
                        <th className="py-2 pr-3">รายการ</th>
                        <th className="py-2 px-3 text-right">BOM ต้องใช้</th>
                        <th className="py-2 px-3 text-right">Stock ล่าสุด*</th>
                        <th className="py-2 px-3 text-right">สั่งแล้ว</th>
                        <th className="py-2 px-3 text-right font-semibold">แนะนำสั่ง</th>
                        <th className="py-2 pl-3">หน่วย</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.ingId} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 pr-3 font-medium">{r.name}</td>
                          <td className="py-2 px-3 text-right">{fmtNum(r.bom)}</td>
                          <td className="py-2 px-3 text-right text-gray-500">{fmtNum(r.stock)}</td>
                          <td className="py-2 px-3 text-right text-gray-500">{fmtNum(r.ordered)}</td>
                          <td className="py-2 px-3 text-right font-semibold text-[#1e3a5f]">{fmtNum(r.suggested)}</td>
                          <td className="py-2 pl-3 text-gray-500">{r.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            ))}
          </div>

          <Card className="p-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-600 flex-1 min-w-60">
              สร้างใบสั่งซื้อ (Draft) แยกตาม Vendor — จำนวนสั่งจริงตั้งต้นจากค่าแนะนำ และ<b>แก้ไขเองได้ทุกบรรทัด</b>ก่อนยืนยันสั่ง
            </p>
            <form action={generatePOs.bind(null, ymd(fromD), ymd(toD))}>
              <button className={btnPrimary}>✓ สร้างใบสั่งซื้อ {groups.size - (noVendor ? 1 : 0)} ฉบับ</button>
            </form>
          </Card>
          <p className="text-xs text-gray-400 mt-2">* Stock แสดงเป็นข้อมูลประกอบการตัดสินใจเท่านั้น ระบบไม่บังคับหักจาก BOM</p>
        </>
      )}
    </>
  );
}
