import { and, eq, sql } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import {
  items,
  locations,
  purchaseOrderItems,
  purchaseOrders,
  supplierItems,
  suppliers,
} from "@/database/schema";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";
import { compareQty, mulQty, subQty, toNumericString } from "@/lib/quantity";
import type { PurchaseOrderInput, PurchaseOrderStatus } from "@/schemas/purchase-order";
import { writeAuditLog } from "./audit-service";
import { nextDocumentNumber, retryOnDuplicateNumber } from "./document-number-service";

/** States where the lines may still be edited. */
const EDITABLE_STATUSES = new Set<PurchaseOrderStatus>(["DRAFT", "PENDING"]);

/** States a receipt may be booked against. */
const RECEIVABLE_STATUSES = new Set<PurchaseOrderStatus>([
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
]);

async function loadOrder(executor: DbExecutor, organizationId: string, purchaseOrderId: string) {
  const [order] = await executor
    .select()
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.id, purchaseOrderId),
        eq(purchaseOrders.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!order) throw new AppError("NOT_FOUND", "ไม่พบใบสั่งซื้อ");
  return order;
}

async function writeLines(
  tx: DbExecutor,
  organizationId: string,
  purchaseOrderId: string,
  input: PurchaseOrderInput,
) {
  await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));

  for (const line of input.lines) {
    const [item] = await tx
      .select({ id: items.id, isActive: items.isActive })
      .from(items)
      .where(and(eq(items.id, line.itemId), eq(items.organizationId, organizationId)))
      .limit(1);
    if (!item) throw new AppError("NOT_FOUND", "ไม่พบรายการสินค้า");
    if (!item.isActive) throw new AppError("VALIDATION", "วัตถุดิบนี้ถูกปิดใช้งานแล้ว");

    await tx.insert(purchaseOrderItems).values({
      purchaseOrderId,
      itemId: line.itemId,
      orderedQty: toNumericString(line.orderedQty),
      purchaseUnitId: line.purchaseUnitId,
      conversionToBase: toNumericString(line.conversionToBase),
      orderedBaseQty: mulQty(line.orderedQty, line.conversionToBase),
      unitPrice: line.unitPrice === undefined ? "0" : toNumericString(line.unitPrice),
      note: line.note ?? null,
    });
  }
}

export async function createPurchaseOrder(input: PurchaseOrderInput) {
  const user = await requirePermission(PERMISSIONS.PO_MANAGE);

  return retryOnDuplicateNumber(() =>
    db.transaction(async (tx) => {
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(
            eq(suppliers.id, input.supplierId),
            eq(suppliers.organizationId, user.organizationId),
          ),
        )
        .limit(1);
      if (!supplier) throw new AppError("NOT_FOUND", "ไม่พบผู้ขาย");

      const [location] = await tx
        .select({ id: locations.id, holdsStock: locations.holdsStock })
        .from(locations)
        .where(
          and(
            eq(locations.id, input.deliverToLocationId),
            eq(locations.organizationId, user.organizationId),
          ),
        )
        .limit(1);
      if (!location) throw new AppError("NOT_FOUND", "ไม่พบสถานที่");
      if (!location.holdsStock) {
        throw new AppError("VALIDATION", "สถานที่นี้ไม่รองรับการเก็บสต๊อก");
      }

      const poNumber = await nextDocumentNumber(tx, user.organizationId, "purchaseOrder");

      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          organizationId: user.organizationId,
          poNumber,
          supplierId: input.supplierId,
          deliverToLocationId: input.deliverToLocationId,
          status: "DRAFT",
          orderDate: input.orderDate,
          expectedDate: input.expectedDate ?? null,
          note: input.note ?? null,
          createdBy: user.id,
        })
        .returning();

      await writeLines(tx, user.organizationId, order!.id, input);

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entityType: "purchase_order",
        entityId: order!.id,
        afterData: { poNumber, supplierId: input.supplierId, lines: input.lines.length },
      });

      return { purchaseOrderId: order!.id, poNumber };
    }),
  );
}

