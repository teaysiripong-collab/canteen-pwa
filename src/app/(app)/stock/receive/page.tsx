import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader, Card, btnPrimary, btnSecondary } from "@/components/ui";
import { receiveStock } from "../actions";

export const metadata = { title: "รับของเข้า Stock" };
export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  await requireSession();
  const [ingredients, locations, openPos] = await Promise.all([
    db.ingredient.findMany({ where: { active: true }, include: { stockUnit: true }, orderBy: { name: "asc" } }),
    db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.purchaseOrder.findMany({ where: { status: { in: ["ORDERED", "PARTIAL"] } }, include: { vendor: true }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title="รับของเข้า Stock" subtitle="รับของนอก PO — หากรับตามใบสั่งซื้อ ให้เปิดจากใบสั่งซื้อเพื่อตัดยอดค้างรับอัตโนมัติ"
        actions={<Link href="/stock" className={btnSecondary}>← Stock</Link>} />

      {openPos.length > 0 && (
        <Card className="p-4 mb-4 border-sky-300 bg-sky-50">
          <div className="text-sm font-semibold text-sky-900 mb-2">🔵 ใบสั่งซื้อที่รอรับของ — รับจากตรงนี้จะตัดยอดค้างรับให้</div>
          <div className="flex flex-wrap gap-2">
            {openPos.map((po) => (
              <Link key={po.id} href={`/purchase/${po.id}`} className="rounded-lg bg-white border border-sky-300 px-3 py-1.5 text-sm hover:border-sky-500">
                {po.code} · {po.vendor.name}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <form action={receiveStock} className="space-y-4">
          <label className="text-sm block">
            <span className="block text-xs text-gray-500 mb-1">วัตถุดิบ *</span>
            <select name="ingredientId" required defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white">
              <option value="" disabled>เลือก…</option>
              {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.stockUnit.code})</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">จำนวน *</span>
              <input name="qty" type="number" step="0.01" min="0.01" required className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-right text-lg" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">เก็บที่ Location *</span>
              <select name="locationId" required defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white">
                <option value="" disabled>เลือก…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">Lot (เว้นว่างให้ระบบสร้าง)</span>
              <input name="lotCode" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">วันหมดอายุ (FEFO)</span>
              <input name="expiry" type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
            </label>
          </div>
          <input name="note" placeholder="หมายเหตุ (ถ้ามี)" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
          <button className={btnPrimary + " w-full py-3 text-base"}>✓ บันทึกรับของ — Stock เพิ่มอัตโนมัติ</button>
        </form>
      </Card>
    </div>
  );
}
