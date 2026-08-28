import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, KpiCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CostFilters } from "@/features/cost/cost-filters";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { addDays, todayIso } from "@/lib/date";
import { PERMISSIONS } from "@/lib/permissions";
import { addQty, formatMoney } from "@/lib/quantity";
import { listStockLocations } from "@/repositories/inventory-repository";
import { getDailyCosts, getIssueCosts, getMonthlyCosts } from "@/services/costing-service";

export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function DailyCostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.COST_VIEW);
  const params = await searchParams;

  const today = todayIso();
  const toDate = typeof params.to === "string" && params.to ? params.to : today;
  const fromDate =
    typeof params.from === "string" && params.from ? params.from : addDays(toDate, -29);
  const locationId = typeof params.location === "string" && params.location ? params.location : undefined;

  const [locations, daily, monthly, issues] = await Promise.all([
    listStockLocations(user.organizationId),
    getDailyCosts(user.organizationId, { fromDate, toDate, locationId }),
    getMonthlyCosts(user.organizationId, { fromDate, toDate, locationId }),
    getIssueCosts(user.organizationId, { fromDate, toDate, locationId }),
  ]);

  const totals = daily.reduce(
    (acc, row) => ({
      issue: addQty(acc.issue, row.issueCost),
      waste: addQty(acc.waste, row.wasteCost),
      total: addQty(acc.total, row.totalCost),
    }),
    { issue: "0", waste: "0", total: "0" },
  );

  const averagePerDay = daily.length > 0 ? Number(totals.total) / daily.length : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ต้นทุนรายวัน"
        description="อ่านจากต้นทุนที่ถูกตรึงไว้บนบัญชีเคลื่อนไหวตอนบันทึก รายงานย้อนหลังจึงไม่เปลี่ยนเมื่อราคาซื้อวันนี้เปลี่ยน"
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="ต้นทุนรวม" value={formatMoney(totals.total)} hint={`${daily.length} วันที่มีการใช้`} />
        <KpiCard label="ต้นทุนเบิกใช้" value={formatMoney(totals.issue)} />
        <KpiCard
          label="ต้นทุนของเสีย"
          value={formatMoney(totals.waste)}
          tone={Number(totals.waste) > 0 ? "warning" : "neutral"}
        />
        <KpiCard label="เฉลี่ยต่อวัน" value={formatMoney(averagePerDay)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>แยกรายวัน</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          {daily.length === 0 ? (
            <EmptyState
              title="ยังไม่มีต้นทุนในช่วงนี้"
              description="ต้นทุนจะเกิดขึ้นเมื่อมีการเบิกใช้หรือบันทึกของเสีย"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-2 py-2 text-left">วันที่</th>
                    <th scope="col" className="px-2 py-2 text-right">เบิกใช้</th>
                    <th scope="col" className="px-2 py-2 text-right">ของเสีย</th>
                    <th scope="col" className="px-2 py-2 text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((row) => (
                    <tr key={row.costDate} className="border-b border-border last:border-0">
                      <td className="px-2 py-2.5 text-ink">{row.costDate}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-ink">
                        {formatMoney(row.issueCost)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-ink-muted">
                        {Number(row.wasteCost) > 0 ? formatMoney(row.wasteCost) : "—"}
                      </td>
                      <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink">
                        {formatMoney(row.totalCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {monthly.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>สรุปรายเดือน</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 pt-3">
            {monthly.map((row) => (
              <div
                key={row.month}
                className="rounded-[var(--radius-control)] border border-border px-4 py-3"
              >
                <p className="text-xs text-ink-muted">{row.month}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ink">
                  {formatMoney(row.totalCost)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>ต้นทุนรายใบเบิก</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          {issues.length === 0 ? (
            <EmptyState title="ยังไม่มีใบเบิกในช่วงนี้" />
          ) : (
            <ul className="flex flex-col gap-2">
              {issues.map((row) => (
                <li key={row.issueId}>
                  <Link
                    href={`/inventory/issue/${row.issueId}`}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3 hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">
                        {row.issueNumber}
                        {row.menuNameTh ? ` · ${row.menuNameTh}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {dateTimeFormatter.format(row.issuedAt)}
                        {row.periodNameTh ? ` · ${row.periodNameTh}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-lg font-semibold tabular-nums text-ink">
                      {formatMoney(row.actualCost)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
