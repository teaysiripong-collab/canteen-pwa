import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getLotBalances, getStockLevels } from "@/lib/stock";
import { PageHeader, Card, btnSecondary } from "@/components/ui";
import IssueForm from "@/components/IssueForm";
import { fmtNum, fmtDate } from "@/lib/format";
import { getConfig } from "@/lib/config";
import { issueStock } from "../actions";

export const metadata = { title: "เบิกของ" };
export const dynamic = "force-dynamic";

export default async function IssuePage({ searchParams }: { searchParams: Promise<{ ing?: string; q?: string }> }) {
  const session = await requireSession();
  const { ing, q } = await searchParams;
  const cfg = await getConfig();

  // ── Step 2: form for a chosen ingredient (FEFO lot preselected) ──
  if (ing) {
    const ingredient = await db.ingredient.findUnique({ where: { id: ing }, include: { stockUnit: true } });
    if (!ingredient) return null;
    const lots = await getLotBalances(ing);
    const locations = await db.location.findMany({ where: { active: true }, orderBy: { code: "asc" } });
    // Show what is actually on hand per location so staff cannot pick an empty one by mistake
    const perLocation = await db.stockTransaction.groupBy({
      by: ["locationId"],
      where: { ingredientId: ing },
      _sum: { qty: true },
    });
    const balanceAt = new Map(perLocation.map((p) => [p.locationId, Number(p._sum.qty ?? 0)]));
    const locName = new Map(
      locations.map((l) => {
        const bal = balanceAt.get(l.id) ?? 0;
        return [l.id, `${l.code} — ${l.name} · เหลือ ${fmtNum(bal)} ${ingredient.stockUnit.code}`];
      })
    );
    const stockedLocations = locations.filter((l) => (balanceAt.get(l.id) ?? 0) > 0.0001);
    const emptyLocations = locations.filter((l) => (balanceAt.get(l.id) ?? 0) <= 0.0001);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const todayMenus = await db.menuPlanEntry.findMany({
      where: { date: today }, include: { menu: true }, orderBy: { shift: "asc" },
    });
    const fefoLot = lots[0];

    return (
      <div className="max-w-xl mx-auto">
        <PageHeader title={`เบิก: ${ingredient.name}`}
          subtitle={`คงเหลือรวม ${fmtNum(lots.reduce((s, l) => s + l.qty, 0))} ${ingredient.stockUnit.code}`}
          actions={<Link href="/stock/issue" className={btnSecondary}>← เลือกรายการอื่น</Link>} />

        {fefoLot && (
          <Card className="p-3 mb-4 border-sky-300 bg-sky-50 text-sm">
            🔵 <b>FEFO แนะนำ:</b> ใช้ Lot <b>{fefoLot.lotCode}</b>
            {fefoLot.expiryDate && <> (หมดอายุ {fmtDate(fefoLot.expiryDate)})</>} ก่อน — เปลี่ยนได้หากมีเหตุผล
          </Card>
        )}

        <Card className="p-4">
          <IssueForm
            action={issueStock}
            ingredientId={ingredient.id}
            unitCode={ingredient.stockUnit.code}
            defaultLotId={fefoLot?.lotId ?? ""}
            defaultLocationId={fefoLot?.locationId ?? stockedLocations[0]?.id ?? ""}
            lots={lots.map((l, i) => ({
              id: l.lotId,
              label: `${i === 0 ? "⭐ " : ""}${l.lotCode} · เหลือ ${fmtNum(l.qty)}${l.expiryDate ? ` · หมดอายุ ${fmtDate(l.expiryDate)}` : ""}`,
            }))}
            stockedLocations={stockedLocations.map((l) => ({ id: l.id, label: locName.get(l.id) ?? l.name }))}
            emptyLocations={emptyLocations.map((l) => ({ id: l.id, label: locName.get(l.id) ?? l.name }))}
            todayMenus={todayMenus.map((e) => ({
              id: e.menuId,
              label: `${e.shift === "MORNING" ? "☀️" : "🌙"} ${e.menu.name}`,
            }))}
            userName={session.name}
            shiftLabels={{ morning: cfg.shifts.MORNING.label, night: cfg.shifts.NIGHT.label }}
          />
        </Card>
      </div>
    );
  }

  // ── Step 1: quick select (favorites = most issued, recent, search) ──
  const levels = await getStockLevels();
  const recentIssues = await db.stockTransaction.findMany({
    where: { type: "ISSUE" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { ingredientId: true },
  });
  const freq = new Map<string, number>();
  recentIssues.forEach((t, i) => freq.set(t.ingredientId, (freq.get(t.ingredientId) ?? 0) + (i < 10 ? 3 : 1)));
  const filtered = q ? levels.filter((l) => l.name.includes(q)) : levels;
  const sorted = [...filtered].sort((a, b) => (freq.get(b.ingredientId) ?? 0) - (freq.get(a.ingredientId) ?? 0));

  return (
    <>
      <PageHeader title="เบิกของ" subtitle="กดที่รายการเพื่อเบิก — รายการที่เบิกบ่อยอยู่บนสุด พิมพ์น้อยที่สุด"
        actions={<Link href="/stock" className={btnSecondary}>← Stock</Link>} />
      <form method="get" className="mb-4 flex gap-2 max-w-md">
        <input name="q" defaultValue={q ?? ""} placeholder="🔍 ค้นหา…" className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm bg-white" />
        <button className={btnSecondary}>ค้นหา</button>
      </form>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {sorted.map((l, i) => (
          <Link key={l.ingredientId} href={`/stock/issue?ing=${l.ingredientId}`}>
            <Card className={`p-4 h-full hover:shadow-md transition-shadow ${l.total <= 0 ? "opacity-50" : ""}`}>
              <div className="font-semibold text-sm">{i < 4 && (freq.get(l.ingredientId) ?? 0) > 0 ? "⭐ " : ""}{l.name}</div>
              <div className={`text-xs mt-1 ${l.total < l.minStock ? "text-amber-700" : "text-gray-500"}`}>
                เหลือ {fmtNum(l.total)} {l.unit}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
