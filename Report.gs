/***************************************************************
 * Report.gs — Fast Initial Load / Dashboard / Notifications /
 *             Report Center / AI Assistant Modules
 ***************************************************************/

/* ═══════════════ INITIAL DATA (โหลดครั้งเดียวหลัง Login) ═══════════════ */

function getFastInitialData(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  try {
    var stock = getStockBalances(token, {});
    return ok_('โหลดข้อมูลเริ่มต้นสำเร็จ', {
      user: publicUser_(auth.user),
      settings: getSettingsMap_(),
      locations: readAll_('Locations').filter(function(l) { return l.status === 'active'; }),
      categories: readAll_('Categories').filter(function(c) { return c.status === 'active'; }),
      vendors: readAll_('Vendors').filter(function(v) { return v.status === 'active'; }),
      ingredients: readAll_('Ingredients').filter(function(g) { return g.status === 'active'; }),
      menus: listMenus(token).data,
      stock: stock.data,
      notifications: buildNotifications_(),
      app_version: APP_VERSION
    });
  } catch (e) {
    return err_('ไม่สามารถโหลดข้อมูลเริ่มต้นได้: ' + e.message);
  }
}

/* ═══════════════ NOTIFICATIONS ═══════════════ */

function getNotifications(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  return ok_('โหลดการแจ้งเตือนสำเร็จ', buildNotifications_());
}

function buildNotifications_() {
  var ingIdx = indexBy_(readAll_('Ingredients').filter(function(g) { return g.status === 'active'; }), 'ingredient_id');
  var totals = {};
  readAll_('StockBalances').forEach(function(b) {
    if (!ingIdx[b.ingredient_id]) return;
    totals[b.ingredient_id] = (totals[b.ingredient_id] || 0) + num_(b.current_balance);
  });
  var low = 0, critical = 0, out = 0;
  Object.keys(ingIdx).forEach(function(id) {
    var g = ingIdx[id];
    var st = stockStatus_(num_(totals[id]), num_(g.min_stock), num_(g.safety_stock));
    if (st === 'out') out++;
    else if (st === 'critical') critical++;
    else if (st === 'low') low++;
  });
  var pendingApproval = readAll_('Requisitions').filter(function(r) { return r.status === 'pending'; }).length;
  var pendingUsers = readAll_('Users').filter(function(u) { return u.status === 'pending'; }).length;
  var hasRecipe = {};
  readAll_('Recipes').forEach(function(r) { if (r.status === 'active') hasRecipe[r.menu_id] = true; });
  var noRecipe = readAll_('Menus').filter(function(m) {
    return m.status === 'active' && !hasRecipe[m.menu_id];
  }).length;
  var purchaseSuggestions = 0;
  Object.keys(ingIdx).forEach(function(id) {
    var g = ingIdx[id];
    if (num_(g.min_stock) > 0 && num_(totals[id]) <= num_(g.min_stock)) purchaseSuggestions++;
  });
  return {
    pending_approval: pendingApproval, low_stock: low, critical_stock: critical,
    out_of_stock: out, purchase_suggestions: purchaseSuggestions,
    menus_no_recipe: noRecipe, pending_users: pendingUsers
  };
}

/* ═══════════════ DASHBOARD ═══════════════ */

