# System Architecture — Canteen Smart Stock

## 1. ภาพรวม

```
┌─────────────────────────────────────────────┐
│  Web App (มือถือ / แท็บเล็ต / คอมพิวเตอร์)      │
│  HTML + CSS + JavaScript (SPA, Bottom Nav)  │
└──────────────────┬──────────────────────────┘
                   │ google.script.run (async)
┌──────────────────▼──────────────────────────┐
│  Google Apps Script (Backend API)           │
│  - Validate Employee / Header / Rows        │
│  - LockService (atomic transaction)         │
│  - CacheService (master data ~5 นาที)        │
│  - FEFO allocation engine                   │
└─────────┬────────────────────┬──────────────┘
          │ batch read/write   │ DriveApp
┌─────────▼──────────┐  ┌──────▼──────────────┐
│  Google Sheets     │  │  Google Drive       │
│  (Database 27 ตาราง)│  │  (ไฟล์แนบ + Backup)  │
└────────────────────┘  └─────────────────────┘
```

หลักการ: ไม่พึ่ง Server ภายนอก — ทุกอย่างรันในบัญชี Google ของผู้ใช้

## 2. Google Drive Structure

```
Canteen Smart Stock/                    ← root folder (สร้างโดย setupSystem)
├── 01_Master Data/                     ← Spreadsheet database อยู่ที่นี่
├── 02_Receiving & Delivery/            ← ใบส่งของ, Invoice, รูปตอนรับ
├── 03_Expiry & Waste/                  ← รูปของเสีย / ของหมดอายุ
├── 04_PO & Pending Delivery/           ← เอกสาร PO
├── 05_Reports/                         ← Report ที่ export (Phase 3)
├── 06_Attachments/                     ← เอกสารทั่วไป
└── 07_Backup/                          ← CanteenStock_Backup_YYYYMMDD (30 วัน)
```

- ทุกไฟล์ที่ upload จะเก็บ **File ID + Drive URL** ลง Sheet — **ไม่เก็บ Base64 ใน Sheets**
- Folder ID ทั้งหมดเก็บใน Script Properties ตอน `setupSystem` (ไม่ต้อง hardcode)

## 3. Apps Script File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `appsscript.json` | Manifest: timezone Asia/Bangkok, OAuth scopes, web app config |
| `Code.js` | `doGet()` entry point + `include()` สำหรับรวม HTML |
| `Config.js` | ค่าคงที่ + `SHEET_SCHEMA` (source of truth ของทุกคอลัมน์) |
| `Db.js` | อ่าน/เขียน Sheet แบบ batch, normalize วันที่, CacheService |
| `Utils.js` | เลขเอกสาร (RCV-YYYYMMDD-0001), วันที่/เวลา, round4 กัน floating point |
| `Setup.js` | ติดตั้งระบบ, seed ข้อมูลตัวอย่าง, trigger backup 02:00, clean backup เก่า |
| `AuthService.js` | `validateEmployee_` (server-side เสมอ), auto-fill จาก Google Account |
| `MasterService.js` | `apiBootstrap` — master data ทั้งหมดใน 1 round-trip |
| `StockService.js` | Balance map, `allocateFefo_`, stock overview, item lots, history |
| `ReceivingService.js` | `apiSaveReceiving` — bulk receive ทั้งชุดภายใต้ Lock |
| `IssueService.js` | `apiSaveIssue` + `apiPreviewIssue` — bulk issue ตาม FEFO |
| `AuditService.js` | `logAudit_` — บันทึกทุก action |
| `DriveService.js` | `apiUploadFile` — upload เข้า folder ที่ถูกต้องตามชนิดไฟล์ |
| `Index.html` / `Styles.html` / `App.html` | Frontend SPA |

## 4. API Functions (เรียกจาก client ผ่าน `google.script.run`)

ทุก API คืนรูปแบบเดียวกัน: `{ ok: true, data }` หรือ `{ ok: false, error }`

