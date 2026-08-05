# Google Sheets Database Schema

Spreadsheet: **Canteen Smart Stock Database** (สร้างอัตโนมัติโดย `setupSystem` — เก็บใน `01_Master Data`)

- ทุก Sheet มี Header แถวแรก (freeze) — ลำดับคอลัมน์ตรงกับ `SHEET_SCHEMA` ใน `Config.js` ซึ่งเป็น source of truth
- วันที่เก็บเป็น string `yyyy-MM-dd`, timestamp เป็น `yyyy-MM-dd'T'HH:mm:ss` (timezone Asia/Bangkok)
- ทุกคอลัมน์ format เป็น Plain text ป้องกัน Sheets แปลงค่า Lot/วันที่อัตโนมัติ
- **ห้ามแก้ลำดับ/ชื่อ Header ใน Sheet โดยตรง** — ถ้าจะเพิ่มคอลัมน์ให้แก้ `Config.js` แล้วเพิ่มท้ายตาราง

## Master Data

### USER_MASTER
| คอลัมน์ | ความหมาย |
|---|---|
| Employee_ID | รหัสพนักงาน เช่น `1A013592` (unique, ตัวพิมพ์ใหญ่) |
| Employee_Name, Department, Position | ข้อมูลพนักงาน |
| Role | Admin / Manager / Supervisor / Store / Kitchen / Viewer |
| Shift, Building | กะ / อาคารประจำ |
| Email | ใช้ auto-fill เมื่อ login ด้วย Google Account ที่ตรงกัน |
| Status | `Active` เท่านั้นที่บันทึกได้ — `Inactive` ถูกปฏิเสธ |
| Created_Date, Updated_Date | |

### ITEM_MASTER
Item_ID (PK), Item_Code, Barcode, Item_Name, Short_Name, Category, Main_Unit, Purchase_Unit, Conversion_Rate, Vendor_Main, Vendor_Backup, Last_Price, Average_Price, Min_Stock, Max_Stock, Reorder_Point, Safety_Stock, Lead_Time_Day, Shelf_Life_Day, Storage_Type, Default_Location, Image_URL, Active_Status, Remark, Created_Date, Updated_Date

### CATEGORY_MASTER / UNIT_MASTER / VENDOR_MASTER
ตาราง lookup มาตรฐาน (ดูคอลัมน์เต็มใน `Config.js`) — Vendor มี Lead_Time_Day และ Payment_Term

### LOCATION_MASTER
| คอลัมน์ | ความหมาย |
|---|---|
| Location_ID | รหัส เช่น `B16-FRZ-01` |
| Location_Name, Building, Zone, Storage_Type | |
| Parent_Location | รองรับ hierarchy |
| Full_Path | เช่น `Building 16 > Freezer 01` — แสดงบนหน้าจอ |
| Active_Status, Created_Date | |

## Transactions (Header + Detail — 1 เอกสารมีได้หลายรายการ)

### RECEIVING (Header)
Receiving_ID (uuid), Receiving_No (`RCV-YYYYMMDD-0001`), Date, Time, Vendor, PO_Number, Delivery_Note, Employee_ID, Employee_Name, Employee_Email, Default_Location, Total_Items, Total_Amount, Pending_Count, Remark, Attachment_URL, Attachment_File_ID, Status (`Completed` / `Partial Delivery`), Created_From_Device, Created_From_Module, Created_At

### RECEIVING_DETAIL
Receiving_ID, Receiving_No, Line_No, Item_ID, Item_Name, Ordered_Qty, Received_Qty, Unit, Lot, Manufacturing_Date, Expiry_Date, Location, Price, Amount, Pending_Qty, Status
- `Pending_Qty = Ordered − Received` เมื่อรับไม่ครบ → สร้างแถวใน PENDING_DELIVERY อัตโนมัติ

### ISSUE (Header)
Issue_ID, Issue_No (`ISS-YYYYMMDD-0001`), Date, Time, From_Location, To_Location, Employee_ID, Employee_Name, Employee_Email, Total_Items, Remark, Status, Created_From_Device, Created_From_Module, Created_At

### ISSUE_DETAIL
Issue_ID, Issue_No, Line_No, Item_ID, Item_Name, Qty, Unit, Lot, From_Location, Status
- 1 แถวที่ผู้ใช้กรอกอาจแตกเป็นหลาย Detail ถ้า FEFO ต้องตัดหลาย Lot

## Stock

### STOCK_LOT
| คอลัมน์ | ความหมาย |
|---|---|
| Lot_ID (uuid), Item_ID, Item_Name, Lot_No | Lot สร้างใหม่ทุกครั้งที่รับ |
| Received_Qty / Remaining_Qty | ยอดรับ / ยอดคงเหลือของ lot |
| Unit, Manufacturing_Date, Expiry_Date, Location | |
| Receiving_No, Unit_Price | traceability กลับไปเอกสารรับ |
| Status | `Active` → `Depleted` เมื่อ Remaining = 0 |
| Created_At, Updated_At | |

### STOCK_BALANCE
Item_ID, Item_Name, Unit, Current_Stock, Reserved_Qty, Available_Stock, Last_Movement_At, Updated_At
- update จาก transaction จริงทุกครั้ง — Σ Remaining_Qty ของ lot ที่ Active ต้องเท่ากับ Current_Stock เสมอ

### STOCK_TRANSACTION (ledger — ทุก movement)
Transaction_ID, Date, Time, Timestamp, Transaction_Type (`RECEIVE`/`ISSUE`/…), Document_No, Item_ID, Item_Name, Lot_No, Qty_In, Qty_Out, Unit, Balance_After, From_Location, To_Location, Unit_Price, Employee_ID, Employee_Name, Remark

### PENDING_DELIVERY
Pending_ID, PO_Number, Vendor, Item_ID, Item_Name, Ordered_Qty, Received_Qty, Pending_Qty, Unit, Receiving_No, Expected_Date, Days_Overdue, Responsible_Person, Status (`Waiting`/`Partial Delivery`/`Completed`/`Overdue`/`Cancelled`), Created_At, Updated_At

## Audit & System

### AUDIT_LOG
Audit_ID, Timestamp, Date, Time, Employee_ID, Employee_Name, Email, Action (`CREATE_RECEIVING`/`CREATE_ISSUE`/…), Module, Record_ID (เลขเอกสาร), Old_Value, New_Value (JSON), Device, Remark
- append-only — ห้ามลบ/แก้

### SYSTEM_SETTING
Key, Value, Description, Updated_At — seed ค่าเริ่มต้น: EXPIRY_ALERT_DAYS, BACKUP_RETENTION_DAYS, DEFAULT_LOCATION, DEFAULT_CURRENCY, MANAGER_EMAIL, DATE_FORMAT, MAX_BULK_ROWS, THEME

## Sheets สำหรับ Phase 2–4 (สร้าง Header รอไว้แล้ว)

DASHBOARD_DATA, PURCHASE_ORDER(+DETAIL), STOCK_TRANSFER(+DETAIL), STOCK_COUNT(+DETAIL), STOCK_ADJUSTMENT, EXPIRY_ALERT, WASTE, NOTIFICATION — ดูคอลัมน์เต็มใน `Config.js`