function getDashboard(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  try {
    var today = today_();
    var ings = readAll_('Ingredients').filter(function(g) { return g.status === 'active'; });
    var ingIdx = indexBy_(ings, 'ingredient_id');
    var balances = readAll_('StockBalances');
    var txns = readAll_('StockTransactions');

    // ── KPI ──
    var stockValue = 0, totals = {};
    balances.forEach(function(b) {
      var g = ingIdx[b.ingredient_id];
      if (!g) return;
      stockValue += num_(b.current_balance) * num_(g.last_price);
      totals[b.ingredient_id] = (totals[b.ingredient_id] || 0) + num_(b.current_balance);
    });
    var todayIn = 0, todayIssueQty = 0, todayCost = 0;
    txns.forEach(function(t) {
      if (s_(t.transaction_date) !== today) return;
      if (t.transaction_type === 'STOCK_IN') todayIn += num_(t.total_amount);
      if (t.transaction_type === 'ISSUE') {
        todayIssueQty++;
        todayCost += Math.abs(num_(t.quantity)) * num_(t.unit_price);
      }
    });

    // ── เมนูวันนี้ + วัตถุดิบที่ต้องใช้วันนี้ ──
    var todayCalc = calcRequirement_({ date: today });

    // ── Charts ──
    var stockByCat = {};
    balances.forEach(function(b) {
      var g = ingIdx[b.ingredient_id];
      if (!g) return;
      var cat = g.category_name || 'อื่นๆ';
      stockByCat[cat] = round_((stockByCat[cat] || 0) + num_(b.current_balance) * num_(g.last_price), 2);
    });

    var d7 = [], costByDay = {}, usageByCat = {}, topUsed = {}, vendorSpend = {};
    for (var i = 6; i >= 0; i--) {
      var dt = new Date(); dt.setDate(dt.getDate() - i);
      d7.push(Utilities.formatDate(dt, TZ, 'yyyy-MM-dd'));
    }
    var dt30 = new Date(); dt30.setDate(dt30.getDate() - 30);
    var d30 = Utilities.formatDate(dt30, TZ, 'yyyy-MM-dd');
    txns.forEach(function(t) {
      var d = s_(t.transaction_date);
      if (t.transaction_type === 'ISSUE' && d >= d7[0]) {
        costByDay[d] = round_((costByDay[d] || 0) + Math.abs(num_(t.quantity)) * num_(t.unit_price), 2);
      }
      if (t.transaction_type === 'ISSUE' && d >= d30) {
        var g = ingIdx[t.ingredient_id] || {};
        var cat = g.category_name || 'อื่นๆ';
        usageByCat[cat] = round_((usageByCat[cat] || 0) + Math.abs(num_(t.quantity)));
        var k = t.ingredient_name;
        topUsed[k] = round_((topUsed[k] || 0) + Math.abs(num_(t.quantity)));
      }
    });
    readAll_('StockIn').forEach(function(r) {
      if (s_(r.stockin_date) >= d30) {
        var vn = r.vendor_name || 'ไม่ระบุ';
        vendorSpend[vn] = round_((vendorSpend[vn] || 0) + num_(r.total_amount), 2);
      }
    });

    var statusCount = { normal: 0, low: 0, critical: 0, out: 0 };
    ings.forEach(function(g) {
      statusCount[stockStatus_(num_(totals[g.ingredient_id]), num_(g.min_stock), num_(g.safety_stock))]++;
    });

    var topExpensive = ings.slice().sort(function(a, b) { return num_(b.last_price) - num_(a.last_price); })
      .slice(0, 10).map(function(g) { return { name: g.ingredient_name, price: num_(g.last_price) }; });

    var notif = buildNotifications_();

    return ok_('โหลด Dashboard สำเร็จ', {
      today: today,
      kpi: {
        total_ingredients: ings.length,
        stock_value: round_(stockValue, 2),
        today_in: round_(todayIn, 2),
        today_issue_count: todayIssueQty,
        today_cost: round_(todayCost, 2),
        low_stock: notif.low_stock + notif.critical_stock,
        out_of_stock: notif.out_of_stock,
        pending_approval: notif.pending_approval,
        purchase_suggestions: notif.purchase_suggestions,
        menu_today: todayCalc.menus.length,
        ingredients_required_today: todayCalc.items.length,
        estimated_cost_today: todayCalc.total_estimated_cost
      },
      today_menus: todayCalc.menus,
      today_requirement: todayCalc.items,
      menus_no_recipe: todayCalc.menus_no_recipe,
      charts: {
        stock_by_category: stockByCat,
        usage_by_category: usageByCat,
        daily_cost: d7.map(function(d) { return { date: d, cost: costByDay[d] || 0 }; }),
        top_used: Object.keys(topUsed).map(function(k) { return { name: k, qty: topUsed[k] }; })
          .sort(function(a, b) { return b.qty - a.qty; }).slice(0, 10),
        top_expensive: topExpensive,
        vendor_spend: vendorSpend,
        stock_status: statusCount
      },
      notifications: notif
    });
  } catch (e) {
    return err_('ไม่สามารถโหลด Dashboard ได้: ' + e.message);
  }
}

/* ═══════════════ REPORT CENTER ═══════════════ */

/**
 * getReport(token, { type, date_from, date_to, location_id, category_id,
 *                    ingredient_id, vendor_id, menu_id })
 * คืน { title, columns:[{key,label,type}], rows:[...] } พร้อม Export ฝั่ง Client
 */
