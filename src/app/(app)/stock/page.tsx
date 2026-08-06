import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getStockLevels } from "@/lib/stock";
import { PageHeader, Card, EmptyState, btnPrimary, btnSecondary } from "@/components/ui";
import { fmtNum } from "@/lib/format";

export const metadata = { title: "Stock" };
export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; done?: string }> }) {
  const session = await requireSession();
  const { filter, q, done } = await searchParams;
  const editable = can(session.role, "stock", "edit");

  let levels = await getStockLevels();
  if (q) levels = levels.filter((l) => l.name.includes(q) || l.code.toLowerCase().includes(q.toLowerCase()));
  if (filter === "low") levels = levels.filter((l) => l.total > 0 && l.total < l.minStock);
  if (filter === "out") levels = levels.filter((l) => l.total <= 0);

  const doneMsg = { issue: "บันทึกการเบิกแล้ว — Stock ลดอัตโนมัติ", receive: "รับของเข้าแล้ว — Stock เพิ่มอัตโนมัติ", transfer: "โอนของเรียบร้อย", adjust: "ปรับ Stock เรียบร้อย" }[done ?? ""];

  return (
    <>
      <PageHeader
        title="Stock / คลังวัตถุดิบ"
        subtitle="ยอดคงเหลือจริงจากบัญชีธุรกรรม (แยกจาก BOM เสมอ)"
        actions={
          editable ? (
            <>
              <Link href="/stock/issue" className={btnPrimary}>➖ เบิกของ</Link>
              <Link href="/stock/receive" className={btnSecondary}>➕ รับของ</Link>
              <Link href="/stock/transfer" className={btnSecondary}>⇄ โอน</Link>
              <Link href="/stock/adjust" className={btnSecondary}>✎ ปรับ</Link>
              <Link href="/stock/history" className={btnSecondary}>🕘 ประวัติ</Link>
            </>
          ) : (
            <Link href="/stock/history" className={btnSecondary}>🕘 ประวัติ</Link>
          )
        }
      />

      {doneMsg && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3">🟢 {doneMsg}</div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <form method="get" className="flex gap-2 flex-1 min-w-56 max-w-sm">
          <input name="q" defaultValue={q ?? ""} placeholder="🔍 ค้นหาวัตถุดิบ เช่น หมูบด"
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm bg-white" />
          <button className={btnSecondary}>ค้นหา</button>
        </form>
        {[["", "ทั้งหมด"], ["low", "🟡 ใกล้หมด"], ["out", "🔴 หมด/ติดลบ"]].map(([key, label]) => (
          <Link key={key} href={key ? `/stock?filter=${key}` : "/stock"}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border self-center ${(filter ?? "") === key ? "bg-[#1e3a5f] text-white border-[#1e3a5f]" : "bg-white border-gray-300 text-gray-600"}`}>
            {label}
          </Link>
        ))}
        <Link href="/stock/expiry" className="rounded-full px-4 py-1.5 text-sm font-medium border bg-white border-amber-300 text-amber-700 self-center">
          ⏰ ใกล้หมดอายุ (FEFO)
        </Link>
      </div>

      <Card className="overflow-x-auto">
        {levels.length === 0 ? (
          <EmptyState text="ไม่พบรายการ" />
        ) : (
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 px-3">วัตถุดิบ</th>
                <th className="py-2.5 px-3 text-right">คงเหลือ</th>
                <th className="py-2.5 px-3">หน่วย</th>
                <th className="py-2.5 px-3 text-right">ขั้นต่ำ</th>
                <th className="py-2.5 px-3">สถานะ</th>
                <th className="py-2.5 px-3">อยู่ที่ไหน</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => {
                const status =
                  l.total < 0 ? ["🔴 ติดลบ (ผิดปกติ)", "text-red-700"] :
                  l.total === 0 ? ["🔴 หมด", "text-red-700"] :
                  l.total < l.minStock ? ["🟡 ใกล้หมด", "text-amber-700"] :
                  ["🟢 ปกติ", "text-green-700"];
                return (
                  <tr key={l.ingredientId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="py-2.5 px-3">
                      <Link href={`/stock/issue?ing=${l.ingredientId}`} className="font-medium hover:text-sky-700">{l.name}</Link>
                      <span className="text-xs text-gray-400 ml-1">{l.code}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold">{fmtNum(l.total)}</td>
                    <td className="py-2.5 px-3 text-gray-500">{l.unit}</td>
                    <td className="py-2.5 px-3 text-right text-gray-400">{fmtNum(l.minStock)}</td>
                    <td className={`py-2.5 px-3 text-xs font-medium ${status[1]}`}>{status[0]}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">
                      {l.byLocation.map((b) => `${b.locationName} (${fmtNum(b.qty)})`).join(" · ") || "—"}
                    </td>
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
