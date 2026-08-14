import { PageHeader } from "@/components/ui/page-header";
import { LocationForm } from "@/features/master-data/location-form";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function NewLocationPage() {
  await requirePagePermission(PERMISSIONS.LOCATION_MANAGE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="เพิ่มสถานที่" description="รหัสสถานที่จะถูกใช้อ้างอิงในเอกสารทุกประเภท" />
      <LocationForm />
    </div>
  );
}
