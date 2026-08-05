# Canteen Smart Stock

ระบบบริหารจัดการ Stock วัตถุดิบโรงอาหาร — ใช้งานจริงบนมือถือ / แท็บเล็ต / คอมพิวเตอร์
Backend ทำงานบน **Google Apps Script**, Database บน **Google Sheets**, ไฟล์แนบเก็บใน **Google Drive** ทั้งหมดอยู่ในบัญชี Google ของคุณเอง ไม่ต้องมี Server ภายนอก

## สถานะ: PHASE 1 (ใช้งานได้ครบ Flow)

```
Employee ID → Bulk Receiving → Stock Lot → Stock Balance → Bulk Issue → FEFO → Audit Log
```

ความสามารถใน Phase 1:

- ✅ ตรวจสอบรหัสพนักงานก่อนบันทึกทุก Transaction (พิมพ์ / สแกนบาร์โค้ด / Auto-fill จาก Google Account)
- ✅ รับสินค้าแบบ Bulk — Header กรอกครั้งเดียว + รายการสินค้าหลายแถว (สูงสุด 200 แถว) บันทึกใน 1 Transaction
- ✅ ตาราง Excel-like: Tab / Enter / ลูกศร / Paste หลายแถวจาก Excel / Autocomplete / สแกนบาร์โค้ด
- ✅ สร้าง Stock Lot อัตโนมัติทุกครั้งที่รับ (Lot No กรอกเองหรือ generate อัตโนมัติ)
- ✅ Received < Ordered → สร้าง Pending Delivery อัตโนมัติ (Partial Delivery) / Received > Ordered → เตือนก่อนบันทึก
- ✅ เบิกสินค้าแบบ Bulk พร้อมตัด Lot ตาม **FEFO** (First Expired First Out) + preview ว่าจะตัด Lot ไหนก่อนบันทึก
- ✅ Expired Lot ห้ามเบิก / Stock ห้ามติดลบ — validate ทั้งฝั่ง client และ server (ภายใต้ LockService)
- ✅ Stock Balance คำนวณจาก Transaction จริง, Lot Balance ตรงกับ Stock Balance เสมอ
- ✅ Audit Log ทุก Action: ใคร ทำอะไร รายการไหน วันไหน เวลาไหน จากอุปกรณ์อะไร
- ✅ เช็ก Stock + ค้นหา (ชื่อ/รหัส/Location) + ดูรายละเอียด Lot, วันหมดอายุ, สถานที่เก็บ
- ✅ Transaction History พร้อม Filter (ประเภท / รหัสพนักงาน / สินค้า / ช่วงวันที่)
- ✅ แนบใบส่งของ/รูปเข้า Google Drive (เก็บ File ID + URL ใน Sheet — ไม่เก็บ Base64)
- ✅ เลขเอกสารอัตโนมัติ RCV-YYYYMMDD-0001 / ISS-YYYYMMDD-0001
- ✅ Daily Backup Spreadsheet เข้า `07_Backup` เวลา 02:00 เก็บย้อนหลัง 30 วัน

## โครงสร้าง Repository

```
canteen-pwa/
├── apps-script/            # โค้ดทั้งหมด (push ขึ้น Google Apps Script)
│   ├── appsscript.json     # Manifest (timezone, scopes, web app)
│   ├── Code.js             # doGet + include (entry point ของ Web App)
│   ├── Config.js           # ค่าคงที่ + Schema ทุก Sheet (27 sheets)
│   ├── Db.js               # Data access layer (batch read/write + cache)
│   ├── Utils.js            # Document number, วันที่, helpers
│   ├── Setup.js            # setupSystem / seedSampleData / installTriggers / backup
│   ├── AuthService.js      # ตรวจ Employee ID + auto-fill จาก Google Account
│   ├── MasterService.js    # Bootstrap master data (items/locations/vendors)
│   ├── StockService.js     # Stock Balance, Stock Lot, FEFO, History
│   ├── ReceivingService.js # Bulk Receiving + Pending Delivery
│   ├── IssueService.js     # Bulk Issue + FEFO allocation
│   ├── AuditService.js     # Audit Log
│   ├── DriveService.js     # Upload ไฟล์เข้า Google Drive
│   ├── Index.html          # หน้าจอหลัก (SPA + Bottom Navigation)
│   ├── Styles.html         # CSS (Modern Corporate: White/Navy/Blue)
│   └── App.html            # JavaScript ฝั่ง client ทั้งหมด
└── docs/
    ├── ARCHITECTURE.md     # System Architecture + Drive structure + Phases
    ├── DATABASE_SCHEMA.md  # Schema ทุก Sheet
    ├── SETUP_GUIDE.md      # ติดตั้งทีละขั้น (มือใหม่ทำตามได้)
    ├── DEPLOYMENT_GUIDE.md # Deploy / update version / สิทธิ์การเข้าถึง
    └── TEST_CHECKLIST.md   # Test cases ครบทุก Flow ของ Phase 1
```

## เริ่มต้นใช้งาน (ย่อ)

1. สร้างโปรเจกต์ที่ [script.google.com](https://script.google.com) แล้ว copy ไฟล์ทั้งหมดใน `apps-script/` เข้าไป (หรือใช้ `clasp push`)
2. รันฟังก์ชัน `setupSystem` → สร้าง Drive folders + Spreadsheet database ทั้ง 27 sheets
3. รันฟังก์ชัน `seedSampleData` → ใส่ข้อมูลตัวอย่าง (พนักงาน 5 คน, สินค้า 10 รายการ, Location 6 จุด)
4. รันฟังก์ชัน `installTriggers` → ตั้ง backup อัตโนมัติ 02:00
5. Deploy → New deployment → Web app → เปิด URL บนมือถือได้ทันที

รายละเอียดทีละขั้น: [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md)

## แผนพัฒนา

| Phase | ขอบเขต | สถานะ |
|---|---|---|
| 1 | Database, Employee ID, Bulk Receiving, Stock Lot, Stock Balance, Bulk Issue, FEFO, Audit Log | ✅ เสร็จ |
| 2 | Transfer, Stock Count, Expiry Alert, Low Stock Alert, Pending Delivery page | รอพัฒนา |
| 3 | Dashboard เต็มรูปแบบ, Monthly Usage, Reports, Supplier Performance, Waste, Employee Activity | รอพัฒนา |
| 4 | Smart Purchase Recommendation, Manager Insight, Automation | รอพัฒนา |

> Sheet ของ Phase 2–4 ถูกสร้าง Header รอไว้แล้วตั้งแต่ `setupSystem` — เพิ่ม feature ได้โดยไม่ต้อง migrate database
