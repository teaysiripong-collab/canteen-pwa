// Operational settings tests.
//
//   npm start &
//   CHROMIUM_PATH=/path/to/chromium node tests/e2e-settings.mjs
//
// Proves the settings page configures how the canteen actually runs — employee
// records with running codes, canteen details, shift names, working days and
// document prefixes — and that saving them really changes the app: shift labels
// reach the menu plan, working days resize the calendar, and canteen details
// appear on the printed menu. Also checks the audit trail records the changes.
//
// NOTE: this test mutates settings. Run it against a dev/demo database.

import { chromium } from 'playwright';
const BASE='http://localhost:3000';
const SHOT = process.env.SHOT_DIR || './test-output';
const fails=[],ok=[]; const check=(n,c,e='')=>c?ok.push(n):fails.push(`${n}${e?' — '+e:''}`);
import { mkdirSync } from 'fs';
mkdirSync(SHOT, { recursive: true });

const b = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const ctx=await b.newContext({viewport:{width:1400,height:1100}}); const p=await ctx.newPage();
p.on('pageerror',e=>fails.push('JS error: '+e.message));
await p.goto(BASE+'/login'); await p.fill('#username','admin'); await p.fill('#password','1234');
await Promise.all([p.waitForURL(BASE+'/'), p.click('button[type=submit]')]);

await p.goto(BASE+'/settings');
const t = await p.textContent('body');
check('settings shows employee table', t.includes('รหัสพนักงาน') && t.includes('ชื่อ-นามสกุล'));
check('settings has org info', t.includes('ข้อมูลแคนทีน'));
check('settings has shift config', t.includes('รอบการทำงาน'));
check('settings has working days', t.includes('วันทำการ'));
check('settings has doc numbering', t.includes('รูปแบบเลขที่เอกสาร'));
check('technical config moved out', !t.includes('Mapping JSON') && !t.includes('Folder ID'), 'technical config still here');
await p.screenshot({path:`${SHOT}/40-settings.png`, fullPage:true});

await p.fill('input[name=name]', 'คุณทดสอบ ระบบดี');
await p.fill('input[name=nickname]', 'เทส');
await p.fill('input[name=department]', 'ครัวร้อน');
await p.fill('input[name=phone]', '086-555-1234');
await p.fill('input[name=username]', 'testemp');
await p.fill('input[name=password]', 'test1234');
await p.click('button:has-text("เพิ่มพนักงาน")');
await p.waitForTimeout(2500);
const afterAdd = await p.textContent('body');
check('employee created with auto code', afterAdd.includes('คุณทดสอบ') && /EMP\d{3}/.test(afterAdd), 'no auto code');
await p.screenshot({path:`${SHOT}/41-employee-added.png`, fullPage:true});

await p.fill('input[name=name]', 'ซ้ำ');
await p.fill('input[name=username]', 'testemp');
await p.fill('input[name=password]', 'test1234');
await p.click('button:has-text("เพิ่มพนักงาน")');
await p.waitForTimeout(2000);
check('duplicate username rejected', (await p.textContent('body')).includes('อยู่แล้ว'), 'no duplicate error');

await p.goto(BASE+'/settings');
await p.fill('input[name=morningLabel]', 'กะเช้า');
await p.fill('input[name=nightLabel]', 'กะดึก');
await p.fill('input[name=nightFactor]', '0.5');
await p.locator('form:has(input[name=morningLabel]) button[type=submit]').click();
await p.waitForTimeout(2500);
await p.goto(BASE+'/menu-plan?week=2026-08-03');
const mp = await p.textContent('body');
check('shift label change reaches menu plan', mp.includes('กะเช้า') && mp.includes('กะดึก'), 'labels not applied');
check('night factor from config', mp.includes('50%'), 'factor not updated');

await p.goto(BASE+'/settings');
await p.uncheck('input[name=workingDays][value="6"]');
await p.locator('form:has(input[name=workingDays]) button[type=submit]').click();
await p.waitForTimeout(2500);
await p.goto(BASE+'/menu-plan?week=2026-08-03');
const mp2 = await p.textContent('body');
check('working days shrink calendar', mp2.includes('5 วันทำการ'), 'still 6 days');
await p.screenshot({path:`${SHOT}/42-menu-plan-5days.png`, fullPage:true});

await p.goto(BASE+'/settings');
await p.fill('input[name=orgName]', 'แคนทีนโรงงานสมุทรปราการ');
await p.fill('input[name=orgBranch]', 'อาคาร 16');
await p.fill('input[name=orgPhone]', '02-111-2222');
await p.locator('form:has(input[name=orgTaxId]) button[type=submit]').click();
await p.waitForTimeout(2500);
await p.goto(BASE+'/menu-plan/print?week=2026-08-03');
const pr = await p.textContent('body');
check('org name on printed menu', pr.includes('แคนทีนโรงงานสมุทรปราการ'), 'org not on print');
check('branch on printed menu', pr.includes('อาคาร 16'));
await p.screenshot({path:`${SHOT}/43-print-with-org.png`, fullPage:true});

for (const [path, marker] of [['/settings/permissions','ตารางสิทธิ์'],['/settings/activity','Timeline'],['/settings/integrations','การเชื่อมต่อระบบภายนอก']]) {
  const r = await p.goto(BASE+path);
  check(`${path} renders`, r.status()===200 && (await p.textContent('body')).includes(marker), `status ${r.status()}`);
}
await p.goto(BASE+'/settings/integrations');
await p.screenshot({path:`${SHOT}/44-integrations.png`, fullPage:true});

await p.goto(BASE+'/settings/activity');
const act = await p.textContent('body');
check('config changes audited', act.includes('รอบการทำงาน') && act.includes('ข้อมูลแคนทีน'), 'not audited');
check('employee creation audited', act.includes('เพิ่มพนักงาน'));

await b.close();
console.log(`\nPASS ${ok.length}`);
if(fails.length){console.log(`FAIL ${fails.length}`); fails.forEach(f=>console.log('  - '+f)); process.exit(1);}
else console.log('All checks passed.');
