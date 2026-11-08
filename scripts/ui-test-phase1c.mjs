/**
 * 阶段一C UI 测试：产品扩展字段 / CSV 导入导出 / 询盘附件 / UTM 归因 / GA4 / WhatsApp
 * 运行： node scripts/ui-test-phase1c.mjs [baseUrl]
 *
 * 全部走真实浏览器 + 真实本地 D1/R2/KV（wrangler dev --local），不是 mock。
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
const prodName = 'UI Test Pump ' + stamp;
const prodSlug = 'ui-test-pump-' + stamp;

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', e => console.log('   ⚠️ pageerror:', e.message));

try {
  console.log('\n== 1. 登录 ==');
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
  check('登录成功', true);

  console.log('\n== 2. 产品区工具栏（导入/导出入口）==');
  await page.click('a[data-tab="products"]');
  await page.waitForSelector('#products-tab', { state: 'visible' });
  await page.waitForTimeout(1000);
  for (const id of ['product-export-btn', 'product-import-btn', 'product-import-file', 'add-product-btn']) {
    check(`#${id} 存在`, !!(await page.$('#' + id)));
  }
  const fileHidden = await page.$eval('#product-import-file', el => getComputedStyle(el).display === 'none');
  check('文件输入默认隐藏（由按钮触发）', fileHidden);

  console.log('\n== 3. 产品弹窗含阶段一C 字段 ==');
  await page.click('#add-product-btn');
  await page.waitForSelector('#product-modal.active');
  const newFields = ['product-lead-time', 'product-sample-policy', 'product-customization',
    'product-applications', 'product-video-url', 'product-datasheet-url', 'product-related-ids'];
  for (const id of newFields) {
    check(`字段 #${id} 渲染`, !!(await page.$('#' + id)));
  }

  console.log('\n== 4. 新建带转化信息的产品 ==');
  await page.fill('#product-name', prodName);
  await page.fill('#product-slug', prodSlug);
  await page.fill('#product-category', 'Pumps');
  await page.fill('#product-description', 'Automated UI test product for phase 1C.');
  await page.fill('#product-lead-time', '15-20 days after deposit');
  await page.fill('#product-sample-policy', 'Free sample, buyer pays freight');
  await page.fill('#product-customization', 'OEM logo, custom voltage, custom packaging');
  await page.fill('#product-applications', 'Water treatment, Food processing, Mining');
  await page.fill('#product-datasheet-url', 'https://example.com/spec.pdf');
  await page.fill('#product-moq', '100 pcs');
  await page.fill('#product-brand', 'TestBrand');
  await page.screenshot({ path: `${OUT}/phase1c-product-form.png` });
  await page.click('#product-form button[type="submit"]');
  await page.waitForTimeout(2000);
  const modalClosed = await page.$eval('#product-modal', el => !el.classList.contains('active'));
  check('保存后弹窗关闭', modalClosed);

  console.log('\n== 5. 前台产品页展示新字段 ==');
  const resDetail = await page.goto(`${BASE}/products/${prodSlug}`, { waitUntil: 'domcontentloaded' });
  check('产品详情页 200', resDetail.status() === 200, `status=${resDetail.status()}`);
  const bodyText = (await page.textContent('body')) || '';
  check('展示 Lead Time', bodyText.includes('15-20 days after deposit'));
  check('展示 Sample Policy', bodyText.includes('Free sample, buyer pays freight'));
  check('展示 Customization', bodyText.includes('OEM logo'));
  check('展示 Applications 标签', bodyText.includes('Water treatment') && bodyText.includes('Mining'));
  check('展示 Datasheet 下载按钮', bodyText.includes('Datasheet') || bodyText.includes('spec.pdf'));
  check('询盘表单含附件 input', !!(await page.$('input[type="file"]')));

  console.log('\n== 6. CSV 导入（走真实文件选择器）==');
  // 第 5 步已经跳到前台，这里要回后台并切回产品 Tab
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.click('a[data-tab="products"]');
  await page.waitForSelector('#products-tab', { state: 'visible' });
  await page.waitForTimeout(1000);

  const csv = [
    'name,slug,category,lead_time,moq,gallery_images,applications,is_featured',
    `${prodName},${prodSlug},Pumps,25-30 days after deposit,200 pcs,a.jpg|b.jpg,Water treatment|Mining,true`,
    `CSV Imported Valve ${stamp},csv-valve-${stamp},Valves,7 days,50 pcs,,Oil & gas,false`,
  ].join('\n');

  await page.setInputFiles('#product-import-file', {
    name: 'products.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await page.waitForTimeout(2500);

  // 导入结果通过库里的数据反查（比抓 toast 稳）
  const apiGet = async (slug) => page.evaluate(async (s) => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch('/api/products/' + s, { headers: { Authorization: 'Bearer ' + token } });
    return res.ok ? (await res.json()).data : null;
  }, slug);

  console.log('\n== 7. 导入结果已落库 ==');
  const afterImport = await apiGet(prodSlug);
  check('已存在产品被更新（lead_time）', afterImport?.lead_time === '25-30 days after deposit', afterImport?.lead_time);
  check('已存在产品被更新（moq）', afterImport?.moq === '200 pcs', afterImport?.moq);
  check('gallery 竖线分隔被解析成数组', (() => {
    try { return JSON.parse(afterImport?.gallery_images || '[]').length === 2; } catch { return false; }
  })());
  check('is_featured 布尔解析', afterImport?.is_featured === 1, String(afterImport?.is_featured));

  const newValve = await apiGet(`csv-valve-${stamp}`);
  check('新建产品存在', !!newValve, newValve?.name);
  check('新建产品 applications 正确', newValve?.applications === 'Oil & gas', newValve?.applications);

  console.log('\n== 8. CSV 导出（点真实按钮，走下载）==');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#product-export-btn'),
  ]);
  const dlPath = `${OUT}/products-export.csv`;
  await download.saveAs(dlPath);
  const csvText = fs.readFileSync(dlPath, 'utf8');
  check('导出文件名带日期', /products-\d{4}-\d{2}-\d{2}\.csv/.test(download.suggestedFilename()), download.suggestedFilename());
  check('带 UTF-8 BOM（Excel 不乱码）', csvText.charCodeAt(0) === 0xfeff);
  const header = csvText.split(/\r?\n/)[0].replace(/^\uFEFF/, '');
  for (const col of ['lead_time', 'sample_policy', 'customization', 'applications', 'video_url', 'datasheet_url', 'related_ids']) {
    check(`导出包含列 ${col}`, header.split(',').includes(col));
  }
  check('导出包含刚导入的产品', csvText.includes(prodSlug));
  check('列表字段导出为竖线格式', csvText.includes('a.jpg|b.jpg'));

  console.log('\n== 9. 空 CSV / 缺列 的容错 ==');
  const emptyRes = await page.evaluate(async () => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch('/api/products/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Authorization: 'Bearer ' + token },
      body: '',
    });
    return { status: res.status, body: await res.json() };
  });
  check('空 body 返回 400', emptyRes.status === 400, JSON.stringify(emptyRes.body));

  const badCols = await page.evaluate(async () => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch('/api/products/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Authorization: 'Bearer ' + token },
      body: 'foo,bar\n1,2',
    });
    return { status: res.status, body: await res.json() };
  });
  check('无可导入列返回 400 + hint', badCols.status === 400 && !!badCols.body.hint, JSON.stringify(badCols.body).slice(0, 90));

  console.log('\n== 10. 设置项：WhatsApp / GA4 ==');
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.click('a[data-tab="settings"]');
  await page.waitForSelector('#settings-tab', { state: 'visible' });
  await page.waitForTimeout(800);
  check('WhatsApp 设置项存在', !!(await page.$('#settings-whatsapp')));
  check('GA4 设置项存在', !!(await page.$('#settings-ga4')));

  // 先清空 GA4，验证「未配置就不注入」；否则上一次测试留下的值会让本断言假失败
  await page.evaluate(async () => {
    const token = localStorage.getItem('admin_token');
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ ga4_id: '', whatsapp: '' }),
    });
  });
  const ga4Before = await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  const htmlBefore = await ga4Before.text();
  check('未配置 GA4 时不注入脚本', !htmlBefore.includes('googletagmanager'));
  check('未配置 WhatsApp 时不渲染悬浮球', !htmlBefore.includes('wa.me/'));

  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.click('a[data-tab="settings"]');
  await page.waitForSelector('#settings-tab', { state: 'visible' });
  await page.waitForTimeout(700);
  await page.fill('#settings-whatsapp', '8613800138000');
  await page.fill('#settings-ga4', 'G-TEST123456');
  await page.fill('#settings-founded-at', '2008');
  await page.fill('#settings-employees', '150+');
  await page.click('#save-settings-btn');
  await page.waitForTimeout(1500);

  const savedSettings = await page.evaluate(async () => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch('/api/settings', { headers: { Authorization: 'Bearer ' + token } });
    return (await res.json()).data;
  });
  check('WhatsApp 已保存', savedSettings.whatsapp === '8613800138000', savedSettings.whatsapp);
  check('GA4 已保存', savedSettings.ga4_id === 'G-TEST123456', savedSettings.ga4_id);
  check('About 数字已保存', savedSettings.employees === '150+', savedSettings.employees);
  check('旧字段未被抹掉（site_name 仍在）', !!savedSettings.site_name, savedSettings.site_name);

  const homeAfter = await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  const htmlAfter = await homeAfter.text();
  check('配置后注入 GA4', htmlAfter.includes('G-TEST123456'));
  check('GA4 开启匿名 IP', htmlAfter.includes('anonymize_ip'));
  check('渲染 WhatsApp 悬浮球', htmlAfter.includes('wa.me/8613800138000'));
  await page.screenshot({ path: `${OUT}/phase1c-home-whatsapp.png`, fullPage: false });

  console.log('\n== 11. UTM 归因（sessionStorage）==');
  await page.goto(`${BASE}/?utm_source=google&utm_medium=cpc&utm_campaign=pump-q4&utm_term=centrifugal`, { waitUntil: 'domcontentloaded' });
  const attr = await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem('b2b_attr') || '{}'); } catch { return {}; }
  });
  check('utm_source 落 sessionStorage', attr.utm_source === 'google', JSON.stringify(attr));
  check('utm_campaign 落 sessionStorage', attr.utm_campaign === 'pump-q4');
  check('记录 landing_page', typeof attr.landing_page === 'string' && attr.landing_page.includes('utm_source'));

  console.log('\n== 12. 询盘带附件 + 归因 + GA4 事件 ==');
  const inquiryEmail = `ui-test-${stamp}@example.com`;
  const inqResult = await page.evaluate(async ({ email }) => {
    // 构造一个最小合法 PDF（%PDF- 魔数足够通过服务端魔数校验）
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3]);
    const fd = new FormData();
    fd.set('name', 'UI Test Buyer');
    fd.set('email', email);
    fd.set('company', 'UI Test Trading Co');
    fd.set('country', 'Spain');
    fd.set('phone', '+34 600 000 000');
    fd.set('message', 'Please quote 200 pcs. Automated test with attachment.');
    fd.set('consent', 'true');
    fd.set('attachment', new File([pdfBytes], 'rfq.pdf', { type: 'application/pdf' }));
    // attribution 由页面里 getAttribution() 取，这里显式模拟同样结构
    const attr = JSON.parse(sessionStorage.getItem('b2b_attr') || '{}');
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'landing_page', 'referrer']) {
      if (attr[k]) fd.set(k, attr[k]);
    }
    const res = await fetch('/api/inquiries', { method: 'POST', credentials: 'same-origin', body: fd });
    return { status: res.status, body: await res.json() };
  }, { email: inquiryEmail });

  check('询盘提交成功', inqResult.status === 200 || inqResult.status === 201, `status=${inqResult.status} ${JSON.stringify(inqResult.body).slice(0, 120)}`);
  check('返回附件信息', inqResult.body?.data?.attachment === 'stored', JSON.stringify(inqResult.body?.data || {}));
  const inquiryId = inqResult.body?.data?.id;

  console.log('\n== 13. 后台可查附件与 UTM 并下载 ==');
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const inquiryRow = await page.evaluate(async (email) => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch('/api/inquiries?limit=50', { headers: { Authorization: 'Bearer ' + token } });
    const body = await res.json();
    const list = body.data || [];
    return list.find(i => i.email === email) || null;
  }, inquiryEmail);
  check('后台列表能找到该询盘', !!inquiryRow, inquiryRow ? `id=${inquiryRow.id}` : 'not found');
  if (inquiryRow) {
    check('UTM source 已入库', inquiryRow.utm_source === 'google', String(inquiryRow.utm_source));
    check('UTM campaign 已入库', inquiryRow.utm_campaign === 'pump-q4', String(inquiryRow.utm_campaign));
    check('附件文件名已入库', inquiryRow.attachment_name === 'rfq.pdf', String(inquiryRow.attachment_name));

    const dl = await page.evaluate(async (id) => {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/inquiries/${id}/attachment`, { headers: { Authorization: 'Bearer ' + token } });
      const buf = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, ct: res.headers.get('content-type'), first: Array.from(buf.slice(0, 4)) };
    }, inquiryRow.id);
    check('附件可下载 200', dl.status === 200, `status=${dl.status}`);
    check('附件 Content-Type 为 PDF', (dl.ct || '').includes('pdf'), dl.ct);
    check('下载内容魔数正确', dl.first.join(',') === '37,80,68,70', dl.first.join(','));

    const csvExport = await page.evaluate(async () => {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/inquiries/export.csv', { headers: { Authorization: 'Bearer ' + token } });
      return { status: res.status, text: await res.text() };
    });
    check('询盘 CSV 导出 200', csvExport.status === 200);
    check('询盘导出含 utm 列', csvExport.text.includes('utm_source'));
  }

  console.log('\n== 14. 附件鉴权与非法类型 ==');
  const anon = await browser.newPage();
  const anonDl = await anon.goto(`${BASE}/api/inquiries/${inquiryId || 1}/attachment`, { waitUntil: 'domcontentloaded' });
  const anonBody = await anonDl.text();
  check('未登录不能下载附件', anonDl.status() === 401 || anonBody.includes('Unauthorized'), `status=${anonDl.status()}`);
  await anon.close();

  const badFile = await page.evaluate(async ({ email }) => {
    const fd = new FormData();
    fd.set('name', 'Bad File Buyer');
    fd.set('email', email);
    fd.set('message', 'Trying to upload an executable.');
    fd.set('consent', 'true');
    fd.set('attachment', new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'evil.exe', { type: 'application/pdf' }));
    const res = await fetch('/api/inquiries', { method: 'POST', credentials: 'same-origin', body: fd });
    return { status: res.status, body: await res.json() };
  }, { email: `bad-${stamp}@example.com` });
  check('伪装成 PDF 的 EXE 被拒', badFile.status === 400, `status=${badFile.status} ${JSON.stringify(badFile.body).slice(0, 90)}`);

  console.log('\n== 15. 产品详情页 trackLead / getAttribution 可用 ==');
  await page.goto(`${BASE}/products/${prodSlug}`, { waitUntil: 'domcontentloaded' });
  const helpers = await page.evaluate(() => ({
    track: typeof window.trackLead,
    attr: typeof window.getAttribution,
  }));
  check('window.trackLead 已注入', helpers.track === 'function', helpers.track);
  check('window.getAttribution 已注入', helpers.attr === 'function', helpers.attr);

} catch (err) {
  fail++;
  console.error('\n💥 测试执行异常:', err.message);
  console.error(err.stack);
} finally {
  // 清掉本轮（以及历史上遗留的）ui-test-pump-* 产品。
  // 不清的话，全站审计会爬到这些详情页，而它们的临时上传图片早已失效 →
  // 报出一堆「坏图 + 控制台错误」，语言扩到 5 种后还会被放大成 5 倍。
  // 先软删再 purge 物理删除：slug 的 UNIQUE 索引会一直占着，光软删没用。
  try {
    const cleaned = await page.evaluate(async () => {
      const token = localStorage.getItem('admin_token');
      if (!token) return '无 token，跳过';
      const h = { Authorization: 'Bearer ' + token };
      const list = await fetch('/api/products?limit=200', { headers: h })
        .then(r => r.json()).catch(() => null);
      const hits = (list?.data || []).filter(p => /^ui-test-pump-/.test(p.slug || ''));
      let n = 0;
      for (const p of hits) {
        await fetch(`/api/products/${p.id}`, { method: 'DELETE', headers: h }).catch(() => {});
        const r = await fetch(`/api/products/${p.id}?purge=1`, { method: 'DELETE', headers: h }).catch(() => null);
        if (r && r.ok) n += 1;
      }
      return `物理清理 ${n} 条（匹配 ${hits.length} 条）`;
    }).catch(e => '清理失败：' + e.message);
    console.log('\n清理测试产品残留：' + cleaned);
  } catch (e) { /* 清理失败不影响测试结论 */ }
  await browser.close();
}

console.log(`\n${'='.repeat(50)}`);
console.log(`阶段一C UI 测试：✅ ${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
