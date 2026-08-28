import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatQty } from "@/lib/quantity";
import { Card } from "./card";
import { StatusBadge, type StatusTone } from "./status-badge";

/** Mobile list row for master data. */
export function ItemCard({
  href,
  title,
  subtitle,
  meta,
  badge,
}: {
  href?: string;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const body = (
    <Card className="flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-ink">{title}</p>
          {badge}
        </div>
        {subtitle ? <p className="mt-0.5 truncate text-sm text-ink-muted">{subtitle}</p> : null}
        {meta ? <div className="mt-2 text-sm text-ink-muted">{meta}</div> : null}
      </div>
      {href ? <ChevronRight className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden /> : null}
    </Card>
  );

  return href ? (
    <Link href={href} className="block focus-visible:outline-2 focus-visible:outline-brand">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Stock-on-hand row: quantity is the thing the eye should land on first. */
export function StockCard({
  itemName,
  itemCode,
  quantity,
  unit,
  tone = "normal",
  statusLabel,
  href,
}: {
  itemName: string;
  itemCode: string;
  quantity: string | number;
  unit: string;
  tone?: StatusTone;
  statusLabel?: string;
  href?: string;
}) {
  const body = (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{itemName}</p>
        <p className="mt-0.5 text-xs text-ink-subtle">{itemCode}</p>
        {statusLabel ? (
          <div className="mt-2">
            <StatusBadge tone={tone}>{statusLabel}</StatusBadge>
          </div>
        ) : null}
      </div>
      <p className="shrink-0 text-right text-2xl font-semibold tabular-nums text-ink">
        {formatQty(quantity)}
        <span className="ml-1 text-sm font-normal text-ink-muted">{unit}</span>
      </p>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function AlertCard({
  tone,
  title,
  description,
  action,
  className,
}: {
  tone: StatusTone;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex items-start gap-3 p-4", className)}>
      <div className="min-w-0 flex-1">
        <StatusBadge tone={tone}>{title}</StatusBadge>
        {description ? <p className="mt-2 text-sm text-ink">{description}</p> : null}
      </div>
      {action}
    </Card>
  );
}
