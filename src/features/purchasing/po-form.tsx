"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePicker, Field, Input, NumberInput, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { FormAlert } from "@/components/ui/states";
import { todayIso } from "@/lib/date";
import { formatMoney } from "@/lib/quantity";
import { savePurchaseOrderAction } from "./actions";

type Option = { id: string; code: string; nameTh: string };
type ItemOption = Option & {
  purchaseUnitId: string;
  purchaseConversion: string;
};
type SupplierTerm = {
  supplierId: string;
  itemId: string;
  purchaseUnitId: string | null;
  purchaseConversion: string | null;
  lastPrice: string | null;
  moq: string;
  packSize: string | null;
};

type LineState = {
  key: string;
  itemId: string;
  label: string;
  orderedQty: string;
  purchaseUnitId: string;
  conversionToBase: string;
  unitPrice: string;
  lastPrice: string | null;
  moq: string;
  packSize: string | null;
};

/**
 * Creating an order. Supplier terms fill in the unit, pack and last price, and the form
 * shows how the price compares with what was last paid — a jump should be visible before
 * the order is approved, not after the invoice arrives.
 */
export function PurchaseOrderForm({
  suppliers,
  locations,
  units,
  items,
  supplierTerms,
  defaultLocationId,
}: {
  suppliers: Option[];
  locations: Option[];
  units: Option[];
  items: ItemOption[];
  supplierTerms: SupplierTerm[];
  defaultLocationId: string | null;
}) {
  const router = useRouter();

  const [supplierId, setSupplierId] = React.useState("");
  const [locationId, setLocationId] = React.useState(defaultLocationId ?? "");
  const [orderDate, setOrderDate] = React.useState(todayIso());
  const [expectedDate, setExpectedDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<LineState[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const itemById = React.useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const termsFor = React.useCallback(
    (itemId: string, forSupplier: string) => {
      const item = itemById.get(itemId);
      const mapping = supplierTerms.find(
        (row) => row.itemId === itemId && row.supplierId === forSupplier,
      );
      return {
        purchaseUnitId: mapping?.purchaseUnitId ?? item?.purchaseUnitId ?? "",
        conversionToBase: mapping?.purchaseConversion ?? item?.purchaseConversion ?? "1",
        lastPrice: mapping?.lastPrice ?? null,
        moq: mapping?.moq ?? "0",
        packSize: mapping?.packSize ?? null,
      };
    },
    [itemById, supplierTerms],
  );

  const addLine = (itemId: string) => {
    if (!itemId || lines.some((line) => line.itemId === itemId)) return;
    const item = itemById.get(itemId);
    if (!item) return;

    const terms = termsFor(itemId, supplierId);
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        itemId,
        label: `${item.nameTh} (${item.code})`,
        // Start at the minimum order quantity when the supplier has one.
        orderedQty: Number(terms.moq) > 0 ? String(Number(terms.moq)) : "",
        purchaseUnitId: terms.purchaseUnitId,
        conversionToBase: String(Number(terms.conversionToBase)),
        unitPrice: terms.lastPrice ? String(Number(terms.lastPrice)) : "",
        lastPrice: terms.lastPrice,
        moq: terms.moq,
        packSize: terms.packSize,
      },
    ]);
  };

  const total = lines.reduce(
    (sum, line) => sum + (Number(line.orderedQty) || 0) * (Number(line.unitPrice) || 0),
    0,
  );

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await savePurchaseOrderAction({
        supplierId,
        deliverToLocationId: locationId,
        orderDate,
        expectedDate: expectedDate || undefined,
        note: note || undefined,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          orderedQty: line.orderedQty,
          purchaseUnitId: line.purchaseUnitId,
          conversionToBase: line.conversionToBase,
          unitPrice: line.unitPrice,
        })),
      });

      if (result.ok) {
        router.push(`/purchasing/orders/${result.data.purchaseOrderId}`);
        return;
      }
      setError(result.message);
    });
  };

  const canSubmit =
    supplierId !== "" &&
    locationId !== "" &&
    lines.length > 0 &&
    lines.every((line) => Number(line.orderedQty) > 0) &&
    !pending;

  return (
    <div className="flex flex-col gap-4 pb-28">
      {error ? <FormAlert message={error} /> : null}

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="ผู้ขาย" htmlFor="supplierId" required>
            <SearchSelect
              id="supplierId"
              name="supplierId"
              defaultValue=""
              placeholder="เลือกผู้ขาย"
              options={suppliers.map((supplier) => ({
                value: supplier.id,
                label: supplier.nameTh,
                hint: supplier.code,
              }))}
              onValueChange={setSupplierId}
            />
          </Field>

          <Field label="ส่งของที่" htmlFor="locationId" required>
            <Select
              id="locationId"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">เลือกสถานที่</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.nameTh}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="วันที่สั่ง" htmlFor="orderDate" required>
            <DatePicker
              id="orderDate"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </Field>

          <Field label="คาดว่าจะได้รับ" htmlFor="expectedDate">
            <DatePicker
              id="expectedDate"
              value={expectedDate}
              onChange={(event) => setExpectedDate(event.target.value)}
            />
          </Field>

          <Field label="หมายเหตุ" htmlFor="note" className="sm:col-span-2">
            <Input
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="เช่น ขอให้ส่งก่อน 8 โมง"
            />
          </Field>
        </CardContent>
      </Card>

      {supplierId ? (
        <Card>
          <CardContent>
            <Field label="เพิ่มวัตถุดิบ" htmlFor="addItem">
              <SearchSelect
                id="addItem"
                name="addItem"
                defaultValue=""
                placeholder="ค้นหาวัตถุดิบแล้วแตะเพื่อเพิ่ม"
                options={items.map((item) => ({
                  value: item.id,
                  label: item.nameTh,
                  hint: item.code,
                }))}
                onValueChange={addLine}
                resetAfterSelect
              />
            </Field>
          </CardContent>
        </Card>
      ) : null}

      {lines.map((line) => {
        const unit = units.find((option) => option.id === line.purchaseUnitId);
        const changePercent =
          line.lastPrice && Number(line.lastPrice) > 0 && Number(line.unitPrice) > 0
            ? ((Number(line.unitPrice) - Number(line.lastPrice)) / Number(line.lastPrice)) * 100
            : null;
        const belowMoq = Number(line.moq) > 0 && Number(line.orderedQty) < Number(line.moq);
        const offPack =
          line.packSize !== null &&
          Number(line.packSize) > 0 &&
          Number(line.orderedQty) % Number(line.packSize) !== 0;

        return (
          <Card key={line.key}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-ink">{line.label}</p>
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

              <div className="grid grid-cols-2 gap-3">
                <Field label={`จำนวน (${unit?.nameTh ?? "หน่วย"})`} htmlFor={`qty-${line.key}`} required>
                  <NumberInput
                    id={`qty-${line.key}`}
                    className="h-14 text-xl"
                    min={0}
                    value={line.orderedQty}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key ? { ...row, orderedQty: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </Field>

                <Field label="ราคา/หน่วย (บาท)" htmlFor={`price-${line.key}`}>
                  <NumberInput
                    id={`price-${line.key}`}
                    className="h-14 text-xl"
                    min={0}
                    value={line.unitPrice}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key ? { ...row, unitPrice: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </Field>
              </div>

              <div className="flex flex-wrap gap-2">
                {changePercent !== null ? (
                  <StatusBadge
                    tone={changePercent > 5 ? "warning" : changePercent < -5 ? "info" : "muted"}
                  >
                    ราคาล่าสุด {formatMoney(line.lastPrice!)} ({changePercent > 0 ? "+" : ""}
                    {changePercent.toFixed(1)}%)
                  </StatusBadge>
                ) : null}
                {belowMoq ? (
                  <StatusBadge tone="warning">ต่ำกว่าขั้นต่ำ {Number(line.moq)}</StatusBadge>
                ) : null}
                {offPack ? (
                  <StatusBadge tone="info">ไม่ครบแพ็ก (แพ็กละ {Number(line.packSize)})</StatusBadge>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-surface p-3 lg:bottom-0 lg:left-[var(--sidebar-width,16rem)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="text-sm">
              <p className="text-ink-muted">{lines.length} รายการ</p>
              <p className="font-semibold text-ink">รวม {formatMoney(total)}</p>
            </div>
            <Button size="lg" onClick={submit} disabled={!canSubmit} loading={pending}>
              บันทึกใบสั่งซื้อ
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
