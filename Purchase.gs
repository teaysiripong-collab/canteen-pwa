/***************************************************************
 * Purchase.gs — Purchase Plan / Auto Purchase Suggestion /
 *               Actual Usage / Cost Summary / Price History
 ***************************************************************/

/* ═══════════════ AUTO PURCHASE SUGGESTION ═══════════════ */

/**
 * คำนวณรายการแนะนำสั่งซื้อ (ระบบไม่สั่งซื้อจริงอัตโนมัติ — User ต้องยืนยัน)
 * Recommended = Required Usage + Safety Stock - Available Stock (ถ้า < 0 ให้เป็น 0)
 * รวมทั้งวัตถุดิบที่ Stock ต่ำกว่า Min แม้ไม่มีในแผนเมนู
 * filters: { date_from, date_to, location_id }
 */
function calculatePurchaseSuggestion(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  try {
    filters = filters || {};
    var from = s_(filters.date_from) || today_();
    var to = s_(filters.date_to) || from;
    var locId = s_(filters.location_id);

    var calc = calcRequirement_({ date: from, date_to: to, location_id: locId });
    var requiredOf = {};
    calc.items.forEach(function(it) { requiredOf[it.ingredient_id] = it.required_quantity; });

    // Stock available (รวมหรือตาม Location)
    var availOf = {};
    readAll_('StockBalances').forEach(function(b) {
      if (locId && b.location_id !== locId) return;
      availOf[b.ingredient_id] = (availOf[b.ingredient_id] || 0) + num_(b.available_balance);
    });

    var out = [];
    readAll_('Ingredients').forEach(function(g) {
      if (g.status !== 'active') return;
      var required = num_(requiredOf[g.ingredient_id]);
      var avail = num_(availOf[g.ingredient_id]);
      var safety = num_(g.safety_stock);
      var minStock = num_(g.min_stock);
      var recommended = round_(Math.max(0, required + safety - avail));
      // ถ้าไม่มีในแผนแต่ Stock ต่ำกว่า min ให้เติมกลับถึง min + safety
      if (recommended <= 0 && minStock > 0 && avail <= minStock) {
        recommended = round_(Math.max(0, minStock + safety - avail));
      }
      if (recommended <= 0) return;
      out.push({
        ingredient_id: g.ingredient_id, ingredient_code: g.ingredient_code,
        ingredient_name: g.ingredient_name, category_name: g.category_name,
        unit: g.default_unit, purchase_unit: g.purchase_unit,
        conversion_rate: num_(g.conversion_rate) || 1,
        vendor_id: g.preferred_vendor_id, vendor_name: g.preferred_vendor_name || 'ไม่ระบุ',
        current_stock: round_(avail), required_quantity: round_(required),
        safety_stock: safety, min_stock: minStock,
        recommended_purchase: recommended,
        last_price: num_(g.last_price),
        estimated_amount: round_(recommended * num_(g.last_price), 2),
        stock_status: stockStatus_(avail, minStock, safety)
      });
    });
    out.sort(function(a, b) {
      return s_(a.vendor_name).localeCompare(s_(b.vendor_name), 'th') ||
        s_(a.ingredient_name).localeCompare(s_(b.ingredient_name), 'th');
    });
    return ok_('คำนวณรายการแนะนำสั่งซื้อสำเร็จ', {
      date_from: from, date_to: to, items: out,
      total_estimated: round_(out.reduce(function(s2, i) { return s2 + i.estimated_amount; }, 0), 2)
    });
  } catch (e) {
    return err_('ไม่สามารถคำนวณรายการสั่งซื้อได้: ' + e.message);
  }
}

/**
 * บันทึกแผนสั่งซื้อ (หลัง User ตรวจและแก้จำนวนแล้ว)
 * payload: { required_date, note, items:[{ingredient_id, vendor_id, current_stock,
 *            required_quantity, recommended_purchase, final_quantity}] }
 */
