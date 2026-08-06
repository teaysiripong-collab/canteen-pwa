// Tests for a FRESH deployment: empty database + minimal seed.
//
//   DATABASE_URL=...canteen_test npm run db:push
//   DATABASE_URL=...canteen_test ADMIN_PASSWORD='CanteenSecure2026!' npm run db:seed
//   DATABASE_URL=...canteen_test npm start &
//   CHROMIUM_PATH=/path/to/chromium node tests/e2e-fresh.mjs
//
// Proves an empty system renders every page without demo data, that Google Drive
// degrades gracefully when unconfigured, and that the Excel master-data import
// round-trips (dry run -> commit -> visible in Master Data -> written to audit log).

import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
const BASE='http://localhost:3000';
const SHOT = process.env.SHOT_DIR || './test-output';
const fails=[],ok=[];
const check=(n,c,e='')=>c?ok.push(n):fails.push(`${n}${e?' — '+e:''}`);

import { mkdirSync } from 'fs';
mkdirSync(SHOT, { recursive: true });

const b = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const ctx = await b.newContext({ viewport:{width:1280,height:900}, acceptDownloads:true });
const p = await ctx.newPage();
p.on('pageerror', e=>fails.push('JS error: '+e.message));

await p.goto(BASE+'/login');
await p.fill('#username','admin'); await p.fill('#password', process.env.ADMIN_PASSWORD || 'CanteenSecure2026!');
await Promise.all([p.waitForURL(BASE+'/'), p.click('button[type=submit]')]);
check('login with seeded admin', p.url() === BASE+'/');

// Empty system must not crash anywhere
const dash = await p.textContent('body');
check('empty dashboard renders', dash.includes('Canteen Command Center'));
check('empty dashboard shows zero menus', dash.includes('เมนูวันนี้'));
await p.screenshot({path:`${SHOT}/20-empty-dashboard.png`, fullPage:true});

for (const [path,marker] of [['/menu-plan','แผนเมนู'],['/recipes','คลังสูตรอาหาร'],['/bom','BOM'],
    ['/purchase','จัดซื้อ'],['/stock','Stock'],['/cost','ต้นทุน'],['/tasks','งาน'],
    ['/reports','รายงาน'],['/documents','Document Center'],['/master','Master Data'],['/settings','ตั้งค่าระบบ']]) {
  const r = await p.goto(BASE+path);
  const txt = await p.textContent('body');
  check(`empty system: ${path} ok`, r.status()===200 && txt.includes(marker), `status ${r.status()}`);
}

// Drive settings page — must show "not configured" gracefully, not crash
await p.goto(BASE+'/settings/drive');
const drive = await p.textContent('body');
check('drive page renders without credentials', drive.includes('ยังไม่ได้เชื่อมต่อ Google Drive'), 'no graceful message');
check('drive page shows setup guide', drive.includes('Service Account'));
await p.screenshot({path:`${SHOT}/21-drive-settings.png`, fullPage:true});

// Test-folder action must return a friendly error, not blow up
await p.fill('input[name=folderId]', 'some-fake-folder-id');
await p.click('button:has-text("ทดสอบการเชื่อมต่อ")');
await p.waitForTimeout(2500);
const afterTest = await p.textContent('body');
check('drive test shows friendly error', afterTest.includes('ยังไม่ได้ตั้งค่า Credential'), 'unexpected message');

// Import page + template download
await p.goto(BASE+'/master/import');
const imp = await p.textContent('body');
check('import page renders', imp.includes('นำเข้าข้อมูลหลักจาก Excel'));
check('import page lists sheets', imp.includes('วัตถุดิบ') && imp.includes('BOM มาตรฐาน'));
await p.screenshot({path:`${SHOT}/22-import.png`, fullPage:true});

const tmplRes = await p.request.get(BASE+'/api/import/template');
const tbuf = await tmplRes.body();
check('template downloads as xlsx', tmplRes.status()===200 && tbuf[0]===0x50 && tbuf[1]===0x4b, `status ${tmplRes.status()}`);

// Real upload through the UI: dry run then commit
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('วัตถุดิบ');
ws.addRow(['รหัสวัตถุดิบ','ชื่อวัตถุดิบ','หมวด','หน่วยนับ','Stock ขั้นต่ำ']);
ws.addRow(['UI001','ปลาหมึกสด','เนื้อสัตว์','kg','5']);
const buf = Buffer.from(await wb.xlsx.writeBuffer());

await p.setInputFiles('input[type=file]', { name:'test.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });
await p.click('button:has-text("เริ่มนำเข้า")');
await p.waitForTimeout(3000);
const dry = await p.textContent('body');
check('import dry-run reports success without saving', dry.includes('ตรวจสอบผ่าน') && dry.includes('ยังไม่ได้บันทึก'), 'no dry-run message');
await p.screenshot({path:`${SHOT}/23-import-dryrun.png`, fullPage:true});

// now uncheck dry run and import for real
await p.setInputFiles('input[type=file]', { name:'test.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });
await p.uncheck('input[name=dryRun]');
await p.click('button:has-text("เริ่มนำเข้า")');
await p.waitForTimeout(3000);
const real = await p.textContent('body');
check('import commits for real', real.includes('นำเข้าสำเร็จ'), 'no success message');

await p.goto(BASE+'/master?tab=ingredients');
check('imported ingredient appears in Master Data', (await p.textContent('body')).includes('ปลาหมึกสด'), 'not found');
await p.screenshot({path:`${SHOT}/24-imported.png`, fullPage:true});

// Audit log recorded the import
await p.goto(BASE+'/settings');
check('import recorded in activity log', (await p.textContent('body')).includes('นำเข้าข้อมูลหลัก'), 'no audit entry');

await b.close();
console.log(`\n✅ PASS ${ok.length}`);
if(fails.length){console.log(`❌ FAIL ${fails.length}`); fails.forEach(f=>console.log('  - '+f)); process.exit(1);}
else console.log('All checks passed.');
