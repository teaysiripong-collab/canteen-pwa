/***************************************************************
 * MEKTEC Canteen Smart Ingredient & Requisition System
 * ระบบบริหารวัตถุดิบ เบิก-จ่าย และวางแผนอาหารแคนทีน
 *
 * Backend : Google Apps Script + Google Sheets
 * Frontend: index.html (Single Page Application)
 *
 * ไฟล์นี้: Config / Database Provision / Core Helpers / Seed Data
 ***************************************************************/

const SPREADSHEET_ID = 'PUT_SPREADSHEET_ID_HERE';
const FOLDER_ID = 'PUT_FOLDER_ID_HERE';
const APP_VERSION = '1.0.0';
const TZ = 'Asia/Bangkok';
const SETUP_KEY = 'SETUP_DONE_V1';

/* ── โครงสร้างทุก Sheet ── */
const SHEETS = {
  Users: ['user_id','username','password_hash','fullname','employee_code','phone','position','role','department','status','profile_photo','created_at','updated_at'],
  Sessions: ['token','user_id','expires_at','created_at'],
  Locations: ['location_id','location_code','location_name','status','created_at'],
  Categories: ['category_id','category_name','description','status','created_at'],
  Vendors: ['vendor_id','vendor_code','vendor_name','contact_name','phone','note','status','created_at'],
  Ingredients: ['ingredient_id','ingredient_code','ingredient_name','category_id','category_name','default_unit','purchase_unit','conversion_rate','preferred_vendor_id','preferred_vendor_name','last_price','average_price','min_stock','safety_stock','status','note','created_at','updated_at'],
  StockBalances: ['stock_id','location_id','location_name','ingredient_id','ingredient_name','unit','current_balance','reserved_quantity','available_balance','min_stock','last_updated'],
  StockTransactions: ['transaction_id','transaction_no','transaction_type','transaction_date','location_id','location_name','ingredient_id','ingredient_name','quantity','unit','unit_price','total_amount','balance_before','balance_after','reference_type','reference_id','reference_no','created_by','note','created_at'],
  Menus: ['menu_id','menu_code','menu_name','menu_category','meal_period','default_batch_size','status','note','created_at','updated_at'],
  Recipes: ['recipe_id','menu_id','menu_name','ingredient_id','ingredient_name','quantity','unit','batch_size','waste_percent','yield_percent','note','status','updated_at'],
  RecipeVersions: ['version_id','menu_id','version_no','effective_date','status','approved_by','note','created_at'],
  MenuPlans: ['plan_id','plan_date','day_name','week_no','meal_period','location_id','location_name','menu_id','menu_name','planned_quantity','batch_multiplier','status','created_by','created_at','updated_at'],
  Requisitions: ['requisition_id','requisition_no','requisition_date','location_id','location_name','meal_period','status','requested_by','approved_by','approved_date','note','created_at'],
  RequisitionItems: ['requisition_item_id','requisition_id','requisition_no','ingredient_id','ingredient_name','unit','recipe_quantity','recommended_quantity','requested_quantity','approved_quantity','actual_quantity','stock_before','stock_after','unit_price','total_amount','variance_quantity','note'],
  StockIn: ['stockin_id','stockin_no','stockin_date','location_id','location_name','vendor_id','vendor_name','document_no','ingredient_id','ingredient_name','unit','quantity','unit_price','total_amount','balance_before','balance_after','created_by','note','created_at'],
  Transfers: ['transfer_id','transfer_no','transfer_date','from_location','to_location','ingredient_id','ingredient_name','quantity','unit','status','created_by','received_by','note','created_at'],
  PurchasePlans: ['purchase_plan_id','purchase_plan_no','plan_date','required_date','vendor_id','vendor_name','ingredient_id','ingredient_name','current_stock','required_quantity','safety_stock','recommended_purchase','final_purchase_quantity','unit','last_price','estimated_amount','status','created_by','note','created_at'],
  ActualUsage: ['usage_id','usage_date','location_id','menu_id','menu_name','ingredient_id','ingredient_name','recipe_quantity','issued_quantity','actual_quantity','variance_quantity','variance_percent','unit','unit_price','actual_cost','note','created_at'],
  PriceHistory: ['price_id','date','vendor_id','vendor_name','ingredient_id','ingredient_name','unit','price','previous_price','price_change','price_change_percent','source_document','created_at'],
  AuditLogs: ['log_id','timestamp','user_id','username','action','module','reference_id','old_value','new_value','device_info'],
  Settings: ['setting_key','setting_value','updated_at']
};

