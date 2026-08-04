/***************************************************************
 * Planning.gs — Recipes / Recipe Versions / Menu Plans /
 *               Auto Ingredient Requirement Calculation
 ***************************************************************/

/* ═══════════════ RECIPES ═══════════════ */

function listRecipes(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  return ok_('โหลดสูตรอาหารสำเร็จ', readAll_('Recipes').filter(function(r) { return r.status === 'active'; }));
}

function getRecipeByMenu(token, menuId) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  var items = readAll_('Recipes').filter(function(r) {
    return r.menu_id === menuId && r.status === 'active';
  });
  var versions = readAll_('RecipeVersions').filter(function(v) { return v.menu_id === menuId; });
  return ok_('โหลดสูตรสำเร็จ', { items: items, versions: versions });
}

/**
 * บันทึกสูตรทั้งชุดของ 1 เมนู (สร้าง Version ใหม่ทุกครั้ง เก็บของเก่าเป็น archived
 * เพื่อไม่ให้การแก้สูตรไปเปลี่ยนรายงานย้อนหลัง)
 * payload: { menu_id, batch_size, note, items:[{ingredient_id, quantity, unit, waste_percent}] }
 */
function saveRecipe(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var menu = findBy_('Menus', 'menu_id', s_(payload.menu_id));
      if (!menu) return err_('ไม่พบเมนูนี้');
      var items = (payload.items || []).filter(function(it) {
        return s_(it.ingredient_id) && num_(it.quantity) > 0;
      });
      if (!items.length) return err_('กรุณาเพิ่มวัตถุดิบอย่างน้อย 1 รายการ');

      var now = nowTs_();
      var batchSize = num_(payload.batch_size) || num_(menu.default_batch_size) || 100;
      var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');

      // archive สูตรเดิม
      readAll_('Recipes').forEach(function(r) {
        if (r.menu_id === menu.menu_id && r.status === 'active') {
          updateRow_('Recipes', 'recipe_id', r.recipe_id, { status: 'archived', updated_at: now });
        }
      });
      // ปิด version เดิม + สร้าง version ใหม่
      var maxVer = 0;
      readAll_('RecipeVersions').forEach(function(v) {
        if (v.menu_id === menu.menu_id) {
          if (num_(v.version_no) > maxVer) maxVer = num_(v.version_no);
          if (v.status === 'active') updateRow_('RecipeVersions', 'version_id', v.version_id, { status: 'superseded' });
        }
      });
      appendRow_('RecipeVersions', {
        version_id: generateId_('RCV'), menu_id: menu.menu_id, version_no: maxVer + 1,
        effective_date: today_(), status: 'active', approved_by: auth.user.username,
        note: s_(payload.note), created_at: now
      });

      var rows = [];
      items.forEach(function(it) {
        var g = ingIdx[s_(it.ingredient_id)];
        if (!g) return;
        rows.push({
          recipe_id: generateId_('RCP'), menu_id: menu.menu_id, menu_name: menu.menu_name,
          ingredient_id: g.ingredient_id, ingredient_name: g.ingredient_name,
          quantity: round_(it.quantity), unit: s_(it.unit) || g.default_unit,
          batch_size: batchSize, waste_percent: round_(it.waste_percent, 2),
          yield_percent: 100, note: s_(it.note), status: 'active', updated_at: now
        });
      });
      appendRows_('Recipes', rows);
      audit_(auth.user, 'EDIT', 'Recipes', menu.menu_id, null,
        { version: maxVer + 1, items: rows.length, batch_size: batchSize });
      return ok_('บันทึกสูตร "' + menu.menu_name + '" (Version ' + (maxVer + 1) + ') สำเร็จ');
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกสูตรได้: ' + e.message);
  }
}

/** Duplicate สูตรจากเมนูหนึ่งไปอีกเมนู */
function duplicateRecipe(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  var src = readAll_('Recipes').filter(function(r) {
    return r.menu_id === s_(payload.source_menu_id) && r.status === 'active';
  });
  if (!src.length) return err_('เมนูต้นทางยังไม่มีสูตร');
  return saveRecipe(token, {
    menu_id: s_(payload.target_menu_id),
    batch_size: src[0].batch_size,
    note: 'คัดลอกสูตรจากเมนูอื่น',
    items: src.map(function(r) {
      return { ingredient_id: r.ingredient_id, quantity: r.quantity, unit: r.unit, waste_percent: r.waste_percent };
    })
  });
}

