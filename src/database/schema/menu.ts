import { boolean, integer, pgTable, text, time, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organization";
import { primaryId, timestamps } from "./_shared";

export const menuCategories = pgTable(
  "menu_categories",
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
  (t) => [uniqueIndex("menu_categories_org_code_key").on(t.organizationId, t.code)],
);

/** Meal periods are configurable master data (06:00 / 10:00 / 21:00 / 01:30 are seed values only). */
export const mealPeriods = pgTable(
  "meal_periods",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    startTime: time("start_time").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("meal_periods_org_code_key").on(t.organizationId, t.code)],
);

export const menus = pgTable(
  "menus",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    nameEn: text("name_en"),
    categoryId: uuid("category_id").references(() => menuCategories.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    ...timestamps,
  },
  (t) => [uniqueIndex("menus_org_code_key").on(t.organizationId, t.code)],
);
