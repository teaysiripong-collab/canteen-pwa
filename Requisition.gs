/***************************************************************
 * Requisition.gs — ใบเบิกวัตถุดิบ + Approval Workflow + Issue Stock
 *
 * Workflow: draft → pending → approved → issued
 *                          ↘ rejected / cancelled
 * แยก field ชัดเจน: recipe_quantity / recommended / requested /
 * approved / actual (issued) ห้ามใช้ field เดียวแทนกัน
 ***************************************************************/

function listRequisitions(token, filters) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  filters = filters || {};
  var rows = readAll_('Requisitions').filter(function(r) {
    if (s_(filters.date_from) && s_(r.requisition_date) < s_(filters.date_from)) return false;
    if (s_(filters.date_to) && s_(r.requisition_date) > s_(filters.date_to)) return false;
    if (s_(filters.status) && r.status !== s_(filters.status)) return false;
    if (s_(filters.location_id) && r.location_id !== s_(filters.location_id)) return false;
    if (filters.mine_only && r.requested_by !== auth.user.username) return false;
    return true;
  });
  // Role User เห็นเฉพาะใบเบิกของตัวเอง + ใบที่เกี่ยวข้อง
  if (auth.user.role === 'User') {
    rows = rows.filter(function(r) { return r.requested_by === auth.user.username; });
  }
  rows.sort(function(a, b) { return s_(b.created_at).localeCompare(s_(a.created_at)); });
  return ok_('โหลดใบเบิกสำเร็จ', rows);
}

function getRequisition(token, requisitionId) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  var req = findBy_('Requisitions', 'requisition_id', s_(requisitionId));
  if (!req) return err_('ไม่พบใบเบิกนี้');
  var items = readAll_('RequisitionItems').filter(function(i) {
    return i.requisition_id === req.requisition_id;
  });
  // แนบ Stock ปัจจุบันเพื่อแสดงบนหน้าจอ
  var balances = readAll_('StockBalances');
  var stockOf = {};
  balances.forEach(function(b) {
    if (b.location_id === req.location_id) stockOf[b.ingredient_id] = num_(b.available_balance);
  });
  items.forEach(function(i) {
    i.current_available = round_(stockOf[i.ingredient_id] || 0);
  });
  return ok_('โหลดใบเบิกสำเร็จ', { requisition: req, items: items });
}

/**
 * สร้าง Draft ใบเบิกอัตโนมัติจาก Menu Plan (Core Workflow STEP 4)
 * payload: { date, location_id, meal_period }
 */
function createDraftRequisitionFromPlan(token, payload) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  if (auth.user.role === 'Viewer') return err_('คุณไม่มีสิทธิ์สร้างใบเบิก', 'FORBIDDEN');
  try {
    return withLock_(function() {
      payload = payload || {};
      var date = s_(payload.date) || today_();
      var locId = s_(payload.location_id);
      var loc = locId ? findBy_('Locations', 'location_id', locId) : null;
      if (!loc) return err_('กรุณาเลือก Location');

      var calc = calcRequirement_({ date: date, location_id: locId, meal_period: s_(payload.meal_period) });
      if (!calc.menus.length) return err_('ไม่พบแผนเมนูของวันที่ ' + date + ' ที่ ' + loc.location_code);
      if (!calc.items.length) {
        return err_('เมนูในแผนวันนี้ยังไม่มีสูตรอาหารเลย กรุณากำหนดสูตรก่อน (⚠️ ' +
          calc.menus_no_recipe.map(function(m) { return m.menu_name; }).join(', ') + ')');
      }

      var reqNo = docNo_('REQ', 'Requisitions', 'requisition_no');
      var now = nowTs_();
      var req = {
        requisition_id: generateId_('REQ'), requisition_no: reqNo, requisition_date: date,
        location_id: loc.location_id, location_name: loc.location_name,
        meal_period: s_(payload.meal_period) || 'ทั้งวัน', status: 'draft',
        requested_by: auth.user.username, approved_by: '', approved_date: '',
        note: 'สร้างอัตโนมัติจากแผนเมนู: ' + calc.menus.map(function(m) { return m.menu_name; }).join(', '),
        created_at: now
      };
      appendRow_('Requisitions', req);

      appendRows_('RequisitionItems', calc.items.map(function(it) {
        return {
          requisition_item_id: generateId_('RQI'), requisition_id: req.requisition_id,
          requisition_no: reqNo, ingredient_id: it.ingredient_id, ingredient_name: it.ingredient_name,
          unit: it.unit, recipe_quantity: it.required_quantity,
          recommended_quantity: it.recommended_quantity, requested_quantity: it.recommended_quantity,
          approved_quantity: '', actual_quantity: '', stock_before: it.available_stock, stock_after: '',
          unit_price: it.unit_price, total_amount: round_(it.recommended_quantity * it.unit_price, 2),
          variance_quantity: '', note: it.shortage > 0 ? '🔴 ขาด ' + it.shortage + ' ' + it.unit : ''
        };
      }));

      audit_(auth.user, 'CREATE', 'Requisitions', reqNo, null,
        { from_plan: date, location: loc.location_code, items: calc.items.length });
      var res = getRequisition(token, req.requisition_id);
      res.message = 'สร้าง Draft ใบเบิก ' + reqNo + ' จากแผนเมนูสำเร็จ (' + calc.items.length + ' รายการ)';
      if (calc.menus_no_recipe.length) {
        res.message += ' — ⚠️ เมนูไม่มีสูตร: ' + calc.menus_no_recipe.map(function(m) { return m.menu_name; }).join(', ');
      }
      return res;
    });
  } catch (e) {
    return err_('ไม่สามารถสร้าง Draft ใบเบิกได้: ' + e.message);
  }
}

