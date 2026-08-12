import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, desc, eq } from "drizzle-orm";

/**
 * Integration test against a real Postgres. It exercises the write path the UI uses:
 * server action -> service -> transaction -> audit log. Only the session is stubbed,
 * because permissions come from HTTP cookies that do not exist outside a request.
 */
const actor = {
  id: "",
  organizationId: "",
  email: "integration-actor@canteen.local",
  fullName: "Integration Actor",
  defaultLocationId: null,
  defaultLocationName: null,
  roleCodes: ["ADMIN"],
  permissions: [] as string[],
};

vi.mock("@/lib/auth/session", () => ({
  requirePermission: vi.fn(async () => actor),
  requireUser: vi.fn(async () => actor),
  getCurrentUser: vi.fn(async () => actor),
  getRequestMetadata: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "vitest" })),
}));

const { db } = await import("@/database/client");
const { auditLogs, organizations, roles, userRoles, users } = await import("@/database/schema");
const { createUser, setUserActive, updateUser } = await import("@/services/user-service");

const TEST_EMAIL = "integration-target@canteen.local";
const createdUserIds: string[] = [];

async function cleanUp() {
  for (const id of createdUserIds) {
    await db.delete(auditLogs).where(eq(auditLogs.entityId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  createdUserIds.length = 0;
  await db.delete(users).where(eq(users.email, TEST_EMAIL));
  await db.delete(users).where(eq(users.email, actor.email));
}

beforeAll(async () => {
  const [organization] = await db.select().from(organizations).limit(1);
  if (!organization) throw new Error("Run `npm run db:seed` before the integration tests.");
  actor.organizationId = organization.id;

  await cleanUp();

  // The actor needs a real row so audit_logs.user_id can reference it.
  const [row] = await db
    .insert(users)
    .values({
      organizationId: organization.id,
      email: actor.email,
      fullName: actor.fullName,
    })
    .returning();
  actor.id = row!.id;
});

afterAll(async () => {
  await cleanUp();
});

describe("user service", () => {
  it("creates a user with the roles the admin selected", async () => {
    const created = await createUser({
      email: TEST_EMAIL,
      fullName: "พนักงานทดสอบ",
      phone: "0800000000",
      defaultLocationId: null,
      roleCodes: ["STORE"],
      isActive: true,
    });
    createdUserIds.push(created.id);

    const assigned = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, created.id));

    expect(assigned.map((row) => row.code)).toEqual(["STORE"]);
    expect(created.isActive).toBe(true);
  });

  it("rejects a second account on the same email with a Thai message", async () => {
    await expect(
      createUser({
        email: TEST_EMAIL,
        fullName: "ซ้ำ",
        phone: undefined,
        defaultLocationId: null,
        roleCodes: ["STAFF"],
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "อีเมลนี้ถูกใช้งานแล้ว" });
  });

  it("replaces the role set and records the change as PERMISSION_CHANGE", async () => {
    const id = createdUserIds[0]!;

    await updateUser(id, {
      email: TEST_EMAIL,
      fullName: "พนักงานทดสอบ",
      phone: undefined,
      defaultLocationId: null,
      roleCodes: ["MANAGER", "STAFF"],
      isActive: true,
    });

    const assigned = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, id));

    expect(assigned.map((row) => row.code).sort()).toEqual(["MANAGER", "STAFF"]);

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, "PERMISSION_CHANGE")))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);

    expect(entry).toBeDefined();
    expect(entry!.note).toContain("MANAGER");
    expect(entry!.userId).toBe(actor.id);
  });

  it("deactivates instead of deleting, keeping the row and its history", async () => {
    const id = createdUserIds[0]!;

    const updated = await setUserActive(id, false);
    expect(updated.isActive).toBe(false);

    const [stillThere] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    expect(stillThere).toBeDefined();
  });

  it("refuses to let an admin strip their own ADMIN role", async () => {
    const [adminRole] = await db.select().from(roles).where(eq(roles.code, "ADMIN")).limit(1);
    await db
      .insert(userRoles)
      .values({ userId: actor.id, roleId: adminRole!.id })
      .onConflictDoNothing();

    await expect(
      updateUser(actor.id, {
        email: actor.email,
        fullName: actor.fullName,
        phone: undefined,
        defaultLocationId: null,
        roleCodes: ["STAFF"],
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses to let an admin deactivate their own account", async () => {
    await expect(setUserActive(actor.id, false)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
