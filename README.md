# Canteen ERP — System of Record

ระบบบริหารโรงอาหาร (Canteen ERP) สำหรับบริหารหลายจุดให้บริการ โดยมี **ฐานข้อมูล PostgreSQL เป็นแหล่งข้อมูลจริงเพียงแห่งเดียว** (System of Record) — Google Sheets เป็นเพียงปลายทางของรายงานและการส่งออกข้อมูลเท่านั้น

Mobile-first สำหรับพนักงานหน้างาน และมี Desktop Control Center สำหรับหัวหน้าแผนก/ผู้ดูแลระบบ

> **สถานะปัจจุบัน: Phase 1 — Foundation เสร็จแล้ว และรันได้จริง**
> Phase 2–6 (เมนู/BOM, สต๊อก, จัดซื้อ, ต้นทุน, แดชบอร์ด+Google Sheets) ยังไม่ได้ implement — เมนูที่ยังไม่เปิดใช้งานจะแสดงป้าย `P2`–`P6` ใน Sidebar

---

## 1. Architecture

```
Browser (Thai UI, mobile-first)
        │
        ▼
Next.js App Router  ── Server Components สำหรับอ่านข้อมูล
        │            └ Server Actions สำหรับเขียนข้อมูล
        ▼
src/features/*/actions.ts   ← validate ด้วย Zod, แปลง error เป็นข้อความไทย
        ▼
src/services/*              ← business logic + ตรวจสอบสิทธิ์ฝั่ง server + audit log + DB transaction
        ▼
src/repositories/*          ← query ล้วนๆ (ไม่มี business logic)
        ▼
src/database/*              ← Drizzle schema + migrations + seed
        ▼
PostgreSQL (Supabase)
```

หลักการที่ยึดไว้ทั้งระบบ:

- **Business logic ไม่อยู่ใน UI** — component ทำหน้าที่แสดงผลและรับ input เท่านั้น
- **Authorization ตรวจที่ server เสมอ** — client แค่ซ่อนปุ่ม (`requirePermission()` ในทุก service ที่เขียนข้อมูล)
- **ทุกการเปลี่ยนแปลงข้อมูลสำคัญอยู่ใน DB transaction เดียวกับ audit log** — ถ้าขั้นตอนใดล้ม จะ rollback ทั้งหมด
- **ไม่ hard delete ข้อมูลธุรกิจ** — ใช้ `is_active` / สถานะ `CANCELLED` แทน
- **ไม่แสดง raw database error ให้ผู้ใช้** — ทุก error ผ่าน `AppError` ที่มีข้อความภาษาไทย

### ทำไมเลือก Drizzle ORM (ไม่ใช่ Prisma)

1. **SQL-first** — ระบบนี้ต้องใช้ `SELECT ... FOR UPDATE`, partial index, CHECK constraint และ query รวมยอด ledger ที่ซับซ้อน Drizzle เขียน SQL เหล่านี้ได้ตรงไปตรงมาโดยไม่ต้องหนีไป raw query
2. **CHECK / unique constraint อยู่ในไฟล์ schema เดียวกับ TypeScript** — กติกาอย่าง "สต๊อกห้ามติดลบ" ถูกบังคับที่ระดับฐานข้อมูล ไม่ใช่แค่ใน application
3. **ไม่มี engine binary** — deploy บน Vercel serverless ได้เบาและ cold start เร็วกว่า
4. **Transaction API ที่ส่ง executor ต่อได้** — service function รับ `DbExecutor` จึงประกอบเป็น transaction ใหญ่ได้ (จำเป็นมากสำหรับ Receiving / Issue / Transfer ใน Phase 3–4)

---

## 2. Tech Stack

| ส่วน | เทคโนโลยี |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript (strict) |
| Styling | Tailwind CSS v4 + design tokens ใน `globals.css` |
| UI | Component library ของโปรเจกต์เอง (`src/components/ui`) สไตล์ shadcn/ui + Radix primitives |
| Backend | Next.js Server Actions / Server Components |
| Database | PostgreSQL (Supabase) |
| ORM | Drizzle ORM + drizzle-kit |
| Auth | Supabase Auth (มี dev sign-in สำหรับ local) |
| Validation | Zod |
| Table | TanStack Table |
| Test | Vitest |
| Deploy | Vercel |

---

## 3. Setup

```bash
git clone <repo> && cd canteen-pwa
npm install
cp .env.example .env.local     # แล้วกรอกค่าจริง
npm run db:migrate             # สร้างตารางทั้งหมด
npm run db:seed                # ใส่ข้อมูลตัวอย่างสำหรับ development
npm run dev                    # http://localhost:3000
```

