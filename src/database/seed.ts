import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
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

config({ path: ".env.local" });
config({ path: ".env" });

const ORG_CODE = "CANTEEN";

type Db = ReturnType<typeof drizzle<typeof schema>>;

async function seedOrganization(db: Db) {
  const [organization] = await db
    .insert(schema.organizations)
    .values({ code: ORG_CODE, name: "Company Canteen" })
    .onConflictDoUpdate({
      target: schema.organizations.code,
      set: { name: "Company Canteen", updatedAt: new Date() },
    })
    .returning();

  return organization!;
}

async function seedLocations(db: Db, organizationId: string) {
  const rows = [
    {
      code: "B16",
      nameTh: "อาคาร 16 (ครัวหลัก/สโตร์)",
      nameEn: "Building 16",
      kind: "KITCHEN" as const,
      holdsStock: true,
    },
    {
      code: "B1",
      nameTh: "อาคาร 1 (จุดให้บริการ)",
      nameEn: "Building 1",
      kind: "SERVICE_POINT" as const,
      holdsStock: true,
    },
  ];

  const result = new Map<string, string>();
  for (const row of rows) {
    const [location] = await db
      .insert(schema.locations)
      .values({ organizationId, ...row })
      .onConflictDoUpdate({
        target: [schema.locations.organizationId, schema.locations.code],
        set: { nameTh: row.nameTh, nameEn: row.nameEn, kind: row.kind, updatedAt: new Date() },
      })
      .returning();
    result.set(row.code, location!.id);
  }
  return result;
}

