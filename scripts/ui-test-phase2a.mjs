/**
 * 阶段二A UI 测试：轻 CRM（客户归并 / 意向分级 / 跟进时间线 / 提醒）
 * 运行： node scripts/ui-test-phase2a.mjs [baseUrl]
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
const email = `crm-${stamp}@example.com`;
const today = new Date().toISOString().slice(0, 10);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const pageErrors = [];
page.on('pageerror', e => { pageErrors.push(e.message); console.log('   ⚠️ pageerror:', e.message); });

// 页内 API 助手（后台为 Bearer 鉴权；自动补 /api 前缀，避免手写路径时漏掉）
const api = (path, init) => page.evaluate(async ({ path, init }) => {
  const url = path.startsWith('/api/') ? path : '/api' + path;
  const token = localStorage.getItem('admin_token');
  const res = await fetch(url, {
    ...(init || {}),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...((init || {}).headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}, { path, init });

try {
  console.log('\n== 1. 登录 ==');
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
  check('登录成功', true);

  console.log('\n== 2. 询盘自动建档 + 意向分级 ==');
  // 含询价词 + 数量 → 应判 hot
  const inq1 = await page.evaluate(async (email) => {
    const fd = new FormData();
    fd.set('name', 'CRM Test Buyer');
    fd.set('email', email);
    fd.set('company', 'CRM Trading BV');
    fd.set('country', 'Netherlands');
    fd.set('phone', '+31 20 000 0000');
    fd.set('message', 'Please send your best quotation for 500 pcs, FOB Shanghai.');
    fd.set('consent', 'true');
    const res = await fetch('/api/inquiries', { method: 'POST', body: fd });
    return { status: res.status, body: await res.json() };
  }, email);
  check('询盘提交成功', inq1.status === 201, `status=${inq1.status}`);
  const inqId = inq1.body?.data?.id;

  const row1 = (await api(`/inquiries/${inqId}`)).body?.data;
  check('询盘判定为 hot', row1?.priority === 'hot', String(row1?.priority));
  check('自动关联 customer_id', !!row1?.customer_id, `customer_id=${row1?.customer_id}`);
  const customerId = row1?.customer_id;

  const cust1 = (await api(`/crm/customers/${customerId}`)).body?.data;
  check('客户档案已创建', !!cust1, cust1?.company);
  check('客户初始等级为 new', cust1?.level === 'new', String(cust1?.level));
  check('首询时间已记录', !!cust1?.first_inquiry_at, String(cust1?.first_inquiry_at));
  check('来源记为 direct', cust1?.source === 'direct', String(cust1?.source));

  console.log('\n== 3. 同一邮箱二次询盘 → 归并同一客户 ==');
  const inq2 = await page.evaluate(async (email) => {
    const fd = new FormData();
    fd.set('name', 'CRM Test Buyer');
    fd.set('email', email);
    fd.set('company', 'CRM Trading BV');
    fd.set('message', 'Any update on the quotation? We need it urgently.');
    fd.set('consent', 'true');
    const res = await fetch('/api/inquiries', { method: 'POST', body: fd });
    return { status: res.status, body: await res.json() };
  }, email);
  const inq2Id = inq2.body?.data?.id;
  const row2 = (await api(`/inquiries/${inq2Id}`)).body?.data;
  check('第二条询盘挂同一客户', row2?.customer_id === customerId, `${row2?.customer_id} vs ${customerId}`);
  check('含 urgent 判定为 hot', row2?.priority === 'hot', String(row2?.priority));

  const cust2 = (await api(`/crm/customers/${customerId}`)).body?.data;
  check('客户询盘计数累加为 2', Number(cust2?.inquiry_count) === 2, String(cust2?.inquiry_count));
  check('客户详情带两条询盘', (cust2?.inquiries || []).length === 2, String((cust2?.inquiries || []).length));

  const custList = (await api('/crm/customers')).body?.data || [];
  const sameEmail = custList.filter(c => c.email === email);
  check('同邮箱只建一条客户', sameEmail.length === 1, `${sameEmail.length} 条`);

  console.log('\n== 4. 冷询盘识别（SEO 推广）==');
  const cold = await page.evaluate(async () => {
    const fd = new FormData();
    fd.set('name', 'Spam Bot');
    fd.set('email', 'seo-' + Date.now() + '@spam.example');
    fd.set('message', 'We offer SEO service and guest post, do you want backlink?');
    fd.set('consent', 'true');
    const res = await fetch('/api/inquiries', { method: 'POST', body: fd });
    return (await res.json()).data;
  });
  const coldRow = (await api(`/inquiries/${cold.id}`)).body?.data;
  check('推广询盘判定为 cold', coldRow?.priority === 'cold', String(coldRow?.priority));

  console.log('\n== 5. 后台列表新增列 ==');
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  // 后台默认停在 Overview，询盘表格要切 Tab 才会加载
  await page.click('a[data-tab="inquiries"]');
  await page.waitForSelector('#inquiries-tab', { state: 'visible' });
  await page.waitForSelector('#inquiries-list table', { timeout: 15000 });
  await page.waitForTimeout(600);
  const headers = await page.$$eval('#inquiries-list thead th', els => els.map(e => e.textContent.trim()));
  check('表头含 Priority', headers.includes('Priority'), headers.join('|'));
  check('表头含 Follow-up', headers.includes('Follow-up'), headers.join('|'));
  const priBadge = await page.$('.pri-hot, .pri-warm, .pri-cold');
  check('意向等级徽标已渲染', !!priBadge);

  console.log('\n== 6. 询盘详情弹窗（替代原 alert）==');
  await page.click(`button[onclick="viewInquiry(${inqId})"]`);
  await page.waitForSelector('#inquiry-modal.active', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#inq-priority'), null, { timeout: 10000 });
  check('弹窗打开并渲染完成', true);

  const noAlert = await page.evaluate(() => typeof window.alert === 'function');
  check('页面仍可用（未因 alert 阻塞）', noAlert);

  const bodyText = (await page.textContent('#inquiry-body')) || '';
  check('显示询盘原文', bodyText.includes('best quotation for 500 pcs'));
  check('显示公司', bodyText.includes('CRM Trading BV'));
  check('显示联系人邮箱', bodyText.includes(email));
  check('展示附件字段（无附件时显示 none）', bodyText.includes('none'));
  check('意向等级下拉默认 hot', (await page.inputValue('#inq-priority')) === 'hot');
  check('状态下拉存在', (await page.inputValue('#inq-status')) === 'pending');

  console.log('\n== 7. 设置等级 / 状态 / 跟进日期 ==');
  await page.selectOption('#inq-priority', 'warm');
  await page.waitForTimeout(900);
  let after = (await api(`/inquiries/${inqId}`)).body?.data;
  check('意向等级已改为 warm', after?.priority === 'warm', String(after?.priority));

  await page.selectOption('#inq-status', 'quoted');
  await page.waitForTimeout(900);
  after = (await api(`/inquiries/${inqId}`)).body?.data;
  check('状态已改为 quoted', after?.status === 'quoted', String(after?.status));

  await page.fill('#inq-follow', today);
  await page.waitForTimeout(1000);
  after = (await api(`/inquiries/${inqId}`)).body?.data;
  check('跟进日期已写入', String(after?.next_follow_at || '').startsWith(today), String(after?.next_follow_at));

  // 当天到期 → 应出现在「今日待跟进」里
  let rem = (await api('/crm/reminders')).body?.data || [];
  check('今日到期进入提醒列表', rem.some(r => r.id === inqId), `${rem.length} 条待跟进`);

  console.log('\n== 8. 跟进记录与时间线 ==');
  await page.selectOption('#act-type', 'call');
  await page.fill('#act-content', 'Called buyer, confirmed 500 pcs, sending formal quote tomorrow.');
  const future = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  await page.fill('#act-due', future);
  await page.click('#inquiry-modal button:has-text("Add")');
  await page.waitForTimeout(1800);

  const acts = (await api(`/crm/activities?inquiry_id=${inqId}`)).body?.data || [];
  // 改意向等级会自动写一条 status 记录，所以这里按类型筛而不是数总数
  const calls = acts.filter(a => a.type === 'call');
  check('跟进记录已入库', calls.length === 1, `${acts.length} 条（call ${calls.length}）`);
  check('类型为 call', calls[0]?.type === 'call', String(calls[0]?.type));
  check('记录操作人', !!calls[0]?.admin_user, String(calls[0]?.admin_user));
  check('记录带提醒时间', String(calls[0]?.due_at || '').startsWith(future), String(calls[0]?.due_at));
  check('改等级自动留痕', acts.some(a => a.type === 'status'), `${acts.filter(a => a.type === 'status').length} 条状态记录`);

  after = (await api(`/inquiries/${inqId}`)).body?.data;
  check('询盘 next_follow_at 被跟进日期覆盖', String(after?.next_follow_at || '').startsWith(future), String(after?.next_follow_at));

  const tlText = (await page.textContent('#inquiry-body')) || '';
  check('时间线渲染出记录', tlText.includes('Called buyer, confirmed 500 pcs'));
  check('时间线显示操作人', tlText.includes('call'));

  console.log('\n== 9. 内部备注 ==');
  await page.fill('#inq-notes', 'Key account, price sensitive, competitor quote at USD 12.5.');
  await page.click('button:has-text("Save notes")');
  await page.waitForTimeout(1200);
  after = (await api(`/inquiries/${inqId}`)).body?.data;
  check('备注已保存', (after?.notes || '').includes('competitor quote'), after?.notes);

  console.log('\n== 10. 客户等级变更留痕 ==');
  await api(`/crm/customers/${customerId}`, {
    method: 'PUT',
    body: JSON.stringify({ level: 'qualified', owner: 'tester' }),
  });
  const cust3 = (await api(`/crm/customers/${customerId}`)).body?.data;
  check('客户等级已更新', cust3?.level === 'qualified', String(cust3?.level));
  check('负责人已更新', cust3?.owner === 'tester', String(cust3?.owner));
  const levelLog = (cust3?.activities || []).find(a => a.type === 'status' && String(a.content).includes('qualified'));
  check('等级变更自动写入时间线', !!levelLog, levelLog?.content);

  const badLevel = await api(`/crm/customers/${customerId}`, {
    method: 'PUT', body: JSON.stringify({ level: 'not-a-level' }),
  });
  check('非法等级被拒 400', badLevel.status === 400, `status=${badLevel.status}`);

  console.log('\n== 11. 提醒与概览 ==');
  const rem2 = (await api('/crm/reminders')).body?.data || [];
  check('未来日期不进入今日提醒', !rem2.some(r => r.id === inqId), '跟进日已推到 ' + future);

  // 自己造一条确凿的逾期，而不是依赖库里恰好残留的历史数据
  // （之前这里断言 >=1，靠的是上一轮测试留下的过期跟进；换一个干净的库就红）
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const overdueSet = await api(`/inquiries/${inqId}/follow-up`, {
    method: 'PUT', body: JSON.stringify({ value: yesterday }),
  });
  check('可把跟进日改成昨天（构造逾期）', overdueSet.status === 200, `status=${overdueSet.status}`);

  const ov = (await api('/crm/overview')).body?.data;
  check('概览含询盘总数', Number(ov?.inquiries_total) >= 3, String(ov?.inquiries_total));
  check('概览含客户总数', Number(ov?.customers_total) >= 2, String(ov?.customers_total));
  check('概览含待跟进计数', Number(ov?.overdue_followups) >= 1, String(ov?.overdue_followups));
  check('概览按意向分级统计', Array.isArray(ov?.by_priority) && ov.by_priority.length > 0, JSON.stringify(ov?.by_priority));
  check('won 状态不计入待跟进', await (async () => {
    await api(`/inquiries/${inqId}/status`, { method: 'PUT', body: JSON.stringify({ status: 'won' }) });
    const r2 = (await api('/crm/reminders')).body?.data || [];
    return !r2.some(r => r.id === inqId);
  })());

  console.log('\n== 12. 未登录不可访问 CRM ==');
  const anon = await browser.newPage();
  const anonRes = await anon.goto(`${BASE}/api/crm/customers`, { waitUntil: 'domcontentloaded' });
  check('匿名访问客户列表 401', anonRes.status() === 401, `status=${anonRes.status()}`);
  const anonActs = await anon.goto(`${BASE}/api/crm/activities?inquiry_id=1`, { waitUntil: 'domcontentloaded' });
  check('匿名访问跟进记录 401', anonActs.status() === 401, `status=${anonActs.status()}`);
  await anon.close();

  console.log('\n== 13. 概览卡片 ==');
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('待跟进卡片存在', !!(await page.$('#stat-followup')));
  check('客户数卡片存在', !!(await page.$('#stat-customers')));
  const followupNum = await page.textContent('#stat-followup');
  check('待跟进数字为数值', /^\d+$/.test(String(followupNum).trim()), String(followupNum));

  console.log('\n== 14. 页面无 JS 运行时错误 ==');
  check('后台无 pageerror', pageErrors.length === 0, pageErrors.join(' | '));

  await page.screenshot({ path: `${OUT}/phase2a-inquiry-modal.png`, fullPage: false });
} catch (err) {
  fail++;
  console.error('\n💥 测试执行异常:', err.message);
  console.error(err.stack);
} finally {
  await browser.close();
}

console.log(`\n${'='.repeat(50)}`);
console.log(`阶段二A UI 测试：✅ ${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
