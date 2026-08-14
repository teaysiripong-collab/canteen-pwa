import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { getExpiryAlerts } from "@/services/expiry-service";

export const dynamic = "force-dynamic";

export default async function ExpiryPage() {
  const user = await requirePagePermission(PERMISSIONS.STOCK_VIEW);
  const alerts = await getExpiryAlerts(user.organizationId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ของใกล้หมดอายุ"
        description={`${alerts.totalLots} ลอตที่ต้องดูแล · เกณฑ์แจ้งเตือน ${alerts.thresholds.join(" / ")} วัน`}
      />

      {alerts.groups.length === 0 ? (
        <Card>
          <EmptyState
            title="ไม่มีของใกล้หมดอายุ"
            description={`ไม่มีลอตที่หมดอายุภายใน ${alerts.thresholds[alerts.thresholds.length - 1]} วันข้างหน้า`}
          />
        </Card>
      ) : (
        alerts.groups.map((group) => (
          <Card key={group.key}>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>{group.labelTh}</CardTitle>
              <StatusBadge tone={group.tone}>{group.lots.length} ลอต</StatusBadge>
            </CardHeader>

            <CardContent>
              <ul className="flex flex-col gap-2">
                {group.lots.map((lot) => (
                  <li key={lot.lotId}>
                    <Link
                      href={`/inventory/stock/${lot.itemId}`}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3 hover:bg-surface-muted"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{lot.itemNameTh}</p>
                        <p className="mt-0.5 text-xs text-ink-subtle">
                          ลอต {lot.lotNumber} · {lot.locationCode} · หมดอายุ {lot.expiryDate}
                        </p>
                        <p className="mt-1 text-xs text-ink-muted">
                          {lot.daysLeft < 0
                            ? `เลยกำหนดมาแล้ว ${Math.abs(lot.daysLeft)} วัน — ห้ามนำไปใช้ ให้บันทึกเป็นของเสีย`
                            : lot.daysLeft === 0
                              ? "ต้องใช้ให้หมดวันนี้"
                              : `เหลืออีก ${lot.daysLeft} วัน — ระบบจะเลือกลอตนี้ก่อนเมื่อเบิก`}
                        </p>
                      </div>
                      <p className="shrink-0 text-right text-xl font-semibold tabular-nums text-ink">
                        {formatQty(lot.baseQty)}
                        <span className="ml-1 text-sm font-normal text-ink-muted">
                          {lot.baseUnitCode ?? ""}
                        </span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}

      <p className="text-sm text-ink-muted">
        เมื่อเบิกของ ระบบจะเสนอลอตที่หมดอายุก่อนให้อัตโนมัติ (FEFO)
        และจะไม่เสนอลอตที่หมดอายุแล้ว
      </p>
    </div>
  );
}
