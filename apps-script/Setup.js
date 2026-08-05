/**
 * Canteen Smart Stock — Setup.js
 * รันครั้งเดียวตอนติดตั้ง: สร้าง Google Drive folders, Spreadsheet database,
 * seed ข้อมูลตัวอย่าง และ System Setting
 *
 * วิธีใช้: เปิด Apps Script Editor → เลือกฟังก์ชัน setupSystem → Run
 */

function setupSystem() {
  var props = PropertiesService.getScriptProperties();

  // 1) Google Drive folder structure
  var rootId = props.getProperty(CFG.PROP.ROOT_FOLDER_ID);
  var root;
  if (rootId) {
    root = DriveApp.getFolderById(rootId);
  } else {
    root = DriveApp.createFolder(CFG.ROOT_FOLDER);
    props.setProperty(CFG.PROP.ROOT_FOLDER_ID, root.getId());
  }
  CFG.SUBFOLDERS.forEach(function (name) {
    var key = CFG.PROP.FOLDER_PREFIX + name;
    if (props.getProperty(key)) return;
    var it = root.getFoldersByName(name);
    var f = it.hasNext() ? it.next() : root.createFolder(name);
    props.setProperty(key, f.getId());
  });

  // 2) Spreadsheet database + ทุก Sheet ตาม Schema
  var ssId = props.getProperty(CFG.PROP.SS_ID);
  var ss;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
  } else {
    ss = SpreadsheetApp.create(CFG.DB_NAME);
    props.setProperty(CFG.PROP.SS_ID, ss.getId());
    // ย้ายไฟล์ database เข้า folder 01_Master Data
    var file = DriveApp.getFileById(ss.getId());
    var masterFolder = DriveApp.getFolderById(props.getProperty(CFG.PROP.FOLDER_PREFIX + '01_Master Data'));
    file.moveTo(masterFolder);
  }
  SHEET_ORDER.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      initSheetHeader_(sh, name);
    }
  });
  // ลบ Sheet1 default ถ้ายังอยู่
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  // 3) System Setting defaults
  seedSystemSettings_();

  Logger.log('Setup เสร็จสมบูรณ์');
  Logger.log('Spreadsheet: ' + ss.getUrl());
  Logger.log('Drive Folder: ' + root.getUrl());
  return { spreadsheetUrl: ss.getUrl(), folderUrl: root.getUrl() };
}

function seedSystemSettings_() {
  var existing = readAll_('SYSTEM_SETTING');
  if (existing.length > 0) return;
  var ts = timestampStr_();
  appendObjects_('SYSTEM_SETTING', [
    { Key: 'EXPIRY_ALERT_DAYS', Value: '7,3,1,0', Description: 'จำนวนวันก่อนหมดอายุที่แจ้งเตือน', Updated_At: ts },
    { Key: 'BACKUP_RETENTION_DAYS', Value: '30', Description: 'เก็บ Backup ย้อนหลังกี่วัน', Updated_At: ts },
    { Key: 'DEFAULT_LOCATION', Value: 'B16-DRY-A', Description: 'Location เริ่มต้น', Updated_At: ts },
    { Key: 'DEFAULT_CURRENCY', Value: 'THB', Description: 'สกุลเงิน', Updated_At: ts },
    { Key: 'MANAGER_EMAIL', Value: '', Description: 'Email ผู้จัดการสำหรับแจ้งเตือน', Updated_At: ts },
    { Key: 'DATE_FORMAT', Value: 'yyyy-MM-dd', Description: 'รูปแบบวันที่', Updated_At: ts },
    { Key: 'MAX_BULK_ROWS', Value: '200', Description: 'จำนวนแถวสูงสุดต่อ 1 transaction', Updated_At: ts },
    { Key: 'THEME', Value: 'navy', Description: 'ธีมสี', Updated_At: ts }
  ]);
}

/**
 * Seed ข้อมูลตัวอย่างสำหรับทดสอบ Phase 1 (รันหลัง setupSystem)
 * ปลอดภัย: จะไม่ seed ซ้ำถ้ามีข้อมูลอยู่แล้ว
 */
