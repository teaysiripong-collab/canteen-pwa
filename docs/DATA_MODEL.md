# Target Data Model

เอกสารนี้เป็นแบบจำลองข้อมูลเป้าหมายสำหรับการพัฒนาระบบในอนาคต ยังไม่ใช่คำสั่งให้เปลี่ยนฐานข้อมูล Production ทันที

## Design Principles

- ใช้ ID ที่ไม่เปลี่ยนแม้ชื่อถูกแก้
- เก็บ `createdAt`, `updatedAt` และผู้ทำรายการเมื่อเหมาะสม
- ใช้เวลา `Asia/Bangkok` สำหรับการแสดงผล แต่ควรเก็บ Timestamp ในรูปแบบมาตรฐาน
- ข้อมูลประวัติสำคัญไม่ควรถูกลบถาวร
- Transaction ต้องตรวจสอบย้อนหลังได้
- ราคา ณ เวลาทำรายการต้องไม่เปลี่ยนตามราคาปัจจุบันของ Item
- จำนวนและหน่วยต้องถูกตรวจสอบก่อนคำนวณ

## Entity Overview

```text
User
  └── creates StockTransaction

Vendor
  └── supplies Item

Item
  ├── has StockLot by Location
  ├── appears in RecipeLine
  └── appears in PurchaseLine

Location
  └── owns StockLot balance

Recipe
  └── has RecipeLine

MenuPlan
  └── references Recipe

PurchaseOrder
  └── has PurchaseLine
```

## User

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสภายในระบบ |
| empCode | string | yes | รหัสพนักงาน ไม่ซ้ำ |
| displayName | string | yes | ชื่อที่แสดง |
| role | enum | yes | ADMIN, SUPERVISOR, PURCHASING, STAFF, VIEWER |
| defaultLocationId | string | no | สถานที่เริ่มต้น |
| active | boolean | yes | สถานะใช้งาน |
| createdAt | timestamp | yes | วันที่สร้าง |
| updatedAt | timestamp | yes | วันที่แก้ล่าสุด |

## Location

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสสถานที่ |
| code | string | yes | เช่น B1, B16 |
| name | string | yes | ตึก 1, ตึก 16 |
| active | boolean | yes | สถานะใช้งาน |

ค่าตั้งต้นที่คาดไว้:

```text
B1  = ตึก 1
B16 = ตึก 16
```

## Vendor

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสผู้ขาย |
| code | string | yes | รหัสย่อ |
| name | string | yes | ชื่อผู้ขาย |
| contactName | string | no | ผู้ติดต่อ |
| phone | string | no | โทรศัพท์ |
| leadTimeDays | number | no | ระยะเวลาสั่งล่วงหน้า |
| deliveryDays | array | no | วันที่ส่งประจำ |
| active | boolean | yes | สถานะใช้งาน |

## Item

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสภายใน |
| itemCode | string | yes | รหัสวัตถุดิบ ไม่ซ้ำ |
| barcode | string | no | Barcode/SKU |
| name | string | yes | ชื่อวัตถุดิบ |
| categoryId | string | no | หมวดหมู่ |
| baseUnit | string | yes | หน่วยใช้งาน เช่น kg, L, pack |
| purchaseUnit | string | no | หน่วยซื้อ |
| conversionRate | number | no | purchaseUnit 1 หน่วยเท่ากับ baseUnit เท่าไร |
| defaultVendorId | string | no | Vendor เริ่มต้น |
| currentReferencePrice | decimal | no | ราคาอ้างอิงล่าสุด ไม่ใช่ต้นทุนย้อนหลัง |
| reorderPoint | decimal | no | จุดเตือนสั่งซื้อ |
| trackLot | boolean | yes | ต้องติดตาม Lot หรือไม่ |
| trackExpiry | boolean | yes | ต้องติดตามวันหมดอายุหรือไม่ |
| active | boolean | yes | สถานะใช้งาน |
| createdAt | timestamp | yes | วันที่สร้าง |
| updatedAt | timestamp | yes | วันที่แก้ล่าสุด |

