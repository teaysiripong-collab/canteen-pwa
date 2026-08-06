import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getStockLevels } from "@/lib/stock";
import { PageHeader, Card, btnPrimary, btnSecondary } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { transferStock } from "../actions";

export const metadata = { title: "โอนของระหว่าง Location" };
export const dynamic = "force-dynamic";

export default async function TransferPage() {
  await requireSession();
  const [levels, locations] = await Promise.all([
    getStockLevels(),
    db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);
  const inStock = levels.filter((l) => l.total > 0);

  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title="โอนของระหว่าง Location" subtitle="ย้ายของจากที่เก็บหนึ่งไปอีกที่ — ยอดรวมทั้งระบบไม่เปลี่ยน"
        actions={<Link href="/stock" className={btnSecondary}>← Stock</Link>} />
      <Card className="p-4">
        <form action={transferStock} className="space-y-4">
          <label className="text-sm block">
            <span className="block text-xs text-gray-500 mb-1">วัตถุดิบ *</span>
            <select name="ingredientId" required defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white">
              <option value="" disabled>เลือก…</option>
              {inStock.map((l) => (
                <option key={l.ingredientId} value={l.ingredientId}>
                  {l.name} — เหลือ {fmtNum(l.total)} {l.unit} ({l.byLocation.map((b) => `${b.locationName}: ${fmtNum(b.qty)}`).join(", ")})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm block">
            <span className="block text-xs text-gray-500 mb-1">จำนวนที่โอน *</span>
            <input name="qty" type="number" step="0.01" min="0.01" required className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-right text-lg" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">จาก *</span>
              <select name="fromId" required defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white">
                <option value="" disabled>เลือก…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">ไปที่ *</span>
              <select name="toId" required defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white">
                <option value="" disabled>เลือก…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
              </select>
            </label>
          </div>
          <input name="note" placeholder="หมายเหตุ (ถ้ามี)" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
          <button className={btnPrimary + " w-full py-3 text-base"}>⇄ ยืนยันโอน</button>
        </form>
      </Card>
    </div>
  );
}