ตรวจว่าระบบพร้อมใช้งานด้วย health check — คืน `503` เมื่อฐานข้อมูลตอบไม่ได้ ใช้เป็น probe ตอน deploy ได้เลย

```bash
curl http://localhost:3000/api/health
# {"status":"ok","database":"up","latencyMs":2,"timestamp":"..."}
```

### Environment variables

| ตัวแปร | จำเป็น | คำอธิบาย |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | PostgreSQL connection string (Supabase pooler หรือ Postgres local) |
| `NEXT_PUBLIC_SUPABASE_URL` | production | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ภายหลัง | ใช้ตอน provision ผู้ใช้ |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_SHEET_ID` | Phase 6 | Google Sheets export |
| `ALLOW_DEV_AUTH` | local เท่านั้น | `true` = เข้าสู่ระบบด้วยอีเมลอย่างเดียว |

**`ALLOW_DEV_AUTH` ถูกปิดตายเมื่อ `NODE_ENV=production`** — ตรวจสอบใน `src/lib/supabase/config.ts` จึงไม่มีทางกลายเป็นช่องโหว่บน production

ห้าม commit ค่า secret จริง — `.env.local` อยู่ใน `.gitignore` แล้ว

### บัญชีตัวอย่างจาก seed (development เท่านั้น)

| อีเมล | Role |
| --- | --- |
| `admin@canteen.local` | ADMIN — ผู้ดูแลระบบ |
| `manager@canteen.local` | MANAGER — ผู้จัดการโรงอาหาร |
| `store@canteen.local` | STORE — พนักงานคลัง |
| `staff@canteen.local` | STAFF — พนักงานหน้างาน |

`npm run db:seed` รันซ้ำได้และ **converge** — บัญชีตัวอย่างเก่า (`@canteen.local`) ที่ไม่อยู่ในรายการนี้ และ role/meal period ที่ถูกถอดออกจาก catalogue จะถูกลบทิ้ง

### คำสั่งที่ใช้บ่อย

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run test         # Vitest (unit — ไม่ต้องมีฐานข้อมูล)
npm run test:integration  # Vitest (integration — ต้องมี DATABASE_URL + seed แล้ว)
npm run db:generate  # สร้าง migration ใหม่จาก schema
npm run db:migrate   # รัน migration
npm run db:seed      # seed ข้อมูล development (รันซ้ำได้ ไม่สร้างข้อมูลซ้ำ)
npm run db:studio    # Drizzle Studio
```

---

## 4. Folder structure

```
src/
  app/
    (auth)/login/          หน้าเข้าสู่ระบบ + server action
    (app)/                 พื้นที่ที่ต้องล็อกอิน (app shell: sidebar + bottom nav)
      dashboard/           หน้าหลัก (mobile home + desktop dashboard)
      items/ locations/ suppliers/   ข้อมูลหลัก
      audit-log/
  components/
    ui/                    Design system (Button, Field, Card, DataTable, StatusBadge, ...)
    layout/                Sidebar, MobileHeader, DesktopHeader, BottomNavigation
  features/master-data/    ฟอร์มและ server actions ของข้อมูลหลัก
  services/                business logic + permission check + audit + transaction
  repositories/            data access ล้วนๆ
  schemas/                 Zod schema (ข้อความ error เป็นภาษาไทย)
  lib/                     permissions, quantity, units, fefo, errors, auth, supabase
  config/                  navigation
  database/                schema/ migrations/ client.ts migrate.ts seed.ts
```

---

## 5. Permission model

Role เป็นเพียง "ชุดของ permission" — ระบบตรวจสิทธิ์จาก permission code เท่านั้น (`src/lib/permissions.ts`)

| Role | ทำอะไรได้ |
| --- | --- |
| **STAFF** (พนักงานหน้างาน) | ดูข้อมูลหลัก/สต๊อก, รับของ, เบิกของ, โอนของ |
| **STORE** (พนักงานคลัง) | + ปรับปรุงสต๊อก, แก้จำนวนตอนเบิก, ตรวจนับ, ดูใบสั่งซื้อ, ดูรายงาน |
| **MANAGER** (ผู้จัดการโรงอาหาร) | + จัดการวัตถุดิบ/เมนู/BOM, PO และการอนุมัติ, ดูต้นทุน, override FEFO |
| **ADMIN** (ผู้ดูแลระบบ) | ทุกสิทธิ์ รวมถึงจัดการผู้ใช้และการตั้งค่า |

`user.manage` เป็นสิทธิ์ของ ADMIN เท่านั้น — หน้า `/users` ตรวจสิทธิ์ที่ฝั่ง server ก่อน render และ service ตรวจซ้ำก่อนเขียนทุกครั้ง