/* ═══════════════ MENU PLANS ═══════════════ */

function getMenuPlans(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var from = s_(filters.date_from), to = s_(filters.date_to);
  var loc = s_(filters.location_id);
  var plans = readAll_('MenuPlans').filter(function(p) {
    if (p.status === 'cancelled') return false;
    var d = s_(p.plan_date);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (loc && p.location_id !== loc) return false;
    return true;
  });
  // ติด Badge เมนูไม่มีสูตร
  var hasRecipe = {};
  readAll_('Recipes').forEach(function(r) { if (r.status === 'active') hasRecipe[r.menu_id] = true; });
  plans.forEach(function(p) { p.has_recipe = !!hasRecipe[p.menu_id]; });
  return ok_('โหลดแผนเมนูสำเร็จ', plans);
}

function createMenuPlan(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var date = s_(payload.plan_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err_('รูปแบบวันที่ไม่ถูกต้อง');
      var menu = findBy_('Menus', 'menu_id', s_(payload.menu_id));
      if (!menu) return err_('กรุณาเลือกเมนู');
      var loc = findBy_('Locations', 'location_id', s_(payload.location_id));
      if (!loc) return err_('กรุณาเลือก Location');
      var meal = s_(payload.meal_period) || 'กลางวัน';

      var dup = readAll_('MenuPlans').filter(function(p) {
        return p.status !== 'cancelled' && s_(p.plan_date) === date && p.menu_id === menu.menu_id &&
          p.location_id === loc.location_id && s_(p.meal_period) === meal;
      });
      if (dup.length) return err_('เมนู "' + menu.menu_name + '" มีในแผนวันนี้แล้ว');

      var d = new Date(date + 'T12:00:00');
      var dayNames = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
      var now = nowTs_();
      var row = {
        plan_id: generateId_('PLN'), plan_date: date, day_name: dayNames[d.getDay()],
        week_no: weekNo_(d), meal_period: meal,
        location_id: loc.location_id, location_name: loc.location_name,
        menu_id: menu.menu_id, menu_name: menu.menu_name,
        planned_quantity: num_(payload.planned_quantity) || num_(menu.default_batch_size) || 100,
        batch_multiplier: num_(payload.batch_multiplier) || 1,
        status: 'active', created_by: auth.user.username, created_at: now, updated_at: now
      };
      appendRow_('MenuPlans', row);
      audit_(auth.user, 'CREATE', 'MenuPlans', row.plan_id, null, row);
      return ok_('เพิ่มเมนู "' + menu.menu_name + '" ในแผนสำเร็จ', row);
    });
  } catch (e) {
    return err_('ไม่สามารถเพิ่มแผนเมนูได้: ' + e.message);
  }
}

function updateMenuPlan(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var old = findBy_('MenuPlans', 'plan_id', s_(payload.plan_id));
      if (!old) return err_('ไม่พบแผนเมนูนี้');
      var patch = { updated_at: nowTs_() };
      if (payload.planned_quantity !== undefined) patch.planned_quantity = num_(payload.planned_quantity);
      if (payload.batch_multiplier !== undefined) patch.batch_multiplier = num_(payload.batch_multiplier) || 1;
      if (s_(payload.meal_period)) patch.meal_period = s_(payload.meal_period);
      if (s_(payload.plan_date) && /^\d{4}-\d{2}-\d{2}$/.test(s_(payload.plan_date))) {
        var d = new Date(s_(payload.plan_date) + 'T12:00:00');
        var dayNames = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
        patch.plan_date = s_(payload.plan_date);
        patch.day_name = dayNames[d.getDay()];
        patch.week_no = weekNo_(d);
      }
      if (s_(payload.location_id)) {
        var loc = findBy_('Locations', 'location_id', s_(payload.location_id));
        if (loc) { patch.location_id = loc.location_id; patch.location_name = loc.location_name; }
      }
      updateRow_('MenuPlans', 'plan_id', old.plan_id, patch);
      audit_(auth.user, 'EDIT', 'MenuPlans', old.plan_id, old, patch);
      return ok_('บันทึกแผนเมนูสำเร็จ');
    });
  } catch (e) {
    return err_('ไม่สามารถแก้ไขแผนเมนูได้: ' + e.message);
  }
}

