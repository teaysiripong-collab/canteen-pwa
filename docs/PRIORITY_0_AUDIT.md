# Priority 0 Stability Audit

วันที่ตรวจสอบ: 22 กรกฎาคม 2026
Branch: `fix/priority-0-stability`

## โครงสร้างและหน้าที่ของโมดูล

- `index.html` — โครงหน้ารายการสินค้า ฟอร์มแก้ไข เครื่องสแกน และการตั้งค่า
- `styles.css` — รูปแบบ Mobile-first, สถานะสต๊อก และ Safe Area ของ PWA
- `manifest.webmanifest` — ข้อมูลติดตั้ง PWA
- `sw.js` — เก็บ Application Shell ใน Cache และให้หน้าเว็บเปิดแบบ Offline
- `js/app.js` — เริ่มระบบ เปลี่ยน View เชื่อมปุ่มหลัก และลงทะเบียน Service Worker
- `js/db.js` — IndexedDB, Item CRUD, Tombstone, Settings และ JSON Import/Export
- `js/items.js` — แสดง ค้นหา กรอง เพิ่ม แก้ไข และลบ Item
- `js/scanner.js` — เปิดกล้องและอ่าน Barcode ผ่าน `BarcodeDetector`
- `js/settings.js` — ตั้งค่า Sync, Export, Import และล้างข้อมูล
- `js/sync.js` — ส่งและรับการเปลี่ยนแปลงกับ REST endpoint ที่ผู้ใช้กำหนด
- `icons/icon.svg` — ไอคอน PWA

## ปัญหาที่ตรวจพบและแก้ไข

1. ปุ่มบันทึกกดซ้ำได้ระหว่าง IndexedDB ยังทำงาน ทำให้มีโอกาสสร้าง Item ซ้ำ
   - เพิ่มสถานะกำลังบันทึกและปิดปุ่มจนกว่าจะเสร็จ
2. Barcode / SKU ซ้ำกันได้
   - ตรวจ Barcode ใน read-write transaction เดียวกันก่อนบันทึก และแจ้งข้อความภาษาไทย
3. ค่าตัวเลขผิดรูปแบบอาจถูกแปลงเป็น `0` โดยไม่แจ้งผู้ใช้
   - ตรวจจำนวน ราคา และจุดเตือนให้เป็นเลขตั้งแต่ `0` ขึ้นไป
4. Import ตรวจเพียงว่า `items` เป็น Array
   - ตรวจโครงสร้าง Item, Tombstone และ Setting รวมถึง ID/Barcode ซ้ำก่อนเริ่ม transaction
5. Import แบบ Replace อาจล้างข้อมูลเดิมก่อนพบแถวผิด และไม่ได้ล้าง Setting เดิม
   - Validate ทั้งไฟล์ก่อนเขียน และเขียนทุก Store ใน transaction เดียวกัน พร้อมล้างทั้งสาม Store เมื่อ Replace
6. JSON ที่ parse ไม่ได้แสดงข้อความเชิงเทคนิค
   - แสดงข้อความภาษาไทยที่บอกให้ตรวจรูปแบบไฟล์
7. ข้อผิดพลาดจาก Save/Delete และการเริ่มระบบอาจกลายเป็น Unhandled Promise Rejection
   - จับข้อผิดพลาดและแจ้งผู้ใช้ โดยยังส่งรายละเอียดการเริ่มระบบไป Console
8. อุปกรณ์ที่ไม่มี `BarcodeDetector` หรือเปิดกล้องไม่ได้มีข้อความภาษาอังกฤษ
   - แสดงทางเลือกให้ปิดหน้าสแกนและกรอกรหัสเองเป็นภาษาไทย
9. Service Worker เดิมใช้ Cache-first กับ Navigation และ asset ทุกชนิด ทำให้ Application Shell อาจค้างคนละรุ่น
   - เพิ่ม Cache version และใช้ Network-first สำหรับ Navigation พร้อม Offline fallback

## การทดสอบที่ทำแล้ว

- `node --check` ผ่านสำหรับ JavaScript ทุกโมดูลและ `sw.js`
- `git diff --check` ผ่าน
- Local HTTP server ตอบ `200` สำหรับหน้าแรก Manifest, Service Worker, CSS, JavaScript และ Icon ทุกไฟล์
- ทดสอบ `js/db.js` ด้วย IndexedDB จำลอง:
  - เพิ่มและอ่าน Item
  - ปฏิเสธ Barcode ซ้ำโดยไม่เพิ่มแถวใหม่
  - ปฏิเสธจำนวนติดลบ
  - Export แล้ว Import แบบ Replace ได้ข้อมูลกลับครบ
  - ปฏิเสธไฟล์ผิดรูปแบบโดยข้อมูลเดิมไม่เปลี่ยน
  - ลบ Item และสร้าง Tombstone

## ข้อจำกัดและความเสี่ยงที่เหลือ

- ตัวเชื่อมต่อ in-app browser ของสภาพแวดล้อมทดสอบเริ่มทำงานไม่สำเร็จ (`Cannot redefine property: process`) จึงยังไม่ได้กดทดสอบ UI และตรวจ Console จริง
- ยังไม่ได้ทดสอบ IndexedDB, Service Worker/Offline และกล้องจริงบน Chrome, Safari iPhone และ Android
- ไม่ได้เปลี่ยนหรือรวม Barcode ซ้ำที่อาจมีอยู่ก่อนติดตั้งการแก้ไขนี้ เพื่อหลีกเลี่ยงการเดาว่ารายการใดเป็นข้อมูลที่ถูกต้อง
- ชื่อ Item ยังซ้ำได้ เพราะยังไม่มีกฎธุรกิจยืนยันว่าชื่อต้องไม่ซ้ำ
- REST Sync ยังไม่มี endpoint ทดสอบ จึงตรวจได้เฉพาะโค้ดเดิมและไม่ได้ส่งข้อมูลจริง

## ขั้นตอนทดสอบซ้ำบนอุปกรณ์จริง

1. เปิดระบบบน HTTPS หรือ localhost แล้วเพิ่ม Item หนึ่งรายการ
2. กด Save ติดกันหลายครั้ง ตรวจว่ามีเพียงหนึ่งรายการ
3. เพิ่ม Item อีกชื่อโดยใช้ Barcode เดิม ตรวจว่าระบบปฏิเสธ
4. แก้ชื่อ/จำนวน บันทึก รีเฟรช และตรวจว่าข้อมูลยังอยู่
5. ลบ Item และยืนยันว่ารายการหายหลังรีเฟรช
6. Export JSON, Import แบบ Merge และ Replace แล้วเทียบข้อมูล
7. Import ไฟล์ JSON ที่ parse ไม่ได้, ไม่มี `items`, มี ID ซ้ำ และมี Barcode ซ้ำ ตรวจว่าข้อมูลเดิมไม่เปลี่ยน
8. โหลดระบบหนึ่งครั้ง ตัดเครือข่าย แล้วเปิดหรือรีเฟรชระบบเพื่อตรวจ Offline fallback
9. ทดสอบ Scan บนอุปกรณ์ที่รองรับและไม่รองรับ `BarcodeDetector` รวมถึงกรณีปฏิเสธสิทธิ์กล้อง
10. ตรวจ Console และหน้าจอความกว้างประมาณ 320, 375 และ 430 px