function seedSampleData() {
  var today = todayStr_();

  if (readAll_('USER_MASTER').length === 0) {
    appendObjects_('USER_MASTER', [
      { Employee_ID: '1A013592', Employee_Name: 'สมชาย ใจดี', Department: 'Store', Position: 'Store Officer', Role: 'Store', Shift: 'Morning', Building: 'Building 16', Email: 'teaysiripong@gmail.com', Status: 'Active', Created_Date: today, Updated_Date: today },
      { Employee_ID: '1A013593', Employee_Name: 'สมหญิง รักงาน', Department: 'Kitchen', Position: 'Cook', Role: 'Kitchen', Shift: 'Morning', Building: 'Building 16', Email: '', Status: 'Active', Created_Date: today, Updated_Date: today },
      { Employee_ID: '1A013594', Employee_Name: 'วิชัย ตรวจตรา', Department: 'Store', Position: 'Supervisor', Role: 'Supervisor', Shift: 'Morning', Building: 'Building 1', Email: '', Status: 'Active', Created_Date: today, Updated_Date: today },
      { Employee_ID: '1A013595', Employee_Name: 'มานี บริหาร', Department: 'Management', Position: 'Manager', Role: 'Manager', Shift: 'Office', Building: 'Building 1', Email: '', Status: 'Active', Created_Date: today, Updated_Date: today },
      { Employee_ID: '1A099999', Employee_Name: 'พนักงานลาออก ทดสอบ', Department: 'Store', Position: 'Store Officer', Role: 'Store', Shift: 'Morning', Building: 'Building 16', Email: '', Status: 'Inactive', Created_Date: today, Updated_Date: today }
    ]);
  }

  if (readAll_('CATEGORY_MASTER').length === 0) {
    appendObjects_('CATEGORY_MASTER', [
      { Category_ID: 'CAT01', Category_Name: 'เนื้อสัตว์', Description: 'หมู ไก่ เนื้อ ปลา', Active_Status: 'Active' },
      { Category_ID: 'CAT02', Category_Name: 'ผัก-ผลไม้', Description: 'ผักสดและผลไม้', Active_Status: 'Active' },
      { Category_ID: 'CAT03', Category_Name: 'ของแห้ง', Description: 'ข้าว แป้ง เครื่องปรุงแห้ง', Active_Status: 'Active' },
      { Category_ID: 'CAT04', Category_Name: 'เครื่องปรุง', Description: 'ซอส น้ำมัน เครื่องปรุงรส', Active_Status: 'Active' },
      { Category_ID: 'CAT05', Category_Name: 'ไข่-นม', Description: 'ไข่ นม ผลิตภัณฑ์นม', Active_Status: 'Active' }
    ]);
  }

  if (readAll_('UNIT_MASTER').length === 0) {
    appendObjects_('UNIT_MASTER', [
      { Unit_ID: 'U01', Unit_Name: 'kg', Unit_Type: 'Weight', Active_Status: 'Active' },
      { Unit_ID: 'U02', Unit_Name: 'g', Unit_Type: 'Weight', Active_Status: 'Active' },
      { Unit_ID: 'U03', Unit_Name: 'ฟอง', Unit_Type: 'Count', Active_Status: 'Active' },
      { Unit_ID: 'U04', Unit_Name: 'ขวด', Unit_Type: 'Count', Active_Status: 'Active' },
      { Unit_ID: 'U05', Unit_Name: 'ถุง', Unit_Type: 'Count', Active_Status: 'Active' },
      { Unit_ID: 'U06', Unit_Name: 'กล่อง', Unit_Type: 'Count', Active_Status: 'Active' },
      { Unit_ID: 'U07', Unit_Name: 'ลิตร', Unit_Type: 'Volume', Active_Status: 'Active' }
    ]);
  }

  if (readAll_('VENDOR_MASTER').length === 0) {
    appendObjects_('VENDOR_MASTER', [
      { Vendor_ID: 'V001', Vendor_Name: 'บจก. เนื้อสดไทย', Contact_Person: 'คุณสมศักดิ์', Phone: '081-111-1111', Email: '', Address: 'กรุงเทพฯ', Lead_Time_Day: 2, Payment_Term: '30 วัน', Active_Status: 'Active', Remark: '', Created_Date: today },
      { Vendor_ID: 'V002', Vendor_Name: 'หจก. ผักสดฟาร์ม', Contact_Person: 'คุณมาลี', Phone: '081-222-2222', Email: '', Address: 'นครปฐม', Lead_Time_Day: 1, Payment_Term: 'เงินสด', Active_Status: 'Active', Remark: '', Created_Date: today },
      { Vendor_ID: 'V003', Vendor_Name: 'บจก. ของแห้งรวมมิตร', Contact_Person: 'คุณประเสริฐ', Phone: '081-333-3333', Email: '', Address: 'สมุทรสาคร', Lead_Time_Day: 3, Payment_Term: '15 วัน', Active_Status: 'Active', Remark: '', Created_Date: today }
    ]);
  }

  if (readAll_('LOCATION_MASTER').length === 0) {
    appendObjects_('LOCATION_MASTER', [
      { Location_ID: 'B16-FRZ-01', Location_Name: 'Freezer 01', Building: 'Building 16', Zone: 'Freezer', Storage_Type: 'Frozen', Parent_Location: 'Building 16', Full_Path: 'Building 16 > Freezer 01', Active_Status: 'Active', Created_Date: today },
      { Location_ID: 'B16-FRZ-02', Location_Name: 'Freezer 02', Building: 'Building 16', Zone: 'Freezer', Storage_Type: 'Frozen', Parent_Location: 'Building 16', Full_Path: 'Building 16 > Freezer 02', Active_Status: 'Active', Created_Date: today },
      { Location_ID: 'B16-CHL-01', Location_Name: 'Chiller 01', Building: 'Building 16', Zone: 'Chiller', Storage_Type: 'Chilled', Parent_Location: 'Building 16', Full_Path: 'Building 16 > Chiller 01', Active_Status: 'Active', Created_Date: today },
      { Location_ID: 'B16-DRY-A', Location_Name: 'Dry Store Rack A', Building: 'Building 16', Zone: 'Dry Store', Storage_Type: 'Dry', Parent_Location: 'Building 16', Full_Path: 'Building 16 > Dry Store > Rack A', Active_Status: 'Active', Created_Date: today },
      { Location_ID: 'B01-DRY-B', Location_Name: 'Dry Store Rack B', Building: 'Building 1', Zone: 'Dry Store', Storage_Type: 'Dry', Parent_Location: 'Building 1', Full_Path: 'Building 1 > Dry Store > Rack B', Active_Status: 'Active', Created_Date: today },
      { Location_ID: 'B01-KIT-01', Location_Name: 'Kitchen 01', Building: 'Building 1', Zone: 'Kitchen', Storage_Type: 'Ambient', Parent_Location: 'Building 1', Full_Path: 'Building 1 > Kitchen 01', Active_Status: 'Active', Created_Date: today }
    ]);
  }

  if (readAll_('ITEM_MASTER').length === 0) {
    var items = [
      ['ITM001', 'MB', '8850001000011', 'หมูบด', 'หมูบด', 'เนื้อสัตว์', 'kg', 'kg', 1, 'บจก. เนื้อสดไทย', '', 145, 145, 10, 100, 20, 10, 2, 7, 'Frozen', 'B16-FRZ-01'],
      ['ITM002', 'KB', '8850001000028', 'ไก่บด', 'ไก่บด', 'เนื้อสัตว์', 'kg', 'kg', 1, 'บจก. เนื้อสดไทย', '', 95, 95, 10, 80, 15, 8, 2, 7, 'Frozen', 'B16-FRZ-01'],
      ['ITM003', 'MS', '8850001000035', 'หมูหั่นบาง', 'หมูหั่น', 'เนื้อสัตว์', 'kg', 'kg', 1, 'บจก. เนื้อสดไทย', '', 165, 165, 5, 60, 12, 6, 2, 7, 'Frozen', 'B16-FRZ-02'],
      ['ITM004', 'EGG', '8850001000042', 'ไข่ไก่ เบอร์ 2', 'ไข่ไก่', 'ไข่-นม', 'ฟอง', 'ถาด(30)', 30, 'หจก. ผักสดฟาร์ม', '', 4.5, 4.5, 300, 3000, 600, 300, 1, 14, 'Chilled', 'B16-CHL-01'],
      ['ITM005', 'SOY', '8850001000059', 'ซอสถั่วเหลือง 700ml', 'ซอส', 'เครื่องปรุง', 'ขวด', 'ลัง(12)', 12, 'บจก. ของแห้งรวมมิตร', '', 38, 38, 6, 60, 12, 6, 3, 365, 'Dry', 'B16-DRY-A'],
      ['ITM006', 'RICE', '8850001000066', 'ข้าวหอมมะลิ 49 กก.', 'ข้าว', 'ของแห้ง', 'ถุง', 'ถุง', 1, 'บจก. ของแห้งรวมมิตร', '', 1450, 1450, 2, 20, 4, 2, 3, 180, 'Dry', 'B01-DRY-B'],
      ['ITM007', 'ONI', '8850001000073', 'หอมใหญ่', 'หอมใหญ่', 'ผัก-ผลไม้', 'kg', 'kg', 1, 'หจก. ผักสดฟาร์ม', '', 32, 32, 5, 40, 8, 4, 1, 10, 'Chilled', 'B16-CHL-01'],
      ['ITM008', 'GAR', '8850001000080', 'กระเทียมแกะ', 'กระเทียม', 'ผัก-ผลไม้', 'kg', 'kg', 1, 'หจก. ผักสดฟาร์ม', '', 85, 85, 2, 20, 4, 2, 1, 14, 'Chilled', 'B16-CHL-01'],
      ['ITM009', 'OIL', '8850001000097', 'น้ำมันปาล์ม 1 ลิตร', 'น้ำมัน', 'เครื่องปรุง', 'ขวด', 'ลัง(12)', 12, 'บจก. ของแห้งรวมมิตร', '', 52, 52, 12, 120, 24, 12, 3, 365, 'Dry', 'B16-DRY-A'],
      ['ITM010', 'CHK', '8850001000103', 'ไก่สับ', 'ไก่สับ', 'เนื้อสัตว์', 'kg', 'kg', 1, 'บจก. เนื้อสดไทย', '', 88, 88, 8, 60, 12, 6, 2, 7, 'Frozen', 'B16-FRZ-01']
    ];
    appendObjects_('ITEM_MASTER', items.map(function (r) {
      return {
        Item_ID: r[0], Item_Code: r[1], Barcode: r[2], Item_Name: r[3], Short_Name: r[4],
        Category: r[5], Main_Unit: r[6], Purchase_Unit: r[7], Conversion_Rate: r[8],
        Vendor_Main: r[9], Vendor_Backup: r[10], Last_Price: r[11], Average_Price: r[12],
        Min_Stock: r[13], Max_Stock: r[14], Reorder_Point: r[15], Safety_Stock: r[16],
        Lead_Time_Day: r[17], Shelf_Life_Day: r[18], Storage_Type: r[19], Default_Location: r[20],
        Image_URL: '', Active_Status: 'Active', Remark: '', Created_Date: today, Updated_Date: today
      };
    }));
  }

  invalidateCache_(['USER_MASTER', 'ITEM_MASTER', 'CATEGORY_MASTER', 'UNIT_MASTER', 'VENDOR_MASTER', 'LOCATION_MASTER']);
  Logger.log('Seed sample data เสร็จสมบูรณ์');
}