export async function updatePurchaseOrder(purchaseOrderId: string, input: PurchaseOrderInput) {
  const user = await requirePermission(PERMISSIONS.PO_MANAGE);

  return db.transaction(async (tx) => {
    const order = await loadOrder(tx, user.organizationId, purchaseOrderId);

    // Once a supplier has been told what to deliver, the order stops being editable.
    if (!EDITABLE_STATUSES.has(order.status as PurchaseOrderStatus)) {
      throw new AppError("VALIDATION", "ใบสั่งซื้อนี้แก้ไขไม่ได้แล้ว");
    }

    await tx
      .update(purchaseOrders)
      .set({
        supplierId: input.supplierId,
        deliverToLocationId: input.deliverToLocationId,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate ?? null,
        note: input.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, purchaseOrderId));

    await writeLines(tx, user.organizationId, purchaseOrderId, input);

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entityType: "purchase_order",
      entityId: purchaseOrderId,
      beforeData: { status: order.status },
      afterData: { lines: input.lines.length },
    });

    return { purchaseOrderId };
  });
}

const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ["PENDING", "CANCELLED"],
  PENDING: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["SENT", "CANCELLED"],
  SENT: ["CANCELLED"],
  // Receiving drives these two; they are not set by hand.
  PARTIALLY_RECEIVED: ["CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

/**
 * Moves an order along its workflow. Approval is a separate permission from editing, so a
 * buyer cannot approve their own order unless they also hold `po.approve`.
 */
export async function setPurchaseOrderStatus(
  purchaseOrderId: string,
  status: PurchaseOrderStatus,
  reason?: string,
) {
  const permission = status === "APPROVED" ? PERMISSIONS.PO_APPROVE : PERMISSIONS.PO_MANAGE;
  const user = await requirePermission(permission);

  return db.transaction(async (tx) => {
    const order = await loadOrder(tx, user.organizationId, purchaseOrderId);
    const current = order.status as PurchaseOrderStatus;

    if (!ALLOWED_TRANSITIONS[current].includes(status)) {
      throw new AppError(
        "VALIDATION",
        `เปลี่ยนสถานะจาก ${current} เป็น ${status} ไม่ได้`,
      );
    }

    if (status === "PENDING") {
      const lines = await tx
        .select({ id: purchaseOrderItems.id })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));
      if (lines.length === 0) {
        throw new AppError("VALIDATION", "ใบสั่งซื้อยังไม่มีรายการ ส่งอนุมัติไม่ได้");
      }
    }

    if (status === "CANCELLED") {
      const received = await tx
        .select({ receivedBaseQty: purchaseOrderItems.receivedBaseQty })
        .from(purchaseOrderItems)
        .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));
      if (received.some((line) => compareQty(line.receivedBaseQty, "0") > 0)) {
        throw new AppError("VALIDATION", "ใบสั่งซื้อนี้รับของไปแล้วบางส่วน ยกเลิกไม่ได้");
      }
    }

    const now = new Date();
    const [updated] = await tx
      .update(purchaseOrders)
      .set({
        status,
        approvedBy: status === "APPROVED" ? user.id : order.approvedBy,
        approvedAt: status === "APPROVED" ? now : order.approvedAt,
        cancelledBy: status === "CANCELLED" ? user.id : order.cancelledBy,
        cancelledAt: status === "CANCELLED" ? now : order.cancelledAt,
        cancelReason: status === "CANCELLED" ? (reason ?? null) : order.cancelReason,
        updatedAt: now,
      })
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .returning();

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action:
        status === "APPROVED" ? "APPROVE" : status === "CANCELLED" ? "CANCEL" : "UPDATE",
      entityType: "purchase_order",
      entityId: purchaseOrderId,
      beforeData: { status: current },
      afterData: { status },
      note: reason ?? null,
    });

    return updated!;
  });
}

