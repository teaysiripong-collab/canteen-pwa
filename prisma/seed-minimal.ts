/**
 * Minimal seed for a real deployment: creates ONE admin account plus the
 * unavoidable lookup values (units, category headings). No demo menus, no fake
 * vendors, no sample stock — the canteen's own data goes in via
 * Master Data → นำเข้าจาก Excel.
 *
 *   ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_NAME override the defaults.
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const username = (process.env.ADMIN_USERNAME ?? "admin").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const name = process.env.ADMIN_NAME ?? "ผู้ดูแลระบบ";

  if (!password) {
    console.error(
      "\n✗ ต้องกำหนดรหัสผ่าน admin ก่อน เพื่อไม่ให้ระบบจริงมีรหัสผ่านที่เดาได้\n" +
        '  ตัวอย่าง:  ADMIN_PASSWORD="รหัสผ่านที่ปลอดภัย" npm run db:seed\n'
    );
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("\n✗ รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร\n");
    process.exitCode = 1;
    return;
  }

  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`• มีผู้ใช้ "${username}" อยู่แล้ว — ไม่เปลี่ยนรหัสผ่าน`);
  } else {
    await db.user.create({
      data: { username, name, role: Role.ADMIN, passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`✓ สร้างผู้ใช้ Admin: ${username}`);
  }

  // Units and category headings are lookups every canteen needs; they are data,
  // not code, and remain fully editable in Master Data.
  const units: [string, string][] = [
    ["kg", "กิโลกรัม"], ["g", "กรัม"], ["L", "ลิตร"], ["ml", "มิลลิลิตร"],
    ["ขวด", "ขวด"], ["ลัง", "ลัง"], ["ถุง", "ถุง"], ["แพ็ค", "แพ็ค"],
    ["ฟอง", "ฟอง"], ["ลูก", "ลูก"], ["หัว", "หัว"], ["กำ", "กำ"], ["ชิ้น", "ชิ้น"],
  ];
  for (const [code, name] of units) {
    await db.unit.upsert({ where: { code }, update: {}, create: { code, name } });
  }
  console.log(`✓ หน่วยนับพื้นฐาน ${units.length} หน่วย`);

  const categories: [string, string][] = [
    ["INGREDIENT", "เนื้อสัตว์"], ["INGREDIENT", "ผัก"], ["INGREDIENT", "เครื่องปรุง"],
    ["INGREDIENT", "ของแห้ง"], ["INGREDIENT", "ไข่/นม"], ["INGREDIENT", "น้ำมัน"],
    ["MENU", "อาหารจานเดียว"], ["MENU", "กับข้าว"], ["MENU", "แกง/ต้ม"], ["MENU", "ของหวาน"],
  ];
  for (const [type, name] of categories) {
    await db.category.upsert({ where: { type_name: { type, name } }, update: {}, create: { type, name } });
  }
  console.log(`✓ หมวดหมู่พื้นฐาน ${categories.length} หมวด`);

  // A starting cost template so the Excel workflow works on day one.
  if ((await db.excelTemplate.count()) === 0) {
    await db.excelTemplate.create({
      data: {
        name: "Cost Template เริ่มต้น",
        description: "แก้ Mapping ให้ตรงกับ Template เดิมขององค์กรได้ที่ Excel Template Manager",
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
    console.log("✓ Cost Template เริ่มต้น");
  }

  console.log("\nระบบพร้อมใช้งานแล้ว — ขั้นต่อไป:");
  console.log("  1. เข้าสู่ระบบด้วยบัญชี Admin");
  console.log("  2. Master Data → นำเข้าจาก Excel  (ดาวน์โหลดแบบฟอร์มแล้วกรอกข้อมูลจริง)");
  console.log("  3. ตั้งค่า → ผู้ใช้งาน  (เพิ่มบัญชีให้ทีม)\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