/* ═══════════════ ENTRY POINT ═══════════════ */

function doGet(e) {
  ensureSetup();
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('MEKTEC Canteen System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ═══════════════ AUTO PROVISION ═══════════════ */

function ensureSetup() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(SETUP_KEY) === 'true') return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (props.getProperty(SETUP_KEY) === 'true') return; // double-check หลังได้ Lock
    Object.keys(SHEETS).forEach(function(name) { sheet_(name); });
    seedSampleData_();
    props.setProperty(SETUP_KEY, 'true');
  } finally {
    lock.releaseLock();
  }
}

/* ═══════════════ CORE SHEET HELPERS ═══════════════ */

var MEMO_ = {}; // cache ต่อ 1 execution ลดการอ่าน Sheet ซ้ำ

function ss_() {
  if (MEMO_.__ss) return MEMO_.__ss;
  var ss;
  if (SPREADSHEET_ID && SPREADSHEET_ID.indexOf('PUT_') !== 0) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('กรุณาใส่ SPREADSHEET_ID ใน Code.gs');
  }
  MEMO_.__ss = ss;
  return ss;
}

function sheet_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]])
      .setFontWeight('bold').setBackground('#1E3A8A').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  } else {
    ensureHeaders_(sh, name);
  }
  return sh;
}

function ensureHeaders_(sh, name) {
  var want = SHEETS[name];
  if (!want) return;
  if (sh.getLastColumn() < want.length || sh.getLastRow() === 0) {
    var have = sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (have.join('|') !== want.join('|')) {
      sh.getRange(1, 1, 1, want.length).setValues([want]);
      sh.setFrozenRows(1);
    }
  }
}

function normVal_(v) {
  if (v instanceof Date) {
    var s = Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
    return s.slice(-8) === '00:00:00' ? s.slice(0, 10) : s;
  }
  return v;
}

/** อ่านทั้ง Sheet เป็น Array ของ Object (มี memo cache ต่อ execution) */
function readAll_(name) {
  if (MEMO_[name]) return MEMO_[name];
  var sh = sheet_(name);
  var lastRow = sh.getLastRow();
  var headers = SHEETS[name];
  if (lastRow < 2) { MEMO_[name] = []; return []; }
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = {}, empty = true;
    for (var j = 0; j < headers.length; j++) {
      var v = normVal_(values[i][j]);
      if (v !== '' && v !== null) empty = false;
      row[headers[j]] = v;
    }
    if (!empty) { row.__row = i + 2; out.push(row); }
  }
  MEMO_[name] = out;
  return out;
}

function clearMemo_(name) { delete MEMO_[name]; }

function appendRow_(name, obj) {
  var sh = sheet_(name);
  var headers = SHEETS[name];
  var row = headers.map(function(h) { return obj[h] !== undefined && obj[h] !== null ? obj[h] : ''; });
  sh.appendRow(row);
  clearMemo_(name);
  return obj;
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var headers = SHEETS[name];
  var rows = objs.map(function(o) {
    return headers.map(function(h) { return o[h] !== undefined && o[h] !== null ? o[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  clearMemo_(name);
}

/** อัปเดต Row โดยหา key แล้วเขียนเฉพาะ field ใน patch */
function updateRow_(name, keyField, keyValue, patch) {
  var sh = sheet_(name);
  var headers = SHEETS[name];
  var rows = readAll_(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyField]) === String(keyValue)) {
      var rowIdx = rows[i].__row;
      var current = sh.getRange(rowIdx, 1, 1, headers.length).getValues()[0];
      headers.forEach(function(h, j) {
        if (patch[h] !== undefined) current[j] = patch[h];
      });
      sh.getRange(rowIdx, 1, 1, headers.length).setValues([current]);
      clearMemo_(name);
      return true;
    }
  }
  return false;
}

function findBy_(name, field, value) {
  var rows = readAll_(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]) === String(value)) return rows[i];
  }
  return null;
}

/** สร้าง Index Object สำหรับ Lookup เร็ว */
function indexBy_(rows, field) {
  var idx = {};
  rows.forEach(function(r) { idx[String(r[field])] = r; });
  return idx;
}

/* ═══════════════ UTILITIES ═══════════════ */