/**
 * สร้าง/บันทึกใบเบิก (Manual หรือแก้ Draft) + Submit
 * payload: { requisition_id?, requisition_date, location_id, meal_period, note, submit,
 *            items:[{ingredient_id, requested_quantity, note}] }
 */
function createRequisition(token, payload) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  if (auth.user.role === 'Viewer') return err_('คุณไม่มีสิทธิ์สร้างใบเบิก', 'FORBIDDEN');
  try {
    return withLock_(function() {
      payload = payload || {};
      var now = nowTs_();
      var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');
      var items = (payload.items || []).filter(function(it) {
        return s_(it.ingredient_id) && num_(it.requested_quantity) > 0;
      });
      if (!items.length) return err_('กรุณาระบุจำนวนเบิกอย่างน้อย 1 รายการ');
      var newStatus = payload.submit ? 'pending' : 'draft';

      // ── แก้ไข Draft เดิม ──
      if (s_(payload.requisition_id)) {
        var req = findBy_('Requisitions', 'requisition_id', s_(payload.requisition_id));
        if (!req) return err_('ไม่พบใบเบิกนี้');
        if (req.status !== 'draft' && req.status !== 'pending') {
          return err_('ใบเบิกนี้อยู่ในสถานะ ' + req.status + ' ไม่สามารถแก้ไขได้');
        }
        if (auth.user.role === 'User' && req.requested_by !== auth.user.username) {
          return err_('คุณแก้ไขได้เฉพาะใบเบิกของตัวเอง', 'FORBIDDEN');
        }
        var oldItems = readAll_('RequisitionItems').filter(function(i) { return i.requisition_id === req.requisition_id; });
        var oldIdx = indexBy_(oldItems, 'ingredient_id');
        items.forEach(function(it) {
          var g = ingIdx[s_(it.ingredient_id)];
          if (!g) return;
          var qty = round_(it.requested_quantity);
          var existing = oldIdx[g.ingredient_id];
          if (existing) {
            updateRow_('RequisitionItems', 'requisition_item_id', existing.requisition_item_id, {
              requested_quantity: qty, total_amount: round_(qty * num_(g.last_price), 2),
              note: it.note !== undefined ? s_(it.note) : existing.note
            });
            delete oldIdx[g.ingredient_id];
          } else {
            appendRow_('RequisitionItems', newReqItem_(req, g, qty, s_(it.note)));
          }
        });
        // รายการที่ถูกเอาออก (requested = 0 หรือไม่ได้ส่งมา) → ลบออกจากใบ (ยัง draft อยู่จึงลบได้อย่างปลอดภัยด้วยการตั้ง 0)
        Object.keys(oldIdx).forEach(function(iid) {
          updateRow_('RequisitionItems', 'requisition_item_id', oldIdx[iid].requisition_item_id,
            { requested_quantity: 0, total_amount: 0, note: 'ตัดออกจากใบเบิก' });
        });
        updateRow_('Requisitions', 'requisition_id', req.requisition_id, {
          status: newStatus, note: payload.note !== undefined ? s_(payload.note) : req.note,
          meal_period: s_(payload.meal_period) || req.meal_period
        });
        audit_(auth.user, payload.submit ? 'SUBMIT' : 'EDIT', 'Requisitions', req.requisition_no, null, { items: items.length });
        return ok_(payload.submit ? '✅ ส่งใบเบิก ' + req.requisition_no + ' รออนุมัติแล้ว' : 'บันทึก Draft สำเร็จ',
          { requisition_id: req.requisition_id, requisition_no: req.requisition_no });
      }

      // ── สร้างใหม่ Manual ──
      var loc = findBy_('Locations', 'location_id', s_(payload.location_id));
      if (!loc) return err_('กรุณาเลือก Location');
      var reqNo = docNo_('REQ', 'Requisitions', 'requisition_no');
      var reqNew = {
        requisition_id: generateId_('REQ'), requisition_no: reqNo,
        requisition_date: s_(payload.requisition_date) || today_(),
        location_id: loc.location_id, location_name: loc.location_name,
        meal_period: s_(payload.meal_period) || 'ทั้งวัน', status: newStatus,
        requested_by: auth.user.username, approved_by: '', approved_date: '',
        note: s_(payload.note), created_at: now
      };
      appendRow_('Requisitions', reqNew);
      var stockOf = {};
      readAll_('StockBalances').forEach(function(b) {
        if (b.location_id === loc.location_id) stockOf[b.ingredient_id] = num_(b.available_balance);
      });
      appendRows_('RequisitionItems', items.map(function(it) {
        var g = ingIdx[s_(it.ingredient_id)];
        return newReqItem_(reqNew, g, round_(it.requested_quantity), s_(it.note), stockOf[g.ingredient_id]);
      }));
      audit_(auth.user, 'CREATE', 'Requisitions', reqNo, null, { items: items.length, status: newStatus });
      return ok_(payload.submit ? '✅ สร้างและส่งใบเบิก ' + reqNo + ' รออนุมัติแล้ว' : 'สร้าง Draft ใบเบิก ' + reqNo + ' สำเร็จ',
        { requisition_id: reqNew.requisition_id, requisition_no: reqNo });
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกใบเบิกได้: ' + e.message);
  }
}

function newReqItem_(req, g, qty, note, stockBefore) {
  return {
    requisition_item_id: generateId_('RQI'), requisition_id: req.requisition_id,
    requisition_no: req.requisition_no, ingredient_id: g.ingredient_id,
    ingredient_name: g.ingredient_name, unit: g.default_unit,
    recipe_quantity: 0, recommended_quantity: 0, requested_quantity: qty,
    approved_quantity: '', actual_quantity: '',
    stock_before: stockBefore !== undefined ? round_(stockBefore) : '', stock_after: '',
    unit_price: num_(g.last_price), total_amount: round_(qty * num_(g.last_price), 2),
    variance_quantity: '', note: note || ''
  };
}

/**
 * อนุมัติใบเบิก (Supervisor/Admin) — จอง Stock (reserved) ตามจำนวนอนุมัติ
 * payload: { requisition_id, items:[{requisition_item_id, approved_quantity}], note }
 */
function approveRequisition(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var req = findBy_('Requisitions', 'requisition_id', s_(payload.requisition_id));
      if (!req) return err_('ไม่พบใบเบิกนี้');
      if (req.status !== 'pending') return err_('ใบเบิกนี้อยู่ในสถานะ ' + req.status + ' ไม่สามารถอนุมัติได้');

      var items = readAll_('RequisitionItems').filter(function(i) { return i.requisition_id === req.requisition_id; });
      var apprIdx = {};
      (payload.items || []).forEach(function(it) { apprIdx[s_(it.requisition_item_id)] = num_(it.approved_quantity); });

      items.forEach(function(i) {
        var appr = apprIdx[i.requisition_item_id] !== undefined
          ? round_(apprIdx[i.requisition_item_id]) : round_(i.requested_quantity);
        if (appr < 0) appr = 0;
        updateRow_('RequisitionItems', 'requisition_item_id', i.requisition_item_id, {
          approved_quantity: appr, total_amount: round_(appr * num_(i.unit_price), 2)
        });
        if (appr > 0) adjustStock_(req.location_id, i.ingredient_id, 0, appr); // จอง Stock
      });
      updateRow_('Requisitions', 'requisition_id', req.requisition_id, {
        status: 'approved', approved_by: auth.user.username, approved_date: nowTs_(),
        note: s_(payload.note) ? req.note + ' | อนุมัติ: ' + s_(payload.note) : req.note
      });
      audit_(auth.user, 'APPROVE', 'Requisitions', req.requisition_no, { status: 'pending' }, { status: 'approved' });
      return ok_('✅ อนุมัติใบเบิก ' + req.requisition_no + ' สำเร็จ');
    });
  } catch (e) {
    return err_('ไม่สามารถอนุมัติใบเบิกได้: ' + e.message);
  }
}

