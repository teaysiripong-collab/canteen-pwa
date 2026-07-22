# AI Collaboration Workflow

คู่มือนี้กำหนดวิธีให้ผู้ใช้ ChatGPT Codex และ GitHub ทำงานต่อกันโดยใช้ Repository เป็นแหล่งข้อมูลกลาง

## บทบาทของแต่ละส่วน

### ผู้ใช้

- บอกปัญหา เป้าหมาย และข้อจำกัดทางธุรกิจ
- ตรวจหน้าจอและผลการทำงานจริง
- อนุมัติเรื่องสำคัญ เช่น สูตร ราคา สิทธิ์ และการ Merge

### ChatGPT

- ช่วยวิเคราะห์ความต้องการ
- ช่วยแตกงานและจัดลำดับความสำคัญ
- อ่าน Repository เพื่อให้คำแนะนำจากโค้ดล่าสุด
- ตรวจ Pull Request, Diff, ความเสี่ยง และวิธีทดสอบ

### Codex

- อ่านเอกสารกลางและโค้ดจริง
- สร้าง Branch หรือทำงานใน Branch ที่กำหนด
- แก้โค้ด ทดสอบ และอัปเดตเอกสาร
- เปิด Draft Pull Request

### GitHub

- เป็น Source of Truth ของโค้ดและเอกสาร
- เก็บประวัติ Branch, Commit, Pull Request และ Issue
- ใช้ตรวจสอบว่าใครแก้อะไรและย้อนกลับได้

## Workflow มาตรฐาน

### 1. บอกความต้องการกับ ChatGPT

ตัวอย่าง:

```text
ในระบบ canteen-pwa ต้องการเพิ่มวันหมดอายุและแจ้งเตือนก่อน 7 วัน
ช่วยอ่าน PROJECT_CONTEXT.md และวางแผนงานก่อน
```

### 2. ChatGPT ช่วยกำหนดขอบเขต

ผลลัพธ์ที่ควรได้:

- ปัญหาที่จะแก้
- Acceptance criteria
- โครงสร้างข้อมูลที่ต้องเพิ่ม
- ไฟล์ที่คาดว่าจะกระทบ
- ความเสี่ยง
- วิธีทดสอบ

จากนั้นบันทึกหรืออัปเดตงานใน `TASKS.md` หรือ GitHub Issue

### 3. ส่งงานให้ Codex

Prompt มาตรฐาน:

```text
อ่าน AGENTS.md, PROJECT_CONTEXT.md, TASKS.md และ CHANGELOG.md ก่อน

ทำงาน: <ชื่องาน>

ก่อนแก้โค้ด ให้สรุปความเข้าใจและระบุไฟล์ที่เกี่ยวข้อง
รักษาฟีเจอร์เดิมทั้งหมด
เพิ่ม validation และข้อความภาษาไทย
ทดสอบกรณีปกติและกรณีผิดพลาด
เมื่อเสร็จให้อัปเดต TASKS.md และ CHANGELOG.md
จากนั้นเปิด Draft Pull Request พร้อมสรุปและวิธีทดสอบ
```

### 4. Codex เปิด Draft Pull Request

Pull Request ต้องมี:

- Summary
- สิ่งที่เปลี่ยน
- ไฟล์ที่แก้
- Testing performed
- Manual test steps
- Risks / limitations
- Screenshots เมื่อแก้ UI
- ข้อมูล Migration เมื่อเปลี่ยนฐานข้อมูล

### 5. ให้ ChatGPT ตรวจ Pull Request

ตัวอย่าง:

```text
ช่วยตรวจ Pull Request นี้
อ่าน AGENTS.md และ PROJECT_CONTEXT.md ก่อน
ตรวจ Bug, ผลกระทบต่อข้อมูล, UX มือถือ และสิ่งที่ยังไม่ได้ทดสอบ
```

### 6. ผู้ใช้ทดสอบจริง

ตรวจอย่างน้อย:

- เปิดระบบได้
- บันทึกข้อมูลได้
- รีเฟรชแล้วข้อมูลยังอยู่
- กรอกข้อมูลผิดแล้วมีข้อความแจ้ง
- กดซ้ำแล้วไม่สร้างรายการซ้ำ
- หน้าจอมือถือไม่ล้น
- ฟีเจอร์เดิมยังใช้งานได้

### 7. Merge

Merge เมื่อ:

- ไม่มี Bug สำคัญ
- ข้อมูลไม่เสี่ยงสูญหาย
- ทดสอบตาม Acceptance criteria แล้ว
- Task และ Changelog อัปเดตแล้ว

## รูปแบบ Branch

- `feature/<feature-name>` เพิ่มฟีเจอร์
- `fix/<bug-name>` แก้ Bug
- `docs/<topic>` เอกสาร
- `refactor/<scope>` ปรับโครงสร้างโดยไม่เปลี่ยนพฤติกรรม
- `setup/<topic>` ตั้งค่าโครงการ

ตัวอย่าง:

```text
feature/expiry-alerts
fix/duplicate-save
feature/location-transfer
```

## รูปแบบ Commit

```text
feat: add expiry date fields
fix: prevent duplicate stock transaction
refactor: split inventory service
Docs: update stock workflow
```

Commit ควรระบุการเปลี่ยนแปลงหนึ่งเรื่องและย้อนกลับได้ง่าย

## การส่งบริบทระหว่าง ChatGPT และ Codex

ทั้งสองระบบไม่ควรพึ่งความจำจากบทสนทนาเก่าเป็นหลัก ให้บันทึกข้อมูลที่ต้องใช้ต่อไว้ใน Repository:

- กฎถาวร → `AGENTS.md`
- บริบทระบบ → `PROJECT_CONTEXT.md`
- งานปัจจุบัน → `TASKS.md`
- สิ่งที่แก้แล้ว → `CHANGELOG.md`
- การตัดสินใจสำคัญ → GitHub Issue หรือเอกสารใน `docs/`

เมื่อทุกฝ่ายอ่านข้อมูลชุดเดียวกัน การทำงานจะไม่หลุดบริบทหรือแก้คนละเวอร์ชัน

## Prompt ตรวจงานแบบรวดเร็ว

```text
อ่าน AGENTS.md และ PROJECT_CONTEXT.md
ตรวจการเปลี่ยนแปลงใน Branch นี้เทียบกับ Branch หลัก

รายงานเฉพาะ:
1. Bug หรือความเสี่ยง
2. สิ่งที่ขัดกับกฎธุรกิจ
3. ผลกระทบต่อข้อมูลเดิม
4. สิ่งที่ควรทดสอบเพิ่ม
5. ผ่านหรือยังไม่ควร Merge
```

## ห้ามทำ

- ห้ามให้หลาย AI แก้ Branch เดียวกันพร้อมกันโดยไม่แบ่งขอบเขต
- ห้ามคัดลอก Secret ลง Prompt หรือ Repository
- ห้าม Merge งานใหญ่โดยไม่ดู Diff
- ห้ามให้ AI เดาราคา สูตร ยอดสต๊อก หรือสิทธิ์จริง
- ห้ามให้ AI ลบข้อมูลหรือเปลี่ยน Schema Production โดยไม่มี Backup/Migration plan