## StockLot

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัส Lot balance |
| itemId | string | yes | วัตถุดิบ |
| locationId | string | yes | สถานที่ |
| lotNumber | string | no | เลข Lot |
| receivedDate | date | yes | วันที่รับ |
| expiryDate | date | no | วันหมดอายุ |
| receivedQty | decimal | yes | จำนวนรับเดิม |
| remainingQty | decimal | yes | จำนวนคงเหลือ |
| baseUnit | string | yes | หน่วยฐาน ณ ตอนรับ |
| unitCost | decimal | yes | ต้นทุนต่อหน่วย ณ ตอนรับ |
| vendorId | string | no | ผู้ขาย |
| receiveTransactionId | string | yes | รายการรับเข้าต้นทาง |
| status | enum | yes | ACTIVE, DEPLETED, CANCELLED |
| createdAt | timestamp | yes | วันที่สร้าง |
| updatedAt | timestamp | yes | วันที่แก้ล่าสุด |

Suggested unique rule เมื่อมีข้อมูล:

```text
itemId + locationId + lotNumber + expiryDate + receiveTransactionId
```

## StockTransaction

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสรายการ |
| transactionNo | string | yes | เลขเอกสาร ไม่ซ้ำ |
| type | enum | yes | RECEIVE, ISSUE, TRANSFER, ADJUST, CANCEL |
| status | enum | yes | DRAFT, POSTED, CANCELLED |
| transactionAt | timestamp | yes | วันเวลารายการ |
| createdByUserId | string | yes | ผู้ทำรายการ |
| approvedByUserId | string | no | ผู้อนุมัติ |
| fromLocationId | string | no | ต้นทาง |
| toLocationId | string | no | ปลายทาง |
| vendorId | string | no | ผู้ขายสำหรับ RECEIVE |
| referenceNo | string | no | เลขบิล/เอกสารอ้างอิง |
| note | string | no | หมายเหตุ |
| createdAt | timestamp | yes | วันที่สร้าง |
| updatedAt | timestamp | yes | วันที่แก้ล่าสุด |

## StockTransactionLine

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสบรรทัด |
| transactionId | string | yes | รายการแม่ |
| itemId | string | yes | วัตถุดิบ |
| stockLotId | string | no | Lot ที่เกี่ยวข้อง |
| quantity | decimal | yes | จำนวนต้องมากกว่า 0 |
| baseUnit | string | yes | หน่วยฐาน |
| unitCost | decimal | yes | ต้นทุน ณ วันที่ทำรายการ |
| totalCost | decimal | yes | quantity × unitCost |
| expiryDate | date | no | ใช้ตอนรับเข้าเมื่อสร้าง Lot |
| lotNumber | string | no | ใช้ตอนรับเข้า |
| note | string | no | หมายเหตุบรรทัด |

## Recipe

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสสูตร |
| recipeCode | string | yes | รหัสสูตร ไม่ซ้ำ |
| name | string | yes | ชื่อเมนู |
| mealType | string | no | ประเภทมื้อหรือเมนู |
| standardServings | decimal | yes | จำนวนเสิร์ฟมาตรฐาน |
| instructionUrl | string | no | ลิงก์สูตร/วิดีโอ/เอกสาร |
| version | number | yes | เวอร์ชันสูตร |
| active | boolean | yes | สถานะใช้งาน |
| createdAt | timestamp | yes | วันที่สร้าง |
| updatedAt | timestamp | yes | วันที่แก้ล่าสุด |

## RecipeLine

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสบรรทัด |
| recipeId | string | yes | สูตรแม่ |
| itemId | string | yes | วัตถุดิบ |
| quantity | decimal | yes | ปริมาณต่อสูตรมาตรฐาน |
| unit | string | yes | หน่วย |
| wastePercent | decimal | no | เปอร์เซ็นต์สูญเสีย/เผื่อ |
| note | string | no | หมายเหตุ |