ทุก service ที่เขียนข้อมูลเรียก `requirePermission(PERMISSIONS.X)` ก่อนเสมอ ถ้าไม่มีสิทธิ์จะได้ `AppError("FORBIDDEN")` → หน้าจอแสดง "คุณไม่มีสิทธิ์ทำรายการนี้"

Seed จะ sync ตาราง `permissions` / `role_permissions` ให้ตรงกับ code catalogue ทุกครั้งที่รัน

---

## 6. Inventory ledger concept

ระบบ **ไม่เก็บแค่ยอดคงเหลือปัจจุบัน** แต่ใช้หลัก ledger:

```
inventory_postings       ← 1 การกระทำของผู้ใช้ = 1 posting (มี idempotency key)
inventory_transactions   ← append-only ทุกการเคลื่อนไหว (RECEIVE / ISSUE / TRANSFER_OUT / ...)
                            ห้าม UPDATE หรือ DELETE — ถ้าผิดให้ออกรายการกลับรายการ
stock_balances           ← ยอดคงเหลือรายลอต × สถานที่ (อัปเดตใน transaction เดียวกับ ledger)
inventory_lots           ← ลอตที่รับเข้ามา พร้อมต้นทุนต่อหน่วยและวันหมดอายุ
```

- ทุกแถวใน ledger เก็บ `who / when / item / lot / location / qty / reference document`
- `stock_balances` มี CHECK `base_qty >= 0` — **สต๊อกติดลบจาก race condition เป็นไปไม่ได้ที่ระดับฐานข้อมูล** ถ้าเบิกเกินจะได้ข้อความ "จำนวนที่ต้องการเบิกมากกว่าสต๊อกคงเหลือ" พร้อมจำนวนที่มีจริง
- จำนวนทุกค่าเก็บเป็น `numeric(18,4)` และคำนวณด้วยจำนวนเต็ม scale 10⁴ ใน `src/lib/quantity.ts` เพื่อไม่ให้เกิด floating point drift

### เอกสารกับ ledger ต้องอยู่ใน transaction เดียวกัน

`postMovement()` รับ `executor` เพิ่มได้ เพื่อให้ workflow ที่อยู่ใน transaction อยู่แล้ว (เช่นการรับของที่ต้องเขียนใบรับ + รายการ + ลอต + ledger) ส่งตัว transaction ของตัวเองเข้าไปใช้ร่วมกัน

ถ้าไม่ทำแบบนี้ การเรียก `db.transaction()` ซ้อนจากข้างในจะไปหยิบ **connection คนละตัว** จาก pool ทำให้เอกสารกับ ledger commit แยกกันได้ — เกิดใบรับที่ไม่มีของเข้าสต๊อก หรือของเข้าสต๊อกที่ไม่มีเอกสาร

### `postMovement` — ทางเดียวที่สต๊อกจะขยับได้

`src/services/inventory-ledger-service.ts` เป็น **จุดเดียว** ที่เขียน `inventory_transactions` และ `stock_balances` ได้ ทุก workflow (รับ/เบิก/โอน/ปรับปรุง/ตรวจนับ) ต้องเรียกผ่านฟังก์ชันนี้

หนึ่งครั้งที่เรียก = หนึ่ง database transaction ที่ทำตามลำดับนี้

1. ตรวจสิทธิ์จาก **ชนิดของรายการ** (`RECEIVE` ต้องมี `receive.create`, `ISSUE` ต้องมี `issue.create`, ...) — สิทธิ์อยู่ในตัว engine ไม่ใช่แค่ที่หน้าจอ
2. จอง `idempotency_key` — ถ้าคีย์นี้เคยใช้แล้วจะคืน posting เดิมโดย **ไม่ตัดสต๊อกซ้ำ** (กันกดปุ่มสองครั้ง / เน็ตกระตุก / กด refresh)
3. `SELECT ... FOR UPDATE` แถว balance ที่เกี่ยวข้อง เรียงลำดับคงที่เพื่อกัน deadlock
4. ตรวจว่าเบิกไม่เกินของที่มี แล้วเขียน balance แบบ **relative** (`base_qty + delta`) จึงถูกต้องแม้มีคนสร้างแถวเดียวกันพร้อมกัน
5. เขียน ledger + audit log ในธุรกรรมเดียวกัน — ถ้าขั้นตอนใดล้ม จะ rollback ทั้งหมด

