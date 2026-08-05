/**
 * Canteen Smart Stock — StockService.js
 * Stock Balance, Stock Lot, FEFO allocation, Stock query API
 *
 * หลักการ:
 * - STOCK_BALANCE คำนวณจาก transaction จริง (update ทุกครั้งที่มี movement)
 * - Lot Balance รวมกันต้องตรงกับ Stock Balance เสมอ
 * - FEFO: Lot ที่หมดอายุก่อนถูกตัดก่อน / Lot หมดอายุแล้วห้าม Issue
 */

/** อ่าน balance เป็น map { Item_ID: rowObject } พร้อม _rowIndex สำหรับ update */
function getBalanceMap_() {
  var map = {};
  readAll_('STOCK_BALANCE').forEach(function (b) { map[b.Item_ID] = b; });
  return map;
}

/**
 * ปรับ Stock Balance หลายรายการใน 1 batch
 * changes = [{itemId, itemName, unit, delta}]  (delta บวก=รับเข้า ลบ=จ่ายออก)
 * คืน map ของ balance ใหม่ { itemId: newQty }
 * ต้องเรียกภายใต้ Lock เท่านั้น
 */
function applyBalanceChanges_(changes) {
  var map = getBalanceMap_();
  var ts = timestampStr_();
  var newBalances = {};
  var updates = [];
  var appends = [];

  // รวม delta ต่อ item ก่อน — item เดิมอาจโผล่หลายแถวใน transaction เดียว
  var merged = {};
  var order = [];
  changes.forEach(function (c) {
    if (!merged[c.itemId]) {
      merged[c.itemId] = { itemId: c.itemId, itemName: c.itemName, unit: c.unit, delta: 0 };
      order.push(c.itemId);
    }
    merged[c.itemId].delta = round4_(merged[c.itemId].delta + c.delta);
  });

  order.forEach(function (itemId) {
    var c = merged[itemId];
    var cur = map[c.itemId];
    if (cur) {
      var newQty = round4_(num_(cur.Current_Stock) + c.delta);
      if (newQty < 0) {
        throw new Error('Stock ติดลบไม่ได้: ' + c.itemName + ' (คงเหลือ ' + num_(cur.Current_Stock) + ' ต้องการตัด ' + (-c.delta) + ')');
      }
      newBalances[c.itemId] = newQty;
      updates.push({
        rowIndex: cur._rowIndex,
        values: {
          Current_Stock: newQty,
          Available_Stock: newQty,
          Last_Movement_At: ts,
          Updated_At: ts
        }
      });
    } else {
      if (c.delta < 0) throw new Error('Stock ติดลบไม่ได้: ' + c.itemName + ' ไม่มียอดคงเหลือ');
      var qty = round4_(c.delta);
      newBalances[c.itemId] = qty;
      appends.push({
        Item_ID: c.itemId, Item_Name: c.itemName, Unit: c.unit,
        Current_Stock: qty, Reserved_Qty: 0, Available_Stock: qty,
        Last_Movement_At: ts, Updated_At: ts
      });
    }
  });

  updateRows_('STOCK_BALANCE', updates);
  appendObjects_('STOCK_BALANCE', appends);
  return newBalances;
}

/** อ่าน Lot ที่ยัง Active และเหลือ > 0 ของ item หนึ่ง เรียงตาม FEFO (Expiry น้อยสุดก่อน) */
function getActiveLots_(itemId) {
  return readAll_('STOCK_LOT')
    .filter(function (l) {
      return l.Item_ID === itemId && String(l.Status).trim() === 'Active' && num_(l.Remaining_Qty) > 0;
    })
    .sort(function (a, b) {
      // Lot ไม่มี expiry ไปท้ายสุด
      var ea = a.Expiry_Date || '9999-12-31';
      var eb = b.Expiry_Date || '9999-12-31';
      if (ea !== eb) return ea < eb ? -1 : 1;
      return String(a.Created_At) < String(b.Created_At) ? -1 : 1;
    });
}

/**
 * FEFO allocation: จัดสรร qty ที่ขอเบิกลง Lot ตามลำดับหมดอายุก่อน
 * ข้าม Lot ที่หมดอายุแล้ว (Expired ห้าม Issue)
 * คืน { allocations: [{lot, qty}], shortage: number, expiredQty: number }
 */
function allocateFefo_(itemId, requestQty) {
  var today = todayStr_();
  var lots = getActiveLots_(itemId);
  var allocations = [];
  var remaining = requestQty;
  var expiredQty = 0;

  for (var i = 0; i < lots.length; i++) {
    var lot = lots[i];
    if (lot.Expiry_Date && dateBefore_(lot.Expiry_Date, today)) {
      expiredQty = round4_(expiredQty + num_(lot.Remaining_Qty));
      continue; // Expired — ห้ามเบิก
    }
    if (remaining <= 0) break;
    var take = Math.min(num_(lot.Remaining_Qty), remaining);
    allocations.push({ lot: lot, qty: round4_(take) });
    remaining = round4_(remaining - take);
  }
  return { allocations: allocations, shortage: remaining > 0 ? remaining : 0, expiredQty: expiredQty };
}

