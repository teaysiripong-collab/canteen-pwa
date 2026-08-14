import { and, eq } from "drizzle-orm";
import { db } from "@/database/client";
import { items, supplierItems, units } from "@/database/schema";
import { PageHeader } from "@/components/ui/page-header";
import { PurchaseOrderForm } from "@/features/purchasing/po-form";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { listStockLocations } from "@/repositories/inventory-repository";
import { getMasterDataOptions } from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage() {
  const user = await requirePagePermission(PERMISSIONS.PO_MANAGE);

  const [options, locations, itemRows, unitRows, terms] = await Promise.all([
    getMasterDataOptions(user.organizationId),
    listStockLocations(user.organizationId),
    db
      .select({
        id: items.id,
        code: items.code,
        nameTh: items.nameTh,
        purchaseUnitId: items.purchaseUnitId,
        purchaseConversion: items.purchaseConversion,
      })
      .from(items)
      .where(and(eq(items.organizationId, user.organizationId), eq(items.isActive, true))),
    db.select({ id: units.id, code: units.code, nameTh: units.nameTh }).from(units),
    db
      .select({
        supplierId: supplierItems.supplierId,
        itemId: supplierItems.itemId,
        purchaseUnitId: supplierItems.purchaseUnitId,
        purchaseConversion: supplierItems.purchaseConversion,
        lastPrice: supplierItems.lastPrice,
        moq: supplierItems.moq,
        packSize: supplierItems.packSize,
      })
      .from(supplierItems)
      .innerJoin(items, eq(items.id, supplierItems.itemId))
      .where(and(eq(items.organizationId, user.organizationId), eq(supplierItems.isActive, true))),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="สร้างใบสั่งซื้อ"
        description="เลือกผู้ขาย ระบบจะเติมหน่วยสั่งซื้อ ขั้นต่ำ และราคาล่าสุดให้ พร้อมเทียบราคากับครั้งก่อน"
      />
      <PurchaseOrderForm
        suppliers={options.suppliers}
        locations={locations}
        units={unitRows}
        items={itemRows}
        supplierTerms={terms}
        defaultLocationId={user.defaultLocationId}
      />
    </div>
  );
}
