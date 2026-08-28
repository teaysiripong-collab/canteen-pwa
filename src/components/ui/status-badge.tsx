import * as React from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, CircleDot, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusTone = "normal" | "warning" | "critical" | "success" | "info" | "muted";

const TONE_STYLES: Record<StatusTone, { className: string; Icon: React.ElementType }> = {
  normal: { className: "bg-normal-soft text-normal", Icon: CircleDot },
  warning: { className: "bg-warning-soft text-warning", Icon: AlertTriangle },
  critical: { className: "bg-critical-soft text-critical", Icon: CircleAlert },
  success: { className: "bg-success-soft text-success", Icon: CheckCircle2 },
  info: { className: "bg-info-soft text-info", Icon: Info },
  muted: { className: "bg-surface-sunken text-ink-muted", Icon: CircleDot },
};

/**
 * Status is always icon + text, never colour alone, so it stays readable for
 * colour-blind users and on a washed-out phone screen in daylight.
 */
export function StatusBadge({
  tone = "muted",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  const { className: toneClass, Icon } = TONE_STYLES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        toneClass,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </span>
  );
}

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return (
    <StatusBadge tone={isActive ? "success" : "muted"}>
      {isActive ? "ใช้งาน" : "ปิดใช้งาน"}
    </StatusBadge>
  );
}
