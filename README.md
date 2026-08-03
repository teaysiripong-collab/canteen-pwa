# MEKTEC Canteen Smart Ingredient & Requisition System

**ระบบบริหารวัตถุดิบ เบิก-จ่าย และวางแผนอาหารแคนทีน** — Web Application สำหรับบริหารวัตถุดิบโรงอาหารโรงงาน สร้างด้วย Google Apps Script + Google Sheets (ไม่ต้องมี Server ภายนอก)

> **Workflow หลัก:** MENU → RECIPE → REQUIREMENT → REQUISITION → STOCK → PURCHASE → ACTUAL → COST

## ความสามารถหลัก

| โมดูล | รายละเอียด |
|---|---|
| 📅 แผนเมนู | วางแผนรายสัปดาห์ (จันทร์–เสาร์) ล่วงหน้าได้หลายสัปดาห์, Copy วัน/สัปดาห์, Drag & Drop ย้ายเมนูข้ามวัน |
| 📖 สูตรอาหาร | หลายวัตถุดิบต่อเมนู, Waste %, Recipe Version (แก้สูตรไม่กระทบรายงานย้อนหลัง), 🤖 AI แนะนำ Draft สูตร |
| 🧮 คำนวณวัตถุดิบอัตโนมัติ | อ่านแผนเมนู → รวมวัตถุดิบซ้ำ → เทียบ Stock → สร้าง Draft ใบเบิกให้ทันที ผู้ใช้แก้เฉพาะช่อง "เบิกจริง" |
| 📤 ใบเบิก | Workflow: draft → pending → approved (จอง Stock) → issued (ตัด Stock จริง), ห้ามตัดติดลบโดยไม่แจ้งเตือน, พิมพ์ใบเบิก A4 พร้อมช่องเซ็น |
| 📦 Stock | แยกคลัง B1 / B16 (เพิ่มได้), รับเข้า, โอนข้ามคลัง, ปรับ Stock (บังคับเหตุผล + Audit), Ledger กลาง StockTransactions |
| 🛒 แผนสั่งซื้อ | แนะนำซื้อ = ต้องใช้ + Safety − Stock, จัดกลุ่มตาม Vendor, ผู้ใช้ยืนยันเองก่อนบันทึก |
| 💰 ต้นทุน | ต้นทุนรายวัน/สัปดาห์/เดือน แยกหมวด/คลัง/Vendor, Price History + แจ้งเตือนราคาขึ้นเกิน Threshold, Recipe vs Actual Variance |
| 📈 รายงาน | Report Center 20+ รายงาน, Filter ครบ, Export CSV / Excel (SheetJS) / Print |
| 👥 ผู้ใช้ | Role: Admin / Supervisor / User / Viewer, สมัครแล้วรอ Admin อนุมัติ, SHA-256 password, Session 2 ชม., Audit Log ทุก Action |

## โครงสร้างไฟล์

```
Code.gs         Config, สร้าง Sheet อัตโนมัติ, Core Helpers, Seed Data
Auth.gs         Login/Logout/Session/Register/จัดการผู้ใช้/สิทธิ์ตาม Role
Master.gs       หมวดหมู่ / Vendor / Location / วัตถุดิบ / เมนู
Planning.gs     สูตรอาหาร + Version, แผนเมนู, คำนวณวัตถุดิบจากแผน
Stock.gs        Stock Balance, รับเข้า, โอน, ปรับ Stock, Ledger
Requisition.gs  ใบเบิก + Approval Workflow + จ่ายของ
Purchase.gs     แผนสั่งซื้อ, Actual Usage, Cost Summary, Price History
Report.gs       Dashboard, Report Center, Notifications, AI Modules
index.html      Frontend SPA ทั้งหมด (Thai UI, Responsive, Chart.js, SheetJS)
appsscript.json Manifest (timezone Asia/Bangkok, V8)
```

## วิธีติดตั้ง (Deployment Guide)

1. สร้าง **Google Sheet** เปล่าใหม่ 1 ไฟล์ (ตั้งชื่อ เช่น `MEKTEC Canteen DB`)
2. Copy **Spreadsheet ID** จาก URL — ส่วนที่อยู่ระหว่าง `/d/` กับ `/edit`
   `https://docs.google.com/spreadsheets/d/`**`1AbC...XyZ`**`/edit`
