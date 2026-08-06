import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader, Card, EmptyState, btnSecondary } from "@/components/ui";
import { fmtNum, fmtDateTime, SHIFT_LABEL } from "@/lib/format";
import type { StockTxType } from "@prisma/client";

export const metadata = { title: "ประวัติ Stock" };
export const dynamic = "force-dynamic";

const TX_LABEL: Record<StockTxType, { label: string; cls: string }> = {
  RECEIVE: { label: "รับเข้า", cls: "bg-green-100 text-green-800" },
  ISSUE: { label: "เบิกออก", cls: "bg-amber-100 text-amber-800" },
  TRANSFER_IN: { label: "โอนเข้า", cls: "bg-sky-100 text-sky-800" },
  TRANSFER_OUT: { label: "โอนออก", cls: "bg-sky-100 text-sky-800" },
  ADJUST: { label: "ปรับยอด", cls: "bg-purple-100 text-purple-800" },
  COUNT: { label: "ตรวจนับ", cls: "bg-gray-100 text-gray-700" },
};

export default async function StockHistoryPage({ searchParams }: { searchParams: Promise<{ ing?: string; type?: string }> }) {
  await requireSession();
  const { ing, type } = await searchParams;

  const txns = await db.stockTransaction.findMany({
    where: {
      ...(ing ? { ingredientId: ing } : {}),
      ...(type ? { type: type as StockTxType } : {}),
    },
    include: { ingredient: true, unit: true, location: true, lot: true, user: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const ingredients = await db.ingredient.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <>
      <PageHeader title="ประวัติ Stock" subtitle="ธุรกรรมทั้งหมด 200 รายการล่าสุด — ตรวจสอบย้อนหลังได้ว่าใครทำอะไรเมื่อไหร่"
        actions={<Link href="/stock" className={btnSecondary}>← Stock</Link>} />

      <form method="get" className="flex flex-wrap gap-2 mb-4">
        <select name="ing" defaultValue={ing ?? ""} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
          <option value="">ทุกวัตถุดิบ</option>
          {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select name="type" defaultValue={type ?? ""} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
          <option value="">ทุกประเภท</option>
          {Object.entries(TX_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className={btnSecondary}>กรอง</button>
        {(ing || type) && <Link href="/stock/history" className={btnSecondary}>ล้าง</Link>}
      </form>

      <Card className="overflow-x-auto">
        {txns.length === 0 ? <EmptyState text="ไม่มีธุรกรรม" /> : (
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 px-3">เวลา</th>
                <th className="py-2.5 px-3">ประเภท</th>
                <th className="py-2.5 px-3">วัตถุดิบ</th>
                <th className="py-2.5 px-3 text-right">จำนวน</th>
                <th className="py-2.5 px-3">Location</th>
                <th className="py-2.5 px-3">Lot</th>
                <th className="py-2.5 px-3">ผู้ทำรายการ</th>
                <th className="py-2.5 px-3">หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => {
                const lbl = TX_LABEL[t.type];
                const q = Number(t.qty);
                return (
                  <tr key={t.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">{fmtDateTime(t.createdAt)}</td>
                    <td className="py-2.5 px-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${lbl.cls}`}>{lbl.label}</span>
                    </td>
                    <td className="py-2.5 px-3 font-medium">{t.ingredient.name}</td>
                    <td className={`py-2.5 px-3 text-right font-semibold ${q < 0 ? "text-red-700" : "text-green-700"}`}>
                      {q > 0 ? "+" : ""}{fmtNum(q)} {t.unit.code}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500">{t.location.name}</td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs">{t.lot?.lotCode ?? "—"}</td>
                    <td className="py-2.5 px-3 text-gray-500">{t.user.name}{t.shift ? ` · ${SHIFT_LABEL[t.shift]}` : ""}</td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs">{t.note ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
