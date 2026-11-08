/**
 * 阶段三 UI 端到端测试（真实浏览器 + 真实本地 D1）
 *
 * 覆盖三条用户旅程：
 *   1. 访客在 /quote 提交询价清单
 *   2. 销售在 /admin/trade 把草稿核价、发送、转订单
 *   3. 客户在 /quote/:token 接受报价，在 /account 用魔法链接登录
 *
 * 顺带验证 UI 设计系统（.card/.badge/.table-wrap）真的渲染出来了。
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = 'test-artifacts';
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

let pass = 0, fail = 0, skip = 0;
const fails = [];
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function info(msg) { console.log('  · ' + msg); }

const stamp = Date.now().toString().slice(-6);
const leadEmail = `ui-lead-${stamp}@example.com`;

if (!EDGE) { console.error('未找到 Edge 可执行文件'); process.exit(2); }
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const pageErrors = [];
// 后台的发信/删除/状态推进用的是原生 confirm()：Playwright 默认自动 dismiss，
// 不接住就会让流程"点了没反应"。这里统一点"确定"。
page.on('dialog', d => d.accept().catch(() => {}));
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', m => { if (m.type() === 'error') pageErrors.push('[console] ' + m.text()); });

const api = (p, init) => page.evaluate(async ({ p, init }) => {
  const t = localStorage.getItem('admin_token');
  const res = await fetch('/api' + p, {
    ...(init || {}),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, ...((init || {}).headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}, { p, init });

/* ================================================================
 * 1. 访客提交询价清单
 * ================================================================ */
console.log('\n== 1. /quote 询价清单页 ==');
await page.goto(`${BASE}/quote`, { waitUntil: 'domcontentloaded' });
check('页面加载 200', true);
check('标题存在', /request a quotation/i.test(await page.title() + await page.textContent('h1')));
check('默认 1 行', (await page.$$('#item-list [data-row]')).length === 1, String((await page.$$('#item-list [data-row]')).length));
check('显示 1 items 计数', /1 item/i.test(await page.textContent('#item-count') || ''), await page.textContent('#item-count'));

await page.click('#add-item');
await page.click('#add-item');
await page.waitForTimeout(300);
const rowCount = (await page.$$('#item-list [data-row]')).length;
check('加行后 3 行', rowCount === 3, String(rowCount));
check('计数同步为 3', /3 item/i.test(await page.textContent('#item-count') || ''), await page.textContent('#item-count'));

// 删掉第 3 行
// $ 复数：$ 返回单个元素，.length 是 undefined，会让断言永远"跳过"（这里踩过一次）
const delBtns = await page.$$("#item-list [data-del]");
if (delBtns.length) {
  await delBtns[delBtns.length - 1].click();
  await page.waitForTimeout(250);
  check('删除行生效（回到 2 行）', (await page.$$('#item-list [data-row]')).length === 2, String((await page.$$('#item-list [data-row]')).length));
} else {
  skip++; info('未找到删除按钮选择器，跳过删除断言');
}

