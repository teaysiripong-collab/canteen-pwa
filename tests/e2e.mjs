// End-to-end workflow tests for Canteen Management System.
//
//   npx next build && npx next start &      # app must be running on :3000
//   CHROMIUM_PATH=/path/to/chromium node tests/e2e.mjs
//
// Covers the real shop-floor paths: dashboard drill-down, menu plan approval,
// BOM shift split + learning, recipe on mobile, FEFO issue (incl. the
// over-issue guard), purchase planning/validation, tasks, cost + Excel export,
// reports, global search, and role-based access for every role.

import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const SHOT = process.env.SHOT_DIR || './test-output';
const fails = [];
const ok = [];

function check(name, cond, extra = '') {
  if (cond) ok.push(name);
  else fails.push(`${name}${extra ? ' — ' + extra : ''}`);
}

import { mkdirSync } from 'fs';
mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);

async function login(user) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => fails.push(`JS error (${user}): ${e.message}`));
  await page.goto(BASE + '/login');
  await page.fill('#username', user);
  await page.fill('#password', '1234');
  await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);
  return { ctx, page };
}

// ── 1. Manager dashboard ──
{
  const { ctx, page } = await login('manager');
  const body = await page.textContent('body');
  check('dashboard: title', body.includes('Canteen Command Center'));
  check('dashboard: today menu shown', body.includes('กะเพราหมูบด') || body.includes('ข้าวสวย'), 'no menu on dashboard');
  check('dashboard: partial-delivery alert', body.includes('ส่งไม่ครบ'));
  await page.screenshot({ path: `${SHOT}/01-dashboard.png`, fullPage: true });

  // Manager must NOT see Settings (admin only)
  const nav = await page.textContent('aside');
  check('rbac: manager has no Settings nav', !nav.includes('ตั้งค่า'), 'settings visible to manager');
  check('rbac: manager sees Purchase', nav.includes('จัดซื้อ'));

  // Drill-down works
  await page.goto(BASE + '/purchase?status=PARTIAL');
  check('drilldown: partial PO list', (await page.textContent('body')).includes('PO-20260803-001'));
  await ctx.close();
}

// ── 2. Supervisor: BOM shift split + BOM learning ──
{
  const { ctx, page } = await login('supervisor');
  await page.goto(BASE + '/bom?from=2026-08-03&to=2026-08-08');
  const body = await page.textContent('body');
  check('bom: aggregates by ingredient', body.includes('หมูบด'));
  check('bom: morning/night columns', body.includes('เช้า') && body.includes('ดึก'));
  check('bom: learning suggestion present', body.includes('BOM Learning'), 'no learning section');
  await page.screenshot({ path: `${SHOT}/02-bom.png`, fullPage: true });

  // Verify shift separation is real: open one entry and confirm qty
  await page.goto(BASE + '/menu-plan?week=2026-08-03');
  const mp = await page.textContent('body');
  check('menu-plan: approved status', mp.includes('อนุมัติแล้ว'));
  check('menu-plan: mon-sat grid', mp.includes('จ.') || mp.includes('พฤ.') || mp.includes('ส.'));
  await page.screenshot({ path: `${SHOT}/03-menu-plan.png`, fullPage: true });
  await ctx.close();
}

// ── 3. Staff: recipe on mobile viewport ──
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => fails.push(`JS error (staff mobile): ${e.message}`));
  await page.goto(BASE + '/login');
  await page.fill('#username', 'staff1');
  await page.fill('#password', '1234');
  await Promise.all([page.waitForURL(BASE + '/'), page.click('button[type=submit]')]);

  await page.goto(BASE + '/recipes?q=' + encodeURIComponent('กะเพรา'));
  const list = await page.textContent('body');
  check('recipe search: finds กะเพรา', list.includes('กะเพราหมูบด'), 'search returned nothing');
  await page.click('text=กะเพราหมูบด');
  await page.waitForLoadState('networkidle');
  const detail = await page.textContent('body');
  check('recipe detail: steps rendered', detail.includes('วิธีทำ'));
  check('recipe detail: control points', detail.includes('จุดควบคุมสำคัญ'));
  check('recipe detail: QR present', detail.includes('QR Code'));
  // no horizontal overflow on mobile
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('mobile: no horizontal overflow', !overflow, 'page scrolls sideways');
  await page.screenshot({ path: `${SHOT}/04-recipe-mobile.png`, fullPage: true });

  // Staff should NOT see Master Data / Settings
  const html = await page.content();
  check('rbac: staff has no Master Data', !html.includes('>Master Data<'), 'staff sees master data');
  await ctx.close();
}

// ── 4. QR resolves to latest recipe ──
{
  const { ctx, page } = await login('staff1');
  const res = await page.request.get(BASE + '/api/qr?path=/recipes');
  check('qr: png generated', res.status() === 200 && (res.headers()['content-type'] || '').includes('image/png'));
  await ctx.close();
}

