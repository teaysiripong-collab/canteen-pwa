import Link from "next/link";
import { Boxes, Building2, PackagePlus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, KpiCard } from "@/components/ui/card";
import { AlertCard } from "@/components/ui/cards";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";
import { PERMISSIONS, hasPermission } from "@/lib/permissions";
import { countMasterData } from "@/repositories/master-data-repository";

export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  { label: "รับของ", href: "/inventory/receiving", icon: PackagePlus, permission: PERMISSIONS.RECEIVE_CREATE, ready: false },
  { label: "เบิกของ", href: "/inventory/issue", icon: Boxes, permission: PERMISSIONS.ISSUE_CREATE, ready: false },
  { label: "โอนของ", href: "/inventory/transfer", icon: Truck, permission: PERMISSIONS.TRANSFER_CREATE, ready: false },
  { label: "วัตถุดิบ", href: "/items", icon: Building2, permission: PERMISSIONS.ITEM_VIEW, ready: true },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const counts = await countMasterData(user.organizationId);

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
                <span className="text-[0.65rem] text-ink-subtle">Phase 3</span>
              </div>
            );
          },
        )}
      </section>

      <section aria-label="ข้อมูลหลัก" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="วัตถุดิบที่ใช้งาน" value={counts.items} unit="รายการ" />
        <KpiCard label="ผู้ขายที่ใช้งาน" value={counts.suppliers} unit="ราย" />
        <KpiCard label="สถานที่ที่ใช้งาน" value={counts.locations} unit="แห่ง" />
      </section>

      <section aria-label="สถานะระบบ" className="flex flex-col gap-3">
        <AlertCard
          tone="info"
          title="Phase 1 — Foundation"
          description="ตอนนี้ระบบเปิดใช้งานข้อมูลหลัก (วัตถุดิบ สถานที่ ผู้ขาย) สิทธิ์ผู้ใช้ และ Audit Log แล้ว"
        />
        <AlertCard
          tone="muted"
          title="ยังไม่เปิดใช้งาน"
          description="สต๊อก การรับ-เบิก-โอน FEFO ต้นทุน และรายงาน จะเปิดใช้งานใน Phase 3 เป็นต้นไป ตัวเลขแจ้งเตือนจะขึ้นเมื่อมีข้อมูลจริงในระบบ"
        />
      </section>

      <Card className="hidden lg:block">
        <CardHeader>
          <CardTitle>ขั้นตอนถัดไป</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ol className="list-inside list-decimal space-y-1 text-sm text-ink-muted">
            <li>ตรวจสอบข้อมูลวัตถุดิบและหน่วยนับให้ครบก่อนเริ่มใช้งานจริง</li>
            <li>กำหนดผู้ขายหลักและ Lead Time ให้แต่ละวัตถุดิบ</li>
            <li>เตรียมเมนูและสูตร (BOM) สำหรับ Phase 2</li>
          </ol>
          <div className="mt-4 flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/items">จัดการวัตถุดิบ</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/suppliers">จัดการผู้ขาย</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
