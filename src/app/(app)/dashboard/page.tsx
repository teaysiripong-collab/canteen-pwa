import Link from "next/link";
import { Boxes, CalendarClock, PackagePlus, ScanLine, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, KpiCard } from "@/components/ui/card";
import { AlertBand } from "@/features/alerts/alert-list";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { countMasterData } from "@/repositories/master-data-repository";
import { getAlerts, urgentAlerts } from "@/services/alert-service";

export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  { label: "เช็กสต๊อก", href: "/inventory/stock", icon: ScanLine, permission: PERMISSIONS.STOCK_VIEW, ready: true },
  { label: "ใกล้หมดอายุ", href: "/inventory/expiry", icon: CalendarClock, permission: PERMISSIONS.STOCK_VIEW, ready: true },
  { label: "รับของ", href: "/inventory/receiving/new", icon: PackagePlus, permission: PERMISSIONS.RECEIVE_CREATE, ready: true },
  { label: "เบิกของ", href: "/inventory/issue/new", icon: Boxes, permission: PERMISSIONS.ISSUE_CREATE, ready: true },
  { label: "โอนของ", href: "/inventory/transfer/new", icon: Truck, permission: PERMISSIONS.TRANSFER_CREATE, ready: true },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const canSeeStock = hasPermission(user.permissions, PERMISSIONS.STOCK_VIEW);

  // One source for "what needs attention", shared with /alerts so the two cannot disagree.
  const [counts, alerts] = await Promise.all([countMasterData(user.organizationId), getAlerts()]);

  const stockAlerts = alerts.alerts.filter((alert) => alert.href.startsWith("/inventory"));

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
          <KpiCard
            label="ต้องแก้วันนี้"
            value={alerts.counts.critical}
            unit="เรื่อง"
            tone={alerts.counts.critical > 0 ? "critical" : "neutral"}
          />
          <KpiCard
            label="ควรจัดการ"
            value={alerts.counts.warning}
            unit="เรื่อง"
            tone={alerts.counts.warning > 0 ? "warning" : "neutral"}
          />
          <KpiCard label="เรื่องเกี่ยวกับสต๊อก" value={stockAlerts.length} unit="เรื่อง" />
          <KpiCard label="วัตถุดิบที่ใช้งาน" value={counts.items} unit="รายการ" />
        </section>
      ) : (
        <section aria-label="ข้อมูลหลัก" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="วัตถุดิบที่ใช้งาน" value={counts.items} unit="รายการ" />
          <KpiCard label="ผู้ขายที่ใช้งาน" value={counts.suppliers} unit="ราย" />
          <KpiCard label="สถานที่ที่ใช้งาน" value={counts.locations} unit="แห่ง" />
        </section>
      )}

      <section aria-label="เรื่องที่ต้องดูแล" className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-ink">เรื่องที่ต้องดูแล</h2>
        <AlertBand alerts={urgentAlerts(alerts)} total={alerts.alerts.length} />
      </section>

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