function nowTs_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function num_(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function round_(v, p) { var m = Math.pow(10, p === undefined ? 3 : p); return Math.round(num_(v) * m) / m; }
function s_(v) { return v === undefined || v === null ? '' : String(v).trim(); }

function ok_(message, data) {
  return { success: true, message: message || 'สำเร็จ', data: data === undefined ? null : data };
}
function err_(message, code) {
  return { success: false, message: message || 'เกิดข้อผิดพลาด', code: code || '', data: null };
}

function generateId_(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
}

/**
 * สร้างเลขเอกสารรูปแบบ PREFIX-YYYYMMDD-NNNN
 * ใช้ LockService + ScriptProperties กันเลขซ้ำ และตรวจเลขล่าสุดใน Sheet เป็น fallback
 */
function docNo_(prefix, sheetName, colName) {
  var date = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  var key = 'DOCNO_' + prefix + '_' + date;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var n = parseInt(props.getProperty(key) || '0', 10);
    if (n === 0 && sheetName) {
      // fallback: ตรวจเลขล่าสุดของวันนั้นจาก Sheet จริง
      var pat = prefix + '-' + date + '-';
      readAll_(sheetName).forEach(function(r) {
        var v = s_(r[colName]);
        if (v.indexOf(pat) === 0) {
          var num = parseInt(v.slice(pat.length), 10);
          if (num > n) n = num;
        }
      });
    }
    n++;
    props.setProperty(key, String(n));
    return prefix + '-' + date + '-' + ('0000' + n).slice(-4);
  } finally {
    lock.releaseLock();
  }
}

/** ครอบทุก Write Transaction ด้วย Script Lock */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** บันทึก Audit Trail */
function audit_(user, action, module, referenceId, oldValue, newValue, deviceInfo) {
  try {
    appendRow_('AuditLogs', {
      log_id: generateId_('LOG'),
      timestamp: nowTs_(),
      user_id: user ? user.user_id : '',
      username: user ? user.username : 'system',
      action: action,
      module: module,
      reference_id: referenceId || '',
      old_value: oldValue ? JSON.stringify(oldValue).slice(0, 2000) : '',
      new_value: newValue ? JSON.stringify(newValue).slice(0, 2000) : '',
      device_info: deviceInfo || ''
    });
  } catch (e) { /* audit ห้ามทำให้ transaction หลักล้ม */ }
}

/* ═══════════════ SETTINGS ═══════════════ */

var DEFAULT_SETTINGS = {
  app_name: 'MEKTEC Canteen System',
  company_name: 'MEKTEC Manufacturing Corporation',
  logo_url: '',
  default_location: 'B1',
  low_stock_threshold: '0',
  critical_threshold: '0',
  variance_warning_percent: '10',
  variance_danger_percent: '25',
  price_increase_warning_percent: '10',
  session_timeout_hours: '2',
  theme: 'navy'
};

function getSettingsMap_() {
  if (MEMO_.__settings) return MEMO_.__settings;
  var map = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function(k) { map[k] = DEFAULT_SETTINGS[k]; });
  readAll_('Settings').forEach(function(r) {
    if (s_(r.setting_key)) map[r.setting_key] = s_(r.setting_value);
  });
  MEMO_.__settings = map;
  return map;
}

function getSettings(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  return ok_('โหลดการตั้งค่าสำเร็จ', getSettingsMap_());
}

function saveSettings(token, payload) {
  var auth = requireAuth_(token, ['Admin']);
  if (!auth.ok) return auth.res;
  return withLock_(function() {
    var old = getSettingsMap_();
    Object.keys(payload || {}).forEach(function(k) {
      if (DEFAULT_SETTINGS[k] === undefined) return; // รับเฉพาะ key ที่รู้จัก
      var exists = findBy_('Settings', 'setting_key', k);
      if (exists) {
        updateRow_('Settings', 'setting_key', k, { setting_value: s_(payload[k]), updated_at: nowTs_() });
      } else {
        appendRow_('Settings', { setting_key: k, setting_value: s_(payload[k]), updated_at: nowTs_() });
      }
    });
    delete MEMO_.__settings;
    audit_(auth.user, 'EDIT', 'Settings', '', old, payload);
    return ok_('บันทึกการตั้งค่าสำเร็จ', getSettingsMap_());
  });
}

/* ═══════════════ SEED DATA ═══════════════ */

