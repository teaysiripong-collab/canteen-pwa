import { PrismaClient, Role, Shift, PlanStatus, PoStatus, StockTxType, TaskStatus, TaskPriority } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

function d(s: string) {
  return new Date(s + "T00:00:00.000Z");
}

async function main() {
  console.log("Seeding...");

  // ── Users ──
  const pw = await bcrypt.hash("1234", 10);
  const mkUser = (username: string, name: string, role: Role) =>
    db.user.upsert({ where: { username }, update: {}, create: { username, passwordHash: pw, name, role } });

  await mkUser("admin", "ผู้ดูแลระบบ", Role.ADMIN);
  const manager = await mkUser("manager", "คุณวิชัย (ผู้จัดการ)", Role.MANAGER);
  const supervisor = await mkUser("supervisor", "คุณสมศรี (หัวหน้างาน)", Role.SUPERVISOR);
  const procurement = await mkUser("procurement", "คุณนภา (จัดซื้อ)", Role.PROCUREMENT);
  const store = await mkUser("store", "คุณประยุทธ (สโตร์)", Role.STORE);
  const staff1 = await mkUser("staff1", "คุณมาลี (พนักงานครัว)", Role.STAFF);
  const staff2 = await mkUser("staff2", "คุณสมชาย (พนักงานครัว)", Role.STAFF);
  await mkUser("viewer", "ผู้ชมข้อมูล", Role.VIEWER);

  // ── Units ──
  const unitDefs = [
    ["kg", "กิโลกรัม"], ["g", "กรัม"], ["L", "ลิตร"], ["ขวด", "ขวด"], ["ลัง", "ลัง"],
    ["ถุง", "ถุง"], ["แพ็ค", "แพ็ค"], ["ฟอง", "ฟอง"], ["ลูก", "ลูก"], ["กำ", "กำ"],
  ] as const;
  const units: Record<string, string> = {};
  for (const [code, name] of unitDefs) {
    const u = await db.unit.upsert({ where: { code }, update: {}, create: { code, name } });
    units[code] = u.id;
  }

  // ── Categories ──
  const catDefs: [string, string][] = [
    ["INGREDIENT", "เนื้อสัตว์"], ["INGREDIENT", "ผัก"], ["INGREDIENT", "เครื่องปรุง"],
    ["INGREDIENT", "ของแห้ง"], ["INGREDIENT", "ไข่/นม"], ["INGREDIENT", "น้ำมัน"],
    ["MENU", "อาหารจานเดียว"], ["MENU", "กับข้าว"], ["MENU", "แกง/ต้ม"], ["MENU", "ของหวาน"],
  ];
  const cats: Record<string, string> = {};
  for (const [type, name] of catDefs) {
    const c = await db.category.upsert({
      where: { type_name: { type, name } }, update: {}, create: { type, name },
    });
    cats[name] = c.id;
  }

  // ── Locations (hierarchy) ──
  async function loc(code: string, name: string, parentId?: string) {
    return db.location.upsert({ where: { code }, update: {}, create: { code, name, parentId } });
  }
  const b1 = await loc("B1", "Building 1");
  const b16 = await loc("B16", "Building 16");
  const b16Stock = await loc("B16-STK", "ห้อง Stock", b16.id);
  const freezer2 = await loc("B16-FZ2", "Freezer 2", b16Stock.id);
  const shelfB = await loc("B16-SHB", "Shelf B", b16Stock.id);
  await loc("B1-KIT", "ครัว Building 1", b1.id);
  const dryStore = await loc("B16-DRY", "คลังของแห้ง", b16Stock.id);

  // ── Vendors ──
  async function vendor(code: string, name: string, extra: Partial<{ contactName: string; phone: string; leadTimeDays: number; deliveryDays: string }>) {
    return db.vendor.upsert({ where: { code }, update: {}, create: { code, name, ...extra } });
  }
  const betagro = await vendor("V001", "Betagro", { contactName: "คุณเอก", phone: "081-111-2222", leadTimeDays: 1, deliveryDays: "จ,พ,ศ" });
  const puangploy = await vendor("V002", "พวงพลอย (ผักสด)", { contactName: "คุณพลอย", phone: "082-333-4444", leadTimeDays: 1, deliveryDays: "ทุกวัน" });
  const makro = await vendor("V003", "Makro", { phone: "02-000-0000", leadTimeDays: 2, deliveryDays: "อ,ศ" });

  // ── Ingredients ──
  type IngDef = [code: string, name: string, cat: string, unit: string, vendor: string, storageId: string, minStock: number, price?: number, purchaseUnit?: string, conv?: number];
  const ingDefs: IngDef[] = [
    ["ING001", "หมูบด", "เนื้อสัตว์", "kg", betagro.id, freezer2.id, 20, 120],
    ["ING002", "ไก่บด", "เนื้อสัตว์", "kg", betagro.id, freezer2.id, 15, 85],
    ["ING003", "หมูหั่นบาง", "เนื้อสัตว์", "kg", betagro.id, freezer2.id, 10, 135],
    ["ING004", "ไก่น่องติดสะโพก", "เนื้อสัตว์", "kg", betagro.id, freezer2.id, 15, 75],
    ["ING005", "กะเพรา", "ผัก", "kg", puangploy.id, shelfB.id, 2, 60],
    ["ING006", "พริกขี้หนู", "ผัก", "kg", puangploy.id, shelfB.id, 1, 90],
    ["ING007", "กระเทียม", "ผัก", "kg", puangploy.id, shelfB.id, 3, 70],
    ["ING008", "แตงกวา", "ผัก", "kg", puangploy.id, shelfB.id, 5, 25],
    ["ING009", "กะหล่ำปลี", "ผัก", "kg", puangploy.id, shelfB.id, 8, 20],
    ["ING010", "ถั่วฝักยาว", "ผัก", "kg", puangploy.id, shelfB.id, 3, 35],
    ["ING011", "คะน้า", "ผัก", "kg", puangploy.id, shelfB.id, 5, 30],
    ["ING012", "น้ำมันพืช", "น้ำมัน", "L", makro.id, dryStore.id, 20, 55, "ลัง", 12],
    ["ING013", "น้ำปลา", "เครื่องปรุง", "ขวด", makro.id, dryStore.id, 12, 32, "ลัง", 12],
    ["ING014", "ซอสหอยนางรม", "เครื่องปรุง", "ขวด", makro.id, dryStore.id, 6, 45, "ลัง", 12],
    ["ING015", "น้ำตาลทราย", "ของแห้ง", "kg", makro.id, dryStore.id, 10, 26],
    ["ING016", "ข้าวสารหอมมะลิ", "ของแห้ง", "kg", makro.id, dryStore.id, 100, 38],
    ["ING017", "ไข่ไก่ เบอร์ 2", "ไข่/นม", "ฟอง", betagro.id, shelfB.id, 90, 4.2, "แพ็ค", 30],
    ["ING018", "พริกแกงเขียวหวาน", "เครื่องปรุง", "kg", makro.id, dryStore.id, 2, 160],
    ["ING019", "กะทิกล่อง", "เครื่องปรุง", "L", makro.id, dryStore.id, 6, 65, "ลัง", 12],
    ["ING020", "มะเขือเปราะ", "ผัก", "kg", puangploy.id, shelfB.id, 2, 30],
  ];
  const ing: Record<string, string> = {};
  for (const [code, name, cat, unit, vendorId, storageId, minStock, price, pUnit, conv] of ingDefs) {
    const row = await db.ingredient.upsert({
      where: { code },
      update: {},
      create: {
        code, name, categoryId: cats[cat], stockUnitId: units[unit],
        purchaseUnitId: pUnit ? units[pUnit] : units[unit],
        conversionFactor: conv ?? 1,
        defaultVendorId: vendorId, storageId, minStock, lastPrice: price,
      },
    });
    ing[name] = row.id;
  }

  // ── Menus + Recipes + BOM Templates ──
  type MenuDef = {
    code: string; name: string; cat: string;
    bom: [string, number, string][]; // ingredient, qty per shift (มาตรฐานรอบเช้า), unit
    steps: string[]; time: number; control?: string;
  };
  const menuDefs: MenuDef[] = [
    {
      code: "M001", name: "กะเพราหมูบด", cat: "อาหารจานเดียว", time: 45,
      bom: [["หมูบด", 30, "kg"], ["กะเพรา", 4, "kg"], ["พริกขี้หนู", 2, "kg"], ["กระเทียม", 1.5, "kg"], ["น้ำมันพืช", 3, "L"], ["น้ำปลา", 2, "ขวด"], ["ซอสหอยนางรม", 2, "ขวด"]],
      steps: ["โขลกพริกและกระเทียมพอหยาบ", "ตั้งกระทะ น้ำมันร้อนจัด ใส่พริกกระเทียมผัดให้หอม", "ใส่หมูบด ผัดให้สุกทั่ว", "ปรุงรสด้วยน้ำปลาและซอสหอยนางรม", "ใส่ใบกะเพรา ผัดไฟแรงพอสลด ปิดไฟทันที"],
      control: "ผัดไฟแรง ใบกะเพราใส่ท้ายสุด ห้ามผัดนานจนใบดำ",
    },
    {
      code: "M002", name: "ผัดกะหล่ำปลีน้ำปลา", cat: "กับข้าว", time: 30,
      bom: [["กะหล่ำปลี", 12, "kg"], ["กระเทียม", 0.8, "kg"], ["น้ำมันพืช", 2, "L"], ["น้ำปลา", 1.5, "ขวด"]],
      steps: ["หั่นกะหล่ำปลีชิ้นพอคำ ล้างสะอาด", "เจียวกระเทียมให้เหลืองหอม", "ใส่กะหล่ำปลี ผัดไฟแรง", "ปรุงรสน้ำปลา ผัดพอสลด"],
    },
    {
      code: "M003", name: "แกงเขียวหวานไก่", cat: "แกง/ต้ม", time: 60,
      bom: [["ไก่น่องติดสะโพก", 20, "kg"], ["พริกแกงเขียวหวาน", 2, "kg"], ["กะทิกล่อง", 10, "L"], ["มะเขือเปราะ", 4, "kg"], ["น้ำปลา", 1, "ขวด"], ["น้ำตาลทราย", 1, "kg"]],
      steps: ["ผัดพริกแกงกับหัวกะทิจนแตกมัน", "ใส่ไก่ ผัดให้สุกผิวนอก", "เติมกะทิ เคี่ยวจนไก่นุ่ม", "ใส่มะเขือเปราะ ปรุงรส", "เคี่ยวต่อ 10 นาที ชิมรส"],
      control: "เคี่ยวไฟกลาง อย่าให้กะทิแตกมันเกินไป ตรวจไก่สุกถึงกระดูก",
    },
    {
      code: "M004", name: "ไข่เจียวหมูสับ", cat: "กับข้าว", time: 30,
      bom: [["ไข่ไก่ เบอร์ 2", 300, "ฟอง"], ["หมูบด", 8, "kg"], ["น้ำมันพืช", 4, "L"], ["น้ำปลา", 1, "ขวด"]],
      steps: ["ตีไข่กับหมูสับและน้ำปลาให้เข้ากัน", "น้ำมันร้อนจัด เทไข่ลงทอด", "ทอดจนเหลืองสองด้าน"],
    },
    {
      code: "M005", name: "ผัดคะน้าหมูกรอบ", cat: "กับข้าว", time: 40,
      bom: [["คะน้า", 10, "kg"], ["หมูหั่นบาง", 8, "kg"], ["กระเทียม", 0.8, "kg"], ["น้ำมันพืช", 2, "L"], ["ซอสหอยนางรม", 1.5, "ขวด"]],
      steps: ["หั่นคะน้า แยกก้านและใบ", "ผัดกระเทียมกับหมูให้สุก", "ใส่ก้านคะน้าก่อน ตามด้วยใบ", "ปรุงรส ผัดไฟแรงพอสลด"],
    },
    {
      code: "M006", name: "ผัดถั่วฝักยาวหมูบด", cat: "กับข้าว", time: 30,
      bom: [["ถั่วฝักยาว", 8, "kg"], ["หมูบด", 6, "kg"], ["กระเทียม", 0.5, "kg"], ["น้ำมันพืช", 1.5, "L"], ["น้ำปลา", 1, "ขวด"]],
      steps: ["หั่นถั่วฝักยาวท่อนสั้น", "ผัดกระเทียมกับหมูบดให้สุก", "ใส่ถั่วฝักยาว ผัดจนสุก ปรุงรส"],
    },
    {
      code: "M007", name: "ข้าวสวย", cat: "อาหารจานเดียว", time: 50,
      bom: [["ข้าวสารหอมมะลิ", 60, "kg"]],
      steps: ["ซาวข้าว 2 น้ำ", "หุงด้วยอัตราส่วนข้าว 1 : น้ำ 1.2", "พักข้าว 10 นาทีก่อนตัก"],
    },
  ];

  const menus: Record<string, string> = {};
  for (const m of menuDefs) {
    const existing = await db.menu.findUnique({ where: { code: m.code } });
    if (existing) { menus[m.name] = existing.id; continue; }
    const menu = await db.menu.create({
      data: { code: m.code, name: m.name, categoryId: cats[m.cat], favorite: ["M001", "M003"].includes(m.code) },
    });
    menus[m.name] = menu.id;
    await db.recipe.create({
      data: {
        menuId: menu.id, version: 1, timeMinutes: m.time, controlPoints: m.control,
        yieldNote: "สำหรับรอบเช้ามาตรฐาน (~300 ที่)", updatedById: supervisor.id,
        ingredients: {
          create: m.bom.map(([name, qty, unit], i) => ({
            ingredientId: ing[name], qty, unitId: units[unit], sortOrder: i,
          })),
        },
        steps: { create: m.steps.map((s, i) => ({ stepNo: i + 1, instruction: s })) },
      },
    });
    await db.bomTemplate.create({
      data: {
        menuId: menu.id, version: 1,
        items: { create: m.bom.map(([name, qty, unit]) => ({ ingredientId: ing[name], qty, unitId: units[unit] })) },
      },
    });
  }

  // ── Menu plan: this week (Mon 2026-08-03 .. Sat 2026-08-08), APPROVED ──
  const weekStart = d("2026-08-03");
  let plan = await db.menuPlan.findFirst({ where: { weekStart } });
  if (!plan) {
    plan = await db.menuPlan.create({
      data: {
        weekStart, status: PlanStatus.APPROVED, createdById: supervisor.id,
        approvedById: manager.id, approvedAt: new Date("2026-08-01T03:00:00Z"), submittedAt: new Date("2026-07-31T10:00:00Z"),
      },
    });
    // Each day: rice + 2 dishes morning, rice + 1 dish night
    const week: [string, string[], string[]][] = [
      ["2026-08-03", ["ข้าวสวย", "กะเพราหมูบด", "ผัดกะหล่ำปลีน้ำปลา"], ["ข้าวสวย", "ไข่เจียวหมูสับ"]],
      ["2026-08-04", ["ข้าวสวย", "แกงเขียวหวานไก่", "ผัดถั่วฝักยาวหมูบด"], ["ข้าวสวย", "ผัดกะหล่ำปลีน้ำปลา"]],
      ["2026-08-05", ["ข้าวสวย", "กะเพราหมูบด", "ผัดคะน้าหมูกรอบ"], ["ข้าวสวย", "กะเพราหมูบด"]],
      ["2026-08-06", ["ข้าวสวย", "ไข่เจียวหมูสับ", "ผัดกะหล่ำปลีน้ำปลา"], ["ข้าวสวย", "ผัดถั่วฝักยาวหมูบด"]],
      ["2026-08-07", ["ข้าวสวย", "แกงเขียวหวานไก่", "ผัดคะน้าหมูกรอบ"], ["ข้าวสวย", "ไข่เจียวหมูสับ"]],
      ["2026-08-08", ["ข้าวสวย", "กะเพราหมูบด", "ผัดถั่วฝักยาวหมูบด"], ["ข้าวสวย", "ผัดกะหล่ำปลีน้ำปลา"]],
    ];
    for (const [date, morning, night] of week) {
      for (const [shift, names] of [[Shift.MORNING, morning], [Shift.NIGHT, night]] as const) {
        let order = 0;
        for (const name of names) {
          const entry = await db.menuPlanEntry.create({
            data: { planId: plan.id, date: d(date), shift, menuId: menus[name], sortOrder: order++ },
          });
          // BOM lines from template; night shift = ~60% of morning standard
          const tmpl = await db.bomTemplate.findFirst({ where: { menuId: menus[name], isCurrent: true }, include: { items: true } });
          if (tmpl) {
            const factor = shift === Shift.NIGHT ? 0.6 : 1;
            await db.bomLine.createMany({
              data: tmpl.items.map((it) => ({
                planEntryId: entry.id, ingredientId: it.ingredientId,
                qty: Math.round(Number(it.qty) * factor * 100) / 100, unitId: it.unitId,
              })),
            });
          }
        }
      }
    }
  }

  // ── Historical usage (for BOM learning): กะเพราหมูบด used 32,31,33,32 vs plan 30 ──
  const usageCount = await db.usageRecord.count();
  if (usageCount === 0) {
    const hist: [string, number][] = [["2026-07-27", 32], ["2026-07-29", 31], ["2026-07-31", 33], ["2026-08-03", 32]];
    for (const [date, qty] of hist) {
      await db.usageRecord.create({
        data: {
          date: d(date), shift: Shift.MORNING, menuId: menus["กะเพราหมูบด"],
          ingredientId: ing["หมูบด"], qty, unitId: units["kg"], recordedById: staff1.id,
        },
      });
    }
    await db.usageRecord.createMany({
      data: [
        { date: d("2026-08-03"), shift: Shift.MORNING, menuId: menus["กะเพราหมูบด"], ingredientId: ing["กะเพรา"], qty: 4.5, unitId: units["kg"], recordedById: staff1.id },
        { date: d("2026-08-03"), shift: Shift.NIGHT, menuId: menus["ไข่เจียวหมูสับ"], ingredientId: ing["ไข่ไก่ เบอร์ 2"], qty: 190, unitId: units["ฟอง"], recordedById: staff2.id },
      ],
    });
  }

  // ── Stock: lots + receive transactions ──
  const lotCount = await db.lot.count();
  if (lotCount === 0) {
    type LotDef = [ingName: string, lotCode: string, qty: number, unit: string, locId: string, expiry: string | null, vendorId: string];
    const lots: LotDef[] = [
      ["หมูบด", "LOT-PB-2608A", 45, "kg", freezer2.id, "2026-08-09", betagro.id],
      ["หมูบด", "LOT-PB-2608B", 30, "kg", freezer2.id, "2026-08-14", betagro.id],
      ["ไก่บด", "LOT-CK-2608A", 18, "kg", freezer2.id, "2026-08-11", betagro.id],
      ["หมูหั่นบาง", "LOT-PS-2608A", 12, "kg", freezer2.id, "2026-08-10", betagro.id],
      ["ไก่น่องติดสะโพก", "LOT-CT-2608A", 25, "kg", freezer2.id, "2026-08-08", betagro.id],
      ["กะเพรา", "LOT-KP-0508", 3, "kg", shelfB.id, "2026-08-07", puangploy.id],
      ["พริกขี้หนู", "LOT-PR-0508", 1.5, "kg", shelfB.id, "2026-08-08", puangploy.id],
      ["กระเทียม", "LOT-GL-0108", 6, "kg", shelfB.id, "2026-08-20", puangploy.id],
      ["กะหล่ำปลี", "LOT-CB-0508", 15, "kg", shelfB.id, "2026-08-09", puangploy.id],
      ["ถั่วฝักยาว", "LOT-YB-0508", 2, "kg", shelfB.id, "2026-08-06", puangploy.id],
      ["คะน้า", "LOT-KN-0508", 7, "kg", shelfB.id, "2026-08-07", puangploy.id],
      ["แตงกวา", "LOT-CU-0508", 8, "kg", shelfB.id, "2026-08-08", puangploy.id],
      ["น้ำมันพืช", "LOT-OIL-0726", 48, "L", dryStore.id, "2027-06-30", makro.id],
      ["น้ำปลา", "LOT-FS-0726", 24, "ขวด", dryStore.id, "2027-12-31", makro.id],
      ["ซอสหอยนางรม", "LOT-OS-0726", 10, "ขวด", dryStore.id, "2027-03-31", makro.id],
      ["น้ำตาลทราย", "LOT-SG-0726", 25, "kg", dryStore.id, null, makro.id],
      ["ข้าวสารหอมมะลิ", "LOT-RC-0726", 320, "kg", dryStore.id, null, makro.id],
      ["ไข่ไก่ เบอร์ 2", "LOT-EG-0408", 450, "ฟอง", shelfB.id, "2026-08-18", betagro.id],
      ["พริกแกงเขียวหวาน", "LOT-CP-0726", 4, "kg", dryStore.id, "2026-10-31", makro.id],
      ["กะทิกล่อง", "LOT-CO-0726", 24, "L", dryStore.id, "2026-12-31", makro.id],
      ["มะเขือเปราะ", "LOT-EP-0508", 3, "kg", shelfB.id, "2026-08-08", puangploy.id],
    ];
    for (const [name, lotCode, qty, unit, locationId, expiry, vendorId] of lots) {
      const lot = await db.lot.create({
        data: { ingredientId: ing[name], lotCode, expiryDate: expiry ? d(expiry) : null, vendorId },
      });
      await db.stockTransaction.create({
        data: {
          type: StockTxType.RECEIVE, ingredientId: ing[name], lotId: lot.id, locationId,
          qty, unitId: units[unit], userId: store.id, note: "ยอดยกมา / รับเข้า",
        },
      });
    }
    // Some issues (เบิกใช้จริงวันนี้เช้า)
    const issueDefs: [string, number, string, string][] = [
      ["หมูบด", -32, "kg", freezer2.id],
      ["กะเพรา", -2, "kg", shelfB.id],
      ["ข้าวสารหอมมะลิ", -60, "kg", dryStore.id],
    ];
    for (const [name, qty, unit, locationId] of issueDefs) {
      const lot = await db.lot.findFirst({ where: { ingredientId: ing[name] }, orderBy: { expiryDate: "asc" } });
      await db.stockTransaction.create({
        data: {
          type: StockTxType.ISSUE, ingredientId: ing[name], lotId: lot?.id, locationId,
          qty, unitId: units[unit], userId: staff1.id, shift: Shift.MORNING, note: "เบิกทำอาหารรอบเช้า",
        },
      });
    }
  }

  // ── Purchase order example (Betagro, สั่งแล้วส่งไม่ครบ) ──
  const poCount = await db.purchaseOrder.count();
  if (poCount === 0) {
    await db.purchaseOrder.create({
      data: {
        code: "PO-20260803-001", vendorId: betagro.id, status: PoStatus.PARTIAL,
        periodStart: d("2026-08-03"), periodEnd: d("2026-08-08"),
        orderDate: new Date("2026-08-02T04:00:00Z"), createdById: procurement.id,
        items: {
          create: [
            { ingredientId: ing["หมูบด"], bomQty: 150, stockQty: 20, suggestedQty: 150, orderQty: 150, receivedQty: 75, unitId: units["kg"], price: 120 },
            { ingredientId: ing["ไก่น่องติดสะโพก"], bomQty: 32, stockQty: 10, suggestedQty: 32, orderQty: 35, receivedQty: 35, unitId: units["kg"], price: 75 },
            { ingredientId: ing["ไข่ไก่ เบอร์ 2"], bomQty: 780, stockQty: 200, suggestedQty: 780, orderQty: 780, receivedQty: 780, unitId: units["ฟอง"], price: 4.2 },
          ],
        },
      },
    });
    await db.purchaseOrder.create({
      data: {
        code: "PO-20260803-002", vendorId: puangploy.id, status: PoStatus.DRAFT,
        periodStart: d("2026-08-10"), periodEnd: d("2026-08-15"), createdById: supervisor.id,
        items: {
          create: [
            { ingredientId: ing["กะเพรา"], bomQty: 18, stockQty: 3, suggestedQty: 18, orderQty: 18, unitId: units["kg"] },
            { ingredientId: ing["กะหล่ำปลี"], bomQty: 40, stockQty: 15, suggestedQty: 40, orderQty: 40, unitId: units["kg"] },
          ],
        },
      },
    });
  }

  // ── Tasks ──
  const taskCount = await db.task.count();
  if (taskCount === 0) {
    await db.task.createMany({
      data: [
        { title: "ตรวจนับ Stock Freezer 2", description: "นับเนื้อสัตว์ทุกรายการ เทียบกับระบบ", assigneeId: store.id, createdById: supervisor.id, priority: TaskPriority.HIGH, status: TaskStatus.IN_PROGRESS, date: d("2026-08-05"), dueAt: new Date("2026-08-05T10:00:00Z"), locationId: freezer2.id, shift: Shift.MORNING },
        { title: "เตรียมวัตถุดิบแกงเขียวหวานพรุ่งนี้", description: "หั่นไก่ แช่เย็นไว้", assigneeId: staff1.id, createdById: supervisor.id, priority: TaskPriority.NORMAL, status: TaskStatus.NOT_STARTED, date: d("2026-08-05"), dueAt: new Date("2026-08-05T12:00:00Z"), shift: Shift.NIGHT },
        { title: "ทำความสะอาดเครื่องบดเนื้อ", assigneeId: staff2.id, createdById: supervisor.id, priority: TaskPriority.NORMAL, status: TaskStatus.COMPLETED, completedAt: new Date("2026-08-04T09:00:00Z"), date: d("2026-08-04") },
        { title: "ตามของ Betagro ที่ส่งไม่ครบ (หมูบด 75 kg)", description: "PO-20260803-001 ค้างส่งหมูบด 75 kg", assigneeId: procurement.id, createdById: manager.id, priority: TaskPriority.URGENT, status: TaskStatus.NOT_STARTED, date: d("2026-08-04"), dueAt: new Date("2026-08-04T09:00:00Z") },
        { title: "ส่งเมนูสัปดาห์หน้าให้ Manager อนุมัติ", assigneeId: supervisor.id, createdById: manager.id, priority: TaskPriority.HIGH, status: TaskStatus.NOT_STARTED, date: d("2026-08-06"), dueAt: new Date("2026-08-06T10:00:00Z") },
      ],
    });
  }

  // ── Excel template (cost mapping) ──
  const tmplCount = await db.excelTemplate.count();
  if (tmplCount === 0) {
    await db.excelTemplate.create({
      data: {
        name: "Cost Template มาตรฐาน",
        description: "Template ต้นทุนรายสัปดาห์ตามรูปแบบ Excel เดิมขององค์กร",
        headerRow: 1,
        mappingJson: JSON.stringify([
          { field: "date", column: "A", label: "วันที่" },
          { field: "shift", column: "B", label: "รอบ" },
          { field: "menuName", column: "C", label: "เมนู" },
          { field: "ingredientName", column: "D", label: "วัตถุดิบ" },
          { field: "qty", column: "E", label: "ปริมาณ (BOM)" },
          { field: "unit", column: "F", label: "หน่วย" },
          { field: "price", column: "G", label: "ราคา/หน่วย (จัดซื้อกรอก)" },
          { field: "amount", column: "H", label: "รวมเงิน", formula: "E*G" },
        ]),
      },
    });
  }

  // ── Notifications ──
  const notiCount = await db.notification.count();
  if (notiCount === 0) {
    await db.notification.createMany({
      data: [
        { userId: procurement.id, type: "PO_INCOMPLETE", title: "Betagro ส่งไม่ครบ", message: "PO-20260803-001 ค้างรับหมูบด 75 kg", link: "/purchase" },
        { userId: supervisor.id, type: "STOCK_LOW", title: "ถั่วฝักยาวต่ำกว่า Minimum", message: "คงเหลือ 2 kg (ขั้นต่ำ 3 kg)", link: "/stock" },
        { userId: store.id, type: "EXPIRY", title: "ถั่วฝักยาวใกล้หมดอายุ", message: "LOT-YB-0508 หมดอายุ 6 ส.ค.", link: "/stock" },
        { userId: staff1.id, type: "TASK_NEW", title: "มีงานใหม่", message: "เตรียมวัตถุดิบแกงเขียวหวานพรุ่งนี้", link: "/tasks" },
      ],
    });
  }

  console.log("Seed complete.");
}

main().finally(() => db.$disconnect());
