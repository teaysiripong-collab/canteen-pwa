"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoney, formatQty } from "@/lib/quantity";
import type { CountLine } from "@/services/stock-count-service";
import { approveCountAction, saveCountAction } from "./actions";

/**
 * The counting sheet.
 *
 * The system quantity is deliberately *not* pre-filled into the input. A pre-filled sheet
 * invites confirming the number the system already believes, which defeats the point of
 * counting; the variance only appears once a real figure has been typed.
 */
export function CountSheet({
  sessionId,
  lines,
  editable,
  canApprove,
}: {
  sessionId: string;
  lines: CountLine[];
  editable: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((line) => [line.id, line.countedBaseQty === null ? "" : line.countedBaseQty]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const rows = useMemo(
    () =>
      lines.map((line) => {
        const raw = counts[line.id] ?? "";
        const counted = raw === "" ? null : Number(raw);
        const variance = counted === null ? null : counted - Number(line.systemBaseQty);
        return { line, raw, counted, variance };
      }),
    [lines, counts],
  );

  const remaining = rows.filter((row) => row.counted === null).length;
  const varianceRows = rows.filter((row) => row.variance !== null && row.variance !== 0);
  const varianceValue = varianceRows.reduce(
    (sum, row) => sum + row.variance! * Number(row.line.unitCost),
    0,
  );

  const save = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveCountAction({
        sessionId,
        lines: rows.map((row) => ({ lineId: row.line.id, countedBaseQty: row.counted })),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice(`บันทึกแล้ว ${result.data.saved} รายการ`);
      router.refresh();
    });
  };

  const approve = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const saved = await saveCountAction({
        sessionId,
        lines: rows.map((row) => ({ lineId: row.line.id, countedBaseQty: row.counted })),
      });
      if (!saved.ok) {
        setError(saved.message);
        return;
      }

      const result = await approveCountAction({ sessionId, idempotencyKey });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice(`อนุมัติแล้ว ปรับยอด ${result.data.adjustedLines} รายการ`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <FormAlert message={error} /> : null}
      {notice ? <FormAlert tone="success" message={notice} /> : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
              <th scope="col" className="px-2 py-2 text-left">วัตถุดิบ / ลอต</th>
              <th scope="col" className="px-2 py-2 text-right">ระบบว่ามี</th>
              <th scope="col" className="px-2 py-2 text-right">นับได้จริง</th>
              <th scope="col" className="px-2 py-2 text-right">ส่วนต่าง</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, raw, variance }) => (
              <tr key={line.id} className="border-b border-border last:border-0">
                <td className="px-2 py-2.5 text-ink">
                  <span className="font-medium">{line.itemNameTh}</span>
                  <span className="ml-2 text-xs text-ink-subtle">
                    {line.lotNumber ?? "ไม่มีลอต"}
                    {line.expiryDate ? ` · หมดอายุ ${line.expiryDate}` : ""}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink-muted">
                  {formatQty(line.systemBaseQty)} {line.unitCode ?? ""}
                </td>
                <td className="px-2 py-2.5 text-right">
                  {editable ? (
                    <NumberInput
                      aria-label={`จำนวนที่นับได้ ${line.itemNameTh}`}
                      className="w-28"
                      value={raw}
                      min={0}
                      onChange={(event) =>
                        setCounts((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                    />
                  ) : (
                    <span className="tabular-nums text-ink">
                      {line.countedBaseQty === null ? "—" : formatQty(line.countedBaseQty)}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right">
                  {variance === null || variance === 0 ? (
                    <span className="text-ink-subtle">{variance === 0 ? "ตรง" : "—"}</span>
                  ) : (
                    <StatusBadge tone={variance > 0 ? "info" : "warning"}>
                      {variance > 0 ? "+" : ""}
                      {formatQty(variance)}
                    </StatusBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-ink-muted">
          <p>
            ยังไม่ได้นับ <strong className="text-ink">{remaining}</strong> รายการ · ส่วนต่าง{" "}
            <strong className="text-ink">{varianceRows.length}</strong> รายการ
          </p>
          <p className="mt-0.5">
            มูลค่าส่วนต่าง{" "}
            <strong className={varianceValue < 0 ? "text-critical" : "text-ink"}>
              {formatMoney(varianceValue)}
            </strong>
          </p>
        </div>

        {editable ? (
          <div className="flex gap-2">
            <Button variant="secondary" loading={pending} onClick={save}>
              บันทึกร่าง
            </Button>
            {canApprove ? (
              <Button loading={pending} disabled={remaining > 0} onClick={approve}>
                อนุมัติและปรับยอด
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {editable && remaining > 0 ? (
        <p className="text-xs text-ink-subtle">
          ต้องนับให้ครบทุกรายการก่อนอนุมัติ — รายการที่เว้นว่างไว้จะทำให้ยอดที่ปรับผิด
        </p>
      ) : null}
    </div>
  );
}