| Function | ใช้ทำอะไร |
|---|---|
| `apiBootstrap()` | โหลด items / locations / vendors / balances ครั้งเดียวตอนเปิดแอป |
| `apiGetCurrentUser()` | email ของ Google Account + user ที่ match ใน USER_MASTER |
| `apiValidateEmployee(id)` | ตรวจรหัสพนักงาน — คืนชื่อ/Role/Building หรือ error |
| `apiSaveReceiving(payload)` | บันทึกรับสินค้าทั้งชุด (header + rows) |
| `apiSaveIssue(payload)` | บันทึกเบิกทั้งชุด ตัด Lot FEFO |
| `apiPreviewIssue(rows)` | ดูก่อนว่า FEFO จะตัด Lot ไหน / พอไหม |
| `apiGetStockOverview()` | Stock balance + lot summary + low stock + expiry |
| `apiGetItemLots(itemId)` | Lot ทั้งหมดของสินค้า เรียงตาม FEFO |
| `apiGetTransactions(filter)` | ประวัติ transaction (filter: type/employee/item/date) |
| `apiUploadFile(payload)` | upload ไฟล์แนบเข้า Google Drive |

## 5. Transaction Safety (Bulk Save Flow)

```
1. Validate Employee   (USER_MASTER: ต้องพบ + Status=Active)
2. Validate Header     (Vendor/Location/ToLocation ครบ)
3. Validate All Rows   (item มีจริง, qty > 0, expiry ไม่เป็นอดีต)
   └─ ถ้าผิดแม้แถวเดียว → คืน {validation:[{line,message}]} — ไม่เขียนอะไรเลย
4. Acquire Lock        (LockService.tryLock 30s)
5. Validate Stock อีกครั้งใน Lock (Issue: FEFO allocate ทุก item ต้องพอ)
6. เตรียมข้อมูลทุกตารางให้ครบก่อน แล้วค่อยเขียน (ลดโอกาสค้างครึ่งชุด)
7. เขียน batch: HEADER → DETAIL → LOT → TRANSACTION → BALANCE → PENDING
8. Audit Log
9. Release Lock (finally — ปล่อยเสมอแม้ error)
```

กติกาที่บังคับใน server:
- Stock ติดลบไม่ได้ (ตรวจใน `applyBalanceChanges_` อีกชั้น)
- Expired Lot ห้าม Issue (`allocateFefo_` ข้าม lot ที่หมดอายุ)
- ห้าม Hard Delete — ใช้ Status + Audit Log
- ไม่เชื่อ client: ราคา/ชื่อสินค้า/สิทธิ์ อ่านจาก master ฝั่ง server เสมอ

## 6. Performance

- `apiBootstrap` รวม 4 ตารางใน 1 call — เปิดแอปโหลดครั้งเดียว
- Master data cache ผ่าน `CacheService` 5 นาที (invalidate เมื่อมีการเขียน)
- อ่าน/เขียนเป็น `getValues`/`setValues` ทั้งช่วง ไม่วน cell
- เลขเอกสารใช้ counter ใน `PropertiesService` (ไม่ scan sheet)
- ทุกคอลัมน์ตั้ง format เป็น Plain text กัน Sheets แปลงค่าอัตโนมัติ

## 7. Phases

- **Phase 1 (ปัจจุบัน)**: ครบ flow Employee ID → Receive → Lot → Balance → Issue → FEFO → Audit
- **Phase 2**: Transfer, Stock Count, Expiry/Low Stock Alert (สร้าง Notification), หน้า Pending Delivery
- **Phase 3**: Dashboard เต็ม, Monthly Usage, Reports + Export PDF/Excel/CSV, Supplier Performance, Waste
- **Phase 4**: Smart Purchase Recommendation, Manager Insight, Automation เต็มรูปแบบ

Sheet ของทุก Phase ถูกสร้าง Header ไว้แล้วตั้งแต่ `setupSystem` — เพิ่มโค้ดได้โดยไม่ต้อง migrate