function getReport(token, q) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  try {
    q = q || {};
    var type = s_(q.type);
    var from = s_(q.date_from) || today_();
    var to = s_(q.date_to) || today_();
    var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');

    function inRange(d) { return s_(d) >= from && s_(d) <= to; }
    function fIng(r) { return !s_(q.ingredient_id) || r.ingredient_id === s_(q.ingredient_id); }
    function fLoc(r) { return !s_(q.location_id) || r.location_id === s_(q.location_id); }
    function fCat(r) {
      if (!s_(q.category_id)) return true;
      var g = ingIdx[r.ingredient_id];
      return g && g.category_id === s_(q.category_id);
    }

    var C = {
      date: { key: 'date', label: 'วันที่' }, ing: { key: 'ingredient_name', label: 'วัตถุดิบ' },
      qty: { key: 'quantity', label: 'จำนวน', type: 'num' }, unit: { key: 'unit', label: 'หน่วย' },
      price: { key: 'unit_price', label: 'ราคา/หน่วย', type: 'money' },
      amount: { key: 'total_amount', label: 'รวมเงิน', type: 'money' },
      loc: { key: 'location_name', label: 'คลัง' }, cat: { key: 'category_name', label: 'หมวดหมู่' }
    };
    var title = '', columns = [], rows = [];

    switch (type) {
      case 'stock_balance':
      case 'low_stock':
      case 'out_of_stock':
      case 'stock_value': {
        var res = getStockBalances(token, { location_id: s_(q.location_id) });
        rows = res.data.filter(function(b) { return fCat(b) && fIng(b); });
        if (type === 'low_stock') { rows = rows.filter(function(b) { return b.stock_status === 'low' || b.stock_status === 'critical'; }); title = 'รายงานวัตถุดิบใกล้หมด'; }
        else if (type === 'out_of_stock') { rows = rows.filter(function(b) { return b.stock_status === 'out'; }); title = 'รายงานวัตถุดิบหมด'; }
        else if (type === 'stock_value') title = 'รายงานมูลค่า Stock';
        else title = 'รายงาน Stock คงเหลือ';
        columns = [C.ing, C.cat, C.loc, { key: 'current_balance', label: 'คงเหลือ', type: 'num' },
          { key: 'reserved_quantity', label: 'จองแล้ว', type: 'num' },
          { key: 'available_balance', label: 'พร้อมใช้', type: 'num' }, C.unit,
          { key: 'min_stock', label: 'Min', type: 'num' },
          { key: 'unit_price', label: 'ราคา/หน่วย', type: 'money' },
          { key: 'stock_value', label: 'มูลค่า', type: 'money' },
          { key: 'stock_status', label: 'สถานะ', type: 'status' }];
        break;
      }
      case 'stock_movement': case 'stock_issue': {
        var txr = readAll_('StockTransactions').filter(function(t) {
          if (!inRange(t.transaction_date) || !fLoc(t) || !fIng(t) || !fCat(t)) return false;
          if (type === 'stock_issue') return t.transaction_type === 'ISSUE';
          return true;
        });
        title = type === 'stock_issue' ? 'รายงานการเบิกจ่าย' : 'รายงานการเคลื่อนไหว Stock';
        columns = [{ key: 'transaction_date', label: 'วันที่' }, { key: 'transaction_no', label: 'เลขที่' },
          { key: 'transaction_type', label: 'ประเภท' }, C.ing, C.qty, C.unit, C.price,
          { key: 'balance_after', label: 'คงเหลือ', type: 'num' }, C.loc, { key: 'created_by', label: 'ผู้ทำรายการ' }];
        rows = txr;
        break;
      }
      case 'stock_in': {
        rows = readAll_('StockIn').filter(function(r) {
          return inRange(r.stockin_date) && fLoc(r) && fIng(r) && fCat(r) &&
            (!s_(q.vendor_id) || r.vendor_id === s_(q.vendor_id));
        });
        title = 'รายงานรับเข้าวัตถุดิบ';
        columns = [{ key: 'stockin_date', label: 'วันที่' }, { key: 'stockin_no', label: 'เลขที่' },
          C.ing, C.qty, C.unit, C.price, C.amount, { key: 'vendor_name', label: 'Vendor' }, C.loc];
        break;
      }
      case 'transfer': {
        var locIdx = indexBy_(readAll_('Locations'), 'location_id');
        rows = readAll_('Transfers').filter(function(t) { return inRange(t.transfer_date) && fIng(t); })
          .map(function(t) {
            var o = {}; Object.keys(t).forEach(function(k) { o[k] = t[k]; });
            o.from_name = (locIdx[t.from_location] || {}).location_code || t.from_location;
            o.to_name = (locIdx[t.to_location] || {}).location_code || t.to_location;
            return o;
          });
        title = 'รายงานการโอนวัตถุดิบ';
        columns = [{ key: 'transfer_date', label: 'วันที่' }, { key: 'transfer_no', label: 'เลขที่' },
          C.ing, C.qty, C.unit, { key: 'from_name', label: 'จาก' }, { key: 'to_name', label: 'ไป' },
          { key: 'status', label: 'สถานะ', type: 'status' }, { key: 'created_by', label: 'ผู้โอน' }];
        break;
      }
      case 'usage_daily': case 'usage_by_ingredient': case 'usage_by_category':
      case 'usage_by_location': case 'usage_by_menu': {
        var issues = readAll_('StockTransactions').filter(function(t) {
          return t.transaction_type === 'ISSUE' && inRange(t.transaction_date) && fLoc(t) && fIng(t) && fCat(t);
        });
        var keyOf, keyLabel;
        if (type === 'usage_by_ingredient') { keyOf = function(t) { return t.ingredient_name; }; keyLabel = 'วัตถุดิบ'; title = 'รายงานการใช้ตามวัตถุดิบ'; }
        else if (type === 'usage_by_category') { keyOf = function(t) { return (ingIdx[t.ingredient_id] || {}).category_name || 'อื่นๆ'; }; keyLabel = 'หมวดหมู่'; title = 'รายงานการใช้ตามหมวดหมู่'; }
        else if (type === 'usage_by_location') { keyOf = function(t) { return t.location_name; }; keyLabel = 'คลัง'; title = 'รายงานการใช้ตาม Location'; }
        else if (type === 'usage_by_menu') { keyOf = function(t) { return t.reference_no || 'ไม่ระบุ'; }; keyLabel = 'อ้างอิงใบเบิก'; title = 'รายงานการใช้ตามใบเบิก/เมนู'; }
        else { keyOf = function(t) { return s_(t.transaction_date); }; keyLabel = 'วันที่'; title = 'รายงานการใช้รายวัน'; }
        var agg2 = {};
        issues.forEach(function(t) {
          var k = keyOf(t);
          var a = agg2[k] = agg2[k] || { group_key: k, quantity: 0, total_amount: 0, count: 0 };
          a.quantity = round_(a.quantity + Math.abs(num_(t.quantity)));
          a.total_amount = round_(a.total_amount + Math.abs(num_(t.quantity)) * num_(t.unit_price), 2);
          a.count++;
        });
        rows = Object.keys(agg2).map(function(k) { return agg2[k]; })
          .sort(function(a, b) { return b.total_amount - a.total_amount; });
        columns = [{ key: 'group_key', label: keyLabel }, { key: 'count', label: 'จำนวนรายการ', type: 'num' },
          { key: 'quantity', label: 'ปริมาณรวม', type: 'num' }, { key: 'total_amount', label: 'มูลค่ารวม', type: 'money' }];
        break;
      }
      case 'recipe_vs_actual': {
        var settings = getSettingsMap_();
        var warnP = num_(settings.variance_warning_percent) || 10;
        var dangerP = num_(settings.variance_danger_percent) || 25;
        rows = readAll_('ActualUsage').filter(function(u) { return inRange(u.usage_date) && fIng(u); })
          .map(function(u) {
            var o = {}; Object.keys(u).forEach(function(k) { o[k] = u[k]; });
            var vp = num_(u.variance_percent);
            o.variance_flag = vp > dangerP ? '🔴 เกินมาก' : (vp > warnP ? '🟡 เกินเล็กน้อย' : '🟢 ปกติ');
            return o;
          });
        title = 'รายงาน Recipe vs Actual (Variance)';
        columns = [{ key: 'usage_date', label: 'วันที่' }, { key: 'menu_name', label: 'เมนู' }, C.ing,
          { key: 'recipe_quantity', label: 'ตามสูตร', type: 'num' },
          { key: 'issued_quantity', label: 'เบิกจ่าย', type: 'num' },
          { key: 'actual_quantity', label: 'ใช้จริง', type: 'num' },
          { key: 'variance_quantity', label: 'ส่วนต่าง', type: 'num' },
          { key: 'variance_percent', label: 'ส่วนต่าง %', type: 'num' },
          { key: 'variance_flag', label: 'ประเมิน' },
          { key: 'actual_cost', label: 'ต้นทุนจริง', type: 'money' }];
        break;
      }
      case 'cost_daily': case 'cost_by_menu': case 'cost_by_category': case 'cost_by_location': {
        var gb = type === 'cost_by_category' ? 'category' : type === 'cost_by_location' ? 'location' : type === 'cost_by_menu' ? 'ingredient' : 'day';
        var cs = getCostSummary(token, { date_from: from, date_to: to, group_by: gb, location_id: s_(q.location_id) });
        rows = cs.data.groups.map(function(g) { return { group_key: g.key, items: g.items, quantity: g.quantity, cost: g.cost }; });
        title = 'รายงานต้นทุน (' + (gb === 'day' ? 'รายวัน' : gb) + ')';
        columns = [{ key: 'group_key', label: gb === 'day' ? 'วันที่' : 'กลุ่ม' },
          { key: 'items', label: 'จำนวนรายการ', type: 'num' },
          { key: 'quantity', label: 'ปริมาณ', type: 'num' }, { key: 'cost', label: 'ต้นทุน', type: 'money' }];
        break;
      }
      case 'daily_ingredient_cost': {
        var cs2 = getCostSummary(token, { date_from: from, date_to: to, group_by: 'day', location_id: s_(q.location_id) });
        rows = cs2.data.details;
        title = 'Daily Ingredient Cost (Export Excel)';
        columns = [C.date, { key: 'reference_no', label: 'เอกสาร' }, C.ing, C.cat, C.qty, C.unit,
          C.price, C.amount, { key: 'vendor_name', label: 'Vendor' }, C.loc];
        break;
      }
      case 'vendor_purchase': {
        var byVen = {};
        readAll_('StockIn').forEach(function(r) {
          if (!inRange(r.stockin_date) || !fIng(r)) return;
          if (s_(q.vendor_id) && r.vendor_id !== s_(q.vendor_id)) return;
          var k = r.vendor_name || 'ไม่ระบุ';
          var a = byVen[k] = byVen[k] || { group_key: k, count: 0, total_amount: 0 };
          a.count++; a.total_amount = round_(a.total_amount + num_(r.total_amount), 2);
        });
        rows = Object.keys(byVen).map(function(k) { return byVen[k]; })
          .sort(function(a, b) { return b.total_amount - a.total_amount; });
        title = 'รายงานยอดซื้อตาม Vendor';
        columns = [{ key: 'group_key', label: 'Vendor' }, { key: 'count', label: 'จำนวนรายการ', type: 'num' },
          { key: 'total_amount', label: 'ยอดซื้อรวม', type: 'money' }];
        break;
      }
      case 'price_history': {
        rows = readAll_('PriceHistory').filter(function(p) { return inRange(p.date) && fIng(p); });
        title = 'รายงานประวัติราคา';
        columns = [C.date, C.ing, { key: 'vendor_name', label: 'Vendor' },
          { key: 'previous_price', label: 'ราคาเดิม', type: 'money' },
          { key: 'price', label: 'ราคาใหม่', type: 'money' },
          { key: 'price_change', label: 'เปลี่ยนแปลง', type: 'num' },
          { key: 'price_change_percent', label: '%', type: 'num' },
          { key: 'source_document', label: 'อ้างอิง' }];
        break;
      }
      case 'requisition_history': {
        rows = readAll_('Requisitions').filter(function(r) {
          return inRange(r.requisition_date) && (!s_(q.location_id) || r.location_id === s_(q.location_id));
        });
        title = 'รายงานประวัติใบเบิก';
        columns = [{ key: 'requisition_date', label: 'วันที่' }, { key: 'requisition_no', label: 'เลขที่' },
          C.loc, { key: 'meal_period', label: 'ช่วงอาหาร' }, { key: 'status', label: 'สถานะ', type: 'status' },
          { key: 'requested_by', label: 'ผู้เบิก' }, { key: 'approved_by', label: 'ผู้อนุมัติ' }];
        break;
      }
      case 'purchase_plan': {
        rows = readAll_('PurchasePlans').filter(function(p) { return inRange(p.plan_date) && fIng(p); });
        title = 'รายงานแผนสั่งซื้อ';
        columns = [{ key: 'plan_date', label: 'วันที่' }, { key: 'purchase_plan_no', label: 'เลขที่' },
          { key: 'vendor_name', label: 'Vendor' }, C.ing,
          { key: 'final_purchase_quantity', label: 'จำนวนสั่ง', type: 'num' }, C.unit,
          { key: 'last_price', label: 'ราคา', type: 'money' },
          { key: 'estimated_amount', label: 'ประมาณการ', type: 'money' },
          { key: 'status', label: 'สถานะ', type: 'status' }];
        break;
      }
      default:
        return err_('ไม่รู้จักประเภทรายงาน: ' + type);
    }

    rows = rows.map(function(r) {
      var o = {};
      columns.forEach(function(c) { o[c.key] = r[c.key] !== undefined ? r[c.key] : ''; });
      return o;
    });
    if (rows.length > 3000) rows = rows.slice(0, 3000);
    return ok_('สร้างรายงานสำเร็จ', { title: title, columns: columns, rows: rows, date_from: from, date_to: to });
  } catch (e) {
    return err_('ไม่สามารถสร้างรายงานได้: ' + e.message);
  }
}

