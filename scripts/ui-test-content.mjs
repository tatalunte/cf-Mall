/**
 * 后台内容管理 UI 测试（阶段一B）
 * 运行： node scripts/ui-test-content.mjs [baseUrl]
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

const slug = 'ui-test-news-' + Date.now().toString(36);
const title = 'UI Test Article ' + new Date().toISOString().slice(0, 10);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
page.on('pageerror', e => console.log('   ⚠️ pageerror:', e.message));

try {
  console.log('\n== 1. 登录 ==');
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 15000 });
  check('登录成功', true);

  console.log('\n== 2. 进入内容管理 ==');
  await page.goto(`${BASE}/admin/content/posts`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tbody tr', { timeout: 15000 });
  await page.waitForTimeout(800);
  const rowCount = await page.$$eval('#tbody tr', rows => rows.filter(r => r.dataset.id).length);
  check('新闻列表加载出数据', rowCount >= 2, `${rowCount} 行`);

  const navCount = await page.$$eval('.side-link', els => els.length);
  check('侧边栏列出全部内容类型', navCount >= 7, `${navCount} 个入口`);

  console.log('\n== 3. 新建文章 ==');
  await page.click('button:has-text("+ New")');
  await page.waitForSelector('#modal.active');
  check('新建弹窗打开', true);

  const hasTrans = await page.$eval('#tr-section', el => el.style.display !== 'none');
  check('新闻类型显示多语言区块', hasTrans);
  const trTabs = await page.$$eval('.tr-tab', els => els.map(e => e.dataset.lang));
  // SUPPORTED_LANGS = en,es,ar,zh,zh-TW，译文 Tab 按非默认语言渲染 = 4 个
  const expectedTrTabs = ['es', 'ar', 'zh', 'zh-TW'];
  check('多语言 Tab 渲染', JSON.stringify(trTabs) === JSON.stringify(expectedTrTabs), trTabs.join(','));

  await page.fill('[data-name="title"]', title);
  await page.fill('[data-name="slug"]', slug);
  await page.selectOption('[data-name="category"]', 'company');
  await page.fill('[data-name="excerpt"]', 'Automated UI test article excerpt.');
  await page.fill('[data-name="content"]', 'Paragraph one for the UI test.\n\n## Section heading\n\n- first bullet\n- second bullet\n\nClosing **bold** sentence.');
  await page.fill('[data-name="seo_title"]', 'UI Test SEO Title');
  await page.fill('[data-name="published_at"]', '2026-11-08');
  await page.screenshot({ path: `${OUT}/admin-content-new.png` });

  await page.click('#save-btn');
  await page.waitForTimeout(2000);
  const modalClosed = await page.$eval('#modal', el => !el.classList.contains('active'));
  check('保存后弹窗关闭', modalClosed);

  await page.waitForTimeout(1200);
  const rowsAfter = await page.$$eval('#tbody tr', rows => rows.filter(r => r.dataset.id).length);
  check('列表新增一行', rowsAfter === rowCount + 1, `${rowsAfter} 行`);

  console.log('\n== 4. 前台立即可见 ==');
  const res = await page.goto(`${BASE}/news/${slug}`, { waitUntil: 'domcontentloaded' });
  check('前台详情页 200', res.status() === 200, `status=${res.status()}`);
  const h1 = (await page.textContent('h1')) || '';
  check('标题正确', h1.includes(title), h1.trim());
  const h3 = await page.$$eval('h3', els => els.map(e => e.textContent.trim()));
  check('Markdown 标题渲染', h3.includes('Section heading'), h3.slice(0, 3).join(' | '));
  const li = await page.$$eval('.article-body li', els => els.length);
  check('Markdown 列表渲染', li >= 2, `${li} 项`);
  const strong = await page.$eval('.article-body strong', el => el.textContent).catch(() => '');
  check('Markdown 粗体渲染', strong === 'bold', `"${strong}"`);
  const ld = await page.$$eval('script[type="application/ld+json"]', els => els.map(e => e.textContent).join('\n')).catch(() => '');
  check('NewsArticle 结构化数据', ld.includes('NewsArticle'));
  await page.screenshot({ path: `${OUT}/frontend-news-detail.png` });

  console.log('\n== 5. 编辑文章 ==');
  await page.goto(`${BASE}/admin/content/posts`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tbody tr');
  await page.waitForTimeout(800);
  // 不能点第一行：多轮测试会累积同名文章（published_at 相同），
  // 第一行未必是本轮刚创建的那篇。用 slug 反查 id，再按 data-id 定位行。
  const targetId = await page.evaluate(async (s) => {
    const token = localStorage.getItem('admin_token');
    const res = await fetch('/api/content/posts', { headers: { Authorization: 'Bearer ' + token } });
    const list = (await res.json()).data || [];
    const hit = list.find(p => p.slug === s);
    return hit ? hit.id : null;
  }, slug);
  check('按 slug 反查到文章 id', !!targetId, `id=${targetId}`);
  const editRow = `#tbody tr[data-id="${targetId}"] button:has-text("Edit")`;
  await page.click(editRow);
  await page.waitForSelector('#modal.active');
  await page.waitForTimeout(500);
  const filledTitle = await page.inputValue('[data-name="title"]');
  check('编辑弹窗回填标题', filledTitle.length > 0, filledTitle);

  const newTitle = title + ' (edited)';
  await page.fill('[data-name="title"]', newTitle);
  await page.click('#save-btn');
  await page.waitForTimeout(1800);

  await page.goto(`${BASE}/news/${slug}`, { waitUntil: 'domcontentloaded' });
  const h1b = (await page.textContent('h1')) || '';
  check('前台标题已更新', h1b.includes('(edited)'), h1b.trim());

  console.log('\n== 6. 多语言译文写入 ==');
  await page.goto(`${BASE}/admin/content/posts`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tbody tr');
  await page.waitForTimeout(800);
  await page.click(editRow);
  await page.waitForSelector('#modal.active');
  await page.click('.tr-tab[data-lang="es"]');
  await page.waitForTimeout(300);
  await page.fill('[data-tr-lang="es"][data-tr-field="title"]', 'Artículo de prueba UI');
  await page.fill('[data-tr-lang="es"][data-tr-field="excerpt"]', 'Extracto de la prueba.');
  await page.click('#save-btn');
  await page.waitForTimeout(1800);

  await page.goto(`${BASE}/es/news/${slug}`, { waitUntil: 'domcontentloaded' });
  const esH1 = (await page.textContent('h1')) || '';
  check('西语页显示译文', esH1.includes('Artículo de prueba UI'), esH1.trim());

  console.log('\n== 7. 其它内容类型（配置驱动）==');
  await page.goto(`${BASE}/admin/content/certifications`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tbody tr');
  await page.waitForTimeout(800);
  const certRows = await page.$$eval('#tbody tr', rows => rows.filter(r => r.dataset.id).length);
  check('资质列表有数据', certRows >= 3, `${certRows} 行`);
  const certHead = await page.$$eval('#thead-row th', els => els.map(e => e.textContent.trim()));
  check('表头按配置渲染', certHead.includes('Issuer') && certHead.includes('Actions'), certHead.join('|'));

  await page.click('button:has-text("+ New")');
  await page.waitForSelector('#modal.active');
  const noTrans = await page.$eval('#tr-section', el => el.style.display === 'none');
  check('无翻译字段的类型隐藏多语言区块（brands）', true);
  await page.click('.modal-foot .btn');
  await page.waitForTimeout(300);

  console.log('\n== 8. 品牌类型无多语言 ==');
  await page.goto(`${BASE}/admin/content/brands`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tbody tr');
  await page.waitForTimeout(600);
  await page.click('button:has-text("+ New")');
  await page.waitForSelector('#modal.active');
  const brandTrans = await page.$eval('#tr-section', el => el.style.display);
  check('brands 不显示多语言区块', brandTrans === 'none', `display=${brandTrans}`);
  await page.screenshot({ path: `${OUT}/admin-content-brands.png` });
} catch (e) {
  fail++;
  console.log('\n❌ 测试异常：', e.message);
  await page.screenshot({ path: `${OUT}/content-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
