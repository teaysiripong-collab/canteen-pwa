import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { items, units } from "./master-data";
import { menus } from "./menu";
import { users } from "./auth";
import { primaryId, quantity, timestamps } from "./_shared";

export const recipes = pgTable(
  "recipes",
  {
    id: primaryId(),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "restrict" }),
    nameTh: text("name_th").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("recipes_menu_key").on(t.menuId)],
);

/**
 * A recipe version is immutable once published: editing a published recipe means
 * creating the next version, so BOM history and historical cost stay reproducible.
 */
export const recipeVersions = pgTable(
  "recipe_versions",
  {
    id: primaryId(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    /** Number of servings produced by the quantities below. */
    yieldQty: quantity("yield_qty").notNull().default("1"),
    yieldUnitId: uuid("yield_unit_id").references(() => units.id, { onDelete: "restrict" }),
    effectiveFrom: date("effective_from").notNull(),
    isPublished: boolean("is_published").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("recipe_versions_key").on(t.recipeId, t.versionNo),
    index("recipe_versions_recipe_idx").on(t.recipeId),
    check("recipe_versions_yield_positive", sql`${t.yieldQty} > 0`),
    check("recipe_versions_version_positive", sql`${t.versionNo} > 0`),
  ],
);

export const recipeItems = pgTable(
  "recipe_items",
  {
    id: primaryId(),
    recipeVersionId: uuid("recipe_version_id")
      .notNull()
      .references(() => recipeVersions.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    quantity: quantity("quantity").notNull(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    /** Fraction lost in preparation, 0.05 = 5% trim loss. */
    wasteFactor: quantity("waste_factor").notNull().default("0"),
    sortOrder: integer("sort_order").notNull().default(0),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("recipe_items_key").on(t.recipeVersionId, t.itemId),
    check("recipe_items_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "recipe_items_waste_factor_range",
      sql`${t.wasteFactor} >= 0 AND ${t.wasteFactor} < 1`,
    ),
  ],
);
