import { sql } from "drizzle-orm";
import {
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
import { purchaseOrderStatusEnum } from "./enums";
import { users } from "./auth";
import { money, primaryId, quantity, timestamps } from "./_shared";

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    poNumber: text("po_number").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    /** Where the goods are expected to be delivered and received into stock. */
    deliverToLocationId: uuid("deliver_to_location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    status: purchaseOrderStatusEnum("status").notNull().default("DRAFT"),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),
    /** Reserved for the Purchase Request module; V1 creates purchase orders directly. */
    purchaseRequestId: uuid("purchase_request_id"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("purchase_orders_org_number_key").on(t.organizationId, t.poNumber),
    index("purchase_orders_status_idx").on(t.organizationId, t.status),
    index("purchase_orders_supplier_idx").on(t.supplierId),
  ],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: primaryId(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    /** Ordered in the supplier's purchase unit; the base quantity is what stock is measured in. */
    orderedQty: quantity("ordered_qty").notNull(),
    purchaseUnitId: uuid("purchase_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    conversionToBase: quantity("conversion_to_base").notNull().default("1"),
    orderedBaseQty: quantity("ordered_base_qty").notNull(),
    /** Running total maintained by receiving; drives PARTIALLY_RECEIVED / RECEIVED. */
    receivedBaseQty: quantity("received_base_qty").notNull().default("0"),
    unitPrice: money("unit_price").notNull().default("0"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("purchase_order_items_po_idx").on(t.purchaseOrderId),
    index("purchase_order_items_item_idx").on(t.itemId),
    check("purchase_order_items_ordered_positive", sql`${t.orderedQty} > 0`),
    check("purchase_order_items_base_positive", sql`${t.orderedBaseQty} > 0`),
    check("purchase_order_items_received_non_negative", sql`${t.receivedBaseQty} >= 0`),
    check("purchase_order_items_price_non_negative", sql`${t.unitPrice} >= 0`),
  ],
);
