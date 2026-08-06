import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getStockLevels, getExpiryAlerts } from "@/lib/stock";
import { PageHeader, Section, EmptyState, btnSecondary } from "@/components/ui";
import { fmtNum, fmtBaht, fmtDate, ymd } from "@/lib/format";

export const metadata = { title: "รายงาน" };
export const dynamic = "force-dynamic";

/** Bar rendered with CSS width — no chart library, no decoration that doesn't aid a decision. */
function Bar({ value, max, tone = "bg-[#1e3a5f]" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden w-full min-w-16">
      <div className={`h-full ${tone} rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireSession();
  const { from, to } = await searchParams;

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const fromD = from ? new Date(from + "T00:00:00Z") : monthStart;
  const toD = to ? new Date(to + "T00:00:00Z") : today;

  const [usage, bomLines, pos, levels, expiry, txns] = await Promise.all([
    db.usageRecord.findMany({
      where: { date: { gte: fromD, lte: toD } },
      include: { ingredient: true, unit: true, menu: true },
    }),
    db.bomLine.findMany({
      where: { planEntry: { date: { gte: fromD, lte: toD } } },
      include: { ingredient: true, unit: true, planEntry: { include: { menu: true } } },
    }),
    db.purchaseOrder.findMany({
      where: { status: { notIn: ["CANCELLED", "DRAFT"] } },
      include: { vendor: true, items: true },
    }),
    getStockLevels(),
    getExpiryAlerts(30),
    db.stockTransaction.findMany({
      where: { createdAt: { gte: fromD } },
      include: { ingredient: true },
    }),
  ]);

  // 1. วัตถุดิบที่ใช้มากที่สุด (จริง)
  const usedByIng = new Map<string, { name: string; qty: number; unit: string }>();
  for (const u of usage) {
    const r = usedByIng.get(u.ingredientId) ?? { name: u.ingredient.name, qty: 0, unit: u.unit.code };
    r.qty += Number(u.qty);
    usedByIng.set(u.ingredientId, r);
  }
  const topUsed = [...usedByIng.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
  const maxUsed = topUsed[0]?.qty ?? 0;

  // 2. BOM vs Actual
  const plannedByIng = new Map<string, { name: string; qty: number; unit: string }>();
  for (const l of bomLines) {
    const r = plannedByIng.get(l.ingredientId) ?? { name: l.ingredient.name, qty: 0, unit: l.unit.code };
    r.qty += Number(l.qty);
    plannedByIng.set(l.ingredientId, r);
  }
  const variance = [...usedByIng.entries()]
    .map(([id, a]) => {
      const p = plannedByIng.get(id)?.qty ?? 0;
      return { name: a.name, unit: a.unit, planned: p, actual: a.qty, diff: a.qty - p, pct: p > 0 ? ((a.qty - p) / p) * 100 : 0 };
    })
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

  // 3. เมนูที่ใช้วัตถุดิบมากที่สุด (ตามมูลค่าแผน)
  const unitPrice = (ing: { lastPrice: unknown; conversionFactor: unknown }) =>
    ing.lastPrice ? Number(ing.lastPrice) / Number(ing.conversionFactor) : 0;
  const byMenu = new Map<string, { cost: number; items: number }>();
  for (const l of bomLines) {
    const k = l.planEntry.menu.name;
    const r = byMenu.get(k) ?? { cost: 0, items: 0 };
    r.cost += Number(l.qty) * unitPrice(l.ingredient);
    r.items++;
    byMenu.set(k, r);
  }
  const topMenus = [...byMenu.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 8);
  const maxMenuCost = topMenus[0]?.[1].cost ?? 0;

  // 4. Vendor ส่งไม่ครบ
  const vendorPerf = new Map<string, { name: string; ordered: number; received: number; lines: number; short: number }>();
  for (const po of pos) {
    const r = vendorPerf.get(po.vendorId) ?? { name: po.vendor.name, ordered: 0, received: 0, lines: 0, short: 0 };
    for (const it of po.items) {
      const o = Number(it.orderQty), rec = Number(it.receivedQty);
      r.ordered += o; r.received += rec; r.lines++;
      if (rec < o - 0.001) r.short++;
    }
    vendorPerf.set(po.vendorId, r);
  }

  // 5. Stock หมุนเร็ว / ค้างนาน
  const movement = new Map<string, { name: string; out: number }>();
  for (const t of txns) {
    if (t.type !== "ISSUE") continue;
    const r = movement.get(t.ingredientId) ?? { name: t.ingredient.name, out: 0 };
    r.out += Math.abs(Number(t.qty));
    movement.set(t.ingredientId, r);
  }
  const fastMoving = [...movement.values()].sort((a, b) => b.out - a.out).slice(0, 8);
  const stagnant = levels
    .filter((l) => l.total > 0 && !movement.has(l.ingredientId))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  // 6. Cost รายวัน/สัปดาห์/เดือน
  const plannedCost = bomLines.reduce((s, l) => s + Number(l.qty) * unitPrice(l.ingredient), 0);
  const actualCost = usage.reduce((s, u) => s + Number(u.qty) * unitPrice(u.ingredient), 0);
  const days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);

  // 7. หมดอายุบ่อย
  const expiredOften = expiry.filter((e) => e.daysLeft < 0);

  return (
    <>
      <PageHeader title="รายงาน & Analytics" subtitle="ตอบคำถามที่ใช้จริงหน้างาน ไม่ใช่กราฟที่ไม่ช่วยตัดสินใจ" />

      <form method="get" className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">จากวันที่</span>
          <input type="date" name="from" defaultValue={ymd(fromD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">ถึงวันที่</span>
          <input type="date" name="to" defaultValue={ymd(toD)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
        </label>
        <button className={btnSecondary}>แสดงรายงาน</button>
        <span className="text-sm text-gray-500 ml-2">{fmtDate(fromD)} – {fmtDate(toD)} ({days} วัน)</span>
      </form>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Section title="📊 วัตถุดิบที่ใช้มากที่สุด (ใช้จริง)">
          {topUsed.length === 0 ? <EmptyState text="ยังไม่มีข้อมูลการใช้จริงในช่วงนี้" /> : (
            <table className="w-full text-sm">
              <tbody>
                {topUsed.map((r) => (
                  <tr key={r.name} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 font-medium w-40">{r.name}</td>
                    <td className="py-2 px-2"><Bar value={r.qty} max={maxUsed} /></td>
                    <td className="py-2 text-right whitespace-nowrap font-semibold">{fmtNum(r.qty)} {r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="🍚 เมนูที่ใช้วัตถุดิบมากที่สุด (มูลค่าตามแผน)">
          {topMenus.length === 0 ? <EmptyState text="ไม่มีข้อมูล" /> : (
            <table className="w-full text-sm">
              <tbody>
                {topMenus.map(([name, r]) => (
                  <tr key={name} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 font-medium w-40">{name}</td>
                    <td className="py-2 px-2"><Bar value={r.cost} max={maxMenuCost} tone="bg-amber-500" /></td>
                    <td className="py-2 text-right whitespace-nowrap font-semibold">{fmtBaht(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      <div className="mb-4">
        <Section title="⚖️ BOM (แผน) เทียบกับ Actual (ใช้จริง) — ใช้จริงมากกว่าแผนหรือไม่">
          {variance.length === 0 ? <EmptyState text="ยังไม่มีข้อมูลใช้จริงให้เทียบ" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2">วัตถุดิบ</th>
                    <th className="py-2 text-right">แผน (BOM)</th>
                    <th className="py-2 text-right">ใช้จริง</th>
                    <th className="py-2 text-right">ผลต่าง</th>
                    <th className="py-2 text-right">%</th>
                    <th className="py-2">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {variance.map((v) => (
                    <tr key={v.name} className="border-b border-gray-100 last:border-0">
                      <td className="py-2.5 font-medium">{v.name}</td>
                      <td className="py-2.5 text-right">{fmtNum(v.planned)} {v.unit}</td>
                      <td className="py-2.5 text-right">{fmtNum(v.actual)} {v.unit}</td>
                      <td className={`py-2.5 text-right font-medium ${v.diff > 0 ? "text-red-700" : v.diff < 0 ? "text-green-700" : "text-gray-400"}`}>
                        {v.diff > 0 ? "+" : ""}{fmtNum(v.diff)}
                      </td>
                      <td className="py-2.5 text-right text-gray-500">{v.planned > 0 ? `${v.pct > 0 ? "+" : ""}${v.pct.toFixed(1)}%` : "—"}</td>
                      <td className="py-2.5 text-xs">
                        {Math.abs(v.pct) < 5 ? "🟢 ตรงแผน" : v.pct >= 5 ? "🔴 ใช้เกินแผน" : "🟡 ใช้น้อยกว่าแผน"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2">💡 หากใช้เกินแผนสม่ำเสมอ ระบบจะเสนอ Suggested BOM ที่หน้า BOM ให้หัวหน้ายืนยัน</p>
        </Section>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Section title="🏪 Vendor — ส่งครบหรือไม่">
          {vendorPerf.size === 0 ? <EmptyState text="ยังไม่มีใบสั่งซื้อที่สั่งแล้ว" /> : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2">Vendor</th>
                  <th className="py-2 text-right">สั่ง</th>
                  <th className="py-2 text-right">รับ</th>
                  <th className="py-2 text-right">รายการส่งขาด</th>
                </tr>
              </thead>
              <tbody>
                {[...vendorPerf.values()].map((v) => (
                  <tr key={v.name} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5 font-medium">{v.name}</td>
                    <td className="py-2.5 text-right">{fmtNum(v.ordered)}</td>
                    <td className="py-2.5 text-right">{fmtNum(v.received)}</td>
                    <td className={`py-2.5 text-right font-medium ${v.short > 0 ? "text-red-700" : "text-green-700"}`}>
                      {v.short > 0 ? `🔴 ${v.short}/${v.lines}` : `🟢 ครบ`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="💰 ต้นทุนในช่วงที่เลือก">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-2.5">ต้นทุนตามแผน (BOM)</td><td className="py-2.5 text-right font-semibold">{fmtBaht(plannedCost)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2.5">ต้นทุนจากการใช้จริง</td><td className="py-2.5 text-right font-semibold">{actualCost > 0 ? fmtBaht(actualCost) : "—"}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2.5">เฉลี่ยต่อวัน (แผน)</td><td className="py-2.5 text-right">{fmtBaht(plannedCost / days)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-2.5">ประมาณการ 7 วัน</td><td className="py-2.5 text-right">{fmtBaht((plannedCost / days) * 7)}</td></tr>
              <tr><td className="py-2.5">ประมาณการ 30 วัน</td><td className="py-2.5 text-right">{fmtBaht((plannedCost / days) * 30)}</td></tr>
            </tbody>
          </table>
        </Section>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="🔄 Stock หมุนเร็ว (เบิกออกมากสุด)">
          {fastMoving.length === 0 ? <EmptyState text="ไม่มีข้อมูลการเบิก" /> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {fastMoving.map((m) => (
                <li key={m.name} className="py-2 flex justify-between">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-gray-600">เบิกออก {fmtNum(m.out)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="🐢 Stock ค้างนาน (มีของแต่ไม่ถูกเบิกในช่วงนี้)">
          {stagnant.length === 0 ? <EmptyState text="ไม่มีของค้าง 🟢" /> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {stagnant.map((s) => (
                <li key={s.ingredientId} className="py-2 flex justify-between">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-amber-700">คงเหลือ {fmtNum(s.total)} {s.unit}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {expiredOften.length > 0 && (
        <div className="mt-4">
          <Section title="⏰ รายการที่หมดอายุแล้ว (ควรทบทวนปริมาณสั่ง)">
            <ul className="divide-y divide-gray-100 text-sm">
              {expiredOften.map((e, i) => (
                <li key={i} className="py-2 flex justify-between">
                  <span className="font-medium">{e.ingredientName} <span className="text-gray-400 text-xs">{e.lotCode}</span></span>
                  <span className="text-red-700">เหลือค้าง {fmtNum(e.qty)} · หมดอายุ {fmtDate(e.expiryDate)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </>
  );
}
