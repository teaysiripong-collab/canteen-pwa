/***************************************************************
 * Master.gs — Master Data: Categories / Vendors / Locations /
 *             Ingredients / Menus
 * Master Data ใช้ Soft Delete (status = inactive) เท่านั้น
 ***************************************************************/

/* ═══════════════ CATEGORIES ═══════════════ */

function listCategories(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  return ok_('โหลดหมวดหมู่สำเร็จ', readAll_('Categories'));
}

function saveCategory(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var name = s_(payload.category_name);
      if (!name) return err_('กรุณากรอกชื่อหมวดหมู่');
      var now = nowTs_();
      if (payload.category_id) {
        var old = findBy_('Categories', 'category_id', payload.category_id);
        if (!old) return err_('ไม่พบหมวดหมู่นี้');
        var patch = { category_name: name, description: s_(payload.description),
          status: payload.status === 'inactive' ? 'inactive' : 'active' };
        updateRow_('Categories', 'category_id', payload.category_id, patch);
        // sync ชื่อหมวดใน Ingredients
        if (old.category_name !== name) {
          readAll_('Ingredients').forEach(function(g) {
            if (g.category_id === payload.category_id) {
              updateRow_('Ingredients', 'ingredient_id', g.ingredient_id, { category_name: name });
            }
          });
        }
        audit_(auth.user, 'EDIT', 'Categories', payload.category_id, old, patch);
        return ok_('บันทึกหมวดหมู่สำเร็จ');
      }
      var row = { category_id: generateId_('CAT'), category_name: name,
        description: s_(payload.description), status: 'active', created_at: now };
      appendRow_('Categories', row);
      audit_(auth.user, 'CREATE', 'Categories', row.category_id, null, row);
      return ok_('เพิ่มหมวดหมู่สำเร็จ', row);
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกหมวดหมู่ได้: ' + e.message);
  }
}

/* ═══════════════ VENDORS ═══════════════ */

function listVendors(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  return ok_('โหลดผู้ขายสำเร็จ', readAll_('Vendors'));
}

function saveVendor(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var name = s_(payload.vendor_name);
      if (!name) return err_('กรุณากรอกชื่อผู้ขาย');
      var now = nowTs_();
      if (payload.vendor_id) {
        var old = findBy_('Vendors', 'vendor_id', payload.vendor_id);
        if (!old) return err_('ไม่พบผู้ขายนี้');
        var patch = { vendor_code: s_(payload.vendor_code), vendor_name: name,
          contact_name: s_(payload.contact_name), phone: s_(payload.phone),
          note: s_(payload.note), status: payload.status === 'inactive' ? 'inactive' : 'active' };
        updateRow_('Vendors', 'vendor_id', payload.vendor_id, patch);
        if (old.vendor_name !== name) {
          readAll_('Ingredients').forEach(function(g) {
            if (g.preferred_vendor_id === payload.vendor_id) {
              updateRow_('Ingredients', 'ingredient_id', g.ingredient_id, { preferred_vendor_name: name });
            }
          });
        }
        audit_(auth.user, 'EDIT', 'Vendors', payload.vendor_id, old, patch);
        return ok_('บันทึกผู้ขายสำเร็จ');
      }
      var row = { vendor_id: generateId_('VEN'), vendor_code: s_(payload.vendor_code),
        vendor_name: name, contact_name: s_(payload.contact_name), phone: s_(payload.phone),
        note: s_(payload.note), status: 'active', created_at: now };
      appendRow_('Vendors', row);
      audit_(auth.user, 'CREATE', 'Vendors', row.vendor_id, null, row);
      return ok_('เพิ่มผู้ขายสำเร็จ', row);
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกผู้ขายได้: ' + e.message);
  }
}

/* ═══════════════ LOCATIONS ═══════════════ */

function listLocations(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  return ok_('โหลดคลังสำเร็จ', readAll_('Locations'));
}

function saveLocation(token, payload) {
  var auth = requireAuth_(token, ['Admin']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var code = s_(payload.location_code);
      var name = s_(payload.location_name);
      if (!code || !name) return err_('กรุณากรอกรหัสและชื่อคลัง');
      if (payload.location_id) {
        var old = findBy_('Locations', 'location_id', payload.location_id);
        if (!old) return err_('ไม่พบคลังนี้');
        var patch = { location_code: code, location_name: name,
          status: payload.status === 'inactive' ? 'inactive' : 'active' };
        updateRow_('Locations', 'location_id', payload.location_id, patch);
        audit_(auth.user, 'EDIT', 'Locations', payload.location_id, old, patch);
        return ok_('บันทึกคลังสำเร็จ');
      }
      var dup = readAll_('Locations').filter(function(l) { return s_(l.location_code) === code; });
      if (dup.length) return err_('รหัสคลังนี้มีอยู่แล้ว');
      var row = { location_id: generateId_('LOC'), location_code: code, location_name: name,
        status: 'active', created_at: nowTs_() };
      appendRow_('Locations', row);
      audit_(auth.user, 'CREATE', 'Locations', row.location_id, null, row);
      return ok_('เพิ่มคลังสำเร็จ', row);
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกคลังได้: ' + e.message);
  }
}

/* ═══════════════ INGREDIENTS ═══════════════ */

function listIngredients(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  return ok_('โหลดวัตถุดิบสำเร็จ', readAll_('Ingredients'));
}

