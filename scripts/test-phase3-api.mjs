/**
 * 阶段三接口全链路测试（不起浏览器，直接打 HTTP）
 * 覆盖：报价 CRUD → 发送 → 公开查看 → PDF → 客户接受 → 转订单 → 状态机 → 物流 → PDF
 *      → Stripe 未配置降级 → 客户魔法链接 → 门户数据 → 客户 token 越权
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
const fails = [];
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log('  ✅ ' + name); }
  else { fail++; fails.push(name + (extra ? ' — ' + extra : '')); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
async function j(method, path, { token, body, cookie, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  // 连续跑完整 test:all（10 个套件、上百次请求）时，wrangler dev 偶尔会在
  // 302/长连接上把连接重置（ECONNRESET）。只对幂等的 GET/HEAD 做有限重试：
  // 写操作不重试，避免「请求其实已落库」导致重复创建报价/订单。
  const idempotent = method === 'GET' || method === 'HEAD';
  const attempts = idempotent ? 3 : 1;
  let res;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      res = await fetch(BASE + path, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
      break;
    } catch (err) {
      const transient = /ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(String(err?.message) + String(err?.cause?.code));
      if (!idempotent || !transient || i === attempts) throw err;
      await new Promise(r => setTimeout(r, 200 * i));
    }
  }
  if (raw) return res;
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = { _raw: text.slice(0, 200) }; }
  return { status: res.status, data, headers: res.headers };
}

const stamp = Date.now().toString().slice(-6);
const email = `p3-buyer-${stamp}@example.com`;

(async () => {
  console.log('\n== 1. 管理员登录 ==');
  const login = await j('POST', '/api/admin/login', { body: { username: 'tester', password: 'TestPassw0rd!2026' } });
  const token = login.data?.token || login.data?.data?.token;
  check('登录成功并拿到 token', !!token, 'status=' + login.status);

  console.log('\n== 2. 创建报价（2 行 + 5% 折扣 + 10% 税 + 运费 480）==');
  const created = await j('POST', '/api/quotes', {
    token,
    body: {
      customer_email: email, customer_name: 'Ahmed Buyer', customer_company: 'Acme Trading LLC',
      customer_country: 'AE', currency: 'USD', incoterm: 'FOB',
      payment_terms: '30% T/T deposit, balance before shipment', valid_until: '2026-12-31',
      discount_type: 'percent', discount_value: 5, tax_rate: 10, shipping_amount: 480,
      notes: 'Lead time 25-30 days', terms: 'Warranty 12 months',
      items: [
        { name: 'Centrifugal pump CPS-200', spec: 'SS316L / 15kW', qty: 10, unit: 'pcs', unit_price: 1250 },
        { name: 'Spare seal kit', spec: 'For CPS series', qty: 20, unit: 'pcs', unit_price: 45 },
      ],
    },
  });
  const q = created.data?.data || created.data;
  check('创建返回 200/201', created.status === 200 || created.status === 201, 'status=' + created.status);
  check('拿到 quote_no', /^QT-\d{8}-\d{4}$/.test(q?.quote_no || ''), q?.quote_no);
  // 10*1250 + 20*45 = 13400；折扣 5% = 670；taxable 12730；税 1273；+480 = 14483
  check('subtotal = 13400', Math.abs(q?.subtotal - 13400) < 0.01, String(q?.subtotal));
  check('discount_amount = 670', Math.abs(q?.discount_amount - 670) < 0.01, String(q?.discount_amount));
  check('tax_amount = 1273', Math.abs(q?.tax_amount - 1273) < 0.01, String(q?.tax_amount));
  check('total = 14483', Math.abs(q?.total - 14483) < 0.01, String(q?.total));
  check('初始状态 draft', q?.status === 'draft', q?.status);

  console.log('\n== 3. 详情与更新 ==');
  const detail = await j('GET', `/api/quotes/${q.id}`, { token });
  const qd = detail.data?.data || detail.data;
  check('详情含 2 个行项目', (qd?.items || []).length === 2, String((qd?.items || []).length));
  check('行金额 = qty*unit_price', Math.abs(qd?.items?.[0]?.amount - 12500) < 0.01, String(qd?.items?.[0]?.amount));

  const upd = await j('PUT', `/api/quotes/${q.id}`, {
    token, body: { shipping_amount: 0, items: [{ name: 'Centrifugal pump CPS-200', qty: 10, unit: 'pcs', unit_price: 1250 }] },
  });
  const qu = upd.data?.data || upd.data;
  check('更新后 1 行', (qu?.items || []).length === 1, String((qu?.items || []).length));
  // 1 行 1250×10 = 12500；折扣 5% = 625；taxable 11875；税 10% = 1187.5；total 13062.5
  check('更新后 total = 13062.5', Math.abs(qu?.total - 13062.5) < 0.01, String(qu?.total));

  console.log('\n== 4. 发送报价 ==');
  const sent = await j('POST', `/api/quotes/${q.id}/send`, { token });
  check('发送成功', sent.status === 200, 'status=' + sent.status);
  const quoteToken = sent.data?.data?.token || sent.data?.token;
  check('拿到客户 token（43 字符 base64url）', /^[A-Za-z0-9_-]{40,}$/.test(quoteToken || ''), (quoteToken || '').slice(0, 8));
  const afterSend = await j('GET', `/api/quotes/${q.id}`, { token });
  check('状态变 sent', (afterSend.data?.data || afterSend.data)?.status === 'sent');

  console.log('\n== 5. 公开查看（字段裁剪）==');
  const view = await j('GET', `/api/quotes/view?token=${encodeURIComponent(quoteToken)}`);
  const vd = view.data?.data || view.data;
  check('公开查看 200', view.status === 200, 'status=' + view.status);
  check('返回编号一致', vd?.quote_no === q.quote_no, vd?.quote_no);
  check('不含 created_by', vd && !('created_by' in vd));
  check('不含 customer_id / inquiry_id', vd && !('customer_id' in vd) && !('inquiry_id' in vd));
  check('含行项目', (vd?.items || []).length === 1);
  const badView = await j('GET', '/api/quotes/view?token=notarealtoken');
  check('无效 token 返回 404', badView.status === 404, 'status=' + badView.status);

  console.log('\n== 6. 报价 PDF ==');
  const pdfRes = await j('GET', `/api/quotes/${q.id}/pdf`, { token, raw: true });
  const pdfBuf = new Uint8Array(await pdfRes.arrayBuffer());
  check('PDF 200', pdfRes.status === 200, 'status=' + pdfRes.status);
  check('Content-Type 为 application/pdf', (pdfRes.headers.get('content-type') || '').includes('pdf'), pdfRes.headers.get('content-type'));
  check('PDF 魔数正确', pdfBuf[0] === 0x25 && pdfBuf[1] === 0x50 && pdfBuf[2] === 0x44 && pdfBuf[3] === 0x46, String(pdfBuf[0]));
  check('带 attachment 文件名', (pdfRes.headers.get('content-disposition') || '').includes('.pdf'), pdfRes.headers.get('content-disposition'));

  console.log('\n== 7. 客户接受 ==');
  const acc = await j('POST', '/api/quotes/respond', { body: { token: quoteToken, action: 'accept', message: 'We accept, please proceed.' } });
  check('接受成功', acc.status === 200, 'status=' + acc.status);
  const accState = await j('GET', `/api/quotes/${q.id}`, { token });
  check('状态变 accepted', (accState.data?.data || accState.data)?.status === 'accepted');
  const accAgain = await j('POST', '/api/quotes/respond', { body: { token: quoteToken, action: 'accept' } });
  check('重复接受返回 409', accAgain.status === 409, 'status=' + accAgain.status);

  console.log('\n== 8. 报价转订单 ==');
  const ord = await j('POST', '/api/orders', { token, body: { quote_id: q.id } });
  const o = ord.data?.data || ord.data;
  check('转单成功', ord.status === 200 || ord.status === 201, 'status=' + ord.status);
  check('拿到 SO 单号', /^SO-\d{8}-\d{4}$/.test(o?.order_no || ''), o?.order_no);
  check('金额继承报价', Math.abs(o?.total - 13062.5) < 0.01, String(o?.total));
  const ordAgain = await j('POST', '/api/orders', { token, body: { quote_id: q.id } });
  check('重复转单 409', ordAgain.status === 409, 'status=' + ordAgain.status);

  console.log('\n== 9. 订单状态机 ==');
  const s1 = await j('PUT', `/api/orders/${o.id}/status`, { token, body: { status: 'confirmed', message: 'Deposit received' } });
  check('placed → confirmed', s1.status === 200, 'status=' + s1.status);
  const s2 = await j('PUT', `/api/orders/${o.id}/status`, { token, body: { status: 'shipped' } });
  check('confirmed → shipped 被拒（400）', s2.status === 400, 'status=' + s2.status);
  check('拒绝时给出 allowed 列表', Array.isArray(s2.data?.allowed), JSON.stringify(s2.data).slice(0, 80));
  const s3 = await j('PUT', `/api/orders/${o.id}/status`, { token, body: { status: 'in_production' } });
  check('confirmed → in_production', s3.status === 200, 'status=' + s3.status);

  console.log('\n== 10. 物流与时间线 ==');
  const ship = await j('PUT', `/api/orders/${o.id}`, {
    token, body: { carrier: 'Maersk', tracking_no: 'MSKU1234567', tracking_url: 'https://www.maersk.com/tracking/MSKU1234567', eta: '2027-01-15' },
  });
  check('物流写入成功', ship.status === 200, 'status=' + ship.status);
  const od = await j('GET', `/api/orders/${o.id}`, { token });
  const odd = od.data?.data || od.data;
  check('承运商已保存', odd?.carrier === 'Maersk', odd?.carrier);
  check('时间线 ≥ 3 条', (odd?.events || []).length >= 3, String((odd?.events || []).length));
  const statusEvents = (odd?.events || []).filter(e => e.type === 'status');
  check('状态事件含 from → to', statusEvents.some(e => e.from_value && e.to_value), JSON.stringify(statusEvents[0] || {}).slice(0, 80));

  console.log('\n== 11. 订单 PDF 与 Stripe 降级 ==');
  const opdf = await j('GET', `/api/orders/${o.id}/pdf`, { token, raw: true });
  const obuf = new Uint8Array(await opdf.arrayBuffer());
  check('订单 PDF 200', opdf.status === 200, 'status=' + opdf.status);
  check('订单 PDF 魔数正确', obuf[0] === 0x25 && obuf[1] === 0x50, String(obuf[0]));
  const co = await j('POST', `/api/orders/${o.id}/checkout`, { token });
  check('未配置 Stripe 返回 400', co.status === 400, 'status=' + co.status);
  check('返回银行转账兜底信息', !!co.data?.bank_transfer, JSON.stringify(co.data).slice(0, 100));

  console.log('\n== 12. 公开询价清单 ==');
  const reqBody = {
    email: `p3-lead-${stamp}@example.com`, name: 'Lead Buyer', company: 'Beta Imports', country: 'DE',
    message: 'Please quote for Q1 shipment.',
    items: [{ name: 'Gate valve DN50', qty: 100, unit: 'pcs', spec: 'PN16' }],
    company_url: '',
  };
  const req = await j('POST', '/api/quotes/request', { body: reqBody });
  check('提交成功（200/201）', req.status === 200 || req.status === 201, 'status=' + req.status);
  check('返回报价编号', /^QT-/.test((req.data?.data || req.data)?.quote_no || ''), JSON.stringify(req.data).slice(0, 80));
  const honey = await j('POST', '/api/quotes/request', { body: { ...reqBody, email: `honey-${stamp}@example.com`, company_url: 'http://spam.example' } });
  check('蜜罐命中仍返回成功（不落库）', honey.status === 200, 'status=' + honey.status);
  const honeyList = await j('GET', `/api/quotes?q=honey-${stamp}`, { token });
  const honeyRows = honeyList.data?.data || [];
  check('蜜罐提交未创建报价', honeyRows.length === 0, String(honeyRows.length));

  console.log('\n== 13. 客户门户魔法链接 ==');
  const rl = await j('POST', '/api/account/request-link', { body: { email } });
  check('request-link 返回 200', rl.status === 200, 'status=' + rl.status);
  check('文案中性（不提"已发送"）', /If this email/i.test(rl.data?.message || ''), (rl.data?.message || '').slice(0, 50));
  const rlUnknown = await j('POST', '/api/account/request-link', { body: { email: `nobody-${stamp}@example.com` } });
  check('未注册邮箱返回同一句', rlUnknown.status === 200 && rlUnknown.data?.message === rl.data?.message);

  // 从本地 D1 取 token（真实环境走邮件，本地无法收信）
  const { execFileSync } = await import('node:child_process');
  const q2 = `SELECT token FROM magic_tokens WHERE email='${email}' ORDER BY id DESC LIMIT 1`;
  let magicToken = '';
  try {
    const out = execFileSync(process.execPath, [
      'node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'b2b_database', '--local', '--command', q2, '--json',
    ], { encoding: 'utf8' });
    // wrangler 在 --json 前会打一行 "Proxy environment variables detected."，
    // 不能直接 JSON.parse，必须从第一个 '[' 开始截取。
    const parsed = JSON.parse(out.slice(out.indexOf('[')));
    magicToken = parsed?.[0]?.results?.[0]?.token || '';
  } catch (e) { console.log('    (读取 D1 失败: ' + e.message.slice(0, 60) + ')'); }
  check('magic token 已入库', !!magicToken, magicToken ? magicToken.slice(0, 8) : 'empty');

  const ver = await j('GET', `/api/account/verify?token=${encodeURIComponent(magicToken)}`, { raw: true });
  check('verify 返回 302', ver.status === 302, 'status=' + ver.status);
  const setCookie = ver.headers.get('set-cookie') || '';
  check('下发 cust_session cookie', setCookie.includes('cust_session='), setCookie.slice(0, 40));
  check('cookie 为 HttpOnly', /HttpOnly/i.test(setCookie));
  const cookie = setCookie.split(';')[0];
  const ver2 = await j('GET', `/api/account/verify?token=${encodeURIComponent(magicToken)}`, { raw: true });
  check('同一 token 二次使用被拒', ver2.status !== 302, 'status=' + ver2.status);

  console.log('\n== 14. 门户数据与越权 ==');
  const me = await j('GET', '/api/account/me', { cookie });
  const meData = me.data?.data || me.data;
  check('me 返回 200', me.status === 200, 'status=' + me.status);
  check('能看到自己的报价', (meData?.quotes || []).length >= 1, String((meData?.quotes || []).length));
  check('能看到自己的订单', (meData?.orders || []).length >= 1, String((meData?.orders || []).length));

  const crossA = await j('GET', '/api/quotes', { cookie });
  check('客户 cookie 不能访问 /api/quotes（401）', crossA.status === 401, 'status=' + crossA.status);
  const crossB = await j('GET', '/api/orders', { cookie });
  check('客户 cookie 不能访问 /api/orders（401）', crossB.status === 401, 'status=' + crossB.status);
  const crossC = await j('GET', '/api/admin/stats', { cookie });
  check('客户 cookie 不能访问后台统计（401）', crossC.status === 401, 'status=' + crossC.status);

  // 反向：管理员 token 不能当成客户 cookie 用
  const rev = await j('GET', '/api/account/me', { token });
  check('管理员 token 不能访问 /api/account/me', rev.status === 401, 'status=' + rev.status);

  console.log('\n== 15. 输入校验 ==');
  const bad1 = await j('POST', '/api/quotes', { token, body: { customer_email: 'not-an-email', items: [{ name: 'x', qty: 1, unit_price: 1 }] } });
  check('非法邮箱被拒（400）', bad1.status === 400, 'status=' + bad1.status);
  const bad2 = await j('POST', '/api/quotes', { token, body: { customer_email: 'a@b.com', items: [] } });
  check('空行项目被拒（400）', bad2.status === 400, 'status=' + bad2.status);
  const bad3 = await j('POST', '/api/quotes', { token, body: { customer_email: 'a@b.com', items: [{ name: 'x', qty: 0, unit_price: 1 }] } });
  check('qty=0 被拒（400）', bad3.status === 400, 'status=' + bad3.status);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃：', e); process.exit(2); });
