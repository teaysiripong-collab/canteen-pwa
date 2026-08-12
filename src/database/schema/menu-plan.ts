import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("menu_plans_key").on(t.locationId, t.planDate, t.mealPeriodId),
    index("menu_plans_date_idx").on(t.planDate),
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
