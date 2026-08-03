/***************************************************************
 * Stock.gs — Stock Balances / Ledger / Stock In / Transfer /
 *            Adjustment
 * ทุกการเคลื่อนไหว Stock ต้องผ่าน adjustStock_ + logTxn_
 ***************************************************************/

/**
 * ปรับ Stock Balance (สร้างแถวใหม่ให้ถ้ายังไม่มี)
 * @return { before, after, balanceRow }
 */
function adjustStock_(locationId, ingredientId, deltaQty, deltaReserved) {
  var stockId = locationId + '_' + ingredientId;
  var bal = findBy_('StockBalances', 'stock_id', stockId);
  var now = nowTs_();
  if (!bal) {
    var loc = findBy_('Locations', 'location_id', locationId) || {};
    var g = findBy_('Ingredients', 'ingredient_id', ingredientId) || {};
    bal = {
      stock_id: stockId, location_id: locationId, location_name: loc.location_name || '',
      ingredient_id: ingredientId, ingredient_name: g.ingredient_name || '',
      unit: g.default_unit || '', current_balance: 0, reserved_quantity: 0,
      available_balance: 0, min_stock: num_(g.min_stock), last_updated: now
    };
    appendRow_('StockBalances', bal);
  }
  var before = num_(bal.current_balance);
  var after = round_(before + num_(deltaQty));
  var reserved = round_(Math.max(0, num_(bal.reserved_quantity) + num_(deltaReserved || 0)));
  updateRow_('StockBalances', 'stock_id', stockId, {
    current_balance: after,
    reserved_quantity: reserved,
    available_balance: round_(after - reserved),
    last_updated: now
  });
  return { before: before, after: after };
}

/** บันทึกลง Ledger กลาง StockTransactions */
function logTxn_(o) {
  appendRow_('StockTransactions', {
    transaction_id: generateId_('TXN'),
    transaction_no: o.transaction_no || '',
    transaction_type: o.transaction_type,
    transaction_date: o.transaction_date || today_(),
    location_id: o.location_id, location_name: o.location_name || '',
    ingredient_id: o.ingredient_id, ingredient_name: o.ingredient_name || '',
    quantity: round_(o.quantity), unit: o.unit || '',
    unit_price: round_(o.unit_price, 2),
    total_amount: round_(num_(o.quantity) * num_(o.unit_price), 2),
    balance_before: round_(o.balance_before), balance_after: round_(o.balance_after),
    reference_type: o.reference_type || '', reference_id: o.reference_id || '',
    reference_no: o.reference_no || '',
    created_by: o.created_by || '', note: o.note || '', created_at: nowTs_()
  });
}

/* ═══════════════ STOCK BALANCES ═══════════════ */

function getStockBalances(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var locId = s_(filters.location_id);
  var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');
  var rows;

  if (locId) {
    rows = readAll_('StockBalances').filter(function(b) { return b.location_id === locId; });
  } else {
    // Stock รวมทุก Location
    var agg = {};
    readAll_('StockBalances').forEach(function(b) {
      var a = agg[b.ingredient_id];
      if (!a) {
        a = agg[b.ingredient_id] = {
          stock_id: 'ALL_' + b.ingredient_id, location_id: '', location_name: 'ทุกคลัง',
          ingredient_id: b.ingredient_id, ingredient_name: b.ingredient_name, unit: b.unit,
          current_balance: 0, reserved_quantity: 0, available_balance: 0,
          min_stock: num_(b.min_stock), last_updated: b.last_updated
        };
      }
      a.current_balance = round_(a.current_balance + num_(b.current_balance));
      a.reserved_quantity = round_(a.reserved_quantity + num_(b.reserved_quantity));
      a.available_balance = round_(a.available_balance + num_(b.available_balance));
    });
    rows = Object.keys(agg).map(function(k) { return agg[k]; });
  }

  rows.forEach(function(b) {
    var g = ingIdx[b.ingredient_id] || {};
    b.category_name = g.category_name || '';
    b.safety_stock = num_(g.safety_stock);
    b.min_stock = num_(g.min_stock);
    b.unit_price = num_(g.last_price);
    b.stock_value = round_(num_(b.current_balance) * num_(g.last_price), 2);
    b.stock_status = stockStatus_(num_(b.current_balance), num_(g.min_stock), num_(g.safety_stock));
    b.ingredient_status = g.status || 'active';
  });
  rows = rows.filter(function(b) { return b.ingredient_status === 'active'; });
  rows.sort(function(a, b) { return s_(a.ingredient_name).localeCompare(s_(b.ingredient_name), 'th'); });
  return ok_('โหลด Stock สำเร็จ', rows);
}

