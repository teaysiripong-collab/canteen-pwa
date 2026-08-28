import { notFound } from "next/navigation";
import { Card, CardContent, KpiCard } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { CountSheet } from "@/features/stock-count/count-sheet";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/quantity";
import { getCountSession } from "@/services/stock-count-service";

export const dynamic = "force-dynamic";

export default async function CountSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePagePermission(PERMISSIONS.STOCK_VIEW);
  const { id } = await params;

  const detail = await getCountSession(user.organizationId, id);
  if (!detail) notFound();

  const editable =
    detail.session.status === "OPEN" &&
    hasPermission(user.permissions, PERMISSIONS.STOCK_COUNT_CREATE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`ตรวจนับ ${detail.session.countNumber}`}
        description={`${detail.session.locationCode} · ${detail.session.locationNameTh}`}
        actions={
          <StatusBadge
            tone={
              detail.session.status === "APPROVED"
                ? "success"
                : detail.session.status === "CANCELLED"
                  ? "muted"
                  : "info"
            }
          >
            {detail.session.status === "APPROVED"
              ? "อนุมัติแล้ว"
              : detail.session.status === "CANCELLED"
                ? "ยกเลิก"
                : "กำลังนับ"}
          </StatusBadge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="นับแล้ว"
          value={`${detail.totals.countedLines}/${detail.session.lineCount}`}
          unit="รายการ"
        />
        <KpiCard
          label="มีส่วนต่าง"
          value={detail.totals.varianceLines}
          unit="รายการ"
          tone={detail.totals.varianceLines > 0 ? "warning" : "neutral"}
        />
        <KpiCard
          label="มูลค่าส่วนต่าง"
          value={formatMoney(detail.totals.varianceValue)}
          tone={Number(detail.totals.varianceValue) < 0 ? "critical" : "neutral"}
        />
      </div>

      {detail.lines.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="ไม่มีสต๊อกที่สถานที่นี้ตอนเปิดใบ"
              description="ใบตรวจนับจะว่างเปล่าเมื่อไม่มียอดคงเหลือให้ตรวจ"
            />
          </CardContent>
        </Card>
      ) : (
        <CountSheet
          sessionId={detail.session.id}
          lines={detail.lines}
          editable={editable}
          canApprove={hasPermission(user.permissions, PERMISSIONS.STOCK_COUNT_APPROVE)}
        />
      )}

      <p className="text-xs text-ink-subtle">
        การอนุมัติจะสร้างรายการปรับยอดในบัญชีเคลื่อนไหว ไม่ได้เขียนทับยอดคงเหลือโดยตรง
        จึงตรวจสอบย้อนหลังได้เสมอว่ายอดเปลี่ยนเพราะอะไร — และต้องใช้สิทธิ์อนุมัติแยกจากสิทธิ์นับ
      </p>
    </div>
  );
}
