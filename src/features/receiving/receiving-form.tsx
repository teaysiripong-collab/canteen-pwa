"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, DatePicker, Field, Input, NumberInput, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { FormAlert } from "@/components/ui/states";
import { addDays, todayIso } from "@/lib/date";
import { formatMoney, formatQty } from "@/lib/quantity";
import type { ReceivingFormData } from "@/repositories/receiving-repository";
import { RECEIPT_LINE_STATUS_LABELS_TH, receiptLineStatuses } from "@/schemas/receiving";
import { submitReceivingAction } from "./actions";

type LineState = {
  key: string;
  itemId: string;
  itemLabel: string;
  receivedQty: string;
  receiptUnitId: string;
  conversionToBase: string;
  rejectedQty: string;
  unitPrice: string;
  lineStatus: (typeof receiptLineStatuses)[number];
  expiryDate: string;
  hasProblem: boolean;
};

export function ReceivingForm({
  data,
  defaultLocationId,
}: {
  data: ReceivingFormData;
  defaultLocationId: string | null;
}) {
  const router = useRouter();

  // Fixed for the life of the form, so a double tap or a retry cannot receive twice.
  const [idempotencyKey] = React.useState(() => `gr:${crypto.randomUUID()}`);
  const [supplierId, setSupplierId] = React.useState("");
  const [locationId, setLocationId] = React.useState(defaultLocationId ?? "");
  const [supplierDocNumber, setSupplierDocNumber] = React.useState("");
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<LineState[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [pending, startTransition] = React.useTransition();

  const unitById = React.useMemo(
    () => new Map(data.units.map((unit) => [unit.id, unit])),
    [data.units],
  );
  const itemById = React.useMemo(
    () => new Map(data.items.map((item) => [item.id, item])),
    [data.items],
  );

  /** Supplier terms win over the item's defaults when the supplier sells it differently. */
  const termsFor = React.useCallback(
    (itemId: string, forSupplier: string) => {
      const item = itemById.get(itemId);
      const mapping = data.supplierItems.find(
        (row) => row.itemId === itemId && row.supplierId === forSupplier,
      );

      return {
        receiptUnitId: mapping?.purchaseUnitId ?? item?.purchaseUnitId ?? "",
        conversionToBase: mapping?.purchaseConversion ?? item?.purchaseConversion ?? "1",
        unitPrice: mapping?.lastPrice ?? "",
        shelfLifeDays: item?.shelfLifeDays ?? null,
      };
    },
    [data.supplierItems, itemById],
  );

  const addLine = (itemId: string) => {
    if (!itemId) return;
    const item = itemById.get(itemId);
    if (!item) return;

    const terms = termsFor(itemId, supplierId);

    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        itemId,
        itemLabel: `${item.nameTh} (${item.code})`,
        receivedQty: "",
        receiptUnitId: terms.receiptUnitId,
        conversionToBase: String(Number(terms.conversionToBase)),
        rejectedQty: "0",
        unitPrice: terms.unitPrice ? String(Number(terms.unitPrice)) : "",
        lineStatus: "ACCEPTED",
        // Pre-filled from shelf life; the receiver overrides it from the packaging.
        expiryDate: terms.shelfLifeDays ? addDays(todayIso(), terms.shelfLifeDays) : "",
        hasProblem: false,
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<LineState>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  // Re-apply supplier terms when the supplier changes, so prices and packs stay right.
  React.useEffect(() => {
    if (!supplierId) return;
    setLines((current) =>
      current.map((line) => {
        const terms = termsFor(line.itemId, supplierId);
        return {
          ...line,
          receiptUnitId: terms.receiptUnitId || line.receiptUnitId,
          conversionToBase: String(Number(terms.conversionToBase)),
          unitPrice: line.unitPrice || (terms.unitPrice ? String(Number(terms.unitPrice)) : ""),
        };
      }),
    );
  }, [supplierId, termsFor]);

  const totalValue = lines.reduce((sum, line) => {
    const qty = Number(line.receivedQty) - Number(line.rejectedQty || 0);
    const price = Number(line.unitPrice || 0);
    return sum + (Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0);
  }, 0);

  const submit = () => {
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await submitReceivingAction({
        idempotencyKey,
        supplierId,
        locationId,
        supplierDocNumber: supplierDocNumber || undefined,
        note: note || undefined,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          receivedQty: line.receivedQty,
          receiptUnitId: line.receiptUnitId,
          conversionToBase: line.conversionToBase,
          rejectedQty: line.hasProblem ? line.rejectedQty : 0,
          unitPrice: line.unitPrice,
          lineStatus: line.hasProblem ? line.lineStatus : "ACCEPTED",
          expiryDate: line.expiryDate,
        })),
      });

      if (result.ok) {
        router.push(`/inventory/receiving/${result.data.receiptId}?new=1`);
        return;
      }

      setError(result.message);
      setFieldErrors(result.fieldErrors ?? {});
    });
  };

  const canSubmit = supplierId !== "" && locationId !== "" && lines.length > 0 && !pending;

  return (
    <div className="flex flex-col gap-4 pb-28">
      {error ? <FormAlert message={error} /> : null}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <Field label="ผู้ขาย" htmlFor="supplierId" required errors={fieldErrors.supplierId}>
            <SearchSelect
              id="supplierId"
              name="supplierId"
              defaultValue={supplierId}
              placeholder="เลือกผู้ขาย"
              options={data.suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.nameTh,
                hint: supplier.code,
              }))}
              onValueChange={setSupplierId}
            />
          </Field>

          <Field label="รับเข้าที่" htmlFor="locationId" required errors={fieldErrors.locationId}>
            <Select
              id="locationId"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">เลือกสถานที่</option>
              {data.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.nameTh}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="เลขที่เอกสารผู้ขาย" htmlFor="supplierDocNumber">
            <Input
              id="supplierDocNumber"
              value={supplierDocNumber}
              onChange={(event) => setSupplierDocNumber(event.target.value)}
              placeholder="เช่น เลขที่ใบส่งของ"
            />
          </Field>

          <Field label="หมายเหตุ" htmlFor="note">
            <Input
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="เช่น คนส่งของมาสาย"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <Field label="เพิ่มวัตถุดิบที่รับเข้า" htmlFor="addItem">
            <SearchSelect
              id="addItem"
              name="addItem"
              defaultValue=""
              placeholder="ค้นหาวัตถุดิบแล้วแตะเพื่อเพิ่ม"
              options={data.items.map((item) => ({
                value: item.id,
                label: item.nameTh,
                hint: item.code,
              }))}
              onValueChange={addLine}
              resetAfterSelect
            />
          </Field>
          {fieldErrors.lines ? (
            <p className="text-sm text-critical">{fieldErrors.lines[0]}</p>
          ) : null}
        </CardContent>
      </Card>

      {lines.map((line, index) => {
        const unit = unitById.get(line.receiptUnitId);
        const accepted = Number(line.receivedQty || 0) - Number(line.hasProblem ? line.rejectedQty || 0 : 0);
        const baseQty = accepted * Number(line.conversionToBase || 1);
        const item = itemById.get(line.itemId);
        const baseUnit = item ? unitById.get(item.baseUnitId) : undefined;
        const errorFor = (field: string) => fieldErrors[`lines.${index}.${field}`];

        return (
          <Card key={line.key}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-ink">{line.itemLabel}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  aria-label={`ลบ ${line.itemLabel}`}
                  onClick={() => removeLine(line.key)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={`จำนวน (${unit?.nameTh ?? "หน่วย"})`} htmlFor={`qty-${line.key}`} required errors={errorFor("receivedQty")}>
                  <NumberInput
                    id={`qty-${line.key}`}
                    className="h-14 text-xl"
                    min={0}
                    value={line.receivedQty}
                    onChange={(event) => updateLine(line.key, { receivedQty: event.target.value })}
                  />
                </Field>

                <Field label="ราคา/หน่วย (บาท)" htmlFor={`price-${line.key}`} errors={errorFor("unitPrice")}>
                  <NumberInput
                    id={`price-${line.key}`}
                    className="h-14 text-xl"
                    min={0}
                    value={line.unitPrice}
                    onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                  />
                </Field>
              </div>

              <Field label="วันหมดอายุ" htmlFor={`exp-${line.key}`} errors={errorFor("expiryDate")} hint="เติมให้อัตโนมัติจากอายุการเก็บ แก้ได้ตามที่พิมพ์บนกล่อง">
                <DatePicker
                  id={`exp-${line.key}`}
                  value={line.expiryDate}
                  onChange={(event) => updateLine(line.key, { expiryDate: event.target.value })}
                />
              </Field>

              <Checkbox
                label="ของมีปัญหา (ขาด / เสียหาย / ส่งผิด)"
                checked={line.hasProblem}
                onChange={(event) => updateLine(line.key, { hasProblem: event.target.checked })}
              />

              {line.hasProblem ? (
                <div className="grid gap-3 rounded-[var(--radius-control)] bg-surface-sunken p-3 sm:grid-cols-2">
                  <Field label="จำนวนที่ไม่รับ" htmlFor={`rej-${line.key}`} errors={errorFor("rejectedQty")}>
                    <NumberInput
                      id={`rej-${line.key}`}
                      min={0}
                      value={line.rejectedQty}
                      onChange={(event) => updateLine(line.key, { rejectedQty: event.target.value })}
                    />
                  </Field>
                  <Field label="สาเหตุ" htmlFor={`st-${line.key}`}>
                    <Select
                      id={`st-${line.key}`}
                      value={line.lineStatus}
                      onChange={(event) =>
                        updateLine(line.key, {
                          lineStatus: event.target.value as LineState["lineStatus"],
                        })
                      }
                    >
                      {receiptLineStatuses
                        .filter((status) => status !== "ACCEPTED")
                        .map((status) => (
                          <option key={status} value={status}>
                            {RECEIPT_LINE_STATUS_LABELS_TH[status]}
                          </option>
                        ))}
                    </Select>
                  </Field>
                </div>
              ) : null}

              <p className="flex items-center gap-1.5 text-sm text-ink-muted">
                {accepted > 0 ? (
                  <>
                    เข้าสต๊อก <strong className="text-ink">{formatQty(baseQty)}</strong>{" "}
                    {baseUnit?.code ?? ""}
                    {Number(line.conversionToBase) !== 1
                      ? ` (1 ${unit?.code ?? ""} = ${formatQty(line.conversionToBase)} ${baseUnit?.code ?? ""})`
                      : ""}
                  </>
                ) : (
                  <>
                    <TriangleAlert className="h-4 w-4" aria-hidden />
                    ไม่มีของเข้าสต๊อกจากรายการนี้
                  </>
                )}
              </p>
            </CardContent>
          </Card>
        );
      })}

      {lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-surface p-3 lg:bottom-0 lg:left-[var(--sidebar-width,16rem)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="text-sm">
              <p className="text-ink-muted">{lines.length} รายการ</p>
              <p className="font-semibold text-ink">รวม {formatMoney(totalValue)}</p>
            </div>
            <Button size="lg" onClick={submit} disabled={!canSubmit} loading={pending}>
              ยืนยันรับของ
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