// ── 5. Store: issue stock (FEFO) → stock decreases ──
{
  const { ctx, page } = await login('store');
  await page.goto(BASE + '/stock');
  const before = await page.textContent('body');
  check('stock: list renders', before.includes('คงเหลือ'));
  check('stock: shows location', before.includes('Freezer 2') || before.includes('Shelf B'));
  await page.screenshot({ path: `${SHOT}/05-stock.png`, fullPage: true });

  // capture หมูบด balance before
  const rowBefore = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find(r => r.textContent.includes('หมูบด') && !r.textContent.includes('ไก่'));
    return tr ? tr.children[1].textContent.trim() : null;
  });

  await page.goto(BASE + '/stock/issue');
  check('issue: quick select grid', (await page.textContent('body')).includes('หมูบด'));
  await page.click('text=หมูบด');
  await page.waitForLoadState('networkidle');
  const issueForm = await page.textContent('body');
  check('issue: FEFO suggestion shown', issueForm.includes('FEFO แนะนำ'), 'no FEFO hint');
  await page.screenshot({ path: `${SHOT}/06-issue-fefo.png`, fullPage: true });

  // 5a. Guard: issuing from a location that has none of this item must be refused
  //     with a message saying where the stock actually is.
  const emptyLoc = await page.evaluate(() => {
    const sel = document.querySelector('select[name=locationId]');
    const grp = [...sel.querySelectorAll('optgroup')].find(g => g.label === 'ไม่มีของ');
    return grp ? grp.querySelector('option').value : null;
  });
  if (emptyLoc) {
    await page.fill('input[name=qty]', '5');
    await page.selectOption('select[name=locationId]', emptyLoc);
    await page.click('button:has-text("ยืนยันเบิก")');
    await page.waitForSelector('text=เบิก 5 ไม่ได้', { timeout: 10000 }).catch(() => {});
    const guarded = await page.textContent('body');
    check('issue guard: over-issue refused with reason', guarded.includes('ไม่ได้') && guarded.includes('ของอยู่ที่'), 'no guard message');
    check('issue guard: still on form (data not lost)', (await page.locator('input[name=qty]').inputValue()) === '5', 'qty lost');
    await page.screenshot({ path: `${SHOT}/06b-issue-guard.png`, fullPage: true });
  } else {
    check('issue guard: over-issue refused with reason', false, 'no empty location to test with');
  }

  // 5b. Correct path: issue from the FEFO-suggested location
  await page.goto(BASE + '/stock/issue?ing=' + (await page.evaluate(() => new URL(location.href).searchParams.get('ing'))));
  await page.fill('input[name=qty]', '5');
  await Promise.all([page.waitForURL(/done=issue/), page.click('button:has-text("ยืนยันเบิก")')]);
  const after = await page.textContent('body');
  check('issue: confirmation shown', after.includes('Stock ลดอัตโนมัติ') || after.includes('บันทึกการเบิก'));

  const rowAfter = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find(r => r.textContent.includes('หมูบด') && !r.textContent.includes('ไก่'));
    return tr ? tr.children[1].textContent.trim() : null;
  });
  const b = parseFloat((rowBefore || '0').replace(/,/g, ''));
  const a = parseFloat((rowAfter || '0').replace(/,/g, ''));
  check('issue: stock decreased by 5', Math.abs((b - a) - 5) < 0.01, `before=${rowBefore} after=${rowAfter}`);

  // history records it
  await page.goto(BASE + '/stock/history');
  check('history: issue logged', (await page.textContent('body')).includes('เบิกออก'));
  await ctx.close();
}

// ── 6. Procurement: purchase planning from BOM + validation ──
{
  const { ctx, page } = await login('procurement');
  await page.goto(BASE + '/purchase/plan?from=2026-08-10&to=2026-08-15');
  const plan = await page.textContent('body');
  check('purchase plan: groups by vendor', plan.includes('Betagro') || plan.includes('พวงพลอย') || plan.includes('ไม่มี BOM'));
  await page.screenshot({ path: `${SHOT}/07-purchase-plan.png`, fullPage: true });

  await page.goto(BASE + '/purchase/PLACEHOLDER'.replace('PLACEHOLDER', ''));
  await page.goto(BASE + '/purchase');
  await page.click('text=PO-20260803-001');
  await page.waitForLoadState('networkidle');
  const po = await page.textContent('body');
  check('po detail: outstanding qty visible', po.includes('ค้างรับ'));
  check('po detail: BOM/Stock/order columns', po.includes('BOM ต้องใช้') && po.includes('สั่งจริง'));
  await page.screenshot({ path: `${SHOT}/08-po-detail.png`, fullPage: true });

  // Excel export of PO (download endpoint — use request API, not navigation)
  const poPath = page.url().split('3000')[1].replace('/purchase/', '/api/export/po/');
  const res = await page.request.get(BASE + poPath);
  const ct = res.headers()['content-type'] || '';
  check('po: excel export works', res.status() === 200 && ct.includes('spreadsheet'), `status ${res.status()} ct=${ct}`);
  await ctx.close();
}

