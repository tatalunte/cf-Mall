/**
 * 后台「一键生成译文」UI 流程测试
 *
 * 用 Playwright 的 route mock 拦截 /api/translate，因此不消耗 Workers AI 额度，
 * 也不需要本地 wrangler 登录 AI 服务。真实后端链路（鉴权 / 中文→繁中 / 参数清洗）
 * 由 scripts/test-translate.mjs 覆盖。
 *
 * 运行： node scripts/ui-test-translate.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));
const USER = process.env.ADMIN_USERNAME || 'tester';
const PASS = process.env.ADMIN_PASSWORD || 'TestPassw0rd!2026';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

// 记录前端发来的请求体，用来验证「源语言自动检测」「一次只翻一个语种」
const calls = [];
let mockStatus = 200;
await page.route('**/api/translate', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  calls.push(body);
  if (mockStatus !== 200) {
    await route.fulfill({
      status: mockStatus, contentType: 'application/json',
      body: JSON.stringify({ error: 'Workers AI 未绑定（测试模拟）' }),
    });
    return;
  }
  const translations = {};
  Object.keys(body.fields || {}).forEach(f => {
    translations[f] = `[MOCK-${body.target}] ${body.fields[f]}`;
  });
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: { translations, skipped: [], failed: [], engine: 'mock', target: body.target, sourceLang: body.sourceLang },
    }),
  });
});

try {
  console.log('\n== 1. 登录 ==');
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
  check('登录成功', page.url().includes('/admin/dashboard'));

  console.log('\n== 2. 产品弹窗：中文发布 → 一键生成其它语种 ==');
  await page.click('a[data-tab="products"]');
  await page.waitForSelector('#products-tab', { state: 'visible', timeout: 15000 });
  await page.click('#add-product-btn');
  await page.waitForSelector('#product-modal.active', { timeout: 10000 });
  check('产品弹窗有「一键生成译文」按钮', !!(await page.$('#tr-auto-btn')));
  check('有源语言下拉与写入方式', !!(await page.$('#tr-source-lang')) && !!(await page.$('#tr-mode')));

  await page.fill('#product-name', '不锈钢离心泵 HR-CP100');
  await page.fill('#product-description', '适用于水处理的耐腐蚀泵，质量认证齐全');
  await page.fill('#product-seo-title', '不锈钢离心泵厂家');

  // fill 模式不能覆盖人工译文：先手工写一条西语名称
  await page.fill('#tr-es-name', '人工写好的西语名称');

  calls.length = 0;
  await page.click('#tr-auto-btn');
  await page.waitForFunction(() => {
    const b = document.getElementById('tr-auto-btn');
    return b && !b.disabled;
  }, { timeout: 20000 });

  check('一次请求只翻一个语种，共 4 次', calls.length === 4, `实际 ${calls.length}`);
  const targets = calls.map(c => c.target);
  check('目标语种覆盖 es/ar/zh/zh-TW',
    JSON.stringify(targets) === JSON.stringify(['es', 'ar', 'zh', 'zh-TW']), targets.join(','));
  check('中文原文被自动识别为 zh', calls.every(c => c.sourceLang === 'zh'), calls[0]?.sourceLang);
  check('请求带上了主字段', !!(calls[0]?.fields?.name && calls[0]?.fields?.description), Object.keys(calls[0]?.fields || {}).join(','));
  check('fill 模式传给服务端已有译文',
    calls.find(c => c.target === 'es')?.existing?.name === '人工写好的西语名称');

  const esName = await page.inputValue('#tr-es-name');
  check('fill 模式不覆盖人工译文', esName === '人工写好的西语名称', esName);
  const esDesc = await page.inputValue('#tr-es-description');
  check('空字段被填入译文', esDesc.startsWith('[MOCK-es]'), esDesc);
  const twName = await page.inputValue('#tr-zh-TW-name');
  check('繁体中文 Tab 也被填入', twName.startsWith('[MOCK-zh-TW]'), twName);
  const arName = await page.inputValue('#tr-ar-name');
  check('阿语 Tab 也被填入', arName.startsWith('[MOCK-ar]'), arName);

  const jsonPreview = await page.inputValue('#product-translations');
  check('JSON 预览已同步（保存时以此为准）', jsonPreview.includes('[MOCK-es]') && jsonPreview.includes('人工写好的西语名称'), jsonPreview.slice(0, 90));
  const dots = await page.$$eval('#product-tr-tabs .tr-tab .dot', els => els.filter(e => e.style.display !== 'none').length);
  check('4 个语种 Tab 都亮起绿点', dots === 4, `亮起 ${dots}`);

  console.log('\n== 3. 错误提示：AI 未绑定时不能静默 ==');
  mockStatus = 503;
  calls.length = 0;
  await page.click('#tr-auto-btn');
  await page.waitForFunction(() => {
    const b = document.getElementById('tr-auto-btn');
    return b && !b.disabled;
  }, { timeout: 20000 });
  const prog = await page.textContent('#tr-progress');
  check('失败时给出可读提示', /失败|503|Workers AI/.test(prog || ''), (prog || '').slice(0, 110));
  mockStatus = 200;

  console.log('\n== 4. 内容管理（新闻）同样可一键生成 ==');
  await page.goto(`${BASE}/admin/content/posts`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tbody tr', { timeout: 15000 });
  await page.click('button:has-text("+ New")');
  await page.waitForSelector('#modal.active', { timeout: 10000 });
  check('新闻弹窗有翻译工具栏', !!(await page.$('#tr-auto-btn')));

  await page.fill('[data-name="title"]', '不锈钢离心泵通过 ISO 9001 认证');
  await page.fill('[data-name="excerpt"]', '面向水处理行业的新产品');
  calls.length = 0;
  await page.click('#tr-auto-btn');
  await page.waitForFunction(() => {
    const b = document.getElementById('tr-auto-btn');
    return b && !b.disabled;
  }, { timeout: 20000 });

  check('内容页也按语种逐个调用', calls.length === 4, `实际 ${calls.length}`);
  check('内容页中文被识别为 zh', calls.every(c => c.sourceLang === 'zh'), calls[0]?.sourceLang);
  check('内容页字段来自 transFields 配置',
    !!(calls[0]?.fields?.title && calls[0]?.fields?.excerpt), Object.keys(calls[0]?.fields || {}).join(','));
  const newsEsTitle = await page.inputValue('[data-tr-lang="es"][data-tr-field="title"]');
  check('新闻西语标题已回填', newsEsTitle.startsWith('[MOCK-es]'), newsEsTitle);

  check('全程无 JS 运行时错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  fail++;
  console.error('\n💥 测试异常：', e.message);
  console.error(e.stack);
} finally {
  await browser.close();
}

console.log('\n' + '='.repeat(50));
console.log(`一键翻译 UI 测试：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
