/**
 * MEKTEC Canteen Menu & Purchasing System
 * ============================================================
 * ระบบบริหารเมนูอาหาร สูตรอาหาร วัตถุดิบ สต๊อก ต้นทุน และใบสั่งซื้อ
 * ของโรงอาหารบริษัท MEKTEC
 *
 * เฟส 1: ฐานข้อมูล Google Sheets, ระบบผู้ใช้งาน, Dashboard,
 *         วางแผนเมนูรายสัปดาห์ (Weekly Menu Planner), สูตรอาหารมาตรฐาน (Recipe Master)
 *
 * เขตเวลาอ้างอิงทั้งหมด: Asia/Bangkok
 * ============================================================
 */

// ==================================================================
// 1) ค่าคงที่และโครงสร้างระบบ (Constants & Schema)
// ==================================================================

var TIMEZONE = 'Asia/Bangkok';
var SYSTEM_VERSION = '2.0.0'; // ระบบเต็มรูปแบบ: เมนู, สูตรอาหาร, ค่ามาตรฐาน, สต๊อก, Vendor, ใบสั่งซื้อ+PDF, คู่มือครัว, ใบประกาศเมนู, รายงาน
var SESSION_TTL_SECONDS = 6 * 60 * 60; // อายุ session 6 ชั่วโมง
var SS_ID_PROPERTY_KEY = 'MEKTEC_SPREADSHEET_ID';

var ROLES = {
  ADMIN: 'Admin',
  SUPERVISOR: 'Supervisor',
  STAFF: 'Staff',
  VIEWER: 'Viewer'
};

// รายชื่อชีตทั้งหมดของระบบ พร้อมหัวคอลัมน์ (Header) มาตรฐาน
// setupSystem() และ upgradeSystem() จะใช้ตารางนี้เป็นต้นแบบเสมอ
var SHEET_SCHEMA = {
  Settings: ['Key', 'Value', 'Description', 'UpdatedAt'],

  Users: ['UserID', 'Username', 'EmployeeCode', 'FullName', 'PIN', 'Role', 'Active', 'CreatedAt', 'UpdatedAt'],

  Vendors: ['VendorID', 'VendorName', 'ContactPerson', 'Phone', 'Email', 'Line',
    'OrderDay', 'DeliveryDay', 'DeliveryTime', 'Terms', 'MinOrderUnit', 'Active', 'Notes'],

  Ingredients: ['IngredientID', 'IngredientName', 'Category', 'Unit', 'StandardPrice', 'LatestPrice',
    'AvgPrice', 'DefaultVendorID', 'WastePercent', 'RoundingUnit', 'MinOrderQty', 'PackSize',
    'LeadTimeDays', 'SafetyStock', 'Active'],

  Recipes: ['RecipeID', 'MenuCode', 'MenuName', 'Category', 'StandardQty', 'StandardUnit', 'ImageUrl',
    'Steps', 'ServingMethod', 'QCPoints', 'Temperature', 'Notes', 'Active', 'CreatedAt', 'UpdatedAt'],

  RecipeItems: ['RecipeItemID', 'RecipeID', 'IngredientID', 'Qty', 'Unit', 'WastePercent', 'Allowance',
    'VendorID', 'PricePerUnit', 'Cost', 'RoundingUnit', 'MinOrderQty', 'SortOrder'],

  WeeklyMenus: ['WeeklyMenuID', 'WeekStartDate', 'WeekEndDate', 'Status', 'TemplateName',
    'CreatedBy', 'CreatedAt', 'UpdatedAt'],

  MenuItems: ['MenuItemID', 'WeeklyMenuID', 'MenuDate', 'DayName', 'TimeSlotID', 'RecipeID',
    'MenuName', 'Location', 'MenuType', 'QtyMorning', 'QtyNight', 'QtyTotal', 'Notes',
    'CreatedBy', 'CreatedAt', 'UpdatedAt'],

  MenuTemplates: ['TemplateID', 'TemplateName', 'CreatedBy', 'CreatedAt'],

  MenuTemplateItems: ['TemplateItemID', 'TemplateID', 'DayOffset', 'DayName', 'TimeSlotID', 'RecipeID',
    'MenuName', 'Location', 'MenuType', 'QtyMorning', 'QtyNight', 'Notes'],

  InventoryLots: ['LotID', 'IngredientID', 'LotNumber', 'ReceivedDate', 'ExpiryDate', 'QtyReceived',
    'QtyRemaining', 'PricePerUnit', 'VendorID', 'StorageLocation', 'RecordedBy', 'CreatedAt'],

  StockTransactions: ['TransID', 'TransDate', 'TransType', 'IngredientID', 'LotID', 'Qty',
    'FromLocation', 'ToLocation', 'Reason', 'RecordedBy', 'Timestamp'],

  PurchaseOrders: ['POID', 'PONumber', 'OrderDate', 'UseDate', 'TimeSlotID', 'VendorID', 'Status',
    'TotalAmount', 'CreatedBy', 'ApprovedBy', 'PDFUrl', 'CreatedAt', 'UpdatedAt'],

  PurchaseOrderItems: ['POItemID', 'POID', 'IngredientID', 'QtySuggested', 'QtyOrdered', 'Unit',
    'PricePerUnit', 'TotalPrice', 'VendorID', 'DeliveryCycle', 'Skipped', 'Notes', 'EditedBy', 'EditedAt', 'Reason'],

  PurchaseOrderItemHistory: ['HistoryID', 'POItemID', 'FieldChanged', 'OldValue', 'NewValue',
    'EditedBy', 'EditedAt', 'Reason'],

  StandardSettings: ['SettingID', 'Category', 'IngredientID', 'AllowancePercent', 'SafetyStock',
    'RoundingUnit', 'MinOrderQty', 'PackSize', 'StandardPrice', 'LatestPrice', 'AvgPrice',
    'VendorID', 'LeadTimeDays', 'DeliveryCycle', 'ReceivingPoint', 'Notes'],

  Locations: ['LocationID', 'LocationName', 'Active'],

  TimeSlots: ['TimeSlotID', 'TimeSlotName', 'StartTime', 'EndTime', 'SortOrder', 'Active'],

  AuditLogs: ['LogID', 'Timestamp', 'UserID', 'Username', 'Action', 'TargetSheet', 'TargetID',
    'OldValue', 'NewValue', 'Reason']
};

var DAY_NAMES_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// ==================================================================
// 2) จุดเข้าเว็บแอป (doGet)
// ==================================================================

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  // รองรับ QR Code: ลิงก์ ...?recipeId=RCP-000001 จะเปิดหน้ารายละเอียดสูตรอาหารนั้นทันทีหลังเข้าสู่ระบบ
  var params = (e && e.parameter) || {};
  template.deepLinkRecipeId = params.recipeId || '';
  return template.evaluate()
    .setTitle('MEKTEC Canteen Menu & Purchasing System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==================================================================
// 3) setupSystem() / upgradeSystem()
// ==================================================================

/**
 * ติดตั้งระบบครั้งแรก: สร้าง Spreadsheet (ถ้ายังไม่มี), สร้างชีตทั้งหมดตาม SHEET_SCHEMA,
 * ใส่ข้อมูลตั้งต้น (TimeSlots, Locations, Settings) และข้อมูลตัวอย่างสำหรับทดลองระบบ
 * เรียกใช้ครั้งเดียวจากตัวแก้ไข Apps Script (เลือกฟังก์ชัน setupSystem แล้วกด Run)
 */
function setupSystem() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getOrCreateSpreadsheet_();

    // สร้างชีตทั้งหมดตามโครงสร้างระบบ
    Object.keys(SHEET_SCHEMA).forEach(function (name) {
      ensureSheet_(ss, name, SHEET_SCHEMA[name]);
    });

    // ลบชีตเริ่มต้น "Sheet1" ถ้ายังว่างอยู่และไม่ใช่ชีตในระบบ
    var defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }

    seedTimeSlotsAndLocations_(ss);
    seedSystemSettings_();
    seedSampleDataIfEmpty_();

    setSetting_('SystemVersion', SYSTEM_VERSION);
    setSetting_('LastSetupAt', nowIso_());

    return 'ติดตั้งระบบสำเร็จ: สร้างฐานข้อมูล ' + Object.keys(SHEET_SCHEMA).length +
      ' ชีต พร้อมข้อมูลตัวอย่างเรียบร้อยแล้ว (Spreadsheet ID: ' + ss.getId() + ')';
  } catch (err) {
    throw new Error('setupSystem ล้มเหลว: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * อัปเกรดระบบ: ใช้เมื่อมีการเพิ่มชีตใหม่ หรือเพิ่มคอลัมน์ใหม่ในเวอร์ชันถัดไป
 * โดยไม่ลบหรือแก้ไขข้อมูลเดิมที่มีอยู่แล้ว เพิ่มเฉพาะสิ่งที่ขาดหายไปเท่านั้น
 */
function upgradeSystem() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = getOrCreateSpreadsheet_();
    var addedSheets = [];
    var addedColumns = [];

    Object.keys(SHEET_SCHEMA).forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        ensureSheet_(ss, name, SHEET_SCHEMA[name]);
        addedSheets.push(name);
        return;
      }
      var existingHeaders = getHeaders_(sheet);
      var missing = SHEET_SCHEMA[name].filter(function (h) { return existingHeaders.indexOf(h) === -1; });
      if (missing.length > 0) {
        var startCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
        sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold').setBackground('#e8f0fe');
        addedColumns.push(name + ': ' + missing.join(', '));
      }
    });

    seedTimeSlotsAndLocations_(ss);

    var oldVersion = getSetting_('SystemVersion') || '0.0.0';
    setSetting_('SystemVersion', SYSTEM_VERSION);
    setSetting_('LastUpgradeAt', nowIso_());

    var msg = 'อัปเกรดระบบสำเร็จจากเวอร์ชัน ' + oldVersion + ' เป็น ' + SYSTEM_VERSION + '. ';
    msg += addedSheets.length ? ('เพิ่มชีตใหม่: ' + addedSheets.join(', ') + '. ') : 'ไม่มีชีตใหม่. ';
    msg += addedColumns.length ? ('เพิ่มคอลัมน์ใหม่ -> ' + addedColumns.join(' | ')) : 'ไม่มีคอลัมน์ใหม่.';
    return msg;
  } catch (err) {
    throw new Error('upgradeSystem ล้มเหลว: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSpreadsheet_() {
  // กรณีสคริปต์ผูกกับสเปรดชีตอยู่แล้ว (Container-bound) ให้ใช้ตัวที่ผูกอยู่
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty(SS_ID_PROPERTY_KEY);
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (e) {
      // ถ้าเปิดไม่ได้ (ถูกลบ/ย้าย) ให้สร้างใหม่ด้านล่าง
    }
  }

  var ss = SpreadsheetApp.create('MEKTEC Canteen Database');
  props.setProperty(SS_ID_PROPERTY_KEY, ss.getId());
  return ss;
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
    return sheet;
  }
  // ชีตมีอยู่แล้ว: เติมคอลัมน์ที่ขาดต่อท้าย โดยไม่แตะข้อมูลเดิม
  var existingHeaders = getHeaders_(sheet);
  var missing = headers.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
  if (missing.length > 0) {
    var startCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold').setBackground('#e8f0fe');
  }
  return sheet;
}

function seedTimeSlotsAndLocations_(ss) {
  if (readSheetObjects_('TimeSlots').length === 0) {
    var slots = [
      ['06:00-08:00', '06:00', '08:00', 1],
      ['10:00-13:00', '10:00', '13:00', 2],
      ['14:30-15:00', '14:30', '15:00', 3],
      ['18:00-19:00', '18:00', '19:00', 4],
      ['21:00-23:00', '21:00', '23:00', 5],
      ['02:00-03:00', '02:00', '03:00', 6]
    ];
    slots.forEach(function (s) {
      writeNewRow_('TimeSlots', {
        TimeSlotID: generateId_('TSL'),
        TimeSlotName: s[0], StartTime: s[1], EndTime: s[2], SortOrder: s[3], Active: true
      });
    });
  }
  if (readSheetObjects_('Locations').length === 0) {
    ['ตึก 1', 'ตึก 16'].forEach(function (loc) {
      writeNewRow_('Locations', { LocationID: generateId_('LOC'), LocationName: loc, Active: true });
    });
  }
}

function seedSystemSettings_() {
  var defaults = {
    CompanyName: 'MEKTEC',
    LogoUrl: '',
    DocPrefix: 'PO',
    Timezone: TIMEZONE
  };
  Object.keys(defaults).forEach(function (key) {
    if (!getSetting_(key)) setSetting_(key, defaults[key]);
  });
}

// ==================================================================
// 4) Helper: การอ่าน/เขียน Google Sheets แบบทั่วไป
// ==================================================================

function getSheet_(name) {
  var ss = getOrCreateSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีต "' + name + '" กรุณารัน setupSystem() ก่อนใช้งาน');
  return sheet;
}

function getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
}

function readSheetObjects_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var isEmpty = row.every(function (c) { return c === '' || c === null; });
    if (isEmpty) continue;
    var obj = { _row: i + 2 };
    headers.forEach(function (h, idx) { obj[h] = row[idx]; });
    out.push(obj);
  }
  return out;
}

function writeNewRow_(sheetName, obj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function updateRowByIndex_(sheetName, rowIndex, obj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var current = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var merged = headers.map(function (h, idx) { return obj.hasOwnProperty(h) ? obj[h] : current[idx]; });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([merged]);
}

function deleteRowByIndex_(sheetName, rowIndex) {
  getSheet_(sheetName).deleteRow(rowIndex);
}

function findRowById_(sheetName, idField, id) {
  var rows = readSheetObjects_(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idField]) === String(id)) return rows[i];
  }
  return null;
}

function findRowsBy_(sheetName, matchFn) {
  return readSheetObjects_(sheetName).filter(matchFn);
}

// ==================================================================
// 5) Helper: ตัวช่วยทั่วไป (Utilities)
// ==================================================================

function nextSeq_(counterKey) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var current = Number(props.getProperty(counterKey) || '0');
    var next = current + 1;
    props.setProperty(counterKey, String(next));
    return next;
  } finally {
    lock.releaseLock();
  }
}

function generateId_(prefix) {
  var seq = nextSeq_('SEQ_' + prefix);
  return prefix + '-' + Utilities.formatString('%06d', seq);
}

function nowIso_() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function formatDateStr_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
}

