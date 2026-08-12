import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { SupplierItemForm } from "@/features/master-data/supplier-item-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getMasterDataOptions,
  getSupplierById,
  listItemOptions,
} from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

export default async function NewSupplierItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission(PERMISSIONS.SUPPLIER_MANAGE);
  const { id } = await params;

  const [supplier, items, options] = await Promise.all([
    getSupplierById(user.organizationId, id),
    listItemOptions(user.organizationId),
    getMasterDataOptions(user.organizationId),
  ]);

  if (!supplier) notFound();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="เพิ่มวัตถุดิบของผู้ขาย"
        description={`${supplier.nameTh} · ใช้ในใบสั่งซื้อและการวางแผนจัดซื้อ`}
      />
      <SupplierItemForm supplierId={supplier.id} options={{ items, units: options.units }} />
    </div>
  );
}