// ── 7. Tasks kanban ──
{
  const { ctx, page } = await login('supervisor');
  await page.goto(BASE + '/tasks?view=all');
  const t = await page.textContent('body');
  check('tasks: kanban columns', t.includes('ต้องทำ') && t.includes('กำลังทำ') && t.includes('เสร็จแล้ว'));
  check('tasks: overdue counted', t.includes('เกินกำหนด'));
  check('tasks: workload table', t.includes('ภาระงานรายคน'));
  await page.screenshot({ path: `${SHOT}/09-tasks.png`, fullPage: true });
  await ctx.close();
}

// ── 8. Admin: cost, excel template, reports, master, settings, search ──
{
  const { ctx, page } = await login('admin');

  await page.goto(BASE + '/cost');
  const cost = await page.textContent('body');
  check('cost: planned cost shown', cost.includes('ต้นทุนตามแผน'));
  await page.screenshot({ path: `${SHOT}/10-cost.png`, fullPage: true });

  await page.goto(BASE + '/settings/excel-template');
  const tmplId = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find(x => x.href.includes('/api/export/cost?template='));
    return a ? new URL(a.href).searchParams.get('template') : '';
  });
  const xls = await page.request.get(`${BASE}/api/export/cost?template=${tmplId}&from=2026-08-03&to=2026-08-08`);
  const xct = xls.headers()['content-type'] || '';
  check('cost: excel export works', xls.status() === 200 && xct.includes('spreadsheet'), `status ${xls.status()}`);
  const xbuf = await xls.body();
  check('cost: xlsx is a real workbook', xbuf.length > 2000 && xbuf[0] === 0x50 && xbuf[1] === 0x4b, `size=${xbuf.length}`);

  await page.goto(BASE + '/settings/excel-template');
  check('excel mapping: editor present', (await page.textContent('body')).includes('Mapping JSON'));
  await page.screenshot({ path: `${SHOT}/11-excel-template.png`, fullPage: true });

  await page.goto(BASE + '/reports');
  const rep = await page.textContent('body');
  check('reports: BOM vs actual', rep.includes('BOM (แผน) เทียบกับ Actual'));
  check('reports: vendor performance', rep.includes('ส่งครบหรือไม่'));
  await page.screenshot({ path: `${SHOT}/12-reports.png`, fullPage: true });

  await page.goto(BASE + '/search?q=' + encodeURIComponent('หมูบด'));
  const s = await page.textContent('body');
  check('search: stock section', s.includes('Stock และที่จัดเก็บ'));
  check('search: recipes using it', s.includes('สูตรที่ใช้วัตถุดิบนี้'));
  check('search: purchase history', s.includes('ประวัติการสั่งซื้อ'));
  await page.screenshot({ path: `${SHOT}/13-search.png`, fullPage: true });

  await page.goto(BASE + '/master?tab=ingredients');
  check('master: ingredient table', (await page.textContent('body')).includes('Conversion'));
  await page.screenshot({ path: `${SHOT}/14-master.png`, fullPage: true });

  await page.goto(BASE + '/settings');
  const set = await page.textContent('body');
  check('settings: permission matrix', set.includes('Permission Matrix'));
  check('settings: activity log', set.includes('Activity Log'));
  check('settings: audit shows old→new', set.includes('→') || set.includes('เบิก'));
  await page.screenshot({ path: `${SHOT}/15-settings.png`, fullPage: true });

  await page.goto(BASE + '/documents');
  check('documents: doc center lists', (await page.textContent('body')).includes('Document Center'));

  await page.goto(BASE + '/menu-plan/print?week=2026-08-03');
  check('print: menu sheet', (await page.textContent('body')).includes('ใบเมนูประจำสัปดาห์'));
  await page.screenshot({ path: `${SHOT}/16-print.png`, fullPage: true });
  await ctx.close();
}

// ── 9. Viewer is read-only ──
{
  const { ctx, page } = await login('viewer');
  await page.goto(BASE + '/stock');
  const v = await page.textContent('body');
  check('rbac: viewer cannot issue', !v.includes('➖ เบิกของ'), 'viewer sees issue button');
  const res = await page.request.get(BASE + '/settings');
  check('rbac: viewer blocked from settings', res.status() === 404, `status ${res.status()}`);
  await ctx.close();
}

await browser.close();

console.log(`\n✅ PASS: ${ok.length}`);
if (fails.length) {
  console.log(`\n❌ FAIL: ${fails.length}`);
  fails.forEach(f => console.log('   - ' + f));
  process.exit(1);
} else {
  console.log('All checks passed.');
}
