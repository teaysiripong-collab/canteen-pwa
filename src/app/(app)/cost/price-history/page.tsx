import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { CostFilters } from "@/features/cost/cost-filters";
import { requirePermission } from "@/lib/auth/session";
import { addDays, todayIso } from "@/lib/date";
import { PERMISSIONS } from "@/lib/permissions";
import { compareQty, formatMoney, formatQty } from "@/lib/quantity";
import { listItemOptions } from "@/repositories/master-data-repository";
import { getItemCosts, getPriceHistory } from "@/services/costing-service";

export const dynamic = "force-dynamic";

export default async function PriceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.COST_VIEW);
  const params = await searchParams;

  const today = todayIso();
  const toDate = typeof params.to === "string" && params.to ? params.to : today;
  const fromDate =
    typeof params.from === "string" && params.from ? params.from : addDays(toDate, -89);
  const itemId = typeof params.item === "string" && params.item ? params.item : undefined;

  const [itemOptions, history, currentCosts] = await Promise.all([
    listItemOptions(user.organizationId),
    getPriceHistory(user.organizationId, { itemId, fromDate, toDate, limit: 200 }),
    getItemCosts(user.organizationId, { itemId }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ประวัติราคาซื้อ"
        description="ราคาต่อหน่วยฐานของทุกลอตที่รับเข้ามาจริง เทียบกับต้นทุนถัวเฉลี่ยถ่วงน้ำหนักของสต๊อกที่เหลืออยู่ตอนนี้"
      />

      <CostFilters
        dates={[
          { name: "from", label: "ตั้งแต่วันที่", value: fromDate },
          { name: "to", label: "ถึงวันที่", value: toDate },
        ]}
        selects={[
          {
            name: "item",
            label: "วัตถุดิบ",
            options: [
              { value: "", label: "ทุกรายการ" },
              ...itemOptions.map((item) => ({
                value: item.id,
                label: `${item.code} · ${item.nameTh}`,
              })),
            ],
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>ต้นทุนถัวเฉลี่ยของสต๊อกปัจจุบัน</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          {currentCosts.length === 0 ? (
            <EmptyState title="ไม่มีสต๊อกคงเหลือ" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="px-2 py-2 text-left">วัตถุดิบ</th>
                    <th scope="col" className="px-2 py-2 text-right">คงเหลือ</th>
                    <th scope="col" className="px-2 py-2 text-right">ต้นทุนถัวเฉลี่ย</th>
                    <th scope="col" className="px-2 py-2 text-right">มูลค่าสต๊อก</th>
                  </tr>
                </thead>
                <tbody>
                  {currentCosts.map((row) => (
                    <tr key={row.itemId} className="border-b border-border last:border-0">
                      <td className="px-2 py-2.5 text-ink">
                        <span className="text-ink-subtle">{row.itemCode}</span> {row.itemNameTh}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-ink">
                        {formatQty(row.baseQty)}
                        <span className="ml-1 text-xs text-ink-muted">{row.unitCode ?? ""}</span>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-ink">
                        {formatMoney(row.weightedAverageCost)}
                      </td>
                      <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink">
                        {formatMoney(row.stockValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ราคาที่รับเข้าจริง</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          {history.length === 0 ? (
            <EmptyState
              title="ยังไม่มีการรับสินค้าในช่วงนี้"
              description="ราคาจะถูกบันทึกต่อลอตทุกครั้งที่รับของ"
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((row, index) => {
                const previous = history
                  .slice(index + 1)
                  .find((candidate) => candidate.itemCode === row.itemCode);
                const direction = previous ? compareQty(row.unitCost, previous.unitCost) : 0;

                return (
                  <li
                    key={`${row.lotNumber}-${row.itemCode}-${row.receivedDate}-${index}`}
                    className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{row.itemNameTh}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {row.receivedDate} · ลอต {row.lotNumber} · รับ {formatQty(row.baseQty)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-semibold tabular-nums text-ink">
                        {formatMoney(row.unitCost)}
                      </p>
                      {previous && direction !== 0 ? (
                        <div className="mt-1">
                          <StatusBadge tone={direction > 0 ? "warning" : "success"}>
                            {direction > 0 ? "แพงขึ้น" : "ถูกลง"} จาก {formatMoney(previous.unitCost)}
                          </StatusBadge>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
