import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { BomEditor } from "@/features/menu/bom-editor";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { getRecipeVersionDetail, listRecipeItemOptions } from "@/repositories/bom-repository";
import { listMealPeriods } from "@/services/bom-service";

export const dynamic = "force-dynamic";

export default async function RecipeVersionPage({
  params,
}: {
  params: Promise<{ menuId: string; versionId: string }>;
}) {
  const user = await requirePagePermission(PERMISSIONS.RECIPE_VIEW);
  const { menuId, versionId } = await params;

  const [detail, periods, itemOptions] = await Promise.all([
    getRecipeVersionDetail(user.organizationId, versionId),
    listMealPeriods(user.organizationId),
    listRecipeItemOptions(user.organizationId),
  ]);

  if (!detail || detail.version.menuId !== menuId) notFound();

  const { version, lines } = detail;
  const canManage = hasPermission(user.permissions, PERMISSIONS.RECIPE_MANAGE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${version.menuNameTh} · เวอร์ชัน ${version.versionNo}`}
        description={`${version.menuCode} · เริ่มใช้ ${version.effectiveFrom}`}
        actions={
          version.isPublished ? (
            <StatusBadge tone="success">เผยแพร่แล้ว</StatusBadge>
          ) : (
            <StatusBadge tone="warning">ฉบับร่าง</StatusBadge>
          )
        }
      />

      {version.isPublished || !canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>วัตถุดิบในสูตร</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="rounded-[var(--radius-control)] border border-border p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{line.itemNameTh}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">{line.itemCode}</p>
                    </div>
                    <p className="shrink-0 text-xl font-semibold tabular-nums text-ink">
                      {formatQty(line.quantity)}
                      <span className="ml-1 text-sm font-normal text-ink-muted">
                        {line.unitCode ?? ""}
                      </span>
                    </p>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {line.periods.map((period) => (
                      <StatusBadge key={period.mealPeriodId} tone="info">
                        {period.nameTh} {formatQty(period.quantity)}
                      </StatusBadge>
                    ))}
                    {Number(line.wasteFactor) > 0 ? (
                      <StatusBadge tone="muted">
                        เผื่อสูญเสีย {Math.round(Number(line.wasteFactor) * 100)}%
                      </StatusBadge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            {lines.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">สูตรนี้ยังไม่มีวัตถุดิบ</p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <BomEditor
          recipeVersionId={version.id}
          menuId={menuId}
          versionNo={version.versionNo}
          isPublished={version.isPublished}
          yieldQty={version.yieldQty}
          initialLines={lines}
          periods={periods}
          itemOptions={itemOptions}
        />
      )}

      <p className="text-sm text-ink-muted">
        <Link
          href={`/menu/recipes/${menuId}`}
          className="text-brand underline-offset-4 hover:underline"
        >
          กลับไปดูทุกเวอร์ชันของเมนูนี้
        </Link>
      </p>
    </div>
  );
}