function deleteMenuPlan(token, planId) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var old = findBy_('MenuPlans', 'plan_id', s_(planId));
      if (!old) return err_('ไม่พบแผนเมนูนี้');
      updateRow_('MenuPlans', 'plan_id', old.plan_id, { status: 'cancelled', updated_at: nowTs_() });
      audit_(auth.user, 'DELETE', 'MenuPlans', old.plan_id, old, { status: 'cancelled' });
      return ok_('ลบเมนู "' + old.menu_name + '" ออกจากแผนแล้ว');
    });
  } catch (e) {
    return err_('ไม่สามารถลบแผนเมนูได้: ' + e.message);
  }
}

/** Copy แผนทั้งวัน หรือทั้งสัปดาห์ ไปวันที่/สัปดาห์ใหม่ (สร้าง ID ใหม่ทั้งหมด) */
function copyMenuPlan(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var mode = s_(payload.mode); // 'day' | 'week'
      var srcFrom = s_(payload.source_from), srcTo = s_(payload.source_to) || srcFrom;
      var targetFrom = s_(payload.target_from);
      if (!srcFrom || !targetFrom) return err_('กรุณาระบุวันที่ต้นทางและปลายทาง');
      var offsetDays = Math.round((new Date(targetFrom + 'T12:00:00') - new Date(srcFrom + 'T12:00:00')) / 86400000);

      var src = readAll_('MenuPlans').filter(function(p) {
        return p.status !== 'cancelled' && s_(p.plan_date) >= srcFrom && s_(p.plan_date) <= srcTo;
      });
      if (!src.length) return err_('ไม่พบแผนเมนูในช่วงวันที่ต้นทาง');

      var existing = {};
      readAll_('MenuPlans').forEach(function(p) {
        if (p.status !== 'cancelled') {
          existing[s_(p.plan_date) + '|' + p.menu_id + '|' + p.location_id + '|' + s_(p.meal_period)] = true;
        }
      });

      var dayNames = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
      var now = nowTs_();
      var created = 0, skipped = 0, rows = [];
      src.forEach(function(p) {
        var nd = new Date(s_(p.plan_date) + 'T12:00:00');
        nd.setDate(nd.getDate() + offsetDays);
        var newDate = Utilities.formatDate(nd, TZ, 'yyyy-MM-dd');
        var key = newDate + '|' + p.menu_id + '|' + p.location_id + '|' + s_(p.meal_period);
        if (existing[key]) { skipped++; return; }
        existing[key] = true;
        rows.push({
          plan_id: generateId_('PLN'), plan_date: newDate, day_name: dayNames[nd.getDay()],
          week_no: weekNo_(nd), meal_period: p.meal_period,
          location_id: p.location_id, location_name: p.location_name,
          menu_id: p.menu_id, menu_name: p.menu_name,
          planned_quantity: p.planned_quantity, batch_multiplier: p.batch_multiplier,
          status: 'active', created_by: auth.user.username, created_at: now, updated_at: now
        });
        created++;
      });
      if (rows.length) appendRows_('MenuPlans', rows);
      audit_(auth.user, 'CREATE', 'MenuPlans', 'copy-' + mode,
        { source: srcFrom + '..' + srcTo }, { target: targetFrom, created: created, skipped: skipped });
      return ok_('คัดลอกแผนสำเร็จ ' + created + ' รายการ' + (skipped ? ' (ข้ามรายการซ้ำ ' + skipped + ')' : ''));
    });
  } catch (e) {
    return err_('ไม่สามารถคัดลอกแผนได้: ' + e.message);
  }
}

/* ═══════════════ AUTO INGREDIENT CALCULATION (Core) ═══════════════ */

/**
 * คำนวณวัตถุดิบที่ต้องใช้จาก Menu Plan
 * filters: { date, date_to?, location_id?, meal_period? }
 * รวมวัตถุดิบซ้ำเป็นรายการเดียว + เทียบ Stock + Zero Recipe Handling
 */
