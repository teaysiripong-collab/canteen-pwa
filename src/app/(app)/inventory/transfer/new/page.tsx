import { PageHeader } from "@/components/ui/page-header";
import { TransferForm } from "@/features/transfer/transfer-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { listStockLocations } from "@/repositories/inventory-repository";

export const dynamic = "force-dynamic";

export default async function NewTransferPage() {
  const user = await requirePermission(PERMISSIONS.TRANSFER_CREATE);
  const locations = await listStockLocations(user.organizationId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="โอนสินค้า"
        description="เลือกต้นทาง–ปลายทาง ใส่จำนวน ระบบเลือกลอตให้ตามวันหมดอายุ และแสดงยอดก่อน–หลังให้ตรวจก่อนยืนยัน"
      />
      <TransferForm locations={locations} defaultFromLocationId={user.defaultLocationId} />
    </div>
  );
}
