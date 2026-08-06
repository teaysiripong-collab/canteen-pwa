# Canteen Management System

ระบบศูนย์กลางบริหารงานแคนทีน — วางแผนเมนู → สูตรอาหาร → BOM → วางแผนสั่งซื้อ → สั่งซื้อ → Stock → เบิกใช้ → ต้นทุน → งานที่มอบหมาย → รายงาน

เป็น Web App แบบ PWA ใช้ได้ทั้ง Desktop / Tablet / Mobile ภาษาไทยเป็นหลัก

---

## 1. หลักการออกแบบ (Design Principle)

แต่ละแนวคิดเป็น **คนละเรื่อง** และเก็บแยกกันในฐานข้อมูล เพื่อให้แก้ไขที่หนึ่งแล้วไม่กระทบทั้งระบบ

| แนวคิด | ความหมาย | ตารางหลัก |
|---|---|---|
| Menu | สิ่งที่จะทำ | `Menu`, `MenuPlan`, `MenuPlanEntry` |
| Recipe | วิธีทำอาหาร | `Recipe`, `RecipeIngredient`, `RecipeStep` |
| BOM | สิ่งที่วางแผนว่าจะใช้ | `BomTemplate`, `BomTemplateItem`, `BomLine` |
| Purchase | สิ่งที่ตัดสินใจว่าจะสั่ง | `PurchaseOrder`, `PurchaseOrderItem` |
| Stock | สิ่งที่มีอยู่จริง | `StockTransaction`, `Lot` |
| Actual Usage | สิ่งที่ใช้จริง | `UsageRecord` |
| Cost | ต้นทุนที่เกิดขึ้น | `ExcelTemplate`, `CostFile` |
| Task | สิ่งที่ต้องมีคนรับผิดชอบ | `Task` |

**กติกาสำคัญ 3 ข้อ**

1. **BOM แยกจาก Stock เด็ดขาด** — BOM ทำล่วงหน้าเป็นสัปดาห์/เดือนได้ ส่วน Stock คือยอดจริง ณ ปัจจุบัน
   ระบบ **ไม่หัก Stock ออกจาก BOM อัตโนมัติ** — Stock แสดงเป็น "ข้อมูลประกอบ" ตอนสั่งซื้อเท่านั้น
   (`PurchaseOrderItem.stockQty` เป็น snapshot อ้างอิง ไม่ใช่ตัวคำนวณบังคับ)
2. **Recipe แยกจาก BOM** — Recipe คือวิธีทำ, BOM คือปริมาณสำหรับวางแผน สูตรหนึ่งมี BOM ได้หลาย Version
3. **Planned แยกจาก Actual** — `BomLine` (แผน) กับ `UsageRecord` (ใช้จริง) เก็บคนละตาราง เพื่อทำ BOM Learning

---

## 2. Workflow หลัก

```
MENU PLANNING (แยกรอบเช้า/ดึก)
   ↓  ระบบดึง BOM มาตรฐานให้อัตโนมัติ
BOM  →  BOM REVIEW
   ↓
PURCHASE PLANNING (รวมตามช่วงวันที่ → Group ตาม Vendor → ตรวจรายการตกหล่น)
   ↓
CONFIRM ORDER  →  RECEIVE  →  STOCK  →  ISSUE  →  ACTUAL USAGE
   ↓
COST / EXCEL  →  REPORT & ANALYTICS

TASK MANAGEMENT ทำงานคู่ขนานกับทุกขั้นตอน
```

**Enter Once — Use Everywhere:** เลือกเมนูครั้งเดียว ระบบเสนอ BOM ให้เอง → BOM ไหลไปเป็นแผนสั่งซื้อ →
ราคาที่จัดซื้อกรอกใน PO ถูกเก็บกลับเข้า `Ingredient.lastPrice` แล้วใช้ประเมิน Cost ต่อทันที
ตอนเบิกของ ถ้าระบุเมนู ระบบบันทึก Actual Usage ให้เอง ไม่ต้องพิมพ์ซ้ำ

---

## 3. Role & Permission Matrix

`view` = ดูอย่างเดียว · `edit` = สร้าง/แก้ไข · `approve` = อนุมัติ · `admin` = จัดการทั้งหมด
เมนูที่ไม่มีสิทธิ์ **จะไม่แสดงในแถบนำทางเลย** (ดูตารางเต็มได้ที่หน้า ตั้งค่า)

