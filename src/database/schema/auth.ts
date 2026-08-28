import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, organizations } from "./organization";
import { primaryId, timestamps } from "./_shared";

/**
 * Application user profile. `authUserId` links to the Supabase `auth.users` row;
 * it is nullable so users can be provisioned by an admin before their first sign-in.
 */
export const users = pgTable(
  "users",
  {
    id: primaryId(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    authUserId: uuid("auth_user_id"),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    defaultLocationId: uuid("default_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_auth_user_id_key").on(t.authUserId),
    index("users_org_idx").on(t.organizationId),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: primaryId(),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    description: text("description"),
    /** Higher rank wins when a user holds several roles (used for UI defaults only). */
    rank: integer("rank").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("roles_code_key").on(t.code)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: primaryId(),
    code: text("code").notNull(),
    nameTh: text("name_th").notNull(),
    module: text("module").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("permissions_code_key").on(t.code)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    /** Null means the role applies at every location. */
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_role_idx").on(t.roleId),
  ],
);