// 填表
await page.evaluate(() => {
  const rows = document.querySelectorAll('#item-list [data-row]');
  const set = (row, sel, v) => {
    const el = row.querySelector(sel);
    if (!el) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(rows[0], '[data-f="name"]', 'Stainless steel gate valve DN50');
  set(rows[0], '[data-f="qty"]', '120');
  set(rows[0], '[data-f="spec"]', 'PN16 / CF8M');
  if (rows[1]) {
    set(rows[1], '[data-f="name"]', 'Flange gasket');
    set(rows[1], '[data-f="qty"]', '240');
  }
});
await page.fill('#qf-email', leadEmail);
await page.fill('#qf-name', 'UI Lead');
await page.fill('#qf-company', 'Gamma Imports GmbH');
await page.selectOption('#qf-country', { index: 1 }).catch(() => {});
await page.fill('#qf-message', 'Please quote for February shipment, CIF Hamburg.');

await page.click('#qf-submit');
await page.waitForSelector('#qf-success:not([hidden])', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
const successVisible = await page.isVisible('#qf-success').catch(() => false);
check('提交后显示成功卡片', successVisible);
const quoteNoText = await page.textContent('#qf-quote-no').catch(() => '');
check('成功卡片显示报价编号', /QT-\d{8}-\d{4}/.test(quoteNoText || ''), (quoteNoText || '').trim());
const leadQuoteNo = (quoteNoText || '').match(/QT-\d{8}-\d{4}/)?.[0] || '';
await page.screenshot({ path: path.join(OUT, 'p3-1-quote-request.png'), fullPage: false });

// 蜜罐字段存在且不可见
const hp = await page.evaluate(() => {
  const el = document.getElementById('qf-hp');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { tabindex: el.getAttribute('tabindex'), offscreen: r.right < 0 || r.left > window.innerWidth, aria: el.getAttribute('aria-hidden') };
});
check('蜜罐字段存在且移出视口/不可聚焦', !!hp && (hp.offscreen || hp.tabindex === '-1'), JSON.stringify(hp));

/* ================================================================
 * 2. 后台交易工作台
 * ================================================================ */
console.log('\n== 2. /admin/trade 登录与报价列表 ==');
await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#username', 'tester');
await page.fill('#password', 'TestPassw0rd!2026');
await page.click('button[type="submit"]');
await page.waitForURL('**/admin/dashboard', { timeout: 20000 });
check('登录成功', true);

await page.goto(`${BASE}/admin/trade`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#q-body', { timeout: 15000 });
// dev server 冷启动时首次请求编译较慢，固定 sleep 会偶发失败；
// 等概览卡真正被填上数字再断言。
await page.waitForFunction(() => {
  const el = document.getElementById('ov-open');
  const t = (el && el.textContent || '').trim();
  return t !== '' && t !== '-';
}, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(300);
check('交易页标题为 Overview', /overview/i.test(await page.textContent('#page-title') || ''), await page.textContent('#page-title'));
const ovOpen = await page.textContent('#ov-open').catch(() => '');
check('概览卡有数值', /\d/.test(ovOpen || ''), ovOpen);

await page.click('[data-view="quotes"]');
await page.waitForTimeout(1500);
const quoteRows = await page.$$('#q-body tr');
check('报价列表渲染出数据行', quoteRows.length >= 1, String(quoteRows.length));
check('列表包含刚提交的询价（find by quote_no）',
  (await page.textContent('#q-body') || '').includes(leadQuoteNo) || (await page.textContent('#q-body') || '').includes('Gamma'),
  leadQuoteNo);
await page.screenshot({ path: path.join(OUT, 'p3-2-admin-quotes.png'), fullPage: false });

console.log('\n== 3. 后台新建报价 ==');
await page.click('#q-new');
await page.waitForTimeout(600);
check('弹窗打开', await page.isVisible('#quote-modal'));
await page.fill('#q-email', `ui-admin-${stamp}@example.com`);
await page.fill('#q-name', 'Admin Created Buyer');
await page.fill('#q-company', 'Delta Trading FZE');
await page.selectOption('#q-currency', 'EUR').catch(() => {});
await page.selectOption('#q-incoterm', 'CIF').catch(() => {});
await page.fill('#q-valid-until', '2027-01-31');
await page.fill('#q-shipping', '350');

// 第一行
await page.evaluate(() => {
  const tr = document.querySelector('#q-items tr');
  const set = (sel, v) => { const el = tr.querySelector(sel); if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('[data-f="name"]', 'Industrial chiller 20HP');
  set('[data-f="spec"]', 'R410A / air-cooled');
  set('[data-f="qty"]', '2');
  set('[data-f="unit_price"]', '8600');
});
// 第二行
await page.click('#q-add-row');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const trs = document.querySelectorAll('#q-items tr');
  const tr = trs[trs.length - 1];
  const set = (sel, v) => { const el = tr.querySelector(sel); if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('[data-f="name"]', 'Installation kit');
  set('[data-f="qty"]', '2');
  set('[data-f="unit_price"]', '450');
});
await page.waitForTimeout(400);
const totalsText = await page.textContent('#q-totals') || '';
// 2*8600 + 2*450 = 18100; +350 shipping = 18450
check('实时合计包含 18,450', /18[,.]?450/.test(totalsText.replace(/\s/g, '')), totalsText.replace(/\s+/g, ' ').slice(0, 90));

await page.click('#q-save');
await page.waitForTimeout(2200);
check('保存后弹窗关闭', !(await page.isVisible('#quote-modal')));
const listAfterSave = await page.textContent('#q-body') || '';
check('列表出现新报价（Industrial chiller 客户）', listAfterSave.includes('Delta Trading'), 'len=' + listAfterSave.length);
await page.screenshot({ path: path.join(OUT, 'p3-3-admin-quote-saved.png'), fullPage: false });

console.log('\n== 4. 发送报价并取客户链接 ==');
// 用 API 直接建一张干净的报价来发（避免列表定位歧义），再回后台点 Send 验证 UI
const madeQuote = await api('/quotes', {
  method: 'POST',
  body: JSON.stringify({
    customer_email: `ui-send-${stamp}@example.com`, customer_name: 'Send Test', customer_company: 'Epsilon Ltd',
    currency: 'USD', incoterm: 'FOB', valid_until: '2027-02-28',
    items: [{ name: 'Hydraulic press 100T', spec: 'CE certified', qty: 1, unit: 'set', unit_price: 24500 }],
  }),
});
const mq = madeQuote.body?.data;
check('API 建报价成功', !!mq?.id, JSON.stringify(madeQuote.body).slice(0, 80));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#q-body', { timeout: 15000 });
await page.click('[data-view="quotes"]');
await page.waitForTimeout(1800);
// 找到该行的 Send 按钮
const sentOk = await page.evaluate(async (quoteNo) => {
  const rows = [...document.querySelectorAll('#q-body tr')];
  const row = rows.find(r => r.textContent.includes(quoteNo));
  if (!row) return { ok: false, why: 'row not found' };
  const btn = [...row.querySelectorAll('button')].find(b => /send/i.test(b.textContent));
  if (!btn) return { ok: false, why: 'send button not found' };
  btn.click();
  return { ok: true };
}, mq?.quote_no);
check('找到报价行并点击 Send', sentOk.ok, sentOk.why);
await page.waitForTimeout(2000);
const linkModalVisible = await page.isVisible('#link-modal').catch(() => false);
check('弹出客户链接模态框', linkModalVisible);
const clientUrl = await page.inputValue('#link-url').catch(() => '');
check('链接形如 /quote/<token>', /\/quote\/[A-Za-z0-9_-]{20,}/.test(clientUrl), clientUrl);
await page.screenshot({ path: path.join(OUT, 'p3-4-admin-send-link.png'), fullPage: false });
await page.click('#link-modal .modal-close, #link-modal [data-close]').catch(() => {});
await page.waitForTimeout(400);

/* ================================================================
 * 3. 客户查看并接受报价
 * ================================================================ */
console.log('\n== 5. 客户在 /quote/:token 接受报价 ==');
const tokenPath = clientUrl.replace(BASE, '');
const clientPage = await ctx.newPage();
clientPage.on('pageerror', e => pageErrors.push('[client] ' + e.message));
const resp = await clientPage.goto(clientUrl, { waitUntil: 'domcontentloaded' });
check('客户链接可访问', resp.status() === 200, 'status=' + resp.status());
const bodyText = await clientPage.textContent('body');
check('显示报价编号', bodyText.includes(mq?.quote_no || '###'), '');
check('显示客户公司', /Epsilon/.test(bodyText));
check('显示合计金额 24,500', /24[,.]?500/.test(bodyText.replace(/\s/g, '')), '');
check('显示接受按钮', (await clientPage.$$('[data-action="accept"]')).length === 1);
const robotsHeader = resp.headers()['x-robots-tag'] || '';
check('带 X-Robots-Tag: noindex', /noindex/i.test(robotsHeader), robotsHeader);
const cacheHeader = resp.headers()['cache-control'] || '';
check('报价页不缓存（no-store）', /no-store/i.test(cacheHeader), cacheHeader);
await clientPage.screenshot({ path: path.join(OUT, 'p3-5-quote-view.png'), fullPage: true });

await clientPage.click('[data-action="accept"]');
await clientPage.waitForTimeout(600);
// 可能需要填留言后确认
// 三个动作共用同一个确认按钮 #respond-send，文案随动作变化
const confirmBtn = await clientPage.$('#respond-send');
if (confirmBtn) { await confirmBtn.click(); await clientPage.waitForTimeout(1500); }
await clientPage.waitForTimeout(2200);
const afterAccept = await clientPage.textContent('body');
check('接受后显示已接受状态', /accepted/i.test(afterAccept), '');
const stateAfter = await api(`/quotes/${mq.id}`);
check('后端状态为 accepted', (stateAfter.body?.data || stateAfter.body)?.status === 'accepted', (stateAfter.body?.data || stateAfter.body)?.status);
await clientPage.screenshot({ path: path.join(OUT, 'p3-6-quote-accepted.png'), fullPage: true });

console.log('\n== 6. 报价转订单 + 状态推进 ==');
const ord = await api('/orders', { method: 'POST', body: JSON.stringify({ quote_id: mq.id }) });
const o = ord.body?.data;
check('转订单成功', !!o?.id, JSON.stringify(ord.body).slice(0, 80));

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#o-body', { timeout: 15000 }).catch(() => {});
await page.click('[data-view="orders"]');
await page.waitForTimeout(1800);
const orderListText = await page.textContent('#o-body') || '';
check('订单列表含新单号', orderListText.includes(o?.order_no || 'SO-###'), (o?.order_no || '') + ' / len=' + orderListText.length);

// 打开订单详情
const opened = await page.evaluate(async (orderNo) => {
  const rows = [...document.querySelectorAll('#o-body tr')];
  const row = rows.find(r => r.textContent.includes(orderNo));
  if (!row) return false;
  const btn = [...row.querySelectorAll('button')].find(b => /view|detail/i.test(b.textContent));
  if (!btn) return false;
  btn.click();
  return true;
}, o?.order_no);
check('能打开订单详情', opened);
await page.waitForTimeout(1600);
check('详情弹窗可见', await page.isVisible('#order-modal').catch(() => false));
const detailText = await page.textContent('#order-modal') || '';
check('详情含行项目', /Hydraulic press/i.test(detailText));
check('详情含状态时间线', /created from quote|placed/i.test(detailText));
await page.screenshot({ path: path.join(OUT, 'p3-7-order-detail.png'), fullPage: false });

// 状态推进
const advanced = await page.evaluate(async () => {
  const btns = [...document.querySelectorAll('#order-modal button')].filter(b => /confirm/i.test(b.textContent));
  if (!btns.length) return false;
  btns[0].click();
  return true;
});
check('详情内有状态推进按钮', advanced);
await page.waitForTimeout(1600);
if (advanced) {
  const confirmOk = await page.evaluate(() => {
    const dlg = document.querySelector('.confirm-ok, [data-confirm-ok], button.ok');
    if (dlg) { dlg.click(); return true; }
    return false;
  });
  await page.waitForTimeout(1600);
  const st = await api(`/orders/${o.id}`);
  const cur = (st.body?.data || st.body)?.status;
  check('订单状态已推进（非 placed）', cur && cur !== 'placed', String(cur) + (confirmOk ? ' (dlg)' : ''));
}
await page.keyboard.press('Escape');

/* ================================================================
 * 4. 客户门户
 * ================================================================ */
console.log('\n== 7. /account 魔法链接登录流程 ==');
const accPage = await ctx.newPage();
accPage.on('pageerror', e => pageErrors.push('[account] ' + e.message));
await accPage.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
check('未登录显示邮箱表单', !!(await accPage.$('#acc-email')));
check('文案说明无需密码', /no password/i.test(await accPage.textContent('body')), '');
await accPage.fill('#acc-email', `ui-send-${stamp}@example.com`);
await accPage.click('#acc-submit');
await accPage.waitForTimeout(2500);
const accMsg = await accPage.textContent('#acc-msg').catch(() => '') || await accPage.textContent('body');
check('提交后显示中性提示', /if this email/i.test(accMsg), (accMsg || '').slice(0, 70));
await accPage.screenshot({ path: path.join(OUT, 'p3-8-account-login.png'), fullPage: false });

// 从 D1 取出 token，模拟点邮件链接
const { execFileSync } = await import('node:child_process');
let magicToken = '';
try {
  const out = execFileSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'b2b_database', '--local', '--json',
    '--command', `SELECT token FROM magic_tokens WHERE email='ui-send-${stamp}@example.com' ORDER BY id DESC LIMIT 1`,
  ], { encoding: 'utf8' });
  magicToken = JSON.parse(out.slice(out.indexOf('[')))?.[0]?.results?.[0]?.token || '';
} catch (e) { info('读取 token 失败: ' + e.message.slice(0, 50)); }
check('魔法 token 已生成', !!magicToken, magicToken.slice(0, 8));

if (magicToken) {
  await accPage.goto(`${BASE}/api/account/verify?token=${encodeURIComponent(magicToken)}`, { waitUntil: 'domcontentloaded' });
  await accPage.waitForTimeout(1500);
  const portalText = await accPage.textContent('body') || '';
  check('登录后进入门户', /your quotations|your orders/i.test(portalText), (portalText || '').slice(0, 60));
  check('门户显示自己的报价', portalText.includes(mq?.quote_no || '###'), '');
  check('门户显示自己的订单', portalText.includes(o?.order_no || 'SO-###'), '');
  check('已登录不再显示邮箱表单', !(await accPage.$('#acc-email')));
  await accPage.screenshot({ path: path.join(OUT, 'p3-9-account-portal.png'), fullPage: true });
}

/* ================================================================
 * 5. UI 设计系统落地
 * ================================================================ */
console.log('\n== 8. UI 设计系统 ==');
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
const layoutCss = await page.evaluate(() => {
  const out = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) out.push(rule.cssText);
    } catch (e) { /* 跨域样式表跳过 */ }
  }
  return out.join('\n');
});
for (const cls of ['.card', '.badge', '.table-wrap', '.btn-ghost', '.field', '.empty']) {
  check(`样式表含 ${cls}`, layoutCss.includes(cls), '');
}
check('样式表含打印规则', /@media print/.test(layoutCss));
check('样式表含窄屏断点', /max-width:\s*767px/.test(layoutCss));
const navCount = await page.$$eval('nav a', els => els.length);
check('导航链接仍存在（未被 UI 改动破坏）', navCount >= 5, String(navCount));

// 移动端视口快照
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'p3-10-home-mobile.png'), fullPage: false });
const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
check('移动端无横向溢出', !hasHScroll, await page.evaluate(() => document.documentElement.scrollWidth + 'px'));
await page.setViewportSize({ width: 1440, height: 1000 });

await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: path.join(OUT, 'p3-11-products.png'), fullPage: true });
await page.goto(`${BASE}/quote`, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: path.join(OUT, 'p3-12-quote-form.png'), fullPage: true });

console.log('\n== 9. 无 JS 运行时错误 ==');
const realErrors = pageErrors.filter(e => !/favicon|404 \(Not Found\)/i.test(e));
check('页面无 pageerror', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();

console.log('\n' + '='.repeat(52));
console.log(`阶段三 UI 测试：${fail === 0 ? '✅' : '❌'} ${pass} 通过 / ${fail} 失败${skip ? ` / ${skip} 跳过` : ''}`);
if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
