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
import { listStockTransfers } from "@/repositories/transfer-repository";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.STOCK_VIEW);
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);

  const { rows, total } = await listStockTransfers(user.organizationId, { page });
  const canTransfer = hasPermission(user.permissions, PERMISSIONS.TRANSFER_CREATE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="โอนสินค้า"
        description={`${total} ใบโอน`}
        actions={
          canTransfer ? (
            <Button asChild>
              <Link href="/inventory/transfer/new">
                <Plus className="h-4 w-4" aria-hidden />
                โอนของใหม่
              </Link>
            </Button>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="ยังไม่มีใบโอน"
            description="เมื่อย้ายของระหว่างอาคาร ระบบจะบันทึกทั้งขาออกและขาเข้าไว้ในใบเดียวกัน"
          />
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <ItemCard
              key={row.id}
              href={`/inventory/transfer/${row.id}`}
              title={row.transferNumber}
              subtitle={`${row.fromCode} → ${row.toCode}`}
              badge={<StatusBadge tone="success">โอนแล้ว</StatusBadge>}
              meta={
                <span>
                  {dateFormatter.format(row.transferredAt)} · {row.lineCount} รายการ
                  {row.userName ? ` · ${row.userName}` : ""}
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
