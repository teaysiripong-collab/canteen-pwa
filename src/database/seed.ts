import { config } from "dotenv";
import { and, eq, like, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ROLES, type RoleCode } from "../lib/permissions";
import * as schema from "./schema";
import {
  upsertDefaultSettings,
  upsertMealPeriods,
  upsertOrganization,
  upsertRolesAndPermissions,
  upsertUnitConversions,
  upsertUnits,
  type Db,
} from "./reference-data";

config({ path: ".env.local" });
config({ path: ".env" });


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
    { code: "MEAT-001", nameTh: "หมูหั่นบาง", category: "MEAT", supplier: "BETAGRO", reorder: "15", min: "5", safety: "5", shelfLife: 3, aliases: ["หมูสไลซ์"] },
    { code: "MEAT-002", nameTh: "หมูบด", category: "MEAT", supplier: "BETAGRO", reorder: "15", min: "5", safety: "5", shelfLife: 3, aliases: [] },
    { code: "MEAT-003", nameTh: "ไก่หั่นบาง", category: "MEAT", supplier: "BETAGRO", reorder: "20", min: "8", safety: "8", shelfLife: 3, aliases: ["ไก่สไลซ์"] },
    { code: "MEAT-004", nameTh: "ไก่บด", category: "MEAT", supplier: "BETAGRO", reorder: "40", min: "15", safety: "15", shelfLife: 3, aliases: ["ไก่สับละเอียด"] },
    { code: "MEAT-005", nameTh: "ไก่ตัวสับ", category: "MEAT", supplier: "BETAGRO", reorder: "20", min: "8", safety: "8", shelfLife: 3, aliases: ["ไก่สับ"] },
    { code: "MEAT-006", nameTh: "ไก่ BLK", category: "MEAT", supplier: "BETAGRO", reorder: "15", min: "5", safety: "5", shelfLife: 3, aliases: [] },
    { code: "VEG-001", nameTh: "กะหล่ำปลี", category: "VEG", supplier: "PUANGPLOY", reorder: "20", min: "8", safety: "6", shelfLife: 7, aliases: [] },
    { code: "VEG-002", nameTh: "แตงกวา", category: "VEG", supplier: "PUANGPLOY", reorder: "15", min: "5", safety: "4", shelfLife: 5, aliases: [] },
    { code: "VEG-003", nameTh: "ถั่วฝักยาว", category: "VEG", supplier: "PUANGPLOY", reorder: "10", min: "4", safety: "3", shelfLife: 4, aliases: [] },
    { code: "VEG-004", nameTh: "มะเขือพวง", category: "VEG", supplier: "PUANGPLOY", reorder: "5", min: "2", safety: "2", shelfLife: 4, aliases: [] },
    { code: "VEG-005", nameTh: "ใบกะเพรา", category: "VEG", supplier: "PUANGPLOY", reorder: "6", min: "2", safety: "2", shelfLife: 3, aliases: ["กะเพรา"] },
    { code: "VEG-006", nameTh: "พริกขี้หนู", category: "VEG", supplier: "PUANGPLOY", reorder: "4", min: "1.5", safety: "1.5", shelfLife: 5, aliases: ["พริก"] },
    { code: "VEG-007", nameTh: "กระเทียม", category: "VEG", supplier: "PUANGPLOY", reorder: "5", min: "2", safety: "2", shelfLife: 20, aliases: [] },
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
        safetyStock: row.safety,
        shelfLifeDays: row.shelfLife,
      })
      .onConflictDoUpdate({
        target: [schema.items.organizationId, schema.items.code],
        set: {
          nameTh: row.nameTh,
          reorderPoint: row.reorder,
          safetyStock: row.safety,
          updatedAt: new Date(),
        },
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
      safetyStock: "300",
      shelfLifeDays: 14,
    })
    .onConflictDoUpdate({
      target: [schema.items.organizationId, schema.items.code],
      set: { nameTh: "ไข่ไก่", safetyStock: "300", updatedAt: new Date() },
    })
    .returning();

  result.set("EGG-001", egg!.id);
  return result;
}