| โมดูล | Admin | Manager | Supervisor | Procurement | Store | Staff | Viewer |
|---|---|---|---|---|---|---|---|
| Dashboard | view | view | view | view | view | view | view |
| แผนเมนู | admin | approve | edit | view | view | view | view |
| คลังสูตรอาหาร | admin | view | edit | view | view | view | view |
| BOM | admin | approve | edit | view | view | — | view |
| จัดซื้อ | admin | approve | edit | edit | view | — | view |
| Stock | admin | view | view | view | edit | edit | view |
| ต้นทุน | admin | approve | view | edit | — | — | view |
| งานที่มอบหมาย | admin | edit | edit | edit | edit | edit | view |
| เอกสาร / รายงาน | admin | view | view | view | view | — | view |
| Master Data | admin | view | view | view | — | — | — |
| ตั้งค่า | admin | — | — | — | — | — | — |

ทุกการแก้ไขข้อมูลสำคัญบันทึกใน `AuditLog`: ใครแก้ · แก้อะไร · จากค่าเดิมอะไร · เป็นค่าใหม่อะไร · เมื่อไหร่

---

## 4. Information Architecture

```
/                      Canteen Command Center (drill down ได้ทุกตัวเลข)
/menu-plan             ปฏิทินเมนู จ.–ส. แยกรอบเช้า/ดึก · Draft → ส่งตรวจ → Approved
  /print               ใบเมนู A4 สำหรับใช้หน้างาน
/recipes               คลังสูตร (ค้นหา) → /recipes/[id] → QR → /recipes/menu/[menuId] (เปิดสูตรล่าสุดเสมอ)
/bom                   รวม BOM ตามช่วงวันที่ · แยกเช้า/ดึก/รวม · BOM Learning
  ?entry=<id>          แก้ BOM รายเมนู-รายรอบ
/purchase              รายการใบสั่งซื้อ (กรองตามสถานะ)
  /plan                วางแผนสั่งซื้อจาก BOM → Group ตาม Vendor
  /[id]                ตาราง BOM/Stock/แนะนำ/สั่งจริง · Validation · รับของ
/stock                 ยอดคงเหลือ + ของอยู่ที่ไหน
  /issue /receive /transfer /adjust /history /expiry
/cost                  ต้นทุนตามแผน vs ใช้จริง · สร้าง Excel Working File
/tasks                 Kanban (ลาก-วางได้) · Today/Tomorrow/Week/Overdue/My Tasks
/documents             Document Center รวมเอกสารทุกประเภท
/reports               รายงานที่ตอบคำถามหน้างานจริง
/master                Ingredient / Menu / Vendor / Location / Unit / Category / User
/master/import         นำเข้าข้อมูลหลักจาก Excel (มีโหมดตรวจสอบก่อนบันทึก)
/settings              ผู้ใช้ · Permission Matrix · Activity Log
  /excel-template      Excel Template Manager (แก้ Mapping ได้โดยไม่แก้โค้ด)
  /sheets              Google Sheets — ซิงก์ข้อมูลทั้งระบบ 15 แท็บ
  /drive               Google Drive — Template และไฟล์ต้นทุน
/search?q=             Global Search
/notifications         แจ้งเฉพาะสิ่งที่ต้อง Action
```

---

## 5. Validation & Error Handling

**Purchase** — ตรวจก่อน Confirm Order แต่ **ไม่ Block**: Supervisor override ได้พร้อมระบุเหตุผล (เก็บใน `overrideReason` + Audit Log)
- วัตถุดิบจาก BOM ที่ยังไม่ได้สั่ง (บอกชื่อรายการที่ขาด)
- สั่งน้อยกว่า / มากกว่า BOM · จำนวนเป็น 0 · Vendor ยังไม่กำหนด

**Stock** — เบิกเกินยอดคงเหลือของ Location นั้นจะถูกปฏิเสธพร้อมบอกว่า *ของอยู่ที่ไหน*
(กันเลือก Location ผิด) หากของจริงมีแต่ระบบยังไม่ตรง ติ๊ก "ยืนยันเบิกเกินยอด" เพื่อบันทึกได้ และถูกบันทึกเป็น `OVERRIDE` ใน Audit Log
ปรับ Stock (`Adjustment`) **ต้องระบุเหตุผลเสมอ**

ข้อความ validation ถูกส่งกลับเป็น state (ไม่ใช่ throw) เพื่อให้แสดงถึงผู้ใช้ได้จริงบน production
และค่าที่กรอกไว้จะถูกคืนกลับฟอร์ม — กรอกใหม่ไม่หาย

---