/* ═══════════════ AUDIT LOG ═══════════════ */

function listAuditLogs(token, filters) {
  var auth = requireAuth_(token, ['Admin']);
  if (!auth.ok) return auth.res;
  var rows = readAll_('AuditLogs');
  rows.sort(function(a, b) { return s_(b.timestamp).localeCompare(s_(a.timestamp)); });
  return ok_('โหลด Audit Log สำเร็จ', rows.slice(0, 500));
}

/* ═══════════════ AI RECIPE ASSISTANT ═══════════════
 * Version แรก: สร้าง Draft สูตรจากค่าเฉลี่ยของเมนูหมวดเดียวกันที่มีสูตรแล้ว
 * ผลลัพธ์เป็น "AI Suggested" เท่านั้น — ต้องให้ Admin/Supervisor
 * ตรวจสอบและกด Approve (saveRecipe) ก่อนจึงเป็นสูตรจริง
 * โครงสร้างนี้รองรับการต่อ AI ภายนอกในอนาคตโดยเปลี่ยน implementation ภายใน
 */

function aiSuggestRecipe(token, menuId) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    var menu = findBy_('Menus', 'menu_id', s_(menuId));
    if (!menu) return err_('ไม่พบเมนูนี้');
    var recipes = readAll_('Recipes').filter(function(r) { return r.status === 'active'; });
    var menus = indexBy_(readAll_('Menus'), 'menu_id');

    // หาเมนูหมวดเดียวกัน (หรือทุกเมนูถ้าไม่มีหมวดตรง) ที่มีสูตรแล้ว
    var sameCat = recipes.filter(function(r) {
      var m = menus[r.menu_id];
      return m && m.menu_id !== menu.menu_id && s_(m.menu_category) === s_(menu.menu_category);
    });
    var pool = sameCat.length ? sameCat : recipes.filter(function(r) { return r.menu_id !== menu.menu_id; });
    if (!pool.length) return err_('ยังไม่มีสูตรอื่นในระบบให้ AI ใช้อ้างอิง กรุณาสร้างสูตรเองก่อน');

    // เฉลี่ยปริมาณต่อ batch 100 ของวัตถุดิบที่ถูกใช้บ่อยในหมวดนี้
    var stat = {};
    pool.forEach(function(r) {
      var batch = num_(r.batch_size) || 100;
      var per100 = num_(r.quantity) / batch * 100;
      var a = stat[r.ingredient_id] = stat[r.ingredient_id] || { total: 0, count: 0, unit: r.unit, name: r.ingredient_name };
      a.total += per100; a.count++;
    });
    var targetBatch = num_(menu.default_batch_size) || 100;
    var items = Object.keys(stat).map(function(id) {
      var a = stat[id];
      return {
        ingredient_id: id, ingredient_name: a.name, unit: a.unit,
        quantity: round_(a.total / a.count / 100 * targetBatch, 2),
        usage_count: a.count, ai_suggested: true
      };
    }).sort(function(x, y) { return y.usage_count - x.usage_count; }).slice(0, 8);

    return ok_('AI แนะนำ Draft สูตรสำเร็จ — กรุณาตรวจสอบก่อนบันทึกเป็นสูตรจริง', {
      menu_id: menu.menu_id, menu_name: menu.menu_name,
      batch_size: targetBatch, source: 'AI Suggested (อ้างอิงเมนูหมวด "' + (menu.menu_category || 'ทั้งหมด') + '")',
      is_official: false, items: items
    });
  } catch (e) {
    return err_('AI ไม่สามารถแนะนำสูตรได้: ' + e.message);
  }
}

