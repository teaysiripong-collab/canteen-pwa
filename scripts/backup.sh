#!/usr/bin/env bash
# สำรองฐานข้อมูล Canteen Management System เป็นไฟล์
#
#   ./scripts/backup.sh [โฟลเดอร์ปลายทาง]
#
# ใช้ DATABASE_URL จาก .env หรือจาก environment
# ถ้าฐานข้อมูลอยู่บน Cloud SQL ให้เปิด cloud-sql-proxy ไว้ก่อน
#
# ตั้งให้ทำอัตโนมัติทุกวันตี 2:
#   0 2 * * * cd /path/to/canteen-pwa && ./scripts/backup.sh >> /var/log/canteen-backup.log 2>&1

set -euo pipefail

OUT_DIR="${1:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -E '^DATABASE_URL=' .env | xargs) 2>/dev/null || true
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "✗ ไม่พบ DATABASE_URL — ตั้งค่าใน .env หรือ export ก่อนรัน" >&2
  exit 1
fi

command -v pg_dump >/dev/null 2>&1 || { echo "✗ ไม่พบคำสั่ง pg_dump (ติดตั้ง postgresql-client ก่อน)" >&2; exit 1; }

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/canteen-$STAMP.dump"

echo "→ กำลังสำรองข้อมูลไปที่ $FILE"
# -Fc = custom format บีบอัดและกู้คืนแบบเลือกตารางได้
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --file="$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ สำรองข้อมูลเสร็จ ($SIZE)"

# ลบไฟล์เก่าเกินกำหนด
DELETED="$(find "$OUT_DIR" -name 'canteen-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')"
[ "$DELETED" -gt 0 ] && echo "• ลบไฟล์สำรองเก่ากว่า $KEEP_DAYS วัน จำนวน $DELETED ไฟล์"

echo
echo "วิธีกู้คืน:"
echo "  pg_restore --dbname=\"\$DATABASE_URL\" --clean --if-exists --no-owner \"$FILE\""
