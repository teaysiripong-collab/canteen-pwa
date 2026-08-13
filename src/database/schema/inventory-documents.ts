import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { items, suppliers, units } from "./master-data";
import { locations, organizations } from "./organization";
import { mealPeriods, menus } from "./menu";
import { menuPlanItems } from "./menu-plan";
import { recipeVersions } from "./recipe";
import { purchaseOrderItems, purchaseOrders } from "./purchasing";
import { documentStatusEnum, receiptLineStatusEnum } from "./enums";
import { users } from "./auth";
import { money, primaryId, quantity, timestamps } from "./_shared";

/* ------------------------------------------------------------------ receiving */

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    receiptNumber: text("receipt_number").notNull(),
    /** Null for receipts without a purchase order (direct/emergency buying). */
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, {
      onDelete: "restrict",
    }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    status: documentStatusEnum("status").notNull().default("DRAFT"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    supplierDocNumber: text("supplier_doc_number"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("goods_receipts_org_number_key").on(t.organizationId, t.receiptNumber),
    index("goods_receipts_po_idx").on(t.purchaseOrderId),
    index("goods_receipts_location_date_idx").on(t.locationId, t.receivedAt),
  ],
);

export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    id: primaryId(),
    goodsReceiptId: uuid("goods_receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),
    purchaseOrderItemId: uuid("purchase_order_item_id").references(
      () => purchaseOrderItems.id,
      { onDelete: "restrict" },
    ),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    receivedQty: quantity("received_qty").notNull(),
    receiptUnitId: uuid("receipt_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    conversionToBase: quantity("conversion_to_base").notNull().default("1"),
    receivedBaseQty: quantity("received_base_qty").notNull(),
    /** Quantity refused at the door; never enters stock but stays on the document. */
    rejectedBaseQty: quantity("rejected_base_qty").notNull().default("0"),
    lineStatus: receiptLineStatusEnum("line_status").notNull().default("ACCEPTED"),
    /** Cost per base unit, the input for lot cost and every downstream cost report. */
    unitCost: money("unit_cost").notNull().default("0"),
    lotNumber: text("lot_number"),
    manufactureDate: date("manufacture_date"),
    expiryDate: date("expiry_date"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("goods_receipt_items_receipt_idx").on(t.goodsReceiptId),
    index("goods_receipt_items_item_idx").on(t.itemId),
    check("goods_receipt_items_received_non_negative", sql`${t.receivedBaseQty} >= 0`),
    check("goods_receipt_items_rejected_non_negative", sql`${t.rejectedBaseQty} >= 0`),
    check("goods_receipt_items_cost_non_negative", sql`${t.unitCost} >= 0`),
  ],
);

/* --------------------------------------------------------------------- issue */

export const stockIssues = pgTable(
  "stock_issues",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    issueNumber: text("issue_number").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    /** Set when the issue was generated from a menu; null for a manual issue. */
    menuId: uuid("menu_id").references(() => menus.id, { onDelete: "restrict" }),
    recipeVersionId: uuid("recipe_version_id").references(() => recipeVersions.id, {
      onDelete: "restrict",
    }),
    menuPlanItemId: uuid("menu_plan_item_id").references(() => menuPlanItems.id, {
      onDelete: "set null",
    }),
    /** Which shift this issue was cooked for; the BOM quantity depends on it. */
    mealPeriodId: uuid("meal_period_id").references(() => mealPeriods.id, {
      onDelete: "restrict",
    }),
    servings: quantity("servings"),
    status: documentStatusEnum("status").notNull().default("DRAFT"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("stock_issues_org_number_key").on(t.organizationId, t.issueNumber),
    index("stock_issues_location_date_idx").on(t.locationId, t.issuedAt),
  ],
);

export const stockIssueItems = pgTable(
  "stock_issue_items",
  {
    id: primaryId(),
    stockIssueId: uuid("stock_issue_id")
      .notNull()
      .references(() => stockIssues.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    /** What the BOM asked for, kept next to the actual issued quantity for variance reports. */
    requestedBaseQty: quantity("requested_base_qty"),
    issuedBaseQty: quantity("issued_base_qty").notNull(),
    /**
     * Weighted cost per base unit of the lots actually consumed, frozen at posting time.
     * Historical cost reports read this rather than today's lot prices.
     */
    unitCost: money("unit_cost").notNull().default("0"),
    /** True when a user with the permission picked lots other than the FEFO suggestion. */
    fefoOverridden: boolean("fefo_overridden").notNull().default(false),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("stock_issue_items_issue_idx").on(t.stockIssueId),
    index("stock_issue_items_item_idx").on(t.itemId),
    check("stock_issue_items_issued_positive", sql`${t.issuedBaseQty} > 0`),
    check("stock_issue_items_cost_non_negative", sql`${t.unitCost} >= 0`),
  ],
);

/* ------------------------------------------------------------------ transfer */

export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    transferNumber: text("transfer_number").notNull(),
    fromLocationId: uuid("from_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    toLocationId: uuid("to_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    status: documentStatusEnum("status").notNull().default("DRAFT"),
    transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("stock_transfers_org_number_key").on(t.organizationId, t.transferNumber),
    index("stock_transfers_from_idx").on(t.fromLocationId, t.transferredAt),
    check("stock_transfers_distinct_locations", sql`${t.fromLocationId} <> ${t.toLocationId}`),
  ],
);

export const stockTransferItems = pgTable(
  "stock_transfer_items",
  {
    id: primaryId(),
    stockTransferId: uuid("stock_transfer_id")
      .notNull()
      .references(() => stockTransfers.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    transferBaseQty: quantity("transfer_base_qty").notNull(),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("stock_transfer_items_transfer_idx").on(t.stockTransferId),
    check("stock_transfer_items_qty_positive", sql`${t.transferBaseQty} > 0`),
  ],
);
