/**
 * 后台「翻译引擎设置」UI 流程测试（1.4.0）
 *
 * 全部后端请求用 page.route mock：不消耗 Workers AI / 第三方模型额度，也不改真实 KV。
 * 真实接口契约（鉴权、SSRF、加解密、公开接口不泄露）由 scripts/test-translation-config.mjs 覆盖。
 *
 * 运行： node scripts/ui-test-translation-settings.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));
// 必须用真正的 super_admin：翻译引擎配置走 requireSuperAdmin，普通 admin 看不到可用状态
const USER = process.env.ADMIN_USERNAME || 'demo';
const PASS = process.env.ADMIN_PASSWORD || 'Demo2026!b2b';

let pass = 0, fail = 0;
const fails = [];
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));

let savedCfg = { engine: 'workers_ai', base_url: '', model: '', api_key_set: false, temperature: 0.2 };
const saveCalls = [];
const testCalls = [];
let saveStatus = 200, saveError = '';
let testStatus = 200, testError = '';

const isPath = (url, p) => { try { return new URL(url).pathname === p; } catch { return false; } };

await page.route('**/api/settings/translation', async (route) => {
  const method = route.request().method();
  if (method === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: savedCfg }) });
    return;
  }
  const body = JSON.parse(route.request().postData() || '{}');
  saveCalls.push(body);
  if (saveStatus !== 200) {
    await route.fulfill({ status: saveStatus, contentType: 'application/json', body: JSON.stringify({ error: saveError }) });
    return;
  }
  savedCfg = {
    engine: body.engine || 'workers_ai',
    base_url: body.base_url || '', model: body.model || '',
    api_key_set: savedCfg.api_key_set || Boolean(body.api_key),
    temperature: body.temperature ?? 0.2,
  };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: savedCfg }) });
});

await page.route('**/api/settings/translation/test', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  testCalls.push(body);
  if (testStatus !== 200) {
    await route.fulfill({ status: testStatus, contentType: 'application/json', body: JSON.stringify({ success: false, error: testError }) });
    return;
  }
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: { ok: true, engine: 'openai', model: 'openai:gpt-4o-mini', latencyMs: 321, sample: 'Bomba de acero inoxidable' },
    }),
  });
});

try {
  console.log('\n== 1. 登录并进入设置页 ==');
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
  check('超管登录成功', page.url().includes('/admin/dashboard'));

  await page.click('a[data-tab="settings"]');
  await page.waitForSelector('#settings-tab', { state: 'visible', timeout: 15000 });
  check('翻译引擎卡片渲染', !!(await page.$('#translation-card')));
  check('默认选中 Workers AI', (await page.inputValue('#tr-engine')) === 'workers_ai');
  check('默认隐藏自定义模型字段', await page.$eval('#tr-openai-fields', el => getComputedStyle(el).display === 'none'));
  check('默认状态提示可见', (await page.textContent('#tr-engine-status') || '').includes('Workers AI'));

  console.log('\n== 2. 切到自定义 OpenAI 兼容模型 ==');
  await page.selectOption('#tr-engine', 'openai');
  check('自定义字段展开', await page.$eval('#tr-openai-fields', el => getComputedStyle(el).display !== 'none'));
  check('API Key 输入框是 password 且关闭自动填充',
    await page.$eval('#tr-api-key', el => el.type === 'password' && el.autocomplete === 'new-password'));

  await page.fill('#tr-base-url', 'https://api.openai.com/v1');
  await page.fill('#tr-model', 'gpt-4o-mini');
  await page.fill('#tr-api-key', 'sk-ui-test-key');
  await page.fill('#tr-temperature', '0.3');

  await page.click('#tr-save-btn');
  await page.waitForFunction(() => document.querySelector('#tr-engine-status')?.textContent?.includes('Saved'), { timeout: 10000 });
  check('保存发出一次 POST', saveCalls.length === 1);
  const s = saveCalls[0] || {};
  check('保存体含引擎与端点', s.engine === 'openai' && s.base_url === 'https://api.openai.com/v1' && s.model === 'gpt-4o-mini');
  check('保存体带明文密钥（仅本次输入）', s.api_key === 'sk-ui-test-key');
  check('保存体带温度与 clear 标记', Number(s.temperature) === 0.3 && s.clear_api_key === false);
  check('保存后密码框被清空（不回显密钥）', (await page.inputValue('#tr-api-key')) === '');
  check('保存后提示「已保存密钥」', (await page.textContent('#tr-key-status') || '').includes('encrypted'));
  check('页面 DOM 里搜不到明文密钥', !(await page.content()).includes('sk-ui-test-key'));

  console.log('\n== 3. 测试连接 ==');
  await page.click('#tr-test-btn');
  await page.waitForFunction(() => document.querySelector('#tr-engine-status')?.textContent?.includes('OK'), { timeout: 10000 });
  check('测试连接发出一次 POST', testCalls.length === 1);
  check('测试体用当前表单值', (testCalls[0] || {}).engine === 'openai' && (testCalls[0] || {}).model === 'gpt-4o-mini');
  const statusText = (await page.textContent('#tr-engine-status')) || '';
  check('状态栏显示模型与延迟', statusText.includes('openai:gpt-4o-mini') && statusText.includes('321ms'), statusText);

  console.log('\n== 4. 失败分支：不能静默 ==');
  testStatus = 502; testError = '上游返回 HTTP 401：invalid api key';
  await page.click('#tr-test-btn');
  await page.waitForFunction(() => document.querySelector('#tr-engine-status')?.textContent?.includes('HTTP 401'), { timeout: 10000 });
  check('连接失败时把原因显示出来', (await page.textContent('#tr-engine-status') || '').includes('invalid api key'));
  testStatus = 200; testError = '';

  saveStatus = 400; saveError = 'API Base URL 必须是公网域名，不能是 IP / 内网 / localhost';
  await page.fill('#tr-base-url', 'https://192.168.1.2/v1');
  await page.click('#tr-save-btn');
  await page.waitForFunction(() => document.querySelector('#tr-engine-status')?.textContent?.includes('公网域名'), { timeout: 10000 });
  check('服务端拒绝内网地址时前端显示原因', (await page.textContent('#tr-engine-status') || '').includes('公网域名'));
  saveStatus = 200; saveError = '';

  console.log('\n== 5. 切回默认引擎 ==');
  await page.selectOption('#tr-engine', 'workers_ai');
  check('切回后自定义字段收起', await page.$eval('#tr-openai-fields', el => getComputedStyle(el).display === 'none'));
  await page.click('#tr-save-btn');
  await page.waitForFunction(() => document.querySelector('#tr-engine-status')?.textContent?.includes('Saved'), { timeout: 10000 });
  const last = saveCalls[saveCalls.length - 1] || {};
  check('保存体 engine=workers_ai', last.engine === 'workers_ai');
  check('切回默认时不带新密钥', !last.api_key);
  check('全程无 JS 运行时错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  check('UI 流程未抛异常', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
}

console.log('\n' + '='.repeat(50));
console.log(`翻译引擎设置 UI 测试：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('失败项：' + fails.join('、'));
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
