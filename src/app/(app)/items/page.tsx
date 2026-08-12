import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ItemCard } from "@/components/ui/cards";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { ItemTable } from "@/features/master-data/item-table";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { listItems } from "@/repositories/master-data-repository";
import { listQuerySchema } from "@/schemas/common";

export const dynamic = "force-dynamic";

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.ITEM_VIEW);
  const query = listQuerySchema.parse(await searchParams);
  const { rows, total } = await listItems(user.organizationId, query);
  const canManage = hasPermission(user.permissions, PERMISSIONS.ITEM_MANAGE);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="วัตถุดิบ"
        description={`ทั้งหมด ${total} รายการ`}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/items/new">
                <Plus className="h-4 w-4" aria-hidden />
                เพิ่มวัตถุดิบ
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="ค้นหาด้วยรหัส ชื่อไทย หรือชื่อเรียกอื่น"
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

      {/* Mobile: cards. Desktop: table. */}
      <div className="flex flex-col gap-2 lg:hidden">
        {rows.length === 0 ? (
          <Card>
            <EmptyState title="ไม่พบรายการสินค้า" description="ลองเปลี่ยนคำค้นหา" />
          </Card>
        ) : (
          rows.map((row) => (
            <ItemCard
              key={row.id}
              href={`/items/${row.id}`}
              title={row.nameTh}
              subtitle={`${row.code}${row.categoryName ? ` · ${row.categoryName}` : ""}`}
              badge={<ActiveBadge isActive={row.isActive} />}
              meta={
                <span>
                  จุดสั่งซื้อ {formatQty(row.reorderPoint)} {row.baseUnitCode ?? ""}
                  {row.supplierName ? ` · ${row.supplierName}` : ""}
                </span>
              }
            />
          ))
        )}
      </div>

      <Card className="hidden lg:block">
        <ItemTable rows={rows} />
      </Card>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="แบ่งหน้า">
          <span className="text-ink-muted">
            หน้า {query.page} จาก {totalPages}
          </span>
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm" disabled={query.page <= 1}>
              <Link href={{ pathname: "/items", query: { ...query, page: Math.max(1, query.page - 1) } }}>
                ก่อนหน้า
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm" disabled={query.page >= totalPages}>
              <Link href={{ pathname: "/items", query: { ...query, page: Math.min(totalPages, query.page + 1) } }}>
                ถัดไป
              </Link>
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