ทิศทาง (IN/OUT) เก็บไว้ในคอลัมน์ `direction` เพราะมีสองชนิดที่บอกทิศจากชื่อไม่ได้ คือ `REVERSAL` (ทิศตรงข้ามกับรายการที่กลับ) และ `STOCK_COUNT_ADJUSTMENT` (ขึ้นกับผลนับ) ส่วนชนิดอื่นทั้งหมด service เป็นคนกำหนดจาก `directionOfType()` และมีเทสบังคับไว้

**กลับรายการ (reversal)** — `reversePosting()` จะสร้าง posting ใหม่ที่มีแถวตรงข้ามกับของเดิมทุกแถว โดย **ไม่แตะของเดิมเลย** กลับรายการซ้ำไม่ได้ และถ้าของถูกเบิกไปใช้แล้วจนกลับรายการไม่ได้ ระบบจะปฏิเสธพร้อมบอกยอดคงเหลือ

## 7. FEFO concept

`src/lib/fefo.ts` — First Expired First Out

1. เรียงลอตตาม **วันหมดอายุที่ใกล้ที่สุดก่อน** (ลอตที่ไม่มีวันหมดอายุอยู่ท้ายสุด)
2. เท่ากันให้ใช้วันที่รับเข้าเก่ากว่าก่อน แล้วจึงเรียงตาม lot id เพื่อให้ผลลัพธ์คงที่
3. ตัดยอดทีละลอตจนครบจำนวนที่ขอ — ไม่ตัดเกินยอดที่ลอตมี
4. ถ้าของไม่พอ จะคืนค่า `shortfallBaseQty` ให้ผู้เรียกปฏิเสธรายการ (ไม่ปล่อยให้ติดลบ)

`planFefoAllocation()` อ่านลอตที่มีของจริงจาก `stock_balances` แล้วเสนอแผนเบิก ถ้าของไม่พอจะคืน `shortfallBaseQty` ให้ผู้เรียกปฏิเสธรายการ และ `toMovementLines()` แปลงแผนเป็น line ที่ `postMovement()` รับได้ทันที

**ของที่หมดอายุแล้วจะไม่ถูกเสนอ** — FEFO เอาของที่หมดอายุก่อนขึ้นก่อนก็จริง แต่ของที่เลยวันหมดอายุไปแล้วถูกกันออกจากแผนทั้งหมด เพราะในโรงอาหารของหมดอายุต้องตัดเป็นของเสีย ไม่ใช่เอาไปปรุง ระบบรายงานจำนวนนั้นแยกเป็น `expiredBaseQty` เพื่อให้หน้าจออธิบายได้ว่าทำไมของบนชั้นกับของที่เบิกได้ไม่เท่ากัน

**FEFO override** — MANAGER ที่มีสิทธิ์ `fefo.override` เลือกลอตเองได้ผ่าน `planManualAllocation()` ซึ่งตรวจว่าลอตที่เลือกมีของพอจริง และตั้ง `overridesFefo` เมื่อการเลือกนั้น *ข้ามลอตที่ควรใช้ก่อน* (ถ้าเลือกตรงกับที่ FEFO เสนออยู่แล้วจะไม่นับเป็น override) เพื่อให้ตอน post บันทึก audit ได้ตรงความจริง

### วันที่ทางธุรกิจใช้เวลาไทย

เซิร์ฟเวอร์รันเป็น UTC ถ้าใช้ `new Date()` ตรงๆ วันจะข้ามตั้งแต่ 17:00 น. เวลาไทย ทำให้ของถูกตีว่าหมดอายุเร็วไปหนึ่งกะ และรายการของกะดึกไปตกวันผิด `src/lib/date.ts` จึงคำนวณวันด้วยโซนเวลา `Asia/Bangkok` และ query วันหมดอายุส่งวันที่เข้าไปเป็นพารามิเตอร์ แทนการใช้ `current_date` ของฐานข้อมูลซึ่งเป็น UTC

### แจ้งเตือนหมดอายุ

`getExpiryAlerts()` จัดกลุ่มลอตเป็น หมดอายุแล้ว / หมดอายุวันนี้ / ตามเกณฑ์วันที่ตั้งไว้ เกณฑ์อ่านจาก `app_settings.expiry_alert_days` (default 1 / 3 / 7 วัน) แก้ได้โดยไม่ต้อง deploy หน้า `/inventory/expiry` และแดชบอร์ดอ่านจากฟังก์ชันเดียวกัน

## 8. Receiving (รับสินค้า)

`createGoodsReceipt()` เขียนทุกอย่างใน transaction เดียว — ใบรับ, รายการ, ลอตต่อรายการที่รับจริง, และ ledger `RECEIVE` ถ้าพลาดตรงไหนก็ไม่มีของค้างครึ่งๆ กลางๆ

