/**
 * 后台多语言 Tab 真机测试（阶段一A）
 * 用系统 Edge（playwright-core，不下载浏览器）
 * 运行： node scripts/ui-test-multilang.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-artifacts';
const USER = process.env.ADMIN_USERNAME || 'tester';
const PASS = process.env.ADMIN_PASSWORD || 'TestPassw0rd!2026';

fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on('pageerror', e => console.log('   ⚠️ pageerror:', e.message));

try {
  console.log('\n== 1. 登录 ==');
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
  check('登录并跳转到 dashboard', page.url().includes('/admin/dashboard'));

  console.log('\n== 2. 打开产品编辑弹窗 ==');
  // 后台默认停在 Overview，产品表格在 Products tab
  await page.click('a[data-tab="products"]');
  await page.waitForSelector('#products-tab', { state: 'visible', timeout: 15000 });
  await page.waitForSelector('button:has-text("Edit")', { timeout: 15000 });

  // 不能直接点第一个 Edit：列表按 created_at DESC 排序，
  // 其它测试新建的产品会跑到最前面（且没有译文），断言会莫名失败。
  // 这里优先选 bootstrap 的 sample-industrial-pump；演示数据会把它清掉，
  // 所以退化为「任意一个 es+ar 译文齐全的在架产品」——测试不该依赖种子数据的名字。
  const fixture = await page.evaluate(async () => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch('/api/products?limit=200', { headers: { Authorization: 'Bearer ' + token } });
    const list = (await res.json()).data || [];
    const tr = (p) => {
      try { return typeof p.translations === 'string' ? JSON.parse(p.translations || '{}') : (p.translations || {}); }
      catch { return {}; }
    };
    const ok = (p) => {
      const t = tr(p);
      return p.is_active && t.es && t.es.name && t.ar && t.ar.name;
    };
    const pick = list.find(p => p.slug === 'sample-industrial-pump' && ok(p)) || list.find(ok);
    if (!pick) return null;
    return {
      index: list.findIndex(p => p.id === pick.id),
      id: pick.id,
      slug: pick.slug,
      translations: JSON.stringify(tr(pick)),
    };
  });
  const SEED_SLUG = fixture ? fixture.slug : 'sample-industrial-pump';
  const seedIndex = fixture ? fixture.index : -1;
  check('找到可用于多语言测试的产品', !!fixture, fixture ? SEED_SLUG + ' @ row ' + (seedIndex + 1) : '列表里没有 es+ar 译文齐全的产品');
  await page.click(`#products-list tbody tr:nth-child(${seedIndex + 1}) button:has-text("Edit")`);
  await page.waitForSelector('#product-modal.active', { timeout: 10000 });
  check('产品弹窗打开', true);

  const tabs = await page.$$eval('.tr-tab', els => els.map(e => e.dataset.lang));
  // SUPPORTED_LANGS 现在是 en,es,ar,zh,zh-TW，译文 Tab 按非默认语言渲染 = es/ar/zh/zh-TW
  const expectedTabs = ['es', 'ar', 'zh', 'zh-TW'];
  check('渲染出多语言 Tab', JSON.stringify(tabs) === JSON.stringify(expectedTabs), `语种=${tabs.join(',')}`);

  const firstActive = await page.$eval('.tr-tab', el => el.classList.contains('active'));
  const firstPaneVisible = await page.$eval('.tr-pane', el => getComputedStyle(el).display !== 'none');
  check('默认激活第一个语种 Tab', firstActive && firstPaneVisible);

  console.log('\n== 3. Tab 切换 ==');
  await page.click('.tr-tab[data-lang="ar"]');
  await page.waitForTimeout(200);
  const arVisible = await page.$eval('.tr-pane[data-lang-pane="ar"]', el => getComputedStyle(el).display !== 'none');
  const esHidden = await page.$eval('.tr-pane[data-lang-pane="es"]', el => getComputedStyle(el).display === 'none');
  check('切到阿语 Tab 显示阿语面板、隐藏西语面板', arVisible && esHidden);

  const arDir = await page.$eval('.tr-pane[data-lang-pane="ar"]', el => el.getAttribute('dir'));
  check('阿语面板 dir=rtl', arDir === 'rtl');

  console.log('\n== 4. 回填已有译文 ==');
  await page.click('.tr-tab[data-lang="es"]');
  await page.waitForTimeout(200);
  const esNameBefore = await page.inputValue('#tr-es-name');
  check('西语产品名已回填', esNameBefore.length > 0, `"${esNameBefore}"`);

  const arNameBefore = await page.inputValue('#tr-ar-name');
  check('阿语产品名已回填', arNameBefore.length > 0, `"${arNameBefore}"`);

  console.log('\n== 5. 绿点状态 ==');
  const dotEs = await page.$eval('.tr-tab[data-lang="es"] .dot', el => el.style.display);
  check('已有译文的 Tab 显示绿点', dotEs !== 'none', `display=${dotEs}`);

  console.log('\n== 6. 编辑译文并同步 JSON 预览 ==');
  const newEsName = 'Bomba industrial UI-' + Date.now().toString(36);
  await page.fill('#tr-es-name', newEsName);
  await page.waitForTimeout(200);
  const preview = await page.inputValue('#product-translations');
  let parsed = null;
  try { parsed = JSON.parse(preview); } catch { parsed = null; }
  check('JSON 预览自动同步', parsed && parsed.es && parsed.es.name === newEsName);
  check('JSON 预览含阿语既有译文', parsed && parsed.ar && !!parsed.ar.name);
  check('JSON 预览不含空字段', parsed && parsed.es && parsed.es.seo_title === undefined);

  await page.screenshot({ path: `${OUT}/admin-multilang-tab.png`, fullPage: false });

  console.log('\n== 7. 保存并校验落库 ==');
  await page.click('#product-form button[type="submit"]');
  await page.waitForTimeout(2500);
  const modalClosed = await page.$eval('#product-modal', el => !el.classList.contains('active'));
  check('保存后弹窗关闭', modalClosed);

  // 重新打开确认回填的是新值（读的是 D1）
  await page.click("a[data-tab=\"products\"]");
  await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
  await page.click(`#products-list tbody tr:nth-child(${seedIndex + 1}) button:has-text("Edit")`);
  await page.waitForSelector('#product-modal.active');
  await page.click('.tr-tab[data-lang="es"]');
  await page.waitForTimeout(300);
  const esNameAfter = await page.inputValue('#tr-es-name');
  check('D1 已保存新译文并可回填', esNameAfter === newEsName, `"${esNameAfter}"`);
  const arNameAfter = await page.inputValue('#tr-ar-name');
  check('其它语种译文未被误清空', arNameAfter === arNameBefore, `"${arNameAfter}"`);

  console.log('\n== 8. JSON 导入回 Tab ==');
  await page.click('summary:has-text("Advanced")');
  await page.waitForTimeout(200);
  await page.fill('#product-translations', JSON.stringify({ es: { name: 'Importado desde JSON' }, ar: { name: 'مستورد من JSON' } }));
  await page.click('button:has-text("Import JSON into tabs")');
  await page.waitForTimeout(300);
  await page.click('.tr-tab[data-lang="es"]');
  await page.waitForTimeout(200);
  const imported = await page.inputValue('#tr-es-name');
  check('JSON 导入写入 Tab', imported === 'Importado desde JSON', `"${imported}"`);

  await page.click('#product-form .btn-cancel');
  await page.waitForTimeout(300);

  console.log('\n== 9. 前台西语页显示最新译文 ==');
  await page.goto(`${BASE}/es/products/${SEED_SLUG}`, { waitUntil: 'domcontentloaded' });
  const h1 = (await page.textContent('h1')) || '';
  check('西语详情页标题来自 D1 译文', h1.includes(newEsName), `"${h1.trim()}"`);
  await page.screenshot({ path: `${OUT}/frontend-es-detail.png`, fullPage: false });

  console.log('\n== 10. 语言切换器保留当前路径 ==');
  await page.click(`.lang-switch a[href="/ar/products/${SEED_SLUG}"]`);
  await page.waitForURL(`**/ar/products/${SEED_SLUG}`, { timeout: 10000 });
  const arH1 = (await page.textContent('h1')) || '';
  check('切到阿语后仍在同一产品页', page.url().includes(`/ar/products/${SEED_SLUG}`));
  // 断言「是阿语译文」而不是写死某个词：种子产品可能是任意一个
  check('阿语页标题为阿语译文', !!arNameBefore && arH1.includes(arNameBefore.trim().split(/\s+/)[0]), `"${arH1.trim()}"`);
  await page.screenshot({ path: `${OUT}/frontend-ar-detail.png`, fullPage: false });

  // 复原：本用例改的是真实产品，不回滚会把演示站的西语名改成 "Bomba industrial UI-xxx"
  console.log('\n== 11. 还原被测产品的译文 ==');
  const restored = await page.evaluate(async (f) => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch('/api/products/' + f.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ translations: f.translations }),
    });
    return res.status === 200;
  }, fixture);
  check('译文已还原', restored);
  const backH1 = await page.request.get(`${BASE}/es/products/${SEED_SLUG}`).then(r => r.text());
  check('前台西语标题已回到原值', !backH1.includes(newEsName));
} catch (e) {
  fail++;
  console.log('\n❌ 测试异常：', e.message);
  await page.screenshot({ path: `${OUT}/error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
console.log(`截图目录：${OUT}/`);
process.exit(fail ? 1 : 0);
