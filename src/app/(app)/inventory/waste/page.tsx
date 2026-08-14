import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, KpiCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { CostFilters } from "@/features/cost/cost-filters";
import { requirePermission } from "@/lib/auth/session";
import { addDays, todayIso } from "@/lib/date";
import { WASTE_REASON_LABELS_TH } from "@/lib/inventory/transaction-types";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { addQty, formatMoney, formatQty } from "@/lib/quantity";
import { listStockLocations } from "@/repositories/inventory-repository";
import { getWasteByReason, listWasteHistory } from "@/services/waste-service";

export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function WastePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.STOCK_VIEW);
  const params = await searchParams;

  const today = todayIso();
  const toDate = typeof params.to === "string" && params.to ? params.to : today;
  const fromDate =
    typeof params.from === "string" && params.from ? params.from : addDays(toDate, -29);
  const locationId =
    typeof params.location === "string" && params.location ? params.location : undefined;

  const canSeeCost = hasPermission(user.permissions, PERMISSIONS.COST_VIEW);

  const [locations, history, byReason] = await Promise.all([
    listStockLocations(user.organizationId),
    listWasteHistory(user.organizationId, { fromDate, toDate, locationId }),
    canSeeCost
      ? getWasteByReason(user.organizationId, { fromDate, toDate })
      : Promise.resolve([]),
  ]);

  const total = history.reduce((sum, row) => addQty(sum, row.value), "0");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ของเสีย"
        description="ทุกการตัดของเสียถูกบันทึกในบัญชีเคลื่อนไหวพร้อมสาเหตุ จึงดูย้อนหลังได้ว่าเสียเพราะอะไรมากที่สุด"
        actions={
          hasPermission(user.permissions, PERMISSIONS.ADJUSTMENT_CREATE) ? (
            <Button asChild>
              <Link href="/inventory/waste/new">ตัดของเสีย</Link>
            </Button>
          ) : null
        }
      />

      <CostFilters
        dates={[
          { name: "from", label: "ตั้งแต่วันที่", value: fromDate },
          { name: "to", label: "ถึงวันที่", value: toDate },
        ]}
        selects={[
          {
            name: "location",
            label: "สถานที่",
            options: [
              { value: "", label: "ทุกสถานที่" },
              ...locations.map((location) => ({
                value: location.id,
                label: `${location.code} · ${location.nameTh}`,
              })),
            ],
          },
        ]}
      />

      {canSeeCost ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="มูลค่าของเสีย"
            value={formatMoney(total)}
            tone={Number(total) > 0 ? "warning" : "neutral"}
            hint={`${history.length} รายการ`}
          />
          {byReason.slice(0, 3).map((entry) => (
            <KpiCard key={entry.reason} label={entry.labelTh} value={formatMoney(entry.value)} />
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>ประวัติการตัดของเสีย</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          {history.length === 0 ? (
            <EmptyState
              title="ยังไม่มีการตัดของเสียในช่วงนี้"
              description="เป็นข่าวดี — หรือยังไม่ได้บันทึกของที่ทิ้งไป"
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((row) => (
                <li
                  key={row.transactionId}
                  className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="warning">
                        {row.reason ? WASTE_REASON_LABELS_TH[row.reason] : "ไม่ระบุ"}
                      </StatusBadge>
                      <span className="truncate font-medium text-ink">{row.itemNameTh}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {row.locationCode} · ลอต {row.lotNumber} ·{" "}
                      {dateTimeFormatter.format(row.transactionAt)}
                      {row.userName ? ` · ${row.userName}` : ""}
                    </p>
                    {row.note ? <p className="mt-1 text-xs text-ink-muted">{row.note}</p> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold tabular-nums text-ink">
                      {formatQty(row.baseQty)}
                      <span className="ml-1 text-sm font-normal text-ink-muted">
                        {row.unitCode ?? ""}
                      </span>
                    </p>
                    {canSeeCost ? (
                      <p className="text-xs text-ink-muted">{formatMoney(row.value)}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