/** สถานะ Stock: normal / low / critical / out */
function stockStatus_(qty, minStock, safetyStock) {
  if (qty <= 0) return 'out';
  if (safetyStock > 0 && qty <= safetyStock) return 'critical';
  if (minStock > 0 && qty <= minStock) return 'low';
  return 'normal';
}

/* ═══════════════ STOCK IN ═══════════════ */

/**
 * รับวัตถุดิบเข้าคลัง (หลายรายการใน 1 เอกสาร)
 * payload: { stockin_date, location_id, vendor_id, document_no, note,
 *            items:[{ingredient_id, quantity, unit, unit_price}] }
 */
function createStockIn(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var loc = findBy_('Locations', 'location_id', s_(payload.location_id));
      if (!loc) return err_('กรุณาเลือกคลังที่รับเข้า');
      var vendor = s_(payload.vendor_id) ? findBy_('Vendors', 'vendor_id', s_(payload.vendor_id)) : null;
      var items = (payload.items || []).filter(function(it) {
        return s_(it.ingredient_id) && num_(it.quantity) > 0;
      });
      if (!items.length) return err_('กรุณาเพิ่มรายการวัตถุดิบอย่างน้อย 1 รายการ');

      var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');
      var stinNo = docNo_('STIN', 'StockIn', 'stockin_no');
      var date = s_(payload.stockin_date) || today_();
      var now = nowTs_();
      var priceWarnPct = num_(getSettingsMap_().price_increase_warning_percent) || 10;
      var priceAlerts = [], total = 0;

      items.forEach(function(it) {
        var g = ingIdx[s_(it.ingredient_id)];
        if (!g) return;
        var qty = round_(it.quantity);
        var price = round_(it.unit_price, 2);
        var amount = round_(qty * price, 2);
        total += amount;

        var mv = adjustStock_(loc.location_id, g.ingredient_id, qty, 0);
        appendRow_('StockIn', {
          stockin_id: generateId_('STI'), stockin_no: stinNo, stockin_date: date,
          location_id: loc.location_id, location_name: loc.location_name,
          vendor_id: vendor ? vendor.vendor_id : '', vendor_name: vendor ? vendor.vendor_name : '',
          document_no: s_(payload.document_no),
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          unit: s_(it.unit) || g.default_unit, quantity: qty, unit_price: price,
          total_amount: amount, balance_before: mv.before, balance_after: mv.after,
          created_by: auth.user.username, note: s_(payload.note), created_at: now
        });
        logTxn_({
          transaction_no: stinNo, transaction_type: 'STOCK_IN', transaction_date: date,
          location_id: loc.location_id, location_name: loc.location_name,
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          quantity: qty, unit: s_(it.unit) || g.default_unit, unit_price: price,
          balance_before: mv.before, balance_after: mv.after,
          reference_type: 'STOCK_IN', reference_no: stinNo,
          created_by: auth.user.username, note: s_(payload.note)
        });

        // Price History + Price Alert
        var prevPrice = num_(g.last_price);
        if (price > 0 && price !== prevPrice) {
          var changePct = prevPrice > 0 ? round_((price - prevPrice) / prevPrice * 100, 2) : 0;
          appendRow_('PriceHistory', {
            price_id: generateId_('PRC'), date: date,
            vendor_id: vendor ? vendor.vendor_id : '', vendor_name: vendor ? vendor.vendor_name : '',
            ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
            unit: s_(it.unit) || g.default_unit, price: price, previous_price: prevPrice,
            price_change: round_(price - prevPrice, 2), price_change_percent: changePct,
            source_document: stinNo, created_at: now
          });
          if (changePct >= priceWarnPct) {
            priceAlerts.push('⚠️ ' + g.ingredient_name + ' ราคาเพิ่มขึ้น ' + changePct + '% (' + prevPrice + ' → ' + price + ')');
          }
        }
        if (price > 0) {
          var avg = num_(g.average_price) > 0 ? round_((num_(g.average_price) + price) / 2, 2) : price;
          updateRow_('Ingredients', 'ingredient_id', g.ingredient_id,
            { last_price: price, average_price: avg, updated_at: now });
        }
      });

      audit_(auth.user, 'CREATE', 'StockIn', stinNo, null,
        { location: loc.location_code, items: items.length, total: round_(total, 2) });
      return ok_('รับเข้าวัตถุดิบสำเร็จ เลขที่ ' + stinNo,
        { stockin_no: stinNo, total_amount: round_(total, 2), price_alerts: priceAlerts });
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกรับเข้าได้: ' + e.message);
  }
}

/* ═══════════════ TRANSFER B1 ↔ B16 ═══════════════ */