function parseDateStr_(str) {
  // รับรูปแบบ yyyy-MM-dd แล้วคืนค่า Date เวลาเที่ยงคืนตามเขตเวลา Asia/Bangkok
  var parts = String(str).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function addDays_(date, days) {
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function getMondayOfWeek_(dateStr) {
  var d = parseDateStr_(dateStr);
  var day = d.getDay(); // 0 = อาทิตย์
  var diff = day === 0 ? -6 : (1 - day);
  return formatDateStr_(addDays_(d, diff));
}

function getDayNameTh_(dateStr) {
  var d = parseDateStr_(dateStr);
  return DAY_NAMES_TH[d.getDay()];
}

function toNumber_(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function roundToUnit_(qty, roundingUnit) {
  var unit = toNumber_(roundingUnit);
  if (!unit || unit <= 0) return qty;
  return Math.ceil(qty / unit) * unit;
}

function hashPin_(pin) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin));
  return digest.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function getSetting_(key) {
  var row = findRowById_('Settings', 'Key', key);
  return row ? row.Value : null;
}

function setSetting_(key, value) {
  var row = findRowById_('Settings', 'Key', key);
  if (row) {
    updateRowByIndex_('Settings', row._row, { Value: value, UpdatedAt: nowIso_() });
  } else {
    writeNewRow_('Settings', { Key: key, Value: value, Description: '', UpdatedAt: nowIso_() });
  }
}

// ==================================================================
// 6) ระบบยืนยันตัวตน (Authentication) และ Session
// ==================================================================

function logAudit_(session, action, targetSheet, targetId, oldValue, newValue, reason) {
  try {
    writeNewRow_('AuditLogs', {
      LogID: generateId_('LOG'),
      Timestamp: nowIso_(),
      UserID: session ? session.userId : '',
      Username: session ? session.username : '',
      Action: action,
      TargetSheet: targetSheet,
      TargetID: targetId,
      OldValue: oldValue ? JSON.stringify(oldValue) : '',
      NewValue: newValue ? JSON.stringify(newValue) : '',
      Reason: reason || ''
    });
  } catch (e) {
    // การบันทึก log ไม่ควรทำให้ธุรกรรมหลักล้มเหลว
  }
}

/**
 * เข้าสู่ระบบด้วยชื่อผู้ใช้งานและ PIN
 */
function apiLogin(username, pin) {
  try {
    if (!username || !pin) throw new Error('กรุณากรอกชื่อผู้ใช้งานและ PIN');
    var user = findRowsBy_('Users', function (u) {
      return String(u.Username).toLowerCase() === String(username).toLowerCase();
    })[0];
    if (!user) throw new Error('ไม่พบชื่อผู้ใช้งานนี้ในระบบ');
    if (user.Active === false || user.Active === 'FALSE') throw new Error('บัญชีนี้ถูกระงับการใช้งาน');
    if (user.PIN !== hashPin_(pin)) throw new Error('PIN ไม่ถูกต้อง');

    var token = Utilities.getUuid();
    var sessionData = {
      token: token,
      userId: user.UserID,
      username: user.Username,
      fullName: user.FullName,
      role: user.Role,
      employeeCode: user.EmployeeCode
    };
    CacheService.getScriptCache().put('SESSION_' + token, JSON.stringify(sessionData), SESSION_TTL_SECONDS);
    logAudit_(sessionData, 'LOGIN', 'Users', user.UserID, null, null, '');
    return { success: true, data: sessionData };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function apiLogout(token) {
  try {
    var session = requireSession_(token);
    CacheService.getScriptCache().remove('SESSION_' + token);
    logAudit_(session, 'LOGOUT', 'Users', session.userId, null, null, '');
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function apiGetSession(token) {
  try {
    var session = requireSession_(token);
    return { success: true, data: session };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function requireSession_(token) {
  if (!token) throw new Error('กรุณาเข้าสู่ระบบ');
  var raw = CacheService.getScriptCache().get('SESSION_' + token);
  if (!raw) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  return JSON.parse(raw);
}

function requireRole_(session, allowedRoles) {
  if (allowedRoles && allowedRoles.length && allowedRoles.indexOf(session.role) === -1) {
    throw new Error('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  }
}

/**
 * ตัวห่อกลาง (wrapper) สำหรับทุก API endpoint: ตรวจสอบ session, สิทธิ์, ดักจับ error
 * เพื่อไม่ให้ทั้งระบบล่มจากข้อผิดพลาดเดียว และคืนค่าเป็นรูปแบบเดียวกันเสมอ
 */
function apiCall_(token, allowedRoles, handler) {
  try {
    var session = requireSession_(token);
    requireRole_(session, allowedRoles);
    var data = handler(session);
    return { success: true, data: data };
  } catch (err) {
    return { success: false, message: err && err.message ? err.message : String(err) };
  }
}

// ==================================================================
// 7) Dashboard API
// ==================================================================

function apiGetDashboard(token, dateStr) {
  return apiCall_(token, null, function () {
    var date = dateStr || todayStr_();
    return buildDashboardData_(date);
  });
}

function buildDashboardData_(dateStr) {
  var menuItems = findRowsBy_('MenuItems', function (m) { return formatValueAsDateStr_(m.MenuDate) === dateStr; });
  var recipes = readSheetObjects_('Recipes');
  var recipeMap = {};
  recipes.forEach(function (r) { recipeMap[r.RecipeID] = r; });

  var qtyMorning = 0, qtyNight = 0, qtyTotal = 0, costToday = 0;
  var todayMenuList = menuItems.map(function (m) {
    qtyMorning += toNumber_(m.QtyMorning);
    qtyNight += toNumber_(m.QtyNight);
    qtyTotal += toNumber_(m.QtyTotal);
    var costPerPortion = m.RecipeID ? getRecipeCostPerPortion_(m.RecipeID) : 0;
    var itemCost = costPerPortion * toNumber_(m.QtyTotal);
    costToday += itemCost;
    return {
      menuName: m.MenuName, timeSlotId: m.TimeSlotID, location: m.Location,
      menuType: m.MenuType, qtyTotal: toNumber_(m.QtyTotal), cost: round2_(itemCost)
    };
  });

  // จำนวนสูตรอาหารที่ยังตั้งค่าไม่ครบ (ไม่มีวัตถุดิบ หรือไม่มีขั้นตอนการทำ หรือจำนวนมาตรฐาน<=0)
  var recipeItems = readSheetObjects_('RecipeItems');
  var itemCountByRecipe = {};
  recipeItems.forEach(function (ri) { itemCountByRecipe[ri.RecipeID] = (itemCountByRecipe[ri.RecipeID] || 0) + 1; });
  var incompleteRecipes = recipes.filter(function (r) {
    return r.Active !== false && r.Active !== 'FALSE' &&
      (!itemCountByRecipe[r.RecipeID] || !r.Steps || toNumber_(r.StandardQty) <= 0);
  });

  // สต๊อกไม่เพียงพอ / ใกล้หมดอายุ (ข้อมูลจริงจากชีต InventoryLots ซึ่งจะถูกใช้งานเต็มรูปแบบในเฟสถัดไป)
  var lots = readSheetObjects_('InventoryLots');
  var stockByIngredient = {};
  lots.forEach(function (lot) {
    stockByIngredient[lot.IngredientID] = (stockByIngredient[lot.IngredientID] || 0) + toNumber_(lot.QtyRemaining);
  });
  var ingredients = readSheetObjects_('Ingredients');
  var lowStockCount = ingredients.filter(function (ing) {
    return ing.Active !== false && ing.Active !== 'FALSE' &&
      toNumber_(ing.SafetyStock) > 0 && (stockByIngredient[ing.IngredientID] || 0) < toNumber_(ing.SafetyStock);
  }).length;

  var in3Days = formatDateStr_(addDays_(new Date(), 3));
  var expiringCount = lots.filter(function (lot) {
    var exp = formatValueAsDateStr_(lot.ExpiryDate);
    return exp && exp <= in3Days && toNumber_(lot.QtyRemaining) > 0;
  }).length;

  // จำนวนรายการที่ต้องสั่งซื้อ: ใบสั่งซื้อสถานะ "รอดำเนินการ" (จะมีข้อมูลจริงเมื่อใช้งานเฟสใบสั่งซื้อ)
  var poItems = readSheetObjects_('PurchaseOrderItems');
  var pos = readSheetObjects_('PurchaseOrders');
  var pendingPoIds = pos.filter(function (po) { return po.Status === 'รอดำเนินการ'; }).map(function (po) { return po.POID; });
  var itemsToOrderCount = poItems.filter(function (it) { return pendingPoIds.indexOf(it.POID) !== -1; }).length;

  // กราฟต้นทุนรายวัน (7 วันล่าสุดนับจากวันที่เลือก)
  var dailyCostSeries = [];
  for (var i = 6; i >= 0; i--) {
    var d = formatDateStr_(addDays_(parseDateStr_(dateStr), -i));
    dailyCostSeries.push({ date: d, cost: round2_(computeDayCost_(d)) });
  }

  // กราฟต้นทุนรายสัปดาห์ (4 สัปดาห์ล่าสุด)
  var weeklyCostSeries = [];
  var monday = getMondayOfWeek_(dateStr);
  for (var w = 3; w >= 0; w--) {
    var wkStart = formatDateStr_(addDays_(parseDateStr_(monday), -7 * w));
    var total = 0;
    for (var d2 = 0; d2 < 6; d2++) {
      total += computeDayCost_(formatDateStr_(addDays_(parseDateStr_(wkStart), d2)));
    }
    weeklyCostSeries.push({ weekStart: wkStart, cost: round2_(total) });
  }

  // กราฟต้นทุนแยกตาม Vendor (ของวันนี้)
  var vendorMap = {};
  readSheetObjects_('Vendors').forEach(function (v) { vendorMap[v.VendorID] = v.VendorName; });
  var costByVendor = {};
  menuItems.forEach(function (m) {
    if (!m.RecipeID) return;
    var items = findRowsBy_('RecipeItems', function (ri) { return ri.RecipeID === m.RecipeID; });
    var recipe = recipeMap[m.RecipeID];
    if (!recipe || toNumber_(recipe.StandardQty) <= 0) return;
    var scale = toNumber_(m.QtyTotal) / toNumber_(recipe.StandardQty);
    items.forEach(function (ri) {
      var vName = vendorMap[ri.VendorID] || 'ไม่ระบุ Vendor';
      costByVendor[vName] = (costByVendor[vName] || 0) + toNumber_(ri.Cost) * scale;
    });
  });
  var vendorCostSeries = Object.keys(costByVendor).map(function (name) {
    return { vendor: name, cost: round2_(costByVendor[name]) };
  });

  var alerts = [];
  if (lowStockCount > 0) alerts.push({ level: 'red', text: 'มีวัตถุดิบสต๊อกไม่เพียงพอ ' + lowStockCount + ' รายการ' });
  if (expiringCount > 0) alerts.push({ level: 'yellow', text: 'มีวัตถุดิบใกล้หมดอายุ ' + expiringCount + ' รายการ (ภายใน 3 วัน)' });
  if (incompleteRecipes.length > 0) alerts.push({ level: 'yellow', text: 'มีสูตรอาหารที่ยังตั้งค่าไม่ครบ ' + incompleteRecipes.length + ' สูตร' });
  if (itemsToOrderCount > 0) alerts.push({ level: 'red', text: 'มีรายการที่ต้องสั่งซื้อ ' + itemsToOrderCount + ' รายการ' });
  if (alerts.length === 0) alerts.push({ level: 'green', text: 'ไม่มีรายการที่ต้องดำเนินการด่วนในขณะนี้' });

  return {
    date: dateStr,
    todayMenuList: todayMenuList,
    qtyMorning: qtyMorning, qtyNight: qtyNight, qtyTotal: qtyTotal,
    costToday: round2_(costToday),
    itemsToOrderCount: itemsToOrderCount,
    lowStockCount: lowStockCount,
    expiringCount: expiringCount,
    incompleteRecipesCount: incompleteRecipes.length,
    dailyCostSeries: dailyCostSeries,
    weeklyCostSeries: weeklyCostSeries,
    vendorCostSeries: vendorCostSeries,
    alerts: alerts
  };
}

function computeDayCost_(dateStr) {
  var menuItems = findRowsBy_('MenuItems', function (m) { return formatValueAsDateStr_(m.MenuDate) === dateStr; });
  var total = 0;
  menuItems.forEach(function (m) {
    if (!m.RecipeID) return;
    total += getRecipeCostPerPortion_(m.RecipeID) * toNumber_(m.QtyTotal);
  });
  return total;
}

function getRecipeCostPerPortion_(recipeId) {
  var recipe = findRowById_('Recipes', 'RecipeID', recipeId);
  if (!recipe || toNumber_(recipe.StandardQty) <= 0) return 0;
  var items = findRowsBy_('RecipeItems', function (ri) { return ri.RecipeID === recipeId; });
  var totalCost = items.reduce(function (sum, ri) { return sum + toNumber_(ri.Cost); }, 0);
  return totalCost / toNumber_(recipe.StandardQty);
}

function formatValueAsDateStr_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDateStr_(value);
  return String(value);
}

// เหมือน formatValueAsDateStr_ แต่ตัดเฉพาะส่วนวันที่จาก timestamp แบบ ISO ("...T...") ด้วย
function dateOnlyStr_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDateStr_(value);
  var s = String(value);
  return s.length >= 10 ? s.substring(0, 10) : s;
}

function round2_(n) {
  return Math.round(toNumber_(n) * 100) / 100;
}

// ==================================================================
// 8) Weekly Menu Planner API
// ==================================================================

function apiGetTimeSlots(token) {
  return apiCall_(token, null, function () {
    return readSheetObjects_('TimeSlots')
      .filter(function (t) { return t.Active !== false && t.Active !== 'FALSE'; })
      .sort(function (a, b) { return toNumber_(a.SortOrder) - toNumber_(b.SortOrder); });
  });
}

function apiGetLocations(token) {
  return apiCall_(token, null, function () {
    return readSheetObjects_('Locations').filter(function (l) { return l.Active !== false && l.Active !== 'FALSE'; });
  });
}

function apiGetWeeklyMenu(token, weekStartStr) {
  return apiCall_(token, null, function () {
    var monday = getMondayOfWeek_(weekStartStr || todayStr_());
    return buildWeeklyMenuView_(monday);
  });
}

function buildWeeklyMenuView_(monday) {
  var weekEnd = formatDateStr_(addDays_(parseDateStr_(monday), 5));
  var weeklyMenu = findRowsBy_('WeeklyMenus', function (w) { return formatValueAsDateStr_(w.WeekStartDate) === monday; })[0];
  var timeSlots = readSheetObjects_('TimeSlots')
    .filter(function (t) { return t.Active !== false && t.Active !== 'FALSE'; })
    .sort(function (a, b) { return toNumber_(a.SortOrder) - toNumber_(b.SortOrder); });

  var allItems = weeklyMenu
    ? findRowsBy_('MenuItems', function (m) { return m.WeeklyMenuID === weeklyMenu.WeeklyMenuID; })
    : [];

  var days = [];
  for (var i = 0; i < 6; i++) {
    var d = formatDateStr_(addDays_(parseDateStr_(monday), i));
    var cells = timeSlots.map(function (ts) {
      var items = allItems.filter(function (m) { return formatValueAsDateStr_(m.MenuDate) === d && m.TimeSlotID === ts.TimeSlotID; });
      return {
        timeSlotId: ts.TimeSlotID,
        timeSlotName: ts.TimeSlotName,
        items: items.map(mapMenuItemOut_)
      };
    });
    days.push({ date: d, dayName: getDayNameTh_(d), cells: cells });
  }

  return {
    weeklyMenuId: weeklyMenu ? weeklyMenu.WeeklyMenuID : null,
    weekStart: monday,
    weekEnd: weekEnd,
    status: weeklyMenu ? weeklyMenu.Status : 'ร่าง',
    days: days
  };
}

function mapMenuItemOut_(m) {
  return {
    menuItemId: m.MenuItemID, menuDate: formatValueAsDateStr_(m.MenuDate), timeSlotId: m.TimeSlotID,
    recipeId: m.RecipeID || '', menuName: m.MenuName, location: m.Location, menuType: m.MenuType,
    qtyMorning: toNumber_(m.QtyMorning), qtyNight: toNumber_(m.QtyNight), qtyTotal: toNumber_(m.QtyTotal),
    notes: m.Notes || ''
  };
}

function getOrCreateWeeklyMenu_(session, monday) {
  var existing = findRowsBy_('WeeklyMenus', function (w) { return formatValueAsDateStr_(w.WeekStartDate) === monday; })[0];
  if (existing) return existing;
  var id = generateId_('WKM');
  writeNewRow_('WeeklyMenus', {
    WeeklyMenuID: id, WeekStartDate: monday, WeekEndDate: formatDateStr_(addDays_(parseDateStr_(monday), 5)),
    Status: 'ร่าง', TemplateName: '', CreatedBy: session.username, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
  });
  return findRowById_('WeeklyMenus', 'WeeklyMenuID', id);
}

/**
 * เพิ่มหรือแก้ไขเมนูในตารางวางแผนรายสัปดาห์ (รองรับบันทึกอัตโนมัติจากหน้าเว็บ)
 */
function apiSaveMenuItem(token, item) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    if (!item || !item.menuDate || !item.timeSlotId) throw new Error('ข้อมูลเมนูไม่ครบถ้วน');
    if (!item.recipeId && !item.menuName) throw new Error('กรุณาเลือกเมนูหรือระบุชื่อเมนู');

    var monday = getMondayOfWeek_(item.menuDate);
    var weeklyMenu = getOrCreateWeeklyMenu_(session, monday);

    var menuName = item.menuName;
    if (item.recipeId) {
      var recipe = findRowById_('Recipes', 'RecipeID', item.recipeId);
      if (!recipe) throw new Error('ไม่พบเมนูที่เลือกในสูตรอาหารมาตรฐาน');
      menuName = recipe.MenuName;
    }

    var qtyMorning = toNumber_(item.qtyMorning);
    var qtyNight = toNumber_(item.qtyNight);
    var qtyTotal = qtyMorning + qtyNight;

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (item.menuItemId) {
        var existing = findRowById_('MenuItems', 'MenuItemID', item.menuItemId);
        if (!existing) throw new Error('ไม่พบรายการเมนูที่จะแก้ไข');
        updateRowByIndex_('MenuItems', existing._row, {
          RecipeID: item.recipeId || '', MenuName: menuName, Location: item.location || '',
          MenuType: item.menuType || '', QtyMorning: qtyMorning, QtyNight: qtyNight, QtyTotal: qtyTotal,
          Notes: item.notes || '', UpdatedAt: nowIso_()
        });
        logAudit_(session, 'UPDATE', 'MenuItems', item.menuItemId, existing, item, item.reason || 'แก้ไขเมนู');
        return mapMenuItemOut_(findRowById_('MenuItems', 'MenuItemID', item.menuItemId));
      } else {
        // ป้องกันการบันทึกเมนูซ้ำในวัน/ช่วงเวลา/สถานที่เดียวกัน
        var dup = findRowsBy_('MenuItems', function (m) {
          return m.WeeklyMenuID === weeklyMenu.WeeklyMenuID && formatValueAsDateStr_(m.MenuDate) === item.menuDate &&
            m.TimeSlotID === item.timeSlotId && m.Location === (item.location || '') && m.MenuName === menuName;
        })[0];
        if (dup) throw new Error('มีเมนู "' + menuName + '" ในช่วงเวลาและสถานที่นี้อยู่แล้ว');

        var newId = generateId_('MNI');
        writeNewRow_('MenuItems', {
          MenuItemID: newId, WeeklyMenuID: weeklyMenu.WeeklyMenuID, MenuDate: item.menuDate,
          DayName: getDayNameTh_(item.menuDate), TimeSlotID: item.timeSlotId, RecipeID: item.recipeId || '',
          MenuName: menuName, Location: item.location || '', MenuType: item.menuType || '',
          QtyMorning: qtyMorning, QtyNight: qtyNight, QtyTotal: qtyTotal, Notes: item.notes || '',
          CreatedBy: session.username, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
        });
        logAudit_(session, 'CREATE', 'MenuItems', newId, null, item, 'เพิ่มเมนูใหม่');
        return mapMenuItemOut_(findRowById_('MenuItems', 'MenuItemID', newId));
      }
    } finally {
      lock.releaseLock();
    }
  });
}

function apiDeleteMenuItem(token, menuItemId, reason) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var existing = findRowById_('MenuItems', 'MenuItemID', menuItemId);
    if (!existing) throw new Error('ไม่พบรายการเมนูนี้');
    deleteRowByIndex_('MenuItems', existing._row);
    logAudit_(session, 'DELETE', 'MenuItems', menuItemId, existing, null, reason || 'ลบเมนู');
    return true;
  });
}

