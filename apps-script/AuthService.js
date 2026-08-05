/**
 * Canteen Smart Stock — AuthService.js
 * ตรวจสอบรหัสพนักงาน (Employee ID) และ auto-fill จาก Google Account
 * Server-side validation เสมอ — ไม่เชื่อ client
 */

/**
 * ตรวจสอบ Employee ID กับ USER_MASTER
 * คืน user object ถ้าผ่าน; throw ถ้าไม่พบหรือ Inactive
 */
function validateEmployee_(employeeId) {
  var id = String(employeeId || '').trim().toUpperCase();
  if (!id) throw new Error('กรุณากรอกรหัสพนักงาน');
  var users = readAllCached_('USER_MASTER');
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].Employee_ID).trim().toUpperCase() === id) { found = users[i]; break; }
  }
  if (!found) throw new Error('❌ ไม่พบรหัสพนักงาน ' + id);
  if (String(found.Status).trim() !== 'Active') {
    throw new Error('❌ รหัสพนักงาน ' + id + ' ถูกระงับการใช้งาน (Inactive) — ไม่สามารถบันทึกได้');
  }
  return {
    employeeId: found.Employee_ID,
    name: found.Employee_Name,
    department: found.Department,
    position: found.Position,
    role: found.Role,
    building: found.Building,
    email: found.Email
  };
}

/** API: ตรวจ Employee ID จากหน้าจอ (พิมพ์ / scan barcode / scan QR) */
function apiValidateEmployee(employeeId) {
  return apiResult_(function () { return validateEmployee_(employeeId); });
}

/**
 * API: Auto Fill จาก Google Account ที่ login อยู่
 * ถ้า email ตรงกับ USER_MASTER คืน user นั้น; ถ้าไม่ตรงคืน email เฉย ๆ
 */
function apiGetCurrentUser() {
  return apiResult_(function () {
    var email = Session.getActiveUser().getEmail() || '';
    var result = { email: email, user: null };
    if (!email) return result;
    var users = readAllCached_('USER_MASTER');
    for (var i = 0; i < users.length; i++) {
      if (String(users[i].Email).trim().toLowerCase() === email.toLowerCase()
          && String(users[i].Status).trim() === 'Active') {
        result.user = {
          employeeId: users[i].Employee_ID,
          name: users[i].Employee_Name,
          role: users[i].Role,
          building: users[i].Building,
          email: users[i].Email
        };
        break;
      }
    }
    return result;
  });
}