/**
 * Supplier-specific purchasing terms. These drive the Phase 12 purchase planner, which
 * rounds an order up to the pack size and never orders below the MOQ.
 */
async function seedSupplierItems(
  db: Db,
  units: Map<string, string>,
  suppliers: Map<string, string>,
  items: Map<string, string>,
) {
  const kg = units.get("KG")!;
  const pang = units.get("PANG")!;

  const rows = [
    { item: "MEAT-001", supplier: "BETAGRO", unit: kg, conversion: "1", moq: "5", packSize: "5", price: "182.0000" },
    { item: "MEAT-002", supplier: "BETAGRO", unit: kg, conversion: "1", moq: "5", packSize: "5", price: "165.0000" },
    { item: "MEAT-003", supplier: "BETAGRO", unit: kg, conversion: "1", moq: "5", packSize: "5", price: "96.0000" },
    { item: "MEAT-004", supplier: "BETAGRO", unit: kg, conversion: "1", moq: "10", packSize: "5", price: "88.5000" },
    { item: "MEAT-005", supplier: "BETAGRO", unit: kg, conversion: "1", moq: "5", packSize: "5", price: "75.0000" },
    { item: "MEAT-006", supplier: "BETAGRO", unit: kg, conversion: "1", moq: "5", packSize: "5", price: "92.0000" },
    { item: "VEG-001", supplier: "PUANGPLOY", unit: kg, conversion: "1", moq: "3", packSize: null, price: "25.0000" },
    { item: "VEG-002", supplier: "PUANGPLOY", unit: kg, conversion: "1", moq: "3", packSize: null, price: "32.0000" },
    { item: "VEG-003", supplier: "PUANGPLOY", unit: kg, conversion: "1", moq: "2", packSize: null, price: "45.0000" },
    { item: "VEG-004", supplier: "PUANGPLOY", unit: kg, conversion: "1", moq: "2", packSize: null, price: "68.0000" },
    // 1 แผง = 30 ฟอง, so the conversion is expressed in the base unit (ฟอง).
    { item: "EGG-001", supplier: "MAKRO", unit: pang, conversion: "30", moq: "5", packSize: "1", price: "128.0000" },
  ];

  let count = 0;
  for (const row of rows) {
    await db
      .insert(schema.supplierItems)
      .values({
        supplierId: suppliers.get(row.supplier)!,
        itemId: items.get(row.item)!,
        purchaseUnitId: row.unit,
        purchaseConversion: row.conversion,
        moq: row.moq,
        packSize: row.packSize,
        lastPrice: row.price,
        lastPriceAt: new Date(),
        isPreferred: true,
      })
      .onConflictDoUpdate({
        target: [schema.supplierItems.supplierId, schema.supplierItems.itemId],
        set: {
          purchaseUnitId: row.unit,
          purchaseConversion: row.conversion,
          moq: row.moq,
          packSize: row.packSize,
          lastPrice: row.price,
          isPreferred: true,
          isActive: true,
          updatedAt: new Date(),
        },
      });
    count += 1;
  }

  return count;
}

async function seedUsers(
  db: Db,
  organizationId: string,
  roleIds: Map<RoleCode, string>,
  locations: Map<string, string>,
) {
  const rows = [
    { email: "admin@canteen.local", fullName: "ผู้ดูแลระบบ", role: ROLES.ADMIN, location: "B16" },
    { email: "manager@canteen.local", fullName: "ผู้จัดการโรงอาหาร", role: ROLES.MANAGER, location: "B16" },
    { email: "store@canteen.local", fullName: "พนักงานคลัง B16", role: ROLES.STORE, location: "B16" },
    { email: "staff@canteen.local", fullName: "พนักงานหน้างาน B1", role: ROLES.STAFF, location: "B1" },
  ];

  // Only the seeded demo accounts (@canteen.local) are pruned; real users are never touched.
  await db.delete(schema.users).where(
    and(
      eq(schema.users.organizationId, organizationId),
      like(schema.users.email, "%@canteen.local"),
      notInArray(
        schema.users.email,
        rows.map((row) => row.email),
      ),
    ),
  );

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

    // Rebuild the assignment so a demo account that changed role does not keep the old one.
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, user!.id));
    await db.insert(schema.userRoles).values({ userId: user!.id, roleId: roleIds.get(row.role)! });
  }
}

