import * as React from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

export function LoadingState({ label = "กำลังโหลดข้อมูล...", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 p-10 text-ink-muted", className)} role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title = "ยังไม่มีข้อมูล",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 p-12 text-center", className)}>
      <span className="rounded-full bg-surface-sunken p-3 text-ink-subtle">
        <Inbox className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <p className="font-medium text-ink">{title}</p>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "เกิดข้อผิดพลาด",
  description = "ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง",
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 p-10 text-center">
      <span className="rounded-full bg-critical-soft p-3 text-critical">
        <AlertCircle className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      </div>
      {action}
    </Card>
  );
}

/** Inline form-level error, used for messages that are not tied to one field. */
export function FormAlert({ message, tone = "critical" }: { message: string; tone?: "critical" | "success" }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-[var(--radius-control)] px-3 py-2.5 text-sm",
        tone === "critical" ? "bg-critical-soft text-critical" : "bg-success-soft text-success",
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
