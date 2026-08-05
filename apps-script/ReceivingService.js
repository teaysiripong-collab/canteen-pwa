/**
 * Canteen Smart Stock — ReceivingService.js
 * Bulk Receiving: 1 Header + หลาย Detail rows ใน transaction เดียว
 *
 * Flow (ตาม spec ข้อ 19):
 *   Validate Employee → Validate Header → Validate All Rows →
 *   Acquire Lock → Process All Rows → Create Lot → Update Balance →
 *   Create Transactions → Pending Delivery → Audit Log → Release Lock
 */

/**
 * API: บันทึกรับสินค้าทั้งชุด
 * payload = {
 *   employeeId, vendor, poNumber, deliveryNote, defaultLocation, remark,
 *   attachmentUrl, attachmentFileId, device, expectedDate,
 *   rows: [{ itemId, orderedQty, receivedQty, lot, mfgDate, expiryDate, location, price }]
 * }
 */
function apiSaveReceiving(payload) {
  return apiResult_(function () { return saveReceiving_(payload); });
}

function saveReceiving_(payload) {
  if (!payload) throw new Error('ไม่มีข้อมูล');

  // ---- 1) Validate Employee (server-side เสมอ) ----
  var employee = validateEmployee_(payload.employeeId);

  // ---- 2) Validate Header ----
  if (!payload.vendor) throw new Error('กรุณาเลือก Vendor');
  if (!payload.defaultLocation) throw new Error('กรุณาเลือก Default Location');
  var rows = payload.rows || [];
  if (!rows.length) throw new Error('ไม่มีรายการสินค้า');
  if (rows.length > CFG.MAX_BULK_ROWS) throw new Error('รายการเกิน ' + CFG.MAX_BULK_ROWS + ' แถว');

  // ---- 3) Validate All Rows ----
  var itemMap = {};
  readAllCached_('ITEM_MASTER').forEach(function (it) { itemMap[it.Item_ID] = it; });
  var today = todayStr_();
  var errors = [];
  rows.forEach(function (r, i) {
    var lineNo = i + 1;
    var item = itemMap[r.itemId];
    if (!item) { errors.push({ line: lineNo, message: 'ไม่พบสินค้าในระบบ' }); return; }
    if (String(item.Active_Status).trim() !== 'Active') {
      errors.push({ line: lineNo, message: 'สินค้า ' + item.Item_Name + ' ถูกปิดใช้งาน' }); return;
    }
    var received = num_(r.receivedQty);
    if (received <= 0) errors.push({ line: lineNo, message: 'จำนวนรับต้องมากกว่า 0' });
    if (r.orderedQty !== '' && r.orderedQty !== undefined && r.orderedQty !== null && num_(r.orderedQty) < 0) {
      errors.push({ line: lineNo, message: 'จำนวนสั่งไม่ถูกต้อง' });
    }
    if (r.expiryDate) {
      if (!isValidDateStr_(r.expiryDate)) {
        errors.push({ line: lineNo, message: 'Expiry Date ไม่ถูกต้อง (ต้องเป็น ปปปป-ดด-วว)' });
      } else if (dateBefore_(r.expiryDate, today)) {
        errors.push({ line: lineNo, message: 'Expiry Date เป็นอดีต — รับของหมดอายุไม่ได้' });
      }
    }
    if (r.mfgDate && !isValidDateStr_(r.mfgDate)) {
      errors.push({ line: lineNo, message: 'Manufacturing Date ไม่ถูกต้อง' });
    }
    if (num_(r.price) < 0) errors.push({ line: lineNo, message: 'ราคาไม่ถูกต้อง' });
  });
  if (errors.length) {
    var err = new Error('VALIDATION');
    err.message = JSON.stringify({ validation: errors });
    throw err;
  }

  // ---- 4) Acquire Lock แล้ว process ทั้งชุดเป็น atomic ----
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_TIMEOUT_MS)) {
    throw new Error('ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง');
  }
  try {
    var receivingId = uuid_();
    var receivingNo = nextDocNumber_(CFG.DOC_PREFIX.RECEIVING);
    var ts = timestampStr_();
    var date = todayStr_();
    var time = timeStr_();

    var detailRows = [];
    var lotRows = [];
    var txnRows = [];
    var pendingRows = [];
    var balanceChanges = [];
    var totalAmount = 0;
    var pendingCount = 0;
    var lotSeq = {};

    rows.forEach(function (r, i) {
      var item = itemMap[r.itemId];
      var received = round4_(num_(r.receivedQty));
      var ordered = (r.orderedQty === '' || r.orderedQty === undefined || r.orderedQty === null)
        ? received : round4_(num_(r.orderedQty));
      var price = num_(r.price) || num_(item.Last_Price);
      var amount = round4_(received * price);
      var location = r.location || payload.defaultLocation || item.Default_Location;
      var pendingQty = ordered > received ? round4_(ordered - received) : 0;
      var status = pendingQty > 0 ? 'Partial Delivery' : 'Completed';

      // Lot No: ใช้ที่ผู้ใช้กรอก หรือ generate อัตโนมัติ
      var lotNo = String(r.lot || '').trim();
      if (!lotNo) {
        lotSeq[item.Item_Code] = (lotSeq[item.Item_Code] || 0) + 1;
        lotNo = autoLotNo_(item.Item_Code, lotSeq[item.Item_Code]);
      }

      detailRows.push({
        Receiving_ID: receivingId, Receiving_No: receivingNo, Line_No: i + 1,
        Item_ID: item.Item_ID, Item_Name: item.Item_Name,
        Ordered_Qty: ordered, Received_Qty: received, Unit: item.Main_Unit,
        Lot: lotNo, Manufacturing_Date: r.mfgDate || '', Expiry_Date: r.expiryDate || '',
        Location: location, Price: price, Amount: amount,
        Pending_Qty: pendingQty, Status: status
      });

      lotRows.push({
        Lot_ID: uuid_(), Item_ID: item.Item_ID, Item_Name: item.Item_Name,
        Lot_No: lotNo, Received_Qty: received, Remaining_Qty: received,
        Unit: item.Main_Unit, Manufacturing_Date: r.mfgDate || '',
        Expiry_Date: r.expiryDate || '', Location: location,
        Receiving_No: receivingNo, Unit_Price: price, Status: 'Active',
        Created_At: ts, Updated_At: ts
      });

      balanceChanges.push({ itemId: item.Item_ID, itemName: item.Item_Name, unit: item.Main_Unit, delta: received });

      if (pendingQty > 0) {
        pendingCount++;
        pendingRows.push({
          Pending_ID: uuid_(), PO_Number: payload.poNumber || '', Vendor: payload.vendor,
          Item_ID: item.Item_ID, Item_Name: item.Item_Name,
          Ordered_Qty: ordered, Received_Qty: received, Pending_Qty: pendingQty,
          Unit: item.Main_Unit, Receiving_No: receivingNo,
          Expected_Date: payload.expectedDate || '', Days_Overdue: 0,
          Responsible_Person: employee.name, Status: 'Partial Delivery',
          Created_At: ts, Updated_At: ts
        });
      }
      totalAmount = round4_(totalAmount + amount);
    });

    // Update balance ก่อน เพื่อให้รู้ Balance_After ของแต่ละ transaction
    var newBalances = applyBalanceChanges_(balanceChanges);

    // Balance_After ต่อแถว: ไล่จากยอดใหม่ย้อนกลับ (กรณี item ซ้ำหลายแถว)
    var runningBack = {};
    for (var i = rows.length - 1; i >= 0; i--) {
      var d = detailRows[i];
      var bal = runningBack[d.Item_ID] !== undefined ? runningBack[d.Item_ID] : newBalances[d.Item_ID];
      txnRows[i] = {
        Transaction_ID: uuid_(), Date: date, Time: time, Timestamp: ts,
        Transaction_Type: 'RECEIVE', Document_No: receivingNo,
        Item_ID: d.Item_ID, Item_Name: d.Item_Name, Lot_No: d.Lot,
        Qty_In: d.Received_Qty, Qty_Out: '', Unit: d.Unit,
        Balance_After: bal, From_Location: payload.vendor, To_Location: d.Location,
        Unit_Price: d.Price, Employee_ID: employee.employeeId,
        Employee_Name: employee.name, Remark: payload.remark || ''
      };
      runningBack[d.Item_ID] = round4_(bal - num_(d.Received_Qty));
    }

    var header = {
      Receiving_ID: receivingId, Receiving_No: receivingNo, Date: date, Time: time,
      Vendor: payload.vendor, PO_Number: payload.poNumber || '',
      Delivery_Note: payload.deliveryNote || '',
      Employee_ID: employee.employeeId, Employee_Name: employee.name,
      Employee_Email: employee.email || '',
      Default_Location: payload.defaultLocation,
      Total_Items: rows.length, Total_Amount: totalAmount, Pending_Count: pendingCount,
      Remark: payload.remark || '',
      Attachment_URL: payload.attachmentUrl || '', Attachment_File_ID: payload.attachmentFileId || '',
      Status: pendingCount > 0 ? 'Partial Delivery' : 'Completed',
      Created_From_Device: payload.device || '', Created_From_Module: 'RECEIVING',
      Created_At: ts
    };

    // เขียนทุกตารางแบบ batch
    appendObjects_('RECEIVING', [header]);
    appendObjects_('RECEIVING_DETAIL', detailRows);
    appendObjects_('STOCK_LOT', lotRows);
    appendObjects_('STOCK_TRANSACTION', txnRows);
    appendObjects_('PENDING_DELIVERY', pendingRows);

    logAudit_({
      employee: employee, action: 'CREATE_RECEIVING', module: 'RECEIVING',
      recordId: receivingNo,
      newValue: { vendor: payload.vendor, po: payload.poNumber, items: rows.length, amount: totalAmount, pending: pendingCount },
      device: payload.device || ''
    });

    invalidateCache_(['STOCK_BALANCE']);

    return {
      receivingNo: receivingNo,
      date: date, time: time,
      recordedBy: employee.name, employeeId: employee.employeeId,
      totalItems: rows.length, totalAmount: totalAmount, pendingCount: pendingCount,
      details: detailRows.map(function (d) {
        return { line: d.Line_No, itemName: d.Item_Name, qty: d.Received_Qty, unit: d.Unit, lot: d.Lot, status: d.Status, pendingQty: d.Pending_Qty };
      })
    };
  } finally {
    lock.releaseLock();
  }
}
