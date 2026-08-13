import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ItemCard } from "@/components/ui/cards";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge, StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { listMenus } from "@/repositories/bom-repository";
import { listQuerySchema } from "@/schemas/common";

export const dynamic = "force-dynamic";

export default async function MenuMasterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.MENU_VIEW);
  const query = listQuerySchema.parse(await searchParams);
  const rows = await listMenus(user.organizationId, query);
  const canManage = hasPermission(user.permissions, PERMISSIONS.MENU_MANAGE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="รายการเมนู"
        description={`${rows.length} เมนู`}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/menu/master/new">
                <Plus className="h-4 w-4" aria-hidden />
                เพิ่มเมนู
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="ค้นหาด้วยรหัสหรือชื่อเมนู"
        selects={[
          {
            name: "status",
            label: "สถานะ",
            defaultValue: "active",
            options: [
              { value: "active", label: "ใช้งานอยู่" },
              { value: "inactive", label: "ปิดใช้งาน" },
              { value: "all", label: "ทั้งหมด" },
            ],
          },
        ]}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="ยังไม่มีเมนู" description="เพิ่มเมนูเพื่อสร้างสูตร (BOM) และวางแผนการผลิต" />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((menu) => (
            <ItemCard
              key={menu.id}
              href={`/menu/recipes/${menu.id}`}
              title={menu.nameTh}
              subtitle={`${menu.code}${menu.categoryName ? ` · ${menu.categoryName}` : ""}`}
              badge={<ActiveBadge isActive={menu.isActive} />}
              meta={
                menu.publishedVersion ? (
                  <StatusBadge tone="success">สูตร v{menu.publishedVersion}</StatusBadge>
                ) : (
                  <StatusBadge tone="muted">ยังไม่มีสูตรที่เผยแพร่</StatusBadge>
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