function saveIngredient(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var name = s_(payload.ingredient_name);
      if (!name) return err_('กรุณากรอกชื่อวัตถุดิบ');
      if (!s_(payload.default_unit)) return err_('กรุณาระบุหน่วยใช้งาน');
      var now = nowTs_();
      var cat = findBy_('Categories', 'category_id', s_(payload.category_id));
      var ven = s_(payload.preferred_vendor_id) ? findBy_('Vendors', 'vendor_id', s_(payload.preferred_vendor_id)) : null;
      var fields = {
        ingredient_name: name,
        category_id: cat ? cat.category_id : '',
        category_name: cat ? cat.category_name : '',
        default_unit: s_(payload.default_unit),
        purchase_unit: s_(payload.purchase_unit) || s_(payload.default_unit),
        conversion_rate: num_(payload.conversion_rate) || 1,
        preferred_vendor_id: ven ? ven.vendor_id : '',
        preferred_vendor_name: ven ? ven.vendor_name : '',
        min_stock: round_(payload.min_stock),
        safety_stock: round_(payload.safety_stock),
        note: s_(payload.note),
        updated_at: now
      };
      if (payload.last_price !== undefined) fields.last_price = round_(payload.last_price, 2);

      if (payload.ingredient_id) {
        var old = findBy_('Ingredients', 'ingredient_id', payload.ingredient_id);
        if (!old) return err_('ไม่พบวัตถุดิบนี้');
        fields.status = payload.status === 'inactive' ? 'inactive' : 'active';
        updateRow_('Ingredients', 'ingredient_id', payload.ingredient_id, fields);
        // sync ชื่อ/min_stock ใน StockBalances
        readAll_('StockBalances').forEach(function(b) {
          if (b.ingredient_id === payload.ingredient_id) {
            updateRow_('StockBalances', 'stock_id', b.stock_id,
              { ingredient_name: name, min_stock: fields.min_stock });
          }
        });
        audit_(auth.user, 'EDIT', 'Ingredients', payload.ingredient_id, old, fields);
        return ok_('บันทึกวัตถุดิบสำเร็จ');
      }

      var code = s_(payload.ingredient_code);
      if (!code) {
        var maxN = 0;
        readAll_('Ingredients').forEach(function(g) {
          var m = /^IG(\d+)$/.exec(s_(g.ingredient_code));
          if (m && parseInt(m[1], 10) > maxN) maxN = parseInt(m[1], 10);
        });
        code = 'IG' + ('000' + (maxN + 1)).slice(-3);
      }
      var row = { ingredient_id: generateId_('ING'), ingredient_code: code,
        last_price: round_(payload.last_price, 2), average_price: round_(payload.last_price, 2),
        status: 'active', created_at: now };
      Object.keys(fields).forEach(function(k) { row[k] = fields[k]; });
      appendRow_('Ingredients', row);
      audit_(auth.user, 'CREATE', 'Ingredients', row.ingredient_id, null, row);
      return ok_('เพิ่มวัตถุดิบสำเร็จ', row);
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกวัตถุดิบได้: ' + e.message);
  }
}

/* ═══════════════ MENUS ═══════════════ */

function listMenus(token) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  var menus = readAll_('Menus');
  var recipes = readAll_('Recipes');
  var hasRecipe = {};
  recipes.forEach(function(r) { if (r.status === 'active') hasRecipe[r.menu_id] = true; });
  menus.forEach(function(m) { m.has_recipe = !!hasRecipe[m.menu_id]; });
  return ok_('โหลดเมนูสำเร็จ', menus);
}

function saveMenu(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var name = s_(payload.menu_name);
      if (!name) return err_('กรุณากรอกชื่อเมนู');
      var now = nowTs_();
      var fields = {
        menu_name: name,
        menu_category: s_(payload.menu_category),
        meal_period: s_(payload.meal_period),
        default_batch_size: num_(payload.default_batch_size) || 100,
        note: s_(payload.note),
        updated_at: now
      };
      if (payload.menu_id) {
        var old = findBy_('Menus', 'menu_id', payload.menu_id);
        if (!old) return err_('ไม่พบเมนูนี้');
        fields.status = payload.status === 'inactive' ? 'inactive' : 'active';
        updateRow_('Menus', 'menu_id', payload.menu_id, fields);
        if (old.menu_name !== name) {
          readAll_('Recipes').forEach(function(r) {
            if (r.menu_id === payload.menu_id) updateRow_('Recipes', 'recipe_id', r.recipe_id, { menu_name: name });
          });
        }
        audit_(auth.user, 'EDIT', 'Menus', payload.menu_id, old, fields);
        return ok_('บันทึกเมนูสำเร็จ');
      }
      var code = s_(payload.menu_code);
      if (!code) {
        var maxN = 0;
        readAll_('Menus').forEach(function(m) {
          var mm = /^MN(\d+)$/.exec(s_(m.menu_code));
          if (mm && parseInt(mm[1], 10) > maxN) maxN = parseInt(mm[1], 10);
        });
        code = 'MN' + ('000' + (maxN + 1)).slice(-3);
      }
      var row = { menu_id: generateId_('MNU'), menu_code: code, status: 'active', created_at: now };
      Object.keys(fields).forEach(function(k) { row[k] = fields[k]; });
      appendRow_('Menus', row);
      audit_(auth.user, 'CREATE', 'Menus', row.menu_id, null, row);
      return ok_('เพิ่มเมนูสำเร็จ', row);
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกเมนูได้: ' + e.message);
  }
}
