import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill in the connection string.",
  );
}

/**
 * A single pooled client is reused across hot reloads in development, otherwise every
 * refresh would open a new pool and exhaust Postgres connections.
 */
const globalForDb = globalThis as unknown as {
  canteenSql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.canteenSql ??
  postgres(connectionString, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.canteenSql = client;
}

export const db = drizzle(client, { schema, casing: "snake_case" });
export const sqlClient = client;

export type Database = typeof db;
/** The type passed to service functions so they can run inside an outer transaction. */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