/** API: Stock Balance ทั้งหมด + สถานะ low stock (สำหรับหน้า Stock) */
function apiGetStockOverview() {
  return apiResult_(function () {
    var items = {};
    readAllCached_('ITEM_MASTER').forEach(function (it) { items[it.Item_ID] = it; });
    var today = todayStr_();

    // สรุป lot ต่อ item: จำนวน lot, expiry ที่ใกล้สุด, location ที่เก็บ
    var lotSummary = {};
    readAll_('STOCK_LOT').forEach(function (l) {
      if (String(l.Status).trim() !== 'Active' || num_(l.Remaining_Qty) <= 0) return;
      var s = lotSummary[l.Item_ID] || (lotSummary[l.Item_ID] = { lotCount: 0, nearestExpiry: '', locations: {} , expiredQty: 0});
      s.lotCount++;
      if (l.Location) s.locations[l.Location] = true;
      if (l.Expiry_Date) {
        if (dateBefore_(l.Expiry_Date, today)) s.expiredQty = round4_(s.expiredQty + num_(l.Remaining_Qty));
        if (!s.nearestExpiry || l.Expiry_Date < s.nearestExpiry) s.nearestExpiry = l.Expiry_Date;
      }
    });

    var rows = readAll_('STOCK_BALANCE').map(function (b) {
      var it = items[b.Item_ID] || {};
      var s = lotSummary[b.Item_ID] || { lotCount: 0, nearestExpiry: '', locations: {}, expiredQty: 0 };
      return {
        itemId: b.Item_ID,
        name: b.Item_Name,
        unit: b.Unit,
        currentStock: num_(b.Current_Stock),
        reorderPoint: num_(it.Reorder_Point),
        lowStock: num_(b.Current_Stock) <= num_(it.Reorder_Point),
        lotCount: s.lotCount,
        nearestExpiry: s.nearestExpiry,
        expiredQty: s.expiredQty,
        locations: Object.keys(s.locations),
        defaultLocation: it.Default_Location || '',
        category: it.Category || '',
        lastMovementAt: b.Last_Movement_At
      };
    });
    rows.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    return { rows: rows, today: today };
  });
}

/** API: รายละเอียด item 1 ตัว — lots ทั้งหมด + FEFO preview (สำหรับหน้าเบิกและหน้า detail) */
function apiGetItemLots(itemId) {
  return apiResult_(function () {
    var today = todayStr_();
    var lots = getActiveLots_(itemId).map(function (l) {
      var expired = !!(l.Expiry_Date && dateBefore_(l.Expiry_Date, today));
      return {
        lotId: l.Lot_ID,
        lotNo: l.Lot_No,
        remainingQty: num_(l.Remaining_Qty),
        unit: l.Unit,
        expiryDate: l.Expiry_Date || '',
        location: l.Location,
        receivingNo: l.Receiving_No,
        expired: expired,
        daysToExpiry: l.Expiry_Date ? daysBetween_(today, l.Expiry_Date) : null
      };
    });
    var available = 0;
    lots.forEach(function (l) { if (!l.expired) available = round4_(available + l.remainingQty); });
    return { lots: lots, availableQty: available, today: today };
  });
}

function daysBetween_(fromStr, toStr) {
  var a = new Date(fromStr + 'T00:00:00');
  var b = new Date(toStr + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/** API: ประวัติ transaction ล่าสุด (หน้า History) — filter ฝั่ง server */
function apiGetTransactions(filter) {
  return apiResult_(function () {
    filter = filter || {};
    var rows = readAll_('STOCK_TRANSACTION');
    var out = [];
    // อ่านจากท้าย (ล่าสุดก่อน)
    for (var i = rows.length - 1; i >= 0 && out.length < (filter.limit || 100); i--) {
      var t = rows[i];
      if (filter.type && t.Transaction_Type !== filter.type) continue;
      if (filter.employeeId && String(t.Employee_ID).toUpperCase() !== String(filter.employeeId).toUpperCase()) continue;
      if (filter.itemQuery) {
        var q = String(filter.itemQuery).toLowerCase();
        if (String(t.Item_Name).toLowerCase().indexOf(q) < 0 && String(t.Document_No).toLowerCase().indexOf(q) < 0) continue;
      }
      if (filter.dateFrom && String(t.Date) < filter.dateFrom) continue;
      if (filter.dateTo && String(t.Date) > filter.dateTo) continue;
      out.push({
        date: t.Date, time: t.Time, type: t.Transaction_Type, docNo: t.Document_No,
        itemName: t.Item_Name, lotNo: t.Lot_No,
        qtyIn: num_(t.Qty_In), qtyOut: num_(t.Qty_Out), unit: t.Unit,
        balanceAfter: num_(t.Balance_After),
        from: t.From_Location, to: t.To_Location,
        employeeId: t.Employee_ID, employeeName: t.Employee_Name
      });
    }
    return { rows: out };
  });
}