/**
 * โอนวัตถุดิบระหว่างคลัง — ตัดต้นทาง + เพิ่มปลายทาง พร้อมกันใน Transaction เดียว
 * payload: { transfer_date, from_location, to_location, note,
 *            items:[{ingredient_id, quantity, unit}] }
 */
function createTransfer(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var from = findBy_('Locations', 'location_id', s_(payload.from_location));
      var to = findBy_('Locations', 'location_id', s_(payload.to_location));
      if (!from || !to) return err_('กรุณาเลือกคลังต้นทางและปลายทาง');
      if (from.location_id === to.location_id) return err_('คลังต้นทางและปลายทางต้องไม่ใช่คลังเดียวกัน');
      var items = (payload.items || []).filter(function(it) {
        return s_(it.ingredient_id) && num_(it.quantity) > 0;
      });
      if (!items.length) return err_('กรุณาเพิ่มรายการวัตถุดิบอย่างน้อย 1 รายการ');

      var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');
      // ตรวจ Stock ต้นทางก่อนตัด
      var shortages = [];
      items.forEach(function(it) {
        var bal = findBy_('StockBalances', 'stock_id', from.location_id + '_' + s_(it.ingredient_id));
        var avail = bal ? num_(bal.available_balance) : 0;
        if (num_(it.quantity) > avail) {
          var g = ingIdx[s_(it.ingredient_id)] || {};
          shortages.push((g.ingredient_name || it.ingredient_id) + ' (คงเหลือ ' + avail + ')');
        }
      });
      if (shortages.length && !payload.allow_negative) {
        return err_('⚠️ Stock ที่ ' + from.location_code + ' ไม่เพียงพอ: ' + shortages.join(', '), 'INSUFFICIENT_STOCK');
      }

      var trfNo = docNo_('TRF', 'Transfers', 'transfer_no');
      var date = s_(payload.transfer_date) || today_();
      var now = nowTs_();

      items.forEach(function(it) {
        var g = ingIdx[s_(it.ingredient_id)];
        if (!g) return;
        var qty = round_(it.quantity);
        var unit = s_(it.unit) || g.default_unit;
        var out = adjustStock_(from.location_id, g.ingredient_id, -qty, 0);
        var inn = adjustStock_(to.location_id, g.ingredient_id, qty, 0);
        appendRow_('Transfers', {
          transfer_id: generateId_('TRF'), transfer_no: trfNo, transfer_date: date,
          from_location: from.location_id, to_location: to.location_id,
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          quantity: qty, unit: unit, status: 'completed',
          created_by: auth.user.username, received_by: '', note: s_(payload.note), created_at: now
        });
        logTxn_({
          transaction_no: trfNo, transaction_type: 'TRANSFER_OUT', transaction_date: date,
          location_id: from.location_id, location_name: from.location_name,
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          quantity: -qty, unit: unit, unit_price: num_(g.last_price),
          balance_before: out.before, balance_after: out.after,
          reference_type: 'TRANSFER', reference_no: trfNo,
          created_by: auth.user.username, note: 'โอนไป ' + to.location_code
        });
        logTxn_({
          transaction_no: trfNo, transaction_type: 'TRANSFER_IN', transaction_date: date,
          location_id: to.location_id, location_name: to.location_name,
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          quantity: qty, unit: unit, unit_price: num_(g.last_price),
          balance_before: inn.before, balance_after: inn.after,
          reference_type: 'TRANSFER', reference_no: trfNo,
          created_by: auth.user.username, note: 'รับโอนจาก ' + from.location_code
        });
      });

      audit_(auth.user, 'TRANSFER', 'Transfers', trfNo, null,
        { from: from.location_code, to: to.location_code, items: items.length });
      return ok_('โอนวัตถุดิบ ' + from.location_code + ' → ' + to.location_code + ' สำเร็จ เลขที่ ' + trfNo,
        { transfer_no: trfNo });
    });
  } catch (e) {
    return err_('ไม่สามารถโอนวัตถุดิบได้: ' + e.message);
  }
}

/** ยืนยันการรับโอน (ผู้รับปลายทางเซ็นรับ) */
function receiveTransfer(token, transferNo) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var found = 0;
      readAll_('Transfers').forEach(function(t) {
        if (s_(t.transfer_no) === s_(transferNo) && !s_(t.received_by)) {
          updateRow_('Transfers', 'transfer_id', t.transfer_id,
            { received_by: auth.user.username, status: 'received' });
          found++;
        }
      });
      if (!found) return err_('ไม่พบใบโอนที่รอรับ หรือรับแล้ว');
      audit_(auth.user, 'EDIT', 'Transfers', s_(transferNo), null, { received_by: auth.user.username });
      return ok_('ยืนยันรับโอน ' + transferNo + ' สำเร็จ');
    });
  } catch (e) {
    return err_('ไม่สามารถยืนยันรับโอนได้: ' + e.message);
  }
}

