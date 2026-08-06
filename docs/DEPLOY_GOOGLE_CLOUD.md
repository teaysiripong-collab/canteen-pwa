# คู่มือติดตั้งบน Google Cloud

ระบบจะรันบน **Cloud Run** และเก็บข้อมูลใน **Cloud SQL for PostgreSQL** ซึ่งเป็นฐานข้อมูลถาวร
มี Backup อัตโนมัติ และอยู่ในโปรเจกต์ Google Cloud ของบริษัทเอง

> ⚠️ ข้อมูลจะถาวรก็ต่อเมื่อทำขั้นตอนในเอกสารนี้ครบแล้วเท่านั้น
> ฐานข้อมูลที่ใช้ตอนพัฒนาเป็นแบบชั่วคราวและไม่ได้เก็บข้อมูลของคุณ

---

## 0. เตรียมตัว

ต้องมี: บัญชี Google Cloud ที่เปิด Billing แล้ว และติดตั้ง [gcloud CLI](https://cloud.google.com/sdk/docs/install)

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  drive.googleapis.com
```

ตั้งค่าตัวแปรที่จะใช้ซ้ำตลอดคู่มือ

```bash
export PROJECT_ID="YOUR_PROJECT_ID"
export REGION="asia-southeast1"          # สิงคโปร์ — ใกล้ไทยที่สุด
export INSTANCE="canteen-db"
export SERVICE="canteen"
```

---

## 1. สร้างฐานข้อมูล Cloud SQL

```bash
gcloud sql instances create $INSTANCE \
  --database-version=POSTGRES_16 \
  --tier=db-g1-small \
  --region=$REGION \
  --storage-size=10GB \
  --storage-auto-increase \
  --backup-start-time=19:00 \
  --retained-backups-count=30 \
  --availability-type=zonal
```

* `--backup-start-time=19:00` คือ 02:00 น. ตามเวลาไทย (UTC+7) — นอกเวลาทำงาน
* เก็บ Backup ย้อนหลัง 30 วัน
* ขนาด `db-g1-small` เพียงพอสำหรับแคนทีนขนาดกลาง ขยายทีหลังได้

เปิด Point-in-time recovery (กู้ข้อมูลย้อนไปนาทีใดก็ได้ — ป้องกันการลบผิดพลาด)

```bash
gcloud sql instances patch $INSTANCE --enable-point-in-time-recovery
```

สร้างฐานข้อมูลและผู้ใช้

```bash
gcloud sql databases create canteen --instance=$INSTANCE

export DB_PASSWORD="$(openssl rand -base64 24)"
gcloud sql users create canteen --instance=$INSTANCE --password="$DB_PASSWORD"
echo "เก็บรหัสผ่านนี้ไว้ให้ดี: $DB_PASSWORD"
```

---

## 2. เก็บความลับใน Secret Manager

อย่าใส่รหัสผ่านตรงๆ ในคำสั่ง deploy

```bash
export CONNECTION_NAME="$(gcloud sql instances describe $INSTANCE --format='value(connectionName)')"

printf 'postgresql://canteen:%s@localhost/canteen?host=/cloudsql/%s' \
  "$DB_PASSWORD" "$CONNECTION_NAME" \
  | gcloud secrets create canteen-database-url --data-file=-

openssl rand -base64 48 | gcloud secrets create canteen-auth-secret --data-file=-
```

---

## 3. สร้าง Service Account ให้แอป

```bash
gcloud iam service-accounts create canteen-app --display-name="Canteen App"
export SA="canteen-app@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/cloudsql.client"

for S in canteen-database-url canteen-auth-secret; do
  gcloud secrets add-iam-policy-binding $S \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
done
```

> อีเมลใน `$SA` คือตัวเดียวกับที่จะใช้แชร์โฟลเดอร์ Google Drive ในขั้นตอนที่ 6

---

## 4. Deploy ขึ้น Cloud Run

```bash
gcloud run deploy $SERVICE \
  --source . \
  --region=$REGION \
  --service-account=$SA \
  --add-cloudsql-instances=$CONNECTION_NAME \
  --set-secrets=DATABASE_URL=canteen-database-url:latest,AUTH_SECRET=canteen-auth-secret:latest \
  --min-instances=0 \
  --max-instances=10 \
  --memory=1Gi \
  --cpu=1 \
  --allow-unauthenticated
```

* `--allow-unauthenticated` หมายถึงเปิดให้เข้าถึงหน้าเว็บได้ —
  **การล็อกอินของระบบยังบังคับเสมอ** (middleware ตรวจ session ทุก request)
* `--min-instances=1` จะเร็วขึ้น (ไม่มี cold start) แต่มีค่าใช้จ่ายตลอดเวลา

---

## 5. สร้างตารางและบัญชี Admin (ทำครั้งเดียว)

รันจากเครื่องตัวเองผ่าน Cloud SQL Auth Proxy

```bash
# เทอร์มินัลที่ 1
cloud-sql-proxy $CONNECTION_NAME

# เทอร์มินัลที่ 2
export DATABASE_URL="postgresql://canteen:$DB_PASSWORD@127.0.0.1:5432/canteen"
npm run db:push
ADMIN_PASSWORD="รหัสผ่านที่ปลอดภัยของคุณ" npm run db:seed
```

`db:seed` สร้างเฉพาะ **บัญชี Admin + หน่วยนับ + หมวดหมู่พื้นฐาน** เท่านั้น
ไม่มีข้อมูลตัวอย่างปนเข้าระบบจริง

จากนั้นเข้าเว็บ → **Master Data → นำเข้าจาก Excel** เพื่อใส่ข้อมูลจริงของแคนทีน

---

## 6. เชื่อม Google Drive (ถ้าต้องการ)

Cloud Run ใช้ Service Account ที่ผูกไว้แล้วโดยอัตโนมัติ จึง **ไม่ต้องสร้าง JSON key**

1. เปิด Google Drive → คลิกขวาที่โฟลเดอร์ที่ต้องการ → **แชร์**
2. ใส่อีเมล Service Account (ค่าใน `$SA` จากขั้นตอนที่ 3) → ให้สิทธิ์ **ผู้แก้ไข (Editor)**
3. คัดลอก Folder ID จาก URL: `drive.google.com/drive/folders/`**`1AbC…xyz`**
4. เข้าเว็บ → **ตั้งค่า → Google Drive** → วาง Folder ID → กด **ทดสอบการเชื่อมต่อ**

ถ้าใช้ **Shared Drive** ให้เพิ่ม Service Account เป็นสมาชิกของ Shared Drive นั้นแทน

> ระบบขอสิทธิ์เฉพาะขอบเขต `drive.file` — เห็นได้เฉพาะไฟล์ที่ระบบสร้างเอง
> และโฟลเดอร์ที่คุณแชร์ให้เท่านั้น **ไม่เห็น Google Drive ทั้งหมดของคุณ**

---

## 7. Backup และการกู้คืน

Cloud SQL สำรองข้อมูลอัตโนมัติทุกวันตามที่ตั้งไว้ในขั้นตอนที่ 1 อยู่แล้ว

ตรวจรายการ Backup

```bash
gcloud sql backups list --instance=$INSTANCE
```

กู้คืนจาก Backup

```bash
gcloud sql backups restore BACKUP_ID --restore-instance=$INSTANCE
```

กู้กลับไป ณ เวลาใดเวลาหนึ่ง (ต้องเปิด point-in-time recovery ไว้)

```bash
gcloud sql instances clone $INSTANCE ${INSTANCE}-recovered \
  --point-in-time='2026-08-06T10:30:00Z'
```

สำรองเป็นไฟล์เก็บไว้เอง (เช่น ก่อนอัปเดตระบบ)

```bash
./scripts/backup.sh
```

---

## 8. อัปเดตระบบในภายหลัง

```bash
git pull
gcloud run deploy $SERVICE --source . --region=$REGION
```

ถ้ามีการเปลี่ยนโครงสร้างฐานข้อมูล ให้รัน `npm run db:push` ผ่าน Cloud SQL Auth Proxy
(ขั้นตอนที่ 5) **ก่อน** deploy และ **สำรองข้อมูลก่อนเสมอ**

---

## ค่าใช้จ่ายโดยประมาณ

| รายการ | ประมาณการต่อเดือน |
|---|---|
| Cloud SQL `db-g1-small` 10GB | ~$25–35 |
| Cloud Run (`min-instances=0`) | ~$0–5 |
| Artifact Registry | ~$0.5 |

ตัวเลขนี้เป็นการประมาณเท่านั้น — ดูค่าจริงที่
[Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator)

---

## ทางเลือกอื่นถ้ายังไม่พร้อมใช้ Google Cloud

* **เครื่องในบริษัท (on-premise):** ติดตั้ง PostgreSQL 16 + Docker แล้วรัน `docker build` จาก `Dockerfile` นี้ได้เลย
  ต้องตั้ง `pg_dump` ใน cron เองสำหรับ backup (ดู `scripts/backup.sh`)
* **Neon / Supabase:** ฐานข้อมูล PostgreSQL สำเร็จรูป มี free tier — เปลี่ยนแค่ `DATABASE_URL`
  แล้ว deploy แอปที่ Vercel ได้ (แต่ Google Drive ยังต้องใช้ Service Account เหมือนเดิม)