/**
 * คัดลอกเมนูทั้งหมดจากวันหนึ่งไปยังอีกวันหนึ่ง
 */
function apiCopyDayMenu(token, fromDateStr, toDateStr) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var sourceItems = findRowsBy_('MenuItems', function (m) { return formatValueAsDateStr_(m.MenuDate) === fromDateStr; });
      if (sourceItems.length === 0) throw new Error('ไม่มีเมนูในวันต้นทางให้คัดลอก');
      var targetMonday = getMondayOfWeek_(toDateStr);
      var weeklyMenu = getOrCreateWeeklyMenu_(session, targetMonday);
      var count = 0;
      sourceItems.forEach(function (m) {
        var newId = generateId_('MNI');
        writeNewRow_('MenuItems', {
          MenuItemID: newId, WeeklyMenuID: weeklyMenu.WeeklyMenuID, MenuDate: toDateStr,
          DayName: getDayNameTh_(toDateStr), TimeSlotID: m.TimeSlotID, RecipeID: m.RecipeID,
          MenuName: m.MenuName, Location: m.Location, MenuType: m.MenuType,
          QtyMorning: m.QtyMorning, QtyNight: m.QtyNight, QtyTotal: m.QtyTotal, Notes: m.Notes,
          CreatedBy: session.username, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
        });
        count++;
      });
      logAudit_(session, 'COPY_DAY', 'MenuItems', fromDateStr + '->' + toDateStr, null, null, 'คัดลอก ' + count + ' เมนู');
      return { copiedCount: count };
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * คัดลอกเมนูทั้งสัปดาห์ไปยังสัปดาห์ถัดไป (หรือสัปดาห์ใดก็ได้ที่เลือก)
 */
function apiCopyWeekMenu(token, fromWeekStartStr, toWeekStartStr) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var fromMonday = getMondayOfWeek_(fromWeekStartStr);
    var toMonday = getMondayOfWeek_(toWeekStartStr);
    var total = 0;
    for (var i = 0; i < 6; i++) {
      var fromDate = formatDateStr_(addDays_(parseDateStr_(fromMonday), i));
      var toDate = formatDateStr_(addDays_(parseDateStr_(toMonday), i));
      var items = findRowsBy_('MenuItems', function (m) { return formatValueAsDateStr_(m.MenuDate) === fromDate; });
      if (items.length === 0) continue;
      var result = apiCopyDayMenu(token, fromDate, toDate);
      if (result.success) total += result.data.copiedCount;
    }
    return { copiedCount: total };
  });
}

/**
 * บันทึกเมนูของสัปดาห์ที่เลือกเป็น Template เพื่อเรียกใช้ซ้ำในอนาคต
 */
function apiSaveMenuTemplate(token, weekStartStr, templateName) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    if (!templateName) throw new Error('กรุณาระบุชื่อ Template');
    var dup = findRowsBy_('MenuTemplates', function (t) { return t.TemplateName === templateName; })[0];
    if (dup) throw new Error('มีชื่อ Template นี้อยู่แล้ว กรุณาใช้ชื่ออื่น');

    var monday = getMondayOfWeek_(weekStartStr);
    var items = findRowsBy_('MenuItems', function (m) {
      var d = formatValueAsDateStr_(m.MenuDate);
      return d >= monday && d <= formatDateStr_(addDays_(parseDateStr_(monday), 5));
    });
    if (items.length === 0) throw new Error('ไม่มีเมนูในสัปดาห์นี้ให้บันทึกเป็น Template');

    var templateId = generateId_('TPL');
    writeNewRow_('MenuTemplates', { TemplateID: templateId, TemplateName: templateName, CreatedBy: session.username, CreatedAt: nowIso_() });
    items.forEach(function (m) {
      var dayOffset = Math.round((parseDateStr_(formatValueAsDateStr_(m.MenuDate)) - parseDateStr_(monday)) / 86400000);
      writeNewRow_('MenuTemplateItems', {
        TemplateItemID: generateId_('TPI'), TemplateID: templateId, DayOffset: dayOffset, DayName: m.DayName,
        TimeSlotID: m.TimeSlotID, RecipeID: m.RecipeID, MenuName: m.MenuName, Location: m.Location,
        MenuType: m.MenuType, QtyMorning: m.QtyMorning, QtyNight: m.QtyNight, Notes: m.Notes
      });
    });
    logAudit_(session, 'CREATE', 'MenuTemplates', templateId, null, null, 'บันทึก Template จากสัปดาห์ ' + monday);
    return { templateId: templateId };
  });
}

function apiGetMenuTemplates(token) {
  return apiCall_(token, null, function () {
    return readSheetObjects_('MenuTemplates').map(function (t) { return { templateId: t.TemplateID, templateName: t.TemplateName }; });
  });
}

/**
 * นำ Template เมนูมาใช้กับสัปดาห์ที่เลือก
 */
function apiApplyMenuTemplate(token, templateId, weekStartStr) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var template = findRowById_('MenuTemplates', 'TemplateID', templateId);
    if (!template) throw new Error('ไม่พบ Template นี้');
    var monday = getMondayOfWeek_(weekStartStr);
    var weeklyMenu = getOrCreateWeeklyMenu_(session, monday);
    var templateItems = findRowsBy_('MenuTemplateItems', function (ti) { return ti.TemplateID === templateId; });
    var count = 0;
    templateItems.forEach(function (ti) {
      var menuDate = formatDateStr_(addDays_(parseDateStr_(monday), toNumber_(ti.DayOffset)));
      var newId = generateId_('MNI');
      writeNewRow_('MenuItems', {
        MenuItemID: newId, WeeklyMenuID: weeklyMenu.WeeklyMenuID, MenuDate: menuDate,
        DayName: getDayNameTh_(menuDate), TimeSlotID: ti.TimeSlotID, RecipeID: ti.RecipeID,
        MenuName: ti.MenuName, Location: ti.Location, MenuType: ti.MenuType,
        QtyMorning: ti.QtyMorning, QtyNight: ti.QtyNight, QtyTotal: toNumber_(ti.QtyMorning) + toNumber_(ti.QtyNight),
        Notes: ti.Notes, CreatedBy: session.username, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
      });
      count++;
    });
    logAudit_(session, 'APPLY_TEMPLATE', 'WeeklyMenus', weeklyMenu.WeeklyMenuID, null, null, 'ใช้ Template ' + template.TemplateName);
    return { appliedCount: count };
  });
}

// ==================================================================
// 9) Recipe Master API
// ==================================================================

function apiGetIngredients(token) {
  return apiCall_(token, null, function () {
    return readSheetObjects_('Ingredients')
      .filter(function (i) { return i.Active !== false && i.Active !== 'FALSE'; })
      .map(function (i) {
        return {
          ingredientId: i.IngredientID, name: i.IngredientName, category: i.Category, unit: i.Unit,
          standardPrice: toNumber_(i.StandardPrice), latestPrice: toNumber_(i.LatestPrice),
          wastePercent: toNumber_(i.WastePercent), roundingUnit: toNumber_(i.RoundingUnit),
          minOrderQty: toNumber_(i.MinOrderQty), defaultVendorId: i.DefaultVendorID
        };
      });
  });
}

function apiQuickAddIngredient(token, ing) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    if (!ing || !ing.name || !ing.unit) throw new Error('กรุณาระบุชื่อวัตถุดิบและหน่วย');
    var dup = findRowsBy_('Ingredients', function (i) { return i.IngredientName === ing.name; })[0];
    if (dup) throw new Error('มีวัตถุดิบชื่อนี้อยู่แล้ว');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var id = generateId_('ING');
      writeNewRow_('Ingredients', {
        IngredientID: id, IngredientName: ing.name, Category: ing.category || '', Unit: ing.unit,
        StandardPrice: toNumber_(ing.price), LatestPrice: toNumber_(ing.price), AvgPrice: toNumber_(ing.price),
        DefaultVendorID: ing.vendorId || '', WastePercent: toNumber_(ing.wastePercent), RoundingUnit: toNumber_(ing.roundingUnit) || 0.1,
        MinOrderQty: toNumber_(ing.minOrderQty), PackSize: ing.packSize || '', LeadTimeDays: toNumber_(ing.leadTimeDays),
        SafetyStock: toNumber_(ing.safetyStock), Active: true
      });
      logAudit_(session, 'CREATE', 'Ingredients', id, null, ing, 'เพิ่มวัตถุดิบใหม่');
      return { ingredientId: id };
    } finally {
      lock.releaseLock();
    }
  });
}

function apiGetVendorsBasic(token) {
  return apiCall_(token, null, function () {
    return readSheetObjects_('Vendors')
      .filter(function (v) { return v.Active !== false && v.Active !== 'FALSE'; })
      .map(function (v) { return { vendorId: v.VendorID, vendorName: v.VendorName }; });
  });
}

function apiGetRecipes(token) {
  return apiCall_(token, null, function () {
    var recipes = readSheetObjects_('Recipes');
    var items = readSheetObjects_('RecipeItems');
    var countByRecipe = {};
    items.forEach(function (ri) { countByRecipe[ri.RecipeID] = (countByRecipe[ri.RecipeID] || 0) + 1; });
    return recipes.map(function (r) {
      var itemCount = countByRecipe[r.RecipeID] || 0;
      var isComplete = itemCount > 0 && !!r.Steps && toNumber_(r.StandardQty) > 0;
      return {
        recipeId: r.RecipeID, menuCode: r.MenuCode, menuName: r.MenuName, category: r.Category,
        standardQty: toNumber_(r.StandardQty), standardUnit: r.StandardUnit, imageUrl: r.ImageUrl,
        active: r.Active !== false && r.Active !== 'FALSE', itemCount: itemCount, isComplete: isComplete,
        costPerPortion: round2_(getRecipeCostPerPortion_(r.RecipeID))
      };
    });
  });
}

function apiGetRecipe(token, recipeId) {
  return apiCall_(token, null, function () {
    var recipe = findRowById_('Recipes', 'RecipeID', recipeId);
    if (!recipe) throw new Error('ไม่พบสูตรอาหารนี้');
    var items = findRowsBy_('RecipeItems', function (ri) { return ri.RecipeID === recipeId; })
      .sort(function (a, b) { return toNumber_(a.SortOrder) - toNumber_(b.SortOrder); });
    var ingredientMap = {};
    readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    return {
      recipeId: recipe.RecipeID, menuCode: recipe.MenuCode, menuName: recipe.MenuName, category: recipe.Category,
      standardQty: toNumber_(recipe.StandardQty), standardUnit: recipe.StandardUnit, imageUrl: recipe.ImageUrl,
      steps: recipe.Steps, servingMethod: recipe.ServingMethod, qcPoints: recipe.QCPoints,
      temperature: recipe.Temperature, notes: recipe.Notes, active: recipe.Active !== false && recipe.Active !== 'FALSE',
      items: items.map(function (ri) {
        return {
          recipeItemId: ri.RecipeItemID, ingredientId: ri.IngredientID,
          ingredientName: ingredientMap[ri.IngredientID] ? ingredientMap[ri.IngredientID].IngredientName : '(ไม่พบวัตถุดิบ)',
          qty: toNumber_(ri.Qty), unit: ri.Unit, wastePercent: toNumber_(ri.WastePercent), allowance: toNumber_(ri.Allowance),
          vendorId: ri.VendorID, pricePerUnit: toNumber_(ri.PricePerUnit), cost: toNumber_(ri.Cost),
          roundingUnit: toNumber_(ri.RoundingUnit), minOrderQty: toNumber_(ri.MinOrderQty)
        };
      }),
      costPerPortion: round2_(getRecipeCostPerPortion_(recipeId))
    };
  });
}

/**
 * บันทึกสูตรอาหารพร้อมรายการวัตถุดิบทั้งหมด (สร้างใหม่หรือแก้ไข)
 */
function apiSaveRecipe(token, recipe) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    if (!recipe || !recipe.menuName) throw new Error('กรุณาระบุชื่อเมนู');
    if (!recipe.standardQty || toNumber_(recipe.standardQty) <= 0) throw new Error('กรุณาระบุจำนวนมาตรฐานให้มากกว่า 0');
    if (!recipe.items || recipe.items.length === 0) throw new Error('กรุณาเพิ่มวัตถุดิบอย่างน้อย 1 รายการ');

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var recipeId = recipe.recipeId;
      var isNew = !recipeId;

      if (!isNew) {
        var existing = findRowById_('Recipes', 'RecipeID', recipeId);
        if (!existing) throw new Error('ไม่พบสูตรอาหารที่จะแก้ไข');
      } else {
        var dup = findRowsBy_('Recipes', function (r) { return r.MenuName === recipe.menuName; })[0];
        if (dup) throw new Error('มีเมนูชื่อนี้อยู่แล้ว');
        recipeId = generateId_('RCP');
      }

      var recipeRow = {
        RecipeID: recipeId, MenuCode: recipe.menuCode || recipeId, MenuName: recipe.menuName,
        Category: recipe.category || '', StandardQty: toNumber_(recipe.standardQty), StandardUnit: recipe.standardUnit || 'ที่',
        ImageUrl: recipe.imageUrl || '', Steps: recipe.steps || '', ServingMethod: recipe.servingMethod || '',
        QCPoints: recipe.qcPoints || '', Temperature: recipe.temperature || '', Notes: recipe.notes || '',
        Active: recipe.active !== false, UpdatedAt: nowIso_()
      };

      if (isNew) {
        recipeRow.CreatedAt = nowIso_();
        writeNewRow_('Recipes', recipeRow);
      } else {
        updateRowByIndex_('Recipes', findRowById_('Recipes', 'RecipeID', recipeId)._row, recipeRow);
      }

      // แทนที่รายการวัตถุดิบทั้งหมดของสูตรนี้ (ลบของเดิม แล้วเพิ่มใหม่ทั้งหมด)
      var oldItems = findRowsBy_('RecipeItems', function (ri) { return ri.RecipeID === recipeId; });
      // ลบจากแถวท้ายขึ้นไปกันเลขแถวเลื่อน
      oldItems.sort(function (a, b) { return b._row - a._row; }).forEach(function (ri) { deleteRowByIndex_('RecipeItems', ri._row); });

      var ingredientMap = {};
      readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });

      recipe.items.forEach(function (item, idx) {
        if (!item.ingredientId || !ingredientMap[item.ingredientId]) throw new Error('พบวัตถุดิบที่ไม่ถูกต้องในรายการที่ ' + (idx + 1));
        var qty = toNumber_(item.qty);
        var wastePercent = toNumber_(item.wastePercent);
        var allowance = qty * (wastePercent / 100);
        var pricePerUnit = toNumber_(item.pricePerUnit) || toNumber_(ingredientMap[item.ingredientId].LatestPrice);
        var cost = (qty + allowance) * pricePerUnit;
        writeNewRow_('RecipeItems', {
          RecipeItemID: generateId_('RIT'), RecipeID: recipeId, IngredientID: item.ingredientId,
          Qty: qty, Unit: item.unit || ingredientMap[item.ingredientId].Unit, WastePercent: wastePercent,
          Allowance: round2_(allowance), VendorID: item.vendorId || ingredientMap[item.ingredientId].DefaultVendorID,
          PricePerUnit: pricePerUnit, Cost: round2_(cost),
          RoundingUnit: toNumber_(item.roundingUnit) || toNumber_(ingredientMap[item.ingredientId].RoundingUnit),
          MinOrderQty: toNumber_(item.minOrderQty) || toNumber_(ingredientMap[item.ingredientId].MinOrderQty),
          SortOrder: idx + 1
        });
      });

      logAudit_(session, isNew ? 'CREATE' : 'UPDATE', 'Recipes', recipeId, null, recipe, isNew ? 'เพิ่มสูตรอาหารใหม่' : 'แก้ไขสูตรอาหาร');
      return { recipeId: recipeId };
    } finally {
      lock.releaseLock();
    }
  });
}

