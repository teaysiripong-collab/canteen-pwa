import { and, asc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { db, type DbExecutor } from "@/database/client";
import { locations, roles, userRoles, users } from "@/database/schema";
import type { RoleCode } from "@/lib/permissions";
import type { ListQuery } from "@/schemas/common";

export type UserListRow = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  defaultLocationName: string | null;
  roleCodes: RoleCode[];
};

/**
 * Users are listed with their roles collapsed into one row per user. The join is done in
 * memory rather than with array_agg so the row shape stays plainly typed.
 */
export async function listUsers(
  organizationId: string,
  query: ListQuery,
): Promise<UserListRow[]> {
  const filters: SQL[] = [eq(users.organizationId, organizationId)];

  if (query.status === "active") filters.push(eq(users.isActive, true));
  if (query.status === "inactive") filters.push(eq(users.isActive, false));

  if (query.q) {
    const search = `%${query.q}%`;
    filters.push(or(ilike(users.email, search), ilike(users.fullName, search))!);
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phone: users.phone,
      isActive: users.isActive,
      defaultLocationName: locations.nameTh,
      roleCode: roles.code,
    })
    .from(users)
    .leftJoin(locations, eq(locations.id, users.defaultLocationId))
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(...filters))
    .orderBy(asc(users.fullName));

  const byId = new Map<string, UserListRow>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (existing) {
      if (row.roleCode) existing.roleCodes.push(row.roleCode as RoleCode);
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      phone: row.phone,
      isActive: row.isActive,
      defaultLocationName: row.defaultLocationName,
      roleCodes: row.roleCode ? [row.roleCode as RoleCode] : [],
    });
  }

  return [...byId.values()];
}

export async function getUserById(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.id, id)))
    .limit(1);

  if (!row) return null;

  const assigned = await db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, id));

  return { ...row, roleCodes: assigned.map((entry) => entry.code as RoleCode) };
}

export async function listAssignableRoles() {
  return db
    .select({ id: roles.id, code: roles.code, nameTh: roles.nameTh, rank: roles.rank })
    .from(roles)
    .orderBy(asc(roles.rank));
}

/** Replaces a user's role assignments; returns the codes so the caller can audit the change. */
export async function replaceUserRoles(
  executor: DbExecutor,
  userId: string,
  roleCodes: readonly string[],
): Promise<void> {
  await executor.delete(userRoles).where(eq(userRoles.userId, userId));

  const unique = [...new Set(roleCodes)];
  if (unique.length === 0) return;

  const roleRows = await executor
    .select({ id: roles.id })
    .from(roles)
    .where(inArray(roles.code, unique));

  if (roleRows.length > 0) {
    await executor.insert(userRoles).values(roleRows.map((role) => ({ userId, roleId: role.id })));
  }
}
