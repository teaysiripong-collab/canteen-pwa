import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Every stock movement in the system is one of these ledger entry types.
 * Directionality (in/out) is derived from the type, never from the sign of quantity.
 */
export const inventoryTransactionTypeEnum = pgEnum("inventory_transaction_type", [
  "RECEIVE",
  "ISSUE",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "WASTE",
  "RETURN_TO_SUPPLIER",
  "RETURN_TO_STOCK",
  "STOCK_COUNT_ADJUSTMENT",
  "OPENING_BALANCE",
  "REVERSAL",
]);

/**
 * Whether a ledger row adds to or removes from a balance. It is stored rather than
 * inferred at read time because two types are not directional on their own: a REVERSAL
 * mirrors whatever it reverses, and a stock-count adjustment can go either way.
 * For every other type the service derives it from the type and a test enforces that.
 */
export const stockDirectionEnum = pgEnum("stock_direction", ["IN", "OUT"]);

export const referenceTypeEnum = pgEnum("reference_type", [
  "GOODS_RECEIPT",
  "STOCK_ISSUE",
  "STOCK_TRANSFER",
  "STOCK_COUNT",
  "MANUAL_ADJUSTMENT",
  "PURCHASE_ORDER",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "DRAFT",
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
]);

export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
]);

export const receiptLineStatusEnum = pgEnum("receipt_line_status", [
  "ACCEPTED",
  "PARTIAL",
  "REJECTED",
  "DAMAGED",
  "WRONG_ITEM",
  "OVER_DELIVERED",
]);

export const locationKindEnum = pgEnum("location_kind", [
  "STORE",
  "KITCHEN",
  "SERVICE_POINT",
  "OTHER",
]);

/**
 * Lifecycle of a day's menu plan. Only CONFIRMED (and beyond) counts as planned demand:
 * a draft must never drive purchasing or issuing.
 */
export const menuPlanStatusEnum = pgEnum("menu_plan_status", [
  "DRAFT",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export const stockCountStatusEnum = pgEnum("stock_count_status", [
  "OPEN",
  "COUNTED",
  "APPROVED",
  "CANCELLED",
]);

export const auditActionEnum = pgEnum("audit_action", [
  "LOGIN",
  "LOGOUT",
  "CREATE",
  "UPDATE",
  "DELETE",
  "APPROVE",
  "CANCEL",
  "CONFIRM",
  "OVERRIDE_FEFO",
  "PERMISSION_CHANGE",
  "EXPORT",
  /** A read worth recording — figures leaving through a channel other than a screen. */
  "VIEW",
]);

/** Why stock was written off — kept structured so waste can be reported by cause. */
export const wasteReasonEnum = pgEnum("waste_reason", [
  "EXPIRED",
  "DAMAGED",
  "SPOILED",
  "CONTAMINATED",
  "OVER_PRODUCTION",
  "OTHER",
]);

export const syncTargetEnum = pgEnum("sync_target", [
  "DAILY_COST",
  "INVENTORY_BALANCE",
  "RECEIVING",
  "ISSUE",
  "PURCHASE_ORDER",
  "MONTHLY_USAGE",
  "SUPPLIER_PRICE",
]);

export const syncStatusEnum = pgEnum("sync_status", ["PENDING", "SUCCESS", "FAILED"]);
