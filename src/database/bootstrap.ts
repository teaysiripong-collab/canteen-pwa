import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ROLES } from "../lib/permissions";
import {
  upsertDefaultSettings,
  upsertMealPeriods,
  upsertOrganization,
  upsertRolesAndPermissions,
  upsertUnitConversions,
  upsertUnits,
  type Db,
} from "./reference-data";
import * as schema from "./schema";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Prepares a real database for first use.
 *
 * `db:seed` cannot do this job: it also inserts demo suppliers, items, opening stock and
 * `@canteen.local` accounts, which in a production database would be figures nobody entered
 * sitting next to figures somebody did. But a freshly migrated database is not usable either —
 * with no units, roles, permissions or meal periods, every role grants nothing and there is
 * nobody who can sign in to fix it.
 *
 * So this seeds only what the system cannot run without, plus the first administrator, who
 * then creates locations, items and everyone else through the application.
 *
 * Safe to run again after any deploy: the reference data converges on the catalogue in code,
 * and an existing admin keeps their name and roles rather than being reset.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    throw new Error(
      "ADMIN_EMAIL is not set. It must match the email of the Supabase Auth user who will sign in first.",
    );
  }

  const adminName = process.env.ADMIN_NAME?.trim() || "ผู้ดูแลระบบ";
  const organizationName = process.env.ORG_NAME?.trim() || "Company Canteen";

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema, casing: "snake_case" }) as Db;

  try {
    console.log("Bootstrapping reference data...");

    const organization = await upsertOrganization(db, organizationName);
    const units = await upsertUnits(db);
    await upsertUnitConversions(db, units);
    const roleIds = await upsertRolesAndPermissions(db);
    await upsertMealPeriods(db, organization.id);
    await upsertDefaultSettings(db, organization.id);

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, adminEmail))
      .limit(1);

    if (existing[0]) {
      // Re-running after a deploy must not overwrite a name someone corrected, and must not
      // silently re-grant ADMIN to an account whose access was deliberately reduced.
      console.log(`Admin ${adminEmail} already exists — left unchanged.`);
    } else {
      const [user] = await db
        .insert(schema.users)
        .values({ organizationId: organization.id, email: adminEmail, fullName: adminName })
        .returning();

      await db
        .insert(schema.userRoles)
        .values({ userId: user!.id, roleId: roleIds.get(ROLES.ADMIN)! });

      console.log(`Created admin ${adminEmail}.`);
    }

    console.log(
      `Bootstrap complete: ${units.size} units, ${roleIds.size} roles, meal periods and default settings ready.`,
    );
    console.log(
      `Next: create a Supabase Auth user with the email ${adminEmail}, sign in, then add locations and items.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
