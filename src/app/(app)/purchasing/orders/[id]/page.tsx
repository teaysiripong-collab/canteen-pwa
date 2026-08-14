import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { PurchaseOrderStatusActions } from "@/features/purchasing/po-status-actions";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatMoney, formatQty } from "@/lib/quantity";
import { getPurchaseOrderById } from "@/repositories/purchase-order-repository";
import { getPriceComparison } from "@/services/purchase-order-service";
import {
  PO_STATUS_LABELS_TH,
  PO_STATUS_TONES,
  type PurchaseOrderStatus,
} from "@/schemas/purchase-order";

export const dynamic = "force-dynamic";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission(PERMISSIONS.PO_VIEW);
  const { id } = await params;

  const result = await getPurchaseOrderById(user.organizationId, id);
  if (!result) notFound();

  const { order, lines, receipts } = result;
  const status = order.status as PurchaseOrderStatus;
  const prices = await getPriceComparison(
    user.organizationId,
    order.supplierId,
    lines.map((line) => ({ itemId: line.itemId, unitPrice: line.unitPrice })),
  );

  const total = lines.reduce(
    (sum, line) => sum + Number(line.orderedQty) * Number(line.unitPrice),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={order.poNumber}
        description={`${order.supplierName} · ส่งที่ ${order.locationCode} ${order.locationNameTh} · สั่ง ${order.orderDate}`}
        actions={<StatusBadge tone={PO_STATUS_TONES[status]}>{PO_STATUS_LABELS_TH[status]}</StatusBadge>}
      />

      <PurchaseOrderStatusActions
        purchaseOrderId={order.id}
        status={status}
        canApprove={hasPermission(user.permissions, PERMISSIONS.PO_APPROVE)}
        canManage={hasPermission(user.permissions, PERMISSIONS.PO_MANAGE)}
      />

      <Card>
        <CardHeader>
          <CardTitle>รายการที่สั่ง</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-ink-muted">
                  <th className="py-2 pr-3 font-medium">วัตถุดิบ</th>
                  <th className="py-2 pr-3 text-right font-medium">สั่ง</th>
                  <th className="py-2 pr-3 text-right font-medium">รับแล้ว</th>
                  <th className="py-2 pr-3 text-right font-medium">คงเหลือ</th>
                  <th className="py-2 text-right font-medium">ราคา/หน่วย</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const comparison = prices.get(line.itemId);
                  const complete = Number(line.remainingBaseQty) === 0;

                  return (
                    <tr key={line.id} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-ink">{line.itemNameTh}</span>
                        <span className="block text-xs text-ink-subtle">{line.itemCode}</span>
                        <span className="mt-1 inline-flex">
                          {complete ? (
                            <StatusBadge tone="success">ครบแล้ว</StatusBadge>
                          ) : Number(line.receivedBaseQty) > 0 ? (
                            <StatusBadge tone="warning">รับบางส่วน</StatusBadge>
                          ) : (
                            <StatusBadge tone="muted">ยังไม่ได้รับ</StatusBadge>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {formatQty(line.orderedBaseQty)} {line.baseUnitCode ?? ""}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {formatQty(line.receivedBaseQty)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">
                        {formatQty(line.remainingBaseQty)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatMoney(line.unitPrice)}
                        {comparison?.changePercent !== null && comparison?.changePercent !== undefined ? (
                          <span className="block text-xs text-ink-muted">
                            {comparison.changePercent > 0 ? "+" : ""}
                            {comparison.changePercent.toFixed(1)}% จากครั้งก่อน
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasPermission(user.permissions, PERMISSIONS.COST_VIEW) ? (
            <p className="mt-4 border-t border-border pt-3 text-right font-semibold text-ink">
              รวม {formatMoney(total)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {receipts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>ใบรับสินค้าที่อ้างอิงใบสั่งซื้อนี้</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {receipts.map((receipt) => (
                <li key={receipt.id}>
                  <Link
                    href={`/inventory/receiving/${receipt.id}`}
                    className="flex items-center justify-between rounded-[var(--radius-control)] border border-border p-3 hover:bg-surface-muted"
                  >
                    <span className="font-medium text-ink">{receipt.receiptNumber}</span>
                    <span className="text-xs text-ink-subtle">
                      {receipt.receivedAt.toISOString().slice(0, 10)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {["APPROVED", "SENT", "PARTIALLY_RECEIVED"].includes(status) &&
      hasPermission(user.permissions, PERMISSIONS.RECEIVE_CREATE) ? (
        <Button asChild>
          <Link href={`/inventory/receiving/new?po=${order.id}`}>รับสินค้าตามใบสั่งซื้อนี้</Link>
        </Button>
      ) : null}
    </div>
  );
}