/** Demo menus only; the DAY/NIGHT meal periods themselves come from the reference data. */
async function seedDemoMenus(db: Db, organizationId: string) {
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

/**
 * Opening stock for development, posted through the real ledger engine rather than
 * inserted straight into the balance table — so the seeded state is reachable by the
 * same rules the application enforces, and re-running the seed cannot double it
 * (the idempotency key is fixed per item).
 */
async function seedOpeningStock(
  db: Db,
  organizationId: string,
  items: Map<string, string>,
  locations: Map<string, string>,
) {
  // Imported lazily: these modules read DATABASE_URL when they load, which only happens
  // after dotenv has run in main().
  const { postMovementAs } = await import("../services/inventory-ledger-service");
  const { createLot } = await import("../services/inventory-lot-service");
  const { permissionsForRoles } = await import("../lib/permissions");

  const [admin] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, "admin@canteen.local"))
    .limit(1);

  if (!admin) return 0;

  const actor = {
    id: admin.id,
    organizationId,
    email: admin.email,
    fullName: admin.fullName,
    defaultLocationId: admin.defaultLocationId,
    defaultLocationName: null,
    roleCodes: ["ADMIN" as const],
    permissions: permissionsForRoles(["ADMIN"]),
  };

  const rows = [
    { item: "MEAT-004", location: "B16", qty: "32", cost: "88.5000", expiresInDays: 3 },
    { item: "MEAT-001", location: "B16", qty: "18", cost: "182.0000", expiresInDays: 3 },
    { item: "MEAT-003", location: "B16", qty: "24", cost: "96.0000", expiresInDays: 2 },
    { item: "VEG-001", location: "B16", qty: "26", cost: "25.0000", expiresInDays: 6 },
    { item: "VEG-002", location: "B16", qty: "9", cost: "32.0000", expiresInDays: 4 },
    { item: "VEG-003", location: "B16", qty: "3", cost: "45.0000", expiresInDays: 1 },
    { item: "EGG-001", location: "B16", qty: "900", cost: "4.2667", expiresInDays: 12 },
    { item: "VEG-001", location: "B1", qty: "6", cost: "25.0000", expiresInDays: 5 },
    { item: "MEAT-004", location: "B1", qty: "5", cost: "88.5000", expiresInDays: 2 },
  ];

  let posted = 0;
  for (const [index, row] of rows.entries()) {
    const idempotencyKey = `seed:opening-balance:${row.item}:${row.location}`;

    const [already] = await db
      .select({ id: schema.inventoryPostings.id })
      .from(schema.inventoryPostings)
      .where(eq(schema.inventoryPostings.idempotencyKey, idempotencyKey))
      .limit(1);

    if (already) continue;

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + row.expiresInDays);

    const lot = await createLot({
      organizationId,
      itemId: items.get(row.item)!,
      lotNumber: `SEED-${row.item}-${row.location}`,
      receivedBaseQty: row.qty,
      unitCost: row.cost,
      expiryDate: expiry.toISOString().slice(0, 10),
      note: "ยอดยกมาสำหรับ development",
    });

    await postMovementAs(actor, {
      idempotencyKey,
      referenceType: "MANUAL_ADJUSTMENT",
      referenceNumber: `OPEN-${String(index + 1).padStart(3, "0")}`,
      note: "ยอดยกมาสำหรับ development",
      lines: [
        {
          type: "OPENING_BALANCE",
          itemId: items.get(row.item)!,
          lotId: lot.id,
          locationId: locations.get(row.location)!,
          baseQty: row.qty,
          unitCost: row.cost,
        },
      ],
    });

    posted += 1;
  }

  return posted;
}

/**
 * A published BOM for ผัดกะเพราไก่ that shows the "30+20" split in the running app.
 * Totals are computed with the same helper the service uses, so the stored total can
 * never disagree with the period rows.
 */
