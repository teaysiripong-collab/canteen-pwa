import { cache } from "react";
import { cookies, headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/database/client";
import { locations, roles, userRoles, users } from "@/database/schema";
import { AppError } from "@/lib/errors";
import {
  hasPermission,
  permissionsForRoles,
  type PermissionCode,
  type RoleCode,
} from "@/lib/permissions";
import { DEV_AUTH_COOKIE, isDevAuthEnabled } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  defaultLocationId: string | null;
  defaultLocationName: string | null;
  roleCodes: RoleCode[];
  permissions: PermissionCode[];
};

async function resolveAuthEmail(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) return data.user.email;
  }

  if (isDevAuthEnabled()) {
    const cookieStore = await cookies();
    return cookieStore.get(DEV_AUTH_COOKIE)?.value ?? null;
  }

  return null;
}

/**
 * Loads the signed-in user together with the permissions granted by their roles.
 * Cached per request so a page with several guarded sections hits the database once.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const email = await resolveAuthEmail();
  if (!email) return null;

  const rows = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      email: users.email,
      fullName: users.fullName,
      isActive: users.isActive,
      defaultLocationId: users.defaultLocationId,
      defaultLocationName: locations.nameTh,
      roleCode: roles.code,
    })
    .from(users)
    .leftJoin(locations, eq(locations.id, users.defaultLocationId))
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.email, email), eq(users.isActive, true)));

  const first = rows[0];
  if (!first) return null;

  const roleCodes = [
    ...new Set(rows.map((row) => row.roleCode).filter((code): code is string => code !== null)),
  ] as RoleCode[];

  return {
    id: first.id,
    organizationId: first.organizationId,
    email: first.email,
    fullName: first.fullName,
    defaultLocationId: first.defaultLocationId,
    defaultLocationName: first.defaultLocationName,
    roleCodes,
    permissions: permissionsForRoles(roleCodes),
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
}

/**
 * Server-side authorization gate. Every mutating service call starts here — the client
 * only hides buttons, it never decides what a user may do.
 */
export async function requirePermission(
  required: PermissionCode | PermissionCode[],
): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user.permissions, required)) {
    throw new AppError("FORBIDDEN");
  }
  return user;
}

/**
 * Device metadata for the audit trail. Seeds, scheduled jobs and background sync run
 * outside a request, where there are no headers to read — those callers still write
 * their audit rows, just without IP and user agent.
 */
export async function getRequestMetadata(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  try {
    const headerList = await headers();
    const forwardedFor = headerList.get("x-forwarded-for");
    return {
      ipAddress: forwardedFor?.split(",")[0]?.trim() ?? headerList.get("x-real-ip"),
      userAgent: headerList.get("user-agent"),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}
