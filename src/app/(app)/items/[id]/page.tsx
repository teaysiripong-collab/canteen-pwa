import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { ActiveBadge } from "@/components/ui/status-badge";
import { ItemForm } from "@/features/master-data/item-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getItemById, getMasterDataOptions } from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(PERMISSIONS.ITEM_MANAGE);
  const { id } = await params;

  const [item, options] = await Promise.all([
    getItemById(user.organizationId, id),
    getMasterDataOptions(user.organizationId),
  ]);

  if (!item) notFound();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={item.nameTh}
        description={`รหัส ${item.code}`}
        actions={<ActiveBadge isActive={item.isActive} />}
      />
      <ItemForm
        options={options}
        values={{
          id: item.id,
          code: item.code,
          nameTh: item.nameTh,
          nameEn: item.nameEn,
          categoryId: item.categoryId,
          baseUnitId: item.baseUnitId,
          purchaseUnitId: item.purchaseUnitId,
          purchaseConversion: item.purchaseConversion,
          preferredSupplierId: item.preferredSupplierId,
          defaultLocationId: item.defaultLocationId,
          minimumStock: item.minimumStock,
          reorderPoint: item.reorderPoint,
          shelfLifeDays: item.shelfLifeDays,
          barcode: item.barcode,
          isActive: item.isActive,
          note: item.note,
          aliases: item.aliases,
        }}
      />
    </div>
  );
}
