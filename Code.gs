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
var SYSTEM_VERSION = '1.0.0'; // เฟส 1
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
    'PricePerUnit', 'TotalPrice', 'Notes', 'EditedBy', 'EditedAt', 'Reason'],

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
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
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
// 11) ข้อมูลตัวอย่างสำหรับทดลองระบบ (Sample Data)
// ==================================================================

function seedSampleDataIfEmpty_() {
  if (readSheetObjects_('Users').length === 0) seedSampleUsers_();
  if (readSheetObjects_('Vendors').length === 0) seedSampleVendors_();
  if (readSheetObjects_('Ingredients').length === 0) seedSampleIngredients_();
  if (readSheetObjects_('Recipes').length === 0) seedSampleRecipes_();
  if (readSheetObjects_('WeeklyMenus').length === 0) seedSampleWeeklyMenu_();
  if (readSheetObjects_('StandardSettings').length === 0) seedSampleStandardSettings_();
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

  var list = [
    ['หมูบด', 'เนื้อสัตว์', 'กก.', 140, vMeat, 3, 0.5, 1],
    ['หมูหั่นบาง', 'เนื้อสัตว์', 'กก.', 150, vMeat, 3, 0.5, 1],
    ['เนื้อไก่', 'เนื้อสัตว์', 'กก.', 80, vMeat, 3, 0.5, 1],
    ['ไข่ไก่', 'เนื้อสัตว์', 'ฟอง', 4.5, vMeat, 2, 30, 30],
    ['ผักกาดขาว', 'ผักสด', 'กก.', 25, vVeg, 8, 1, 2],
    ['ใบกะเพรา', 'ผักสด', 'กก.', 60, vVeg, 8, 1, 1],
    ['พริก', 'ผักสด', 'กก.', 80, vVeg, 8, 0.5, 1],
    ['กระเทียม', 'ผักสด', 'กก.', 70, vVeg, 8, 0.5, 1],
    ['น้ำมันพืช', 'ของแห้งและเครื่องปรุง', 'ลิตร', 48, vDry, 2, 1, 5],
    ['น้ำปลา', 'ของแห้งและเครื่องปรุง', 'ลิตร', 35, vDry, 2, 1, 5],
    ['ซอสปรุงรส', 'ของแห้งและเครื่องปรุง', 'ขวด', 40, vDry, 2, 1, 6],
    ['ข้าวสาร', 'ของแห้งและเครื่องปรุง', 'กก.', 28, vDry, 2, 5, 25]
  ];
  var idMap = {};
  list.forEach(function (row) {
    var id = generateId_('ING');
    idMap[row[0]] = id;
    writeNewRow_('Ingredients', {
      IngredientID: id, IngredientName: row[0], Category: row[1], Unit: row[2],
      StandardPrice: row[3], LatestPrice: row[3], AvgPrice: row[3], DefaultVendorID: row[4],
      WastePercent: row[5], RoundingUnit: row[6], MinOrderQty: row[7], PackSize: '', LeadTimeDays: 1,
      SafetyStock: 0, Active: true
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