function apiDeleteRecipe(token, recipeId) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var existing = findRowById_('Recipes', 'RecipeID', recipeId);
    if (!existing) throw new Error('ไม่พบสูตรอาหารนี้');
    // ใช้การปิดใช้งาน (soft delete) เพื่อรักษาความสัมพันธ์กับเมนูที่เคยใช้ในอดีต
    updateRowByIndex_('Recipes', existing._row, { Active: false, UpdatedAt: nowIso_() });
    logAudit_(session, 'DEACTIVATE', 'Recipes', recipeId, existing, null, 'ปิดใช้งานสูตรอาหาร');
    return true;
  });
}

/**
 * ปรับสูตรอาหารตามจำนวนที่ต้องการผลิตจริง (ปรับตามสัดส่วนจากสูตรมาตรฐาน)
 * ตัวอย่าง: สูตรมาตรฐาน 100 ที่ ใช้หมูบด 12 กก. ผลิตจริง 70 ที่ -> 12*70/100 = 8.4 กก.
 */
function apiScaleRecipe(token, recipeId, portions) {
  return apiCall_(token, null, function () {
    var recipe = findRowById_('Recipes', 'RecipeID', recipeId);
    if (!recipe) throw new Error('ไม่พบสูตรอาหารนี้');
    var standardQty = toNumber_(recipe.StandardQty);
    if (standardQty <= 0) throw new Error('สูตรนี้ยังไม่ได้ตั้งค่าจำนวนมาตรฐาน');
    var targetPortions = toNumber_(portions);
    var items = findRowsBy_('RecipeItems', function (ri) { return ri.RecipeID === recipeId; });
    var ingredientMap = {};
    readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    var scale = targetPortions / standardQty;
    var totalCost = 0;
    var scaledItems = items.map(function (ri) {
      var scaledQty = toNumber_(ri.Qty) * scale;
      var scaledAllowance = toNumber_(ri.Allowance) * scale;
      var scaledCost = toNumber_(ri.Cost) * scale;
      totalCost += scaledCost;
      return {
        ingredientName: ingredientMap[ri.IngredientID] ? ingredientMap[ri.IngredientID].IngredientName : '(ไม่พบวัตถุดิบ)',
        unit: ri.Unit, scaledQty: round2_(scaledQty), scaledAllowance: round2_(scaledAllowance),
        roundedQty: round2_(roundToUnit_(scaledQty + scaledAllowance, ri.RoundingUnit)), cost: round2_(scaledCost)
      };
    });
    return { recipeId: recipeId, portions: targetPortions, items: scaledItems, totalCost: round2_(totalCost) };
  });
}

// ==================================================================
// 10) ระบบผู้ใช้งาน (Users) API — สำหรับ Admin เท่านั้น
// ==================================================================

function apiGetUsers(token) {
  return apiCall_(token, [ROLES.ADMIN], function () {
    return readSheetObjects_('Users').map(function (u) {
      return {
        userId: u.UserID, username: u.Username, employeeCode: u.EmployeeCode, fullName: u.FullName,
        role: u.Role, active: u.Active !== false && u.Active !== 'FALSE'
      };
    });
  });
}

function apiSaveUser(token, user) {
  return apiCall_(token, [ROLES.ADMIN], function (session) {
    if (!user || !user.username || !user.fullName || !user.role) throw new Error('กรุณากรอกข้อมูลผู้ใช้งานให้ครบถ้วน');
    if (Object.keys(ROLES).map(function (k) { return ROLES[k]; }).indexOf(user.role) === -1) throw new Error('สิทธิ์ผู้ใช้งานไม่ถูกต้อง');

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (user.userId) {
        var existing = findRowById_('Users', 'UserID', user.userId);
        if (!existing) throw new Error('ไม่พบผู้ใช้งานนี้');
        var patch = {
          Username: user.username, EmployeeCode: user.employeeCode || '', FullName: user.fullName,
          Role: user.role, Active: user.active !== false, UpdatedAt: nowIso_()
        };
        if (user.pin) patch.PIN = hashPin_(user.pin);
        updateRowByIndex_('Users', existing._row, patch);
        logAudit_(session, 'UPDATE', 'Users', user.userId, null, user, 'แก้ไขผู้ใช้งาน');
        return { userId: user.userId };
      } else {
        if (!user.pin) throw new Error('กรุณาระบุ PIN สำหรับผู้ใช้งานใหม่');
        var dup = findRowsBy_('Users', function (u) { return String(u.Username).toLowerCase() === String(user.username).toLowerCase(); })[0];
        if (dup) throw new Error('มีชื่อผู้ใช้งานนี้อยู่แล้ว');
        var id = generateId_('USR');
        writeNewRow_('Users', {
          UserID: id, Username: user.username, EmployeeCode: user.employeeCode || '', FullName: user.fullName,
          PIN: hashPin_(user.pin), Role: user.role, Active: true, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
        });
        logAudit_(session, 'CREATE', 'Users', id, null, user, 'เพิ่มผู้ใช้งานใหม่');
        return { userId: id };
      }
    } finally {
      lock.releaseLock();
    }
  });
}

function apiSetUserActive(token, userId, active) {
  return apiCall_(token, [ROLES.ADMIN], function (session) {
    var existing = findRowById_('Users', 'UserID', userId);
    if (!existing) throw new Error('ไม่พบผู้ใช้งานนี้');
    if (session.userId === userId && !active) throw new Error('ไม่สามารถระงับบัญชีของตนเองได้');
    updateRowByIndex_('Users', existing._row, { Active: !!active, UpdatedAt: nowIso_() });
    logAudit_(session, active ? 'ACTIVATE' : 'DEACTIVATE', 'Users', userId, existing, null, '');
    return true;
  });
}

// ==================================================================
// 11) ระบบค่ามาตรฐาน (Standard Settings) + Vendor Master + Ingredients CRUD เต็มรูปแบบ
// ==================================================================

function apiGetStandardSettings(token) {
  return apiCall_(token, null, function () {
    return readSheetObjects_('StandardSettings').map(function (s) {
      return {
        settingId: s.SettingID, category: s.Category, ingredientId: s.IngredientID,
        allowancePercent: toNumber_(s.AllowancePercent), safetyStock: toNumber_(s.SafetyStock),
        roundingUnit: toNumber_(s.RoundingUnit), minOrderQty: toNumber_(s.MinOrderQty), packSize: s.PackSize,
        standardPrice: toNumber_(s.StandardPrice), latestPrice: toNumber_(s.LatestPrice), avgPrice: toNumber_(s.AvgPrice),
        vendorId: s.VendorID, leadTimeDays: toNumber_(s.LeadTimeDays), deliveryCycle: s.DeliveryCycle,
        receivingPoint: s.ReceivingPoint, notes: s.Notes
      };
    });
  });
}

function apiSaveStandardSetting(token, setting) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    if (!setting || !setting.category) throw new Error('กรุณาระบุหมวดหมู่ค่ามาตรฐาน');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var row = {
        Category: setting.category, IngredientID: setting.ingredientId || '',
        AllowancePercent: toNumber_(setting.allowancePercent), SafetyStock: toNumber_(setting.safetyStock),
        RoundingUnit: toNumber_(setting.roundingUnit), MinOrderQty: toNumber_(setting.minOrderQty),
        PackSize: setting.packSize || '', StandardPrice: toNumber_(setting.standardPrice),
        LatestPrice: toNumber_(setting.latestPrice), AvgPrice: toNumber_(setting.avgPrice),
        VendorID: setting.vendorId || '', LeadTimeDays: toNumber_(setting.leadTimeDays),
        DeliveryCycle: setting.deliveryCycle || '', ReceivingPoint: setting.receivingPoint || '', Notes: setting.notes || ''
      };
      if (setting.settingId) {
        var existing = findRowById_('StandardSettings', 'SettingID', setting.settingId);
        if (!existing) throw new Error('ไม่พบค่ามาตรฐานนี้');
        updateRowByIndex_('StandardSettings', existing._row, row);
        logAudit_(session, 'UPDATE', 'StandardSettings', setting.settingId, null, setting, 'แก้ไขค่ามาตรฐาน');
        return { settingId: setting.settingId };
      } else {
        row.SettingID = generateId_('STD');
        writeNewRow_('StandardSettings', row);
        logAudit_(session, 'CREATE', 'StandardSettings', row.SettingID, null, setting, 'เพิ่มค่ามาตรฐานใหม่');
        return { settingId: row.SettingID };
      }
    } finally {
      lock.releaseLock();
    }
  });
}

function apiDeleteStandardSetting(token, settingId) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var existing = findRowById_('StandardSettings', 'SettingID', settingId);
    if (!existing) throw new Error('ไม่พบค่ามาตรฐานนี้');
    deleteRowByIndex_('StandardSettings', existing._row);
    logAudit_(session, 'DELETE', 'StandardSettings', settingId, existing, null, 'ลบค่ามาตรฐาน');
    return true;
  });
}

function apiGetIngredientsFull(token) {
  return apiCall_(token, null, function () {
    return readSheetObjects_('Ingredients').map(mapIngredientOut_);
  });
}

function mapIngredientOut_(i) {
  return {
    ingredientId: i.IngredientID, name: i.IngredientName, category: i.Category, unit: i.Unit,
    standardPrice: toNumber_(i.StandardPrice), latestPrice: toNumber_(i.LatestPrice), avgPrice: toNumber_(i.AvgPrice),
    defaultVendorId: i.DefaultVendorID, wastePercent: toNumber_(i.WastePercent), roundingUnit: toNumber_(i.RoundingUnit),
    minOrderQty: toNumber_(i.MinOrderQty), packSize: i.PackSize, leadTimeDays: toNumber_(i.LeadTimeDays),
    safetyStock: toNumber_(i.SafetyStock), active: i.Active !== false && i.Active !== 'FALSE'
  };
}

/**
 * เพิ่ม/แก้ไขวัตถุดิบแบบเต็มรูปแบบ (ใช้ในหน้าค่ามาตรฐาน) — รองรับตั้งค่าต่างกันในแต่ละวัตถุดิบ
 */
function apiSaveIngredient(token, ing) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    return upsertIngredient_(session, ing);
  });
}

function upsertIngredient_(session, ing) {
  if (!ing || !ing.name || !ing.unit) throw new Error('กรุณาระบุชื่อวัตถุดิบและหน่วย');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var row = {
      IngredientName: ing.name, Category: ing.category || '', Unit: ing.unit,
      StandardPrice: toNumber_(ing.price || ing.standardPrice), LatestPrice: toNumber_(ing.price || ing.latestPrice),
      AvgPrice: toNumber_(ing.avgPrice) || toNumber_(ing.price || ing.latestPrice),
      DefaultVendorID: ing.vendorId || ing.defaultVendorId || '', WastePercent: toNumber_(ing.wastePercent),
      RoundingUnit: toNumber_(ing.roundingUnit) || 0.1, MinOrderQty: toNumber_(ing.minOrderQty),
      PackSize: ing.packSize || '', LeadTimeDays: toNumber_(ing.leadTimeDays) || 1, SafetyStock: toNumber_(ing.safetyStock),
      Active: ing.active !== false
    };
    if (ing.ingredientId) {
      var existing = findRowById_('Ingredients', 'IngredientID', ing.ingredientId);
      if (!existing) throw new Error('ไม่พบวัตถุดิบนี้');
      updateRowByIndex_('Ingredients', existing._row, row);
      logAudit_(session, 'UPDATE', 'Ingredients', ing.ingredientId, null, ing, 'แก้ไขวัตถุดิบ');
      return { ingredientId: ing.ingredientId };
    } else {
      var dup = findRowsBy_('Ingredients', function (i) { return i.IngredientName === ing.name; })[0];
      if (dup) throw new Error('มีวัตถุดิบชื่อนี้อยู่แล้ว');
      row.IngredientID = generateId_('ING');
      writeNewRow_('Ingredients', row);
      logAudit_(session, 'CREATE', 'Ingredients', row.IngredientID, null, ing, 'เพิ่มวัตถุดิบใหม่');
      return { ingredientId: row.IngredientID };
    }
  } finally {
    lock.releaseLock();
  }
}

function apiSetIngredientActive(token, ingredientId, active) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var existing = findRowById_('Ingredients', 'IngredientID', ingredientId);
    if (!existing) throw new Error('ไม่พบวัตถุดิบนี้');
    updateRowByIndex_('Ingredients', existing._row, { Active: !!active });
    logAudit_(session, active ? 'ACTIVATE' : 'DEACTIVATE', 'Ingredients', ingredientId, existing, null, '');
    return true;
  });
}

function apiGetVendorsFull(token) {
  return apiCall_(token, null, function () {
    return readSheetObjects_('Vendors').map(mapVendorOut_);
  });
}

function mapVendorOut_(v) {
  return {
    vendorId: v.VendorID, vendorName: v.VendorName, contactPerson: v.ContactPerson, phone: v.Phone,
    email: v.Email, line: v.Line, orderDay: v.OrderDay, deliveryDay: v.DeliveryDay, deliveryTime: v.DeliveryTime,
    terms: v.Terms, minOrderUnit: v.MinOrderUnit, active: v.Active !== false && v.Active !== 'FALSE', notes: v.Notes
  };
}

function apiSaveVendor(token, vendor) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    if (!vendor || !vendor.vendorName) throw new Error('กรุณาระบุชื่อ Vendor');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var row = {
        VendorName: vendor.vendorName, ContactPerson: vendor.contactPerson || '', Phone: vendor.phone || '',
        Email: vendor.email || '', Line: vendor.line || '', OrderDay: vendor.orderDay || '',
        DeliveryDay: vendor.deliveryDay || '', DeliveryTime: vendor.deliveryTime || '', Terms: vendor.terms || '',
        MinOrderUnit: vendor.minOrderUnit || '', Active: vendor.active !== false, Notes: vendor.notes || ''
      };
      if (vendor.vendorId) {
        var existing = findRowById_('Vendors', 'VendorID', vendor.vendorId);
        if (!existing) throw new Error('ไม่พบ Vendor นี้');
        updateRowByIndex_('Vendors', existing._row, row);
        logAudit_(session, 'UPDATE', 'Vendors', vendor.vendorId, null, vendor, 'แก้ไข Vendor');
        return { vendorId: vendor.vendorId };
      } else {
        var dup = findRowsBy_('Vendors', function (v) { return v.VendorName === vendor.vendorName; })[0];
        if (dup) throw new Error('มี Vendor ชื่อนี้อยู่แล้ว');
        row.VendorID = generateId_('VEN');
        writeNewRow_('Vendors', row);
        logAudit_(session, 'CREATE', 'Vendors', row.VendorID, null, vendor, 'เพิ่ม Vendor ใหม่');
        return { vendorId: row.VendorID };
      }
    } finally {
      lock.releaseLock();
    }
  });
}

function apiSetVendorActive(token, vendorId, active) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var existing = findRowById_('Vendors', 'VendorID', vendorId);
    if (!existing) throw new Error('ไม่พบ Vendor นี้');
    updateRowByIndex_('Vendors', existing._row, { Active: !!active });
    logAudit_(session, active ? 'ACTIVATE' : 'DEACTIVATE', 'Vendors', vendorId, existing, null, '');
    return true;
  });
}

// ==================================================================
// 12) ระบบสต๊อก (Inventory) — รับเข้า/เบิก (FEFO)/โอนย้าย/ปรับยอด/ตรวจนับ/ของเสีย/หมดอายุ/คืน Vendor
// ==================================================================

