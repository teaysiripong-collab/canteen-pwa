"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label, NumberInput, Select, Textarea } from "@/components/ui/field";
import { EmptyState, FormAlert } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { WASTE_REASONS, WASTE_REASON_LABELS_TH } from "@/lib/inventory/transaction-types";
import { formatMoney, formatQty } from "@/lib/quantity";
import type { WastableLot } from "@/services/waste-service";
import { recordWasteAction } from "./actions";

/**
 * Writing off is destructive and irreversible in the ordinary sense — the ledger reverses
 * rather than deletes — so the form shows the money as it is filled in. Seeing "฿1,240" grow
 * before pressing the button is the check that a slipped decimal point needs.
 */
export function WasteForm({
  lots,
  locationId,
  locationName,
}: {
  lots: WastableLot[];
  locationId: string;
  locationName: string;
}) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<string>("EXPIRED");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Generated once per mount: pressing submit twice posts one write-off, not two.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const selected = useMemo(
    () =>
      lots
        .map((lot) => ({ lot, qty: Number(quantities[lot.lotId] ?? 0) }))
        .filter((entry) => entry.qty > 0),
    [lots, quantities],
  );

  const totalValue = selected.reduce(
    (sum, entry) => sum + entry.qty * Number(entry.lot.unitCost),
    0,
  );

  const overdrawn = selected.filter((entry) => entry.qty > Number(entry.lot.baseQty));

  const submit = () => {
    setError(null);
    setDone(null);

    startTransition(async () => {
      const result = await recordWasteAction({
        idempotencyKey,
        locationId,
        reason,
        note: note.trim() || undefined,
        lines: selected.map((entry) => ({ lotId: entry.lot.lotId, baseQty: entry.qty })),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setDone(result.data.totalValue);
      setQuantities({});
      setNote("");
      // A fresh key, so the next write-off is its own document rather than a replay.
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    });
  };

  if (lots.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState title={`ไม่มีสต๊อกที่ ${locationName}`} description="ยังไม่มีลอตให้ตัดออก" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {done ? (
        <FormAlert tone="success" message={`บันทึกของเสียแล้ว มูลค่า ${formatMoney(done)}`} />
      ) : null}
      {error ? <FormAlert message={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waste-reason" required>
            สาเหตุ
          </Label>
          <Select
            id="waste-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {WASTE_REASONS.map((code) => (
              <option key={code} value={code}>
                {WASTE_REASON_LABELS_TH[code]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waste-note">หมายเหตุ</Label>
          <Textarea
            id="waste-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="เช่น ตู้เย็นเสียเมื่อคืน"
            className="min-h-11"
          />
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {lots.map((lot) => (
          <li
            key={lot.lotId}
            className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{lot.itemNameTh}</span>
                {lot.isExpired ? <StatusBadge tone="critical">หมดอายุแล้ว</StatusBadge> : null}
              </div>
              <p className="mt-0.5 text-xs text-ink-subtle">
                ลอต {lot.lotNumber} · คงเหลือ {formatQty(lot.baseQty)} {lot.unitCode ?? ""} ·{" "}
                {formatMoney(lot.unitCost)}/{lot.unitCode ?? "หน่วย"}
                {lot.expiryDate ? ` · หมดอายุ ${lot.expiryDate}` : ""}
              </p>
            </div>
            <div className="w-28 shrink-0">
              <NumberInput
                aria-label={`จำนวนที่ตัดออก ${lot.itemNameTh}`}
                value={quantities[lot.lotId] ?? ""}
                min={0}
                max={Number(lot.baseQty)}
                onChange={(event) =>
                  setQuantities((current) => ({ ...current, [lot.lotId]: event.target.value }))
                }
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setQuantities((current) => ({ ...current, [lot.lotId]: lot.baseQty }))
              }
            >
              ทั้งลอต
            </Button>
          </li>
        ))}
      </ul>

      {overdrawn.length > 0 ? (
        <FormAlert
          message={`จำนวนที่ตัดออกมากกว่าคงเหลือ: ${overdrawn.map((entry) => entry.lot.itemNameTh).join(", ")}`}
        />
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          เลือกไว้ {selected.length} ลอต — มูลค่าที่จะตัดออก{" "}
          <strong className="text-ink">{formatMoney(totalValue)}</strong>
        </p>
        <Button
          size="lg"
          variant="danger"
          loading={pending}
          disabled={selected.length === 0 || overdrawn.length > 0}
          onClick={submit}
        >
          บันทึกของเสีย
        </Button>
      </div>
    </div>
  );
}