## 6. Data Safety

- **Soft delete** — Master data ใช้ `active = false` ไม่ลบจริง
- **ไม่ลบ Transaction** — Stock ใช้ระบบบัญชีเดินสะพัด (ledger) การแก้ยอดคือการเพิ่มรายการปรับ ไม่ใช่ลบของเดิม
- **Audit Log** ทุกการแก้ไขสำคัญ · **Activity Log** ดูย้อนหลังได้ที่หน้าตั้งค่า
- **PWA + Service Worker** — API ไม่ถูก cache (ข้อมูลไม่ค้าง), หน้าเว็บมี offline fallback
- **Backup**: `pg_dump -Fc canteen > backup.dump`

---

## 7. Tech Stack

- **Next.js 15** (App Router, Server Actions) + **React 19** + **TypeScript**
- **PostgreSQL** + **Prisma** (Foreign Key, Index, Transaction, `Decimal` สำหรับปริมาณ/ราคา)
- **Tailwind CSS 4** — Modern/Japanese Corporate, minimal, ปุ่มใหญ่, mobile-first
- **jose** (JWT session, httpOnly cookie) + **bcryptjs** · RBAC ใน `src/lib/rbac.ts`
- **ExcelJS** (Import/Export) · **qrcode** (QR สูตรอาหาร) · PDF ผ่าน Print A4 (`@media print`)
- **googleapis** — Google Sheets (ซิงก์ข้อมูล) และ Google Drive (Template/ไฟล์ต้นทุน)
- Build เป็น **standalone** (`npm start` = `node .next/standalone/server.js`) พร้อมลง Docker/Cloud Run

---

## 8. เริ่มต้นใช้งาน

### ใช้งานจริง — ระบบเปล่า ไม่มีข้อมูลตัวอย่างปน

```bash
npm install
cp .env.example .env                 # แก้ DATABASE_URL และ AUTH_SECRET
npm run db:push                      # สร้างตารางตาม schema
ADMIN_PASSWORD="รหัสผ่านที่ปลอดภัย" npm run db:seed
npm run build && npm start
```

`db:seed` สร้างเฉพาะ **บัญชี Admin + หน่วยนับ + หมวดหมู่พื้นฐาน** เท่านั้น
(ปฏิเสธรหัสผ่านที่สั้นกว่า 8 ตัว และไม่ยอมรันถ้าไม่กำหนดรหัสผ่าน)

จากนั้นใส่ข้อมูลจริงผ่าน **Master Data → นำเข้าจาก Excel** (ข้อ 11) หรือแก้ใน **Google Sheets** (ข้อ 12)

**Deploy บน Google Cloud:** ดู [`docs/DEPLOY_GOOGLE_CLOUD.md`](docs/DEPLOY_GOOGLE_CLOUD.md)
— Cloud Run + Cloud SQL พร้อม backup อัตโนมัติ มี `Dockerfile` ให้แล้ว

### ทดลองดูระบบพร้อมข้อมูลตัวอย่าง

```bash
npm run db:seed:demo        # เมนู สูตร BOM Vendor Stock งาน (ข้อมูลสมมติ)
npm run dev
```

ผู้ใช้ตัวอย่างรหัสผ่าน `1234` ทั้งหมด: `admin` `manager` `supervisor` `procurement`
`store` `staff1` `staff2` `viewer`

> ⚠️ `db:seed:demo` มีไว้สำหรับทดลอง/ทดสอบเท่านั้น **ห้ามรันบนฐานข้อมูลจริง**

---

## 9. ทดสอบ

```bash
npm run typecheck
npm run lint
npm run build

npm start &                                             # ต้องรันแอปก่อน
CHROMIUM_PATH=/path/to/chromium npm run test:e2e        # 51 checks (ใช้ข้อมูล demo)
CHROMIUM_PATH=/path/to/chromium npm run test:e2e:fresh  # 24 checks (ระบบเปล่า)
```

* `tests/e2e.mjs` — workflow จริงทั้งหมดบนข้อมูล demo: drill-down จาก Dashboard,
  อนุมัติแผนเมนู, BOM แยกกะ + BOM Learning, สูตรอาหารบนมือถือ, เบิกของแบบ FEFO
  (รวมกรณีเบิกเกินยอด), วางแผนสั่งซื้อ + Validation, Kanban งาน, Cost + Export Excel,
  รายงาน, Global Search และสิทธิ์ของทุก Role