function mapLotOut_(lot, ingredientMap, vendorMap) {
  var ing = ingredientMap[lot.IngredientID];
  return {
    lotId: lot.LotID, ingredientId: lot.IngredientID, ingredientName: ing ? ing.IngredientName : '(ไม่พบวัตถุดิบ)',
    unit: ing ? ing.Unit : '', lotNumber: lot.LotNumber, receivedDate: formatValueAsDateStr_(lot.ReceivedDate),
    expiryDate: formatValueAsDateStr_(lot.ExpiryDate), qtyReceived: toNumber_(lot.QtyReceived),
    qtyRemaining: toNumber_(lot.QtyRemaining), pricePerUnit: toNumber_(lot.PricePerUnit),
    vendorId: lot.VendorID, vendorName: vendorMap[lot.VendorID] || '', storageLocation: lot.StorageLocation,
    recordedBy: lot.RecordedBy
  };
}

/**
 * ภาพรวมสต๊อก: สรุปคงเหลือต่อวัตถุดิบ พร้อมล็อตที่ใกล้หมดอายุที่สุด (สำหรับหน้าสต๊อกและแดชบอร์ด)
 */
function apiGetStockOverview(token) {
  return apiCall_(token, null, function () {
    var ingredients = readSheetObjects_('Ingredients').filter(function (i) { return i.Active !== false && i.Active !== 'FALSE'; });
    var lots = readSheetObjects_('InventoryLots');
    var vendorMap = {};
    readSheetObjects_('Vendors').forEach(function (v) { vendorMap[v.VendorID] = v.VendorName; });
    return ingredients.map(function (ing) {
      var ingLots = lots.filter(function (l) { return l.IngredientID === ing.IngredientID && toNumber_(l.QtyRemaining) > 0; })
        .sort(function (a, b) { return formatValueAsDateStr_(a.ExpiryDate) < formatValueAsDateStr_(b.ExpiryDate) ? -1 : 1; });
      var totalRemaining = ingLots.reduce(function (sum, l) { return sum + toNumber_(l.QtyRemaining); }, 0);
      return {
        ingredientId: ing.IngredientID, ingredientName: ing.IngredientName, unit: ing.Unit, category: ing.Category,
        totalRemaining: round2_(totalRemaining), safetyStock: toNumber_(ing.SafetyStock),
        isLow: toNumber_(ing.SafetyStock) > 0 && totalRemaining < toNumber_(ing.SafetyStock),
        lotCount: ingLots.length, nearestExpiry: ingLots.length ? formatValueAsDateStr_(ingLots[0].ExpiryDate) : '',
        defaultVendorName: vendorMap[ing.DefaultVendorID] || ''
      };
    });
  });
}

function apiGetLotsByIngredient(token, ingredientId) {
  return apiCall_(token, null, function () {
    var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    var vendorMap = {}; readSheetObjects_('Vendors').forEach(function (v) { vendorMap[v.VendorID] = v.VendorName; });
    return findRowsBy_('InventoryLots', function (l) { return l.IngredientID === ingredientId; })
      .sort(function (a, b) { return formatValueAsDateStr_(a.ExpiryDate) < formatValueAsDateStr_(b.ExpiryDate) ? -1 : 1; })
      .map(function (l) { return mapLotOut_(l, ingredientMap, vendorMap); });
  });
}

function apiGetStockTransactions(token, filters) {
  return apiCall_(token, null, function () {
    filters = filters || {};
    var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    var rows = readSheetObjects_('StockTransactions');
    if (filters.ingredientId) rows = rows.filter(function (r) { return r.IngredientID === filters.ingredientId; });
    if (filters.transType) rows = rows.filter(function (r) { return r.TransType === filters.transType; });
    if (filters.from) rows = rows.filter(function (r) { return formatValueAsDateStr_(r.TransDate) >= filters.from; });
    if (filters.to) rows = rows.filter(function (r) { return formatValueAsDateStr_(r.TransDate) <= filters.to; });
    return rows.sort(function (a, b) { return a.Timestamp < b.Timestamp ? 1 : -1; }).map(function (r) {
      return {
        transId: r.TransID, transDate: formatValueAsDateStr_(r.TransDate), transType: r.TransType,
        ingredientId: r.IngredientID, ingredientName: ingredientMap[r.IngredientID] ? ingredientMap[r.IngredientID].IngredientName : '',
        qty: toNumber_(r.Qty), fromLocation: r.FromLocation, toLocation: r.ToLocation, reason: r.Reason, recordedBy: r.RecordedBy
      };
    });
  });
}

function recordStockTransaction_(session, data) {
  writeNewRow_('StockTransactions', {
    TransID: generateId_('TRX'), TransDate: data.transDate || todayStr_(), TransType: data.transType,
    IngredientID: data.ingredientId, LotID: data.lotId || '', Qty: data.qty, FromLocation: data.fromLocation || '',
    ToLocation: data.toLocation || '', Reason: data.reason || '', RecordedBy: session.username, Timestamp: nowIso_()
  });
}

/**
 * รับเข้าวัตถุดิบ: สร้างล็อตใหม่ พร้อมปรับราคาล่าสุด/เฉลี่ยของวัตถุดิบอัตโนมัติ
 */
function apiReceiveStock(token, data) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.STAFF], function (session) {
    if (!data || !data.ingredientId || !(toNumber_(data.qtyReceived) > 0)) throw new Error('กรุณาระบุวัตถุดิบและจำนวนรับเข้าให้ถูกต้อง');
    var ingredient = findRowById_('Ingredients', 'IngredientID', data.ingredientId);
    if (!ingredient) throw new Error('ไม่พบวัตถุดิบนี้');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var lotId = generateId_('LOT');
      var qty = toNumber_(data.qtyReceived);
      var price = toNumber_(data.pricePerUnit) || toNumber_(ingredient.LatestPrice);
      writeNewRow_('InventoryLots', {
        LotID: lotId, IngredientID: data.ingredientId, LotNumber: data.lotNumber || lotId,
        ReceivedDate: data.receivedDate || todayStr_(), ExpiryDate: data.expiryDate || '',
        QtyReceived: qty, QtyRemaining: qty, PricePerUnit: price, VendorID: data.vendorId || ingredient.DefaultVendorID,
        StorageLocation: data.storageLocation || '', RecordedBy: session.username, CreatedAt: nowIso_()
      });
      recordStockTransaction_(session, { transType: 'รับเข้า', ingredientId: data.ingredientId, lotId: lotId, qty: qty, toLocation: data.storageLocation, reason: data.reason });

      var avgPrice = (toNumber_(ingredient.AvgPrice) + price) / 2;
      updateRowByIndex_('Ingredients', ingredient._row, { LatestPrice: price, AvgPrice: round2_(avgPrice) });

      logAudit_(session, 'CREATE', 'InventoryLots', lotId, null, data, 'รับเข้าวัตถุดิบ');
      return { lotId: lotId };
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * เบิกใช้วัตถุดิบตามหลัก FEFO (ของหมดอายุก่อนถูกตัดออกก่อน)
 */
function apiIssueStock(token, data) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.STAFF], function (session) {
    return issueStockFefo_(session, data.ingredientId, toNumber_(data.qty), 'เบิกใช้', data.location, data.reason);
  });
}

function issueStockFefo_(session, ingredientId, qtyToIssue, transType, location, reason) {
  if (!ingredientId || qtyToIssue <= 0) throw new Error('กรุณาระบุวัตถุดิบและจำนวนให้ถูกต้อง');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var lots = findRowsBy_('InventoryLots', function (l) { return l.IngredientID === ingredientId && toNumber_(l.QtyRemaining) > 0; })
      .sort(function (a, b) { return formatValueAsDateStr_(a.ExpiryDate) < formatValueAsDateStr_(b.ExpiryDate) ? -1 : 1; });
    var totalAvailable = lots.reduce(function (sum, l) { return sum + toNumber_(l.QtyRemaining); }, 0);
    if (totalAvailable < qtyToIssue) throw new Error('สต๊อกไม่เพียงพอ (มี ' + round2_(totalAvailable) + ' ต้องการ ' + qtyToIssue + ')');

    var remaining = qtyToIssue;
    lots.forEach(function (lot) {
      if (remaining <= 0) return;
      var take = Math.min(remaining, toNumber_(lot.QtyRemaining));
      updateRowByIndex_('InventoryLots', lot._row, { QtyRemaining: round2_(toNumber_(lot.QtyRemaining) - take) });
      remaining -= take;
    });
    recordStockTransaction_(session, { transType: transType, ingredientId: ingredientId, qty: qtyToIssue, fromLocation: location, reason: reason });
    logAudit_(session, transType.toUpperCase(), 'InventoryLots', ingredientId, null, { qty: qtyToIssue }, reason || '');
    return { issuedQty: qtyToIssue };
  } finally {
    lock.releaseLock();
  }
}

/**
 * โอนย้ายวัตถุดิบระหว่างสถานที่ (เช่น ตึก 1 <-> ตึก 16) — ตัดจากต้นทาง FEFO แล้วเพิ่มล็อตใหม่ที่ปลายทาง
 */
function apiTransferStock(token, data) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.STAFF], function (session) {
    if (!data || !data.ingredientId || !(toNumber_(data.qty) > 0) || !data.fromLocation || !data.toLocation) {
      throw new Error('กรุณาระบุวัตถุดิบ จำนวน และสถานที่ต้นทาง-ปลายทางให้ครบถ้วน');
    }
    issueStockFefo_(session, data.ingredientId, toNumber_(data.qty), 'โอนย้ายออก', data.fromLocation, data.reason);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var ingredient = findRowById_('Ingredients', 'IngredientID', data.ingredientId);
      var newLotId = generateId_('LOT');
      writeNewRow_('InventoryLots', {
        LotID: newLotId, IngredientID: data.ingredientId, LotNumber: newLotId, ReceivedDate: todayStr_(),
        ExpiryDate: data.expiryDate || '', QtyReceived: toNumber_(data.qty), QtyRemaining: toNumber_(data.qty),
        PricePerUnit: toNumber_(ingredient.LatestPrice), VendorID: ingredient.DefaultVendorID,
        StorageLocation: data.toLocation, RecordedBy: session.username, CreatedAt: nowIso_()
      });
      recordStockTransaction_(session, { transType: 'โอนย้ายเข้า', ingredientId: data.ingredientId, lotId: newLotId, qty: toNumber_(data.qty), toLocation: data.toLocation, reason: data.reason });
      return { newLotId: newLotId };
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * ปรับยอดสต๊อก (จากการตรวจนับจริง) — บันทึกส่วนต่างเป็นธุรกรรม "ปรับยอด" หรือ "ตรวจนับ"
 */
function apiAdjustStock(token, data) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.STAFF], function (session) {
    if (!data || !data.lotId || !data.reason) throw new Error('กรุณาระบุล็อตและเหตุผลในการปรับยอด');
    var lot = findRowById_('InventoryLots', 'LotID', data.lotId);
    if (!lot) throw new Error('ไม่พบล็อตนี้');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var oldQty = toNumber_(lot.QtyRemaining);
      var newQty = toNumber_(data.newQty);
      if (newQty < 0) throw new Error('จำนวนคงเหลือใหม่ต้องไม่ติดลบ');
      updateRowByIndex_('InventoryLots', lot._row, { QtyRemaining: newQty });
      recordStockTransaction_(session, {
        transType: data.transType === 'ตรวจนับ' ? 'ตรวจนับ' : 'ปรับยอด', ingredientId: lot.IngredientID, lotId: data.lotId,
        qty: round2_(newQty - oldQty), toLocation: lot.StorageLocation, reason: data.reason
      });
      logAudit_(session, 'UPDATE', 'InventoryLots', data.lotId, { qty: oldQty }, { qty: newQty }, data.reason);
      return true;
    } finally {
      lock.releaseLock();
    }
  });
}

/**
 * บันทึกของเสีย (waste) — ตัดออกจากล็อตที่ระบุ
 */
function apiRecordWaste(token, data) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.STAFF], function (session) {
    return deductFromLot_(session, data, 'ของเสีย');
  });
}

/**
 * บันทึกของหมดอายุ — ตัดออกจากล็อตที่ระบุ (ปกติใช้กับล็อตที่เลยวันหมดอายุแล้ว)
 */
function apiRecordExpired(token, data) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.STAFF], function (session) {
    return deductFromLot_(session, data, 'หมดอายุ');
  });
}

/**
 * คืนวัตถุดิบให้ Vendor — ตัดออกจากล็อตที่ระบุ
 */
function apiReturnToVendor(token, data) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.STAFF], function (session) {
    return deductFromLot_(session, data, 'คืน Vendor');
  });
}

function deductFromLot_(session, data, transType) {
  if (!data || !data.lotId || !(toNumber_(data.qty) > 0)) throw new Error('กรุณาระบุล็อตและจำนวนให้ถูกต้อง');
  var lot = findRowById_('InventoryLots', 'LotID', data.lotId);
  if (!lot) throw new Error('ไม่พบล็อตนี้');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var remaining = toNumber_(lot.QtyRemaining);
    if (remaining < toNumber_(data.qty)) throw new Error('จำนวนที่ระบุมากกว่าจำนวนคงเหลือในล็อต (คงเหลือ ' + remaining + ')');
    updateRowByIndex_('InventoryLots', lot._row, { QtyRemaining: round2_(remaining - toNumber_(data.qty)) });
    recordStockTransaction_(session, { transType: transType, ingredientId: lot.IngredientID, lotId: data.lotId, qty: toNumber_(data.qty), fromLocation: lot.StorageLocation, reason: data.reason });
    logAudit_(session, transType.toUpperCase(), 'InventoryLots', data.lotId, null, data, data.reason || '');
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ==================================================================
// 13) ใบสั่งซื้อ (Purchase Orders): สร้างอัตโนมัติจากเมนู, แก้ไขรายการ, PDF
// ==================================================================

/**
 * สร้าง/รีเฟรชใบสั่งซื้อจากเมนูของวันที่ระบุ: รวมวัตถุดิบตามสูตร หักสต๊อกคงเหลือ เผื่อ Safety Stock
 * ปัดตามหน่วยสั่งซื้อ และแยกเป็นใบสั่งซื้อย่อยตาม Vendor
 */
function apiGeneratePurchaseOrder(token, dateStr) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    if (!dateStr) throw new Error('กรุณาระบุวันที่');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var menuItems = findRowsBy_('MenuItems', function (m) { return formatValueAsDateStr_(m.MenuDate) === dateStr; });
      if (menuItems.length === 0) throw new Error('ไม่มีเมนูของวันที่นี้ กรุณาวางแผนเมนูก่อนสร้างใบสั่งซื้อ');

      var recipeMap = {}; readSheetObjects_('Recipes').forEach(function (r) { recipeMap[r.RecipeID] = r; });
      var recipeItems = readSheetObjects_('RecipeItems');
      var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
      var stockByIngredient = {};
      readSheetObjects_('InventoryLots').forEach(function (l) {
        stockByIngredient[l.IngredientID] = (stockByIngredient[l.IngredientID] || 0) + toNumber_(l.QtyRemaining);
      });

      // รวมความต้องการวัตถุดิบจากทุกเมนูของวันนี้ (รวมรายการที่ซ้ำกัน)
      var need = {}; // ingredientId -> {qty, allowance}
      menuItems.forEach(function (m) {
        if (!m.RecipeID) return;
        var recipe = recipeMap[m.RecipeID];
        if (!recipe || toNumber_(recipe.StandardQty) <= 0) return;
        var scale = toNumber_(m.QtyTotal) / toNumber_(recipe.StandardQty);
        recipeItems.filter(function (ri) { return ri.RecipeID === m.RecipeID; }).forEach(function (ri) {
          var qty = toNumber_(ri.Qty) * scale;
          var allowance = toNumber_(ri.Allowance) * scale;
          if (!need[ri.IngredientID]) need[ri.IngredientID] = { qty: 0, allowance: 0, vendorId: ri.VendorID, roundingUnit: toNumber_(ri.RoundingUnit), minOrderQty: toNumber_(ri.MinOrderQty) };
          need[ri.IngredientID].qty += qty;
          need[ri.IngredientID].allowance += allowance;
        });
      });

      // จัดกลุ่มตาม Vendor แล้วสร้าง PurchaseOrders + PurchaseOrderItems (สถานะ "ร่าง")
      var byVendor = {};
      Object.keys(need).forEach(function (ingId) {
        var ingredient = ingredientMap[ingId];
        if (!ingredient) return;
        var n = need[ingId];
        var vendorId = n.vendorId || ingredient.DefaultVendorID || 'NOVENDOR';
        if (!byVendor[vendorId]) byVendor[vendorId] = [];
        var available = stockByIngredient[ingId] || 0;
        var safetyStock = toNumber_(ingredient.SafetyStock);
        var beforeStock = n.qty + n.allowance;
        var suggested = beforeStock - available + safetyStock;
        if (suggested < 0) suggested = 0;
        var roundingUnit = n.roundingUnit || toNumber_(ingredient.RoundingUnit);
        var rounded = roundToUnit_(suggested, roundingUnit);
        var minOrderQty = n.minOrderQty || toNumber_(ingredient.MinOrderQty);
        if (rounded > 0 && rounded < minOrderQty) rounded = minOrderQty;
        byVendor[vendorId].push({ ingredientId: ingId, qtySuggested: round2_(rounded), pricePerUnit: toNumber_(ingredient.LatestPrice) });
      });

      var createdPoIds = [];
      Object.keys(byVendor).forEach(function (vendorId) {
        var lines = byVendor[vendorId].filter(function (l) { return l.qtySuggested > 0; });
        if (lines.length === 0) return;
        // ถ้ามีใบสั่งซื้อของ Vendor นี้ในวันที่นี้อยู่แล้วและยังเป็นร่าง ให้ลบรายการเดิมแล้วสร้างใหม่ (รีเฟรช)
        var existingPo = findRowsBy_('PurchaseOrders', function (po) {
          return po.VendorID === vendorId && formatValueAsDateStr_(po.UseDate) === dateStr && po.Status === 'ร่าง';
        })[0];
        var poId;
        if (existingPo) {
          poId = existingPo.POID;
          findRowsBy_('PurchaseOrderItems', function (it) { return it.POID === poId; })
            .sort(function (a, b) { return b._row - a._row; }).forEach(function (it) { deleteRowByIndex_('PurchaseOrderItems', it._row); });
        } else {
          poId = generateId_('PO');
          var poNumber = 'PO' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd') + '-' + poId.split('-')[1];
          writeNewRow_('PurchaseOrders', {
            POID: poId, PONumber: poNumber, OrderDate: todayStr_(), UseDate: dateStr, TimeSlotID: '', VendorID: vendorId,
            Status: 'ร่าง', TotalAmount: 0, CreatedBy: session.username, ApprovedBy: '', PDFUrl: '',
            CreatedAt: nowIso_(), UpdatedAt: nowIso_()
          });
        }
        var totalAmount = 0;
        lines.forEach(function (line) {
          var ingredient = ingredientMap[line.ingredientId];
          var totalPrice = round2_(line.qtySuggested * line.pricePerUnit);
          totalAmount += totalPrice;
          writeNewRow_('PurchaseOrderItems', {
            POItemID: generateId_('POI'), POID: poId, IngredientID: line.ingredientId, QtySuggested: line.qtySuggested,
            QtyOrdered: line.qtySuggested, Unit: ingredient.Unit, PricePerUnit: line.pricePerUnit, TotalPrice: totalPrice,
            VendorID: vendorId, DeliveryCycle: '', Skipped: false, Notes: '', EditedBy: '', EditedAt: '', Reason: ''
          });
        });
        updateRowByIndex_('PurchaseOrders', findRowById_('PurchaseOrders', 'POID', poId)._row, { TotalAmount: round2_(totalAmount), UpdatedAt: nowIso_() });
        createdPoIds.push(poId);
      });

      if (createdPoIds.length === 0) throw new Error('ไม่มีรายการที่ต้องสั่งซื้อ (สต๊อกเพียงพอสำหรับเมนูวันนี้แล้ว)');
      logAudit_(session, 'GENERATE', 'PurchaseOrders', dateStr, null, null, 'สร้างใบสั่งซื้อจากเมนูวันที่ ' + dateStr);
      return { poIds: createdPoIds };
    } finally {
      lock.releaseLock();
    }
  });
}

