import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Alert, AlertSeverity } from "@/services/alert-service";

const SEVERITY_TONE: Record<AlertSeverity, "critical" | "warning" | "info"> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: "ต้องแก้วันนี้",
  warning: "ควรจัดการ",
  info: "รอดำเนินการ",
};

/**
 * One row per condition, each linking straight to the screen that resolves it. There is no
 * dismiss control on purpose: the only way to clear an alert is to deal with what it is
 * about, so a cleared list means the work is actually done.
 */
export function AlertList({ alerts }: { alerts: Alert[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <Link
            href={alert.href}
            className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:bg-surface-muted"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={SEVERITY_TONE[alert.severity]}>
                  {SEVERITY_LABEL[alert.severity]}
                </StatusBadge>
                <span className="font-medium text-ink">{alert.titleTh}</span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{alert.detailTh}</p>
              {alert.exampleTh ? (
                <p className="mt-0.5 text-xs text-ink-subtle">เช่น {alert.exampleTh}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-2xl font-semibold tabular-nums text-ink">
              {alert.count}
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Compact band for the dashboard: the urgent rows only, with a way through to the rest. */
export function AlertBand({ alerts, total }: { alerts: Alert[]; total: number }) {
  if (alerts.length === 0) {
    return (
      <Card className="flex items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink-muted">
          ไม่มีเรื่องเร่งด่วนตอนนี้ — ของไม่หมดอายุค้าง ใบสั่งซื้อไม่เลยกำหนด แผนเมนูยืนยันครบ
        </p>
        {total > 0 ? (
          <Link href="/alerts" className="shrink-0 text-sm font-medium text-brand hover:underline">
            ดูทั้งหมด {total}
          </Link>
        ) : null}
      </Card>
    );
  }

  return (
    <section aria-label="เรื่องเร่งด่วน" className="flex flex-col gap-2">
      <AlertList alerts={alerts} />
      {total > alerts.length ? (
        <Link href="/alerts" className="text-sm font-medium text-brand hover:underline">
          ดูรายการทั้งหมด {total} เรื่อง
        </Link>
      ) : null}
    </section>
  );
}