async function seedRecipes(
  db: Db,
  organizationId: string,
  items: Map<string, string>,
  units: Map<string, string>,
) {
  const { sumPeriodQuantities } = await import("../lib/bom/period-quantity");

  const [menu] = await db
    .select()
    .from(schema.menus)
    .where(and(eq(schema.menus.organizationId, organizationId), eq(schema.menus.code, "MENU-001")))
    .limit(1);
  if (!menu) return 0;

  const periods = await db
    .select()
    .from(schema.mealPeriods)
    .where(eq(schema.mealPeriods.organizationId, organizationId))
    .orderBy(schema.mealPeriods.sortOrder);
  if (periods.length < 2) return 0;

  const [recipe] = await db
    .insert(schema.recipes)
    .values({ menuId: menu.id, nameTh: menu.nameTh })
    .onConflictDoUpdate({ target: schema.recipes.menuId, set: { nameTh: menu.nameTh } })
    .returning();

  const [existingVersion] = await db
    .select()
    .from(schema.recipeVersions)
    .where(eq(schema.recipeVersions.recipeId, recipe!.id))
    .limit(1);
  if (existingVersion) return 0;

  const [version] = await db
    .insert(schema.recipeVersions)
    .values({
      recipeId: recipe!.id,
      versionNo: 1,
      yieldQty: "1",
      effectiveFrom: new Date().toISOString().slice(0, 10),
      isPublished: true,
      note: "สูตรตัวอย่างสำหรับ development",
    })
    .returning();

  // "30+20" = เช้า 30 / ดึก 20, and so on for the rest of the line-up.
  const lines = [
    { item: "MEAT-004", day: "30", night: "20", waste: "0" },
    { item: "VEG-005", day: "2.5", night: "1.5", waste: "0.05" },
    { item: "VEG-006", day: "1", night: "0.5", waste: "0" },
    { item: "VEG-007", day: "0.8", night: "0.5", waste: "0.1" },
  ];

  for (const [index, line] of lines.entries()) {
    const values = [line.day, line.night];
    const [recipeItem] = await db
      .insert(schema.recipeItems)
      .values({
        recipeVersionId: version!.id,
        itemId: items.get(line.item)!,
        quantity: sumPeriodQuantities(values),
        unitId: units.get("KG")!,
        wasteFactor: line.waste,
        sortOrder: index,
      })
      .returning();

    await db.insert(schema.recipeItemPeriodQuantities).values(
      periods.slice(0, 2).map((period, periodIndex) => ({
        recipeItemId: recipeItem!.id,
        mealPeriodId: period.id,
        quantity: values[periodIndex]!,
      })),
    );
  }

  return lines.length;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema, casing: "snake_case" });

  console.log("Seeding development data...");

  const organization = await upsertOrganization(db, "Company Canteen");
  const locations = await seedLocations(db, organization.id);
  const units = await upsertUnits(db);
  await upsertUnitConversions(db, units);
  const categories = await seedCategories(db, organization.id);
  const suppliers = await seedSuppliers(db, organization.id);
  const items = await seedItems(db, organization.id, units, categories, suppliers, locations);
  const supplierItemCount = await seedSupplierItems(db, units, suppliers, items);
  const roleIds = await upsertRolesAndPermissions(db);
  await seedUsers(db, organization.id, roleIds, locations);
  await upsertMealPeriods(db, organization.id);
  await seedDemoMenus(db, organization.id);
  await upsertDefaultSettings(db, organization.id);
  const openingPostings = await seedOpeningStock(db, organization.id, items, locations);
  const recipeLines = await seedRecipes(db, organization.id, items, units);

  const seededUsers = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.organizationId, organization.id));

  console.log(
    `Seed complete: ${locations.size} locations, ${items.size} items, ${suppliers.size} suppliers, ${supplierItemCount} supplier items, ${seededUsers.length} users, ${openingPostings} opening-stock postings, ${recipeLines} BOM lines.`,
  );
  console.log(`Sign in with: ${seededUsers.map((user) => user.email).join(", ")}`);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
