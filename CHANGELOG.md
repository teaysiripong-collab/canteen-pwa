# Changelog

การเปลี่ยนแปลงสำคัญของโปรเจกต์จะบันทึกในไฟล์นี้

รูปแบบหมวดหมู่:

- `Added` เพิ่มสิ่งใหม่
- `Changed` เปลี่ยนพฤติกรรมหรือโครงสร้างเดิม
- `Fixed` แก้ข้อผิดพลาด
- `Removed` นำสิ่งเดิมออก
- `Security` ปรับปรุงความปลอดภัย

## [Unreleased]

### Added

- เพิ่ม `AGENTS.md` เป็นกฎกลางสำหรับ ChatGPT, Codex และนักพัฒนา
- เพิ่ม `PROJECT_CONTEXT.md` เพื่ออธิบายบริบทธุรกิจ ระบบปัจจุบัน และเป้าหมายผลิตภัณฑ์
- เพิ่ม `TASKS.md` สำหรับ Current Sprint, Backlog และเรื่องที่รอตัดสินใจ
- เพิ่ม `README.md` สำหรับการเริ่มต้นใช้งาน Repository
- เพิ่ม `docs/AI_WORKFLOW.md` สำหรับกระบวนการทำงานร่วมกันผ่าน GitHub
- เพิ่ม `docs/DATA_MODEL.md` สำหรับแบบจำลองข้อมูลเป้าหมาย
- เพิ่ม `docs/PRIORITY_0_AUDIT.md` สรุปโครงสร้าง ปัญหาที่พบ การทดสอบ และข้อจำกัดของระบบเดิม

### Changed

- ปรับ Service Worker ให้ใช้ Cache รุ่นใหม่และใช้ Network-first สำหรับ Navigation พร้อม Offline fallback
- เพิ่มข้อความผิดพลาดภาษาไทยสำหรับการบันทึก Import และ Barcode scanner

### Fixed

- ป้องกันการกดบันทึกซ้ำระหว่าง IndexedDB กำลังทำงาน
- ป้องกัน Barcode / SKU ซ้ำและค่าจำนวน ราคา หรือจุดเตือนที่ไม่ถูกต้อง
- ตรวจโครงสร้าง JSON ทั้งไฟล์และเขียน Import แบบ transaction เดียว เพื่อไม่ให้ข้อมูลเดิมเสียบางส่วน
- จัดการข้อผิดพลาดจากการบันทึก ลบ และเริ่มระบบเพื่อลด Unhandled Promise Rejection

## [Initial PWA Scaffold]

### Added

- Progressive Web App แบบ Offline-first
- Item CRUD และการค้นหา/กรอง
- IndexedDB storage
- Low-stock threshold และสถานะแจ้งเตือน
- Barcode scanning ผ่าน BarcodeDetector API
- REST sync configuration
- JSON export/import
- Service Worker และ Web App Manifest
