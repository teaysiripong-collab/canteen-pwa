import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  REFERENCE_TYPE_LABELS_TH,
  TRANSACTION_TYPE_LABELS_TH,
  type ReferenceType,
  type TransactionType,
} from "@/lib/inventory/transaction-types";
import { formatQty } from "@/lib/quantity";

export type MovementRow = {
  id: string;
  transactionType: string;
  direction: string;
  baseQty: string;
  transactionAt: Date;
  referenceType: string;
  referenceNumber: string | null;
  note: string | null;
  itemCode: string;
  itemNameTh: string;
  baseUnitCode: string | null;
  lotNumber: string;
  locationCode: string;
  userName: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * One row per ledger entry. Direction is carried by an arrow icon, a sign and a Thai
 * label together — never by colour on its own.
 */
export function MovementList({
  rows,
  showItem = true,
}: {
  rows: MovementRow[];
  showItem?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="ยังไม่มีความเคลื่อนไหว"
        description="ทุกการรับ เบิก โอน และปรับปรุงจะถูกบันทึกที่นี่"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const inbound = row.direction === "IN";
        const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
        const typeLabel =
          TRANSACTION_TYPE_LABELS_TH[row.transactionType as TransactionType] ?? row.transactionType;
        const referenceLabel =
          REFERENCE_TYPE_LABELS_TH[row.referenceType as ReferenceType] ?? row.referenceType;

        return (
          <li
            key={row.id}
            className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={inbound ? "success" : "info"}>{typeLabel}</StatusBadge>
                {showItem ? (
                  <span className="truncate font-medium text-ink">{row.itemNameTh}</span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-ink-subtle">
                {row.locationCode} · ลอต {row.lotNumber} · {referenceLabel}
                {row.referenceNumber ? ` ${row.referenceNumber}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-ink-subtle">
                {dateFormatter.format(row.transactionAt)}
                {row.userName ? ` · ${row.userName}` : ""}
              </p>
              {row.note ? <p className="mt-1 text-xs text-ink-muted">{row.note}</p> : null}
            </div>

            <p className="flex shrink-0 items-center gap-1 text-lg font-semibold tabular-nums text-ink">
              <Icon className="h-4 w-4" aria-hidden />
              <span>
                {inbound ? "+" : "−"}
                {formatQty(row.baseQty)}
              </span>
              <span className="text-sm font-normal text-ink-muted">{row.baseUnitCode ?? ""}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