* `tests/e2e-fresh.mjs` — ระบบเปล่าหลัง `db:seed`: ทุกหน้าเปิดได้โดยไม่มีข้อมูลตัวอย่าง,
  Google Drive แจ้งสถานะอย่างสุภาพเมื่อยังไม่ตั้งค่า, และการนำเข้า Excel ครบวงจร
  (ตรวจสอบ → บันทึกจริง → เห็นใน Master Data → ถูกบันทึกใน Audit Log)

---

## 10. Excel Cost Workflow

องค์กรมี Excel Template เดิมอยู่แล้ว ระบบจึง **ไม่บังคับให้เลิกใช้ Excel**

```
Admin กำหนด Mapping (field → column)  ที่ /settings/excel-template
   ↓
ระบบเติมข้อมูล Menu + BOM ลงคอลัมน์ตามที่กำหนด และเว้นช่องราคาให้จัดซื้อ (ไฮไลต์สีเหลือง)
   ↓
จัดซื้อกรอกราคา → สูตรใน Excel คำนวณ Cost ตามรูปแบบเดิม
```

Mapping เก็บเป็น JSON ใน `ExcelTemplate.mappingJson` — **เปลี่ยน Template ได้โดยไม่ต้องแก้ Source Code**

```json
[
  { "field": "menuName", "column": "C", "label": "เมนู" },
  { "field": "qty",      "column": "E", "label": "ปริมาณ (BOM)" },
  { "field": "price",    "column": "G", "label": "ราคา/หน่วย" },
  { "field": "amount",   "column": "H", "label": "รวมเงิน", "formula": "E*G" }
]
```

---

## 11. นำเข้าข้อมูลจริง (Master Data Import)

ไม่ต้องพิมพ์วัตถุดิบทีละรายการ — กรอกลงแบบฟอร์ม Excel แล้วอัปโหลดครั้งเดียว

**Master Data → นำเข้าจาก Excel** (หรือ `/master/import`)

1. กด **ดาวน์โหลดแบบฟอร์ม** จะได้ไฟล์ที่มีชีตและหัวตารางครบพร้อมคำอธิบาย
2. กรอกข้อมูลจริง — ชีตไหนยังไม่มีข้อมูล ข้ามไปก่อนได้
3. อัปโหลดโดยติ๊ก **"ตรวจสอบอย่างเดียว"** เพื่อดูผลก่อน
4. ถ้าไม่มีปัญหา เอาเครื่องหมายออกแล้วนำเข้าจริง

ชีตที่รองรับ (นำเข้าตามลำดับนี้เพราะข้อมูลอ้างอิงกัน):

`หน่วยนับ` → `หมวดหมู่` → `ผู้ขาย` → `สถานที่จัดเก็บ` → `วัตถุดิบ` → `เมนู` → `BOM มาตรฐาน`

* **รหัสซ้ำ = อัปเดตของเดิม** ไม่สร้างซ้ำ — อัปโหลดไฟล์เดิมซ้ำได้อย่างปลอดภัย
* **มีแถวผิด = ไม่บันทึกทั้งไฟล์** (ทั้งหมดหรือไม่ทำเลย) พร้อมบอกว่าแถวไหนผิดเพราะอะไร
* นำเข้าจากไฟล์ในเครื่อง หรือเลือกไฟล์จาก Google Drive ก็ได้
* ทุกการนำเข้าถูกบันทึกใน Activity Log

---

## 12. Google Sheets — ฐานข้อมูลที่เปิดดูได้

**ตั้งค่า → Google Sheets** (หรือ `/settings/sheets`)

ข้อมูลทั้งระบบถูกเขียนลง Google Sheets ของคุณ **15 แท็บ** เปิดดู กรอง ทำ Pivot ทำกราฟ
และแชร์ได้เหมือนชีตทั่วไป กด **"สร้างไฟล์ใหม่ให้เลย"** ระบบจะสร้างไฟล์ ใส่ทุกแท็บ
พร้อมข้อมูลปัจจุบัน และผูกให้อัตโนมัติ

**แท็บที่แก้ใน Sheets ได้ (ข้อมูลหลัก)** — แก้แล้วกด "ดึงข้อมูลเข้าระบบ"

`หน่วยนับ` `หมวดหมู่` `ผู้ขาย` `สถานที่จัดเก็บ` `วัตถุดิบ` `เมนู` `BOM มาตรฐาน`

ผ่านการตรวจสอบด้วยกฎเดียวกับการนำเข้า Excel — มีโหมดตรวจสอบก่อนบันทึก,
รหัสซ้ำ = อัปเดตของเดิม, แถวผิด = ไม่บันทึกทั้งหมด และรายงานเป็น **ชื่อแท็บ + เลขแถวตรงกับที่เห็นใน Sheets**

