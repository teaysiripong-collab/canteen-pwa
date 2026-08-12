import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditActionEnum, syncStatusEnum, syncTargetEnum } from "./enums";
import { organizations } from "./organization";
import { users } from "./auth";
import { primaryId, timestamps } from "./_shared";

/** Append-only audit trail. Rows are never updated or deleted. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: primaryId(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: auditActionEnum("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_user_idx").on(t.userId, t.createdAt),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

/** Configurable runtime settings (expiry alert thresholds, document prefixes, ...). */
export const appSettings = pgTable(
  "app_settings",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [uniqueIndex("app_settings_org_key").on(t.organizationId, t.key)],
);

/** One row per Google Sheets export run; the sync is one-way ERP -> Sheets in V1. */
export const sheetSyncRuns = pgTable(
  "sheet_sync_runs",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    target: syncTargetEnum("target").notNull(),
    status: syncStatusEnum("status").notNull().default("PENDING"),
    spreadsheetId: text("spreadsheet_id"),
    sheetName: text("sheet_name"),
    rowCount: text("row_count"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("sheet_sync_runs_target_idx").on(t.target, t.startedAt)],
);
