"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, NumberInput } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { FormAlert } from "@/components/ui/states";
import {
  PERIOD_QUANTITY_ERROR_MESSAGES_TH,
  formatPeriodQuantities,
  parsePeriodQuantities,
} from "@/lib/bom/period-quantity";
import { formatQty } from "@/lib/quantity";
import type { BomLineRow } from "@/repositories/bom-repository";
import { publishBomAction, saveBomAction } from "./actions";

type MealPeriod = { id: string; code: string; nameTh: string };
type ItemOption = {
  id: string;
  code: string;
  nameTh: string;
  baseUnitId: string;
  baseUnitCode: string | null;
};

type LineState = {
  key: string;
  itemId: string;
  label: string;
  unitId: string;
  unitCode: string | null;
  quantityInput: string;
  wasteFactor: string;
};

export function BomEditor({
  recipeVersionId,
  menuId,
  versionNo,
  isPublished,
  yieldQty,
  initialLines,
  periods,
  itemOptions,
}: {
  recipeVersionId: string;
  menuId: string;
  versionNo: number;
  isPublished: boolean;
  yieldQty: string;
  initialLines: BomLineRow[];
  periods: MealPeriod[];
  itemOptions: ItemOption[];
}) {
  const router = useRouter();

  const [yieldValue, setYieldValue] = React.useState(String(Number(yieldQty)));
  const [lines, setLines] = React.useState<LineState[]>(() =>
    initialLines.map((line) => ({
      key: line.id,
      itemId: line.itemId,
      label: `${line.itemNameTh} (${line.itemCode})`,
      unitId: line.unitId,
      unitCode: line.unitCode,
      // Read back as the shorthand the kitchen typed in the first place.
      quantityInput: formatPeriodQuantities(line.periods.map((period) => period.quantity)),
      wasteFactor: String(Number(line.wasteFactor)),
    })),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const addLine = (itemId: string) => {
    if (!itemId || lines.some((line) => line.itemId === itemId)) return;
    const item = itemOptions.find((option) => option.id === itemId);
    if (!item) return;

    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        itemId,
        label: `${item.nameTh} (${item.code})`,
        unitId: item.baseUnitId,
        unitCode: item.baseUnitCode,
        quantityInput: "",
        wasteFactor: "0",
      },
    ]);
  };

  const save = (thenPublish: boolean) => {
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await saveBomAction({
        recipeVersionId,
        yieldQty: yieldValue,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          unitId: line.unitId,
          quantityInput: line.quantityInput,
          wasteFactor: line.wasteFactor,
        })),
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      if (!thenPublish) {
        setSaved(true);
        router.refresh();
        return;
      }

      const published = await publishBomAction({ recipeVersionId });
      if (!published.ok) {
        setError(published.message);
        return;
      }
      router.push(`/menu/recipes/${menuId}`);
      router.refresh();
    });
  };

  if (isPublished) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-5">
          <Lock className="h-6 w-6 shrink-0 text-ink-muted" aria-hidden />
          <p className="text-sm text-ink-muted">
            สูตรเวอร์ชัน {versionNo} เผยแพร่แล้ว จึงแก้ไขไม่ได้ —
            เพื่อไม่ให้ต้นทุนและประวัติย้อนหลังเปลี่ยนตาม หากต้องการแก้ ให้สร้างเวอร์ชันใหม่
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      {error ? <FormAlert message={error} /> : null}
      {saved ? <FormAlert tone="success" message="บันทึกฉบับร่างแล้ว" /> : null}

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="จำนวนที่สูตรนี้ทำได้ (เสิร์ฟ)"
            htmlFor="yieldQty"
            hint="ปริมาณวัตถุดิบด้านล่างคือปริมาณสำหรับจำนวนนี้"
          >
            <NumberInput
              id="yieldQty"
              min={0}
              value={yieldValue}
              onChange={(event) => setYieldValue(event.target.value)}
            />
          </Field>

          <Field label="เพิ่มวัตถุดิบ" htmlFor="addItem">
            <SearchSelect
              id="addItem"
              name="addItem"
              defaultValue=""
              placeholder="ค้นหาวัตถุดิบแล้วแตะเพื่อเพิ่ม"
              options={itemOptions.map((item) => ({
                value: item.id,
                label: item.nameTh,
                hint: `${item.code}${item.baseUnitCode ? ` · ${item.baseUnitCode}` : ""}`,
              }))}
              onValueChange={addLine}
              resetAfterSelect
            />
          </Field>
        </CardContent>
      </Card>

      {lines.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink-muted">
            ยังไม่มีวัตถุดิบในสูตร — ค้นหาแล้วแตะเพื่อเพิ่ม
          </CardContent>
        </Card>
      ) : null}

      {lines.map((line) => {
        const parsed = parsePeriodQuantities(line.quantityInput, periods.length);

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
                  onClick={() =>
                    setLines((current) => current.filter((row) => row.key !== line.key))
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={`จำนวน (${line.unitCode ?? "หน่วย"})`}
                  htmlFor={`qty-${line.key}`}
                  required
                  hint={`พิมพ์แบบสั้นได้ เช่น 30+20 = ${periods.map((p) => p.nameTh).join(" / ")}`}
                  errors={
                    line.quantityInput !== "" && !parsed.ok
                      ? [PERIOD_QUANTITY_ERROR_MESSAGES_TH[parsed.error]]
                      : undefined
                  }
                >
                  <Input
                    id={`qty-${line.key}`}
                    className="h-14 text-xl"
                    inputMode="decimal"
                    placeholder="30+20"
                    value={line.quantityInput}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key
                            ? { ...row, quantityInput: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </Field>

                <Field
                  label="ส่วนสูญเสีย"
                  htmlFor={`waste-${line.key}`}
                  hint="0.05 = 5% (เศษที่ตัดทิ้ง)"
                >
                  <NumberInput
                    id={`waste-${line.key}`}
                    min={0}
                    max={0.99}
                    step="0.01"
                    value={line.wasteFactor}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key
                            ? { ...row, wasteFactor: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </Field>
              </div>

              {/* The structured preview is what makes the shorthand safe to type. */}
              {parsed.ok ? (
                <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-surface-sunken p-3">
                  {periods.map((period, index) => (
                    <StatusBadge key={period.id} tone="info">
                      {period.nameTh} {formatQty(parsed.data.values[index] ?? "0")}
                    </StatusBadge>
                  ))}
                  <StatusBadge tone="success">
                    รวม {formatQty(parsed.data.total)} {line.unitCode ?? ""}
                  </StatusBadge>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-surface p-3 lg:bottom-0 lg:left-[var(--sidebar-width,16rem)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            ฉบับร่าง v{versionNo} · {lines.length} วัตถุดิบ
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => save(false)} loading={pending}>
              บันทึกร่าง
            </Button>
            <Button onClick={() => save(true)} disabled={lines.length === 0 || pending}>
              เผยแพร่
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
