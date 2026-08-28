"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, NumberInput, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { FormAlert } from "@/components/ui/states";
import { computeVariance } from "@/lib/issue/variance";
import { formatQty } from "@/lib/quantity";
import type { IssueStandardLine } from "@/services/issue-service";
import { loadIssueStandardAction, submitIssueAction } from "./actions";

type Option = { id: string; code: string; nameTh: string };

type LineState = IssueStandardLine & { actual: string };

/**
 * The frontline issue flow: pick where, which shift and which menu, and the BOM fills the
 * quantities in. Staff only touch a number when reality differed from the recipe, and the
 * difference is shown as it is typed so the variance is never a surprise later.
 */
export function IssueForm({
  locations,
  periods,
  menus,
  defaultLocationId,
  canAdjust,
}: {
  locations: Option[];
  periods: Option[];
  menus: Option[];
  defaultLocationId: string | null;
  canAdjust: boolean;
}) {
  const router = useRouter();

  const [idempotencyKey] = React.useState(() => `is:${crypto.randomUUID()}`);
  const [locationId, setLocationId] = React.useState(defaultLocationId ?? "");
  const [mealPeriodId, setMealPeriodId] = React.useState(periods[0]?.id ?? "");
  const [menuId, setMenuId] = React.useState("");
  const [servings, setServings] = React.useState("1");
  const [note, setNote] = React.useState("");
  const [versionNo, setVersionNo] = React.useState<number | null>(null);
  const [lines, setLines] = React.useState<LineState[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Loading the BOM is what makes this a two-tap job instead of a typing job.
  const loadStandard = React.useCallback(
    (nextMenuId: string, nextServings: string) => {
      if (!nextMenuId || !mealPeriodId || !locationId) return;
      setError(null);

      startTransition(async () => {
        const result = await loadIssueStandardAction({
          menuId: nextMenuId,
          mealPeriodId,
          locationId,
          servings: Number(nextServings) || 1,
        });

        if (!result.ok) {
          setError(result.message);
          setLines([]);
          setVersionNo(null);
          return;
        }

        setVersionNo(result.data.versionNo);
        setLines(
          result.data.lines.map((line) => ({
            ...line,
            actual: String(Number(line.standardBaseQty)),
          })),
        );
      });
    },
    [locationId, mealPeriodId],
  );

  React.useEffect(() => {
    if (menuId) loadStandard(menuId, servings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId, mealPeriodId, locationId]);

  const readyLines = lines.filter((line) => Number(line.actual) > 0);
  const shortLines = readyLines.filter(
    (line) => Number(line.actual) > Number(line.availableBaseQty),
  );

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitIssueAction({
        idempotencyKey,
        locationId,
        menuId: menuId || undefined,
        mealPeriodId: menuId ? mealPeriodId : undefined,
        servings: menuId ? Number(servings) || 1 : undefined,
        note: note || undefined,
        lines: readyLines.map((line) => ({
          itemId: line.itemId,
          standardBaseQty: Number(line.standardBaseQty),
          actualBaseQty: line.actual,
          lotPicks: [],
        })),
      });

      if (result.ok) {
        router.push(`/inventory/issue/${result.data.issueId}?new=1`);
        return;
      }
      setError(result.message);
    });
  };

  const canSubmit =
    locationId !== "" && readyLines.length > 0 && shortLines.length === 0 && !pending;

  return (
    <div className="flex flex-col gap-4 pb-28">
      {error ? <FormAlert message={error} /> : null}

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="เบิกจาก" htmlFor="locationId" required>
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

          <Field label="มื้อ" htmlFor="mealPeriodId" required>
            <Select
              id="mealPeriodId"
              value={mealPeriodId}
              onChange={(event) => setMealPeriodId(event.target.value)}
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.nameTh}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="เมนู"
            htmlFor="menuId"
            hint="เลือกเมนูแล้วระบบจะดึงวัตถุดิบตามสูตรมาให้"
            className="sm:col-span-2"
          >
            <SearchSelect
              id="menuId"
              name="menuId"
              defaultValue=""
              placeholder="เลือกเมนู"
              options={menus.map((menu) => ({
                value: menu.id,
                label: menu.nameTh,
                hint: menu.code,
              }))}
              onValueChange={setMenuId}
            />
          </Field>

          {menuId ? (
            <Field label="ทำกี่ครั้ง (เท่าของสูตร)" htmlFor="servings">
              <NumberInput
                id="servings"
                min={0}
                value={servings}
                onChange={(event) => {
                  setServings(event.target.value);
                  loadStandard(menuId, event.target.value);
                }}
              />
            </Field>
          ) : null}

          <Field label="หมายเหตุ" htmlFor="note">
            <Input
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="เช่น เพิ่มไก่เพราะคนเยอะ"
            />
          </Field>
        </CardContent>
      </Card>

      {versionNo ? (
        <p className="text-sm text-ink-muted">
          ใช้สูตรเวอร์ชัน {versionNo} · แก้จำนวนได้เฉพาะรายการที่ต่างจากสูตรจริงๆ
        </p>
      ) : null}

      {lines.map((line) => {
        const variance = computeVariance(line.standardBaseQty, line.actual || "0");
        const changed = Number(line.actual) !== Number(line.standardBaseQty);
        const short = Number(line.actual) > Number(line.availableBaseQty);

        return (
          <Card key={line.itemId}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{line.itemNameTh}</p>
                  <p className="text-xs text-ink-subtle">
                    ตามสูตร {formatQty(line.standardBaseQty)} {line.unitCode ?? ""} · มี{" "}
                    {formatQty(line.availableBaseQty)}
                  </p>
                </div>
                {changed ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="iconSm"
                    aria-label={`คืนค่าตามสูตรของ ${line.itemNameTh}`}
                    onClick={() =>
                      setLines((current) =>
                        current.map((row) =>
                          row.itemId === line.itemId
                            ? { ...row, actual: String(Number(row.standardBaseQty)) }
                            : row,
                        ),
                      )
                    }
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden />
                  </Button>
                ) : null}
              </div>

              <Field
                label={`เบิกจริง (${line.unitCode ?? "หน่วย"})`}
                htmlFor={`qty-${line.itemId}`}
                errors={short ? ["มากกว่าที่มีอยู่"] : undefined}
              >
                <NumberInput
                  id={`qty-${line.itemId}`}
                  className="h-14 text-xl"
                  min={0}
                  disabled={!canAdjust}
                  value={line.actual}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((row) =>
                        row.itemId === line.itemId ? { ...row, actual: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                {changed && variance.varianceBaseQty !== null ? (
                  <StatusBadge tone={Number(variance.varianceBaseQty) > 0 ? "warning" : "info"}>
                    {Number(variance.varianceBaseQty) > 0 ? "+" : ""}
                    {formatQty(variance.varianceBaseQty)} {line.unitCode ?? ""}
                    {variance.variancePercent !== null
                      ? ` (${variance.variancePercent > 0 ? "+" : ""}${variance.variancePercent.toFixed(2)}%)`
                      : ""}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="success">ตรงตามสูตร</StatusBadge>
                )}

                {Number(line.expiredBaseQty) > 0 ? (
                  <StatusBadge tone="critical">
                    มีของหมดอายุ {formatQty(line.expiredBaseQty)} ที่เบิกไม่ได้
                  </StatusBadge>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {!canAdjust && lines.length > 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <TriangleAlert className="h-4 w-4" aria-hidden />
          คุณไม่มีสิทธิ์แก้จำนวน จะเบิกตามสูตรเท่านั้น
        </p>
      ) : null}

      {readyLines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-border bg-surface p-3 lg:bottom-0 lg:left-[var(--sidebar-width,16rem)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="text-sm">
              <p className="text-ink-muted">{readyLines.length} รายการ</p>
              {shortLines.length > 0 ? (
                <p className="font-semibold text-critical">ของไม่พอ {shortLines.length} รายการ</p>
              ) : (
                <p className="font-semibold text-ink">ระบบจะเลือกลอตให้ตามวันหมดอายุ</p>
              )}
            </div>
            <Button size="lg" onClick={submit} disabled={!canSubmit} loading={pending}>
              ยืนยันเบิก
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
