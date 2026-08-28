import { and, asc, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/database/client";
import {
  inventoryLots,
  items,
  menuPlanItems,
  menuPlans,
  menus,
  purchaseOrderItems,
  purchaseOrders,
  stockBalances,
  stockIssues,
} from "@/database/schema";
import { requireUser } from "@/lib/auth/session";
import { addDays, todayIso } from "@/lib/date";
import { hasPermission, PERMISSIONS, type PermissionCode } from "@/lib/permissions";
import { formatQty } from "@/lib/quantity";
import { getExpiryThresholds } from "./settings-service";

/**
 * What needs attention right now, worked out from the data every time it is asked.
 *
 * Nothing here is stored. An alert about expired stock is a fact about the stock, not a row
 * with its own lifecycle — so there is no table to go stale, no job to invalidate it, and no
 * dismiss button that would let someone silence a condition without fixing it. Deal with the
 * stock and the alert is gone on the next load; ignore it and it is still there tomorrow.
 *
 * Every alert is scoped to a permission, so the list only ever shows work the person looking
 * at it could actually do something about.
 */

export type AlertSeverity = "critical" | "warning" | "info";

export type Alert = {
  /** Stable across loads, so the UI can key on it. */
  id: string;
  severity: AlertSeverity;
  titleTh: string;
  detailTh: string;
  href: string;
  count: number;
  /** One concrete instance, so the reader sees a real thing rather than only a number. */
  exampleTh: string | null;
  permission: PermissionCode;
};

export type AlertReport = {
  today: string;
  alerts: Alert[];
  counts: Record<AlertSeverity, number>;
};

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Each source runs only when the viewer holds its permission — an unreadable alert would
 * be worse than none, since it names a problem the reader cannot open or fix.
 */
export async function getAlerts(options: { today?: string } = {}): Promise<AlertReport> {
  const user = await requireUser();
  const today = options.today ?? todayIso();
  const organizationId = user.organizationId;

  const canSeeStock = hasPermission(user.permissions, PERMISSIONS.STOCK_VIEW);
  const canSeePurchasing = hasPermission(user.permissions, PERMISSIONS.PO_VIEW);
  const canApprovePurchasing = hasPermission(user.permissions, PERMISSIONS.PO_APPROVE);
  const canSeeMenu = hasPermission(user.permissions, PERMISSIONS.MENU_VIEW);
  const canIssue = hasPermission(user.permissions, PERMISSIONS.ISSUE_CREATE);

  const thresholds = canSeeStock ? await getExpiryThresholds(organizationId) : [];
  const urgentDays = thresholds[0] ?? 1;

  const [expired, expiringSoon, belowReorder, overdue, pendingApproval, unconfirmed, notIssued] =
    await Promise.all([
      canSeeStock ? countLotsExpiringBefore(organizationId, today) : zero(),
      canSeeStock
        ? countLotsExpiringBetween(organizationId, today, addDays(today, urgentDays))
        : zero(),
      canSeeStock ? countItemsBelowReorder(organizationId) : zero(),
      canSeePurchasing ? countOverdueDeliveries(organizationId, today) : zero(),
      canApprovePurchasing ? countOrdersAwaitingApproval(organizationId) : zero(),
      canSeeMenu ? countUnconfirmedPlans(organizationId, today) : zero(),
      canIssue ? countConfirmedPlansWithoutIssue(organizationId, today) : zero(),
    ]);

  const alerts: Alert[] = [];

  if (expired.count > 0) {
    alerts.push({
      id: "expired-stock",
      severity: "critical",
      titleTh: "มีของหมดอายุค้างอยู่ในสต๊อก",
      detailTh: `${expired.count} ลอตหมดอายุแล้วแต่ยังมียอดคงเหลือ ต้องนำออกก่อนถูกหยิบไปใช้`,
      href: "/inventory/expiry",
      count: expired.count,
      exampleTh: expired.exampleTh,
      permission: PERMISSIONS.STOCK_VIEW,
    });
  }

  if (overdue.count > 0) {
    alerts.push({
      id: "delivery-overdue",
      severity: "critical",
      titleTh: "ใบสั่งซื้อเลยกำหนดส่งแล้ว",
      detailTh: `${overdue.count} ใบเลยวันที่นัดส่ง แต่ยังรับของไม่ครบ ควรตามกับผู้ขาย`,
      href: "/purchasing/orders",
      count: overdue.count,
      exampleTh: overdue.exampleTh,
      permission: PERMISSIONS.PO_VIEW,
    });
  }

  if (expiringSoon.count > 0) {
    alerts.push({
      id: "expiring-soon",
      severity: "warning",
      titleTh: `ของจะหมดอายุภายใน ${urgentDays} วัน`,
      detailTh: `${expiringSoon.count} ลอตต้องรีบใช้ก่อน ระบบจะหยิบลอตเหล่านี้ให้ก่อนอยู่แล้วตาม FEFO`,
      href: "/inventory/expiry",
      count: expiringSoon.count,
      exampleTh: expiringSoon.exampleTh,
      permission: PERMISSIONS.STOCK_VIEW,
    });
  }

  if (belowReorder.count > 0) {
    alerts.push({
      id: "below-reorder",
      severity: "warning",
      titleTh: "วัตถุดิบต่ำกว่าจุดสั่งซื้อ",
      detailTh: `${belowReorder.count} รายการเหลือน้อยกว่าจุดสั่งซื้อที่ตั้งไว้`,
      href: "/purchasing/planner",
      count: belowReorder.count,
      exampleTh: belowReorder.exampleTh,
      permission: PERMISSIONS.STOCK_VIEW,
    });
  }

  if (unconfirmed.count > 0) {
    alerts.push({
      id: "plan-unconfirmed",
      severity: "warning",
      titleTh: "แผนเมนูยังไม่ยืนยัน",
      detailTh: `${unconfirmed.count} แผนของวันนี้และพรุ่งนี้ยังเป็นร่าง — แผนที่ยังไม่ยืนยันจะไม่ถูกนับเป็นความต้องการวัตถุดิบ`,
      href: "/menu/planner",
      count: unconfirmed.count,
      exampleTh: unconfirmed.exampleTh,
      permission: PERMISSIONS.MENU_VIEW,
    });
  }

  if (pendingApproval.count > 0) {
    alerts.push({
      id: "po-awaiting-approval",
      severity: "info",
      titleTh: "ใบสั่งซื้อรออนุมัติ",
      detailTh: `${pendingApproval.count} ใบรอการอนุมัติจากคุณ`,
      href: "/purchasing/orders?status=PENDING",
      count: pendingApproval.count,
      exampleTh: pendingApproval.exampleTh,
      permission: PERMISSIONS.PO_APPROVE,
    });
  }

  if (notIssued.count > 0) {
    alerts.push({
      id: "plan-not-issued",
      severity: "info",
      titleTh: "แผนวันนี้ยังไม่ได้เบิกของ",
      detailTh: `${notIssued.count} เมนูที่ยืนยันไว้สำหรับวันนี้ยังไม่มีใบเบิก`,
      href: "/menu/planner",
      count: notIssued.count,
      exampleTh: notIssued.exampleTh,
      permission: PERMISSIONS.ISSUE_CREATE,
    });
  }

  alerts.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count,
  );

  return {
    today,
    alerts,
    counts: {
      critical: alerts.filter((alert) => alert.severity === "critical").length,
      warning: alerts.filter((alert) => alert.severity === "warning").length,
      info: alerts.filter((alert) => alert.severity === "info").length,
    },
  };
}