สูตรคำนวณเบื้องต้น:

```text
requiredQty = (plannedServings / standardServings)
              × recipeLine.quantity
              × (1 + wastePercent / 100)
```

ต้องกำหนดหลักการปัดเศษตามหน่วยซื้อก่อนใช้จริง

## MenuPlan

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสแผน |
| serviceDate | date | yes | วันที่บริการ |
| shift | enum | yes | MORNING, NIGHT หรือค่าที่องค์กรกำหนด |
| locationId | string | no | สถานที่บริการ |
| recipeId | string | yes | เมนู |
| plannedServings | decimal | yes | จำนวนตามแผน |
| reserveServings | decimal | no | จำนวนสำรอง |
| status | enum | yes | DRAFT, CONFIRMED, COMPLETED, CANCELLED |
| note | string | no | หมายเหตุ |

## PurchaseOrder

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสเอกสาร |
| purchaseOrderNo | string | yes | เลขใบสั่งซื้อ |
| vendorId | string | yes | ผู้ขาย |
| orderDate | date | yes | วันที่สั่ง |
| expectedDate | date | yes | วันที่รับคาดการณ์ |
| status | enum | yes | DRAFT, SUBMITTED, PARTIAL, RECEIVED, CANCELLED |
| createdByUserId | string | yes | ผู้สร้าง |
| note | string | no | หมายเหตุ |
| createdAt | timestamp | yes | วันที่สร้าง |
| updatedAt | timestamp | yes | วันที่แก้ล่าสุด |

## PurchaseLine

| Field | Type | Required | Description |
|---|---|---:|---|
| id | string | yes | รหัสบรรทัด |
| purchaseOrderId | string | yes | เอกสารแม่ |
| itemId | string | yes | วัตถุดิบ |
| orderedQty | decimal | yes | จำนวนสั่ง |
| purchaseUnit | string | yes | หน่วยซื้อ |
| estimatedUnitPrice | decimal | no | ราคาประมาณ |
| actualUnitPrice | decimal | no | ราคาจริง |
| receivedQty | decimal | no | จำนวนรับแล้ว |
| note | string | no | หมายเหตุ |

## Inventory Rules

### Receive

- สร้าง Transaction และ Line ก่อน
- เมื่อ Post แล้วจึงสร้าง/เพิ่ม StockLot
- เก็บราคาต่อหน่วยจริงใน Transaction Line

### Issue

- เลือก Lot แบบ FEFO เมื่อ `trackExpiry = true`
- ถ้าวันหมดอายุเท่ากัน ให้เลือก Lot ที่รับก่อน
- ป้องกันยอดติดลบ
- หาก Stock ไม่พอให้หยุดรายการและแจ้งจำนวนที่ขาด

### Transfer

- สร้างการตัดจาก Location ต้นทางและเพิ่มที่ Location ปลายทางในธุรกรรมเดียวกัน
- Lot และต้นทุนควรตามไปยังปลายทาง
- ถ้าขั้นตอนใดล้มเหลวต้องย้อนกลับทั้งหมด

### Adjust

- ต้องมีเหตุผล
- การปรับลดต้องตรวจยอดก่อน
- จำนวนมากหรือมูลค่าสูงควรรองรับการอนุมัติ

### Cancel

- ไม่ลบ Transaction เดิม
- สร้างผลย้อนกลับหรือเปลี่ยนสถานะตามกฎที่กำหนด
- เก็บผู้ยกเลิก เวลา และเหตุผล

## Migration Notes

ก่อนนำโมเดลนี้ไปใช้กับ IndexedDB หรือ Backend จริง ต้อง:

1. สำรองข้อมูลเดิม
2. ระบุ Version ของ Schema
3. เขียน Migration ที่ทำซ้ำได้อย่างปลอดภัย
4. ทดสอบข้อมูลว่าง ข้อมูลเดิม และข้อมูลจำนวนมาก
5. มีวิธีย้อนกลับ
6. ตรวจ Export/Import หลัง Migration
