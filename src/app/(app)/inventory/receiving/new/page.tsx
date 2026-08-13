import { PageHeader } from "@/components/ui/page-header";
import { ReceivingForm } from "@/features/receiving/receiving-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getReceivingFormData } from "@/repositories/receiving-repository";

export const dynamic = "force-dynamic";

export default async function NewReceivingPage() {
  const user = await requirePermission(PERMISSIONS.RECEIVE_CREATE);
  const data = await getReceivingFormData(user.organizationId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="รับสินค้า"
        description="เลือกผู้ขาย ใส่จำนวนที่ได้รับจริง แล้วกดยืนยัน ระบบจะสร้างลอตและตัดยอดเข้าสต๊อกให้เอง"
      />
      <ReceivingForm data={data} defaultLocationId={user.defaultLocationId} />
    </div>
  );
}
