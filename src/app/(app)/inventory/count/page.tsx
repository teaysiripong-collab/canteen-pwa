import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { OpenCountButton } from "@/features/stock-count/open-count-button";
import { requirePermission } from "@/lib/auth/session";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { listStockLocations } from "@/repositories/inventory-repository";
import { listCountSessions } from "@/services/stock-count-service";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, StatusTone> = {
  OPEN: "info",
  APPROVED: "success",
  CANCELLED: "muted",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "กำลังนับ",
  APPROVED: "อนุมัติแล้ว",
  CANCELLED: "ยกเลิก",
};

const dateFormatter = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" });

export default async function StockCountPage() {
  const user = await requirePermission(PERMISSIONS.STOCK_VIEW);

  const [sessions, locations] = await Promise.all([
    listCountSessions(user.organizationId),
    listStockLocations(user.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="ตรวจนับสต๊อก"
        description="ระบบจะจดยอดที่มีอยู่ ณ ตอนเปิดใบไว้ก่อน ส่วนต่างจึงวัดจากตอนเริ่มนับ ไม่ใช่ยอดที่ขยับระหว่างนับ"
        actions={
          hasPermission(user.permissions, PERMISSIONS.STOCK_COUNT_CREATE) ? (
            <OpenCountButton locations={locations} defaultLocationId={user.defaultLocationId} />
          ) : null
        }
      />

      {sessions.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="ยังไม่มีใบตรวจนับ"
              description="เปิดใบใหม่เพื่อเริ่มนับของที่สถานที่ใดสถานที่หนึ่ง"
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/inventory/count/${session.id}`}
                className="flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:bg-surface-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{session.countNumber}</span>
                    <StatusBadge tone={STATUS_TONE[session.status] ?? "muted"}>
                      {STATUS_LABEL[session.status] ?? session.status}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {session.locationCode} · {dateFormatter.format(session.countedAt)}
                    {session.createdByName ? ` · ${session.createdByName}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                  นับแล้ว {session.countedLineCount}/{session.lineCount}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
