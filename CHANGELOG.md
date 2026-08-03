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
- เพิ่ม Project-local Skill `canteen-stock` สำหรับงาน Stock, Transaction, Lot, Expiry และ FEFO
- เพิ่ม Project-local Skill `menu-recipe` สำหรับ Recipe, Menu Plan, การ Scale สูตร และ AI-assisted draft recipe
- เพิ่ม Project-local Skill `purchasing` สำหรับ Vendor, Purchase Plan, จำนวนแนะนำให้ซื้อ และ Export
- เพิ่ม Project-local Skill `canteen-ui-ux` สำหรับ Mobile-first UI, ภาษาไทย, Accessibility และ Offline/Sync UX
- เพิ่ม Project-local Skill `bug-fix` สำหรับ Root-cause debugging, regression protection และ data-safety checks

### Changed

- ปรับ `AGENTS.md` ให้ตรวจและโหลด Skill ใน `.agents/skills/` ตามประเภทงานก่อนแก้ไขโค้ด

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
