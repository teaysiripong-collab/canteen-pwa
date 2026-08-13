import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReceivingForm } from "@/features/receiving/receiving-form";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getReceivingFormData } from "@/repositories/receiving-repository";
import { getPurchaseOrderById } from "@/repositories/purchase-order-repository";

export const dynamic = "force-dynamic";

export default async function NewReceivingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.RECEIVE_CREATE);
  const params = await searchParams;
  const purchaseOrderId = typeof params.po === "string" ? params.po : undefined;

  const [data, order] = await Promise.all([
    getReceivingFormData(user.organizationId),
    purchaseOrderId
      ? getPurchaseOrderById(user.organizationId, purchaseOrderId)
      : Promise.resolve(null),
  ]);

  const receivable =
    order && ["APPROVED", "SENT", "PARTIALLY_RECEIVED"].includes(order.order.status);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="รับสินค้า"
        description={
          receivable
            ? `รับตามใบสั่งซื้อ ${order!.order.poNumber} — ระบบเติมจำนวนที่ยังค้างให้แล้ว`
            : "เลือกผู้ขาย ใส่จำนวนที่ได้รับจริง แล้วกดยืนยัน ระบบจะสร้างลอตและตัดยอดเข้าสต๊อกให้เอง"
        }
        actions={
          receivable ? <StatusBadge tone="info">{order!.order.poNumber}</StatusBadge> : null
        }
      />

      {order && !receivable ? (
        <Card>
          <CardContent className="py-4 text-sm text-ink-muted">
            ใบสั่งซื้อ {order.order.poNumber} ยังรับสินค้าไม่ได้ (สถานะปัจจุบันไม่พร้อมรับ) —
            หน้านี้จึงเปิดเป็นการรับของทั่วไปแทน
          </CardContent>
        </Card>
      ) : null}

      <ReceivingForm
        data={data}
        defaultLocationId={user.defaultLocationId}
        purchaseOrder={
          receivable
            ? {
                id: order!.order.id,
                poNumber: order!.order.poNumber,
                supplierId: order!.order.supplierId,
                deliverToLocationId: order!.order.deliverToLocationId,
                lines: order!.lines.map((line) => ({
                  id: line.id,
                  itemId: line.itemId,
                  itemCode: line.itemCode,
                  itemNameTh: line.itemNameTh,
                  orderedBaseQty: line.orderedBaseQty,
                  receivedBaseQty: line.receivedBaseQty,
                  remainingBaseQty: line.remainingBaseQty,
                  unitPrice: line.unitPrice,
                })),
              }
            : undefined
        }
      />
    </div>
  );
}
