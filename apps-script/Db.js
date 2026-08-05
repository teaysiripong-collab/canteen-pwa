/**
 * Canteen Smart Stock — Db.js
 * Data access layer: อ่าน/เขียน Google Sheets แบบ Batch เท่านั้น
 * ห้าม loop setValue ทีละ cell — ทุกการเขียนใช้ setValues/appendRowsBatch ครั้งเดียว
 */

/** คืน Spreadsheet database (จาก Script Properties ที่ตั้งไว้ตอน setupSystem) */
function getDb_() {
  var id = PropertiesService.getScriptProperties().getProperty(CFG.PROP.SS_ID);
  if (!id) {
    throw new Error('ยังไม่ได้ติดตั้งระบบ — กรุณารัน setupSystem() ก่อน (ดู SETUP_GUIDE.md)');
  }
  return SpreadsheetApp.openById(id);
}

/** คืน Sheet ตามชื่อ; ถ้าไม่มีให้สร้างพร้อม Header ตาม Schema */
function getSheet_(name) {
  var ss = getDb_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    initSheetHeader_(sh, name);
  }
  return sh;
}

/** เขียน Header row + freeze + จัด format ให้ Sheet ใหม่ */
function initSheetHeader_(sh, name) {
  var headers = SHEET_SCHEMA[name];
  if (!headers) throw new Error('ไม่พบ Schema ของ Sheet: ' + name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1a2f5a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  // บังคับทุกคอลัมน์เป็น Plain text กัน Sheets แปลงวันที่/Lot อัตโนมัติ
  sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
}

/**
 * อ่านทั้ง Sheet เป็น Array ของ Object (key = header)
 * ค่า Date ที่ Sheets แปลงเองจะถูก normalize กลับเป็น string yyyy-MM-dd
 */
function readAll_(sheetName) {
  var sh = getSheet_(sheetName);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var headers = SHEET_SCHEMA[sheetName];
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = normalizeCell_(values[i][j]);
    }
    row._rowIndex = i + 2; // แถวจริงใน Sheet สำหรับการ update
    out.push(row);
  }
  return out;
}

/** แปลง Object → แถวตามลำดับ Header แล้ว append หลายแถวใน 1 ครั้ง */
function appendObjects_(sheetName, objects) {
  if (!objects || !objects.length) return;
  var headers = SHEET_SCHEMA[sheetName];
  var rows = objects.map(function (o) {
    return headers.map(function (h) {
      return (o[h] === undefined || o[h] === null) ? '' : o[h];
    });
  });
  var sh = getSheet_(sheetName);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

/**
 * Update หลายแถวใน 1 sheet แบบ batch
 * updates = [{rowIndex: n, values: {Header: value, ...}}, ...]
 */
function updateRows_(sheetName, updates) {
  if (!updates || !updates.length) return;
  var sh = getSheet_(sheetName);
  var headers = SHEET_SCHEMA[sheetName];
  var colOf = {};
  headers.forEach(function (h, i) { colOf[h] = i + 1; });
  updates.forEach(function (u) {
    var cols = Object.keys(u.values);
    // เขียนเป็นช่วงต่อเนื่องไม่ได้เพราะคอลัมน์กระจาย — ใช้ RangeList ต่อแถวเพื่อลด call
    cols.forEach(function (h) {
      if (!colOf[h]) return;
      sh.getRange(u.rowIndex, colOf[h]).setValue(u.values[h]);
    });
  });
}

/** normalize ค่าจาก Sheet: Date → 'yyyy-MM-dd', อื่น ๆ คงเดิม */
function normalizeCell_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, CFG.TIMEZONE, 'yyyy-MM-dd');
  }
  return v;
}

/** อ่านจาก CacheService ก่อน ถ้าไม่มีค่อยอ่าน Sheet แล้ว cache ไว้ */
function readAllCached_(sheetName) {
  var cache = CacheService.getScriptCache();
  var key = 'sheet_' + sheetName;
  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* cache เสีย — อ่านใหม่ */ }
  }
  var data = readAll_(sheetName);
  try {
    var json = JSON.stringify(data);
    if (json.length < 90000) cache.put(key, json, CFG.CACHE_TTL_SEC); // จำกัดตาม cache limit 100KB
  } catch (e) { /* ข้าม cache ถ้าใหญ่เกิน */ }
  return data;
}

/** ล้าง cache ของ sheet ที่ถูกเขียน (เรียกทุกครั้งหลัง write) */
function invalidateCache_(sheetNames) {
  var cache = CacheService.getScriptCache();
  cache.removeAll(sheetNames.map(function (n) { return 'sheet_' + n; }));
}
