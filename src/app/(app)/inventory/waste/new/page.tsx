import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { WasteForm } from "@/features/waste/waste-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { listStockLocations } from "@/repositories/inventory-repository";
import { listWastableLots } from "@/services/waste-service";

export const dynamic = "force-dynamic";

export default async function NewWastePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.ADJUSTMENT_CREATE);
  const params = await searchParams;

  const locations = await listStockLocations(user.organizationId);
  const requested = typeof params.location === "string" ? params.location : undefined;
  const location =
    locations.find((entry) => entry.id === requested) ??
    locations.find((entry) => entry.id === user.defaultLocationId) ??
    locations[0];

  if (!location) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="ตัดของเสีย" />
        <Card>
          <CardContent>
            <EmptyState title="ยังไม่มีสถานที่เก็บสต๊อก" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const lots = await listWastableLots(user.organizationId, location.id, {
    itemQuery: typeof params.q === "string" ? params.q : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ตัดของเสีย"
        description={`${location.code} · ${location.nameTh} — ของที่หมดอายุแล้วจะขึ้นก่อน ระบุสาเหตุแล้วใส่จำนวนที่ตัดออกจริง`}
      />
      <WasteForm lots={lots} locationId={location.id} locationName={location.nameTh} />
      <p className="text-xs text-ink-subtle">
        การตัดของเสียบันทึกลงบัญชีเคลื่อนไหวเหมือนการเบิก ยกเลิกไม่ได้แต่กลับรายการได้
        และจะถูกนับเป็นต้นทุนของวันที่บันทึก
      </p>
    </div>
  );
}
