"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { addQty, formatMoney, formatQty } from "@/lib/quantity";
import type { PlannerLine, PlannerSupplierGroup } from "@/services/purchase-planner-service";
import { createDraftOrdersAction } from "./planner-actions";

/**
 * The buyer reviews before anything is ordered. Every suggested line starts ticked because
 * the arithmetic is the default answer, but each one can be dropped, and the numbers behind
 * it stay on screen so the suggestion can be argued with rather than merely obeyed.
 */
export function PlannerBoard({
  groups,
  fromDate,
  toDate,
  locationId,
  canManage,
}: {
  groups: PlannerSupplierGroup[];
  fromDate: string;
  toDate: string;
  locationId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Array<{ poNumber: string; refreshed: boolean }>>([]);
  const [pending, startTransition] = useTransition();

  const activeGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          lines: group.lines.filter((line) => !excluded.has(line.itemId)),
        }))
        .filter((group) => group.lines.length > 0),
    [groups, excluded],
  );

  const toggle = (itemId: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const createOrders = () => {
    setError(null);
    setCreated([]);
    startTransition(async () => {
      const result = await createDraftOrdersAction({
        fromDate,
        toDate,
        locationId,
        supplierIds: activeGroups.map((group) => group.supplierId),
        excludedItemIds: [...excluded],
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setCreated(
        result.data.orders.map((order) => ({
          poNumber: order.poNumber,
          refreshed: order.refreshed,
        })),
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <FormAlert message={error} /> : null}

      {created.length > 0 ? (
        <FormAlert
          tone="success"
          message={created
            .map(
              (order) =>
                `${order.poNumber} ${order.refreshed ? "(อัปเดตร่างเดิม)" : "(สร้างใหม่)"}`,
            )
            .join(" · ")}
        />
      ) : null}

      {/* Every group stays on screen even when all of its lines are unticked, so a line
          dropped by mistake can always be put back. */}
      {groups.map((group) => {
        const selectedCost = group.lines
          .filter((line) => !excluded.has(line.itemId))
          .reduce<string>((total, line) => addQty(total, line.estimatedCost), "0");
        const droppedAll = group.lines.every((line) => excluded.has(line.itemId));

        return (
          <Card key={group.supplierId} className={droppedAll ? "opacity-60" : undefined}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{group.supplierNameTh}</CardTitle>
                <div className="flex items-center gap-2">
                  {droppedAll ? (
                    <StatusBadge tone="muted">ไม่สั่งจากรายนี้</StatusBadge>
                  ) : group.isLate ? (
                    <StatusBadge tone="critical">เลยกำหนดสั่งแล้ว</StatusBadge>
                  ) : group.orderByDate ? (
                    <StatusBadge tone="info">สั่งภายใน {group.orderByDate}</StatusBadge>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    ≈ {formatMoney(selectedCost)}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              <ul className="flex flex-col gap-2">
                {group.lines.map((line) => (
                  <PlannerRow
                    key={line.itemId}
                    line={line}
                    included={!excluded.has(line.itemId)}
                    onToggle={() => toggle(line.itemId)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      {canManage ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-muted">
            ระบบจะสร้าง <strong>ใบสั่งซื้อร่าง</strong> แยกตามผู้ขาย {activeGroups.length} ใบ —
            ยังไม่ส่งให้ผู้ขายจนกว่าจะอนุมัติ
          </p>
          <Button
            size="lg"
            loading={pending}
            disabled={activeGroups.length === 0}
            onClick={createOrders}
          >
            สร้างใบสั่งซื้อร่าง
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          ต้องมีสิทธิ์จัดการใบสั่งซื้อจึงจะสร้างใบสั่งซื้อจากแผนนี้ได้
        </p>
      )}
    </div>
  );
}

function PlannerRow({
  line,
  included,
  onToggle,
}: {
  line: PlannerLine;
  included: boolean;
  onToggle: () => void;
}) {
  const unit = line.baseUnitCode ?? "";

  return (
    <li className="rounded-[var(--radius-control)] border border-border p-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={included}
          onChange={onToggle}
          aria-label={`สั่งซื้อ ${line.itemNameTh}`}
          className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{line.itemNameTh}</span>
            <span className="text-xs text-ink-subtle">{line.itemCode}</span>
            {line.isLate ? <StatusBadge tone="critical">สั่งช้าแล้ว</StatusBadge> : null}
            {Number(line.surplusBaseQty) > 0 ? (
              <StatusBadge tone="warning">
                เกินความต้องการ {formatQty(line.surplusBaseQty)} {unit}
              </StatusBadge>
            ) : null}
          </div>

          <p className="mt-1 text-xs text-ink-muted">
            ต้องใช้ {formatQty(line.requiredBaseQty)} + สำรอง {formatQty(line.safetyStockBaseQty)} −
            คงเหลือ {formatQty(line.onHandBaseQty)} − กำลังมา {formatQty(line.onOrderBaseQty)} ={" "}
            <strong className="text-ink">
              ขาด {formatQty(line.shortfallBaseQty)} {unit}
            </strong>
          </p>

          <p className="mt-0.5 text-xs text-ink-subtle">
            {line.orderByDate ? `สั่งภายใน ${line.orderByDate} · ` : ""}
            ใช้วันแรก {line.firstNeededDate ?? "—"} · lead time {line.leadTimeDays} วัน
            {Number(line.moq) > 0 ? ` · ขั้นต่ำ ${formatQty(line.moq)}` : ""}
            {line.packSize ? ` · แพ็กละ ${formatQty(line.packSize)}` : ""}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold tabular-nums text-ink">
            {formatQty(line.suggestedPurchaseQty)}
            <span className="ml-1 text-sm font-normal text-ink-muted">
              {line.purchaseUnitCode ?? ""}
            </span>
          </p>
          <p className="text-xs text-ink-muted">
            {line.unitPrice ? `≈ ${formatMoney(line.estimatedCost)}` : "ยังไม่มีราคา"}
          </p>
        </div>
      </div>
    </li>
  );
}

/** Items the kitchen needs that nobody is set up to sell yet. */
export function UnsourcedList({ lines }: { lines: PlannerLine[] }) {
  if (lines.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>ยังไม่มีผู้ขาย</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        <p className="mb-3 text-sm text-ink-muted">
          วัตถุดิบเหล่านี้ขาด แต่ยังไม่ได้ผูกกับผู้ขายรายใด จึงออกใบสั่งซื้อให้อัตโนมัติไม่ได้
        </p>
        <ul className="flex flex-col gap-2">
          {lines.map((line) => (
            <li
              key={line.itemId}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{line.itemNameTh}</p>
                <p className="mt-0.5 text-xs text-ink-subtle">{line.itemCode}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="tabular-nums text-ink">
                  ขาด {formatQty(line.shortfallBaseQty)} {line.baseUnitCode ?? ""}
                </span>
                <Button asChild size="sm" variant="secondary">
                  <Link href={`/items/${line.itemId}`}>ตั้งค่าผู้ขาย</Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
