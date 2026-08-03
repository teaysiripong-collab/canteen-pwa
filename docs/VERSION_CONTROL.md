# Version Control Workflow

เอกสารนี้กำหนดวิธีใช้ Git และ GitHub สำหรับโปรเจกต์ MEKTEC Canteen Management PWA เพื่อให้แก้ไขระบบได้อย่างปลอดภัย ย้อนกลับได้ และตรวจสอบประวัติได้ชัดเจน

## Branch หลัก

### `main`
- เก็บโค้ดที่ผ่านการตรวจสอบและพร้อมใช้งาน
- ห้ามพัฒนาฟีเจอร์หรือแก้บั๊กโดยตรงบน `main`
- การเปลี่ยนแปลงต้องเข้า `main` ผ่าน Pull Request

### `develop`
- ใช้รวมงานที่กำลังเตรียมสำหรับ Release ถัดไป
- Feature/Fix branch สามารถเปิด PR เข้า `develop` ก่อน แล้วค่อยรวม `develop` เข้า `main` เมื่อพร้อม Release

## รูปแบบชื่อ Branch

- `feature/<ชื่อฟีเจอร์>` เช่น `feature/stock-transfer`
- `fix/<ชื่อบั๊ก>` เช่น `fix/negative-stock`
- `chore/<งานระบบ>` เช่น `chore/version-control`
- `docs/<งานเอกสาร>` เช่น `docs/user-manual`
- `hotfix/<ปัญหาเร่งด่วน>` เช่น `hotfix/login-blocked`

ใช้ตัวอักษรอังกฤษพิมพ์เล็กและคั่นคำด้วย `-`

## Workflow มาตรฐาน

1. เริ่มงานจาก `develop` หรือ `main` ตามประเภทงาน
2. สร้าง Branch ใหม่สำหรับงานนั้นเพียงงานเดียว
3. แก้ไขโค้ดและ Commit เป็นช่วงเล็ก ๆ
4. Push Branch ขึ้น GitHub
5. เปิด Pull Request
6. ตรวจ CI, Diff, ความเสี่ยง และวิธีทดสอบ
7. ทดสอบบนมือถือหากมีการเปลี่ยน UI หรือ workflow ผู้ใช้งาน
8. Merge เมื่อผ่านการตรวจสอบ
9. ลบ Feature/Fix branch หลัง Merge หากไม่จำเป็นต้องเก็บ

## Commit Message

ใช้รูปแบบ Conventional Commit แบบอ่านง่าย

- `feat: เพิ่มระบบโอนสต๊อกระหว่างตึก`
- `fix: ป้องกันยอดคงเหลือติดลบ`
- `docs: อัปเดตคู่มือ Version Control`
- `chore: เพิ่ม GitHub Actions`
- `refactor: แยก logic การคำนวณสต๊อก`
- `test: เพิ่มกรณีทดสอบการเบิกวัตถุดิบ`

Commit หนึ่งครั้งควรมีจุดประสงค์หลักเพียงเรื่องเดียว

## Pull Request ต้องมี

- สรุปว่าแก้อะไร
- เหตุผลที่แก้
- วิธีทดสอบ
- ความเสี่ยงหรือผลกระทบ
- Screenshot ก่อน/หลัง เมื่อมีการเปลี่ยน UI
- อัปเดต `TASKS.md` และ `CHANGELOG.md` เมื่อเกี่ยวข้อง

## Release และ Version

ใช้ Semantic Versioning: `MAJOR.MINOR.PATCH`

ตัวอย่าง:
- `0.1.0` เวอร์ชันเริ่มต้นระหว่างพัฒนา
- `0.2.0` เพิ่มฟีเจอร์ใหม่ที่ยังเข้ากันกับของเดิม
- `0.2.1` แก้บั๊ก
- `1.0.0` เวอร์ชัน Production แรกที่พร้อมใช้งานจริง

เมื่อ Release:
1. ตรวจว่า CI ผ่าน
2. อัปเดต `CHANGELOG.md`
3. อัปเดตไฟล์ `VERSION`
4. Merge เข้า `main`
5. สร้าง Git Tag เช่น `v0.2.0`
6. สร้าง GitHub Release พร้อมสรุปการเปลี่ยนแปลง

## Hotfix

เมื่อ Production มีปัญหาเร่งด่วน:
1. สร้าง `hotfix/<ชื่อปัญหา>` จาก `main`
2. แก้เฉพาะปัญหาที่จำเป็น
3. เปิด PR เข้า `main`
4. ทดสอบและ Merge
5. เพิ่ม PATCH version เช่น `0.2.0` → `0.2.1`
6. นำการแก้กลับเข้า `develop` เพื่อไม่ให้บั๊กกลับมาใน Release ถัดไป

## กฎความปลอดภัย

- ห้ามเก็บ API Key, Token, Password หรือ Secret ใน Repository
- ห้าม Force Push เข้า `main`
- ห้าม Merge PR ที่ CI ไม่ผ่าน
- ห้ามลบข้อมูลหรือฟีเจอร์เดิมโดยไม่มีการตรวจผลกระทบ
- งานสต๊อกที่กระทบยอดคงเหลือต้องมี Test Plan ชัดเจน

## Branch Protection ที่แนะนำใน GitHub Settings

สำหรับ `main`:
- Require a pull request before merging
- Require status checks to pass before merging
- Block force pushes
- Require conversation resolution before merging

สำหรับ `develop`:
- Require status checks to pass before merging
- Block force pushes

แนวทางนี้ช่วยให้โปรเจกต์สามารถพัฒนาหลายฟีเจอร์พร้อมกันได้ โดย `main` ยังเป็นจุดอ้างอิงที่เสถียรและย้อนเวอร์ชันได้เสมอ
