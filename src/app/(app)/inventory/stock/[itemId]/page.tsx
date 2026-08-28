import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, formatQty } from "@/lib/quantity";
import { getItemById } from "@/repositories/master-data-repository";
import { listLotBalances, listStockMovements } from "@/repositories/inventory-repository";
import { MovementList } from "@/features/inventory/movement-list";

export const dynamic = "force-dynamic";

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function expiryBadge(date: string | null) {
  const days = daysUntil(date);
  if (days === null) return <StatusBadge tone="muted">ไม่มีวันหมดอายุ</StatusBadge>;
  if (days < 0) return <StatusBadge tone="critical">หมดอายุแล้ว</StatusBadge>;
  if (days === 0) return <StatusBadge tone="critical">หมดอายุวันนี้</StatusBadge>;
  if (days <= 3) return <StatusBadge tone="critical">เหลือ {days} วัน</StatusBadge>;
  if (days <= 7) return <StatusBadge tone="warning">เหลือ {days} วัน</StatusBadge>;
  return <StatusBadge tone="success">เหลือ {days} วัน</StatusBadge>;
}

export default async function ItemStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.STOCK_VIEW);
  const { itemId } = await params;
  const query = await searchParams;
  const locationId = typeof query.location === "string" ? query.location : undefined;

  const item = await getItemById(user.organizationId, itemId);
  if (!item) notFound();

  const [lots, movements] = await Promise.all([
    listLotBalances(user.organizationId, itemId, locationId),
    listStockMovements(user.organizationId, { itemId, locationId, pageSize: 25 }),
  ]);

  const total = lots.reduce((sum, lot) => sum + Number(lot.baseQty), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={item.nameTh}
        description={`รหัส ${item.code} · คงเหลือรวม ${formatQty(total)}`}
        actions={
          <Link
            href="/inventory/stock"
            className="text-sm text-brand underline-offset-4 hover:underline"
          >
            กลับไปหน้าสต๊อก
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>ลอตคงเหลือ (เรียงตามวันหมดอายุ)</CardTitle>
        </CardHeader>
        <CardContent>
          {lots.length === 0 ? (
            <EmptyState title="ไม่มีลอตคงเหลือ" description="วัตถุดิบนี้ยังไม่มีของในสต๊อก" />
          ) : (
            <ul className="flex flex-col gap-2">
              {lots.map((lot) => (
                <li
                  key={`${lot.lotId}:${lot.locationId}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{lot.lotNumber}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {lot.locationCode} · รับเมื่อ {lot.receivedDate} · ทุน{" "}
                      {formatMoney(lot.unitCost)}
                    </p>
                    <div className="mt-2">{expiryBadge(lot.expiryDate)}</div>
                  </div>
                  <p className="shrink-0 text-xl font-semibold tabular-nums text-ink">
                    {formatQty(lot.baseQty)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ความเคลื่อนไหวล่าสุด</CardTitle>
        </CardHeader>
        <CardContent>
          <MovementList rows={movements.rows} />
        </CardContent>
      </Card>
    </div>
  );
}
