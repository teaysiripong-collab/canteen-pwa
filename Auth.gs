/***************************************************************
 * Auth.gs — Authentication / Session / Users / Permissions
 ***************************************************************/

/* ── Role Permission Map (Server เป็นผู้ตัดสิน ห้าม Trust Client) ── */
var ROLE_PAGES = {
  Admin:      ['dashboard','menuplan','menus','recipes','ingredients','stock','stockin','requisition','approval','transfer','purchase','cost','reports','users','settings'],
  Supervisor: ['dashboard','menuplan','menus','recipes','ingredients','stock','stockin','requisition','approval','transfer','purchase','cost','reports'],
  User:       ['dashboard','menuplan','menus','recipes','ingredients','stock','requisition','reports'],
  Viewer:     ['dashboard','reports']
};

function hashPassword_(username, password) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'MEKTEC::' + s_(username).toLowerCase() + '::' + s_(password),
    Utilities.Charset.UTF_8
  );
  return raw.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function publicUser_(u) {
  return {
    user_id: u.user_id, username: u.username, fullname: u.fullname,
    employee_code: u.employee_code, phone: u.phone, position: u.position,
    role: u.role, department: u.department, status: u.status,
    profile_photo: u.profile_photo,
    pages: ROLE_PAGES[u.role] || ROLE_PAGES.Viewer
  };
}

/* ═══════════════ LOGIN / LOGOUT ═══════════════ */