type Signal = { count: number; exampleTh: string | null };

const zero = async (): Promise<Signal> => ({ count: 0, exampleTh: null });

/** Reads the total and one example in a single round trip. */
function signalFrom<T extends { total: unknown }>(
  rows: T[],
  describe: (row: T) => string,
): Signal {
  const first = rows[0];
  if (!first) return { count: 0, exampleTh: null };
  return { count: Number(first.total), exampleTh: describe(first) };
}

/** Lots already past their expiry date that still have stock sitting against them. */
async function countLotsExpiringBefore(organizationId: string, today: string): Promise<Signal> {
  const rows = await db
    .select({
      total: sql<number>`count(*) over ()`,
      itemNameTh: items.nameTh,
      lotNumber: inventoryLots.lotNumber,
      expiryDate: inventoryLots.expiryDate,
    })
    .from(stockBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockBalances.lotId))
    .innerJoin(items, eq(items.id, stockBalances.itemId))
    .where(
      and(
        eq(stockBalances.organizationId, organizationId),
        gt(stockBalances.baseQty, "0"),
        isNotNull(inventoryLots.expiryDate),
        lt(inventoryLots.expiryDate, today),
      ),
    )
    .orderBy(asc(inventoryLots.expiryDate))
    .limit(1);

  return signalFrom(
    rows,
    (row) => `${row.itemNameTh} ลอต ${row.lotNumber} หมดอายุ ${row.expiryDate}`,
  );
}

/** Not yet expired, but inside the urgent window — today counts as urgent, not as expired. */
async function countLotsExpiringBetween(
  organizationId: string,
  fromDate: string,
  toDate: string,
): Promise<Signal> {
  const rows = await db
    .select({
      total: sql<number>`count(*) over ()`,
      itemNameTh: items.nameTh,
      lotNumber: inventoryLots.lotNumber,
      expiryDate: inventoryLots.expiryDate,
    })
    .from(stockBalances)
    .innerJoin(inventoryLots, eq(inventoryLots.id, stockBalances.lotId))
    .innerJoin(items, eq(items.id, stockBalances.itemId))
    .where(
      and(
        eq(stockBalances.organizationId, organizationId),
        gt(stockBalances.baseQty, "0"),
        isNotNull(inventoryLots.expiryDate),
        sql`${inventoryLots.expiryDate} >= ${fromDate}::date`,
        sql`${inventoryLots.expiryDate} <= ${toDate}::date`,
      ),
    )
    .orderBy(asc(inventoryLots.expiryDate))
    .limit(1);

  return signalFrom(
    rows,
    (row) => `${row.itemNameTh} ลอต ${row.lotNumber} หมดอายุ ${row.expiryDate}`,
  );
}

