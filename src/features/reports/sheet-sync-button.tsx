"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReportKey } from "@/services/report-service";
import { syncReportToSheetAction } from "./actions";

/**
 * Pushes one report to its Google Sheets tab.
 *
 * The button reports the outcome inline rather than optimistically: a sync that quietly failed
 * would leave somebody reading a stale tab believing it was refreshed, which is the exact
 * failure this feature exists to avoid.
 */
export function SheetSyncButton({
  reportKey,
  fromDate,
  toDate,
  locationId,
  disabled,
}: {
  reportKey: ReportKey;
  fromDate: string;
  toDate: string;
  locationId?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await syncReportToSheetAction(reportKey, { fromDate, toDate, locationId });

      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        return;
      }

      setMessage({ tone: "ok", text: `ส่งแล้ว ${result.data.rowCount} แถว` });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" onClick={send} disabled={disabled || pending}>
        <Sheet className="h-4 w-4" aria-hidden />
        {pending ? "กำลังส่ง..." : "Sheets"}
      </Button>
      {message ? (
        <span
          className={`text-xs ${message.tone === "ok" ? "text-success" : "text-critical"}`}
          role="status"
        >
          {message.text}
        </span>
      ) : null}
    </div>
  );
}
