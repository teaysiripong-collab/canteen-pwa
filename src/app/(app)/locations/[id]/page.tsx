import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { LocationForm } from "@/features/master-data/location-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getLocationById } from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(PERMISSIONS.LOCATION_MANAGE);
  const { id } = await params;
  const location = await getLocationById(user.organizationId, id);

  if (!location) notFound();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={location.nameTh}
        description={`รหัส ${location.code}`}
        actions={<ActiveBadge isActive={location.isActive} />}
      />
      <LocationForm
        values={{
          id: location.id,
          code: location.code,
          nameTh: location.nameTh,
          nameEn: location.nameEn,
          kind: location.kind,
          holdsStock: location.holdsStock,
          isActive: location.isActive,
          note: location.note,
        }}
      />
    </div>
  );
}
