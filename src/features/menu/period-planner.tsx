"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, NumberInput, Select } from "@/components/ui/field";
import { SearchSelect } from "@/components/ui/search-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { FormAlert } from "@/components/ui/states";
import {
  applyTemplateAction,
  copyPlanAction,
  savePlanMenusAction,
  savePlanTemplateAction,
  setPlanStatusAction,
} from "./planner-actions";

export type PlannerMenuOption = { id: string; code: string; nameTh: string };
export type PlannerPlanItem = {
  menuId: string;
  menuCode: string;
  menuNameTh: string;
  plannedServings: string;
  versionNo: number | null;
};

const STATUS_LABELS: Record<string, { label: string; tone: "muted" | "success" | "info" | "warning" }> = {
  DRAFT: { label: "ฉบับร่าง", tone: "muted" },
  CONFIRMED: { label: "ยืนยันแล้ว", tone: "success" },
  IN_PROGRESS: { label: "กำลังทำ", tone: "info" },
  COMPLETED: { label: "เสร็จแล้ว", tone: "success" },
  CANCELLED: { label: "ยกเลิก", tone: "warning" },
};

/**
 * One meal period's line-up for a day. Kept deliberately small: pick menus, say how many
 * times each recipe is made, confirm. Only a confirmed plan becomes real demand.
 */
export function PeriodPlanner({
  planDate,
  locationId,
  period,
  otherPeriods,
  status,
  items,
  menuOptions,
  templates,
  canManage,
}: {
  planDate: string;
  locationId: string;
  period: { id: string; code: string; nameTh: string };
  otherPeriods: Array<{ id: string; nameTh: string }>;
  status: string;
  items: PlannerPlanItem[];
  menuOptions: PlannerMenuOption[];
  templates: Array<{ id: string; nameTh: string }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState(() =>
    items.map((item) => ({
      menuId: item.menuId,
      label: `${item.menuNameTh} (${item.menuCode})`,
      plannedServings: String(Number(item.plannedServings)),
      versionNo: item.versionNo,
    })),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [templateName, setTemplateName] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setRows(
      items.map((item) => ({
        menuId: item.menuId,
        label: `${item.menuNameTh} (${item.menuCode})`,
        plannedServings: String(Number(item.plannedServings)),
        versionNo: item.versionNo,
      })),
    );
  }, [items]);

  const base = { planDate, locationId, mealPeriodId: period.id };

  const run = (work: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.message ?? "ไม่สามารถบันทึกได้");
        return;
      }
      router.refresh();
    });
  };

  const addMenu = (menuId: string) => {
    if (!menuId || rows.some((row) => row.menuId === menuId)) return;
    const menu = menuOptions.find((option) => option.id === menuId);
    if (!menu) return;
    setRows((current) => [
      ...current,
      { menuId, label: `${menu.nameTh} (${menu.code})`, plannedServings: "1", versionNo: null },
    ]);
  };

  const statusMeta = STATUS_LABELS[status] ?? STATUS_LABELS.DRAFT!;
  const readOnly = !canManage || status === "COMPLETED" || status === "CANCELLED";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{period.nameTh}</CardTitle>
        <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {error ? <FormAlert message={error} /> : null}

        {!readOnly ? (
          <Field label="เพิ่มเมนู" htmlFor={`add-${period.id}`}>
            <SearchSelect
              id={`add-${period.id}`}
              name={`add-${period.id}`}
              defaultValue=""
              placeholder="ค้นหาเมนูแล้วแตะเพื่อเพิ่ม"
              options={menuOptions.map((menu) => ({
                value: menu.id,
                label: menu.nameTh,
                hint: menu.code,
              }))}
              onValueChange={addMenu}
              resetAfterSelect
            />
          </Field>
        ) : null}

        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-muted">ยังไม่มีเมนูในมื้อนี้</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.menuId}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{row.label}</p>
                  {row.versionNo ? (
                    <p className="text-xs text-ink-subtle">ใช้สูตร v{row.versionNo}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <NumberInput
                    aria-label={`จำนวนที่ทำของ ${row.label}`}
                    className="w-24"
                    min={0}
                    disabled={readOnly}
                    value={row.plannedServings}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((entry) =>
                          entry.menuId === row.menuId
                            ? { ...entry, plannedServings: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      aria-label={`ลบ ${row.label}`}
                      onClick={() =>
                        setRows((current) => current.filter((entry) => entry.menuId !== row.menuId))
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!readOnly ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={pending}
                onClick={() =>
                  run(() =>
                    savePlanMenusAction({
                      ...base,
                      menus: rows.map((row) => ({
                        menuId: row.menuId,
                        plannedServings: Number(row.plannedServings),
                      })),
                    }),
                  )
                }
              >
                บันทึกแผน
              </Button>

              <Button
                size="sm"
                variant="secondary"
                disabled={status === "CONFIRMED" || rows.length === 0}
                onClick={() => run(() => setPlanStatusAction({ ...base, status: "CONFIRMED" }))}
              >
                ยืนยันแผน
              </Button>

              {status === "CONFIRMED" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => run(() => setPlanStatusAction({ ...base, status: "DRAFT" }))}
                >
                  กลับเป็นร่าง
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => run(() => copyPlanAction({ ...base, source: { kind: "PREVIOUS_DAY" } }))}
              >
                <Copy className="h-4 w-4" aria-hidden />
                คัดลอกเมื่อวาน
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  run(() => copyPlanAction({ ...base, source: { kind: "PREVIOUS_WEEK" } }))
                }
              >
                <CalendarDays className="h-4 w-4" aria-hidden />
                คัดลอกสัปดาห์ที่แล้ว
              </Button>
              {otherPeriods.map((other) => (
                <Button
                  key={other.id}
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    run(() =>
                      copyPlanAction({
                        ...base,
                        source: { kind: "OTHER_PERIOD", fromMealPeriodId: other.id },
                      }),
                    )
                  }
                >
                  คัดลอกจาก{other.nameTh}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <Field label="บันทึกเป็นเทมเพลต" htmlFor={`tpl-${period.id}`} className="flex-1">
                <Input
                  id={`tpl-${period.id}`}
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="เช่น ชุดวันจันทร์"
                />
              </Field>
              <Button
                size="sm"
                variant="secondary"
                disabled={templateName.trim() === "" || rows.length === 0}
                onClick={() =>
                  run(async () => {
                    const result = await savePlanTemplateAction({ ...base, nameTh: templateName });
                    if (result.ok) setTemplateName("");
                    return result;
                  })
                }
              >
                บันทึกเทมเพลต
              </Button>

              {templates.length > 0 ? (
                <Field label="ใช้เทมเพลต" htmlFor={`apply-${period.id}`} className="flex-1">
                  <Select
                    id={`apply-${period.id}`}
                    defaultValue=""
                    onChange={(event) => {
                      const templateId = event.target.value;
                      if (!templateId) return;
                      run(() => applyTemplateAction({ ...base, templateId }));
                    }}
                  >
                    <option value="">เลือกเทมเพลต</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.nameTh}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
