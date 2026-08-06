import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getStockLevels } from "@/lib/stock";
import { PageHeader, Card, btnPrimary, btnSecondary } from "@/components/ui";
import { fmtNum } from "@/lib/format";
import { adjustStock } from "../actions";

export const metadata = { title: "ปรับ Stock / ตรวจนับ" };
export const dynamic = "force-dynamic";

export default async function AdjustPage() {
  await requireSession();
  const [levels, locations] = await Promise.all([
    getStockLevels(),
    db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);

  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title="ปรับ Stock / ตรวจนับ" subtitle="ใช้เมื่อยอดในระบบไม่ตรงกับของจริง — ต้องระบุเหตุผลทุกครั้ง และบันทึกลง Audit Log"
        actions={<Link href="/stock" className={btnSecondary}>← Stock</Link>} />

      <Card className="p-3 mb-4 border-amber-300 bg-amber-50 text-sm text-amber-900">
        🟡 การปรับ Stock ไม่ลบธุรกรรมเดิม — ระบบบันทึกเป็นรายการปรับเพิ่มเติม ทำให้ตรวจสอบย้อนหลังได้เสมอ
      </Card>

      <Card className="p-4">
        <form action={adjustStock} className="space-y-4">
          <label className="text-sm block">
            <span className="block text-xs text-gray-500 mb-1">วัตถุดิบ *</span>
            <select name="ingredientId" required defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white">
              <option value="" disabled>เลือก…</option>
              {levels.map((l) => (
                <option key={l.ingredientId} value={l.ingredientId}>{l.name} — ระบบว่าเหลือ {fmtNum(l.total)} {l.unit}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">ปรับ (+เพิ่ม / -ลด) *</span>
              <input name="qty" type="number" step="0.01" required placeholder="เช่น -2.5"
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-right text-lg" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 mb-1">Location *</span>
              <select name="locationId" required defaultValue="" className="w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white">
                <option value="" disabled>เลือก…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
              </select>
            </label>
          </div>
          <label className="text-sm block">
            <span className="block text-xs text-gray-500 mb-1">เหตุผล (บังคับ) *</span>
            <input name="note" required placeholder="เช่น ตรวจนับพบของเสียหาย 2 kg"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm" />
          </label>
          <button className={btnPrimary + " w-full py-3 text-base"}>✓ บันทึกการปรับ</button>
        </form>
      </Card>
    </div>
  );
}