function listTransfers(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var locIdx = indexBy_(readAll_('Locations'), 'location_id');
  var rows = readAll_('Transfers').filter(function(t) {
    if (s_(filters.date_from) && s_(t.transfer_date) < s_(filters.date_from)) return false;
    if (s_(filters.date_to) && s_(t.transfer_date) > s_(filters.date_to)) return false;
    return true;
  });
  rows.forEach(function(t) {
    t.from_location_name = (locIdx[t.from_location] || {}).location_code || t.from_location;
    t.to_location_name = (locIdx[t.to_location] || {}).location_code || t.to_location;
  });
  rows.sort(function(a, b) { return s_(b.created_at).localeCompare(s_(a.created_at)); });
  return ok_('โหลดรายการโอนสำเร็จ', rows);
}

/* ═══════════════ INVENTORY ADJUSTMENT ═══════════════ */

/**
 * ปรับ Stock (บังคับกรอกเหตุผล + Audit Trail)
 * payload: { location_id, ingredient_id, new_quantity, reason }
 */
function createAdjustment(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var reason = s_(payload.reason);
      if (!reason) return err_('กรุณาระบุเหตุผลในการปรับ Stock');
      var loc = findBy_('Locations', 'location_id', s_(payload.location_id));
      if (!loc) return err_('กรุณาเลือกคลัง');
      var g = findBy_('Ingredients', 'ingredient_id', s_(payload.ingredient_id));
      if (!g) return err_('กรุณาเลือกวัตถุดิบ');
      var newQty = round_(payload.new_quantity);
      if (newQty < 0) return err_('จำนวนใหม่ต้องไม่ติดลบ');

      var bal = findBy_('StockBalances', 'stock_id', loc.location_id + '_' + g.ingredient_id);
      var before = bal ? num_(bal.current_balance) : 0;
      var delta = round_(newQty - before);
      if (delta === 0) return err_('จำนวนใหม่เท่ากับจำนวนเดิม ไม่มีการเปลี่ยนแปลง');

      var adjNo = docNo_('ADJ', 'StockTransactions', 'transaction_no');
      var mv = adjustStock_(loc.location_id, g.ingredient_id, delta, 0);
      logTxn_({
        transaction_no: adjNo,
        transaction_type: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        transaction_date: today_(),
        location_id: loc.location_id, location_name: loc.location_name,
        ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
        quantity: delta, unit: g.default_unit, unit_price: num_(g.last_price),
        balance_before: mv.before, balance_after: mv.after,
        reference_type: 'ADJUSTMENT', reference_no: adjNo,
        created_by: auth.user.username, note: reason
      });
      audit_(auth.user, 'ADJUSTMENT', 'StockBalances', loc.location_id + '_' + g.ingredient_id,
        { balance: mv.before }, { balance: mv.after, reason: reason });
      return ok_('ปรับ Stock ' + g.ingredient_name + ' จาก ' + mv.before + ' เป็น ' + mv.after + ' สำเร็จ');
    });
  } catch (e) {
    return err_('ไม่สามารถปรับ Stock ได้: ' + e.message);
  }
}

/* ═══════════════ STOCK MOVEMENTS ═══════════════ */

function listStockTransactions(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var rows = readAll_('StockTransactions').filter(function(t) {
    if (s_(filters.date_from) && s_(t.transaction_date) < s_(filters.date_from)) return false;
    if (s_(filters.date_to) && s_(t.transaction_date) > s_(filters.date_to)) return false;
    if (s_(filters.location_id) && t.location_id !== s_(filters.location_id)) return false;
    if (s_(filters.ingredient_id) && t.ingredient_id !== s_(filters.ingredient_id)) return false;
    if (s_(filters.transaction_type) && t.transaction_type !== s_(filters.transaction_type)) return false;
    return true;
  });
  rows.sort(function(a, b) { return s_(b.created_at).localeCompare(s_(a.created_at)); });
  if (rows.length > 1000) rows = rows.slice(0, 1000);
  return ok_('โหลดประวัติการเคลื่อนไหวสำเร็จ', rows);
}

function listStockIn(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var rows = readAll_('StockIn').filter(function(t) {
    if (s_(filters.date_from) && s_(t.stockin_date) < s_(filters.date_from)) return false;
    if (s_(filters.date_to) && s_(t.stockin_date) > s_(filters.date_to)) return false;
    if (s_(filters.location_id) && t.location_id !== s_(filters.location_id)) return false;
    return true;
  });
  rows.sort(function(a, b) { return s_(b.created_at).localeCompare(s_(a.created_at)); });
  return ok_('โหลดประวัติรับเข้าสำเร็จ', rows);
}
