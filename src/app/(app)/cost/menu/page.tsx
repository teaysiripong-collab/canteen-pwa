import { Card, CardContent, CardHeader, CardTitle, KpiCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CostFilters } from "@/features/cost/cost-filters";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, formatQty } from "@/lib/quantity";
import { listPublishedRecipeVersionOptions } from "@/repositories/bom-repository";
import { listStockLocations } from "@/repositories/inventory-repository";
import { listMealPeriods } from "@/services/bom-service";
import { getMenuStandardCost } from "@/services/costing-service";

export const dynamic = "force-dynamic";

export default async function MenuCostPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.COST_VIEW);
  const params = await searchParams;

  const [versions, periods, locations] = await Promise.all([
    listPublishedRecipeVersionOptions(user.organizationId),
    listMealPeriods(user.organizationId),
    listStockLocations(user.organizationId),
  ]);

  const requestedVersionId = typeof params.version === "string" ? params.version : undefined;
  const selectedVersionId =
    versions.find((version) => version.id === requestedVersionId)?.id ?? versions[0]?.id;
  const mealPeriodId =
    typeof params.period === "string" && periods.some((period) => period.id === params.period)
      ? params.period
      : undefined;
  const locationId =
    typeof params.location === "string" && params.location ? params.location : undefined;

  const cost = selectedVersionId
    ? await getMenuStandardCost({
        organizationId: user.organizationId,
        recipeVersionId: selectedVersionId,
        mealPeriodId,
        locationId,
      })
    : null;

  const servings = Math.max(1, Number(params.servings ?? 0) || 0);
  const perServing = cost ? Number(cost.totalCost) / servings : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ต้นทุนต่อเมนู"
        description="ต้นทุนมาตรฐาน: ปริมาณตามสูตรที่เผยแพร่แล้ว คูณด้วยต้นทุนถัวเฉลี่ยถ่วงน้ำหนักของสต๊อกที่มีอยู่จริงตอนนี้"
      />

      {versions.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="ยังไม่มีสูตรที่เผยแพร่"
              description="ต้องเผยแพร่ (publish) สูตรอาหารก่อน จึงจะคำนวณต้นทุนมาตรฐานได้"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <CostFilters
            selects={[
              {
                name: "version",
                label: "เมนู / เวอร์ชันสูตร",
                options: versions.map((version) => ({
                  value: version.id,
                  label: `${version.menuCode} · ${version.menuNameTh} (v${version.versionNo})`,
                })),
              },
              {
                name: "period",
                label: "รอบอาหาร",
                options: [
                  { value: "", label: "ทั้งวัน (รวมทุกรอบ)" },
                  ...periods.map((period) => ({ value: period.id, label: period.nameTh })),
                ],
              },
              {
                name: "location",
                label: "ราคาจากสต๊อกที่",
                options: [
                  { value: "", label: "ทุกสถานที่" },
                  ...locations.map((location) => ({
                    value: location.id,
                    label: `${location.code} · ${location.nameTh}`,
                  })),
                ],
              },
              {
                name: "servings",
                label: "จำนวนที่ผลิต (ที่)",
                options: [
                  { value: "", label: "1 ที่" },
                  { value: "50", label: "50 ที่" },
                  { value: "100", label: "100 ที่" },
                  { value: "200", label: "200 ที่" },
                ],
              },
            ]}
          />

          {cost ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard
                  label="ต้นทุนมาตรฐานรวม"
                  value={formatMoney(cost.totalCost)}
                  hint={`${cost.menuNameTh} v${cost.versionNo}`}
                />
                <KpiCard label="ต่อจำนวนที่ผลิต" value={formatMoney(perServing)} hint={`${servings} ที่`} />
                <KpiCard label="จำนวนวัตถุดิบ" value={cost.lines.length} unit="รายการ" />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>วัตถุดิบตามสูตร</CardTitle>
                </CardHeader>
                <CardContent className="pt-3">
                  {cost.lines.length === 0 ? (
                    <EmptyState
                      title="สูตรนี้ไม่มีปริมาณสำหรับรอบที่เลือก"
                      description="ลองเลือกรอบอาหารอื่น หรือดูแบบทั้งวัน"
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
                            <th scope="col" className="px-2 py-2 text-left">วัตถุดิบ</th>
                            <th scope="col" className="px-2 py-2 text-right">ปริมาณ</th>
                            <th scope="col" className="px-2 py-2 text-right">ต้นทุน/หน่วย</th>
                            <th scope="col" className="px-2 py-2 text-right">รวม</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cost.lines.map((line) => (
                            <tr key={line.itemId} className="border-b border-border last:border-0">
                              <td className="px-2 py-2.5 text-ink">{line.itemNameTh}</td>
                              <td className="px-2 py-2.5 text-right tabular-nums text-ink">
                                {formatQty(line.baseQty)}
                              </td>
                              <td className="px-2 py-2.5 text-right tabular-nums text-ink-muted">
                                {Number(line.unitCost) > 0 ? formatMoney(line.unitCost) : "ไม่มีสต๊อก"}
                              </td>
                              <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-ink">
                                {formatMoney(line.lineCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <p className="text-sm text-ink-muted">
                วัตถุดิบที่ไม่มีสต๊อกคงเหลือจะยังไม่มีต้นทุนถัวเฉลี่ย จึงคิดเป็น 0
                ต้นทุนรวมในกรณีนี้จะต่ำกว่าความจริง
              </p>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