/**
 * Counted per item across every location, because the reorder point is a property of the
 * item: stock split between two buildings is still one decision about whether to buy more.
 */
async function countItemsBelowReorder(organizationId: string): Promise<Signal> {
  const rows = await db
    .select({
      itemNameTh: items.nameTh,
      onHand: sql<string>`coalesce(sum(${stockBalances.baseQty}), 0)`,
      reorderPoint: items.reorderPoint,
    })
    .from(items)
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.itemId, items.id), eq(stockBalances.organizationId, organizationId)),
    )
    .where(
      and(
        eq(items.organizationId, organizationId),
        eq(items.isActive, true),
        gt(items.reorderPoint, "0"),
      ),
    )
    .groupBy(items.id, items.nameTh, items.reorderPoint);

  const below = rows.filter((row) => Number(row.onHand) <= Number(row.reorderPoint));
  const first = below[0];

  return {
    count: below.length,
    exampleTh: first
      ? `${first.itemNameTh} เหลือ ${formatQty(first.onHand)} (จุดสั่งซื้อ ${formatQty(first.reorderPoint)})`
      : null,
  };
}

/** Orders whose promised date has passed while lines are still outstanding. */
async function countOverdueDeliveries(organizationId: string, today: string): Promise<Signal> {
  const rows = await db
    .select({
      total: sql<number>`count(*) over ()`,
      poNumber: purchaseOrders.poNumber,
      expectedDate: purchaseOrders.expectedDate,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.organizationId, organizationId),
        inArray(purchaseOrders.status, ["APPROVED", "SENT", "PARTIALLY_RECEIVED"]),
        isNotNull(purchaseOrders.expectedDate),
        lt(purchaseOrders.expectedDate, today),
        sql`exists (
          select 1 from ${purchaseOrderItems}
          where ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id}
            and ${purchaseOrderItems.receivedBaseQty} < ${purchaseOrderItems.orderedBaseQty}
        )`,
      ),
    )
    .orderBy(asc(purchaseOrders.expectedDate))
    .limit(1);

  return signalFrom(rows, (row) => `${row.poNumber} นัดส่ง ${row.expectedDate}`);
}

async function countOrdersAwaitingApproval(organizationId: string): Promise<Signal> {
  const rows = await db
    .select({
      total: sql<number>`count(*) over ()`,
      poNumber: purchaseOrders.poNumber,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.organizationId, organizationId),
        eq(purchaseOrders.status, "PENDING"),
      ),
    )
    .orderBy(asc(purchaseOrders.orderDate))
    .limit(1);

  return signalFrom(rows, (row) => `${row.poNumber} รออนุมัติ`);
}

/** Draft plans for today and tomorrow — a draft contributes nothing until it is confirmed. */
async function countUnconfirmedPlans(organizationId: string, today: string): Promise<Signal> {
  const rows = await db
    .select({
      total: sql<number>`count(*) over ()`,
      planDate: menuPlans.planDate,
    })
    .from(menuPlans)
    .where(
      and(
        eq(menuPlans.organizationId, organizationId),
        eq(menuPlans.status, "DRAFT"),
        sql`${menuPlans.planDate} between ${today}::date and ${addDays(today, 1)}::date`,
        sql`exists (
          select 1 from ${menuPlanItems} where ${menuPlanItems.menuPlanId} = ${menuPlans.id}
        )`,
      ),
    )
    .orderBy(asc(menuPlans.planDate))
    .limit(1);

  return signalFrom(rows, (row) => `แผนวันที่ ${row.planDate} ยังเป็นร่าง`);
}

/**
 * Menus confirmed for today that no issue has been posted against yet.
 *
 * "Done" is read from whether the document exists, not from a checkbox someone ticked — a
 * task list that can be marked complete without the work happening is worse than no list.
 */
async function countConfirmedPlansWithoutIssue(
  organizationId: string,
  today: string,
): Promise<Signal> {
  const rows = await db
    .select({
      total: sql<number>`count(*) over ()`,
      menuNameTh: menus.nameTh,
    })
    .from(menuPlanItems)
    .innerJoin(menuPlans, eq(menuPlans.id, menuPlanItems.menuPlanId))
    .innerJoin(menus, eq(menus.id, menuPlanItems.menuId))
    .where(
      and(
        eq(menuPlans.organizationId, organizationId),
        eq(menuPlans.planDate, today),
        inArray(menuPlans.status, ["CONFIRMED", "IN_PROGRESS"]),
        sql`not exists (
          select 1 from ${stockIssues}
          where ${stockIssues.menuPlanItemId} = ${menuPlanItems.id}
            and ${stockIssues.status} <> 'CANCELLED'
        )`,
      ),
    )
    .limit(1);

  return signalFrom(rows, (row) => `${row.menuNameTh} ยังไม่มีใบเบิก`);
}

/** Re-exported for the dashboard, which shows only what is urgent. */
export function urgentAlerts(report: AlertReport): Alert[] {
  return report.alerts.filter((alert) => alert.severity !== "info");
}