3. เปิด [script.google.com](https://script.google.com)
4. กด **New project** ตั้งชื่อโปรเจกต์ เช่น `MEKTEC Canteen System`
5. สร้างไฟล์ Script แล้ววางโค้ดตามรายชื่อ: `Code.gs`, `Auth.gs`, `Master.gs`, `Planning.gs`, `Stock.gs`, `Requisition.gs`, `Purchase.gs`, `Report.gs`
   (เมนู ➕ ข้าง Files → Script — ชื่อไฟล์ไม่ต้องพิมพ์ `.gs`)
6. สร้างไฟล์ HTML ชื่อ `index` แล้ววางโค้ดจาก `index.html`
   (เมนู ➕ → HTML — **ต้องชื่อ `index` เท่านั้น**)
7. เปิด `Code.gs` แก้บรรทัดบนสุด ใส่ Spreadsheet ID ของคุณ:
   ```js
   const SPREADSHEET_ID = '1AbC...XyZ';
   ```
8. กด **Deploy** (มุมขวาบน)
9. เลือก **New deployment**
10. ประเภทเลือก **Web app**
11. **Execute as: Me** (สำคัญ — ระบบเขียน Sheet ในนามเจ้าของ)
12. **Who has access** ตั้งตาม Policy องค์กร (เช่น *Anyone* หรือ *Anyone within organization*) แล้วกด Deploy และอนุญาตสิทธิ์ (Authorize)
13. เปิด **Web app URL** ที่ได้
14. ระบบจะ **Auto Setup** สร้าง Sheet ทั้งหมด + ข้อมูลตัวอย่างให้อัตโนมัติในการเปิดครั้งแรก (รอสักครู่)
15. Login ด้วยบัญชีเริ่มต้น:

    ```
    username: admin
    password: admin123
    ```
    ⚠️ ควรเปลี่ยนรหัสผ่าน admin ทันทีที่หน้า **ผู้ใช้งาน**

### หมายเหตุการอัปเดตโค้ด
แก้โค้ดแล้วต้อง **Deploy → Manage deployments → Edit (✏️) → Version: New version → Deploy** URL เดิมจึงจะได้โค้ดใหม่

### Reset ข้อมูล (เริ่มใหม่ทั้งหมด)
ลบทุก Sheet ในไฟล์ Google Sheet แล้วไปที่ Apps Script → Project Settings → Script Properties → ลบ `SETUP_DONE_V1` → เปิด Web App ใหม่

## ข้อมูลตัวอย่าง (Seed Data)

- คลัง **B1**, **B16** · หมวดหมู่ 10 หมวด · Vendor: Makro / Betagro / Puangploy / Other
- วัตถุดิบ 20 รายการพร้อมราคา, Min/Safety Stock และยอด Stock เริ่มต้น
- เมนู 8 เมนู (7 เมนูมีสูตร, `ไข่เจียวหมูสับ` ตั้งใจไม่มีสูตรไว้ทดสอบ Zero Recipe Handling + AI แนะนำสูตร)
- แผนเมนูวันนี้ + 2 วันข้างหน้า สำหรับทดลองกด "สร้างใบเบิกจากเมนูวันนี้" ได้ทันที

## สถาปัตยกรรมโดยย่อ

- **Database:** Google Sheets 22 Sheet สร้างอัตโนมัติครั้งแรก (กัน Race Condition ด้วย LockService + Script Properties `SETUP_DONE_V1`)
- **Ledger:** ทุกการเคลื่อนไหว Stock ลง `StockTransactions` (STOCK_IN / ISSUE / TRANSFER_IN / TRANSFER_OUT / ADJUSTMENT_IN / ADJUSTMENT_OUT) — Transaction ไม่มีการ Hard Delete, Master Data ใช้ Soft Delete
- **เลขเอกสาร:** `STIN-` / `ISSUE-` / `REQ-` / `TRF-` / `PP-` + `YYYYMMDD-NNNN` ออกเลขภายใต้ Lock กันซ้ำ
- **Security:** ทุกฟังก์ชันตรวจ `verifyToken_()` ฝั่ง Server, สิทธิ์ตัดสินจาก Role ใน Sheet ไม่เชื่อ Client, Password Hash SHA-256
- **Performance:** `getFastInitialData()` โหลดครั้งเดียวหลัง Login, Memo Cache ต่อ Execution, Batch Read/Write, Client Cache + Background Refresh, Sequence Guard กัน Response เก่าทับใหม่
- **แยกตัวเลขชัดเจน:** ตามสูตร (recipe) / แนะนำ (recommended) / ขอเบิก (requested) / อนุมัติ (approved) / จ่ายจริง (actual) — ไม่ใช้ Field เดียวแทนกัน
