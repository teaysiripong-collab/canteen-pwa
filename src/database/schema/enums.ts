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
]);

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