- **หน่วยซื้อ → หน่วยสต๊อก** — กรอก 3 แผง ระบบเก็บ 90 ฟอง และแปลงราคา 128 บาท/แผง เป็นทุน 4.2667 บาท/ฟอง เพราะ ledger กับรายงานต้นทุนใช้หน่วยหลักเสมอ
- **ของที่ไม่รับ** — ยังอยู่บนเอกสารพร้อมสาเหตุ (ของขาด/เสียหาย/ส่งผิด/ส่งเกิน) แต่ **ไม่เข้าสต๊อก** ใบเอกสารจึงตรงกับที่ผู้ขายส่งมาจริง ส่วนยอดคงเหลือตรงกับของบนชั้น
- **ปฏิเสธทั้งรายการ** — ไม่สร้างลอตและไม่มี ledger เลย แต่ยังบันทึกไว้บนเอกสาร
- **วันหมดอายุ** — เติมอัตโนมัติจากอายุการเก็บของวัตถุดิบ ผู้รับแก้ตามที่พิมพ์บนกล่องได้
- **กดซ้ำไม่รับซ้ำ** — ฟอร์มสร้าง idempotency key ตอนเปิดหน้า ส่งซ้ำจะได้ใบเดิมกลับมา
- **ราคาล่าสุด** — อัปเดต `supplier_items.last_price` ให้อัตโนมัติเพื่อใช้ใน PO และการเทียบราคา

เลขที่เอกสารเป็น `GR-YYYYMMDD-NNN` ต่อวัน ใช้ prefix จาก `app_settings.document_prefixes` ถ้าสองคนกดยืนยันพร้อมกันจนได้เลขชนกัน ระบบจะ retry ทั้ง transaction ใหม่ (retry ต้องอยู่**นอก** transaction เพราะ Postgres จะ abort ทั้ง transaction เมื่อมี statement ล้ม)

## 9. Transfer (โอนสินค้า)

`createStockTransfer()` โอนของระหว่างสถานที่ โดยเขียน **ทั้งสองขาไว้ใน posting เดียว** — `TRANSFER_OUT` ที่ต้นทางและ `TRANSFER_IN` ที่ปลายทางใช้ reference เดียวกัน จึงไม่มีทางที่ขาใดขาหนึ่งจะหลุดหายหรือถูกกระทบยอดแยกกัน

- **เลือกลอตด้วย FEFO** และคำนวณ**ภายใน transaction เดียวกับที่ post** ยอดต้นทางจึงถูกอ่านใต้ล็อกเดียวกับที่ posting ใช้ คนอื่นเบิกของแทรกระหว่างวางแผนกับบันทึกไม่ได้
- **ลอตเดินทางไปด้วย** ของที่ปลายทางยังคงเลขลอตและวันหมดอายุเดิม ทำให้ FEFO ที่ปลายทางยังถูกต้อง
- **ต้นทางติดลบไม่ได้** ถ้าของไม่พอจะปฏิเสธทั้งใบพร้อมบอกว่าโอนได้เท่าไร (และถ้ามีของหมดอายุกันอยู่ จะบอกด้วยว่าโอนไม่ได้เท่าไร)
- **ยอดก่อน–หลัง** `previewTransfer()` แสดงยอดทั้งต้นทางและปลายทางก่อนกดยืนยัน เป็น read-only ไม่แตะสต๊อก

รายละเอียดว่าลอตไหนถูกโอนไปเท่าไร อ่านได้จาก ledger ผ่าน posting ของใบโอนนั้น — ตัวเอกสารเก็บระดับวัตถุดิบ ไม่เก็บซ้ำ

## 10. Menu + BOM (สูตรอาหาร)

BOM คือหัวใจของการเบิกและการคำนวณต้นทุน ระบบเก็บเป็น **เวอร์ชัน** เสมอ

### สัญกรณ์ `30+20`

ครัวเขียนบนกระดาษว่า `30+20` หมายถึง **เช้า 30 / ดึก 20** ระบบรับรูปแบบนี้ตรงๆ แล้วแตกเป็นตัวเลขต่อมื้อ

- ค่าที่พิมพ์จะ map เข้ากับมื้อ **ตามลำดับ** ที่ตั้งไว้ (seed คือ DAY แล้ว NIGHT)
- พิมพ์ตัวเดียว เช่น `30` = มื้อแรก 30 มื้อที่เหลือ 0
- รองรับทศนิยม (`2.5+1.5`) และมื้อที่สามขึ้นไปถ้าตั้งค่าไว้ (`10+20+5`)
- พิมพ์ค้าง เช่น `30+` จะไม่ถูกอ่านเป็น 0 แต่ขึ้น error ให้แก้
- หน้าจอแสดง **preview แบบมีโครงสร้าง** ทันที (เช้า 30 · ดึก 20 · รวม 50) เพื่อให้เห็นว่าระบบเข้าใจตรงกันก่อนบันทึก

