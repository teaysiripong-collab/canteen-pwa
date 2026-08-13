import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/session";
import { computeVariance } from "@/lib/issue/variance";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatMoney, formatQty } from "@/lib/quantity";
import { getStockIssueById } from "@/repositories/issue-repository";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export default async function StockIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.STOCK_VIEW);
  const { id } = await params;
  const query = await searchParams;

  const result = await getStockIssueById(user.organizationId, id);
  if (!result) notFound();

  const { issue, lines } = result;
  const totalValue = lines.reduce(
    (sum, line) => sum + Number(line.issuedBaseQty) * Number(line.unitCost),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      {query.new === "1" ? (
        <Card className="border-success bg-success-soft">
          <CardContent className="flex items-center gap-3 py-5">
            <CheckCircle2 className="h-8 w-8 shrink-0 text-success" aria-hidden />
            <div className="min-w-0">
              <p className="text-lg font-semibold text-ink">เบิกของเรียบร้อยแล้ว</p>
              <p className="text-sm text-ink-muted">
                เลขที่ <strong className="text-ink">{issue.issueNumber}</strong> ·{" "}
                {issue.locationCode}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <PageHeader
        title={issue.issueNumber}
        description={`${issue.menuNameTh ?? "เบิกทั่วไป"}${issue.periodNameTh ? ` · ${issue.periodNameTh}` : ""} · ${issue.locationCode} ${issue.locationNameTh}`}
        actions={<StatusBadge tone="success">เบิกแล้ว</StatusBadge>}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            รายการที่เบิก
            {issue.versionNo ? ` (สูตร v${issue.versionNo})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {lines.map((line) => {
              const variance = computeVariance(line.requestedBaseQty, line.issuedBaseQty);
              const over = variance.varianceBaseQty !== null && Number(variance.varianceBaseQty) > 0;
              const exact =
                variance.varianceBaseQty !== null && Number(variance.varianceBaseQty) === 0;

              return (
                <li
                  key={line.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{line.itemNameTh}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {line.itemCode}
                      {line.requestedBaseQty
                        ? ` · ตามสูตร ${formatQty(line.requestedBaseQty)}`
                        : " · เบิกทั่วไป (ไม่มีสูตรอ้างอิง)"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {variance.varianceBaseQty === null ? null : exact ? (
                        <StatusBadge tone="success">ตรงตามสูตร</StatusBadge>
                      ) : (
                        <StatusBadge tone={over ? "warning" : "info"}>
                          {over ? "+" : ""}
                          {formatQty(variance.varianceBaseQty)} {line.unitCode ?? ""}
                          {variance.variancePercent !== null
                            ? ` (${variance.variancePercent > 0 ? "+" : ""}${variance.variancePercent.toFixed(2)}%)`
                            : ""}
                        </StatusBadge>
                      )}
                      {line.fefoOverridden ? (
                        <StatusBadge tone="warning">เลือกลอตเอง</StatusBadge>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xl font-semibold tabular-nums text-ink">
                      {formatQty(line.issuedBaseQty)}
                      <span className="ml-1 text-sm font-normal text-ink-muted">
                        {line.unitCode ?? ""}
                      </span>
                    </p>
                    {hasPermission(user.permissions, PERMISSIONS.COST_VIEW) ? (
                      <p className="text-xs text-ink-muted">
                        ทุน {formatMoney(line.unitCost)}/หน่วย
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-ink-muted">
              เบิกเมื่อ {dateFormatter.format(issue.issuedAt)}
              {issue.userName ? ` โดย ${issue.userName}` : ""}
              {issue.note ? ` · ${issue.note}` : ""}
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
        {hasPermission(user.permissions, PERMISSIONS.ISSUE_CREATE) ? (
          <Button asChild>
            <Link href="/inventory/issue/new">เบิกอีกรายการ</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