function apiListPurchaseOrders(token, dateStr) {
  return apiCall_(token, null, function () {
    var vendorMap = {}; readSheetObjects_('Vendors').forEach(function (v) { vendorMap[v.VendorID] = v.VendorName; });
    var pos = readSheetObjects_('PurchaseOrders');
    if (dateStr) pos = pos.filter(function (po) { return formatValueAsDateStr_(po.UseDate) === dateStr; });
    return pos.sort(function (a, b) { return a.CreatedAt < b.CreatedAt ? 1 : -1; }).map(function (po) {
      return {
        poId: po.POID, poNumber: po.PONumber, orderDate: formatValueAsDateStr_(po.OrderDate), useDate: formatValueAsDateStr_(po.UseDate),
        vendorId: po.VendorID, vendorName: vendorMap[po.VendorID] || '(ไม่ระบุ Vendor)', status: po.Status,
        totalAmount: toNumber_(po.TotalAmount), createdBy: po.CreatedBy, approvedBy: po.ApprovedBy, pdfUrl: po.PDFUrl
      };
    });
  });
}

function apiGetPurchaseOrder(token, poId) {
  return apiCall_(token, null, function () {
    var po = findRowById_('PurchaseOrders', 'POID', poId);
    if (!po) throw new Error('ไม่พบใบสั่งซื้อนี้');
    var vendorMap = {}; readSheetObjects_('Vendors').forEach(function (v) { vendorMap[v.VendorID] = v; });
    var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    var items = findRowsBy_('PurchaseOrderItems', function (it) { return it.POID === poId; }).map(function (it) {
      var ing = ingredientMap[it.IngredientID];
      return {
        poItemId: it.POItemID, ingredientId: it.IngredientID, ingredientName: ing ? ing.IngredientName : '(ไม่พบวัตถุดิบ)',
        qtySuggested: toNumber_(it.QtySuggested), qtyOrdered: toNumber_(it.QtyOrdered), unit: it.Unit,
        pricePerUnit: toNumber_(it.PricePerUnit), totalPrice: toNumber_(it.TotalPrice), vendorId: it.VendorID,
        deliveryCycle: it.DeliveryCycle, skipped: it.Skipped === true || it.Skipped === 'TRUE', notes: it.Notes
      };
    });
    var vendor = vendorMap[po.VendorID];
    return {
      poId: po.POID, poNumber: po.PONumber, orderDate: formatValueAsDateStr_(po.OrderDate), useDate: formatValueAsDateStr_(po.UseDate),
      vendorId: po.VendorID, vendorName: vendor ? vendor.VendorName : '(ไม่ระบุ Vendor)', status: po.Status,
      totalAmount: toNumber_(po.TotalAmount), createdBy: po.CreatedBy, approvedBy: po.ApprovedBy, pdfUrl: po.PDFUrl, items: items
    };
  });
}

/**
 * แก้ไขรายการในใบสั่งซื้อ: ใช้ค่าระบบ/เพิ่ม/ลด/งดสั่ง/เปลี่ยน Vendor/เปลี่ยนรอบส่ง/เพิ่มหมายเหตุ
 * ทุกการแก้ไขจะถูกบันทึกประวัติ (ค่าเดิม, ค่าใหม่, ผู้แก้ไข, เวลา, เหตุผล) ลงใน PurchaseOrderItemHistory
 */
function apiUpdatePurchaseOrderItem(token, patch) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    if (!patch || !patch.poItemId) throw new Error('ไม่พบรายการที่จะแก้ไข');
    var existing = findRowById_('PurchaseOrderItems', 'POItemID', patch.poItemId);
    if (!existing) throw new Error('ไม่พบรายการนี้ในใบสั่งซื้อ');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var fields = [
        ['QtyOrdered', 'qtyOrdered'], ['VendorID', 'vendorId'], ['DeliveryCycle', 'deliveryCycle'],
        ['Skipped', 'skipped'], ['Notes', 'notes']
      ];
      var updates = {};
      fields.forEach(function (pair) {
        var sheetField = pair[0], jsField = pair[1];
        if (!patch.hasOwnProperty(jsField)) return;
        var oldVal = existing[sheetField];
        var newVal = patch[jsField];
        if (String(oldVal) === String(newVal)) return;
        updates[sheetField] = newVal;
        writeNewRow_('PurchaseOrderItemHistory', {
          HistoryID: generateId_('POH'), POItemID: patch.poItemId, FieldChanged: sheetField,
          OldValue: String(oldVal == null ? '' : oldVal), NewValue: String(newVal == null ? '' : newVal),
          EditedBy: session.username, EditedAt: nowIso_(), Reason: patch.reason || ''
        });
      });
      if (Object.keys(updates).length > 0) {
        var qty = updates.hasOwnProperty('QtyOrdered') ? toNumber_(updates.QtyOrdered) : toNumber_(existing.QtyOrdered);
        updates.TotalPrice = round2_(qty * toNumber_(existing.PricePerUnit));
        updates.EditedBy = session.username;
        updates.EditedAt = nowIso_();
        updates.Reason = patch.reason || '';
        updateRowByIndex_('PurchaseOrderItems', existing._row, updates);
        recalcPurchaseOrderTotal_(existing.POID);
      }
      return true;
    } finally {
      lock.releaseLock();
    }
  });
}

function recalcPurchaseOrderTotal_(poId) {
  var items = findRowsBy_('PurchaseOrderItems', function (it) { return it.POID === poId; });
  var total = items.reduce(function (sum, it) {
    if (it.Skipped === true || it.Skipped === 'TRUE') return sum;
    return sum + toNumber_(it.TotalPrice);
  }, 0);
  var po = findRowById_('PurchaseOrders', 'POID', poId);
  if (po) updateRowByIndex_('PurchaseOrders', po._row, { TotalAmount: round2_(total), UpdatedAt: nowIso_() });
}

function apiGetPurchaseOrderItemHistory(token, poItemId) {
  return apiCall_(token, null, function () {
    return findRowsBy_('PurchaseOrderItemHistory', function (h) { return h.POItemID === poItemId; })
      .sort(function (a, b) { return a.EditedAt < b.EditedAt ? 1 : -1; })
      .map(function (h) { return { field: h.FieldChanged, oldValue: h.OldValue, newValue: h.NewValue, editedBy: h.EditedBy, editedAt: h.EditedAt, reason: h.Reason }; });
  });
}

function apiApprovePurchaseOrder(token, poId) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var po = findRowById_('PurchaseOrders', 'POID', poId);
    if (!po) throw new Error('ไม่พบใบสั่งซื้อนี้');
    updateRowByIndex_('PurchaseOrders', po._row, { Status: 'อนุมัติแล้ว', ApprovedBy: session.username, UpdatedAt: nowIso_() });
    logAudit_(session, 'APPROVE', 'PurchaseOrders', poId, null, null, 'อนุมัติใบสั่งซื้อ');
    return true;
  });
}

/* ---------------- การสร้างไฟล์ PDF ใบสั่งซื้อ (ใช้เทคนิคสร้างชีตชั่วคราวแล้ว Export เป็น PDF) ---------------- */

function getOrCreatePdfFolder_() {
  var folders = DriveApp.getFoldersByName('MEKTEC Canteen PDFs');
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder('MEKTEC Canteen PDFs');
}

function buildPoPrintSheet_(poId) {
  var po = findRowById_('PurchaseOrders', 'POID', poId);
  if (!po) throw new Error('ไม่พบใบสั่งซื้อนี้');
  var vendor = findRowById_('Vendors', 'VendorID', po.VendorID);
  var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
  var items = findRowsBy_('PurchaseOrderItems', function (it) { return it.POID === poId && it.Skipped !== true && it.Skipped !== 'TRUE'; });

  var ss = getOrCreateSpreadsheet_();
  var sheetName = 'PRINT_' + poId;
  var old = ss.getSheetByName(sheetName);
  if (old) ss.deleteSheet(old);
  var sheet = ss.insertSheet(sheetName);

  var companyName = getSetting_('CompanyName') || 'MEKTEC';
  var row = 1;
  sheet.getRange(row, 1, 1, 7).merge().setValue(companyName).setFontSize(16).setFontWeight('bold'); row++;
  sheet.getRange(row, 1, 1, 7).merge().setValue('ใบสั่งซื้อ (Purchase Order)').setFontSize(14).setFontWeight('bold'); row++;
  sheet.getRange(row, 1).setValue('เลขที่เอกสาร: ' + po.PONumber);
  sheet.getRange(row, 5).setValue('วันที่สั่งซื้อ: ' + formatValueAsDateStr_(po.OrderDate)); row++;
  sheet.getRange(row, 1).setValue('วันที่ใช้สินค้า: ' + formatValueAsDateStr_(po.UseDate));
  sheet.getRange(row, 5).setValue('Vendor: ' + (vendor ? vendor.VendorName : '-')); row++;
  sheet.getRange(row, 1).setValue('ผู้ติดต่อ: ' + (vendor ? vendor.ContactPerson + ' ' + vendor.Phone : '-')); row += 2;

  var headerRow = row;
  var headers = ['ลำดับ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ราคารวม', 'หมายเหตุ'];
  sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#fff');
  row++;

  var total = 0;
  items.forEach(function (it, idx) {
    var ing = ingredientMap[it.IngredientID];
    var qty = toNumber_(it.QtyOrdered);
    var lineTotal = round2_(qty * toNumber_(it.PricePerUnit));
    total += lineTotal;
    sheet.getRange(row, 1, 1, 7).setValues([[idx + 1, ing ? ing.IngredientName : it.IngredientID, qty, it.Unit,
      toNumber_(it.PricePerUnit), lineTotal, it.Notes || '']]);
    row++;
  });

  sheet.getRange(row, 5).setValue('รวมจำนวนเงิน').setFontWeight('bold');
  sheet.getRange(row, 6).setValue(round2_(total)).setFontWeight('bold');
  row += 3;

  sheet.getRange(row, 1).setValue('ผู้จัดทำ: ' + (po.CreatedBy || '________________'));
  sheet.getRange(row, 4).setValue('ผู้ตรวจสอบ: ________________');
  sheet.getRange(row, 6).setValue('ผู้อนุมัติ: ' + (po.ApprovedBy || '________________')); row++;
  sheet.getRange(row, 1).setValue('วันที่พิมพ์: ' + Utilities.formatDate(new Date(), TIMEZONE, 'dd/MM/yyyy HH:mm'));

  sheet.getRange(1, 1, row, 7).setFontFamily('Sarabun');
  sheet.setColumnWidths(1, 7, 90);
  sheet.setColumnWidth(2, 200);
  sheet.setFrozenRows(headerRow);
  sheet.setColumnWidth(1, 50);

  return { sheet: sheet, lastRow: row };
}

function exportSheetAsPdf_(sheet) {
  var ss = getOrCreateSpreadsheet_();
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export' +
    '?format=pdf&gid=' + sheet.getSheetId() +
    '&size=A4&portrait=true&fitw=true&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5' +
    '&sheetnames=false&printtitle=false&pagenumbers=true&gridlines=false&fzr=true';
  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('ไม่สามารถสร้าง PDF ได้ (HTTP ' + response.getResponseCode() + ')');
  return response.getBlob();
}

/**
 * สร้างไฟล์ PDF ใบสั่งซื้อแยกตาม Vendor บันทึกลง Google Drive แล้วคืน URL สำหรับดาวน์โหลด/พิมพ์
 */
function apiGeneratePurchaseOrderPdf(token, poId) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var po = findRowById_('PurchaseOrders', 'POID', poId);
    if (!po) throw new Error('ไม่พบใบสั่งซื้อนี้');
    var built = buildPoPrintSheet_(poId);
    try {
      var blob = exportSheetAsPdf_(built.sheet).setName(po.PONumber + '.pdf');
      var folder = getOrCreatePdfFolder_();
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      updateRowByIndex_('PurchaseOrders', po._row, { PDFUrl: file.getUrl(), UpdatedAt: nowIso_() });
      logAudit_(session, 'EXPORT_PDF', 'PurchaseOrders', poId, null, null, 'สร้าง PDF ใบสั่งซื้อ');
      return { url: file.getUrl(), fileId: file.getId() };
    } finally {
      getOrCreateSpreadsheet_().deleteSheet(built.sheet);
    }
  });
}

/**
 * สร้าง PDF สรุปใบสั่งซื้อรวมทุก Vendor ของวันที่ระบุไว้ในไฟล์เดียว (สำหรับตรวจสอบภาพรวมทั้งวัน)
 */
