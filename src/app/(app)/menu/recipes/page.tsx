import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ItemCard } from "@/components/ui/cards";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { listMenus } from "@/repositories/bom-repository";
import { listQuerySchema } from "@/schemas/common";

export const dynamic = "force-dynamic";

export default async function RecipesPage() {
  const user = await requirePagePermission(PERMISSIONS.RECIPE_VIEW);
  const rows = await listMenus(user.organizationId, listQuerySchema.parse({}));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="สูตรอาหาร / BOM"
        description="กำหนดวัตถุดิบต่อเมนู แยกจำนวนตามมื้อด้วยรูปแบบ 30+20"
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="ยังไม่มีเมนู"
            description="เพิ่มเมนูก่อนจึงจะกำหนดสูตรได้"
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((menu) => (
            <ItemCard
              key={menu.id}
              href={`/menu/recipes/${menu.id}`}
              title={menu.nameTh}
              subtitle={menu.code}
              badge={
                menu.publishedVersion ? (
                  <StatusBadge tone="success">v{menu.publishedVersion}</StatusBadge>
                ) : (
                  <StatusBadge tone="muted">ยังไม่มีสูตร</StatusBadge>
                )
              }
            />
          ))}
        </div>
      )}

      <p className="text-sm text-ink-muted">
        จัดการรายการเมนูได้ที่{" "}
        <Link href="/menu/master" className="text-brand underline-offset-4 hover:underline">
          รายการเมนู
        </Link>
      </p>
    </div>
  );
}
