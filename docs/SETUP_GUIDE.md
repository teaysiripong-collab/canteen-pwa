# Setup Guide — ติดตั้งทีละขั้น

ใช้เวลาประมาณ 10–15 นาที ต้องมีแค่บัญชี Google (Gmail หรือ Google Workspace)

## ขั้นที่ 1: สร้างโปรเจกต์ Apps Script

1. เปิด [script.google.com](https://script.google.com) → **New project**
2. ตั้งชื่อโปรเจกต์: `Canteen Smart Stock`

## ขั้นที่ 2: นำโค้ดเข้าโปรเจกต์

**วิธี A — Copy มือ (ง่ายสุด)**

1. ในโปรเจกต์ Apps Script สร้างไฟล์ให้ตรงกับใน `apps-script/`:
   - **Script file** (Files → + → Script): `Code`, `Config`, `Db`, `Utils`, `Setup`, `AuthService`, `MasterService`, `StockService`, `ReceivingService`, `IssueService`, `AuditService`, `DriveService`
   - **HTML file** (Files → + → HTML): `Index`, `Styles`, `App`
2. Copy เนื้อหาแต่ละไฟล์จาก repo ไปวาง (ไฟล์ `.js` ใน repo = Script file, `.html` = HTML file)
3. เปิด Project Settings (⚙) → ติ๊ก **Show "appsscript.json" manifest file** → วางเนื้อหาจาก `apps-script/appsscript.json`

**วิธี B — clasp (สำหรับ developer)**

```bash
npm install -g @google/clasp
clasp login
cd apps-script
clasp create --type webapp --title "Canteen Smart Stock"
clasp push
```

## ขั้นที่ 3: รันติดตั้งระบบ

ใน Apps Script Editor (แถบบนเลือกฟังก์ชัน → Run):

1. รัน **`setupSystem`**
   - ครั้งแรกจะขอสิทธิ์ → Review permissions → เลือกบัญชี → Advanced → Go to Canteen Smart Stock (unsafe) → Allow
     (ข้อความ "unsafe" ขึ้นเพราะเป็น script ส่วนตัวที่ยังไม่ผ่าน Google verification — โค้ดอยู่ในบัญชีคุณเอง)
   - ผลลัพธ์: folder `Canteen Smart Stock` + 7 subfolder ใน Drive, Spreadsheet `Canteen Smart Stock Database` ครบ 27 sheets, System Setting เริ่มต้น
   - ดู URL ของ Spreadsheet/Folder ได้จาก Execution log
2. รัน **`seedSampleData`** — ใส่ข้อมูลตัวอย่าง:
   - พนักงาน 5 คน (เช่น `1A013592` สมชาย ใจดี / `1A099999` เป็น Inactive สำหรับทดสอบ)
   - สินค้า 10 รายการ (หมูบด, ไก่บด, ไข่ไก่, ซอส, ข้าว ฯลฯ) + หมวดหมู่ + หน่วย + Vendor 3 ราย + Location 6 จุด
3. รัน **`installTriggers`** — ตั้ง backup อัตโนมัติทุกวัน 02:00 (เก็บย้อนหลัง 30 วัน)

## ขั้นที่ 4: Deploy เป็น Web App

ดูรายละเอียดใน [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) — สรุปย่อ:

1. **Deploy → New deployment → Web app**
2. Execute as: **User deploying** / Who has access: ตามนโยบายองค์กร (แนะนำ *Anyone within organization*)
3. กด Deploy → copy **Web app URL** → เปิดบนมือถือ แล้ว "Add to Home Screen" ใช้เหมือนแอป

## ขั้นที่ 5: ใส่ข้อมูลจริง

เปิด Spreadsheet `Canteen Smart Stock Database` แล้วกรอกใน sheet ต่อไปนี้ (แถวต่อจากตัวอย่าง หรือลบตัวอย่างออก):

| Sheet | ต้องกรอก |
|---|---|
| USER_MASTER | รหัสพนักงานจริงทุกคน + Status=`Active` (ใส่ Email ถ้าต้องการ auto-login) |
| ITEM_MASTER | สินค้าจริง — Item_ID ห้ามซ้ำ, ใส่ Reorder_Point เพื่อให้แจ้ง Stock ต่ำ |
| LOCATION_MASTER | จุดเก็บจริง (Full_Path คือข้อความที่แสดงบนจอ) |
| VENDOR_MASTER | ผู้ขายจริง |

หลังแก้ master data รอ ~5 นาที (cache) หรือเปิดแอปใหม่

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| เปิดแอปแล้วขึ้น "ยังไม่ได้ติดตั้งระบบ" | ยังไม่ได้รัน `setupSystem` |
| ตรวจรหัสพนักงานแล้วไม่พบ | สะกดไม่ตรงกับ USER_MASTER หรือ Status ไม่ใช่ `Active` |
| แก้ ITEM_MASTER แล้วแอปยังไม่เห็น | cache 5 นาที — reload แอปหลังจากนั้น |
| Save แล้วขึ้น "ระบบกำลังบันทึกรายการอื่นอยู่" | มีคน save พร้อมกัน — รอครู่แล้วกดใหม่ (ข้อมูลไม่หาย) |
| Upload ไฟล์ไม่ได้ | ไฟล์เกิน 8MB หรือยังไม่ได้ให้สิทธิ์ Drive ตอน setup |
