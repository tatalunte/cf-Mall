/**
 * 阶段二B UI 测试：登录审计 + 失败锁定 + 登录页信息泄露
 * 运行： node scripts/ui-test-phase2b.mjs [baseUrl]
 *
 * 注意：锁定测试只对「不存在的用户名」发失败请求，
 * 绝不对真实管理员反复试错，否则会把测试账号锁 15 分钟。
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-artifacts';
const USER = process.env.ADMIN_USERNAME || 'tester';
const PASS = process.env.ADMIN_PASSWORD || 'TestPassw0rd!2026';

fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const fakeUser = 'lockprobe-' + Date.now().toString(36);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
page.on('pageerror', e => { pageErrors.push(e.message); console.log('   ⚠️ pageerror:', e.message); });

const login = (u, p) => page.evaluate(async ({ u, p }) => {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  return { status: res.status, retryAfter: res.headers.get('Retry-After'), body: await res.json().catch(() => null) };
}, { u, p });

try {
  console.log('\n== 1. 登录页不再泄露默认口令 ==');
  const res = await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  const html = await res.text();
  check('登录页 200', res.status() === 200, `status=${res.status()}`);
  check('不出现 admin123 提示', !html.includes('admin123'));
  check('不出现 "Default credentials"', !/default\s+credentials/i.test(html));

  console.log('\n== 2. 失败次数递减提示 ==');
  const attempt1 = await login(fakeUser, 'wrong-password');
  check('首次失败返回 401', attempt1.status === 401, `status=${attempt1.status}`);
  check('返回剩余次数 4', attempt1.body?.attempts_left === 4, String(attempt1.body?.attempts_left));
  check('错误文案不暴露用户是否存在', /Invalid username or password/.test(attempt1.body?.error || ''), attempt1.body?.error);

  const attempt2 = await login(fakeUser, 'wrong-again');
  check('第二次剩余次数 3', attempt2.body?.attempts_left === 3, String(attempt2.body?.attempts_left));

  console.log('\n== 3. 第 6 次被锁定（15 分钟窗口内 5 次失败）==');
  await login(fakeUser, 'wrong-3');
  await login(fakeUser, 'wrong-4');
  const fifth = await login(fakeUser, 'wrong-5');
  check('第 5 次仍为 401', fifth.status === 401, `status=${fifth.status} left=${fifth.body?.attempts_left}`);
  const sixth = await login(fakeUser, 'wrong-6');
  check('第 6 次返回 429', sixth.status === 429, `status=${sixth.status}`);
  check('带 Retry-After 头', Number(sixth.retryAfter) > 0, `Retry-After=${sixth.retryAfter}`);
  check('错误文案说明需等待', /Too many failed attempts/i.test(sixth.body?.error || ''), sixth.body?.error);
  check('带 retry_after 秒数', Number(sixth.body?.retry_after) > 0, String(sixth.body?.retry_after));

  console.log('\n== 4. 真实账号不受影响 ==');
  const ok = await login(USER, PASS);
  check('正确口令仍可登录', ok.status === 200 && ok.body?.success === true, `status=${ok.status}`);
  const token = ok.body?.data?.token;
  check('返回 token', !!token);

  console.log('\n== 5. 登录审计可查 ==');
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  const logs = await page.evaluate(async (t) => {
    const res = await fetch('/api/admin/login-logs', { headers: { Authorization: 'Bearer ' + t } });
    return { status: res.status, body: await res.json() };
  }, token);
  check('审计接口 200', logs.status === 200, `status=${logs.status}`);
  const rows = logs.body?.data || [];
  check('有日志记录', rows.length > 0, `${rows.length} 条`);
  check('记录了成功登录', rows.some(r => r.ok === 1 && r.username === USER), `${rows.filter(r => r.ok === 1).length} 条成功`);
  const failRows = rows.filter(r => r.ok === 0 && r.username === fakeUser);
  check('记录了失败尝试', failRows.length >= 4, `${failRows.length} 条失败`);
  check('失败原因可读', failRows.some(r => /no such user|bad password/.test(r.reason || '')), failRows[0]?.reason);
  check('记录了 UA', rows.some(r => !!r.user_agent));

  console.log('\n== 6. 审计仅超管可见 ==');
  const anon = await browser.newPage();
  const anonRes = await anon.goto(`${BASE}/api/admin/login-logs`, { waitUntil: 'domcontentloaded' });
  check('匿名访问审计 401', anonRes.status() === 401, `status=${anonRes.status()}`);
  await anon.close();

  console.log('\n== 7. 后台设置页审计表格 ==');
  await page.evaluate((t) => {
    localStorage.setItem('admin_token', t);
    localStorage.setItem('admin_role', 'super_admin');
  }, token);
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.click('a[data-tab="settings"]');
  await page.waitForSelector('#settings-tab', { state: 'visible' });
  await page.waitForSelector('#login-logs table', { timeout: 15000 });
  const logRows = await page.$$eval('#login-logs tbody tr', els => els.length);
  check('审计表格渲染', logRows > 0, `${logRows} 行`);
  const logText = (await page.textContent('#login-logs')) || '';
  check('表格含失败记录', logText.includes(fakeUser));
  check('表格含 ok 状态', /ok/.test(logText));
  await page.screenshot({ path: `${OUT}/phase2b-login-logs.png`, fullPage: false });

  console.log('\n== 8. 登录错误文案透传到 UI ==');
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', fakeUser);
  await page.fill('#password', 'still-wrong');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#login-error', { state: 'visible', timeout: 10000 });
  const errText = (await page.textContent('#login-error')) || '';
  // 该账号已被锁，应显示服务端的 429 文案而不是 "HTTP error! status: 429"
  check('显示可读的锁定提示', /Too many failed attempts/i.test(errText), errText.trim());
  check('不再出现裸 HTTP 状态串', !/HTTP error! status/.test(errText), errText.trim());

  console.log('\n== 9. 页面无 JS 运行时错误 ==');
  check('无 pageerror', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  fail++;
  console.error('\n💥 测试执行异常:', err.message);
  console.error(err.stack);
} finally {
  await browser.close();
}

console.log(`\n${'='.repeat(50)}`);
console.log(`阶段二B UI 测试：✅ ${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
