import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ItemCard } from "@/components/ui/cards";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatMoney } from "@/lib/quantity";
import { listPurchaseOrders } from "@/repositories/purchase-order-repository";
import {
  PO_STATUS_LABELS_TH,
  PO_STATUS_TONES,
  purchaseOrderStatuses,
  type PurchaseOrderStatus,
} from "@/schemas/purchase-order";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.PO_VIEW);
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "all";
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const { rows, total } = await listPurchaseOrders(user.organizationId, { status, page });
  const canManage = hasPermission(user.permissions, PERMISSIONS.PO_MANAGE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ใบสั่งซื้อ"
        description={`${total} ใบ`}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/purchasing/orders/new">
                <Plus className="h-4 w-4" aria-hidden />
                สร้างใบสั่งซื้อ
              </Link>
            </Button>
          ) : null
        }
      />

      <FilterBar
        searchPlaceholder="ใช้ตัวกรองด้านขวา"
        selects={[
          {
            name: "status",
            label: "สถานะ",
            defaultValue: "all",
            options: [
              { value: "all", label: "ทั้งหมด" },
              ...purchaseOrderStatuses.map((value) => ({
                value,
                label: PO_STATUS_LABELS_TH[value],
              })),
            ],
          },
        ]}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="ยังไม่มีใบสั่งซื้อ"
            description="สร้างใบสั่งซื้อเพื่อติดตามของที่สั่งไปแล้วและของที่ยังมาไม่ครบ"
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <ItemCard
              key={row.id}
              href={`/purchasing/orders/${row.id}`}
              title={row.poNumber}
              subtitle={`${row.supplierName} · ${row.locationCode}`}
              badge={
                <StatusBadge tone={PO_STATUS_TONES[row.status as PurchaseOrderStatus]}>
                  {PO_STATUS_LABELS_TH[row.status as PurchaseOrderStatus]}
                </StatusBadge>
              }
              meta={
                <span>
                  สั่ง {row.orderDate}
                  {row.expectedDate ? ` · คาดว่าได้รับ ${row.expectedDate}` : ""} ·{" "}
                  {row.lineCount} รายการ · {formatMoney(row.totalValue)}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