**แท็บที่ระบบเขียนให้ (อ่านอย่างเดียว)**

`แผนเมนู` `BOM รายวัน` `ใบสั่งซื้อ` `Stock คงเหลือ` `ประวัติ Stock` `การใช้จริง` `งานที่มอบหมาย` `Audit Log`

### ทำไมยอด Stock ถึงบันทึกผ่านระบบ ไม่ใช่พิมพ์ใน Sheets

Google Sheets API ไม่มี **transaction** และไม่มี **row lock** ถ้าพนักงาน 2 คนกดเบิกของ
พร้อมกันตอนรอบเช้า การเขียนของคนหลังจะทับของคนแรก — ยอดที่หายไปจะไม่มีใครรู้
เพราะไม่มี error ขึ้นเลย (last-write-wins)

ระบบจึงบันทึกรายการ เบิก/รับ/โอน/ปรับ ลง PostgreSQL ที่รับประกันว่าทุกธุรกรรมไม่ชนกัน
แล้ว**สะท้อนผลขึ้น Sheets ให้เห็นครบทุกแถว** — คุณยังเปิด Sheets แล้วเห็นยอดจริง
ประวัติการเบิก และ Audit Log ได้ทั้งหมด

ส่วนข้อมูลหลักแก้ใน Sheets ได้เต็มที่ เพราะไม่ใช่ข้อมูลที่หลายคนแก้พร้อมกันตลอดเวลา
และมีการตรวจสอบก่อนบันทึกทุกครั้ง

---

## 13. Google Drive (ไม่บังคับ)

**ตั้งค่า → Google Drive** (หรือ `/settings/drive`) ทำได้เมื่อองค์กรอยากให้ไฟล์ไปอยู่ใน Drive ที่ใช้กันอยู่แล้ว

* อ่าน **Excel Template เดิม** จากโฟลเดอร์ Drive แล้ว**เดา Mapping จากหัวตารางให้อัตโนมัติ**
  (ไม่ต้องพิมพ์ Mapping เองตั้งแต่ต้น — ตรวจและแก้ทีหลังได้)
* ส่ง **Cost Working File** ขึ้นโฟลเดอร์ Drive อัตโนมัติ ฝ่ายจัดซื้อกรอกราคาได้จาก Drive โดยตรง
* นำเข้าข้อมูลหลักจากไฟล์ที่อยู่บน Drive

การตั้งค่า (ทำครั้งเดียว):

1. Google Cloud Console → เปิดใช้ **Google Drive API** → สร้าง **Service Account**
2. ใส่ JSON key ใน `GOOGLE_SERVICE_ACCOUNT_KEY`
   (บน Cloud Run ผูก Service Account กับ service ได้เลย ไม่ต้องใช้ key)
3. ใน Drive **แชร์โฟลเดอร์ (หรือไฟล์ Google Sheets) ให้อีเมลของ Service Account สิทธิ์ Editor**
4. วาง Folder ID ในหน้าตั้งค่า แล้วกด **ทดสอบการเชื่อมต่อ**

Credential ชุดเดียวกันใช้ได้ทั้ง Google Drive และ Google Sheets
(ขอ scope `drive.file` + `spreadsheets`)

> ระบบขอสิทธิ์เฉพาะ `drive.file` — เข้าถึงได้เฉพาะไฟล์ที่ระบบสร้างเองและโฟลเดอร์ที่คุณแชร์ให้
> **ไม่เห็น Google Drive ทั้งหมดของคุณ**
>
> ถ้าไม่ตั้งค่า ระบบทำงานได้ครบทุกอย่างตามปกติ เพียงแต่ใช้ปุ่มดาวน์โหลด/อัปโหลดเองแทน

---

## 14. Phase ถัดไป

Smart Assistant เป็น **Decision Support** ไม่ใช่ผู้ตัดสินใจแทนคน — BOM Learning ที่มีอยู่แล้ว
ทำงานตามหลักนี้ (เสนอค่า แต่ต้องให้หัวหน้ายืนยันก่อนเสมอ) ส่วนที่ขยายต่อได้:
Forecast ปริมาณ · ตรวจจับจำนวนผิดปกติ · แนะนำเมนูจากวัตถุดิบค้าง Stock · รองรับหลายภาษา · เพิ่มรอบเวลานอกเหนือเช้า/ดึก
