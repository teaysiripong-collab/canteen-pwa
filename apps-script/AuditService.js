/**
 * Canteen Smart Stock — AuditService.js
 * Audit Log: ทุก action ที่กระทบข้อมูลต้องผ่านที่นี่
 * ห้าม Hard Delete — การยกเลิกใช้ VOID + audit เท่านั้น
 */

/**
 * บันทึก Audit Log 1 รายการ
 * entry = { employee, action, module, recordId, oldValue, newValue, device, remark }
 */
function logAudit_(entry) {
  appendObjects_('AUDIT_LOG', [{
    Audit_ID: uuid_(),
    Timestamp: timestampStr_(),
    Date: todayStr_(),
    Time: timeStr_(),
    Employee_ID: entry.employee ? entry.employee.employeeId : '',
    Employee_Name: entry.employee ? entry.employee.name : '',
    Email: entry.employee ? (entry.employee.email || '') : '',
    Action: entry.action,
    Module: entry.module,
    Record_ID: entry.recordId || '',
    Old_Value: entry.oldValue ? JSON.stringify(entry.oldValue).slice(0, 45000) : '',
    New_Value: entry.newValue ? JSON.stringify(entry.newValue).slice(0, 45000) : '',
    Device: entry.device || '',
    Remark: entry.remark || ''
  }]);
}