function seedSampleData_() {
  var now = nowTs_();
  var today = today_();

  // ── Admin User ──
  appendRow_('Users', {
    user_id: generateId_('USR'), username: 'admin',
    password_hash: hashPassword_('admin', 'admin123'),
    fullname: 'ผู้ดูแลระบบ', employee_code: 'MT0001', phone: '',
    position: 'System Administrator', role: 'Admin', department: 'Canteen',
    status: 'active', profile_photo: '', created_at: now, updated_at: now
  });

  // ── Locations ──
  var locB1 = { location_id: 'LOC_B1', location_code: 'B1', location_name: 'Building 1', status: 'active', created_at: now };
  var locB16 = { location_id: 'LOC_B16', location_code: 'B16', location_name: 'Building 16', status: 'active', created_at: now };
  appendRows_('Locations', [locB1, locB16]);

  // ── Categories ──
  var catNames = ['เนื้อสัตว์','ผัก','เครื่องปรุง','ของแห้ง','เส้น','ข้าว','ไข่','นม/เครื่องดื่ม','อาหารแช่แข็ง','อื่นๆ'];
  var cats = catNames.map(function(n, i) {
    return { category_id: 'CAT_' + (i + 1), category_name: n, description: '', status: 'active', created_at: now };
  });
  appendRows_('Categories', cats);
  var catIdx = {};
  cats.forEach(function(c) { catIdx[c.category_name] = c; });

  // ── Vendors ──
  var vendors = [
    { vendor_id: 'VEN_1', vendor_code: 'MAK', vendor_name: 'Makro', contact_name: '', phone: '', note: 'ซอส เส้น เครื่องปรุง ของแห้ง', status: 'active', created_at: now },
    { vendor_id: 'VEN_2', vendor_code: 'BTG', vendor_name: 'Betagro', contact_name: '', phone: '', note: 'เนื้อสัตว์ ไก่ หมู', status: 'active', created_at: now },
    { vendor_id: 'VEN_3', vendor_code: 'PPL', vendor_name: 'Puangploy', contact_name: '', phone: '', note: 'ผักสด', status: 'active', created_at: now },
    { vendor_id: 'VEN_4', vendor_code: 'OTH', vendor_name: 'Other', contact_name: '', phone: '', note: '', status: 'active', created_at: now }
  ];
  appendRows_('Vendors', vendors);
  var venIdx = {};
  vendors.forEach(function(v) { venIdx[v.vendor_name] = v; });

  // ── Ingredients ──
  function ing(code, name, cat, unit, punit, conv, vendor, price, min, safety) {
    var v = venIdx[vendor] || venIdx['Other'];
    var c = catIdx[cat];
    return {
      ingredient_id: 'ING_' + code, ingredient_code: code, ingredient_name: name,
      category_id: c.category_id, category_name: c.category_name,
      default_unit: unit, purchase_unit: punit || unit, conversion_rate: conv || 1,
      preferred_vendor_id: v.vendor_id, preferred_vendor_name: v.vendor_name,
      last_price: price, average_price: price, min_stock: min, safety_stock: safety,
      status: 'active', note: '', created_at: now, updated_at: now
    };
  }
  var ings = [
    ing('IG001','ไก่หั่นบาง','เนื้อสัตว์','kg','kg',1,'Betagro',75,10,5),
    ing('IG002','ไก่บด','เนื้อสัตว์','kg','kg',1,'Betagro',70,10,5),
    ing('IG003','หมูบด','เนื้อสัตว์','kg','kg',1,'Betagro',120,10,5),
    ing('IG004','หมูสามชั้น','เนื้อสัตว์','kg','kg',1,'Betagro',150,8,4),
    ing('IG005','ใบกะเพรา','ผัก','kg','kg',1,'Puangploy',60,2,1),
    ing('IG006','พริกแดง','ผัก','kg','kg',1,'Puangploy',80,2,1),
    ing('IG007','กระเทียม','ผัก','kg','kg',1,'Puangploy',55,3,2),
    ing('IG008','กะหล่ำปลี','ผัก','kg','kg',1,'Puangploy',25,5,3),
    ing('IG009','แตงกวา','ผัก','kg','kg',1,'Puangploy',20,5,3),
    ing('IG010','ถั่วฝักยาว','ผัก','kg','kg',1,'Puangploy',35,3,2),
    ing('IG011','มะละกอ','ผัก','kg','kg',1,'Puangploy',18,5,3),
    ing('IG012','น้ำมันพืช','เครื่องปรุง','ขวด','ลัง',12,'Makro',52,12,6),
    ing('IG013','ซอสปรุงรส','เครื่องปรุง','ขวด','ลัง',12,'Makro',38,6,3),
    ing('IG014','น้ำปลา','เครื่องปรุง','ขวด','ลัง',12,'Makro',30,6,3),
    ing('IG015','น้ำตาลทราย','ของแห้ง','kg','ถุง',25,'Makro',24,15,8),
    ing('IG016','ข้าวสารหอมมะลิ','ข้าว','kg','ถุง',49,'Makro',33,100,50),
    ing('IG017','เส้นก๋วยเตี๋ยว','เส้น','kg','แพ็ก',5,'Makro',28,10,5),
    ing('IG018','ไข่ไก่','ไข่','ฟอง','ถาด',30,'Betagro',4.5,150,60),
    ing('IG019','กะทิกล่อง','นม/เครื่องดื่ม','กล่อง','ลัง',12,'Makro',45,10,5),
    ing('IG020','พริกแกงเขียวหวาน','เครื่องปรุง','kg','kg',1,'Makro',95,3,2)
  ];
  appendRows_('Ingredients', ings);

  // ── Stock เริ่มต้น (รับเข้าที่ B1 และ B16) ──
  var seedStock = { IG001: 42, IG002: 8, IG003: 25, IG004: 15, IG005: 5, IG006: 1, IG007: 6, IG008: 20, IG009: 12, IG010: 8, IG011: 15, IG012: 24, IG013: 12, IG014: 10, IG015: 30, IG016: 250, IG017: 20, IG018: 300, IG019: 18, IG020: 5 };
  var stinNo = 'STIN-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') + '-0001';
  var balances = [], stockins = [], txns = [];
  ings.forEach(function(g) {
    [locB1, locB16].forEach(function(loc, li) {
      var qty = round_(num_(seedStock[g.ingredient_code]) * (li === 0 ? 1 : 0.4));
      balances.push({
        stock_id: loc.location_id + '_' + g.ingredient_id,
        location_id: loc.location_id, location_name: loc.location_name,
        ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
        unit: g.default_unit, current_balance: qty, reserved_quantity: 0,
        available_balance: qty, min_stock: g.min_stock, last_updated: now
      });
      if (qty > 0 && li === 0) {
        stockins.push({
          stockin_id: generateId_('STI'), stockin_no: stinNo, stockin_date: today,
          location_id: loc.location_id, location_name: loc.location_name,
          vendor_id: g.preferred_vendor_id, vendor_name: g.preferred_vendor_name,
          document_no: '', ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          unit: g.default_unit, quantity: qty, unit_price: g.last_price,
          total_amount: round_(qty * g.last_price, 2), balance_before: 0, balance_after: qty,
          created_by: 'admin', note: 'ยอดยกมาเริ่มต้นระบบ', created_at: now
        });
        txns.push({
          transaction_id: generateId_('TXN'), transaction_no: stinNo, transaction_type: 'STOCK_IN',
          transaction_date: today, location_id: loc.location_id, location_name: loc.location_name,
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          quantity: qty, unit: g.default_unit, unit_price: g.last_price,
          total_amount: round_(qty * g.last_price, 2), balance_before: 0, balance_after: qty,
          reference_type: 'STOCK_IN', reference_id: '', reference_no: stinNo,
          created_by: 'admin', note: 'ยอดยกมาเริ่มต้นระบบ', created_at: now
        });
      }
    });
  });
  appendRows_('StockBalances', balances);
  appendRows_('StockIn', stockins);
  appendRows_('StockTransactions', txns);
  PropertiesService.getScriptProperties().setProperty('DOCNO_STIN_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'), '1');

  // ── Menus ──
  function menu(code, name, cat, meal, batch) {
    return { menu_id: 'MNU_' + code, menu_code: code, menu_name: name, menu_category: cat,
      meal_period: meal, default_batch_size: batch, status: 'active', note: '', created_at: now, updated_at: now };
  }
  var menus = [
    menu('MN001','กะเพราไก่','ผัด','กลางวัน',100),
    menu('MN002','แกงเขียวหวานไก่','แกง','กลางวัน',100),
    menu('MN003','ผัดผักรวมหมูกรอบ','ผัด','กลางวัน',100),
    menu('MN004','ต้มจืดไข่น้ำ','ต้ม','กลางวัน',100),
    menu('MN005','ก๋วยเตี๋ยวหมู','ก๋วยเตี๋ยว','กลางวัน',100),
    menu('MN006','ข้าวผัดหมู','ผัด','เย็น',100),
    menu('MN007','ส้มตำไทย','ส้มตำ','กลางวัน',50),
    menu('MN008','ไข่เจียวหมูสับ','เมนูเสริม','กลางวัน',100)
  ];
  appendRows_('Menus', menus);

  // ── Recipes (ต่อ Batch มาตรฐาน) ──
  function rc(menuCode, ingCode, qty, unit, waste) {
    var m = menus.filter(function(x) { return x.menu_code === menuCode; })[0];
    var g = ings.filter(function(x) { return x.ingredient_code === ingCode; })[0];
    return { recipe_id: generateId_('RCP'), menu_id: m.menu_id, menu_name: m.menu_name,
      ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
      quantity: qty, unit: unit || g.default_unit, batch_size: m.default_batch_size,
      waste_percent: waste || 0, yield_percent: 100, note: '', status: 'active', updated_at: now };
  }
  var recipes = [
    rc('MN001','IG001',30), rc('MN001','IG005',3), rc('MN001','IG006',2), rc('MN001','IG007',2), rc('MN001','IG012',3,'ขวด'), rc('MN001','IG013',2,'ขวด'),
    rc('MN002','IG001',25), rc('MN002','IG020',3), rc('MN002','IG019',10,'กล่อง'), rc('MN002','IG014',2,'ขวด'), rc('MN002','IG015',1),
    rc('MN003','IG004',15), rc('MN003','IG008',12), rc('MN003','IG010',5), rc('MN003','IG007',1), rc('MN003','IG013',2,'ขวด'),
    rc('MN004','IG003',10), rc('MN004','IG018',60,'ฟอง'), rc('MN004','IG008',6), rc('MN004','IG014',1,'ขวด'),
    rc('MN005','IG003',15), rc('MN005','IG017',18), rc('MN005','IG010',4), rc('MN005','IG014',2,'ขวด'),
    rc('MN006','IG003',12), rc('MN006','IG016',35), rc('MN006','IG018',80,'ฟอง'), rc('MN006','IG012',2,'ขวด'),
    rc('MN007','IG011',15), rc('MN007','IG006',1.5), rc('MN007','IG007',1), rc('MN007','IG010',3), rc('MN007','IG014',1.5,'ขวด'), rc('MN007','IG015',2)
    // MN008 ตั้งใจไม่มีสูตร เพื่อทดสอบ Zero Recipe Handling
  ];
  appendRows_('Recipes', recipes);
  var versions = {};
  recipes.forEach(function(r) { versions[r.menu_id] = true; });
  appendRows_('RecipeVersions', Object.keys(versions).map(function(mid) {
    return { version_id: generateId_('RCV'), menu_id: mid, version_no: 1, effective_date: today,
      status: 'active', approved_by: 'admin', note: 'สูตรเริ่มต้น', created_at: now };
  }));

  // ── Menu Plan ตัวอย่าง: วันนี้ + 2 วันข้างหน้า ──
  var dayNames = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  var planMenus = [['MN001','MN004','MN008'], ['MN002','MN003'], ['MN005','MN007']];
  var plans = [];
  for (var d = 0; d < 3; d++) {
    var dt = new Date(); dt.setDate(dt.getDate() + d);
    var dateStr = Utilities.formatDate(dt, TZ, 'yyyy-MM-dd');
    planMenus[d].forEach(function(mc) {
      var m = menus.filter(function(x) { return x.menu_code === mc; })[0];
      plans.push({
        plan_id: generateId_('PLN'), plan_date: dateStr, day_name: dayNames[dt.getDay()],
        week_no: weekNo_(dt), meal_period: 'กลางวัน',
        location_id: locB1.location_id, location_name: locB1.location_name,
        menu_id: m.menu_id, menu_name: m.menu_name,
        planned_quantity: m.default_batch_size, batch_multiplier: 1,
        status: 'active', created_by: 'admin', created_at: now, updated_at: now
      });
    });
  }
  appendRows_('MenuPlans', plans);

  // ── Settings เริ่มต้น ──
  appendRows_('Settings', Object.keys(DEFAULT_SETTINGS).map(function(k) {
    return { setting_key: k, setting_value: DEFAULT_SETTINGS[k], updated_at: now };
  }));
}

function weekNo_(d) {
  var target = new Date(d.valueOf());
  var dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  var firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  return 1 + Math.ceil((firstThursday - target) / 604800000);
}