/**
 * Books received quantities against the order and recomputes its status.
 *
 * Status is derived from the lines rather than set by whoever happened to receive last:
 * nothing received keeps the workflow status, some received is PARTIALLY_RECEIVED, and
 * every line met or exceeded is RECEIVED. Over-delivery still completes the line — the
 * excess is a fact about the delivery, not a reason to keep the order open forever.
 */
export async function applyReceiptToPurchaseOrder(
  tx: DbExecutor,
  organizationId: string,
  purchaseOrderId: string,
  received: Array<{ purchaseOrderItemId: string; baseQty: string }>,
): Promise<PurchaseOrderStatus> {
  const order = await loadOrder(tx, organizationId, purchaseOrderId);
  const current = order.status as PurchaseOrderStatus;

  if (!RECEIVABLE_STATUSES.has(current)) {
    throw new AppError(
      "VALIDATION",
      current === "RECEIVED"
        ? "ใบสั่งซื้อนี้รับสินค้าครบแล้ว"
        : "ใบสั่งซื้อนี้ยังไม่พร้อมรับสินค้า (ต้องอนุมัติก่อน)",
    );
  }

  for (const entry of received) {
    // Relative update: the running total is incremented in the database rather than
    // read into JavaScript and written back, so two receipts cannot lose one another.
    const updated = await tx
      .update(purchaseOrderItems)
      .set({
        receivedBaseQty: sql`${purchaseOrderItems.receivedBaseQty} + ${toNumericString(entry.baseQty)}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrderItems.id, entry.purchaseOrderItemId),
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
        ),
      )
      .returning({ id: purchaseOrderItems.id });

    if (updated.length === 0) throw new AppError("NOT_FOUND", "ไม่พบรายการในใบสั่งซื้อ");
  }

  const lines = await tx
    .select({
      orderedBaseQty: purchaseOrderItems.orderedBaseQty,
      receivedBaseQty: purchaseOrderItems.receivedBaseQty,
    })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId));

  const anyReceived = lines.some((line) => compareQty(line.receivedBaseQty, "0") > 0);
  const allReceived = lines.every(
    (line) => compareQty(line.receivedBaseQty, line.orderedBaseQty) >= 0,
  );

  const nextStatus: PurchaseOrderStatus = allReceived
    ? "RECEIVED"
    : anyReceived
      ? "PARTIALLY_RECEIVED"
      : current;

  if (nextStatus !== current) {
    await tx
      .update(purchaseOrders)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, purchaseOrderId));
  }

  return nextStatus;
}

/** Ordered minus received, never below zero. */
export function remainingBaseQty(orderedBaseQty: string, receivedBaseQty: string): string {
  const remaining = subQty(orderedBaseQty, receivedBaseQty);
  return compareQty(remaining, "0") > 0 ? remaining : "0.0000";
}

/**
 * How this order's price compares with what the supplier last charged, so a buyer sees a
 * jump before approving rather than after the invoice arrives.
 */
export async function getPriceComparison(
  organizationId: string,
  supplierId: string,
  lines: Array<{ itemId: string; unitPrice: string }>,
): Promise<Map<string, { lastPrice: string | null; changePercent: number | null }>> {
  const result = new Map<string, { lastPrice: string | null; changePercent: number | null }>();

  for (const line of lines) {
    const [mapping] = await db
      .select({ lastPrice: supplierItems.lastPrice })
      .from(supplierItems)
      .innerJoin(items, eq(items.id, supplierItems.itemId))
      .where(
        and(
          eq(supplierItems.supplierId, supplierId),
          eq(supplierItems.itemId, line.itemId),
          eq(items.organizationId, organizationId),
        ),
      )
      .limit(1);

    const last = mapping?.lastPrice ?? null;
    const changePercent =
      last === null || Number(last) === 0
        ? null
        : ((Number(line.unitPrice) - Number(last)) / Number(last)) * 100;

    result.set(line.itemId, { lastPrice: last, changePercent });
  }

  return result;
}
