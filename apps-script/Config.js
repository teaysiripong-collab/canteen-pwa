/**
 * Canteen Smart Stock — Config.js
 * ค่าคงที่กลางของระบบ: ชื่อ Folder, ชื่อ Sheet, Header ของทุกตาราง
 * PHASE 1 ใช้งานจริง: USER_MASTER, ITEM_MASTER, LOCATION_MASTER, VENDOR_MASTER,
 *   RECEIVING(+DETAIL), ISSUE(+DETAIL), STOCK_LOT, STOCK_BALANCE, STOCK_TRANSACTION,
 *   PENDING_DELIVERY, AUDIT_LOG, SYSTEM_SETTING
 * Sheet ที่เหลือถูกสร้าง Header รอไว้สำหรับ Phase 2-4
 */

var CFG = {
  APP_NAME: 'Canteen Smart Stock',
  TIMEZONE: 'Asia/Bangkok',
  DB_NAME: 'Canteen Smart Stock Database',
  ROOT_FOLDER: 'Canteen Smart Stock',
  SUBFOLDERS: [
    '01_Master Data',
    '02_Receiving & Delivery',
    '03_Expiry & Waste',
    '04_PO & Pending Delivery',
    '05_Reports',
    '06_Attachments',
    '07_Backup'
  ],
  // Script Properties keys
  PROP: {
    SS_ID: 'CSS_SPREADSHEET_ID',
    ROOT_FOLDER_ID: 'CSS_ROOT_FOLDER_ID',
    FOLDER_PREFIX: 'CSS_FOLDER_' // + subfolder name
  },
  MAX_BULK_ROWS: 200,
  LOCK_TIMEOUT_MS: 30000,
  CACHE_TTL_SEC: 300,

  DOC_PREFIX: {
    RECEIVING: 'RCV',
    ISSUE: 'ISS',
    TRANSFER: 'TRF',
    COUNT: 'CNT',
    WASTE: 'WST'
  }
};

