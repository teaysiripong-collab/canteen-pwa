import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { OpenDraftButton } from "@/features/menu/open-draft-button";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { getMenuById, listRecipeVersions } from "@/repositories/bom-repository";

export const dynamic = "force-dynamic";

export default async function MenuRecipePage({
  params,
}: {
  params: Promise<{ menuId: string }>;
}) {
  const user = await requirePermission(PERMISSIONS.RECIPE_VIEW);
  const { menuId } = await params;

  const [menu, versions] = await Promise.all([
    getMenuById(user.organizationId, menuId),
    listRecipeVersions(user.organizationId, menuId),
  ]);

  if (!menu) notFound();

  const canManage = hasPermission(user.permissions, PERMISSIONS.RECIPE_MANAGE);
  const hasPublished = versions.some((version) => version.isPublished);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={menu.nameTh}
        description={`รหัส ${menu.code} · ประวัติสูตรทุกเวอร์ชัน`}
        actions={canManage ? <OpenDraftButton menuId={menuId} hasPublished={hasPublished} /> : null}
      />

      <Card>
        <CardHeader>
          <CardTitle>เวอร์ชันของสูตร</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <EmptyState
              title="ยังไม่มีสูตร"
              description="กด “สร้างสูตร” เพื่อกำหนดวัตถุดิบและจำนวนต่อมื้อ"
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {versions.map((version) => (
                <li key={version.id}>
                  <Link
                    href={`/menu/recipes/${menuId}/${version.id}`}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3 hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-ink">เวอร์ชัน {version.versionNo}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        เริ่มใช้ {version.effectiveFrom} · ทำได้ {formatQty(version.yieldQty)} เสิร์ฟ
                      </p>
                    </div>
                    {version.isPublished ? (
                      <StatusBadge tone="success">เผยแพร่แล้ว</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">ฉบับร่าง</StatusBadge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {hasPublished ? (
        <p className="text-sm text-ink-muted">
          สูตรที่เผยแพร่แล้วแก้ไม่ได้ การกดแก้ไขจะสร้างเวอร์ชันใหม่ให้อัตโนมัติ
          เพื่อให้ต้นทุนและรายงานย้อนหลังไม่เปลี่ยนตาม
        </p>
      ) : null}
    </div>
  );
}
