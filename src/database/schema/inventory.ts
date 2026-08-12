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
import { goodsReceiptItems, goodsReceipts } from "./inventory-documents";
import {
  inventoryTransactionTypeEnum,
  referenceTypeEnum,
  stockCountStatusEnum,
} from "./enums";
import { users } from "./auth";
import { money, primaryId, quantity, timestamps } from "./_shared";

/**
 * A lot is a physical batch received at one cost with one expiry date.
 * Lot quantities live in `stockBalances` (a lot can be split across locations by transfers);
 * `receivedBaseQty` here is the immutable original quantity.
 */
export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    lotNumber: text("lot_number").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    goodsReceiptId: uuid("goods_receipt_id").references(() => goodsReceipts.id, {
      onDelete: "restrict",
    }),
    goodsReceiptItemId: uuid("goods_receipt_item_id").references(() => goodsReceiptItems.id, {
      onDelete: "restrict",
    }),
    receivedDate: date("received_date").notNull(),
    manufactureDate: date("manufacture_date"),
    expiryDate: date("expiry_date"),
    receivedBaseQty: quantity("received_base_qty").notNull(),
    baseUnitId: uuid("base_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    unitCost: money("unit_cost").notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("inventory_lots_item_lot_key").on(t.itemId, t.lotNumber),
    /** FEFO reads this index: oldest expiry first, nulls last. */
    index("inventory_lots_fefo_idx").on(t.itemId, t.expiryDate),
    index("inventory_lots_expiry_idx").on(t.expiryDate),
    check("inventory_lots_received_positive", sql`${t.receivedBaseQty} > 0`),
    check("inventory_lots_cost_non_negative", sql`${t.unitCost} >= 0`),
  ],
);

/**
 * The append-only ledger. Every movement of stock is one row here and rows are never
 * updated or deleted — a mistake is corrected with a reversing entry.
 */
export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    transactionType: inventoryTransactionTypeEnum("transaction_type").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => inventoryLots.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    /** Always positive and always in the item's base unit; direction comes from the type. */
    baseQty: quantity("base_qty").notNull(),
    baseUnitId: uuid("base_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    /** Cost per base unit at the moment of the movement, copied from the lot. */
    unitCost: money("unit_cost").notNull().default("0"),
    referenceType: referenceTypeEnum("reference_type").notNull(),
    referenceId: uuid("reference_id"),
    referenceNumber: text("reference_number"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    transactionAt: timestamp("transaction_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_transactions_item_location_idx").on(t.itemId, t.locationId, t.transactionAt),
    index("inventory_transactions_lot_idx").on(t.lotId),
    index("inventory_transactions_reference_idx").on(t.referenceType, t.referenceId),
    index("inventory_transactions_date_idx").on(t.transactionAt),
    check("inventory_transactions_qty_positive", sql`${t.baseQty} > 0`),
  ],
);

/**
 * Derived balance per lot per location, maintained inside the same database transaction
 * as the ledger rows that move it. The non-negative check is the last line of defence
 * against a race between two concurrent issues.
 */
export const stockBalances = pgTable(
  "stock_balances",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => inventoryLots.id, { onDelete: "restrict" }),
    baseQty: quantity("base_qty").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_balances_key").on(t.locationId, t.lotId),
    index("stock_balances_item_location_idx").on(t.itemId, t.locationId),
    check("stock_balances_non_negative", sql`${t.baseQty} >= 0`),
  ],
);

/* --------------------------------------------------------------- stock count */

export const stockCountSessions = pgTable(
  "stock_count_sessions",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    countNumber: text("count_number").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    status: stockCountStatusEnum("status").notNull().default("OPEN"),
    countedAt: timestamp("counted_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("stock_count_sessions_org_number_key").on(t.organizationId, t.countNumber),
    index("stock_count_sessions_location_idx").on(t.locationId, t.countedAt),
  ],
);

export const stockCountItems = pgTable(
  "stock_count_items",
  {
    id: primaryId(),
    stockCountSessionId: uuid("stock_count_session_id")
      .notNull()
      .references(() => stockCountSessions.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    lotId: uuid("lot_id").references(() => inventoryLots.id, { onDelete: "restrict" }),
    /** Snapshot of the balance when counting started, so variance is reproducible. */
    systemBaseQty: quantity("system_base_qty").notNull(),
    countedBaseQty: quantity("counted_base_qty"),
    varianceBaseQty: quantity("variance_base_qty"),
    countedBy: uuid("counted_by").references(() => users.id, { onDelete: "set null" }),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("stock_count_items_session_idx").on(t.stockCountSessionId),
    check("stock_count_items_counted_non_negative", sql`${t.countedBaseQty} IS NULL OR ${t.countedBaseQty} >= 0`),
  ],
);
