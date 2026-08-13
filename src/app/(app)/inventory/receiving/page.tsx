import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ItemCard } from "@/components/ui/cards";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { listGoodsReceipts } from "@/repositories/receiving-repository";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.STOCK_VIEW);
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const { rows, total } = await listGoodsReceipts(user.organizationId, { page });
  const canReceive = hasPermission(user.permissions, PERMISSIONS.RECEIVE_CREATE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="รับสินค้า"
        description={`${total} ใบรับ`}
        actions={
          canReceive ? (
            <Button asChild>
              <Link href="/inventory/receiving/new">
                <Plus className="h-4 w-4" aria-hidden />
                รับของใหม่
              </Link>
            </Button>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="ยังไม่มีใบรับสินค้า"
            description={
              canReceive
                ? "กด “รับของใหม่” เมื่อของมาส่ง ระบบจะสร้างลอตและตัดยอดเข้าสต๊อกให้อัตโนมัติ"
                : "เมื่อมีการรับของเข้าระบบ รายการจะแสดงที่นี่"
            }
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <ItemCard
              key={row.id}
              href={`/inventory/receiving/${row.id}`}
              title={row.receiptNumber}
              subtitle={`${row.supplierName} · ${row.locationCode}`}
              badge={<StatusBadge tone="success">รับเข้าแล้ว</StatusBadge>}
              meta={
                <span>
                  {dateFormatter.format(row.receivedAt)} · {row.lineCount} รายการ
                  {row.receiverName ? ` · ${row.receiverName}` : ""}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