จำนวนต่อมื้อเก็บใน `recipe_item_period_quantities` (ผูกกับ `meal_periods`) **ไม่ใช่คอลัมน์ day/night** เพราะมื้ออาหารเป็นข้อมูลตั้งค่าได้ — ถ้าโรงอาหารเพิ่มกะที่สาม ก็เพิ่มแถว ไม่ต้อง migrate

`recipe_items.quantity` เก็บ**ยอดรวมทุกมื้อ** และถูกคำนวณจากแถวรายมื้อเสมอในการบันทึกครั้งเดียวกัน จึงไม่มีทางไม่ตรงกัน

### เวอร์ชันและความคงที่ของประวัติ

- แก้สูตรที่ **เผยแพร่แล้วไม่ได้** — กดแก้ไขจะสร้างเวอร์ชันใหม่โดย **คัดลอกจากเวอร์ชันปัจจุบัน** (รวมการแตกมื้อ)
- เวอร์ชันเก่าอ่านย้อนหลังได้ตรงกับตอนที่ใช้จริง ต้นทุนย้อนหลังจึงไม่เปลี่ยนตามการแก้สูตรวันนี้
- ถ้ามีฉบับร่างค้างอยู่ การกดแก้ไขจะกลับไปที่ร่างเดิม ไม่สร้างเวอร์ชันซ้อน
- เผยแพร่สูตรเปล่าไม่ได้

## 11. Unit conversion

`src/lib/units.ts` แปลงหน่วยผ่าน graph ของกฎการแปลง จึงรองรับการแปลงต่อกันหลายชั้น

- กฎ global: 1 kg = 1000 g, 1 ลัง = 12 ขวด, 1 แพ็ก = 10 ถุง, 1 แผง = 30 ฟอง
- กฎเฉพาะสินค้า (`unit_conversions.item_id`) จะ override กฎ global ของคู่หน่วยเดียวกัน
- สต๊อกเก็บเป็น **base unit เสมอ** ส่วนเอกสารจัดซื้อใช้ purchase unit แล้วคูณ `conversion_to_base`

---

## 12. Database tables (40 ตาราง)

| กลุ่ม | ตาราง |
| --- | --- |
| Organization | `organizations`, `locations` |
| Users & สิทธิ์ | `users`, `roles`, `permissions`, `role_permissions`, `user_roles` |
| ข้อมูลหลัก | `items`, `item_categories`, `item_aliases`, `units`, `unit_conversions`, `suppliers`, `supplier_items` |
| เมนู | `menus`, `menu_categories`, `meal_periods`, `menu_plans`, `menu_plan_items` |
| BOM | `recipes`, `recipe_versions`, `recipe_items`, `recipe_item_period_quantities` |
| จัดซื้อ | `purchase_orders`, `purchase_order_items` |
| เอกสารคลัง | `goods_receipts`, `goods_receipt_items`, `stock_issues`, `stock_issue_items`, `stock_transfers`, `stock_transfer_items` |
| Ledger & ลอต | `inventory_lots`, `inventory_postings`, `inventory_transactions`, `stock_balances` |
| ตรวจนับ | `stock_count_sessions`, `stock_count_items` |
| ระบบ | `audit_logs`, `app_settings`, `sheet_sync_runs` |

Recipe รองรับ version — `menu_plan_items.recipe_version_id` ผูกเวอร์ชันที่ใช้จริงไว้กับแผนเมนู ดังนั้นการแก้สูตรใหม่จะ **ไม่ทำให้ต้นทุนย้อนหลังเปลี่ยน**

Meal period, จำนวนวันแจ้งเตือนหมดอายุ และ prefix เลขที่เอกสาร เก็บใน `meal_periods` / `app_settings` — ไม่ hardcode

`src/services/settings-service.ts` อ่านค่าเหล่านี้แบบ type-safe ทุกคีย์ประกาศ schema และค่า fallback ไว้ ถ้าแถวหายหรือข้อมูลเพี้ยนจะตกไปใช้ค่า default แทนที่จะพังทั้งหน้า

`src/services/settings-service.ts` อ่านค่าเหล่านี้แบบ type-safe ทุกคีย์ประกาศ schema และค่า fallback ไว้ ถ้าแถวหาย/ข้อมูลเพี้ยนจะตกไปใช้ค่า default แทนที่จะพังทั้งหน้า เกณฑ์แจ้งเตือนหมดอายุ default คือ 1 / 3 / 7 วัน แก้ได้ที่ `app_settings.expiry_alert_days` โดยไม่ต้อง deploy

