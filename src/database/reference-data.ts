import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import {
  PERMISSIONS,
  PERMISSION_LABELS_TH,
  PERMISSION_MODULES,
  ROLES,
  ROLE_LABELS_TH,
  ROLE_PERMISSIONS,
  ROLE_RANKS,
  type PermissionCode,
  type RoleCode,
} from "../lib/permissions";
import * as schema from "./schema";

/**
 * Data the system cannot run without, as opposed to data that makes a demo look real.
 *
 * Units, roles, permissions, meal periods and the default settings are structural: a fresh
 * database without them has roles that grant nothing and a BOM with no shift to split into.
 * Items, suppliers, opening stock and the `@canteen.local` accounts are not — they belong to
 * development only, and putting them in a production database would be data nobody entered.
 *
 * Both `seed.ts` (development) and `bootstrap.ts` (production) read this module, so the two
 * cannot drift apart and leave production one role behind the code.
 *
 * Every function here is idempotent: re-running converges on the catalogue in code rather
 * than accumulating, which is what makes it safe to run again after a deploy.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export const ORG_CODE = "CANTEEN";

export async function upsertOrganization(db: Db, name: string) {
  const [organization] = await db
    .insert(schema.organizations)
    .values({ code: ORG_CODE, name })
    .onConflictDoUpdate({
      target: schema.organizations.code,
      set: { name, updatedAt: new Date() },
    })
    .returning();

  return organization!;
}

export async function upsertUnits(db: Db) {
  const rows = [
    { code: "KG", nameTh: "กิโลกรัม", dimension: "WEIGHT" },
    { code: "G", nameTh: "กรัม", dimension: "WEIGHT" },
    { code: "L", nameTh: "ลิตร", dimension: "VOLUME" },
    { code: "ML", nameTh: "มิลลิลิตร", dimension: "VOLUME" },
    { code: "PCS", nameTh: "ชิ้น", dimension: "COUNT" },
    { code: "FONG", nameTh: "ฟอง", dimension: "COUNT" },
    { code: "PANG", nameTh: "แผง", dimension: "COUNT" },
    { code: "BAG", nameTh: "ถุง", dimension: "COUNT" },
    { code: "PACK", nameTh: "แพ็ก", dimension: "COUNT" },
    { code: "BOTTLE", nameTh: "ขวด", dimension: "COUNT" },
    { code: "CASE", nameTh: "ลัง", dimension: "COUNT" },
  ];

  const result = new Map<string, string>();
  for (const row of rows) {
    const [unit] = await db
      .insert(schema.units)
      .values(row)
      .onConflictDoUpdate({
        target: schema.units.code,
        set: { nameTh: row.nameTh, dimension: row.dimension, updatedAt: new Date() },
      })
      .returning();
    result.set(row.code, unit!.id);
  }
  return result;
}

export async function upsertUnitConversions(db: Db, units: Map<string, string>) {
  const rows = [
    { from: "KG", to: "G", factor: "1000" },
    { from: "L", to: "ML", factor: "1000" },
    { from: "CASE", to: "BOTTLE", factor: "12" },
    { from: "PACK", to: "BAG", factor: "10" },
    { from: "PANG", to: "FONG", factor: "30" },
  ];

  for (const row of rows) {
    await db
      .insert(schema.unitConversions)
      .values({
        itemId: null,
        fromUnitId: units.get(row.from)!,
        toUnitId: units.get(row.to)!,
        factor: row.factor,
      })
      .onConflictDoNothing();
  }
}

export async function upsertRolesAndPermissions(db: Db) {
  const permissionIds = new Map<string, string>();

  for (const code of Object.values(PERMISSIONS)) {
    const [permission] = await db
      .insert(schema.permissions)
      .values({
        code,
        nameTh: PERMISSION_LABELS_TH[code],
        module: PERMISSION_MODULES[code],
      })
      .onConflictDoUpdate({
        target: schema.permissions.code,
        set: { nameTh: PERMISSION_LABELS_TH[code], updatedAt: new Date() },
      })
      .returning();
    permissionIds.set(code, permission!.id);
  }

  // Drop system roles that are no longer in the catalogue (e.g. the pre-roadmap
  // FRONTLINE/LEADER/SUPERVISOR set) so a re-run converges instead of accumulating.
  const staleRoles = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(
      and(
        eq(schema.roles.isSystem, true),
        notInArray(schema.roles.code, Object.values(ROLES) as string[]),
      ),
    );

  if (staleRoles.length > 0) {
    const staleIds = staleRoles.map((role) => role.id);
    await db.delete(schema.userRoles).where(inArray(schema.userRoles.roleId, staleIds));
    await db.delete(schema.roles).where(inArray(schema.roles.id, staleIds));
  }

  const roleIds = new Map<RoleCode, string>();

  for (const roleCode of Object.values(ROLES)) {
    const [role] = await db
      .insert(schema.roles)
      .values({
        code: roleCode,
        nameTh: ROLE_LABELS_TH[roleCode],
        rank: ROLE_RANKS[roleCode],
        isSystem: true,
      })
      .onConflictDoUpdate({
        target: schema.roles.code,
        set: { nameTh: ROLE_LABELS_TH[roleCode], rank: ROLE_RANKS[roleCode], updatedAt: new Date() },
      })
      .returning();

    roleIds.set(roleCode, role!.id);

    // Rebuild the grant list so the database always matches the code catalogue.
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role!.id));
    const grants = ROLE_PERMISSIONS[roleCode].map((permission: PermissionCode) => ({
      roleId: role!.id,
      permissionId: permissionIds.get(permission)!,
    }));
    if (grants.length > 0) {
      await db.insert(schema.rolePermissions).values(grants).onConflictDoNothing();
    }
  }

  return roleIds;
}

export async function upsertMealPeriods(db: Db, organizationId: string) {
  // DAY/NIGHT are the two shifts the canteen actually plans and cooks against; they are
  // what the BOM "30+20" notation splits into. Meal periods stay editable master data.
  const mealPeriods = [
    { code: "DAY", nameTh: "เช้า", startTime: "06:00", sortOrder: 1 },
    { code: "NIGHT", nameTh: "ดึก", startTime: "21:00", sortOrder: 2 },
  ];

  await db.delete(schema.mealPeriods).where(
    and(
      eq(schema.mealPeriods.organizationId, organizationId),
      notInArray(
        schema.mealPeriods.code,
        mealPeriods.map((row) => row.code),
      ),
    ),
  );

  for (const row of mealPeriods) {
    await db
      .insert(schema.mealPeriods)
      .values({ organizationId, ...row })
      .onConflictDoUpdate({
        target: [schema.mealPeriods.organizationId, schema.mealPeriods.code],
        set: {
          nameTh: row.nameTh,
          startTime: row.startTime,
          sortOrder: row.sortOrder,
          updatedAt: new Date(),
        },
      });
  }
}

export async function upsertDefaultSettings(db: Db, organizationId: string) {
  const rows = [
    {
      key: "expiry_alert_days",
      value: [1, 3, 7],
      description: "Day thresholds used by the expiry alerts",
    },
    {
      key: "document_prefixes",
      value: {
        goodsReceipt: "GR",
        stockIssue: "IS",
        stockTransfer: "TF",
        purchaseOrder: "PO",
        stockCount: "SC",
      },
      description: "Prefix used when generating document numbers",
    },
    {
      key: "allow_negative_stock",
      value: false,
      description: "Issuing more than the balance is rejected when false",
    },
  ];

  for (const row of rows) {
    await db
      .insert(schema.appSettings)
      .values({ organizationId, key: row.key, value: row.value, description: row.description })
      // Only inserted when missing: an operator who changed a threshold on /settings should
      // not have it reset by the next deploy's bootstrap run.
      .onConflictDoNothing();
  }
}
