import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { PageHeader, Card, Section, btnSecondary } from "@/components/ui";
import { fmtNum, fmtDateTime } from "@/lib/format";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const recipe = await db.recipe.findUnique({
    where: { id },
    include: {
      menu: { include: { category: true } },
      ingredients: { include: { ingredient: true, unit: true }, orderBy: { sortOrder: "asc" } },
      steps: { orderBy: { stepNo: "asc" } },
      updatedBy: true,
    },
  });
  if (!recipe) notFound();

  const qrTarget = `/recipes/menu/${recipe.menuId}`;

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title={recipe.menu.name}
        subtitle={`${recipe.menu.category?.name ?? ""} · สูตร v${recipe.version} · แก้ไขล่าสุด ${fmtDateTime(recipe.updatedAt)} โดย ${recipe.updatedBy?.name ?? "-"}`}
        actions={
          <>
            <Link href="/recipes" className={btnSecondary}>← กลับ</Link>
            <PrintButton label="🖨️ พิมพ์สูตร" />
          </>
        }
      />

      <div className="print-area space-y-4">
        {(recipe.timeMinutes || recipe.yieldNote) && (
          <Card className="p-4 flex flex-wrap gap-4 text-sm">
            {recipe.timeMinutes && <div>⏱️ เวลาทำ <b>{recipe.timeMinutes} นาที</b></div>}
            {recipe.yieldNote && <div>🍽️ {recipe.yieldNote}</div>}
          </Card>
        )}

        <Section title="🥬 วัตถุดิบ">
          <table className="w-full text-sm">
            <tbody>
              {recipe.ingredients.map((ri) => (
                <tr key={ri.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-2.5 font-medium">{ri.ingredient.name}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">{fmtNum(Number(ri.qty))} {ri.unit.code}</td>
                  <td className="py-2.5 pl-3 text-gray-500 text-xs">{ri.prepNote ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="👨‍🍳 วิธีทำ">
          <ol className="space-y-3">
            {recipe.steps.map((s) => (
              <li key={s.id} className="flex gap-3">
                <span className="shrink-0 w-8 h-8 rounded-full bg-[#1e3a5f] text-white flex items-center justify-center font-bold text-sm">
                  {s.stepNo}
                </span>
                <p className="text-[15px] leading-relaxed pt-1">{s.instruction}</p>
              </li>
            ))}
          </ol>
        </Section>

        {recipe.controlPoints && (
          <Card className="p-4 border-amber-300 bg-amber-50">
            <div className="font-semibold text-amber-800 mb-1">⚠️ จุดควบคุมสำคัญ</div>
            <p className="text-sm text-amber-900">{recipe.controlPoints}</p>
          </Card>
        )}

        {recipe.notes && (
          <Card className="p-4">
            <div className="font-semibold mb-1">📝 หมายเหตุ</div>
            <p className="text-sm">{recipe.notes}</p>
          </Card>
        )}

        <Section title="📱 QR Code สำหรับติดหน้าครัว">
          <div className="flex items-center gap-4">
            {/* QR always opens the LATEST version of this menu's recipe */}
            <img src={`/api/qr?path=${encodeURIComponent(qrTarget)}`} alt="QR Code" width={140} height={140} className="border border-gray-200 rounded-lg" />
            <p className="text-sm text-gray-500">
              สแกนแล้วเปิด <b>สูตรล่าสุด</b> ของเมนูนี้เสมอ แม้สูตรจะถูกปรับ Version ใหม่ — พิมพ์หน้านี้แล้วตัด QR ไปติดบริเวณครัวได้
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
