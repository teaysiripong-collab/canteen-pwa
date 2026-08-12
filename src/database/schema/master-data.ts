import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, organizations } from "./organization";
import { money, primaryId, quantity, timestamps } from "./_shared";

export const units = pgTable(
  "units",
  {
    id: primaryId(),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    /** WEIGHT | VOLUME | COUNT — conversions are only allowed inside a dimension. */
    dimension: text("dimension").notNull().default("COUNT"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("units_code_key").on(t.code)],
);

export const itemCategories = pgTable(
  "item_categories",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("item_categories_org_code_key").on(t.organizationId, t.code)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    nameEn: text("name_en"),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    leadTimeDays: integer("lead_time_days").notNull().default(1),
    paymentTerm: text("payment_term"),
    remark: text("remark"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("suppliers_org_code_key").on(t.organizationId, t.code),
    check("suppliers_lead_time_non_negative", sql`${t.leadTimeDays} >= 0`),
  ],
);

export const items = pgTable(
  "items",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    nameEn: text("name_en"),
    categoryId: uuid("category_id").references(() => itemCategories.id, {
      onDelete: "set null",
    }),
    /** Stock, the ledger and every balance are expressed in this unit. */
    baseUnitId: uuid("base_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    /** Default unit used on purchase orders and goods receipts. */
    purchaseUnitId: uuid("purchase_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    /** How many base units are in one purchase unit. */
    purchaseConversion: quantity("purchase_conversion").notNull().default("1"),
    preferredSupplierId: uuid("preferred_supplier_id").references(() => suppliers.id, {
      onDelete: "set null",
    }),
    defaultLocationId: uuid("default_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    minimumStock: quantity("minimum_stock").notNull().default("0"),
    reorderPoint: quantity("reorder_point").notNull().default("0"),
    shelfLifeDays: integer("shelf_life_days"),
    /** Reserved for the future barcode/QR scanner; unused in V1. */
    barcode: text("barcode"),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("items_org_code_key").on(t.organizationId, t.code),
    index("items_org_active_idx").on(t.organizationId, t.isActive),
    index("items_name_th_idx").on(t.nameTh),
    check("items_purchase_conversion_positive", sql`${t.purchaseConversion} > 0`),
    check("items_minimum_stock_non_negative", sql`${t.minimumStock} >= 0`),
    check("items_reorder_point_non_negative", sql`${t.reorderPoint} >= 0`),
  ],
);

/**
 * `factor` = how many `toUnit` are contained in one `fromUnit`.
 * Example: 1 ลัง = 12 ขวด -> fromUnit=ลัง, toUnit=ขวด, factor=12.
 * A null `itemId` makes the conversion global (kg -> g); a non-null one overrides it per item.
 */
export const unitConversions = pgTable(
  "unit_conversions",
  {
    id: primaryId(),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    fromUnitId: uuid("from_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    toUnitId: uuid("to_unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    factor: quantity("factor").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("unit_conversions_key")
      .on(t.itemId, t.fromUnitId, t.toUnitId)
      .nullsNotDistinct(),
    check("unit_conversions_factor_positive", sql`${t.factor} > 0`),
    check("unit_conversions_distinct_units", sql`${t.fromUnitId} <> ${t.toUnitId}`),
  ],
);

/** Alternative spellings used by frontline staff, so search finds "ไก่สับ" as well as "ไก่ตัวสับ". */
export const itemAliases = pgTable(
  "item_aliases",
  {
    id: primaryId(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("item_aliases_item_alias_key").on(t.itemId, t.alias),
    index("item_aliases_alias_idx").on(t.alias),
  ],
);

export const supplierItems = pgTable(
  "supplier_items",
  {
    id: primaryId(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    supplierItemCode: text("supplier_item_code"),
    supplierItemName: text("supplier_item_name"),
    purchaseUnitId: uuid("purchase_unit_id").references(() => units.id, {
      onDelete: "restrict",
    }),
    /** Base units per supplier purchase unit; falls back to items.purchaseConversion when null. */
    purchaseConversion: quantity("purchase_conversion"),
    lastPrice: money("last_price"),
    isPreferred: boolean("is_preferred").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("supplier_items_supplier_item_key").on(t.supplierId, t.itemId),
    index("supplier_items_item_idx").on(t.itemId),
  ],
);