Seed ใส่ meal period ไว้สองกะตามที่โรงอาหารวางแผนจริง คือ `DAY` (เช้า) และ `NIGHT` (ดึก) ซึ่งเป็นสองฝั่งของสัญกรณ์ BOM `30+20` ใน Phase 7 — เพิ่ม/แก้ไขได้จากตาราง ไม่มีการ hardcode ใน code

---

## 13. Testing

เทสแบ่งเป็นสองชั้น

```bash
npm run test              # unit — hermetic ไม่ต้องต่อฐานข้อมูล (94 tests)
npm run test:integration  # integration — เขียนจริงลง Postgres (73 tests)
```

**Unit** — business logic ล้วน

- `quantity.test.ts` — เลขทศนิยมไม่เพี้ยน, บวก/ลบ/คูณ/หาร, การเปรียบเทียบ
- `units.test.ts` — การแปลงหน่วยทั้งทางตรง ทางกลับ ต่อกันหลายชั้น และ override รายสินค้า
- `fefo.test.ts` — ลำดับ FEFO, การตัดข้ามลอต, การรายงานของไม่พอ (กันสต๊อกติดลบ), การจัดกลุ่มวันหมดอายุ
- `permissions.test.ts` — สิทธิ์ของแต่ละ role และการรวมสิทธิ์เมื่อมีหลาย role
- `transaction-types.test.ts` — ทิศทาง IN/OUT ของทุกชนิดรายการ และชนิดที่ห้าม post ตรงๆ
- `date.test.ts` — วันทางธุรกิจต้องเป็นวันของไทย ไม่ใช่วัน UTC ของเซิร์ฟเวอร์
- `period-quantity.test.ts` — parser ของ `30+20` ทั้งกรณีปกติ ทศนิยม กะที่สาม และกรณีพิมพ์ผิด
- `date.test.ts` — วันทางธุรกิจต้องเป็นวันของไทย ไม่ใช่วัน UTC ของเซิร์ฟเวอร์
- `period-quantity.test.ts` — parser ของ `30+20` ทั้งกรณีปกติ ทศนิยม กะที่สาม และกรณีพิมพ์ผิด
- `form-data.test.ts` — การอ่าน checkbox ที่ไม่ถูกติ๊ก และฟิลด์ที่ส่งหลายค่า (บทบาท)
- `schemas/common.test.ts` — `booleanFlagSchema` และฟิลด์ตัวเลขที่เว้นว่างต้องเป็น NULL ไม่ใช่ 0
- `schemas/master-data.test.ts` — validation ของ Item / SupplierItem / User

**Integration** — เขียนจริงผ่าน service + transaction + audit log (stub เฉพาะ session เพราะสิทธิ์มาจาก cookie ของ request)

- `bom-service.integration.test.ts` — Gate 7: ไก่บด `30+20` แตกเป็น เช้า 30 / ดึก 20 / รวม 50, ยอดรวมตรงกับผลรวมรายมื้อ, สูตรที่เผยแพร่แล้วแก้ไม่ได้, v2 คัดลอกจาก v1 แล้ว v1 ไม่เปลี่ยน, การแตกมื้อถูกคัดลอกไปด้วย, เผยแพร่สูตรเปล่าไม่ได้ และการตรวจสิทธิ์
- `transfer-service.integration.test.ts` — สองขาอยู่ใน posting เดียว, FEFO เลือกลอตหมดอายุก่อน, ตัดข้ามหลายลอตแล้วลอตยังคงตัวตนที่ปลายทาง, ต้นทางติดลบไม่ได้, โอนเข้าที่เดิมไม่ได้, กดซ้ำไม่โอนซ้ำ, ตรวจสิทธิ์ และความถูกต้องของยอดก่อน–หลัง
- `receiving-service.integration.test.ts` — ใบรับ + รายการ + ลอต + ledger เกิดพร้อมกัน, แปลงหน่วยซื้อเป็นหน่วยสต๊อก, ของที่ไม่รับไม่เข้าสต๊อก, ปฏิเสธทั้งรายการไม่สร้างลอต, กดซ้ำไม่รับซ้ำ, รายการเสียหนึ่งบรรทัดแล้ว rollback ทั้งใบ, เลขเอกสารเรียงต่อกัน, จำราคาล่าสุด, ตรวจสิทธิ์ และ path ของ server action ที่ฟอร์มใช้จริง (ส่งค่าเป็น string)
- `inventory-allocation-service.integration.test.ts` — Gate 4: ลอตหมดอายุ 15 ส.ค. ถูกใช้ก่อนลอต 20 ส.ค., ตัดข้ามหลายลอต, กันของหมดอายุออกจากแผน, รายงานของขาด, แผนที่ได้นำไป post แล้วยอดตรง, override ตรวจสิทธิ์และตรวจว่าข้ามลอตจริงไหม, การจัดกลุ่มแจ้งเตือนหมดอายุ
- `inventory-ledger-service.integration.test.ts` — Gate 3 ของ roadmap: รับ 100 → เบิก 30 → เหลือ 70, เบิกเกินถูกปฏิเสธและสต๊อกไม่ขยับ, กด submit ซ้ำตัดครั้งเดียว, **สองคนเบิกพร้อมกันแล้วสต๊อกไม่ติดลบ**, โอนสองขาใน posting เดียว, rollback ทั้ง posting เมื่อบรรทัดใดล้ม, reversal และการกันสิทธิ์
- `user-service.integration.test.ts` — สร้าง/แก้ผู้ใช้, เปลี่ยนบทบาทแล้วบันทึกเป็น `PERMISSION_CHANGE`, อีเมลซ้ำ, ปิดใช้งานแทนการลบ, กันแอดมินถอดสิทธิ์/ปิดบัญชีตัวเอง
- `supplier-item-service.integration.test.ts` — MOQ / pack size / lead time, `last_price_at` ขยับเฉพาะตอนราคาเปลี่ยน, ผู้ขายหลักมีได้รายเดียวต่อวัตถุดิบ, ปิดใช้งานแทนการลบ

