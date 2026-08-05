# Deployment Guide

## Deploy ครั้งแรก

1. ใน Apps Script Editor: **Deploy → New deployment**
2. ⚙ เลือก type **Web app**
3. ตั้งค่า:
   - Description: `v1 - Phase 1`
   - **Execute as: User deploying** — ทุก transaction เขียนลง Sheet/Drive ของเจ้าของระบบ ผู้ใช้ไม่ต้องมีสิทธิ์เข้า Spreadsheet โดยตรง (ปลอดภัยกว่า)
   - **Who has access:**
     - Google Workspace: `Anyone within <องค์กร>` — แนะนำ
     - Gmail ธรรมดา: `Anyone with Google account`
4. กด **Deploy** → ได้ **Web app URL** (ลงท้าย `/exec`) — URL นี้คือลิงก์ที่แจกพนักงาน

> หมายเหตุ: ค่าใน `appsscript.json` ตั้ง `access: ANYONE` (ต้อง sign-in ด้วยบัญชี Google เสมอ — ไม่ใช่ public) — ถ้าใช้ Google Workspace แนะนำเปลี่ยนเป็น `DOMAIN` เพื่อจำกัดเฉพาะคนในองค์กร

## ติดตั้งบนมือถือ (ใช้เหมือนแอป)

- **Android (Chrome)**: เปิด URL → เมนู ⋮ → *Add to Home screen*
- **iOS (Safari)**: เปิด URL → Share → *Add to Home Screen*

## อัปเดตโค้ดเวอร์ชันใหม่

URL `/exec` ผูกกับ deployment version — push โค้ดใหม่แล้วต้องอัปเดต version:

1. แก้โค้ด (หรือ `clasp push`)
2. **Deploy → Manage deployments** → เลือก deployment เดิม → ✏ Edit
3. Version: **New version** → Deploy

URL เดิมไม่เปลี่ยน พนักงานไม่ต้องติดตั้งใหม่

ระหว่างพัฒนา ใช้ **Test deployment** (URL ลงท้าย `/dev`) — เห็นโค้ดล่าสุดทันทีไม่ต้องสร้าง version

## สิทธิ์และความปลอดภัย

- OAuth scopes ที่ขอ: Spreadsheets, Drive, Script triggers, User email (ดู `appsscript.json`)
- Web app ทำงานในนามเจ้าของระบบ → พนักงานไม่เห็น Spreadsheet ตรง ๆ แต่ระบบยังรู้ email ผู้ใช้ผ่าน `Session.getActiveUser()` เพื่อ auto-fill
- ทุกการบันทึกต้องผ่าน Employee ID ที่ `Active` ใน USER_MASTER — validate ฝั่ง server เสมอ
- การเข้าถึง Spreadsheet โดยตรงให้จำกัดเฉพาะ Admin/Manager (แชร์ไฟล์ตามปกติของ Drive)

## Checklist ก่อนใช้งานจริง

- [ ] รัน `setupSystem`, `seedSampleData` (หรือใส่ master จริง), `installTriggers` แล้ว
- [ ] ทดสอบตาม [TEST_CHECKLIST.md](TEST_CHECKLIST.md) ผ่านครบ
- [ ] ใส่ USER_MASTER จริงครบทุกคน และลบ/ปิดรหัสทดสอบ
- [ ] แชร์ Web app URL ให้พนักงาน + สอนขั้นตอน รับ/เบิก
- [ ] ตรวจว่า backup แรกโผล่ใน `07_Backup` เช้าวันถัดไป
