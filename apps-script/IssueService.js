/**
 * Canteen Smart Stock — IssueService.js
 * Bulk Issue: เบิกหลายรายการใน transaction เดียว ตัด Lot แบบ FEFO
 *
 * กติกา (spec ข้อ 12, 13, 47, 53):
 * - FEFO: Lot หมดอายุก่อนถูกตัดก่อน
 * - Expired lot ห้าม Issue
 * - Stock ห้ามติดลบ — validate ก่อน lock แล้ว validate ซ้ำหลัง lock
 * - Atomic: เตรียมข้อมูลทั้งหมดให้ผ่านก่อน แล้วค่อยเขียนทุกตาราง
 */

/**
 * API: บันทึกเบิกสินค้าทั้งชุด
 * payload = {
 *   employeeId, fromLocation, toLocation, remark, device,
 *   rows: [{ itemId, qty }]
 * }
 */
function apiSaveIssue(payload) {
  return apiResult_(function () { return saveIssue_(payload); });
}

function saveIssue_(payload) {
  if (!payload) throw new Error('ไม่มีข้อมูล');

  // ---- 1) Validate Employee ----
  var employee = validateEmployee_(payload.employeeId);

  // ---- 2) Validate Header ----
  if (!payload.toLocation) throw new Error('กรุณาระบุจุดใช้งาน (To Location)');
  var rows = payload.rows || [];
  if (!rows.length) throw new Error('ไม่มีรายการสินค้า');
  if (rows.length > CFG.MAX_BULK_ROWS) throw new Error('รายการเกิน ' + CFG.MAX_BULK_ROWS + ' แถว');

  var itemMap = {};
  readAllCached_('ITEM_MASTER').forEach(function (it) { itemMap[it.Item_ID] = it; });

  // ---- 3) Validate All Rows (รอบแรก ก่อน lock) ----
  var errors = [];
  rows.forEach(function (r, i) {
    var item = itemMap[r.itemId];
    if (!item) { errors.push({ line: i + 1, message: 'ไม่พบสินค้าในระบบ' }); return; }
    if (num_(r.qty) <= 0) errors.push({ line: i + 1, message: 'จำนวนเบิกต้องมากกว่า 0' });
  });
  if (errors.length) throw new Error(JSON.stringify({ validation: errors }));

  // ---- 4) Acquire Lock → validate stock ซ้ำ → process ----
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_TIMEOUT_MS)) {
    throw new Error('ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
  }
  try {
    // รวมยอดเบิกต่อ item (เผื่อ item เดิมหลายแถว) แล้วตรวจ FEFO ทั้งหมดก่อนเขียนอะไรลง Sheet
    var totalByItem = {};
    rows.forEach(function (r) {
      totalByItem[r.itemId] = round4_((totalByItem[r.itemId] || 0) + num_(r.qty));
    });

    // จัดสรร FEFO ต่อ item (ยอดรวม) — ถ้าไม่พอ ให้ fail ทั้งชุดก่อนเขียน
    var allocationByItem = {};
    Object.keys(totalByItem).forEach(function (itemId) {
      var item = itemMap[itemId];
      var result = allocateFefo_(itemId, totalByItem[itemId]);
      if (result.shortage > 0) {
        var msg = 'Stock ไม่พอ: ' + item.Item_Name + ' ขาด ' + result.shortage + ' ' + item.Main_Unit;
        if (result.expiredQty > 0) {
          msg += ' (มีของหมดอายุค้าง ' + result.expiredQty + ' ' + item.Main_Unit + ' ซึ่งเบิกไม่ได้ — กรุณาบันทึกเป็นของเสีย)';
        }
        throw new Error(msg);
      }
      allocationByItem[itemId] = result.allocations; // [{lot, qty}]
    });

    var issueId = uuid_();
    var issueNo = nextDocNumber_(CFG.DOC_PREFIX.ISSUE);
    var ts = timestampStr_();
    var date = todayStr_();
    var time = timeStr_();

    // แจกจ่าย allocation กลับไปยังแต่ละแถวของผู้ใช้ (item เดิมหลายแถวใช้คิวเดียวกัน)
    var queueByItem = {};
    Object.keys(allocationByItem).forEach(function (id) {
      queueByItem[id] = allocationByItem[id].map(function (a) {
        return { lot: a.lot, left: a.qty };
      });
    });

    var detailRows = [];
    var txnParts = []; // {itemId, lotNo, qty, unit, price, itemName}
    var lotUpdates = {};   // lotId → {rowIndex, newRemaining}
    var lineNo = 0;

    rows.forEach(function (r) {
      var item = itemMap[r.itemId];
      var need = round4_(num_(r.qty));
      var queue = queueByItem[r.itemId];
      while (need > 0) {
        var head = queue[0];
        var take = Math.min(head.left, need);
        lineNo++;
        detailRows.push({
          Issue_ID: issueId, Issue_No: issueNo, Line_No: lineNo,
          Item_ID: item.Item_ID, Item_Name: item.Item_Name,
          Qty: take, Unit: item.Main_Unit, Lot: head.lot.Lot_No,
          From_Location: head.lot.Location || payload.fromLocation || '',
          Status: 'Completed'
        });
        txnParts.push({
          itemId: item.Item_ID, itemName: item.Item_Name, lotNo: head.lot.Lot_No,
          qty: take, unit: item.Main_Unit, price: num_(head.lot.Unit_Price),
          fromLocation: head.lot.Location || payload.fromLocation || ''
        });
        // สะสมยอดตัดต่อ lot
        var lu = lotUpdates[head.lot.Lot_ID] ||
          (lotUpdates[head.lot.Lot_ID] = { rowIndex: head.lot._rowIndex, remaining: num_(head.lot.Remaining_Qty) });
        lu.remaining = round4_(lu.remaining - take);

        head.left = round4_(head.left - take);
        need = round4_(need - take);
        if (head.left <= 0) queue.shift();
      }
    });

    // ---- 5) เขียนทุกตาราง ----
    // 5.1 ตัด Lot
    var lotUpdateList = Object.keys(lotUpdates).map(function (lotId) {
      var u = lotUpdates[lotId];
      if (u.remaining < 0) throw new Error('Lot ติดลบ — ยกเลิกการบันทึก'); // ไม่ควรเกิดหลัง allocate ผ่าน
      return {
        rowIndex: u.rowIndex,
        values: {
          Remaining_Qty: u.remaining,
          Status: u.remaining <= 0 ? 'Depleted' : 'Active',
          Updated_At: ts
        }
      };
    });
    updateRows_('STOCK_LOT', lotUpdateList);

    // 5.2 ตัด Stock Balance (ยอดรวมต่อ item)
    var balanceChanges = Object.keys(totalByItem).map(function (itemId) {
      var item = itemMap[itemId];
      return { itemId: itemId, itemName: item.Item_Name, unit: item.Main_Unit, delta: -totalByItem[itemId] };
    });
    var newBalances = applyBalanceChanges_(balanceChanges);

    // 5.3 Stock Transaction ต่อ lot ที่ถูกตัด
    var runningBack = {};
    var txnRows = [];
    for (var i = txnParts.length - 1; i >= 0; i--) {
      var p = txnParts[i];
      var bal = runningBack[p.itemId] !== undefined ? runningBack[p.itemId] : newBalances[p.itemId];
      txnRows[i] = {
        Transaction_ID: uuid_(), Date: date, Time: time, Timestamp: ts,
        Transaction_Type: 'ISSUE', Document_No: issueNo,
        Item_ID: p.itemId, Item_Name: p.itemName, Lot_No: p.lotNo,
        Qty_In: '', Qty_Out: p.qty, Unit: p.unit, Balance_After: bal,
        From_Location: p.fromLocation, To_Location: payload.toLocation,
        Unit_Price: p.price, Employee_ID: employee.employeeId,
        Employee_Name: employee.name, Remark: payload.remark || ''
      };
      runningBack[p.itemId] = round4_(bal + p.qty);
    }

    var header = {
      Issue_ID: issueId, Issue_No: issueNo, Date: date, Time: time,
      From_Location: payload.fromLocation || '', To_Location: payload.toLocation,
      Employee_ID: employee.employeeId, Employee_Name: employee.name,
      Employee_Email: employee.email || '',
      Total_Items: rows.length, Remark: payload.remark || '', Status: 'Completed',
      Created_From_Device: payload.device || '', Created_From_Module: 'ISSUE',
      Created_At: ts
    };

    appendObjects_('ISSUE', [header]);
    appendObjects_('ISSUE_DETAIL', detailRows);
    appendObjects_('STOCK_TRANSACTION', txnRows);

    logAudit_({
      employee: employee, action: 'CREATE_ISSUE', module: 'ISSUE',
      recordId: issueNo,
      newValue: {
        toLocation: payload.toLocation, items: rows.length,
        lots: detailRows.map(function (d) { return d.Item_Name + ' ' + d.Qty + d.Unit + ' @' + d.Lot; })
      },
      device: payload.device || ''
    });

    invalidateCache_(['STOCK_BALANCE']);

    return {
      issueNo: issueNo, date: date, time: time,
      recordedBy: employee.name, employeeId: employee.employeeId,
      totalItems: rows.length,
      details: detailRows.map(function (d) {
        return { line: d.Line_No, itemName: d.Item_Name, qty: d.Qty, unit: d.Unit, lot: d.Lot };
      })
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * API: FEFO preview ก่อนเบิก — แสดงว่าจะตัด lot ไหนบ้าง
 * rows = [{itemId, qty}]
 */
function apiPreviewIssue(rows) {
  return apiResult_(function () {
    var itemMap = {};
    readAllCached_('ITEM_MASTER').forEach(function (it) { itemMap[it.Item_ID] = it; });
    var totalByItem = {};
    (rows || []).forEach(function (r) {
      totalByItem[r.itemId] = round4_((totalByItem[r.itemId] || 0) + num_(r.qty));
    });
    var result = {};
    Object.keys(totalByItem).forEach(function (itemId) {
      var alloc = allocateFefo_(itemId, totalByItem[itemId]);
      result[itemId] = {
        ok: alloc.shortage <= 0,
        shortage: alloc.shortage,
        expiredQty: alloc.expiredQty,
        lots: alloc.allocations.map(function (a) {
          return { lotNo: a.lot.Lot_No, qty: a.qty, expiryDate: a.lot.Expiry_Date || '', location: a.lot.Location };
        })
      };
    });
    return result;
  });
}
