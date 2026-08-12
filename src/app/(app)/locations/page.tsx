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
import { listLocations } from "@/repositories/master-data-repository";
import { listQuerySchema } from "@/schemas/common";
import { LOCATION_KIND_LABELS_TH } from "@/schemas/master-data";

export const dynamic = "force-dynamic";

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.LOCATION_VIEW);
  const query = listQuerySchema.parse(await searchParams);
  const rows = await listLocations(user.organizationId, query);
  const canManage = hasPermission(user.permissions, PERMISSIONS.LOCATION_MANAGE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="สถานที่"
        description="อาคาร ครัว และจุดให้บริการที่มีการเก็บสต๊อก"
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/locations/new">
                <Plus className="h-4 w-4" aria-hidden />
                เพิ่มสถานที่
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="ค้นหาด้วยรหัสหรือชื่อสถานที่"
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
          <EmptyState title="ยังไม่มีสถานที่" description="เพิ่มสถานที่แรก เช่น B16 (ครัวหลัก)" />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((location) => (
            <ItemCard
              key={location.id}
              href={canManage ? `/locations/${location.id}` : undefined}
              title={`${location.nameTh} (${location.code})`}
              subtitle={LOCATION_KIND_LABELS_TH[location.kind]}
              badge={<ActiveBadge isActive={location.isActive} />}
              meta={
                <StatusBadge tone={location.holdsStock ? "info" : "muted"}>
                  {location.holdsStock ? "เก็บสต๊อก" : "ไม่เก็บสต๊อก"}
                </StatusBadge>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
