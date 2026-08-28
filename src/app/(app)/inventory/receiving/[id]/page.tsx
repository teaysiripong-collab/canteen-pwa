import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatMoney, formatQty } from "@/lib/quantity";
import { RECEIPT_LINE_STATUS_LABELS_TH } from "@/schemas/receiving";
import { getGoodsReceiptById } from "@/repositories/receiving-repository";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export default async function GoodsReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.STOCK_VIEW);
  const { id } = await params;
  const query = await searchParams;

  const result = await getGoodsReceiptById(user.organizationId, id);
  if (!result) notFound();

  const { receipt, lines } = result;
  const isNew = query.new === "1";
  const totalValue = lines.reduce(
    (sum, line) => sum + Number(line.receivedBaseQty) * Number(line.unitCost),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      {isNew ? (
        <Card className="border-success bg-success-soft">
          <CardContent className="flex items-center gap-3 py-5">
            <CheckCircle2 className="h-8 w-8 shrink-0 text-success" aria-hidden />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-ink">รับของเรียบร้อยแล้ว</p>
              <p className="text-sm text-ink-muted">
                เลขที่เอกสาร <strong className="text-ink">{receipt.receiptNumber}</strong> ·
                ของเข้าสต๊อกที่ {receipt.locationCode} แล้ว
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PageHeader
        title={receipt.receiptNumber}
        description={`${receipt.supplierName} · รับเข้าที่ ${receipt.locationCode} ${receipt.locationNameTh}`}
        actions={<StatusBadge tone="success">รับเข้าแล้ว</StatusBadge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>รายการที่รับ</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {lines.map((line) => {
              const rejected = Number(line.rejectedBaseQty) > 0;
              const accepted = Number(line.receivedBaseQty) - Number(line.rejectedBaseQty);

              return (
                <li
                  key={line.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{line.itemNameTh}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {line.itemCode} · {formatQty(line.receivedQty)} {line.receiptUnitCode ?? ""}
                      {Number(line.conversionToBase) !== 1
                        ? ` × ${formatQty(line.conversionToBase)}`
                        : ""}
                      {line.lotNumber ? ` · ลอต ${line.lotNumber}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rejected ? (
                        <StatusBadge tone="warning">
                          {RECEIPT_LINE_STATUS_LABELS_TH[line.lineStatus]} ·
                          ไม่รับ {formatQty(line.rejectedBaseQty)}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success">รับครบ</StatusBadge>
                      )}
                      {line.expiryDate ? (
                        <StatusBadge tone="info">หมดอายุ {line.expiryDate}</StatusBadge>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xl font-semibold tabular-nums text-ink">
                      {formatQty(accepted)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      เข้าสต๊อก · ทุน {formatMoney(line.unitCost)}/หน่วย
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-ink-muted">
              รับเมื่อ {dateFormatter.format(receipt.receivedAt)}
              {receipt.receiverName ? ` โดย ${receipt.receiverName}` : ""}
              {receipt.supplierDocNumber ? ` · เอกสารผู้ขาย ${receipt.supplierDocNumber}` : ""}
            </span>
            {hasPermission(user.permissions, PERMISSIONS.COST_VIEW) ? (
              <span className="font-semibold text-ink">รวม {formatMoney(totalValue)}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href="/inventory/stock">ดูสต๊อกคงเหลือ</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/inventory/movements">ดูบัญชีเคลื่อนไหว</Link>
        </Button>
        {hasPermission(user.permissions, PERMISSIONS.RECEIVE_CREATE) ? (
          <Button asChild>
            <Link href="/inventory/receiving/new">รับของอีกรายการ</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
