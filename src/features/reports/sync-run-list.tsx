import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/states";
import { formatDateTimeTh } from "@/lib/utils";
import type { SyncRunSummary } from "@/services/sheet-sync-service";

const STATUS_LABELS_TH: Record<SyncRunSummary["status"], string> = {
  PENDING: "กำลังส่ง",
  SUCCESS: "สำเร็จ",
  FAILED: "ไม่สำเร็จ",
};

const STATUS_TONES: Record<SyncRunSummary["status"], StatusTone> = {
  PENDING: "muted",
  SUCCESS: "success",
  FAILED: "critical",
};

/**
 * The history of every push, failures included.
 *
 * Showing only the successes would hide exactly the case worth seeing — a tab that stopped
 * being refreshed while everyone kept reading it.
 */
export function SyncRunList({ runs }: { runs: SyncRunSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>ประวัติการส่งไป Google Sheets</CardTitle>
        <CardDescription>
          ทุกครั้งที่ส่งจะบันทึกไว้ทั้งที่สำเร็จและไม่สำเร็จ พร้อมสาเหตุเมื่อส่งไม่ผ่าน
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-3">
        {runs.length === 0 ? (
          <EmptyState title="ยังไม่เคยส่งข้อมูลไป Google Sheets" />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <StatusBadge tone={STATUS_TONES[run.status]}>{STATUS_LABELS_TH[run.status]}</StatusBadge>
                <span className="font-medium text-ink">{run.sheetName ?? run.target}</span>
                <span className="text-sm text-ink-muted">
                  {run.rowCount ? `${run.rowCount} แถว` : "—"}
                </span>
                <span className="text-sm text-ink-subtle">{formatDateTimeTh(run.startedAt)}</span>
                {run.triggeredByName ? (
                  <span className="text-sm text-ink-subtle">โดย {run.triggeredByName}</span>
                ) : null}
                {run.errorMessage ? (
                  <span className="w-full truncate text-xs text-critical">{run.errorMessage}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
