import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getExpiryAlerts } from "@/lib/stock";
import { PageHeader, Card, EmptyState, btnSecondary } from "@/components/ui";
import { fmtNum, fmtDate } from "@/lib/format";

export const metadata = { title: "ใกล้หมดอายุ (FEFO)" };
export const dynamic = "force-dynamic";

export default async function ExpiryPage() {
  await requireSession();
  const alerts = await getExpiryAlerts(14);
  const expired = alerts.filter((a) => a.daysLeft < 0);
  const soon = alerts.filter((a) => a.daysLeft >= 0 && a.daysLeft <= 3);
  const later = alerts.filter((a) => a.daysLeft > 3);

  const Group = ({ title, rows, tone }: { title: string; rows: typeof alerts; tone: string }) => (
    <Card className={`overflow-hidden mb-4 ${tone}`}>
      <div className="px-4 py-2.5 font-semibold border-b border-gray-200 bg-gray-50">{title} ({rows.length})</div>
      {rows.length === 0 ? <EmptyState text="ไม่มีรายการ" /> : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((a, i) => (
              <tr key={i} className="border-b border-gray-100 last:border-0">
                <td className="py-2.5 px-4 font-medium">{a.ingredientName}</td>
                <td className="py-2.5 px-4 text-gray-400 text-xs">{a.lotCode}</td>
                <td className="py-2.5 px-4 text-right">{fmtNum(a.qty)}</td>
                <td className="py-2.5 px-4 whitespace-nowrap">{fmtDate(a.expiryDate)}</td>
                <td className={`py-2.5 px-4 text-right font-medium whitespace-nowrap ${a.daysLeft < 0 ? "text-red-700" : a.daysLeft <= 3 ? "text-amber-700" : "text-gray-500"}`}>
                  {a.daysLeft < 0 ? `หมดอายุแล้ว ${-a.daysLeft} วัน` : a.daysLeft === 0 ? "หมดอายุวันนี้" : `เหลือ ${a.daysLeft} วัน`}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <Link href={`/stock/issue?ing=${encodeURIComponent(a.ingredientName)}`} className="text-xs text-sky-700 font-medium">เบิกใช้ →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader title="ใกล้หมดอายุ / FEFO" subtitle="First Expire First Out — ใช้ Lot ที่หมดอายุก่อนเป็นอันดับแรก"
        actions={<Link href="/stock" className={btnSecondary}>← Stock</Link>} />
      <Group title="🔴 หมดอายุแล้ว — ต้องจัดการทันที" rows={expired} tone="border-red-300" />
      <Group title="🟡 ใกล้หมดอายุใน 3 วัน — ควรใช้ก่อน" rows={soon} tone="border-amber-300" />
      <Group title="🔵 หมดอายุใน 14 วัน" rows={later} tone="" />
    </>
  );
}
