import { sql } from "drizzle-orm";
import { numeric, timestamp, uuid } from "drizzle-orm/pg-core";

export const primaryId = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** Quantities are stored with 4 decimal places so gram-level precision survives kg base units. */
export const quantity = (name: string) => numeric(name, { precision: 18, scale: 4 });

/** Money is stored with 4 decimal places because unit costs are often fractions of a satang. */
export const money = (name: string) => numeric(name, { precision: 18, scale: 4 });

export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
};