function apiGeneratePurchaseOrderPdfAll(token, dateStr) {
  return apiCall_(token, [ROLES.ADMIN, ROLES.SUPERVISOR], function (session) {
    var pos = findRowsBy_('PurchaseOrders', function (po) { return formatValueAsDateStr_(po.UseDate) === dateStr; });
    if (pos.length === 0) throw new Error('ไม่มีใบสั่งซื้อของวันที่นี้');

    var ss = getOrCreateSpreadsheet_();
    var sheetName = 'PRINT_ALL_' + dateStr.replace(/-/g, '');
    var old = ss.getSheetByName(sheetName);
    if (old) ss.deleteSheet(old);
    var sheet = ss.insertSheet(sheetName);
    var vendorMap = {}; readSheetObjects_('Vendors').forEach(function (v) { vendorMap[v.VendorID] = v.VendorName; });
    var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    var companyName = getSetting_('CompanyName') || 'MEKTEC';

    var row = 1;
    sheet.getRange(row, 1, 1, 7).merge().setValue(companyName + ' — สรุปใบสั่งซื้อรวมวันที่ ' + dateStr)
      .setFontSize(15).setFontWeight('bold'); row += 2;

    var grandTotal = 0;
    pos.forEach(function (po) {
      var items = findRowsBy_('PurchaseOrderItems', function (it) { return it.POID === po.POID && it.Skipped !== true && it.Skipped !== 'TRUE'; });
      if (items.length === 0) return;
      sheet.getRange(row, 1, 1, 7).merge().setValue('Vendor: ' + (vendorMap[po.VendorID] || '-') + ' | เลขที่: ' + po.PONumber)
        .setFontWeight('bold').setBackground('#e8f0fe'); row++;
      var headers = ['ลำดับ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'ราคารวม', 'หมายเหตุ'];
      sheet.getRange(row, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#fff'); row++;
      var vendorTotal = 0;
      items.forEach(function (it, idx) {
        var ing = ingredientMap[it.IngredientID];
        var qty = toNumber_(it.QtyOrdered);
        var lineTotal = round2_(qty * toNumber_(it.PricePerUnit));
        vendorTotal += lineTotal;
        sheet.getRange(row, 1, 1, 7).setValues([[idx + 1, ing ? ing.IngredientName : it.IngredientID, qty, it.Unit,
          toNumber_(it.PricePerUnit), lineTotal, it.Notes || '']]);
        row++;
      });
      sheet.getRange(row, 5).setValue('รวม Vendor นี้').setFontWeight('bold');
      sheet.getRange(row, 6).setValue(round2_(vendorTotal)).setFontWeight('bold');
      grandTotal += vendorTotal;
      row += 2;
    });

    sheet.getRange(row, 5).setValue('รวมทั้งหมดทุก Vendor').setFontWeight('bold');
    sheet.getRange(row, 6).setValue(round2_(grandTotal)).setFontWeight('bold');
    sheet.getRange(1, 1, row, 7).setFontFamily('Sarabun');
    sheet.setColumnWidths(1, 7, 90);
    sheet.setColumnWidth(2, 200);

    try {
      var blob = exportSheetAsPdf_(sheet).setName('PO-ALL-' + dateStr + '.pdf');
      var folder = getOrCreatePdfFolder_();
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      logAudit_(session, 'EXPORT_PDF', 'PurchaseOrders', dateStr, null, null, 'สร้าง PDF รวมทั้งวัน');
      return { url: file.getUrl(), fileId: file.getId() };
    } finally {
      ss.deleteSheet(sheet);
    }
  });
}

// ==================================================================
// 14) คู่มือครัวประจำวัน (Kitchen Today) + QR Code deep-link
// ==================================================================

function apiGetKitchenToday(token, dateStr, timeSlotId) {
  return apiCall_(token, null, function () {
    var menuItems = findRowsBy_('MenuItems', function (m) {
      return formatValueAsDateStr_(m.MenuDate) === dateStr && (!timeSlotId || m.TimeSlotID === timeSlotId);
    });
    return menuItems.map(function (m) {
      var out = { menuItemId: m.MenuItemID, menuName: m.MenuName, location: m.Location, menuType: m.MenuType,
        qtyMorning: toNumber_(m.QtyMorning), qtyNight: toNumber_(m.QtyNight), qtyTotal: toNumber_(m.QtyTotal), notes: m.Notes };
      if (m.RecipeID) {
        var recipe = findRowById_('Recipes', 'RecipeID', m.RecipeID);
        if (recipe) {
          var scaled = computeScaledIngredients_(m.RecipeID, toNumber_(m.QtyTotal));
          out.recipeId = recipe.RecipeID;
          out.imageUrl = recipe.ImageUrl; out.steps = recipe.Steps; out.servingMethod = recipe.ServingMethod;
          out.qcPoints = recipe.QCPoints; out.temperature = recipe.Temperature;
          out.scaledIngredients = scaled.items; out.scaledCost = scaled.totalCost;
        }
      }
      return out;
    });
  });
}

function computeScaledIngredients_(recipeId, portions) {
  var recipe = findRowById_('Recipes', 'RecipeID', recipeId);
  if (!recipe || toNumber_(recipe.StandardQty) <= 0) return { items: [], totalCost: 0 };
  var scale = portions / toNumber_(recipe.StandardQty);
  var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
  var items = findRowsBy_('RecipeItems', function (ri) { return ri.RecipeID === recipeId; });
  var totalCost = 0;
  var out = items.map(function (ri) {
    var scaledQty = toNumber_(ri.Qty) * scale;
    var scaledAllowance = toNumber_(ri.Allowance) * scale;
    var scaledCost = toNumber_(ri.Cost) * scale;
    totalCost += scaledCost;
    return {
      ingredientName: ingredientMap[ri.IngredientID] ? ingredientMap[ri.IngredientID].IngredientName : '(ไม่พบวัตถุดิบ)',
      unit: ri.Unit, scaledQty: round2_(scaledQty), scaledAllowance: round2_(scaledAllowance),
      roundedQty: round2_(roundToUnit_(scaledQty + scaledAllowance, ri.RoundingUnit)), cost: round2_(scaledCost)
    };
  });
  return { items: out, totalCost: round2_(totalCost) };
}

function apiGetWebAppUrl(token) {
  return apiCall_(token, null, function () { return ScriptApp.getService().getUrl(); });
}

// ==================================================================
// 15) ใบประกาศเมนู (Menu Announcement)
// ==================================================================

function apiGetMenuAnnouncement(token, weekStartStr) {
  return apiCall_(token, null, function () {
    var monday = getMondayOfWeek_(weekStartStr);
    var wm = buildWeeklyMenuView_(monday);
    return {
      companyName: getSetting_('CompanyName') || 'MEKTEC',
      weekStart: wm.weekStart, weekEnd: wm.weekEnd,
      days: wm.days.map(function (day) {
        return {
          date: day.date, dayName: day.dayName,
          cells: day.cells.map(function (c) {
            return { timeSlotName: c.timeSlotName, items: c.items.map(function (it) { return it.menuName + ' (' + it.qtyTotal + ' ที่)'; }) };
          })
        };
      })
    };
  });
}

// ==================================================================
// 16) รายงาน (Reports) + Export PDF/Excel
// ==================================================================

function apiReportCostByRange(token, from, to) {
  return apiCall_(token, null, function () {
    var out = [];
    var d = parseDateStr_(from);
    var end = parseDateStr_(to);
    while (d <= end) {
      var dateStr = formatDateStr_(d);
      out.push({ date: dateStr, cost: round2_(computeDayCost_(dateStr)) });
      d = addDays_(d, 1);
    }
    return out;
  });
}

function apiReportCostByMenu(token, from, to) {
  return apiCall_(token, null, function () {
    var menuItems = findRowsBy_('MenuItems', function (m) {
      var d = formatValueAsDateStr_(m.MenuDate); return d >= from && d <= to;
    });
    var byMenu = {};
    menuItems.forEach(function (m) {
      if (!m.RecipeID) return;
      var cost = getRecipeCostPerPortion_(m.RecipeID) * toNumber_(m.QtyTotal);
      if (!byMenu[m.MenuName]) byMenu[m.MenuName] = { menuName: m.MenuName, qtyTotal: 0, cost: 0 };
      byMenu[m.MenuName].qtyTotal += toNumber_(m.QtyTotal);
      byMenu[m.MenuName].cost += cost;
    });
    return Object.keys(byMenu).map(function (k) {
      var r = byMenu[k];
      return { menuName: r.menuName, qtyTotal: r.qtyTotal, cost: round2_(r.cost), costPerPortion: round2_(r.qtyTotal ? r.cost / r.qtyTotal : 0) };
    }).sort(function (a, b) { return b.cost - a.cost; });
  });
}

function apiReportPurchaseByVendor(token, from, to) {
  return apiCall_(token, null, function () {
    var vendorMap = {}; readSheetObjects_('Vendors').forEach(function (v) { vendorMap[v.VendorID] = v.VendorName; });
    var pos = findRowsBy_('PurchaseOrders', function (po) {
      var d = formatValueAsDateStr_(po.OrderDate); return d >= from && d <= to;
    });
    var byVendor = {};
    pos.forEach(function (po) {
      var name = vendorMap[po.VendorID] || '(ไม่ระบุ)';
      byVendor[name] = (byVendor[name] || 0) + toNumber_(po.TotalAmount);
    });
    return Object.keys(byVendor).map(function (k) { return { vendorName: k, totalAmount: round2_(byVendor[k]) }; })
      .sort(function (a, b) { return b.totalAmount - a.totalAmount; });
  });
}

function apiReportUsageVsStandard(token, from, to) {
  return apiCall_(token, null, function () {
    var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    var actual = {};
    findRowsBy_('StockTransactions', function (t) {
      var d = formatValueAsDateStr_(t.TransDate); return t.TransType === 'เบิกใช้' && d >= from && d <= to;
    }).forEach(function (t) { actual[t.IngredientID] = (actual[t.IngredientID] || 0) + toNumber_(t.Qty); });

    var standard = {};
    var recipeMap = {}; readSheetObjects_('Recipes').forEach(function (r) { recipeMap[r.RecipeID] = r; });
    var recipeItems = readSheetObjects_('RecipeItems');
    findRowsBy_('MenuItems', function (m) {
      var d = formatValueAsDateStr_(m.MenuDate); return d >= from && d <= to && m.RecipeID;
    }).forEach(function (m) {
      var recipe = recipeMap[m.RecipeID];
      if (!recipe || toNumber_(recipe.StandardQty) <= 0) return;
      var scale = toNumber_(m.QtyTotal) / toNumber_(recipe.StandardQty);
      recipeItems.filter(function (ri) { return ri.RecipeID === m.RecipeID; }).forEach(function (ri) {
        standard[ri.IngredientID] = (standard[ri.IngredientID] || 0) + (toNumber_(ri.Qty) + toNumber_(ri.Allowance)) * scale;
      });
    });

    var ids = Array.from(new Set(Object.keys(actual).concat(Object.keys(standard))));
    return ids.map(function (id) {
      var ing = ingredientMap[id];
      var std = round2_(standard[id] || 0), act = round2_(actual[id] || 0);
      return { ingredientId: id, ingredientName: ing ? ing.IngredientName : id, unit: ing ? ing.Unit : '', standardQty: std, actualQty: act, diff: round2_(act - std) };
    }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
  });
}

function apiReportFrequentAdjustments(token, from, to) {
  return apiCall_(token, null, function () {
    var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    var poItemMap = {}; readSheetObjects_('PurchaseOrderItems').forEach(function (it) { poItemMap[it.POItemID] = it; });
    var history = findRowsBy_('PurchaseOrderItemHistory', function (h) {
      var d = dateOnlyStr_(h.EditedAt);
      return d >= from && d <= to;
    });
    var counts = {};
    history.forEach(function (h) {
      var it = poItemMap[h.POItemID];
      var ingId = it ? it.IngredientID : '';
      var name = ingredientMap[ingId] ? ingredientMap[ingId].IngredientName : '(ไม่ทราบ)';
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.keys(counts).map(function (k) { return { ingredientName: k, editCount: counts[k] }; })
      .sort(function (a, b) { return b.editCount - a.editCount; });
  });
}

function apiReportWaste(token, from, to) { return reportStockEvent_(token, from, to, 'ของเสีย'); }
function apiReportExpired(token, from, to) { return reportStockEvent_(token, from, to, 'หมดอายุ'); }

function reportStockEvent_(token, from, to, transType) {
  return apiCall_(token, null, function () {
    var ingredientMap = {}; readSheetObjects_('Ingredients').forEach(function (i) { ingredientMap[i.IngredientID] = i; });
    return findRowsBy_('StockTransactions', function (t) {
      var d = formatValueAsDateStr_(t.TransDate); return t.TransType === transType && d >= from && d <= to;
    }).map(function (t) {
      var ing = ingredientMap[t.IngredientID];
      return { date: formatValueAsDateStr_(t.TransDate), ingredientName: ing ? ing.IngredientName : t.IngredientID, unit: ing ? ing.Unit : '', qty: toNumber_(t.Qty), reason: t.Reason, recordedBy: t.RecordedBy };
    });
  });
}

function apiReportStockOnHand(token) {
  return apiCall_(token, null, function () {
    return apiGetStockOverview(token).data;
  });
}

function apiReportPriceHistory(token, ingredientId) {
  return apiCall_(token, null, function () {
    var ingredient = findRowById_('Ingredients', 'IngredientID', ingredientId);
    if (!ingredient) throw new Error('ไม่พบวัตถุดิบนี้');
    return findRowsBy_('InventoryLots', function (l) { return l.IngredientID === ingredientId; })
      .sort(function (a, b) { return formatValueAsDateStr_(a.ReceivedDate) < formatValueAsDateStr_(b.ReceivedDate) ? -1 : 1; })
      .map(function (l) { return { date: formatValueAsDateStr_(l.ReceivedDate), pricePerUnit: toNumber_(l.PricePerUnit), vendorId: l.VendorID, lotNumber: l.LotNumber }; });
  });
}

/**
 * ส่งออกรายงานทั่วไป (ตาราง columns/rows) เป็น PDF หรือ Excel โดยสร้างชีตชั่วคราวแล้ว Export
 * ใช้ร่วมกันได้กับทุกรายงานในหน้า Reports ของฝั่งไคลเอนต์
 */
function apiExportReport(token, title, columns, rows, format) {
  return apiCall_(token, null, function (session) {
    var ss = getOrCreateSpreadsheet_();
    var sheetName = 'PRINT_REPORT_' + Utilities.getUuid().slice(0, 8);
    var sheet = ss.insertSheet(sheetName);
    try {
      sheet.getRange(1, 1, 1, columns.length).merge().setValue(title).setFontSize(14).setFontWeight('bold');
      sheet.getRange(2, 1, 1, columns.length).setValues([columns]).setFontWeight('bold').setBackground('#1a73e8').setFontColor('#fff');
      if (rows.length > 0) sheet.getRange(3, 1, rows.length, columns.length).setValues(rows);
      sheet.setFrozenRows(2);
      sheet.autoResizeColumns(1, columns.length);

      var mimeFormat = format === 'xlsx' ? 'xlsx' : 'pdf';
      var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=' + mimeFormat + '&gid=' + sheet.getSheetId();
      if (mimeFormat === 'pdf') url += '&size=A4&portrait=false&fitw=true&sheetnames=false&printtitle=false&pagenumbers=true&gridlines=false&fzr=true';
      var oauthToken = ScriptApp.getOAuthToken();
      var response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + oauthToken }, muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) throw new Error('ไม่สามารถส่งออกรายงานได้ (HTTP ' + response.getResponseCode() + ')');
      var blob = response.getBlob().setName(title + '.' + mimeFormat);
      var folder = getOrCreatePdfFolder_();
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return { url: file.getUrl() };
    } finally {
      ss.deleteSheet(sheet);
    }
  });
}

// ==================================================================
// 17) ข้อมูลตัวอย่างสำหรับทดลองระบบ (Sample Data)
// ==================================================================

function seedSampleDataIfEmpty_() {
  if (readSheetObjects_('Users').length === 0) seedSampleUsers_();
  if (readSheetObjects_('Vendors').length === 0) seedSampleVendors_();
  if (readSheetObjects_('Ingredients').length === 0) seedSampleIngredients_();
  if (readSheetObjects_('Recipes').length === 0) seedSampleRecipes_();
  if (readSheetObjects_('WeeklyMenus').length === 0) seedSampleWeeklyMenu_();
  if (readSheetObjects_('StandardSettings').length === 0) seedSampleStandardSettings_();
  if (readSheetObjects_('InventoryLots').length === 0) seedSampleStock_();
}

/**
 * ข้อมูลตัวอย่างระบบสต๊อก: รับเข้าล็อตวัตถุดิบตัวอย่าง (บางล็อตใกล้หมดอายุเพื่อสาธิตการแจ้งเตือน FEFO)
 */
function seedSampleStock_() {
  var ingredients = readSheetObjects_('Ingredients');
  var locations = readSheetObjects_('Locations');
  var loc1 = locations[0] ? locations[0].LocationName : 'ตึก 1';
  var today = todayStr_();

  ingredients.forEach(function (ing, idx) {
    // ล็อตที่ 1: รับเข้าเมื่อ 2 วันก่อน หมดอายุในอีก 2 วัน (ใกล้หมดอายุ เพื่อสาธิตการแจ้งเตือน)
    var qty1 = idx % 3 === 0 ? 3 : 8;
    var lot1Id = generateId_('LOT');
    writeNewRow_('InventoryLots', {
      LotID: lot1Id, IngredientID: ing.IngredientID, LotNumber: lot1Id,
      ReceivedDate: formatDateStr_(addDays_(new Date(), -2)), ExpiryDate: formatDateStr_(addDays_(new Date(), 2)),
      QtyReceived: qty1, QtyRemaining: qty1, PricePerUnit: toNumber_(ing.LatestPrice), VendorID: ing.DefaultVendorID,
      StorageLocation: loc1, RecordedBy: 'admin', CreatedAt: nowIso_()
    });
    writeNewRow_('StockTransactions', {
      TransID: generateId_('TRX'), TransDate: formatDateStr_(addDays_(new Date(), -2)), TransType: 'รับเข้า',
      IngredientID: ing.IngredientID, LotID: lot1Id, Qty: qty1, FromLocation: '', ToLocation: loc1,
      Reason: 'รับเข้าตัวอย่างสำหรับทดลองระบบ', RecordedBy: 'admin', Timestamp: nowIso_()
    });

    // ล็อตที่ 2: รับเข้าวันนี้ หมดอายุในอีก 10 วัน (สต๊อกหลัก)
    var qty2 = 15;
    var lot2Id = generateId_('LOT');
    writeNewRow_('InventoryLots', {
      LotID: lot2Id, IngredientID: ing.IngredientID, LotNumber: lot2Id,
      ReceivedDate: today, ExpiryDate: formatDateStr_(addDays_(new Date(), 10)),
      QtyReceived: qty2, QtyRemaining: qty2, PricePerUnit: toNumber_(ing.LatestPrice), VendorID: ing.DefaultVendorID,
      StorageLocation: loc1, RecordedBy: 'admin', CreatedAt: nowIso_()
    });
    writeNewRow_('StockTransactions', {
      TransID: generateId_('TRX'), TransDate: today, TransType: 'รับเข้า', IngredientID: ing.IngredientID,
      LotID: lot2Id, Qty: qty2, FromLocation: '', ToLocation: loc1, Reason: 'รับเข้าตัวอย่างสำหรับทดลองระบบ',
      RecordedBy: 'admin', Timestamp: nowIso_()
    });
  });
}

function seedSampleUsers_() {
  var users = [
    ['admin', 'EMP001', 'ผู้ดูแลระบบ', '1234', ROLES.ADMIN],
    ['supervisor', 'EMP002', 'หัวหน้าโรงอาหาร', '1111', ROLES.SUPERVISOR],
    ['staff', 'EMP003', 'พนักงานครัว', '2222', ROLES.STAFF],
    ['viewer', 'EMP004', 'ผู้เยี่ยมชมข้อมูล', '3333', ROLES.VIEWER]
  ];
  users.forEach(function (u) {
    writeNewRow_('Users', {
      UserID: generateId_('USR'), Username: u[0], EmployeeCode: u[1], FullName: u[2],
      PIN: hashPin_(u[3]), Role: u[4], Active: true, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
    });
  });
}

function seedSampleVendors_() {
  var vendors = [
    ['Betagro', 'คุณสมชาย', '02-111-1111', 'betagro@example.com', '@betagro', 'เนื้อสัตว์'],
    ['Puangploy', 'คุณสมหญิง', '02-222-2222', 'puangploy@example.com', '@puangploy', 'ผักสด'],
    ['Makro', 'คุณวิชัย', '02-333-3333', 'makro@example.com', '@makro', 'ของแห้งและเครื่องปรุง']
  ];
  var ids = [];
  vendors.forEach(function (v) {
    var id = generateId_('VEN');
    ids.push(id);
    writeNewRow_('Vendors', {
      VendorID: id, VendorName: v[0], ContactPerson: v[1], Phone: v[2], Email: v[3], Line: v[4],
      OrderDay: 'จันทร์,พุธ,ศุกร์', DeliveryDay: 'อังคาร,พฤหัสบดี,เสาร์', DeliveryTime: '06:00',
      Terms: 'เครดิต 30 วัน', MinOrderUnit: '1 หน่วยบรรจุ', Active: true, Notes: 'จำหน่าย' + v[5]
    });
  });
  return ids;
}

function seedSampleIngredients_() {
  var vendors = readSheetObjects_('Vendors');
  var vMeat = (vendors.filter(function (v) { return v.VendorName === 'Betagro'; })[0] || {}).VendorID || '';
  var vVeg = (vendors.filter(function (v) { return v.VendorName === 'Puangploy'; })[0] || {}).VendorID || '';
  var vDry = (vendors.filter(function (v) { return v.VendorName === 'Makro'; })[0] || {}).VendorID || '';

  // คอลัมน์: ชื่อ, หมวดหมู่, หน่วย, ราคา, VendorID, เผื่อ%, ปัดหน่วย, ขั้นต่ำสั่งซื้อ, Safety Stock
  var list = [
    ['หมูบด', 'เนื้อสัตว์', 'กก.', 140, vMeat, 3, 0.5, 1, 5],
    ['หมูหั่นบาง', 'เนื้อสัตว์', 'กก.', 150, vMeat, 3, 0.5, 1, 5],
    ['เนื้อไก่', 'เนื้อสัตว์', 'กก.', 80, vMeat, 3, 0.5, 1, 4],
    ['ไข่ไก่', 'เนื้อสัตว์', 'ฟอง', 4.5, vMeat, 2, 30, 30, 30],
    ['ผักกาดขาว', 'ผักสด', 'กก.', 25, vVeg, 8, 1, 2, 5],
    ['ใบกะเพรา', 'ผักสด', 'กก.', 60, vVeg, 8, 1, 1, 2],
    ['พริก', 'ผักสด', 'กก.', 80, vVeg, 8, 0.5, 1, 1],
    ['กระเทียม', 'ผักสด', 'กก.', 70, vVeg, 8, 0.5, 1, 1],
    ['น้ำมันพืช', 'ของแห้งและเครื่องปรุง', 'ลิตร', 48, vDry, 2, 1, 5, 3],
    ['น้ำปลา', 'ของแห้งและเครื่องปรุง', 'ลิตร', 35, vDry, 2, 1, 5, 3],
    ['ซอสปรุงรส', 'ของแห้งและเครื่องปรุง', 'ขวด', 40, vDry, 2, 1, 6, 3],
    ['ข้าวสาร', 'ของแห้งและเครื่องปรุง', 'กก.', 28, vDry, 2, 5, 25, 10]
  ];
  var idMap = {};
  list.forEach(function (row) {
    var id = generateId_('ING');
    idMap[row[0]] = id;
    writeNewRow_('Ingredients', {
      IngredientID: id, IngredientName: row[0], Category: row[1], Unit: row[2],
      StandardPrice: row[3], LatestPrice: row[3], AvgPrice: row[3], DefaultVendorID: row[4],
      WastePercent: row[5], RoundingUnit: row[6], MinOrderQty: row[7], PackSize: '', LeadTimeDays: 1,
      SafetyStock: row[8], Active: true
    });
  });
  return idMap;
}

function seedSampleRecipes_() {
  var ing = {};
  readSheetObjects_('Ingredients').forEach(function (i) { ing[i.IngredientName] = i; });

  var recipes = [
    {
      code: 'ผัดกะเพราหมู', category: 'เมนูหลัก',
      steps: '1. ตั้งกระทะใส่น้ำมัน\n2. ผัดกระเทียมพริกให้หอม\n3. ใส่หมูบดผัดให้สุก\n4. ปรุงรสด้วยน้ำปลาและซอสปรุงรส\n5. ใส่ใบกะเพราผัดให้ทั่ว',
      serving: 'ตักคู่ข้าวสวย โรยพริกป่นและใบกะเพราทอดด้านบน', qc: 'หมูสุกทั่วถึง ไม่มีกลิ่นคาว', temp: 'ร้อน 60°C ขึ้นไป',
      items: [['หมูบด', 12, 3], ['ใบกะเพรา', 2, 8], ['พริก', 1, 8], ['กระเทียม', 0.8, 8], ['น้ำมันพืช', 2, 2], ['น้ำปลา', 1, 2], ['ซอสปรุงรส', 2, 2]]
    },
    {
      code: 'ต้มจืดผักกาดขาว', category: 'เมนูหลัก',
      steps: '1. ต้มน้ำซุปให้เดือด\n2. ใส่หมูหั่นบางลงต้ม\n3. ใส่ผักกาดขาว\n4. ปรุงรสด้วยน้ำปลาและกระเทียมเจียว',
      serving: 'ตักใส่ถ้วย โรยต้นหอมผักชี', qc: 'ผักสุกกำลังดี น้ำซุปใส', temp: 'ร้อน 60°C ขึ้นไป',
      items: [['ผักกาดขาว', 15, 8], ['หมูหั่นบาง', 5, 3], ['กระเทียม', 0.5, 8], ['น้ำปลา', 0.5, 2]]
    },
    {
      code: 'ก๋วยเตี๋ยวหมู', category: 'เมนูหลัก',
      steps: '1. ลวกเส้นก๋วยเตี๋ยว\n2. ต้มน้ำซุปหมูให้เดือด\n3. ใส่หมูหั่นบางและผักกาดขาว\n4. ปรุงรสด้วยน้ำปลา',
      serving: 'จัดเส้นในชาม ราดน้ำซุปและเครื่อง โรยกระเทียมเจียว', qc: 'เส้นไม่เละ น้ำซุปร้อนจัด', temp: 'ร้อน 60°C ขึ้นไป',
      items: [['หมูหั่นบาง', 8, 3], ['ผักกาดขาว', 6, 8], ['กระเทียม', 0.3, 8], ['น้ำปลา', 1, 2]]
    },
    {
      code: 'ผัดพริกแกงไก่', category: 'เมนูหลัก',
      steps: '1. ตั้งกระทะใส่น้ำมัน\n2. ผัดพริกแกงให้หอม\n3. ใส่เนื้อไก่ผัดให้สุก\n4. ปรุงรสด้วยน้ำปลา',
      serving: 'ตักคู่ข้าวสวย', qc: 'ไก่สุกทั่วถึง กลิ่นหอมพริกแกง', temp: 'ร้อน 60°C ขึ้นไป',
      items: [['เนื้อไก่', 10, 3], ['พริก', 1.5, 8], ['กระเทียม', 0.5, 8], ['น้ำมันพืช', 1.5, 2], ['น้ำปลา', 0.5, 2]]
    },
    {
      code: 'ข้าวต้มหมูบด', category: 'เมนูข้าวต้ม',
      steps: '1. ต้มข้าวสารกับน้ำจนเปื่อย\n2. ใส่หมูบดปั้นเป็นก้อนต้มจนสุก\n3. ปรุงรสด้วยน้ำปลาและกระเทียมเจียว',
      serving: 'ตักใส่ถ้วย โรยต้นหอมขิงซอย', qc: 'ข้าวต้มเปื่อยนุ่ม หมูสุกทั่วถึง', temp: 'ร้อน 60°C ขึ้นไป',
      items: [['ข้าวสาร', 8, 2], ['หมูบด', 6, 3], ['กระเทียม', 0.3, 8], ['น้ำปลา', 0.5, 2]]
    },
    {
      code: 'ไข่ต้ม', category: 'อาหารว่าง',
      steps: '1. ต้มไข่ไก่ในน้ำเดือด 10-12 นาที\n2. แช่น้ำเย็นแล้วปอกเปลือก',
      serving: 'จัดใส่ถาด 1 ฟองต่อที่', qc: 'ไข่สุกทั่วถึง ไม่มีรอยแตก', temp: 'อุณหภูมิห้อง',
      items: [['ไข่ไก่', 100, 2]]
    }
  ];

  var idMap = {};
  recipes.forEach(function (r) {
    var id = generateId_('RCP');
    idMap[r.code] = id;
    writeNewRow_('Recipes', {
      RecipeID: id, MenuCode: id, MenuName: r.code, Category: r.category, StandardQty: 100, StandardUnit: 'ที่',
      ImageUrl: '', Steps: r.steps, ServingMethod: r.serving, QCPoints: r.qc, Temperature: r.temp, Notes: '',
      Active: true, CreatedAt: nowIso_(), UpdatedAt: nowIso_()
    });
    r.items.forEach(function (it, idx) {
      var ingredient = ing[it[0]];
      if (!ingredient) return;
      var qty = it[1], wastePercent = it[2];
      var allowance = qty * (wastePercent / 100);
      var price = toNumber_(ingredient.LatestPrice);
      writeNewRow_('RecipeItems', {
        RecipeItemID: generateId_('RIT'), RecipeID: id, IngredientID: ingredient.IngredientID,
        Qty: qty, Unit: ingredient.Unit, WastePercent: wastePercent, Allowance: round2_(allowance),
        VendorID: ingredient.DefaultVendorID, PricePerUnit: price, Cost: round2_((qty + allowance) * price),
        RoundingUnit: toNumber_(ingredient.RoundingUnit), MinOrderQty: toNumber_(ingredient.MinOrderQty), SortOrder: idx + 1
      });
    });
  });
  return idMap;
}

function seedSampleWeeklyMenu_() {
  var recipes = {};
  readSheetObjects_('Recipes').forEach(function (r) { recipes[r.MenuName] = r; });
  var timeSlots = readSheetObjects_('TimeSlots').sort(function (a, b) { return toNumber_(a.SortOrder) - toNumber_(b.SortOrder); });
  var locations = readSheetObjects_('Locations');
  var loc1 = locations[0] ? locations[0].LocationName : 'ตึก 1';
  var loc2 = locations[1] ? locations[1].LocationName : 'ตึก 16';

  // ใช้สัปดาห์ปัจจุบันของระบบเป็นสัปดาห์ตัวอย่าง
  var monday = getMondayOfWeek_(todayStr_());
  var weeklyMenuId = generateId_('WKM');
  writeNewRow_('WeeklyMenus', {
    WeeklyMenuID: weeklyMenuId, WeekStartDate: monday, WeekEndDate: formatDateStr_(addDays_(parseDateStr_(monday), 5)),
    Status: 'เผยแพร่แล้ว', TemplateName: '', CreatedBy: 'admin', CreatedAt: nowIso_(), UpdatedAt: nowIso_()
  });

  // แผนเมนูตัวอย่าง: ช่วงเช้า (06:00-08:00) และช่วงกลางวัน (10:00-13:00) ของแต่ละวัน จันทร์-เสาร์
  var plan = [
    ['ผัดกะเพราหมู', 'ต้มจืดผักกาดขาว'],
    ['ก๋วยเตี๋ยวหมู', 'ผัดพริกแกงไก่'],
    ['ข้าวต้มหมูบด', 'ไข่ต้ม'],
    ['ผัดกะเพราหมู', 'ก๋วยเตี๋ยวหมู'],
    ['ผัดพริกแกงไก่', 'ต้มจืดผักกาดขาว'],
    ['ข้าวต้มหมูบด', 'ผัดกะเพราหมู']
  ];

  for (var d = 0; d < 6; d++) {
    var date = formatDateStr_(addDays_(parseDateStr_(monday), d));
    [0, 1].forEach(function (slotIdx) {
      var menuName = plan[d][slotIdx];
      var recipe = recipes[menuName];
      if (!recipe) return;
      var qtyMorning = 40, qtyNight = 30;
      writeNewRow_('MenuItems', {
        MenuItemID: generateId_('MNI'), WeeklyMenuID: weeklyMenuId, MenuDate: date, DayName: getDayNameTh_(date),
        TimeSlotID: timeSlots[slotIdx].TimeSlotID, RecipeID: recipe.RecipeID, MenuName: recipe.MenuName,
        Location: slotIdx === 0 ? loc1 : loc2, MenuType: recipe.Category, QtyMorning: qtyMorning, QtyNight: qtyNight,
        QtyTotal: qtyMorning + qtyNight, Notes: '', CreatedBy: 'admin', CreatedAt: nowIso_(), UpdatedAt: nowIso_()
      });
    });
  }
}

function seedSampleStandardSettings_() {
  var ing = {};
  readSheetObjects_('Ingredients').forEach(function (i) { ing[i.IngredientName] = i; });
  var settings = [
    ['เนื้อสัตว์', null, 3, 0, 0.5, 0, ''],
    ['ผักสด', null, 8, 0, 1, 0, ''],
    ['เครื่องปรุง', null, 2, 0, 0.1, 0, ''],
    ['ไข่ไก่', ing['ไข่ไก่'] ? ing['ไข่ไก่'].IngredientID : '', 2, 0, 30, 30, 'ปัดเป็นถาดละ 30 ฟอง']
  ];
  settings.forEach(function (s) {
    writeNewRow_('StandardSettings', {
      SettingID: generateId_('STD'), Category: s[0], IngredientID: s[1] || '', AllowancePercent: s[2],
      SafetyStock: s[3], RoundingUnit: s[4], MinOrderQty: s[5], PackSize: '', StandardPrice: 0, LatestPrice: 0,
      AvgPrice: 0, VendorID: '', LeadTimeDays: 1, DeliveryCycle: '', ReceivingPoint: '', Notes: s[6]
    });
  });
}
