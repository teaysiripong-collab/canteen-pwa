import Link from "next/link";
import { Boxes, CalendarClock, PackagePlus, ScanLine, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, KpiCard } from "@/components/ui/card";
import { AlertCard } from "@/components/ui/cards";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { countMasterData } from "@/repositories/master-data-repository";
import { listStockBalances } from "@/repositories/inventory-repository";
import { getExpiryAlerts } from "@/services/expiry-service";

export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  { label: "เช็กสต๊อก", href: "/inventory/stock", icon: ScanLine, permission: PERMISSIONS.STOCK_VIEW, ready: true },
  { label: "ใกล้หมดอายุ", href: "/inventory/expiry", icon: CalendarClock, permission: PERMISSIONS.STOCK_VIEW, ready: true },
  { label: "รับของ", href: "/inventory/receiving/new", icon: PackagePlus, permission: PERMISSIONS.RECEIVE_CREATE, ready: true },
  { label: "เบิกของ", href: "/inventory/issue", icon: Boxes, permission: PERMISSIONS.ISSUE_CREATE, ready: false },
  { label: "โอนของ", href: "/inventory/transfer", icon: Truck, permission: PERMISSIONS.TRANSFER_CREATE, ready: false },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const canSeeStock = hasPermission(user.permissions, PERMISSIONS.STOCK_VIEW);

  // Alerts are only computed for users who may see stock at all.
  const [counts, lowStock, expiry] = await Promise.all([
    countMasterData(user.organizationId),
    canSeeStock
      ? listStockBalances(user.organizationId, { onlyInStock: true, onlyBelowReorder: true })
      : Promise.resolve([]),
    canSeeStock
      ? getExpiryAlerts(user.organizationId)
      : Promise.resolve({ groups: [], totalLots: 0, thresholds: [], today: "" }),
  ]);

  const expiredLots = expiry.groups.find((group) => group.key < 0)?.lots ?? [];
  const urgentLots = expiry.groups
    .filter((group) => group.key >= 0 && group.key <= (expiry.thresholds[0] ?? 1))
    .flatMap((group) => group.lots);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`สวัสดี ${user.fullName}`}
        description={
          user.defaultLocationName
            ? `สถานที่หลัก: ${user.defaultLocationName}`
            : "ยังไม่ได้กำหนดสถานที่หลักให้ผู้ใช้นี้"
        }
      />

      <section aria-label="เมนูด่วน" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:hidden">
        {QUICK_ACTIONS.filter((action) => hasPermission(user.permissions, action.permission)).map(
          (action) => {
            const Icon = action.icon;
            const className =
              "flex min-h-24 flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-center";

            return action.ready ? (
              <Link key={action.href} href={action.href} className={className}>
                <Icon className="h-6 w-6 text-brand" aria-hidden />
                <span className="text-sm font-medium text-ink">{action.label}</span>
              </Link>
            ) : (
              <div key={action.href} className={`${className} opacity-60`}>
                <Icon className="h-6 w-6 text-ink-subtle" aria-hidden />
                <span className="text-sm font-medium text-ink-muted">{action.label}</span>
                <span className="text-[0.65rem] text-ink-subtle">เร็วๆ นี้</span>
              </div>
            );
          },
        )}
      </section>

      {canSeeStock ? (
        <section aria-label="ต้องดูแลวันนี้" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="ของใกล้หมด" value={lowStock.length} unit="รายการ" />
          <KpiCard label="ใกล้หมดอายุ" value={expiry.totalLots} unit="ลอต" />
          <KpiCard label="หมดอายุแล้ว" value={expiredLots.length} unit="ลอต" />
          <KpiCard label="วัตถุดิบที่ใช้งาน" value={counts.items} unit="รายการ" />
        </section>
      ) : (
        <section aria-label="ข้อมูลหลัก" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="วัตถุดิบที่ใช้งาน" value={counts.items} unit="รายการ" />
          <KpiCard label="ผู้ขายที่ใช้งาน" value={counts.suppliers} unit="ราย" />
          <KpiCard label="สถานที่ที่ใช้งาน" value={counts.locations} unit="แห่ง" />
        </section>
      )}

      {canSeeStock ? (
        <section aria-label="แจ้งเตือน" className="flex flex-col gap-3">
          {expiredLots.length > 0 ? (
            <AlertCard
              tone="critical"
              title={`หมดอายุแล้ว ${expiredLots.length} ลอต`}
              description={`${expiredLots[0]!.itemNameTh} ลอต ${expiredLots[0]!.lotNumber} ที่ ${expiredLots[0]!.locationCode} — ห้ามนำไปใช้ ให้บันทึกเป็นของเสีย`}
              action={
                <Button asChild size="sm" variant="secondary">
                  <Link href="/inventory/expiry">ดูทั้งหมด</Link>
                </Button>
              }
            />
          ) : null}

          {urgentLots.length > 0 ? (
            <AlertCard
              tone="warning"
              title={`ใกล้หมดอายุ ${urgentLots.length} ลอต`}
              description={`${urgentLots[0]!.itemNameTh} ลอต ${urgentLots[0]!.lotNumber} เหลืออีก ${urgentLots[0]!.daysLeft} วัน — ระบบจะเลือกลอตนี้ก่อนเมื่อเบิก`}
              action={
                <Button asChild size="sm" variant="secondary">
                  <Link href="/inventory/expiry">ดูทั้งหมด</Link>
                </Button>
              }
            />
          ) : null}

          {lowStock.length > 0 ? (
            <AlertCard
              tone="warning"
              title={`ของใกล้หมด ${lowStock.length} รายการ`}
              description={`${lowStock[0]!.itemNameTh} ที่ ${lowStock[0]!.locationCode} เหลือ ${formatQty(lowStock[0]!.baseQty)} ${lowStock[0]!.baseUnitCode ?? ""} (จุดสั่งซื้อ ${formatQty(lowStock[0]!.reorderPoint)})`}
              action={
                <Button asChild size="sm" variant="secondary">
                  <Link href="/inventory/stock?view=low">ดูทั้งหมด</Link>
                </Button>
              }
            />
          ) : null}

          {expiredLots.length + urgentLots.length + lowStock.length === 0 ? (
            <AlertCard
              tone="success"
              title="ไม่มีเรื่องต้องดูแลวันนี้"
              description="ไม่มีของใกล้หมด และไม่มีลอตที่ใกล้หมดอายุตามเกณฑ์ที่ตั้งไว้"
            />
          ) : null}
        </section>
      ) : null}

      <Card className="hidden lg:block">
        <CardHeader>
          <CardTitle>ขั้นตอนถัดไป</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ol className="list-inside list-decimal space-y-1 text-sm text-ink-muted">
            <li>ตรวจสอบข้อมูลวัตถุดิบและหน่วยนับให้ครบก่อนเริ่มใช้งานจริง</li>
            <li>กำหนดผู้ขายหลักและ Lead Time ให้แต่ละวัตถุดิบ</li>
            <li>เตรียมเมนูและสูตร (BOM) เพื่อให้เบิกของตามเมนูได้</li>
          </ol>
          <div className="mt-4 flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/items">จัดการวัตถุดิบ</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/inventory/stock">ดูสต๊อก</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
