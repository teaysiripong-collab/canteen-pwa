import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { menuPlanStatusEnum } from "./enums";
import { locations, organizations } from "./organization";
import { mealPeriods, menus } from "./menu";
import { recipeVersions } from "./recipe";
import { users } from "./auth";
import { primaryId, quantity, timestamps } from "./_shared";

export const menuPlans = pgTable(
  "menu_plans",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    planDate: date("plan_date").notNull(),
    mealPeriodId: uuid("meal_period_id")
      .notNull()
      .references(() => mealPeriods.id, { onDelete: "restrict" }),
    status: menuPlanStatusEnum("status").notNull().default("DRAFT"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("menu_plans_key").on(t.locationId, t.planDate, t.mealPeriodId),
    index("menu_plans_date_idx").on(t.planDate),
    index("menu_plans_status_idx").on(t.organizationId, t.status, t.planDate),
  ],
);

export const menuPlanItems = pgTable(
  "menu_plan_items",
  {
    id: primaryId(),
    menuPlanId: uuid("menu_plan_id")
      .notNull()
      .references(() => menuPlans.id, { onDelete: "cascade" }),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "restrict" }),
    /**
     * Recipe version pinned at planning time. Historical plans keep pointing at the
     * version that was actually cooked, so past costs never move when a recipe changes.
     */
    recipeVersionId: uuid("recipe_version_id").references(() => recipeVersions.id, {
      onDelete: "restrict",
    }),
    plannedServings: quantity("planned_servings").notNull().default("1"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("menu_plan_items_key").on(t.menuPlanId, t.menuId),
    check("menu_plan_items_servings_positive", sql`${t.plannedServings} > 0`),
  ],
);

/**
 * A reusable line-up — "the Monday set" — so a plan that repeats does not have to be
 * retyped. Applying a template creates ordinary plan items; nothing downstream can tell
 * the difference.
 */
export const menuPlanTemplates = pgTable(
  "menu_plan_templates",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    nameTh: text("name_th").notNull(),
    /** Optional defaults so applying a template can skip a question or two. */
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    mealPeriodId: uuid("meal_period_id").references(() => mealPeriods.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("menu_plan_templates_org_name_key").on(t.organizationId, t.nameTh),
    index("menu_plan_templates_org_idx").on(t.organizationId, t.isActive),
  ],
);

export const menuPlanTemplateItems = pgTable(
  "menu_plan_template_items",
  {
    id: primaryId(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => menuPlanTemplates.id, { onDelete: "cascade" }),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "restrict" }),
    plannedServings: quantity("planned_servings").notNull().default("1"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("menu_plan_template_items_key").on(t.templateId, t.menuId),
    check("menu_plan_template_items_servings_positive", sql`${t.plannedServings} > 0`),
  ],
);
