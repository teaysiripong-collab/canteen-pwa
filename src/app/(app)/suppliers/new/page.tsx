import { PageHeader } from "@/components/ui/page-header";
import { SupplierForm } from "@/features/master-data/supplier-form";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function NewSupplierPage() {
  await requirePagePermission(PERMISSIONS.SUPPLIER_MANAGE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="เพิ่มผู้ขาย" description="ข้อมูลนี้จะถูกใช้ในใบสั่งซื้อและการรับสินค้า" />
      <SupplierForm />
    </div>
  );
}