/** Header ของทุก Sheet — ลำดับคอลัมน์ในไฟล์นี้คือ Source of Truth ของ Database */
var SHEET_SCHEMA = {
  DASHBOARD_DATA: ['Metric', 'Value', 'Updated_At'],

  ITEM_MASTER: [
    'Item_ID', 'Item_Code', 'Barcode', 'Item_Name', 'Short_Name', 'Category',
    'Main_Unit', 'Purchase_Unit', 'Conversion_Rate', 'Vendor_Main', 'Vendor_Backup',
    'Last_Price', 'Average_Price', 'Min_Stock', 'Max_Stock', 'Reorder_Point',
    'Safety_Stock', 'Lead_Time_Day', 'Shelf_Life_Day', 'Storage_Type',
    'Default_Location', 'Image_URL', 'Active_Status', 'Remark', 'Created_Date', 'Updated_Date'
  ],

  CATEGORY_MASTER: ['Category_ID', 'Category_Name', 'Description', 'Active_Status'],

  UNIT_MASTER: ['Unit_ID', 'Unit_Name', 'Unit_Type', 'Active_Status'],

  VENDOR_MASTER: [
    'Vendor_ID', 'Vendor_Name', 'Contact_Person', 'Phone', 'Email', 'Address',
    'Lead_Time_Day', 'Payment_Term', 'Active_Status', 'Remark', 'Created_Date'
  ],

  LOCATION_MASTER: [
    'Location_ID', 'Location_Name', 'Building', 'Zone', 'Storage_Type',
    'Parent_Location', 'Full_Path', 'Active_Status', 'Created_Date'
  ],

  USER_MASTER: [
    'Employee_ID', 'Employee_Name', 'Department', 'Position', 'Role', 'Shift',
    'Building', 'Email', 'Status', 'Created_Date', 'Updated_Date'
  ],

  PURCHASE_ORDER: [
    'PO_ID', 'PO_Number', 'Date', 'Vendor', 'Expected_Date', 'Employee_ID',
    'Employee_Name', 'Total_Amount', 'Status', 'Remark', 'Created_At'
  ],

  PURCHASE_ORDER_DETAIL: [
    'PO_ID', 'PO_Number', 'Line_No', 'Item_ID', 'Item_Name', 'Ordered_Qty',
    'Unit', 'Price', 'Amount', 'Status'
  ],

  RECEIVING: [
    'Receiving_ID', 'Receiving_No', 'Date', 'Time', 'Vendor', 'PO_Number',
    'Delivery_Note', 'Employee_ID', 'Employee_Name', 'Employee_Email',
    'Default_Location', 'Total_Items', 'Total_Amount', 'Pending_Count',
    'Remark', 'Attachment_URL', 'Attachment_File_ID', 'Status',
    'Created_From_Device', 'Created_From_Module', 'Created_At'
  ],

  RECEIVING_DETAIL: [
    'Receiving_ID', 'Receiving_No', 'Line_No', 'Item_ID', 'Item_Name',
    'Ordered_Qty', 'Received_Qty', 'Unit', 'Lot', 'Manufacturing_Date',
    'Expiry_Date', 'Location', 'Price', 'Amount', 'Pending_Qty', 'Status'
  ],

  ISSUE: [
    'Issue_ID', 'Issue_No', 'Date', 'Time', 'From_Location', 'To_Location',
    'Employee_ID', 'Employee_Name', 'Employee_Email', 'Total_Items',
    'Remark', 'Status', 'Created_From_Device', 'Created_From_Module', 'Created_At'
  ],

  ISSUE_DETAIL: [
    'Issue_ID', 'Issue_No', 'Line_No', 'Item_ID', 'Item_Name',
    'Qty', 'Unit', 'Lot', 'From_Location', 'Status'
  ],

  STOCK_LOT: [
    'Lot_ID', 'Item_ID', 'Item_Name', 'Lot_No', 'Received_Qty', 'Remaining_Qty',
    'Unit', 'Manufacturing_Date', 'Expiry_Date', 'Location', 'Receiving_No',
    'Unit_Price', 'Status', 'Created_At', 'Updated_At'
  ],

  STOCK_BALANCE: [
    'Item_ID', 'Item_Name', 'Unit', 'Current_Stock', 'Reserved_Qty',
    'Available_Stock', 'Last_Movement_At', 'Updated_At'
  ],

  STOCK_TRANSACTION: [
    'Transaction_ID', 'Date', 'Time', 'Timestamp', 'Transaction_Type',
    'Document_No', 'Item_ID', 'Item_Name', 'Lot_No', 'Qty_In', 'Qty_Out',
    'Unit', 'Balance_After', 'From_Location', 'To_Location', 'Unit_Price',
    'Employee_ID', 'Employee_Name', 'Remark'
  ],

  STOCK_TRANSFER: [
    'Transfer_ID', 'Transfer_No', 'Date', 'Time', 'Employee_ID', 'Employee_Name',
    'From_Location', 'To_Location', 'Total_Items', 'Remark', 'Status', 'Created_At'
  ],

  STOCK_TRANSFER_DETAIL: [
    'Transfer_ID', 'Transfer_No', 'Line_No', 'Item_ID', 'Item_Name',
    'Lot_No', 'Qty', 'Unit', 'Status'
  ],

  STOCK_COUNT: [
    'Count_ID', 'Count_No', 'Date', 'Time', 'Location', 'Employee_ID',
    'Employee_Name', 'Total_Items', 'Remark', 'Status', 'Created_At'
  ],

  STOCK_COUNT_DETAIL: [
    'Count_ID', 'Count_No', 'Line_No', 'Item_ID', 'Item_Name', 'Lot_No',
    'System_Qty', 'Actual_Qty', 'Variance', 'Variance_Value', 'Reason', 'Status'
  ],

  STOCK_ADJUSTMENT: [
    'Adjustment_ID', 'Date', 'Time', 'Item_ID', 'Item_Name', 'Lot_No',
    'Qty_Before', 'Qty_After', 'Adjust_Qty', 'Reason', 'Reference_No',
    'Employee_ID', 'Employee_Name', 'Approved_By', 'Status', 'Created_At'
  ],

  EXPIRY_ALERT: [
    'Alert_ID', 'Item_ID', 'Item_Name', 'Lot_No', 'Remaining_Qty', 'Unit',
    'Expiry_Date', 'Days_To_Expiry', 'Location', 'Status', 'Created_At'
  ],

  WASTE: [
    'Waste_ID', 'Waste_No', 'Date', 'Time', 'Employee_ID', 'Employee_Name',
    'Item_ID', 'Item_Name', 'Lot_No', 'Qty', 'Unit', 'Reason', 'Location',
    'Image_URL', 'Remark', 'Status', 'Created_At'
  ],

  PENDING_DELIVERY: [
    'Pending_ID', 'PO_Number', 'Vendor', 'Item_ID', 'Item_Name', 'Ordered_Qty',
    'Received_Qty', 'Pending_Qty', 'Unit', 'Receiving_No', 'Expected_Date',
    'Days_Overdue', 'Responsible_Person', 'Status', 'Created_At', 'Updated_At'
  ],

  NOTIFICATION: [
    'Notification_ID', 'Type', 'Title', 'Message', 'Reference_ID',
    'Target_Role', 'Is_Read', 'Created_At', 'Read_At'
  ],

  AUDIT_LOG: [
    'Audit_ID', 'Timestamp', 'Date', 'Time', 'Employee_ID', 'Employee_Name',
    'Email', 'Action', 'Module', 'Record_ID', 'Old_Value', 'New_Value',
    'Device', 'Remark'
  ],

  SYSTEM_SETTING: ['Key', 'Value', 'Description', 'Updated_At']
};

/** ลำดับการสร้าง Sheet ใน Spreadsheet */
var SHEET_ORDER = [
  'DASHBOARD_DATA', 'ITEM_MASTER', 'CATEGORY_MASTER', 'UNIT_MASTER',
  'VENDOR_MASTER', 'LOCATION_MASTER', 'USER_MASTER',
  'PURCHASE_ORDER', 'PURCHASE_ORDER_DETAIL',
  'RECEIVING', 'RECEIVING_DETAIL', 'ISSUE', 'ISSUE_DETAIL',
  'STOCK_LOT', 'STOCK_BALANCE', 'STOCK_TRANSACTION',
  'STOCK_TRANSFER', 'STOCK_TRANSFER_DETAIL',
  'STOCK_COUNT', 'STOCK_COUNT_DETAIL', 'STOCK_ADJUSTMENT',
  'EXPIRY_ALERT', 'WASTE', 'PENDING_DELIVERY', 'NOTIFICATION',
  'AUDIT_LOG', 'SYSTEM_SETTING'
];
