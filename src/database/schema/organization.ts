import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { locationKindEnum } from "./enums";
import { primaryId, timestamps } from "./_shared";

export const organizations = pgTable(
  "organizations",
  {
    id: primaryId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("organizations_code_key").on(t.code)],
);

export const locations = pgTable(
  "locations",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    nameEn: text("name_en"),
    kind: locationKindEnum("kind").notNull().default("STORE"),
    /** Locations flagged as stock-holding participate in balances, transfers and counts. */
    holdsStock: boolean("holds_stock").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("locations_org_code_key").on(t.organizationId, t.code),
    index("locations_org_idx").on(t.organizationId),
  ],
);