/** ติดตั้ง Daily Trigger (Phase 4 เต็มรูปแบบ — Phase 1 ติดตั้ง backup ไว้ก่อน) */
function installTriggers() {
  // ลบ trigger เดิมของฟังก์ชันเดียวกันก่อน กันซ้ำ
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupDatabase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupDatabase').timeBased().atHour(2).everyDays(1).create();
  Logger.log('ติดตั้ง Trigger backupDatabase เวลา 02:00 แล้ว');
}

/** Daily Backup: copy spreadsheet ไป 07_Backup แล้วลบไฟล์เกิน retention */
function backupDatabase() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty(CFG.PROP.SS_ID);
  if (!ssId) return;
  var backupFolder = DriveApp.getFolderById(props.getProperty(CFG.PROP.FOLDER_PREFIX + '07_Backup'));
  var name = 'CanteenStock_Backup_' + Utilities.formatDate(now_(), CFG.TIMEZONE, 'yyyyMMdd');
  DriveApp.getFileById(ssId).makeCopy(name, backupFolder);
  cleanOldBackups();
}

/** ลบ Backup ที่เก่ากว่า retention (default 30 วัน) */
function cleanOldBackups() {
  var props = PropertiesService.getScriptProperties();
  var backupFolder = DriveApp.getFolderById(props.getProperty(CFG.PROP.FOLDER_PREFIX + '07_Backup'));
  var retention = 30;
  var settings = readAll_('SYSTEM_SETTING');
  settings.forEach(function (s) {
    if (s.Key === 'BACKUP_RETENTION_DAYS') retention = num_(s.Value) || 30;
  });
  var cutoff = new Date(now_().getTime() - retention * 24 * 60 * 60 * 1000);
  var files = backupFolder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf('CanteenStock_Backup_') === 0 && f.getDateCreated() < cutoff) {
      f.setTrashed(true); // Soft delete — ไปถังขยะ ไม่ hard delete
    }
  }
}
