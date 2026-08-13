import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { PeriodPlanner } from "@/features/menu/period-planner";
import { requirePermission } from "@/lib/auth/session";
import { todayIso } from "@/lib/date";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { listMenus } from "@/repositories/bom-repository";
import { listStockLocations } from "@/repositories/inventory-repository";
import { listQuerySchema } from "@/schemas/common";
import { listMealPeriods } from "@/services/bom-service";
import { getDayPlan, listPlanTemplates } from "@/services/menu-plan-service";
import { getMaterialRequirements } from "@/services/menu-requirement-service";

export const dynamic = "force-dynamic";

export default async function MenuPlannerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.MENU_VIEW);
  const params = await searchParams;

  const planDate =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : todayIso();

  const locations = await listStockLocations(user.organizationId);
  const locationId =
    typeof params.location === "string" && params.location !== ""
      ? params.location
      : (user.defaultLocationId ?? locations[0]?.id ?? "");

  if (!locationId) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="แผนเมนู" />
        <Card>
          <EmptyState title="ยังไม่มีสถานที่" description="กรุณาเพิ่มสถานที่ก่อนวางแผนเมนู" />
        </Card>
      </div>
    );
  }

  const [periods, dayPlans, menuRows, templates, requirements] = await Promise.all([
    listMealPeriods(user.organizationId),
    getDayPlan(user.organizationId, planDate, locationId),
    listMenus(user.organizationId, listQuerySchema.parse({})),
    listPlanTemplates(user.organizationId),
    getMaterialRequirements({
      organizationId: user.organizationId,
      fromDate: planDate,
      toDate: planDate,
      locationId,
    }),
  ]);

  const canManage = hasPermission(user.permissions, PERMISSIONS.MENU_MANAGE);
  // Only menus with a published recipe can be planned, so do not offer the rest.
  const menuOptions = menuRows
    .filter((menu) => menu.publishedVersion !== null)
    .map((menu) => ({ id: menu.id, code: menu.code, nameTh: menu.nameTh }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="แผนเมนู"
        description={`${planDate} · ${locations.find((location) => location.id === locationId)?.nameTh ?? ""}`}
      />

      <FilterBar
        searchPlaceholder="ใช้ตัวกรองด้านขวาเพื่อเลือกวันและสถานที่"
        selects={[
          {
            name: "location",
            label: "สถานที่",
            defaultValue: locationId,
            options: locations.map((location) => ({
              value: location.id,
              label: `${location.code} · ${location.nameTh}`,
            })),
          },
        ]}
      />

      <form className="flex items-end gap-2" method="get">
        <input type="hidden" name="location" value={locationId} />
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
          วันที่
          <input
            type="date"
            name="date"
            defaultValue={planDate}
            className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[0.95rem] text-ink"
          />
        </label>
        <button
          type="submit"
          className="h-11 rounded-[var(--radius-control)] border border-border-strong px-4 text-[0.95rem]"
        >
          ดูแผน
        </button>
      </form>

      {periods.map((period) => {
        const plan = dayPlans.find((row) => row.mealPeriodId === period.id);
        return (
          <PeriodPlanner
            key={period.id}
            planDate={planDate}
            locationId={locationId}
            period={period}
            otherPeriods={periods
              .filter((other) => other.id !== period.id)
              .map((other) => ({ id: other.id, nameTh: other.nameTh }))}
            status={plan?.status ?? "DRAFT"}
            items={
              plan?.items.map((item) => ({
                menuId: item.menuId,
                menuCode: item.menuCode,
                menuNameTh: item.menuNameTh,
                plannedServings: item.plannedServings,
                versionNo: item.versionNo,
              })) ?? []
            }
            menuOptions={menuOptions}
            templates={templates}
            canManage={canManage}
          />
        );
      })}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>วัตถุดิบที่ต้องใช้ (จากแผนที่ยืนยันแล้ว)</CardTitle>
          {requirements.unconfirmedPlans > 0 ? (
            <StatusBadge tone="warning">
              ยังไม่ยืนยัน {requirements.unconfirmedPlans} มื้อ
            </StatusBadge>
          ) : null}
        </CardHeader>

        <CardContent>
          {requirements.rows.length === 0 ? (
            <EmptyState
              title="ยังไม่มีความต้องการวัตถุดิบ"
              description="ยืนยันแผนของมื้อใดมื้อหนึ่งก่อน ระบบจึงจะรวมวัตถุดิบให้"
            />
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-ink-muted">
                    <th className="py-2 pr-3 font-medium">วัตถุดิบ</th>
                    {requirements.periods.map((period) => (
                      <th key={period.id} className="py-2 pr-3 text-right font-medium">
                        {period.nameTh}
                      </th>
                    ))}
                    <th className="py-2 text-right font-medium">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {requirements.rows.map((row) => (
                    <tr key={row.itemId} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-ink">{row.itemNameTh}</span>
                        <span className="block text-xs text-ink-subtle">{row.itemCode}</span>
                        {/* Drill-down: which menus asked for this. */}
                        <span className="mt-1 block text-xs text-ink-muted">
                          {row.contributions
                            .map(
                              (contribution) =>
                                `${contribution.menuNameTh} ${formatQty(contribution.baseQty)}`,
                            )
                            .join(" · ")}
                        </span>
                      </td>
                      {requirements.periods.map((period) => (
                        <td key={period.id} className="py-2.5 pr-3 text-right tabular-nums">
                          {formatQty(row.perPeriod[period.id] ?? "0")}
                        </td>
                      ))}
                      <td className="py-2.5 text-right font-semibold tabular-nums">
                        {formatQty(row.totalBaseQty)} {row.unitCode ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
