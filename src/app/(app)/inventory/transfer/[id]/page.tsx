import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { MovementList } from "@/features/inventory/movement-list";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { listStockMovements } from "@/repositories/inventory-repository";
import { getStockTransferById } from "@/repositories/transfer-repository";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export default async function TransferDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.STOCK_VIEW);
  const { id } = await params;
  const query = await searchParams;

  const result = await getStockTransferById(user.organizationId, id);
  if (!result) notFound();

  const { transfer, lines } = result;
  const movements = await listStockMovements(user.organizationId, { pageSize: 100 });
  // Both legs of this transfer live under one posting, keyed by the document number.
  const legs = movements.rows.filter((row) => row.referenceNumber === transfer.transferNumber);

  return (
    <div className="flex flex-col gap-5">
      {query.new === "1" ? (
        <Card className="border-success bg-success-soft">
          <CardContent className="flex items-center gap-3 py-5">
            <CheckCircle2 className="h-8 w-8 shrink-0 text-success" aria-hidden />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-ink">โอนของเรียบร้อยแล้ว</p>
              <p className="text-sm text-ink-muted">
                เลขที่ <strong className="text-ink">{transfer.transferNumber}</strong> ·{" "}
                {transfer.fromCode} → {transfer.toCode}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PageHeader
        title={transfer.transferNumber}
        description={`${transfer.fromCode} ${transfer.fromName} → ${transfer.toCode} ${transfer.toName}`}
        actions={<StatusBadge tone="success">โอนแล้ว</StatusBadge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>รายการที่โอน</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{line.itemNameTh}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-subtle">
                    {line.itemCode} · {transfer.fromCode}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                    {transfer.toCode}
                  </p>
                </div>
                <p className="shrink-0 text-xl font-semibold tabular-nums text-ink">
                  {formatQty(line.transferBaseQty)}
                  <span className="ml-1 text-sm font-normal text-ink-muted">
                    {line.baseUnitCode ?? ""}
                  </span>
                </p>
              </li>
            ))}
          </ul>

          <p className="mt-4 border-t border-border pt-3 text-sm text-ink-muted">
            โอนเมื่อ {dateFormatter.format(transfer.transferredAt)}
            {transfer.userName ? ` โดย ${transfer.userName}` : ""}
            {transfer.note ? ` · ${transfer.note}` : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>รายการในบัญชีเคลื่อนไหว (ขาออก + ขาเข้า)</CardTitle>
        </CardHeader>
        <CardContent>
          <MovementList rows={legs} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href="/inventory/stock">ดูสต๊อกคงเหลือ</Link>
        </Button>
        <Button asChild>
          <Link href="/inventory/transfer/new">โอนอีกรายการ</Link>
        </Button>
      </div>
    </div>
  );
}