/** ปฏิเสธใบเบิก — บังคับใส่เหตุผล */
function rejectRequisition(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var reason = s_(payload.reason);
      if (!reason) return err_('กรุณาระบุเหตุผลที่ปฏิเสธ');
      var req = findBy_('Requisitions', 'requisition_id', s_(payload.requisition_id));
      if (!req) return err_('ไม่พบใบเบิกนี้');
      if (req.status !== 'pending' && req.status !== 'approved') {
        return err_('ใบเบิกนี้อยู่ในสถานะ ' + req.status + ' ไม่สามารถปฏิเสธได้');
      }
      // ถ้าเคยอนุมัติแล้ว ต้องปล่อย Stock ที่จองไว้
      if (req.status === 'approved') {
        readAll_('RequisitionItems').forEach(function(i) {
          if (i.requisition_id === req.requisition_id && num_(i.approved_quantity) > 0) {
            adjustStock_(req.location_id, i.ingredient_id, 0, -num_(i.approved_quantity));
          }
        });
      }
      updateRow_('Requisitions', 'requisition_id', req.requisition_id, {
        status: 'rejected', approved_by: auth.user.username, approved_date: nowTs_(),
        note: req.note + ' | ❌ ปฏิเสธ: ' + reason
      });
      audit_(auth.user, 'REJECT', 'Requisitions', req.requisition_no, { status: req.status }, { status: 'rejected', reason: reason });
      return ok_('ปฏิเสธใบเบิก ' + req.requisition_no + ' แล้ว');
    });
  } catch (e) {
    return err_('ไม่สามารถปฏิเสธใบเบิกได้: ' + e.message);
  }
}

