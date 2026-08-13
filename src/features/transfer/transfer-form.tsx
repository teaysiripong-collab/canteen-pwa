"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, NumberInput, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { FormAlert } from "@/components/ui/states";
import { formatQty } from "@/lib/quantity";
import type { TransferPreviewLine } from "@/services/transfer-service";
import {
  loadTransferableItemsAction,
  previewTransferAction,
  submitTransferAction,
} from "./actions";

type LocationOption = { id: string; code: string; nameTh: string };
type StockItem = {
  id: string;
  code: string;
  nameTh: string;
  baseUnitCode: string | null;
  availableBaseQty: string;
};

type LineState = { key: string; itemId: string; label: string; baseQty: string };

export function TransferForm({
  locations,
  defaultFromLocationId,
}: {
  locations: LocationOption[];
  defaultFromLocationId: string | null;
}) {
  const router = useRouter();

  const [idempotencyKey] = React.useState(() => `tf:${crypto.randomUUID()}`);
  const [fromLocationId, setFromLocationId] = React.useState(defaultFromLocationId ?? "");
  const [toLocationId, setToLocationId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<LineState[]>([]);
  const [stockItems, setStockItems] = React.useState<StockItem[]>([]);
  const [preview, setPreview] = React.useState<TransferPreviewLine[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Only items that actually have stock at the source can be moved.
  React.useEffect(() => {
    if (!fromLocationId) {
      setStockItems([]);
      return;
    }
    let cancelled = false;
    loadTransferableItemsAction(fromLocationId).then((result) => {
      if (cancelled) return;
      setStockItems(result.ok ? result.data : []);
      setLines([]);
      setPreview([]);
    });
    return () => {
      cancelled = true;
    };
  }, [fromLocationId]);

  const availableFor = (itemId: string) =>
    stockItems.find((item) => item.id === itemId)?.availableBaseQty ?? "0";

  const addLine = (itemId: string) => {
    if (!itemId || lines.some((line) => line.itemId === itemId)) return;
    const item = stockItems.find((row) => row.id === itemId);
    if (!item) return;

    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        itemId,
        label: `${item.nameTh} (${item.code})`,
        baseQty: "",
      },
    ]);
  };

  const readyLines = lines.filter((line) => Number(line.baseQty) > 0);

  // Refresh the before/after figures whenever the numbers settle.
  React.useEffect(() => {
    if (!fromLocationId || !toLocationId || readyLines.length === 0) {
      setPreview([]);
      return;
    }

    const timer = setTimeout(() => {
      previewTransferAction({
        fromLocationId,
        toLocationId,
        lines: readyLines.map((line) => ({ itemId: line.itemId, baseQty: line.baseQty })),
      }).then((result) => {
        if (result.ok) setPreview(result.data);
      });
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLocationId, toLocationId, JSON.stringify(readyLines)]);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitTransferAction({
        idempotencyKey,
        fromLocationId,
        toLocationId,
        note: note || undefined,
        lines: readyLines.map((line) => ({ itemId: line.itemId, baseQty: line.baseQty })),
      });

      if (result.ok) {
        router.push(`/inventory/transfer/${result.data.transferId}?new=1`);
        return;
      }
      setError(result.message);
    });
  };

  const hasShortfall = preview.some((line) => Number(line.shortfallBaseQty) > 0);
  const canSubmit =
    fromLocationId !== "" &&
    toLocationId !== "" &&
    fromLocationId !== toLocationId &&
    readyLines.length > 0 &&
    !hasShortfall &&
    !pending;

  return (
    <div className="flex flex-col gap-4 pb-28">
      {error ? <FormAlert message={error} /> : null}

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="โอนจาก" htmlFor="fromLocationId" required>
            <Select
              id="fromLocationId"
              value={fromLocationId}
              onChange={(event) => setFromLocationId(event.target.value)}
            >
              <option value="">เลือกต้นทาง</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.nameTh}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="ไปที่" htmlFor="toLocationId" required>
            <Select
              id="toLocationId"
              value={toLocationId}
              onChange={(event) => setToLocationId(event.target.value)}
            >
              <option value="">เลือกปลายทาง</option>
              {locations
                .filter((location) => location.id !== fromLocationId)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.code} · {location.nameTh}
                  </option>
                ))}
            </Select>
          </Field>

          <Field label="หมายเหตุ" htmlFor="note" className="sm:col-span-2">
            <Input
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="เช่น เติมของหน้าร้านรอบบ่าย"
            />
          </Field>
        </CardContent>
      </Card>

      {fromLocationId ? (
        <Card>
          <CardContent>
            <Field label="เพิ่มวัตถุดิบที่จะโอน" htmlFor="addItem">
              <SearchSelect
                id="addItem"
                name="addItem"
                defaultValue=""
                placeholder={
                  stockItems.length === 0 ? "ไม่มีของในสถานที่นี้" : "ค้นหาวัตถุดิบแล้วแตะเพื่อเพิ่ม"
                }
                options={stockItems.map((item) => ({
                  value: item.id,
                  label: item.nameTh,
                  hint: `${item.code} · มี ${formatQty(item.availableBaseQty)} ${item.baseUnitCode ?? ""}`,
                }))}
                onValueChange={addLine}
                resetAfterSelect
              />
            </Field>
          </CardContent>
        </Card>
      ) : null}

      {lines.map((line) => {
        const available = availableFor(line.itemId);
        const item = stockItems.find((row) => row.id === line.itemId);
        const over = Number(line.baseQty) > Number(available);
        const linePreview = preview.find((row) => row.itemId === line.itemId);

        return (
          <Card key={line.key}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{line.label}</p>
                  <p className="text-xs text-ink-subtle">
                    มีที่ต้นทาง {formatQty(available)} {item?.baseUnitCode ?? ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  aria-label={`ลบ ${line.label}`}
                  onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <Field
                label={`จำนวนที่โอน (${item?.baseUnitCode ?? "หน่วย"})`}
                htmlFor={`qty-${line.key}`}
                required
                errors={over ? ["มากกว่าที่มีอยู่ที่ต้นทาง"] : undefined}
              >
                <NumberInput
                  id={`qty-${line.key}`}
                  className="h-14 text-xl"
                  min={0}
                  max={Number(available)}
                  value={line.baseQty}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row) =>
                        row.key === line.key ? { ...row, baseQty: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>

              {linePreview ? (
                <div className="rounded-[var(--radius-control)] bg-surface-sunken p-3 text-sm">
                  <div className="flex items-center justify-between gap-2 tabular-nums">
                    <span className="text-ink-muted">ต้นทาง</span>
                    <span className="flex items-center gap-1.5 text-ink">
                      {formatQty(linePreview.fromBefore)}
                      <ArrowRight className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                      <strong>{formatQty(linePreview.fromAfter)}</strong>
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 tabular-nums">
                    <span className="text-ink-muted">ปลายทาง</span>
                    <span className="flex items-center gap-1.5 text-ink">
                      {formatQty(linePreview.toBefore)}
                      <ArrowRight className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                      <strong>{formatQty(linePreview.toAfter)}</strong>
                    </span>
                  </div>

                  {linePreview.lots.length > 0 ? (
                    <p className="mt-2 text-xs text-ink-muted">
                      ระบบเลือกลอตให้แล้ว (หมดอายุก่อนไปก่อน):{" "}
                      {linePreview.lots
                        .map(
                          (lot) =>
                            `${lot.lotNumber} ${formatQty(lot.baseQty)}${lot.expiryDate ? ` (หมด ${lot.expiryDate})` : ""}`,
                        )
                        .join(", ")}
                    </p>
                  ) : null}

                  {Number(linePreview.shortfallBaseQty) > 0 ? (
                    <div className="mt-2">
                      <StatusBadge tone="critical">
                        ของไม่พอ ขาดอีก {formatQty(linePreview.shortfallBaseQty)}
                      </StatusBadge>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {readyLines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-surface p-3 lg:bottom-0 lg:left-[var(--sidebar-width,16rem)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="text-sm">
              <p className="text-ink-muted">{readyLines.length} รายการ</p>
              {hasShortfall ? (
                <p className="font-semibold text-critical">ของไม่พอ แก้จำนวนก่อน</p>
              ) : (
                <p className="font-semibold text-ink">ตรวจยอดก่อน–หลังแล้ว</p>
              )}
            </div>
            <Button size="lg" onClick={submit} disabled={!canSubmit} loading={pending}>
              ยืนยันโอน
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