/* ═══════════════ AI SMART STOCK ANALYSIS ═══════════════
 * วิเคราะห์เชิงแนะนำเท่านั้น — ไม่แก้ Stock จริงโดยอัตโนมัติ
 */
function getStockAnalysis(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  try {
    var ings = readAll_('Ingredients').filter(function(g) { return g.status === 'active'; });
    var ingIdx = indexBy_(ings, 'ingredient_id');
    var totals = {};
    readAll_('StockBalances').forEach(function(b) {
      totals[b.ingredient_id] = (totals[b.ingredient_id] || 0) + num_(b.current_balance);
    });
    var d14 = new Date(); d14.setDate(d14.getDate() - 14);
    var since = Utilities.formatDate(d14, TZ, 'yyyy-MM-dd');
    var usage = {};
    readAll_('StockTransactions').forEach(function(t) {
      if (t.transaction_type === 'ISSUE' && s_(t.transaction_date) >= since) {
        usage[t.ingredient_id] = (usage[t.ingredient_id] || 0) + Math.abs(num_(t.quantity));
      }
    });
    var insights = [];
    ings.forEach(function(g) {
      var stock = num_(totals[g.ingredient_id]);
      var dailyUse = round_((usage[g.ingredient_id] || 0) / 14);
      var daysLeft = dailyUse > 0 ? round_(stock / dailyUse, 1) : null;
      var st = stockStatus_(stock, num_(g.min_stock), num_(g.safety_stock));
      if (st === 'out') insights.push({ level: 'danger', ingredient_name: g.ingredient_name, message: 'หมด Stock — ควรสั่งซื้อทันที', days_left: 0 });
      else if (daysLeft !== null && daysLeft <= 3) insights.push({ level: 'danger', ingredient_name: g.ingredient_name, message: 'จะหมดภายใน ' + daysLeft + ' วัน (ใช้เฉลี่ย ' + dailyUse + ' ' + g.default_unit + '/วัน)', days_left: daysLeft });
      else if (st === 'critical' || st === 'low') insights.push({ level: 'warning', ingredient_name: g.ingredient_name, message: 'Stock ต่ำกว่าจุดสั่งซื้อ (คงเหลือ ' + round_(stock) + ' ' + g.default_unit + ')', days_left: daysLeft });
      else if (dailyUse === 0 && stock > num_(g.min_stock) * 3 && num_(g.min_stock) > 0) insights.push({ level: 'info', ingredient_name: g.ingredient_name, message: 'Stock สูงและไม่มีการใช้ 14 วัน — อาจสต็อกเกินจำเป็น', days_left: null });
    });
    // ราคาเพิ่มผิดปกติ
    var warnPct = num_(getSettingsMap_().price_increase_warning_percent) || 10;
    readAll_('PriceHistory').forEach(function(p) {
      if (s_(p.date) >= since && num_(p.price_change_percent) >= warnPct) {
        insights.push({ level: 'warning', ingredient_name: p.ingredient_name,
          message: '⚠️ ราคาเพิ่มขึ้น ' + p.price_change_percent + '% (' + p.previous_price + ' → ' + p.price + ')', days_left: null });
      }
    });
    var order = { danger: 0, warning: 1, info: 2 };
    insights.sort(function(a, b) { return order[a.level] - order[b.level]; });
    return ok_('วิเคราะห์ Stock สำเร็จ', insights);
  } catch (e) {
    return err_('ไม่สามารถวิเคราะห์ Stock ได้: ' + e.message);
  }
}