/** ยกเลิกใบเบิก (draft/pending โดยเจ้าของ หรือ Admin) */
function cancelRequisition(token, payload) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var req = findBy_('Requisitions', 'requisition_id', s_(payload.requisition_id));
      if (!req) return err_('ไม่พบใบเบิกนี้');
      if (req.status !== 'draft' && req.status !== 'pending') {
        return err_('ยกเลิกได้เฉพาะใบเบิกสถานะ draft หรือ pending');
      }
      if (auth.user.role !== 'Admin' && auth.user.role !== 'Supervisor' && req.requested_by !== auth.user.username) {
        return err_('คุณยกเลิกได้เฉพาะใบเบิกของตัวเอง', 'FORBIDDEN');
      }
      updateRow_('Requisitions', 'requisition_id', req.requisition_id, { status: 'cancelled' });
      audit_(auth.user, 'DELETE', 'Requisitions', req.requisition_no, { status: req.status }, { status: 'cancelled' });
      return ok_('ยกเลิกใบเบิก ' + req.requisition_no + ' แล้ว');
    });
  } catch (e) {
    return err_('ไม่สามารถยกเลิกใบเบิกได้: ' + e.message);
  }
}

/**
 * จ่ายวัตถุดิบตามใบเบิกที่อนุมัติแล้ว (ตัด Stock จริง)
 * ตรวจ Stock อีกครั้งก่อนตัด — ห้ามติดลบโดยไม่แจ้งเตือน
 * payload: { requisition_id, allow_negative }
 */