function calculateIngredientRequirement(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  try {
    return ok_('คำนวณวัตถุดิบสำเร็จ', calcRequirement_(filters || {}));
  } catch (e) {
    return err_('ไม่สามารถคำนวณวัตถุดิบได้: ' + e.message);
  }
}

function calcRequirement_(filters) {
  var date = s_(filters.date) || today_();
  var dateTo = s_(filters.date_to) || date;
  var locId = s_(filters.location_id);
  var meal = s_(filters.meal_period);

  var plans = readAll_('MenuPlans').filter(function(p) {
    if (p.status === 'cancelled') return false;
    var d = s_(p.plan_date);
    if (d < date || d > dateTo) return false;
    if (locId && p.location_id !== locId) return false;
    if (meal && s_(p.meal_period) !== meal) return false;
    return true;
  });

  var recipes = readAll_('Recipes').filter(function(r) { return r.status === 'active'; });
  var byMenu = {};
  recipes.forEach(function(r) {
    (byMenu[r.menu_id] = byMenu[r.menu_id] || []).push(r);
  });

  var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');
  var balances = readAll_('StockBalances');
  var stockOf = {};
  balances.forEach(function(b) {
    if (locId && b.location_id !== locId) return;
    var st = stockOf[b.ingredient_id] = stockOf[b.ingredient_id] || { current: 0, available: 0 };
    st.current += num_(b.current_balance);
    st.available += num_(b.available_balance);
  });

  var agg = {}; // ingredient_id -> รวมความต้องการ
  var menusOut = [], menusNoRecipe = [];

  plans.forEach(function(p) {
    var lines = byMenu[p.menu_id] || [];
    var menuInfo = {
      plan_id: p.plan_id, plan_date: p.plan_date, menu_id: p.menu_id, menu_name: p.menu_name,
      meal_period: p.meal_period, location_id: p.location_id, location_name: p.location_name,
      planned_quantity: num_(p.planned_quantity), has_recipe: lines.length > 0
    };
    menusOut.push(menuInfo);
    if (!lines.length) { menusNoRecipe.push(menuInfo); return; } // Zero Recipe Handling: ห้าม Error

    lines.forEach(function(r) {
      var batch = num_(r.batch_size) || 1;
      var factor = num_(p.batch_multiplier) || 0;
      if (!factor) factor = num_(p.planned_quantity) > 0 ? num_(p.planned_quantity) / batch : 1;
      var qty = num_(r.quantity) * factor * (1 + num_(r.waste_percent) / 100);
      var a = agg[r.ingredient_id];
      if (!a) {
        var g = ingIdx[r.ingredient_id] || {};
        a = agg[r.ingredient_id] = {
          ingredient_id: r.ingredient_id,
          ingredient_name: g.ingredient_name || r.ingredient_name,
          unit: r.unit || g.default_unit || '',
          category_name: g.category_name || '',
          required_quantity: 0,
          unit_price: num_(g.last_price),
          min_stock: num_(g.min_stock), safety_stock: num_(g.safety_stock),
          preferred_vendor_id: g.preferred_vendor_id || '', preferred_vendor_name: g.preferred_vendor_name || '',
          menus: []
        };
      }
      a.required_quantity += qty;
      a.menus.push({ menu_name: p.menu_name, quantity: round_(qty) });
    });
  });

  var items = Object.keys(agg).map(function(id) {
    var a = agg[id];
    var st = stockOf[id] || { current: 0, available: 0 };
    a.required_quantity = round_(a.required_quantity);
    a.current_stock = round_(st.current);
    a.available_stock = round_(st.available);
    a.recommended_quantity = a.required_quantity;
    a.shortage = round_(Math.max(0, a.required_quantity - st.available));
    a.estimated_cost = round_(a.required_quantity * a.unit_price, 2);
    a.status = a.shortage > 0 ? 'shortage' : 'ok';
    return a;
  });
  items.sort(function(x, y) { return (y.shortage - x.shortage) || x.ingredient_name.localeCompare(y.ingredient_name, 'th'); });

  return {
    date: date, date_to: dateTo, location_id: locId, meal_period: meal,
    items: items, menus: menusOut, menus_no_recipe: menusNoRecipe,
    total_estimated_cost: round_(items.reduce(function(sum, i) { return sum + i.estimated_cost; }, 0), 2)
  };
}
