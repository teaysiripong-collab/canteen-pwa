import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader, Card, EmptyState, btnSecondary } from "@/components/ui";

export const metadata = { title: "คลังสูตรอาหาร" };
export const dynamic = "force-dynamic";

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ q?: string; menu?: string; cat?: string }> }) {
  await requireSession();
  const { q, menu, cat } = await searchParams;

  const recipes = await db.recipe.findMany({
    where: {
      isCurrent: true,
      menu: {
        active: true,
        ...(menu ? { id: menu } : {}),
        ...(q ? { name: { contains: q } } : {}),
        ...(cat ? { categoryId: cat } : {}),
      },
    },
    include: { menu: { include: { category: true } }, ingredients: true, updatedBy: true },
    orderBy: { menu: { name: "asc" } },
  });
  const categories = await db.category.findMany({ where: { type: "MENU" }, orderBy: { name: "asc" } });

  return (
    <>
      <PageHeader title="คลังสูตรอาหาร" subtitle="เปิดดูสูตรได้ทันทีจากมือถือ — สแกน QR ในครัวเพื่อเปิดสูตรล่าสุด" />

      <form className="flex flex-wrap gap-2 mb-4" method="get">
        <input name="q" defaultValue={q ?? ""} placeholder="🔍 ค้นหาสูตร เช่น กะเพรา"
          className="flex-1 min-w-48 max-w-sm rounded-lg border border-gray-300 px-4 py-2 text-sm bg-white" />
        <select name="cat" defaultValue={cat ?? ""} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
          <option value="">ทุกหมวด</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn rounded-lg bg-[#1e3a5f] text-white px-4 text-sm font-semibold">ค้นหา</button>
        {(q || cat || menu) && <Link href="/recipes" className={btnSecondary}>ล้าง</Link>}
      </form>

      {recipes.length === 0 ? (
        <Card className="p-4"><EmptyState text={`ไม่พบสูตรอาหาร${q ? `ที่ตรงกับ "${q}"` : ""}`} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((r) => (
            <Link key={r.id} href={`/recipes/${r.id}`}>
              <Card className="p-4 h-full hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-[#1e3a5f]">{r.menu.favorite ? "⭐ " : ""}{r.menu.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{r.menu.category?.name ?? "-"} · v{r.version}</div>
                  </div>
                  <div className="text-3xl">🍳</div>
                </div>
                <div className="text-xs text-gray-500 mt-3 flex gap-3">
                  <span>🥬 {r.ingredients.length} วัตถุดิบ</span>
                  {r.timeMinutes && <span>⏱️ {r.timeMinutes} นาที</span>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