function issueRequisition(token, payload) {
  var auth = requireAuth_(token, ['Admin', 'Supervisor']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var req = findBy_('Requisitions', 'requisition_id', s_(payload.requisition_id));
      if (!req) return err_('ไม่พบใบเบิกนี้');
      if (req.status !== 'approved') return err_('ต้องอนุมัติใบเบิกก่อนจึงจะจ่ายของได้');

      var items = readAll_('RequisitionItems').filter(function(i) {
        return i.requisition_id === req.requisition_id && num_(i.approved_quantity) > 0;
      });
      if (!items.length) return err_('ใบเบิกนี้ไม่มีรายการที่อนุมัติจำนวนมากกว่า 0');

      // ตรวจ Stock ก่อนตัด (current - reserved อื่น + ที่จองของใบนี้เอง)
      var shortages = [];
      items.forEach(function(i) {
        var bal = findBy_('StockBalances', 'stock_id', req.location_id + '_' + i.ingredient_id);
        var current = bal ? num_(bal.current_balance) : 0;
        if (num_(i.approved_quantity) > current) {
          shortages.push('🔴 ' + i.ingredient_name + ' ต้องจ่าย ' + i.approved_quantity + ' แต่คงเหลือ ' + current + ' ' + i.unit);
        }
      });
      if (shortages.length && !payload.allow_negative) {
        return err_('⚠️ Stock ไม่เพียงพอ:\n' + shortages.join('\n'), 'INSUFFICIENT_STOCK');
      }

      var issueNo = docNo_('ISSUE', 'StockTransactions', 'transaction_no');
      var ingIdx = indexBy_(readAll_('Ingredients'), 'ingredient_id');
      var total = 0;
      items.forEach(function(i) {
        var qty = num_(i.approved_quantity);
        var g = ingIdx[i.ingredient_id] || {};
        var price = num_(i.unit_price) || num_(g.last_price);
        // ตัดจริง + ปล่อยจำนวนที่จองไว้ตอนอนุมัติ
        var mv = adjustStock_(req.location_id, i.ingredient_id, -qty, -qty);
        updateRow_('RequisitionItems', 'requisition_item_id', i.requisition_item_id, {
          actual_quantity: qty, stock_before: mv.before, stock_after: mv.after,
          unit_price: price, total_amount: round_(qty * price, 2),
          variance_quantity: round_(qty - num_(i.recipe_quantity))
        });
        logTxn_({
          transaction_no: issueNo, transaction_type: 'ISSUE', transaction_date: today_(),
          location_id: req.location_id, location_name: req.location_name,
          ingredient_id: i.ingredient_id, ingredient_name: i.ingredient_name,
          quantity: -qty, unit: i.unit, unit_price: price,
          balance_before: mv.before, balance_after: mv.after,
          reference_type: 'REQUISITION', reference_id: req.requisition_id, reference_no: req.requisition_no,
          created_by: auth.user.username, note: 'จ่ายตามใบเบิก ' + req.requisition_no
        });
        total += qty * price;
      });
      updateRow_('Requisitions', 'requisition_id', req.requisition_id, { status: 'issued' });
      audit_(auth.user, 'ISSUE', 'Requisitions', req.requisition_no,
        { status: 'approved' }, { status: 'issued', issue_no: issueNo, total: round_(total, 2) });
      return ok_('✅ จ่ายวัตถุดิบตามใบเบิก ' + req.requisition_no + ' สำเร็จ (เลขที่จ่าย ' + issueNo + ')',
        { issue_no: issueNo, total_amount: round_(total, 2) });
    });
  } catch (e) {
    return err_('ไม่สามารถจ่ายวัตถุดิบได้: ' + e.message);
  }
}

/** Duplicate ใบเบิก (สร้างเลขเอกสารใหม่ สถานะ draft) */
function duplicateRequisition(token, requisitionId) {
  var auth = requireAuth_(token);
  if (!auth.ok) return auth.res;
  if (auth.user.role === 'Viewer') return err_('คุณไม่มีสิทธิ์สร้างใบเบิก', 'FORBIDDEN');
  var src = getRequisition(token, requisitionId);
  if (!src.success) return src;
  return createRequisition(token, {
    requisition_date: today_(),
    location_id: src.data.requisition.location_id,
    meal_period: src.data.requisition.meal_period,
    note: 'คัดลอกจาก ' + src.data.requisition.requisition_no,
    items: src.data.items.filter(function(i) { return num_(i.requested_quantity) > 0; }).map(function(i) {
      return { ingredient_id: i.ingredient_id, requested_quantity: i.requested_quantity };
    })
  });
}