function createPurchasePlan(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var items = (payload.items || []).filter(function(it) {
        return s_(it.ingredient_id) && num_(it.final_quantity) > 0;
      });
      if (!items.length) return err_('กรุณาระบุจำนวนสั่งซื้ออย่างน้อย 1 รายการ');
      var ppNo = docNo_('PP', 'PurchasePlans', 'purchase_plan_no');
      var now = nowTs_();
      var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');
      var venIdx = indexBy_(readAll_('Vendors'), 'vendor_id');
      var total = 0;

      appendRows_('PurchasePlans', items.map(function(it) {
        var g = ingIdx[s_(it.ingredient_id)] || {};
        var v = venIdx[s_(it.vendor_id) || g.preferred_vendor_id] || {};
        var qty = round_(it.final_quantity);
        var price = num_(g.last_price);
        total += qty * price;
        return {
          purchase_plan_id: generateId_('PP'), purchase_plan_no: ppNo,
          plan_date: today_(), required_date: s_(payload.required_date) || today_(),
          vendor_id: v.vendor_id || '', vendor_name: v.vendor_name || 'ไม่ระบุ',
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          current_stock: round_(it.current_stock), required_quantity: round_(it.required_quantity),
          safety_stock: num_(g.safety_stock), recommended_purchase: round_(it.recommended_purchase),
          final_purchase_quantity: qty, unit: g.default_unit,
          last_price: price, estimated_amount: round_(qty * price, 2),
          status: 'confirmed', created_by: auth.user.username,
          note: s_(payload.note), created_at: now
        };
      }));
      audit_(auth.user, 'CREATE', 'PurchasePlans', ppNo, null,
        { items: items.length, total: round_(total, 2) });
      return ok_('✅ สร้างแผนสั่งซื้อ ' + ppNo + ' สำเร็จ (' + items.length + ' รายการ)',
        { purchase_plan_no: ppNo, total_estimated: round_(total, 2) });
    });
  } catch (e) {
    return err_('ไม่สามารถสร้างแผนสั่งซื้อได้: ' + e.message);
  }
}

function listPurchasePlans(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var rows = readAll_('PurchasePlans').filter(function(p) {
    if (s_(filters.date_from) && s_(p.plan_date) < s_(filters.date_from)) return false;
    if (s_(filters.date_to) && s_(p.plan_date) > s_(filters.date_to)) return false;
    if (s_(filters.status) && p.status !== s_(filters.status)) return false;
    return true;
  });
  rows.sort(function(a, b) { return s_(b.created_at).localeCompare(s_(a.created_at)); });
  return ok_('โหลดแผนสั่งซื้อสำเร็จ', rows);
}

/** ปิดแผนสั่งซื้อ (สั่งแล้ว/รับของแล้ว/ยกเลิก) */
function updatePurchasePlanStatus(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  return withLock_(function() {
    var status = s_(payload.status);
    if (['confirmed', 'ordered', 'received', 'cancelled'].indexOf(status) === -1) return err_('สถานะไม่ถูกต้อง');
    var count = 0;
    readAll_('PurchasePlans').forEach(function(p) {
      if (s_(p.purchase_plan_no) === s_(payload.purchase_plan_no)) {
        updateRow_('PurchasePlans', 'purchase_plan_id', p.purchase_plan_id, { status: status });
        count++;
      }
    });
    if (!count) return err_('ไม่พบแผนสั่งซื้อนี้');
    audit_(auth.user, 'EDIT', 'PurchasePlans', s_(payload.purchase_plan_no), null, { status: status });
    return ok_('อัปเดตสถานะแผนสั่งซื้อเป็น ' + status + ' สำเร็จ');
  });
}

/* ═══════════════ ACTUAL USAGE + VARIANCE ═══════════════ */

/**
 * บันทึกการใช้จริงหลังทำอาหาร เพื่อวิเคราะห์ Variance และ Cost
 * payload: { usage_date, location_id, items:[{menu_id, ingredient_id,
 *            recipe_quantity, issued_quantity, actual_quantity, note}] }
 */
function saveActualUsage(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor', 'User']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var items = (payload.items || []).filter(function(it) {
        return s_(it.ingredient_id) && num_(it.actual_quantity) >= 0;
      });
      if (!items.length) return err_('กรุณากรอกจำนวนใช้จริงอย่างน้อย 1 รายการ');
      var date = s_(payload.usage_date) || today_();
      var locId = s_(payload.location_id);
      var now = nowTs_();
      var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');
      var menuIdx = indexBy_(readAll_('Menus'), 'menu_id');

      appendRows_('ActualUsage', items.map(function(it) {
        var g = ingIdx[s_(it.ingredient_id)] || {};
        var m = menuIdx[s_(it.menu_id)] || {};
        var std = num_(it.recipe_quantity);
        var actual = round_(it.actual_quantity);
        var price = num_(g.last_price);
        var varQty = round_(actual - std);
        return {
          usage_id: generateId_('USG'), usage_date: date, location_id: locId,
          menu_id: m.menu_id || '', menu_name: m.menu_name || '',
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          recipe_quantity: std, issued_quantity: round_(it.issued_quantity),
          actual_quantity: actual, variance_quantity: varQty,
          variance_percent: std > 0 ? round_(varQty / std * 100, 2) : 0,
          unit: g.default_unit, unit_price: price,
          actual_cost: round_(actual * price, 2),
          note: s_(it.note), created_at: now
        };
      }));
      audit_(auth.user, 'CREATE', 'ActualUsage', date, null, { items: items.length });
      return ok_('บันทึกการใช้จริงสำเร็จ (' + items.length + ' รายการ)');
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกการใช้จริงได้: ' + e.message);
  }
}