ต้อง `npm run db:migrate && npm run db:seed` ก่อนรัน integration — เทสจะเก็บกวาดข้อมูลของตัวเองหลังรันเสร็จ

เทสของ Receiving / Issue / Transfer / Partial Receiving / Cost calculation จะเพิ่มพร้อมกับโมดูลใน Phase 3–5

---

## 14. Deployment (Vercel)

1. สร้างโปรเจกต์ Supabase แล้วคัดลอก connection string (แนะนำ session pooler port 5432)
2. Import repository เข้า Vercel
3. ตั้งค่า environment variables: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (**ห้ามตั้ง `ALLOW_DEV_AUTH`**)
4. รัน migration ครั้งแรกจากเครื่อง: `DATABASE_URL=<production> npm run db:migrate`
5. สร้างผู้ใช้ใน Supabase Auth ด้วยอีเมลเดียวกับแถวในตาราง `users` (ระบบจับคู่ผู้ใช้ด้วยอีเมล)
6. Deploy — ทุกหน้าที่ต้องล็อกอินถูกตั้งเป็น dynamic rendering อยู่แล้ว

---

## 15. Roadmap

| Phase | ขอบเขต | สถานะ |
| --- | --- | --- |
| 1 | Foundation: schema, migration, seed, auth, roles, app shell, Item/Location/Supplier master, audit log, health check, จัดการผู้ใช้, Supplier item mapping | ✅ เสร็จ |
| 3 | Inventory engine: posting + ledger, idempotency, กันสต๊อกติดลบ, กันแย่งกันเบิก, reversal, สต๊อกคงเหลือ, บัญชีเคลื่อนไหว | ✅ เสร็จ |
| 4 | Lot + expiry + FEFO allocation จากยอดคงเหลือจริง, กันของหมดอายุออกจากแผนเบิก, FEFO override, แจ้งเตือนหมดอายุแบบตั้งเกณฑ์ได้ | ✅ เสร็จ |
| 5 | Receiving: ใบรับสินค้า mobile-first, ลอต, แปลงหน่วย, ของขาด/เสียหาย, เลขที่เอกสาร, หน้าจอยืนยันผล | ✅ เสร็จ |
| 6 | Transfer: โอนสองขาใน posting เดียว, FEFO, ยอดก่อน–หลัง, หน้าจอมือถือ | ✅ เสร็จ |
| 7 | Menu master + BOM แบบมีเวอร์ชัน, สัญกรณ์ `30+20` (เช้า/ดึก), ประวัติสูตรคงที่ | ✅ เสร็จ |
| 8 | Daily Menu Plan + รวมความต้องการวัตถุดิบตามมื้อ | ⏳ |
| 4 | Supplier item, PO, รับของตาม PO, partial receiving, PO status | ⏳ |
| 5 | ต้นทุนรายวัน/รายเดือน/ต่อเมนู, ประวัติราคา, รายงาน + export | ⏳ |
| 6 | Management dashboard, alerts, projected stock, purchase recommendation, Google Sheets sync | ⏳ |

โครงสร้างฐานข้อมูลของ Phase 2–6 ถูกออกแบบและ migrate ไว้แล้วทั้งหมด เหลือเพียงชั้น service และ UI
