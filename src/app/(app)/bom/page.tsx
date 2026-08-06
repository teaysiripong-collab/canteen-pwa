import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { PageHeader, Card, Section, EmptyState, btnSecondary, btnPrimary } from "@/components/ui";
import { fmtNum, fmtDate, fmtDateShort, mondayOf, ymd } from "@/lib/format";
import { getConfig } from "@/lib/config";
import { updateBomLine, deleteBomLine, addBomLine, applySuggestedBom } from "./actions";

export const metadata = { title: "BOM วัตถุดิบ" };
export const dynamic = "force-dynamic";

export default async function BomPage({ searchParams }: {
  searchParams: Promise<{ entry?: string; from?: string; to?: string }>;
}) {
  const session = await requireSession();
  const editable = can(session.role, "bom", "edit");
  const { entry, from, to } = await searchParams;
  const cfg = await getConfig();

  // ── Mode 1: edit BOM of a single plan entry (menu on a date+shift) ──
  if (entry) {
    const planEntry = await db.menuPlanEntry.findUnique({
      where: { id: entry },
      include: {
        menu: true, plan: true,
        bomLines: { include: { ingredient: true, unit: true }, orderBy: { ingredient: { name: "asc" } } },
      },
    });
    if (!planEntry) return <EmptyState text="ไม่พบรายการ" />;
    const locked = planEntry.plan.status === "APPROVED" || !editable;
    const ingredients = await db.ingredient.findMany({ where: { active: true }, orderBy: { name: "asc" } });

    return (
      <>
        <PageHeader
          title={`BOM: ${planEntry.menu.name}`}
          subtitle={`${fmtDate(planEntry.date)} · ${cfg.shifts[planEntry.shift].label}${locked ? " · 🔒 แผนอนุมัติแล้ว" : ""}`}
          actions={<Link href="/bom" className={btnSecondary}>← BOM รวม</Link>}
        />
        <Card className="p-4 max-w-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="py-2">วัตถุดิบ</th>
                <th className="py-2 text-right w-36">ปริมาณ</th>
                <th className="py-2 w-14">หน่วย</th>
                {!locked && <th className="w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {planEntry.bomLines.map((l) => (
                <tr key={l.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 font-medium">{l.ingredient.name}</td>
                  <td className="py-1 text-right">
                    {locked ? (
                      fmtNum(Number(l.qty))
                    ) : (
                      <form action={updateBomLine.bind(null, l.id)} className="flex gap-1 justify-end">
                        <input name="qty" type="number" step="0.01" min="0" defaultValue={Number(l.qty)}
                          className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-right text-sm" />
                        <button className="text-xs text-sky-700 font-medium px-1" style={{ minHeight: "auto" }}>บันทึก</button>
                      </form>
                    )}
                  </td>
                  <td className="py-2 text-gray-500">{l.unit.code}</td>
                  {!locked && (
                    <td>
                      <form action={deleteBomLine.bind(null, l.id)}>
                        <button className="text-gray-400 hover:text-red-600 text-xs" style={{ minHeight: "auto" }} title="ลบ">✕</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!locked && (
            <form action={addBomLine.bind(null, planEntry.id)} className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
              <select name="ingredientId" required defaultValue="" className="flex-1 min-w-40 rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white">
                <option value="" disabled>+ เพิ่มวัตถุดิบ…</option>
                {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <input name="qty" type="number" step="0.01" min="0.01" required placeholder="ปริมาณ"
                className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm" />
              <button className={btnPrimary}>เพิ่ม</button>
            </form>
          )}
        </Card>
      </>
    );
  }

  // ── Mode 2: aggregate BOM over a date range ──
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const weekStart = mondayOf(today);
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 5);
  const fromD = from ? new Date(from + "T00:00:00Z") : weekStart;
  const toD = to ? new Date(to + "T00:00:00Z") : weekEnd;

  const lines = await db.bomLine.findMany({
    where: { planEntry: { date: { gte: fromD, lte: toD } } },
    include: {
      ingredient: { include: { defaultVendor: true } },
      unit: true,
      planEntry: { include: { menu: true } },
    },
  });

  // Aggregate per ingredient with shift breakdown
  type Agg = { name: string; unit: string; vendor: string; morning: number; night: number; total: number };
  const agg = new Map<string, Agg>();
  for (const l of lines) {
    const key = l.ingredientId;
    const a = agg.get(key) ?? {
      name: l.ingredient.name, unit: l.unit.code,
      vendor: l.ingredient.defaultVendor?.name ?? "-", morning: 0, night: 0, total: 0,
    };
    const q = Number(l.qty);
    if (l.planEntry.shift === "MORNING") a.morning += q; else a.night += q;
    a.total += q;
    agg.set(key, a);
  }
  const rows = [...agg.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));

  // ── BOM Learning: compare template vs average actual usage ──
  const templates = await db.bomTemplate.findMany({
    where: { isCurrent: true },
    include: { items: { include: { ingredient: true, unit: true } }, menu: true },
  });
  const usage = await db.usageRecord.groupBy({
    by: ["menuId", "ingredientId"],
    _avg: { qty: true },
    _count: true,
    where: { shift: "MORNING", menuId: { not: null } },
  });
  const suggestions: { menuId: string; menuName: string; ingredientId: string; ingName: string; current: number; suggested: number; samples: number; unit: string }[] = [];
  for (const t of templates) {
    for (const item of t.items) {
      const u = usage.find((x) => x.menuId === t.menuId && x.ingredientId === item.ingredientId);
      if (u && u._count >= 3) {
        const suggested = Math.round(Number(u._avg.qty) * 100) / 100;
        const current = Number(item.qty);
        if (Math.abs(suggested - current) / current > 0.03) {
          suggestions.push({
            menuId: t.menuId, menuName: t.menu.name, ingredientId: item.ingredientId,
            ingName: item.ingredient.name, current, suggested, samples: u._count, unit: item.unit.code,
          });
        }
      }
    }
  }

  return (
    <>
      <PageHeader
        title="BOM / แผนวัตถุดิบ"
        subtitle="ปริมาณตามแผน — แยกจาก Stock จริงเสมอ ใช้ Stock เป็นข้อมูลประกอบตอนสั่งซื้อเท่านั้น"
        actions={<Link href={`/purchase/plan?from=${ymd(fromD)}&to=${ymd(toD)}`} className={btnPrimary}>🛒 สร้างแผนสั่งซื้อจาก BOM →</Link>}
      />

      <form className="flex flex-wrap items-end gap-2 mb-4" method="get">
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

      <Card className="overflow-x-auto mb-5">
        {rows.length === 0 ? (
          <EmptyState text="ไม่มี BOM ในช่วงวันที่เลือก — เพิ่มเมนูในแผนเมนูก่อน" />
        ) : (
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 px-3">วัตถุดิบ</th>
                <th className="py-2.5 px-3">Vendor หลัก</th>
                <th className="py-2.5 px-3 text-right">☀️ {cfg.shifts.MORNING.label}</th>
                <th className="py-2.5 px-3 text-right">🌙 {cfg.shifts.NIGHT.label}</th>
                <th className="py-2.5 px-3 text-right font-semibold">รวม</th>
                <th className="py-2.5 px-3">หน่วย</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="py-2.5 px-3 font-medium">{r.name}</td>
                  <td className="py-2.5 px-3 text-gray-500">{r.vendor}</td>
                  <td className="py-2.5 px-3 text-right">{fmtNum(r.morning)}</td>
                  <td className="py-2.5 px-3 text-right">{fmtNum(r.night)}</td>
                  <td className="py-2.5 px-3 text-right font-semibold">{fmtNum(r.total)}</td>
                  <td className="py-2.5 px-3 text-gray-500">{r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* รายการเมนูในช่วง เพื่อเข้าไปแก้ BOM รายเมนู */}
      <Section title="แก้ BOM รายเมนู (คลิกเพื่อแก้ไข)">
        <div className="flex flex-wrap gap-2">
          {[...new Map(lines.map((l) => [l.planEntryId, l.planEntry])).values()]
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map((e) => (
              <Link key={e.id} href={`/bom?entry=${e.id}`}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm hover:border-sky-400">
                {fmtDateShort(e.date)} · {e.shift === "MORNING" ? "☀️" : "🌙"} {e.menu.name}
              </Link>
            ))}
        </div>
      </Section>

      {/* BOM Learning */}
      {suggestions.length > 0 && (
        <div className="mt-5">
          <Section title="🧠 BOM Learning — ระบบแนะนำจากการใช้จริง (ต้องให้หัวหน้ายืนยัน ไม่แก้อัตโนมัติ)">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2">เมนู / วัตถุดิบ</th>
                  <th className="py-2 text-right">BOM ปัจจุบัน</th>
                  <th className="py-2 text-right">ใช้จริงเฉลี่ย</th>
                  <th className="py-2 text-right">ข้อมูล</th>
                  {editable && <th className="py-2 text-right">ยืนยัน</th>}
                </tr>
              </thead>
              <tbody>
                {suggestions.map((sg) => (
                  <tr key={sg.menuId + sg.ingredientId} className="border-b border-gray-100 last:border-0">
                    <td className="py-2.5"><b>{sg.menuName}</b> — {sg.ingName}</td>
                    <td className="py-2.5 text-right">{fmtNum(sg.current)} {sg.unit}</td>
                    <td className="py-2.5 text-right text-amber-700 font-semibold">{fmtNum(sg.suggested)} {sg.unit}</td>
                    <td className="py-2.5 text-right text-xs text-gray-400">{sg.samples} ครั้งล่าสุด</td>
                    {editable && (
                      <td className="py-2.5 text-right">
                        <form action={applySuggestedBom.bind(null, sg.menuId, sg.ingredientId, sg.suggested)}>
                          <button className="rounded-lg bg-amber-500 text-white text-xs font-semibold px-3 py-1.5 hover:bg-amber-600" style={{ minHeight: "auto" }}>
                            ✓ ใช้ค่า {fmtNum(sg.suggested)}
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      )}
    </>
  );
}
