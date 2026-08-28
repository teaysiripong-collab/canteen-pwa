import { Card, CardContent, KpiCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CostFilters } from "@/features/cost/cost-filters";
import { PlannerBoard, UnsourcedList } from "@/features/purchasing/planner-board";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { addDays, todayIso } from "@/lib/date";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { addQty, formatMoney } from "@/lib/quantity";
import { listStockLocations } from "@/repositories/inventory-repository";
import { getPurchasePlan } from "@/services/purchase-planner-service";

export const dynamic = "force-dynamic";

export default async function PurchasePlannerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePagePermission(PERMISSIONS.PO_VIEW);
  const params = await searchParams;

  const locations = await listStockLocations(user.organizationId);

  const today = todayIso();
  const fromDate = typeof params.from === "string" && params.from ? params.from : today;
  const toDate =
    typeof params.to === "string" && params.to ? params.to : addDays(fromDate, 6);
  const requestedLocation = typeof params.location === "string" ? params.location : undefined;
  const locationId =
    locations.find((location) => location.id === requestedLocation)?.id ??
    user.defaultLocationId ??
    locations[0]?.id;

  const plan = locationId
    ? await getPurchasePlan({
        organizationId: user.organizationId,
        fromDate,
        toDate,
        locationId,
      })
    : null;

  const estimatedTotal =
    plan?.groups.reduce((total, group) => addQty(total, group.estimatedTotal), "0") ?? "0";
  const lineCount = plan?.groups.reduce((count, group) => count + group.lines.length, 0) ?? 0;
  const lateGroups = plan?.groups.filter((group) => group.isLate).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="วางแผนสั่งซื้อ"
        description="คำนวณจาก ความต้องการตามแผนเมนู + สต๊อกสำรอง − ของที่มีอยู่ − ของที่สั่งไปแล้ว แล้วปัดขึ้นตามขั้นต่ำและขนาดแพ็กของผู้ขาย"
      />

      {locations.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title="ยังไม่มีสถานที่เก็บสต๊อก" />
          </CardContent>
        </Card>
      ) : (
        <>
          <CostFilters
            dates={[
              { name: "from", label: "ตั้งแต่วันที่", value: fromDate },
              { name: "to", label: "ถึงวันที่", value: toDate },
            ]}
            selects={[
              {
                name: "location",
                label: "ส่งของที่",
                options: locations.map((location) => ({
                  value: location.id,
                  label: `${location.code} · ${location.nameTh}`,
                })),
              },
            ]}
          />

          {plan ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard label="รายการที่ต้องสั่ง" value={lineCount} unit="รายการ" />
                <KpiCard label="ผู้ขาย" value={plan.groups.length} unit="ราย" />
                <KpiCard
                  label="มูลค่าโดยประมาณ"
                  value={formatMoney(estimatedTotal)}
                  hint="จากราคาซื้อครั้งล่าสุด"
                />
                <KpiCard
                  label="เลยกำหนดสั่ง"
                  value={lateGroups}
                  unit="ราย"
                  tone={lateGroups > 0 ? "critical" : "neutral"}
                />
              </div>

              {plan.unconfirmedPlans > 0 ? (
                <Card>
                  <CardContent className="py-4 text-sm text-ink-muted">
                    มีแผนเมนู {plan.unconfirmedPlans} รายการในช่วงนี้ที่ยังไม่ยืนยัน จึงยังไม่ถูกนับ
                    — ยืนยันแผนก่อนแล้วคำนวณใหม่ ตัวเลขจะครบกว่านี้
                  </CardContent>
                </Card>
              ) : null}

              {plan.groups.length === 0 && plan.unsourced.length === 0 ? (
                <Card>
                  <CardContent>
                    <EmptyState
                      title="ยังไม่ต้องสั่งซื้ออะไรในช่วงนี้"
                      description={
                        plan.coveredCount > 0
                          ? `ตรวจแล้ว ${plan.coveredCount} รายการ — ของที่มีอยู่และที่สั่งไปแล้วเพียงพอ`
                          : "ยังไม่มีแผนเมนูที่ยืนยันในช่วงวันที่เลือก"
                      }
                    />
                  </CardContent>
                </Card>
              ) : (
                <>
                  <PlannerBoard
                    groups={plan.groups}
                    fromDate={fromDate}
                    toDate={toDate}
                    locationId={plan.locationId}
                    canManage={hasPermission(user.permissions, PERMISSIONS.PO_MANAGE)}
                  />
                  <UnsourcedList lines={plan.unsourced} />
                </>
              )}

              {plan.coveredCount > 0 && plan.groups.length > 0 ? (
                <p className="text-sm text-ink-muted">
                  อีก {plan.coveredCount} รายการมีของพอแล้ว จึงไม่อยู่ในรายการสั่งซื้อ
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
