import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ItemCard } from "@/components/ui/cards";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { listSuppliers } from "@/repositories/master-data-repository";
import { listQuerySchema } from "@/schemas/common";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.SUPPLIER_VIEW);
  const query = listQuerySchema.parse(await searchParams);
  const rows = await listSuppliers(user.organizationId, query);
  const canManage = hasPermission(user.permissions, PERMISSIONS.SUPPLIER_MANAGE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ผู้ขาย"
        description={`ทั้งหมด ${rows.length} ราย`}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/suppliers/new">
                <Plus className="h-4 w-4" aria-hidden />
                เพิ่มผู้ขาย
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="ค้นหาด้วยรหัส ชื่อ หรือผู้ติดต่อ"
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
          <EmptyState title="ยังไม่มีผู้ขาย" description="เพิ่มผู้ขายเพื่อใช้ในการสั่งซื้อและรับสินค้า" />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((supplier) => (
            <ItemCard
              key={supplier.id}
              href={canManage ? `/suppliers/${supplier.id}` : undefined}
              title={supplier.nameTh}
              subtitle={`${supplier.code}${supplier.contactName ? ` · ${supplier.contactName}` : ""}`}
              badge={<ActiveBadge isActive={supplier.isActive} />}
              meta={
                <span>
                  Lead Time {supplier.leadTimeDays} วัน
                  {supplier.phone ? ` · ${supplier.phone}` : ""}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
