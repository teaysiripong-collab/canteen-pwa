import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getStockLevels } from "@/lib/stock";
import { PageHeader, Card, Section, EmptyState } from "@/components/ui";
import { fmtNum, fmtDate } from "@/lib/format";
import { getConfig } from "@/lib/config";

export const metadata = { title: "ค้นหา" };
export const dynamic = "force-dynamic";

/** Global search: one query answers "where is it, who uses it, is it ordered, how much was used". */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSession();
  const q = (await searchParams).q?.trim();
  const cfg = await getConfig();

  if (!q) {
    return (
      <>
        <PageHeader title="ค้นหา" subtitle="พิมพ์ชื่อวัตถุดิบหรือเมนู เช่น หมูบด หรือ กะเพรา" />
        <Card className="p-4"><EmptyState text="ยังไม่ได้ระบุคำค้นหา" /></Card>
      </>
    );
  }

  const [ingredients, menus] = await Promise.all([
    db.ingredient.findMany({
      where: { OR: [{ name: { contains: q } }, { code: { contains: q, mode: "insensitive" } }] },
      include: { stockUnit: true, defaultVendor: true, storage: { include: { parent: { include: { parent: true } } } } },
      take: 10,
    }),
    db.menu.findMany({
      where: { name: { contains: q } },
      include: { recipes: { where: { isCurrent: true } }, category: true },
      take: 10,
    }),
  ]);

  const ingIds = ingredients.map((i) => i.id);
  const menuIds = menus.map((m) => m.id);

  const [levels, bomLines, poItems, usage, recipeUses, menuEntries] = await Promise.all([
    ingIds.length ? getStockLevels() : Promise.resolve([]),
    ingIds.length
      ? db.bomLine.findMany({
          where: { ingredientId: { in: ingIds } },
          include: { unit: true, ingredient: true, planEntry: { include: { menu: true } } },
          orderBy: { planEntry: { date: "desc" } },
          take: 12,
        })
      : Promise.resolve([]),
    ingIds.length
      ? db.purchaseOrderItem.findMany({
          where: { ingredientId: { in: ingIds } },
          include: { po: { include: { vendor: true } }, unit: true, ingredient: true },
          orderBy: { po: { createdAt: "desc" } },
          take: 10,
        })
      : Promise.resolve([]),
    ingIds.length
      ? db.usageRecord.findMany({
          where: { ingredientId: { in: ingIds } },
          include: { unit: true, menu: true, ingredient: true },
          orderBy: { date: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
    ingIds.length
      ? db.recipeIngredient.findMany({
          where: { ingredientId: { in: ingIds }, recipe: { isCurrent: true } },
          include: { recipe: { include: { menu: true } }, ingredient: true },
          take: 12,
        })
      : Promise.resolve([]),
    menuIds.length
      ? db.menuPlanEntry.findMany({
          where: { menuId: { in: menuIds } },
          include: { menu: true },
          orderBy: { date: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
  ]);

  const relevantLevels = levels.filter((l) => ingIds.includes(l.ingredientId));
  const nothing = ingredients.length === 0 && menus.length === 0;

  const locPath = (ing: (typeof ingredients)[number]) => {
    const s = ing.storage;
    if (!s) return "ยังไม่กำหนดที่เก็บ";
    const parts = [s.parent?.parent?.name, s.parent?.name, s.name].filter(Boolean);
    return parts.join(" → ");
  };

  return (
    <>
      <PageHeader title={`ผลการค้นหา: "${q}"`} subtitle={`พบวัตถุดิบ ${ingredients.length} · เมนู ${menus.length}`} />

      {nothing && <Card className="p-4"><EmptyState text="ไม่พบข้อมูลที่ตรงกับคำค้นหา" /></Card>}

      {ingredients.length > 0 && (
        <div className="mb-4">
          <Section title="📦 Stock และที่จัดเก็บ">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2">วัตถุดิบ</th>
                    <th className="py-2 text-right">คงเหลือ</th>
                    <th className="py-2">เก็บอยู่ที่ไหน</th>
                    <th className="py-2">Vendor หลัก</th>
                  </tr>
                </thead>
                <tbody>
                  {ingredients.map((ing) => {
                    const lv = relevantLevels.find((l) => l.ingredientId === ing.id);
                    return (
                      <tr key={ing.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2.5">
                          <Link href={`/stock/issue?ing=${ing.id}`} className="font-medium hover:text-sky-700">{ing.name}</Link>
                          <span className="text-xs text-gray-400 ml-1">{ing.code}</span>
                        </td>
                        <td className="py-2.5 text-right font-semibold">{fmtNum(lv?.total ?? 0)} {ing.stockUnit.code}</td>
                        <td className="py-2.5 text-gray-600 text-xs">
                          {lv && lv.byLocation.length > 0
                            ? lv.byLocation.map((b) => `${b.locationName} (${fmtNum(b.qty)})`).join(" · ")
                            : locPath(ing)}
                        </td>
                        <td className="py-2.5 text-gray-500">{ing.defaultVendor?.name ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {recipeUses.length > 0 && (
          <Section title="🍳 สูตรที่ใช้วัตถุดิบนี้">
            <ul className="divide-y divide-gray-100 text-sm">
              {recipeUses.map((r) => (
                <li key={r.id} className="py-2">
                  <Link href={`/recipes/${r.recipeId}`} className="hover:text-sky-700">
                    {r.recipe.menu.name} <span className="text-gray-400">— ใช้ {r.ingredient.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {menus.length > 0 && (
          <Section title="🍚 เมนูที่ตรงกับคำค้นหา">
            <ul className="divide-y divide-gray-100 text-sm">
              {menus.map((m) => (
                <li key={m.id} className="py-2 flex justify-between">
                  {m.recipes[0] ? (
                    <Link href={`/recipes/${m.recipes[0].id}`} className="hover:text-sky-700 font-medium">{m.name}</Link>
                  ) : (
                    <span className="font-medium">{m.name}</span>
                  )}
                  <span className="text-xs text-gray-400">{m.category?.name ?? ""}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {bomLines.length > 0 && (
          <Section title="📋 BOM ที่วางแผนไว้">
            <ul className="divide-y divide-gray-100 text-sm">
              {bomLines.map((l) => (
                <li key={l.id} className="py-2 flex justify-between gap-2">
                  <Link href={`/bom?entry=${l.planEntryId}`} className="hover:text-sky-700">
                    {fmtDate(l.planEntry.date)} · {cfg.shifts[l.planEntry.shift].label} · {l.planEntry.menu.name}
                  </Link>
                  <span className="whitespace-nowrap text-gray-600">{l.ingredient.name} {fmtNum(Number(l.qty))} {l.unit.code}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {poItems.length > 0 && (
          <Section title="🛒 ประวัติการสั่งซื้อ">
            <ul className="divide-y divide-gray-100 text-sm">
              {poItems.map((it) => (
                <li key={it.id} className="py-2 flex justify-between gap-2">
                  <Link href={`/purchase/${it.poId}`} className="hover:text-sky-700">
                    {it.po.code} · {it.po.vendor.name}
                  </Link>
                  <span className="whitespace-nowrap text-gray-600">
                    {it.ingredient.name} สั่ง {fmtNum(Number(it.orderQty))} {it.unit.code} · รับ {fmtNum(Number(it.receivedQty))}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {usage.length > 0 && (
          <Section title="📊 ประวัติการใช้จริง">
            <ul className="divide-y divide-gray-100 text-sm">
              {usage.map((u) => (
                <li key={u.id} className="py-2 flex justify-between gap-2">
                  <span>{fmtDate(u.date)} · {cfg.shifts[u.shift].label}{u.menu ? ` · ${u.menu.name}` : ""}</span>
                  <span className="whitespace-nowrap font-medium">{u.ingredient.name} {fmtNum(Number(u.qty))} {u.unit.code}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {menuEntries.length > 0 && (
          <Section title="📅 เมนูนี้อยู่ในแผนวันไหน">
            <ul className="divide-y divide-gray-100 text-sm">
              {menuEntries.map((e) => (
                <li key={e.id} className="py-2 flex justify-between">
                  <Link href={`/bom?entry=${e.id}`} className="hover:text-sky-700">{e.menu.name}</Link>
                  <span className="text-gray-500">{fmtDate(e.date)} · {cfg.shifts[e.shift].label}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </>
  );
}