async function seedUnits(db: Db) {
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

async function seedUnitConversions(db: Db, units: Map<string, string>) {
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

async function seedCategories(db: Db, organizationId: string) {
  const rows = [
    { code: "MEAT", nameTh: "เนื้อสัตว์", sortOrder: 1 },
    { code: "EGG", nameTh: "ไข่", sortOrder: 2 },
    { code: "VEG", nameTh: "ผัก", sortOrder: 3 },
    { code: "DRY", nameTh: "ของแห้ง", sortOrder: 4 },
    { code: "SEASONING", nameTh: "เครื่องปรุง", sortOrder: 5 },
  ];

  const result = new Map<string, string>();
  for (const row of rows) {
    const [category] = await db
      .insert(schema.itemCategories)
      .values({ organizationId, ...row })
      .onConflictDoUpdate({
        target: [schema.itemCategories.organizationId, schema.itemCategories.code],
        set: { nameTh: row.nameTh, sortOrder: row.sortOrder, updatedAt: new Date() },
      })
      .returning();
    result.set(row.code, category!.id);
  }
  return result;
}

async function seedSuppliers(db: Db, organizationId: string) {
  const rows = [
    { code: "BETAGRO", nameTh: "เบทาโกร", leadTimeDays: 1, paymentTerm: "เครดิต 30 วัน" },
    { code: "MAKRO", nameTh: "แม็คโคร", leadTimeDays: 1, paymentTerm: "เงินสด" },
    { code: "PUANGPLOY", nameTh: "พวงพลอย", leadTimeDays: 1, paymentTerm: "เครดิต 15 วัน" },
  ];

  const result = new Map<string, string>();
  for (const row of rows) {
    const [supplier] = await db
      .insert(schema.suppliers)
      .values({ organizationId, ...row })
      .onConflictDoUpdate({
        target: [schema.suppliers.organizationId, schema.suppliers.code],
        set: { nameTh: row.nameTh, leadTimeDays: row.leadTimeDays, updatedAt: new Date() },
      })
      .returning();
    result.set(row.code, supplier!.id);
  }
  return result;
}

async function seedItems(
  db: Db,
  organizationId: string,
  units: Map<string, string>,
  categories: Map<string, string>,
  suppliers: Map<string, string>,
  locations: Map<string, string>,
) {
  const kg = units.get("KG")!;
  const b16 = locations.get("B16")!;

  const rows = [
    { code: "MEAT-001", nameTh: "หมูหั่นบาง", category: "MEAT", supplier: "BETAGRO", reorder: "15", min: "5", shelfLife: 3, aliases: ["หมูสไลซ์"] },
    { code: "MEAT-002", nameTh: "หมูบด", category: "MEAT", supplier: "BETAGRO", reorder: "15", min: "5", shelfLife: 3, aliases: [] },
    { code: "MEAT-003", nameTh: "ไก่หั่นบาง", category: "MEAT", supplier: "BETAGRO", reorder: "20", min: "8", shelfLife: 3, aliases: ["ไก่สไลซ์"] },
    { code: "MEAT-004", nameTh: "ไก่บด", category: "MEAT", supplier: "BETAGRO", reorder: "40", min: "15", shelfLife: 3, aliases: ["ไก่สับละเอียด"] },
    { code: "MEAT-005", nameTh: "ไก่ตัวสับ", category: "MEAT", supplier: "BETAGRO", reorder: "20", min: "8", shelfLife: 3, aliases: ["ไก่สับ"] },
    { code: "MEAT-006", nameTh: "ไก่ BLK", category: "MEAT", supplier: "BETAGRO", reorder: "15", min: "5", shelfLife: 3, aliases: [] },
    { code: "VEG-001", nameTh: "กะหล่ำปลี", category: "VEG", supplier: "PUANGPLOY", reorder: "20", min: "8", shelfLife: 7, aliases: [] },
    { code: "VEG-002", nameTh: "แตงกวา", category: "VEG", supplier: "PUANGPLOY", reorder: "15", min: "5", shelfLife: 5, aliases: [] },
    { code: "VEG-003", nameTh: "ถั่วฝักยาว", category: "VEG", supplier: "PUANGPLOY", reorder: "10", min: "4", shelfLife: 4, aliases: [] },
    { code: "VEG-004", nameTh: "มะเขือพวง", category: "VEG", supplier: "PUANGPLOY", reorder: "5", min: "2", shelfLife: 4, aliases: [] },
  ];

  const result = new Map<string, string>();

  for (const row of rows) {
    const [item] = await db
      .insert(schema.items)
      .values({
        organizationId,
        code: row.code,
        nameTh: row.nameTh,
        categoryId: categories.get(row.category)!,
        baseUnitId: kg,
        purchaseUnitId: kg,
        purchaseConversion: "1",
        preferredSupplierId: suppliers.get(row.supplier)!,
        defaultLocationId: b16,
        minimumStock: row.min,
        reorderPoint: row.reorder,
        shelfLifeDays: row.shelfLife,
      })
      .onConflictDoUpdate({
        target: [schema.items.organizationId, schema.items.code],
        set: { nameTh: row.nameTh, reorderPoint: row.reorder, updatedAt: new Date() },
      })
      .returning();

    result.set(row.code, item!.id);

    for (const alias of row.aliases) {
      await db
        .insert(schema.itemAliases)
        .values({ itemId: item!.id, alias })
        .onConflictDoNothing();
    }
  }

  // Eggs are counted in ฟอง but bought by แผง (1 แผง = 30 ฟอง).
  const [egg] = await db
    .insert(schema.items)
    .values({
      organizationId,
      code: "EGG-001",
      nameTh: "ไข่ไก่",
      categoryId: categories.get("EGG")!,
      baseUnitId: units.get("FONG")!,
      purchaseUnitId: units.get("PANG")!,
      purchaseConversion: "30",
      preferredSupplierId: suppliers.get("MAKRO")!,
      defaultLocationId: b16,
      minimumStock: "300",
      reorderPoint: "900",
      shelfLifeDays: 14,
    })
    .onConflictDoUpdate({
      target: [schema.items.organizationId, schema.items.code],
      set: { nameTh: "ไข่ไก่", updatedAt: new Date() },
    })
    .returning();

  result.set("EGG-001", egg!.id);
  return result;
}

async function seedRolesAndPermissions(db: Db) {
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

async function seedUsers(
  db: Db,
  organizationId: string,
  roleIds: Map<RoleCode, string>,
  locations: Map<string, string>,
) {
  const rows = [
    { email: "admin@canteen.local", fullName: "ผู้ดูแลระบบ", role: ROLES.ADMIN, location: "B16" },
    { email: "supervisor@canteen.local", fullName: "หัวหน้าแผนกโรงอาหาร", role: ROLES.SUPERVISOR, location: "B16" },
    { email: "leader@canteen.local", fullName: "หัวหน้าชุดครัว", role: ROLES.LEADER, location: "B16" },
    { email: "frontline@canteen.local", fullName: "พนักงานหน้างาน", role: ROLES.FRONTLINE, location: "B1" },
  ];

  for (const row of rows) {
    const [user] = await db
      .insert(schema.users)
      .values({
        organizationId,
        email: row.email,
        fullName: row.fullName,
        defaultLocationId: locations.get(row.location)!,
      })
      .onConflictDoUpdate({
        target: schema.users.email,
        set: { fullName: row.fullName, updatedAt: new Date() },
      })
      .returning();

    await db
      .insert(schema.userRoles)
      .values({ userId: user!.id, roleId: roleIds.get(row.role)! })
      .onConflictDoNothing();
  }
}

async function seedMealPeriodsAndMenus(db: Db, organizationId: string) {
  const mealPeriods = [
    { code: "M0600", nameTh: "มื้อ 06:00", startTime: "06:00", sortOrder: 1 },
    { code: "M1000", nameTh: "มื้อ 10:00", startTime: "10:00", sortOrder: 2 },
    { code: "M2100", nameTh: "มื้อ 21:00", startTime: "21:00", sortOrder: 3 },
    { code: "M0130", nameTh: "มื้อ 01:30", startTime: "01:30", sortOrder: 4 },
  ];

  for (const row of mealPeriods) {
    await db
      .insert(schema.mealPeriods)
      .values({ organizationId, ...row })
      .onConflictDoUpdate({
        target: [schema.mealPeriods.organizationId, schema.mealPeriods.code],
        set: { nameTh: row.nameTh, startTime: row.startTime, updatedAt: new Date() },
      });
  }

  const [menuCategory] = await db
    .insert(schema.menuCategories)
    .values({ organizationId, code: "MAIN", nameTh: "อาหารจานหลัก", sortOrder: 1 })
    .onConflictDoUpdate({
      target: [schema.menuCategories.organizationId, schema.menuCategories.code],
      set: { nameTh: "อาหารจานหลัก", updatedAt: new Date() },
    })
    .returning();

  const menus = [
    { code: "MENU-001", nameTh: "ผัดกะเพราไก่" },
    { code: "MENU-002", nameTh: "แกงอ่อมผักรวมไก่" },
    { code: "MENU-003", nameTh: "ข้าวผัดน้ำพริกลงเรือหมูหวาน" },
  ];

  for (const row of menus) {
    await db
      .insert(schema.menus)
      .values({ organizationId, categoryId: menuCategory!.id, ...row })
      .onConflictDoUpdate({
        target: [schema.menus.organizationId, schema.menus.code],
        set: { nameTh: row.nameTh, updatedAt: new Date() },
      });
  }
}

async function seedSettings(db: Db, organizationId: string) {
  const rows = [
    {
      key: "expiry_alert_days",
      value: [1, 3, 7],
      description: "Day thresholds used by the expiry alerts",
    },
    {
      key: "document_prefixes",
      value: { goodsReceipt: "GR", stockIssue: "IS", stockTransfer: "TF", purchaseOrder: "PO", stockCount: "SC" },
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
      .onConflictDoUpdate({
        target: [schema.appSettings.organizationId, schema.appSettings.key],
        set: { value: row.value, description: row.description, updatedAt: new Date() },
      });
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema, casing: "snake_case" });

  console.log("Seeding development data...");

  const organization = await seedOrganization(db);
  const locations = await seedLocations(db, organization.id);
  const units = await seedUnits(db);
  await seedUnitConversions(db, units);
  const categories = await seedCategories(db, organization.id);
  const suppliers = await seedSuppliers(db, organization.id);
  const items = await seedItems(db, organization.id, units, categories, suppliers, locations);
  const roleIds = await seedRolesAndPermissions(db);
  await seedUsers(db, organization.id, roleIds, locations);
  await seedMealPeriodsAndMenus(db, organization.id);
  await seedSettings(db, organization.id);

  const seededUsers = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.organizationId, organization.id));

  console.log(
    `Seed complete: ${locations.size} locations, ${items.size} items, ${suppliers.size} suppliers, ${seededUsers.length} users.`,
  );
  console.log(`Sign in with: ${seededUsers.map((user) => user.email).join(", ")}`);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