function listActualUsage(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var rows = readAll_('ActualUsage').filter(function(u) {
    if (s_(filters.date_from) && s_(u.usage_date) < s_(filters.date_from)) return false;
    if (s_(filters.date_to) && s_(u.usage_date) > s_(filters.date_to)) return false;
    if (s_(filters.location_id) && u.location_id !== s_(filters.location_id)) return false;
    return true;
  });
  rows.sort(function(a, b) { return s_(b.created_at).localeCompare(s_(a.created_at)); });
  return ok_('โหลดข้อมูลการใช้จริงสำเร็จ', rows);
}

/* ═══════════════ COST SUMMARY ═══════════════ */

/**
 * สรุปต้นทุนจาก Ledger (ISSUE) + ActualUsage
 * filters: { date_from, date_to, group_by: 'day'|'category'|'location'|'vendor'|'menu' }
 */
function getCostSummary(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  try {
    filters = filters || {};
    var from = s_(filters.date_from) || today_();
    var to = s_(filters.date_to) || from;
    var groupBy = s_(filters.group_by) || 'day';
    var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');

    var issues = readAll_('StockTransactions').filter(function(t) {
      return t.transaction_type === 'ISSUE' &&
        s_(t.transaction_date) >= from && s_(t.transaction_date) <= to &&
        (!s_(filters.location_id) || t.location_id === s_(filters.location_id));
    });

    var groups = {};
    var totalCost = 0;
    issues.forEach(function(t) {
      var qty = Math.abs(num_(t.quantity));
      var cost = round_(qty * num_(t.unit_price), 2);
      totalCost += cost;
      var key;
      if (groupBy === 'category') key = (ingIdx[t.ingredient_id] || {}).category_name || 'อื่นๆ';
      else if (groupBy === 'location') key = t.location_name || t.location_id;
      else if (groupBy === 'vendor') key = (ingIdx[t.ingredient_id] || {}).preferred_vendor_name || 'ไม่ระบุ';
      else if (groupBy === 'ingredient') key = t.ingredient_name;
      else key = s_(t.transaction_date);
      var g = groups[key] = groups[key] || { key: key, quantity: 0, cost: 0, items: 0 };
      g.quantity = round_(g.quantity + qty);
      g.cost = round_(g.cost + cost, 2);
      g.items++;
    });

    // รายละเอียดต้นทุนรายบรรทัด (Daily Ingredient Cost สำหรับ Export Excel)
    var details = issues.map(function(t) {
      var g = ingIdx[t.ingredient_id] || {};
      return {
        date: s_(t.transaction_date), reference_no: t.reference_no,
        ingredient_name: t.ingredient_name, category_name: g.category_name || '',
        quantity: Math.abs(num_(t.quantity)), unit: t.unit,
        unit_price: num_(t.unit_price),
        total_amount: round_(Math.abs(num_(t.quantity)) * num_(t.unit_price), 2),
        vendor_name: g.preferred_vendor_name || '', location_name: t.location_name
      };
    });
    details.sort(function(a, b) { return s_(b.date).localeCompare(s_(a.date)); });

    var rows = Object.keys(groups).map(function(k) { return groups[k]; });
    rows.sort(function(a, b) { return s_(a.key).localeCompare(s_(b.key), 'th'); });
    return ok_('สรุปต้นทุนสำเร็จ', {
      date_from: from, date_to: to, group_by: groupBy,
      total_cost: round_(totalCost, 2), groups: rows, details: details
    });
  } catch (e) {
    return err_('ไม่สามารถสรุปต้นทุนได้: ' + e.message);
  }
}

/* ═══════════════ PRICE HISTORY ═══════════════ */

function listPriceHistory(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var rows = readAll_('PriceHistory').filter(function(p) {
    if (s_(filters.date_from) && s_(p.date) < s_(filters.date_from)) return false;
    if (s_(filters.date_to) && s_(p.date) > s_(filters.date_to)) return false;
    if (s_(filters.ingredient_id) && p.ingredient_id !== s_(filters.ingredient_id)) return false;
    return true;
  });
  rows.sort(function(a, b) { return s_(b.created_at).localeCompare(s_(a.created_at)); });
  return ok_('โหลดประวัติราคาสำเร็จ', rows);
}
