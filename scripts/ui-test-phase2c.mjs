/**
 * 阶段二C UI 测试：邮件订阅双 opt-in + 邮件模板 KV 化
 * 运行： node scripts/ui-test-phase2c.mjs [baseUrl]
 *
 * 依赖 .dev.vars 里的 DEV_MAIL_ECHO=1（本地无 Resend Key 时把确认链接回传），
 * 该变量只用于本地/预览，生产不设置。
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

const stamp = Date.now().toString(36);
const emailA = `optin-${stamp}@example.com`;
const emailB = `hp-${stamp}@example.com`;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
page.on('pageerror', e => { pageErrors.push(e.message); console.log('   ⚠️ pageerror:', e.message); });

const api = (path, init) => page.evaluate(async ({ path, init }) => {
  const url = path.startsWith('/api/') ? path : '/api' + path;
  const token = localStorage.getItem('admin_token');
  const res = await fetch(url, {
    ...(init || {}),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...((init || {}).headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}, { path, init });

try {
  console.log('\n== 1. 页脚订阅表单 ==');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  check('存在订阅表单', !!(await page.$('#subscribe-form')));
  check('存在邮箱输入框', !!(await page.$('#subscribe-email')));
  check('蜜罐字段存在且不可见', await page.$eval('#subscribe-hp', el => {
    const s = getComputedStyle(el);
    return s.position === 'absolute' && Number(s.opacity) === 0;
  }));
  const ph = await page.getAttribute('#subscribe-email', 'placeholder');
  check('占位符使用本地化文案', !!ph && /email/i.test(ph), ph);

  await page.goto(`${BASE}/es/`, { waitUntil: 'domcontentloaded' });
  const phEs = await page.getAttribute('#subscribe-email', 'placeholder');
  check('西语页占位符为西语文案', !!phEs && /correo/i.test(phEs), phEs);

  console.log('\n== 2. 表单提交（真实交互）==');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.fill('#subscribe-email', emailA);
  await page.click('#subscribe-form button[type="submit"]');
  await page.waitForSelector('#subscribe-msg', { state: 'visible', timeout: 15000 });
  const okMsg = (await page.textContent('#subscribe-msg')) || '';
  check('显示成功提示', /confirm/i.test(okMsg), okMsg.trim());
  const inputCleared = await page.inputValue('#subscribe-email');
  check('提交后输入框清空', inputCleared === '');

  console.log('\n== 3. 非法邮箱被拒 ==');
  const bad = await api('/subscribe', { method: 'POST', body: JSON.stringify({ email: 'not-an-email' }) });
  check('非法邮箱返回 400', bad.status === 400, `status=${bad.status}`);
  check('错误文案可读', /valid email/i.test(bad.body?.error || ''), bad.body?.error);

  console.log('\n== 4. 蜜罐命中不建档 ==');
  const hp = await api('/subscribe', {
    method: 'POST',
    body: JSON.stringify({ email: emailB, website: 'http://spam.example' }),
  });
  check('蜜罐返回假成功 200', hp.status === 200 && hp.body?.success === true, `status=${hp.status}`);

  // 登录后台核对数据库
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });

  const list1 = await api('/subscribers');
  const rows1 = list1.body?.data || [];
  check('订阅名单接口 200', list1.status === 200, `status=${list1.status}`);
  const rowA = rows1.find(r => r.email === emailA);
  check('提交的邮箱已入库', !!rowA, rowA?.status);
  check('初始状态为 pending（双 opt-in）', rowA?.status === 'pending', rowA?.status);
  check('蜜罐邮箱未被建档', !rows1.some(r => r.email === emailB));

  console.log('\n== 5. 确认链接生效 ==');
  const confirmUrl = await page.evaluate(async (email) => {
    // 重新提交一次拿到确认链接（DEV_MAIL_ECHO=1 时回传）
    const res = await fetch('/api/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const j = await res.json();
    return j.dev_confirm_url || null;
  }, emailA);
  check('本地能拿到确认链接（DEV_MAIL_ECHO）', !!confirmUrl, confirmUrl ? 'url ok' : 'missing');

  if (confirmUrl) {
    await page.goto(confirmUrl, { waitUntil: 'domcontentloaded' });
    const h1 = (await page.textContent('h1')) || '';
    check('确认页显示已订阅', /subscribed/i.test(h1), h1.trim());

    const list2 = await api('/subscribers');
    const rowA2 = (list2.body?.data || []).find(r => r.email === emailA);
    check('状态变为 confirmed', rowA2?.status === 'confirmed', rowA2?.status);
    check('记录确认时间', !!rowA2?.confirmed_at, rowA2?.confirmed_at);

    // 重复点确认：幂等，不报错
    const again = await page.goto(confirmUrl, { waitUntil: 'domcontentloaded' });
    check('重复确认幂等（200）', again.status() === 200, `status=${again.status()}`);

    const list3 = await api('/subscribers');
    const dupes = (list3.body?.data || []).filter(r => r.email === emailA);
    check('同邮箱只有一条记录', dupes.length === 1, `${dupes.length} 条`);

    console.log('\n== 6. 篡改 token 被拒 ==');
    const tampered = confirmUrl.replace(/token=[^&]+/, 'token=eyJmYWtlIjoxfQ.deadbeef');
    await page.goto(tampered, { waitUntil: 'domcontentloaded' });
    const h1b = (await page.textContent('h1')) || '';
    check('伪造 token 显示无效', /invalid|expired/i.test(h1b), h1b.trim());
    const list4 = await api('/subscribers');
    const stillConfirmed = (list4.body?.data || []).find(r => r.email === emailA);
    check('伪造请求未改变状态', stillConfirmed?.status === 'confirmed', stillConfirmed?.status);

    console.log('\n== 7. 退订 token 与确认 token 分离 ==');
    // 退订链接只出现在欢迎信里，这里无法拿到真实 unsub token；
    // 但可以验证「拿确认用的 token 去退订」会被拒——这正是防止一链多用的关键。
    const misuse = await page.goto(confirmUrl.replace('/confirm', '/unsubscribe'), { waitUntil: 'domcontentloaded' });
    const h1c = (await page.textContent('h1')) || '';
    check('用确认 token 退订被拒', /invalid|expired/i.test(h1c), h1c.trim());
    const list5 = await api('/subscribers');
    const notUnsubbed = (list5.body?.data || []).find(r => r.email === emailA);
    check('被拒后状态不变', notUnsubbed?.status === 'confirmed', notUnsubbed?.status);
  }

  console.log('\n== 8. 邮件模板读写 ==');
  const tpl = await api('/settings/mail-templates');
  check('模板接口 200', tpl.status === 200, `status=${tpl.status}`);
  check('返回默认模板', !!tpl.body?.defaults?.inquiry_subject, tpl.body?.defaults?.inquiry_subject);
  check('返回字段元数据', Array.isArray(tpl.body?.meta) && tpl.body.meta.length >= 8, `${tpl.body?.meta?.length} 项`);
  const originSubject = tpl.body?.data?.inquiry_subject;

  const newSubject = '[RFQ #{{id}}] {{product}} — {{company}} (action needed)';
  const saved = await api('/settings/mail-templates', {
    method: 'POST', body: JSON.stringify({ inquiry_subject: newSubject }),
  });
  check('保存模板 200', saved.status === 200 && saved.body?.success === true, `status=${saved.status}`);
  check('保存后读到新值', saved.body?.data?.inquiry_subject === newSubject, saved.body?.data?.inquiry_subject);

  const reread = await api('/settings/mail-templates');
  check('KV 持久化生效', reread.body?.data?.inquiry_subject === newSubject, reread.body?.data?.inquiry_subject);
  check('未修改的键保持默认', reread.body?.data?.auto_reply_subject === reread.body?.defaults?.auto_reply_subject,
    reread.body?.data?.auto_reply_subject);

  console.log('\n== 9. 模板编辑器 UI ==');
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.click('a[data-tab="settings"]');
  await page.waitForSelector('#settings-tab', { state: 'visible' });
  await page.waitForSelector('#mail-templates input[data-tpl]', { timeout: 15000 });
  const fieldCount = await page.$$eval('[data-tpl]', els => els.length);
  check('渲染出全部模板字段', fieldCount >= 8, `${fieldCount} 个`);
  const subjectVal = await page.inputValue('[data-tpl="inquiry_subject"]');
  check('编辑器回填已保存的主题', subjectVal === newSubject, subjectVal);
  const bodyIsTextarea = await page.$eval('[data-tpl="auto_reply_body"]', el => el.tagName === 'TEXTAREA');
  check('多行模板用 textarea', bodyIsTextarea);

  await page.fill('[data-tpl="inquiry_subject"]', '[UI Test #{{id}}] {{product}}');
  await page.click('button:has-text("Save templates")');
  await page.waitForTimeout(1500);
  const afterUi = await api('/settings/mail-templates');
  check('后台保存生效', afterUi.body?.data?.inquiry_subject === '[UI Test #{{id}}] {{product}}', afterUi.body?.data?.inquiry_subject);

  console.log('\n== 10. 恢复默认 ==');
  const reset = await api('/settings/mail-templates', { method: 'DELETE' });
  check('重置 200', reset.status === 200, `status=${reset.status}`);
  check('值回到默认', reset.body?.data?.inquiry_subject === tpl.body?.defaults?.inquiry_subject,
    reset.body?.data?.inquiry_subject);
  // 再读一次确认覆盖已被清除（不是只在响应里改了个值）
  const afterReset = await api('/settings/mail-templates');
  check('KV 覆盖已清除', afterReset.body?.data?.inquiry_subject === tpl.body?.defaults?.inquiry_subject,
    afterReset.body?.data?.inquiry_subject);

  console.log('\n== 11. 订阅名单 UI ==');
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.click('a[data-tab="settings"]');
  await page.waitForSelector('#settings-tab', { state: 'visible' });
  await page.waitForSelector('#subscriber-list table', { timeout: 15000 });
  const statText = (await page.textContent('#subscriber-stats')) || '';
  check('展示状态计数', /confirmed/.test(statText), statText.trim().slice(0, 60));
  const subText = (await page.textContent('#subscriber-list')) || '';
  check('列表包含刚确认的邮箱', subText.includes(emailA));
  await page.screenshot({ path: `${OUT}/phase2c-subscribers.png`, fullPage: false });

  console.log('\n== 12. 鉴权 ==');
  const anon = await browser.newPage();
  const anonRes = await anon.goto(`${BASE}/api/subscribers`, { waitUntil: 'domcontentloaded' });
  check('匿名访问订阅名单 401', anonRes.status() === 401, `status=${anonRes.status()}`);
  await anon.close();

  const anonTpl = await browser.newPage();
  const anonTplRes = await anonTpl.goto(`${BASE}/api/settings/mail-templates`, { waitUntil: 'domcontentloaded' });
  check('匿名访问模板 401', anonTplRes.status() === 401, `status=${anonTplRes.status()}`);
  await anonTpl.close();

  console.log('\n== 13. 页面无 JS 运行时错误 ==');
  check('无 pageerror', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  fail++;
  console.error('\n💥 测试执行异常:', err.message);
  console.error(err.stack);
} finally {
  await browser.close();
}

console.log(`\n${'='.repeat(50)}`);
console.log(`阶段二C UI 测试：✅ ${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
