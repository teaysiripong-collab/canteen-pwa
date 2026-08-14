import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { SupplierItemForm } from "@/features/master-data/supplier-item-form";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getMasterDataOptions,
  getSupplierById,
  getSupplierItemById,
  listItemOptions,
} from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

export default async function EditSupplierItemPage({
  params,
}: {
  params: Promise<{ id: string; mappingId: string }>;
}) {
  const user = await requirePagePermission(PERMISSIONS.SUPPLIER_MANAGE);
  const { id, mappingId } = await params;

  const [supplier, mapping, items, options] = await Promise.all([
    getSupplierById(user.organizationId, id),
    getSupplierItemById(user.organizationId, mappingId),
    listItemOptions(user.organizationId),
    getMasterDataOptions(user.organizationId),
  ]);

  // Guard against a mapping id from another supplier being pasted into the URL.
  if (!supplier || !mapping || mapping.supplierId !== supplier.id) notFound();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="แก้ไขวัตถุดิบของผู้ขาย"
        description={supplier.nameTh}
        actions={<ActiveBadge isActive={mapping.isActive} />}
      />
      <SupplierItemForm
        supplierId={supplier.id}
        options={{ items, units: options.units }}
        values={{
          id: mapping.id,
          itemId: mapping.itemId,
          supplierItemCode: mapping.supplierItemCode,
          supplierItemName: mapping.supplierItemName,
          purchaseUnitId: mapping.purchaseUnitId,
          purchaseConversion: mapping.purchaseConversion,
          moq: mapping.moq,
          packSize: mapping.packSize,
          leadTimeDays: mapping.leadTimeDays,
          lastPrice: mapping.lastPrice,
          isPreferred: mapping.isPreferred,
          isActive: mapping.isActive,
        }}
      />
    </div>
  );
}
