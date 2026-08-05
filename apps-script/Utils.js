/**
 * Canteen Smart Stock — Utils.js
 * Document number, วันที่/เวลา, id generator, number helpers
 */

function now_() { return new Date(); }

function todayStr_() {
  return Utilities.formatDate(now_(), CFG.TIMEZONE, 'yyyy-MM-dd');
}

function timeStr_() {
  return Utilities.formatDate(now_(), CFG.TIMEZONE, 'HH:mm:ss');
}

function timestampStr_() {
  return Utilities.formatDate(now_(), CFG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

function uuid_() { return Utilities.getUuid(); }

/**
 * สร้างเลขเอกสารอัตโนมัติ เช่น RCV-20260805-0001
 * ใช้ Script Properties เป็น counter ต่อวัน + เรียกภายใต้ Lock ของ transaction เสมอ
 */
function nextDocNumber_(prefix) {
  var props = PropertiesService.getScriptProperties();
  var ymd = Utilities.formatDate(now_(), CFG.TIMEZONE, 'yyyyMMdd');
  var key = 'DOCNO_' + prefix + '_' + ymd;
  var n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return prefix + '-' + ymd + '-' + padZero_(n, 4);
}

function padZero_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

/** แปลงเป็นตัวเลข ปลอดภัยต่อ '' / null / string */
function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

/** ปัดทศนิยม 4 ตำแหน่ง กัน floating point error สะสมใน stock */
function round4_(n) {
  return Math.round(n * 10000) / 10000;
}

/** ตรวจ format วันที่ yyyy-MM-dd และเป็นวันที่จริง */
function isValidDateStr_(s) {
  if (!s) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  var d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime());
}

/** เปรียบเทียบวันที่ string yyyy-MM-dd: คืน true ถ้า a < b */
function dateBefore_(a, b) {
  return String(a) < String(b);
}

/** สร้าง Lot No อัตโนมัติกรณีผู้ใช้ไม่กรอก: <ItemCode>-YYMMDD-<seq2> */
function autoLotNo_(itemCode, seq) {
  var ymd = Utilities.formatDate(now_(), CFG.TIMEZONE, 'yyMMdd');
  return String(itemCode || 'LOT') + '-' + ymd + '-' + padZero_(seq || 1, 2);
}

/** ห่อ API ทุกตัว: จับ error คืนรูปแบบเดียวกันเสมอ { ok, data | error } */
function apiResult_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