function login(payload) {
  try {
    ensureSetup();
    var username = s_(payload && payload.username).toLowerCase();
    var password = s_(payload && payload.password);
    if (!username || !password) return err_('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

    var user = null;
    readAll_('Users').forEach(function(u) {
      if (s_(u.username).toLowerCase() === username) user = u;
    });
    if (!user || user.password_hash !== hashPassword_(username, password)) {
      return err_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    if (user.status === 'pending') return err_('บัญชีของคุณรอการอนุมัติจากผู้ดูแลระบบ');
    if (user.status !== 'active') return err_('บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');

    var hours = num_(getSettingsMap_().session_timeout_hours) || 2;
    var token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
    var expires = new Date(Date.now() + hours * 3600 * 1000);
    appendRow_('Sessions', {
      token: token, user_id: user.user_id,
      expires_at: Utilities.formatDate(expires, TZ, 'yyyy-MM-dd HH:mm:ss'),
      created_at: nowTs_()
    });
    audit_(user, 'LOGIN', 'Auth', user.user_id, null, null, s_(payload.device_info));
    return ok_('เข้าสู่ระบบสำเร็จ', { token: token, user: publicUser_(user) });
  } catch (e) {
    return err_('ไม่สามารถเข้าสู่ระบบได้: ' + e.message);
  }
}

function logout(token) {
  try {
    var sess = findBy_('Sessions', 'token', s_(token));
    if (sess) updateRow_('Sessions', 'token', s_(token), { expires_at: '2000-01-01 00:00:00' });
    return ok_('ออกจากระบบแล้ว');
  } catch (e) {
    return ok_('ออกจากระบบแล้ว');
  }
}

/** ตรวจ Token — คืน user object หรือ null */
function verifyToken_(token) {
  token = s_(token);
  if (!token) return null;
  var sess = findBy_('Sessions', 'token', token);
  if (!sess) return null;
  var exp = new Date(String(sess.expires_at).replace(' ', 'T'));
  if (isNaN(exp.getTime()) || exp.getTime() < Date.now()) return null;
  var user = findBy_('Users', 'user_id', sess.user_id);
  if (!user || user.status !== 'active') return null;
  return user;
}

/**
 * ตรวจสิทธิ์ก่อนทำงานทุก Function
 * @return {ok:true, user} หรือ {ok:false, res:{success:false,...}}
 */
function requireAuth_(token, roles) {
  var user = verifyToken_(token);
  if (!user) return { ok: false, res: err_('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่', 'SESSION_EXPIRED') };
  if (roles && roles.length && roles.indexOf(user.role) === -1) {
    return { ok: false, res: err_('คุณไม่มีสิทธิ์ทำรายการนี้', 'FORBIDDEN') };
  }
  return { ok: true, user: user };
}

/* ═══════════════ REGISTER ═══════════════ */

function registerUser(payload) {
  try {
    ensureSetup();
    var username = s_(payload && payload.username).toLowerCase();
    var password = s_(payload && payload.password);
    var fullname = s_(payload && payload.fullname);
    if (!username || username.length < 3) return err_('ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร');
    if (!/^[a-z0-9._-]+$/.test(username)) return err_('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ -');
    if (!password || password.length < 6) return err_('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
    if (!fullname) return err_('กรุณากรอกชื่อ-นามสกุล');

    return withLock_(function() {
      var dup = null;
      readAll_('Users').forEach(function(u) {
        if (s_(u.username).toLowerCase() === username) dup = u;
      });
      if (dup) return err_('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
      var now = nowTs_();
      var user = {
        user_id: generateId_('USR'), username: username,
        password_hash: hashPassword_(username, password),
        fullname: fullname, employee_code: s_(payload.employee_code),
        phone: s_(payload.phone), position: s_(payload.position),
        role: 'User', department: s_(payload.department),
        status: 'pending', profile_photo: '', created_at: now, updated_at: now
      };
      appendRow_('Users', user);
      audit_(null, 'REGISTER', 'Users', user.user_id, null, { username: username, fullname: fullname });
      return ok_('สมัครสมาชิกสำเร็จ กรุณารอผู้ดูแลระบบอนุมัติ');
    });
  } catch (e) {
    return err_('ไม่สามารถสมัครสมาชิกได้: ' + e.message);
  }
}

/* ═══════════════ USER MANAGEMENT (Admin) ═══════════════ */

function listUsers(token) {
  var auth = requireAuth_(token, ['Admin']);
  if (!auth.ok) return auth.res;
  var users = readAll_('Users').map(function(u) {
    var p = publicUser_(u);
    p.created_at = u.created_at;
    return p;
  });
  return ok_('โหลดผู้ใช้งานสำเร็จ', users);
}

function saveUser(token, payload) {
  var auth = requireAuth_(token, ['Admin']);
  if (!auth.ok) return auth.res;
  try {
    return withLock_(function() {
      var now = nowTs_();
      var roles = ['Admin', 'Supervisor', 'User', 'Viewer'];
      var statuses = ['pending', 'active', 'inactive', 'rejected'];

      if (payload.user_id) {
        var user = findBy_('Users', 'user_id', payload.user_id);
        if (!user) return err_('ไม่พบผู้ใช้งานนี้');
        var patch = { updated_at: now };
        ['fullname', 'employee_code', 'phone', 'position', 'department'].forEach(function(f) {
          if (payload[f] !== undefined) patch[f] = s_(payload[f]);
        });
        if (payload.role !== undefined) {
          if (roles.indexOf(payload.role) === -1) return err_('Role ไม่ถูกต้อง');
          patch.role = payload.role;
        }
        if (payload.status !== undefined) {
          if (statuses.indexOf(payload.status) === -1) return err_('สถานะไม่ถูกต้อง');
          patch.status = payload.status;
        }
        if (s_(payload.new_password)) {
          if (s_(payload.new_password).length < 6) return err_('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
          patch.password_hash = hashPassword_(user.username, s_(payload.new_password));
        }
        // กันล็อกตัวเองออกจากระบบ: ห้ามลดสิทธิ์/ปิด Admin คนสุดท้าย
        if (user.role === 'Admin' && (patch.role && patch.role !== 'Admin' || patch.status && patch.status !== 'active')) {
          var admins = readAll_('Users').filter(function(u) { return u.role === 'Admin' && u.status === 'active'; });
          if (admins.length <= 1) return err_('ไม่สามารถปิดหรือลดสิทธิ์ Admin คนสุดท้ายของระบบได้');
        }
        updateRow_('Users', 'user_id', payload.user_id, patch);
        audit_(auth.user, 'EDIT', 'Users', payload.user_id, publicUser_(user), patch);
        return ok_('บันทึกข้อมูลผู้ใช้งานสำเร็จ');
      }

      // สร้างผู้ใช้ใหม่โดย Admin
      var username = s_(payload.username).toLowerCase();
      if (!username || !s_(payload.password)) return err_('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      var dup = null;
      readAll_('Users').forEach(function(u) { if (s_(u.username).toLowerCase() === username) dup = u; });
      if (dup) return err_('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
      var nu = {
        user_id: generateId_('USR'), username: username,
        password_hash: hashPassword_(username, s_(payload.password)),
        fullname: s_(payload.fullname), employee_code: s_(payload.employee_code),
        phone: s_(payload.phone), position: s_(payload.position),
        role: roles.indexOf(payload.role) !== -1 ? payload.role : 'User',
        department: s_(payload.department),
        status: statuses.indexOf(payload.status) !== -1 ? payload.status : 'active',
        profile_photo: '', created_at: now, updated_at: now
      };
      appendRow_('Users', nu);
      audit_(auth.user, 'CREATE', 'Users', nu.user_id, null, { username: username, role: nu.role });
      return ok_('สร้างผู้ใช้งานสำเร็จ');
    });
  } catch (e) {
    return err_('ไม่สามารถบันทึกผู้ใช้งานได้: ' + e.message);
  }
}
