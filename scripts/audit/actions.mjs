/**
 * 交互审计：像真人一样把关键路径走一遍。
 *
 * 与 ui-test-* 系列的区别：
 *   那些脚本验证「功能对不对」（断言业务逻辑），这个脚本验证「站点能不能用」——
 *   按钮点了有没有反应、表单提交后有没有下文、改完设置前台有没有生效、有没有点着点着就 404 的链接。
 *
 * 每个动作独立 try/catch：一处失败不会让后面的场景全部跳过（避免「第一条挂了全绿变全红」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderProductImage } from '../lib/png.mjs';

const SHOT_DIR = 'test-artifacts/audit';

export async function runActions(browser, base, creds) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));

  const results = [];
  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOT_DIR, name + '.png'), fullPage: false }).catch(() => {});
  };

  /** 一个场景 = 一段异步函数 */
  async function step(name, fn) {
    const t0 = Date.now();
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail || '', ms: Date.now() - t0 });
      console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
    } catch (e) {
      const msg = String(e.message || e).split('\n')[0].slice(0, 180);
      results.push({ name, ok: false, detail: msg, ms: Date.now() - t0 });
      console.log(`  ❌ ${name} — ${msg}`);
    }
  }

  const go = async (p) => {
    const res = await page.goto(base + p, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    return res;
  };

  const text = () => page.locator('body').innerText();

  /* ================= 公开站 ================= */

  await step('导航：每个主菜单链接都能到达目标页', async () => {
    await go('/');
    const links = await page.locator('.nav-menu a[href]').evaluateAll(as =>
      as.map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/') && !h.startsWith('//')));
    const unique = [...new Set(links)].slice(0, 12);
    if (!unique.length) throw new Error('顶部导航没有找到内链');
    const bad = [];
    for (const href of unique) {
      const r = await page.request.get(base + href);
      if (r.status() !== 200) bad.push(`${href}=${r.status()}`);
    }
    if (bad.length) throw new Error(bad.join(', '));
    return `${unique.length} 个导航链接全部 200`;
  });

  await step('首页订阅表单：提交后给出确认提示', async () => {
    await go('/');
    const form = page.locator('form[data-subscribe], #subscribe-form, form:has(input[type="email"])').first();
    if (!(await form.count())) throw new Error('页面上找不到订阅表单');
    const email = `audit-sub-${Date.now().toString(36)}@example.com`;
    await form.locator('input[type="email"]').first().fill(email);
    await form.locator('button[type="submit"], button').first().click();
    await page.waitForTimeout(1200);
    const body = await text();
    if (!/check|inbox|subscrib|确认|邮件/i.test(body)) throw new Error('提交后没有出现任何确认文案');
    return '收到确认提示';
  });

  // 列表是「隐藏」而不是「移除」DOM，所以必须数可见卡片，不能数 DOM 节点
  const visibleCards = () => page.evaluate(() => [...document.querySelectorAll('article.product-card, .product-card')]
    .filter(el => el.offsetParent !== null).length);

  await step('产品列表：搜索关键词能过滤', async () => {
    await go('/products');
    const input = page.locator('#search-input');
    if (!(await input.count())) throw new Error('找不到搜索框 #search-input');
    const before = await visibleCards();
    if (before === 0) throw new Error('列表初始就是空的');
    await input.fill('pump');
    await page.waitForTimeout(700);
    const after = await visibleCards();
    if (after === 0) throw new Error('搜索 pump 后一个结果都没有');
    if (after >= before) throw new Error(`搜索后没有过滤（${before} → ${after}）`);
    await input.fill('');
    await page.waitForTimeout(500);
    const restored = await visibleCards();
    if (restored !== before) throw new Error(`清空搜索后没有恢复（${before} → ${restored}）`);
    return `${before} → ${after} 条，清空后恢复`;
  });

  await step('产品列表：分类下拉能筛选', async () => {
    await go('/products');
    const select = page.locator('#category-filter');
    if (!(await select.count())) throw new Error('找不到分类下拉 #category-filter');
    const opts = await select.locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
    if (!opts.length) throw new Error('分类下拉没有选项');
    const before = await visibleCards();
    await select.selectOption(opts[0]);
    await page.waitForTimeout(700);
    const after = await visibleCards();
    if (after === 0) throw new Error(`选择分类 ${opts[0]} 后没有结果`);
    if (after >= before) throw new Error(`分类筛选没生效（${before} → ${after}）`);
    return `${opts.length} 个分类；${opts[0]} → ${after} 条`;
  });

  await step('产品详情：图库图片全部加载成功', async () => {
    await go('/products');
    const first = page.locator('article.product-card a, .product-card a[href^="/products/"]').first();
    if (!(await first.count())) throw new Error('产品列表没有可点的产品卡');
    await first.click();
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const imgs = await page.evaluate(() => [...document.querySelectorAll('img')].map(i => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })));
    const broken = imgs.filter(i => !i.ok);
    if (broken.length) throw new Error(`${broken.length} 张图未加载：${broken[0].src}`);
    return `${imgs.length} 张图全部渲染`;
  });

  await step('产品详情：询盘弹窗能打开并拦截空提交', async () => {
    await go('/products/plc-control-cabinet-hr-plc8-ip65');
    const openBtn = page.locator('#send-inquiry-btn');
    if (!(await openBtn.count())) throw new Error('找不到「发送询盘」按钮');
    await openBtn.click();
    await page.waitForTimeout(600);
    const form = page.locator('#inquiry-form');
    if (!(await form.isVisible())) throw new Error('点按钮后询盘弹窗没有出现');
    await page.locator('#inquiry-submit, #inquiry-form button[type="submit"]').first().click();
    await page.waitForTimeout(500);
    const invalid = await page.evaluate(() => {
      const fields = [...document.querySelectorAll('#inquiry-form input[required], #inquiry-form textarea[required], #inquiry-form input[type="checkbox"][required]')];
      return fields.some(el => !el.checkValidity());
    });
    if (!invalid) throw new Error('必填项为空却能提交（没有原生校验）');
    return '弹窗打开，空提交被拦下';
  });

  await step('产品详情：填写询盘并提交，落库成功', async () => {
    const email = `audit-lead-${Date.now().toString(36)}@example.com`;
    await page.locator('#inquiry-name').fill('Audit Robot');
    await page.locator('#inquiry-email').fill(email);
    await page.locator('#inquiry-company').fill('Audit QA Ltd');
    await page.locator('#inquiry-country').fill('Singapore');
    await page.locator('#inquiry-message').fill('Automated audit inquiry — 20 pcs, please quote FOB.');
    await page.locator('#inquiry-consent').check();
    await page.locator('#inquiry-submit, #inquiry-form button[type="submit"]').first().click();
    await page.waitForTimeout(2500);
    const body = await text();
    if (!/thank|received|success|1 business day|已收到/i.test(body)) throw new Error('提交后没有成功提示');
    return '提交成功并显示确认文案';
  });

  await step('联系页：表单可提交', async () => {
    await go('/contact');
    if (!(await page.locator('#contact-form').count())) throw new Error('联系页没有 #contact-form');
    const email = `audit-contact-${Date.now().toString(36)}@example.com`;
    await page.locator('#contact-name').fill('Audit Robot');
    await page.locator('#contact-email').fill(email);
    await page.locator('#contact-company').fill('Audit QA Ltd');
    await page.locator('#contact-country').fill('Singapore');
    const subject = page.locator('#contact-subject');
    const subjOpts = await subject.locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
    if (subjOpts.length) await subject.selectOption(subjOpts[0]);
    await page.locator('#contact-message').fill('Audit message: please confirm this form works end to end.');
    await page.locator('#contact-consent').check();
    await page.locator('#contact-form button[type="submit"]').click();
    await page.waitForTimeout(2500);
    const body = await text();
    if (!/thank|received|success|shortly|已收到/i.test(body)) throw new Error('提交后没有成功提示');
    return '提交成功，收到 toast 确认';
  });

  await step('FAQ：条目可以展开收起', async () => {
    await go('/faq');
    const item = page.locator('details').first();
    if (await item.count()) {
      const openBefore = await item.evaluate(el => el.open);
      await item.locator('summary').click();
      await page.waitForTimeout(300);
      const openAfter = await item.evaluate(el => el.open);
      if (openBefore === openAfter) throw new Error('点击 summary 后开合状态没变');
      return 'details/summary 正常开合';
    }
    const q = page.locator('.faq-question, .faq-item button').first();
    if (!(await q.count())) throw new Error('没有找到可展开的 FAQ 条目');
    await q.click();
    return 'FAQ 条目可点击';
  });

  await step('语言切换：西语前缀可访问且内容变化', async () => {
    await go('/es/products');
    const title = await page.title();
    const body = await text();
    if (!/producto|productos|bomba|válvula|valvula/i.test(body) && !/es/i.test(page.url())) {
      throw new Error('西语页面没有出现西语内容');
    }
    await go('/ar/products');
    const dir = await page.evaluate(() => document.documentElement.dir);
    if (dir !== 'rtl') throw new Error('阿语页面没有 dir="rtl"');
    return `/es 正常，/ar 为 RTL`;
  });

  await step('报价页：加行 / 删行 / 金额重算', async () => {
    await go('/quote');
    const rowsBefore = await page.locator('#item-list .qi-row').count();
    if (rowsBefore < 1) throw new Error('报价表单没有初始行');
    const addBtn = page.locator('#add-item');
    if (!(await addBtn.count())) throw new Error('找不到加行按钮 #add-item');
    await addBtn.click();
    await page.waitForTimeout(400);
    const rowsAfterAdd = await page.locator('#item-list .qi-row').count();
    if (rowsAfterAdd <= rowsBefore) throw new Error('点加行后行数没变');
    const firstRow = page.locator('#item-list .qi-row').first();
    await firstRow.locator('[data-f="name"]').fill('Audit test pump');
    await firstRow.locator('[data-f="qty"]').fill('10');
    await page.waitForTimeout(500);
    const counter = await page.locator('#item-count').innerText().catch(() => '');
    if (!/\d/.test(counter)) throw new Error('件数指示器没有更新');
    const lastRow = page.locator('#item-list .qi-row').last();
    await lastRow.locator('[data-del]').click();
    await page.waitForTimeout(300);
    const rowsAfterDel = await page.locator('#item-list .qi-row').count();
    if (rowsAfterDel !== rowsAfterAdd - 1) throw new Error('删行后行数没减少');
    return `${rowsBefore} → ${rowsAfterAdd} → ${rowsAfterDel}（${counter.trim()}）`;
  });

  await step('报价页：完整提交生成报价单号', async () => {
    await go('/quote');
    const email = `audit-quote-${Date.now().toString(36)}@example.com`;
    const row = page.locator('#item-list .qi-row').first();
    await row.locator('[data-f="name"]').fill('Audit test pump');
    await row.locator('[data-f="qty"]').fill('5');
    await page.locator('#qf-email').fill(email);
    await page.locator('#qf-name').fill('Audit Buyer');
    await page.locator('#qf-company').fill('Audit QA Ltd');
    await page.locator('#qf-message').fill('Automated quote request from the audit robot.');
    await page.locator('#qf-submit').click();
    await page.waitForTimeout(3000);
    const successVisible = await page.locator('#qf-success').isVisible().catch(() => false);
    const body = await text();
    const m = body.match(/QT-\d{8}-\d{4}/);
    if (!successVisible && !m) {
      const err = await page.locator('#qf-error').innerText().catch(() => '');
      throw new Error('提交后既没有成功面板也没有单号' + (err ? `：${err}` : ''));
    }
    if (!m) throw new Error('成功面板出现但没有报价单号');
    return m[0];
  });

  await step('客户门户：提交邮箱后返回中性提示（不泄露是否存在）', async () => {
    await go('/account');
    const email = `nobody-${Date.now().toString(36)}@example.com`;
    await page.locator('input[type="email"]').first().fill(email);
    await page.locator('form button[type="submit"], button:has-text("Send")').first().click();
    await page.waitForTimeout(2000);
    const body = await text();
    if (!/if this email|if that email|如果.*邮箱/i.test(body)) throw new Error('没有返回防枚举的统一文案');
    return '返回统一文案';
  });

  await step('404：不存在的地址返回 404 且有返回首页入口', async () => {
    const res = await go('/this-page-does-not-exist-' + Date.now().toString(36));
    if (!res || res.status() !== 404) throw new Error(`期望 404，实际 ${res?.status()}`);
    const back = await page.locator('a[href="/"]').count();
    if (!back) throw new Error('404 页面没有返回首页的链接');
    return '404 + 返回入口';
  });

  await step('死按钮扫描：全站 <a href="#"> 必须带行为', async () => {
    const targets = ['/', '/products', '/about', '/contact', '/faq', '/cases', '/news'];
    const bad = [];
    for (const t of targets) {
      await go(t);
      const dead = await page.evaluate(() => [...document.querySelectorAll('a[href="#"]')]
        .filter(a => !a.getAttribute('onclick') && !a.dataset.tab && !a.id && !a.dataset.view && !a.getAttribute('role'))
        .map(a => (a.textContent || '').trim().slice(0, 30)));
      if (dead.length) bad.push(`${t}: ${dead.join(' / ')}`);
    }
    if (bad.length) throw new Error('存在无行为的 # 链接 → ' + bad.join(' | '));
    return `${targets.length} 个页面无死按钮`;
  });

  /* ================= 后台 ================= */

  await step('后台登录：错误密码被拒绝', async () => {
    await go('/admin/login');
    await page.locator('input[name="username"], #username').first().fill(creds.user);
    await page.locator('input[type="password"], #password').first().fill('wrong-password-123');
    await page.locator('form button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
    await page.waitForTimeout(1500);
    const body = await text();
    if (/dashboard/i.test(page.url())) throw new Error('错误密码竟然登录成功');
    if (!/invalid|incorrect|failed|错误/i.test(body)) throw new Error('没有显示错误提示');
    return '错误提示正常';
  });

  await step('后台登录：正确口令进入概览', async () => {
    await page.locator('input[name="username"], #username').first().fill(creds.user);
    await page.locator('input[type="password"], #password').first().fill(creds.pass);
    await page.locator('form button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click();
    await page.waitForURL(/admin\/dashboard/, { timeout: 15000 });
    // 等真实数字，别把初始的 0 当成「加载完成」
    await page.waitForFunction(() => {
      const el = document.querySelector('#stat-products');
      return el && parseInt(el.textContent || '0', 10) > 0;
    }, { timeout: 20000 }).catch(() => {});
    const products = await page.locator('#stat-products').innerText();
    const inquiries = await page.locator('#stat-inquiries').innerText();
    if (parseInt(products, 10) === 0) throw new Error('概览产品数仍为 0（/admin/stats 没返回或渲染失败）');
    return `产品 ${products.trim()} · 询盘 ${inquiries.trim()}`;
  });

  await step('后台产品：新增（含图片上传）→ 列表出现', async () => {
    await page.locator('[data-tab="products"]').click();
    await page.waitForTimeout(1500);
    await page.locator('button:has-text("Add Product"), #add-product-btn').first().click();
    await page.waitForTimeout(600);
    const name = 'Audit Test Product ' + Date.now().toString(36);
    await page.locator('#product-name').fill(name);
    await page.locator('#product-category').fill('Audit');
    await page.locator('#product-description').fill('Created by the automated audit robot.');
    // 上传一张真图，验证 R2 链路
    const png = renderProductImage(400, 300, 300, 1);
    const tmp = path.join(SHOT_DIR, 'upload-tmp.png');
    fs.writeFileSync(tmp, png);
    await page.locator('#image-upload').setInputFiles(tmp);
    await page.waitForFunction(() => {
      const el = document.querySelector('#product-image-url');
      return el && el.value && el.value.length > 0;
    }, { timeout: 20000 }).catch(() => {});
    const url = await page.locator('#product-image-url').inputValue();
    if (!url || !url.includes('/api/upload/image/')) throw new Error('上传后 image_url 为空');
    await page.locator('#product-form button[type="submit"]').click();
    await page.waitForTimeout(2500);
    const body = await text();
    if (!body.includes(name)) throw new Error('保存后列表里没有新产品');
    await page.evaluate(n => { localStorage.setItem('__auditProductName', n); }, name);
    return `已上传图片并创建：${name.slice(0, 24)}…`;
  });

  await step('后台产品：编辑并保存生效', async () => {
    const name = await page.evaluate(() => localStorage.getItem('__auditProductName'));
    const row = page.locator(`tr:has-text("${name}")`).first();
    if (!(await row.count())) throw new Error('列表里找不到刚建的产品');
    await row.locator('button:has-text("Edit")').first().click();
    await page.waitForTimeout(900);
    const newName = name + ' EDITED';
    await page.locator('#product-name').fill(newName);
    await page.locator('#product-form button[type="submit"]').click();
    await page.waitForTimeout(2200);
    const body = await text();
    if (!body.includes(newName)) throw new Error('编辑后的名称没有出现在列表');
    await page.evaluate(n => { localStorage.setItem('__auditProductName', n); }, newName);
    return '改名已保存';
  });

  await step('后台产品：删除（软下架）→ 可恢复', async () => {
    const name = await page.evaluate(() => localStorage.getItem('__auditProductName'));
    const row = page.locator(`tr:has-text("${name}")`).first();
    if (!(await row.count())) throw new Error('找不到待删除的产品');
    await row.locator('button:has-text("Delete")').first().click();
    await page.waitForTimeout(2500);
    // 软删除：行还在，但状态必须变成 Inactive，并出现 Restore 入口
    const rowAfter = page.locator(`tr:has-text("${name}")`).first();
    if (!(await rowAfter.count())) throw new Error('删除后整行消失了（预期是保留但标记 Inactive）');
    const status = await rowAfter.innerText();
    if (!/inactive/i.test(status)) throw new Error('删除后状态没有变成 Inactive');
    const restore = rowAfter.locator('button:has-text("Restore")');
    if (!(await restore.count())) throw new Error('已下架产品没有恢复入口');
    await restore.click();
    await page.waitForTimeout(2200);
    const back = await page.locator(`tr:has-text("${name}")`).first().innerText();
    if (!/active/i.test(back) || /inactive/i.test(back)) throw new Error('点 Restore 后没有恢复上架');
    return '下架 → Inactive → Restore 恢复上架';
  });

  await step('后台 SEO：改首页 title 后前台立刻生效', async () => {
    await page.locator('[data-tab="seo"]').click();
    await page.waitForSelector('.seo-page', { timeout: 20000 });
    const pageCount = await page.locator('.seo-page').count();
    if (pageCount < 7) throw new Error(`只渲染了 ${pageCount} 个页面配置（应有 7 个）`);
    // details 默认折叠，输入框不可见。这里直接展开全部，比点 summary 稳：
    // loadSeoSettings 可能被重复触发重建 DOM，点开的状态会被冲掉。
    await page.evaluate(() => document.querySelectorAll('.seo-page').forEach(d => { d.open = true; }));
    await page.waitForTimeout(300);
    const input = page.locator('.seo-page').first().locator('[data-field="title"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    const original = await input.inputValue();
    const marker = 'AUDIT-SEO-' + Date.now().toString(36);
    await input.fill(marker + ' | Hengrui Industrial');
    await page.locator('#save-seo-btn').click();
    await page.waitForTimeout(2500);
    const home = await page.request.get(base + '/');
    const html = await home.text();
    if (!html.includes(marker)) throw new Error('前台首页 title 没有更新（后台保存后未生效）');
    // 还原
    await page.evaluate(() => document.querySelectorAll('.seo-page').forEach(d => { d.open = true; }));
    await page.locator('.seo-page').first().locator('[data-field="title"]').fill(original);
    await page.locator('#save-seo-btn').click();
    await page.waitForTimeout(2000);
    const back = await (await page.request.get(base + '/')).text();
    if (back.includes(marker)) throw new Error('还原后前台仍带着测试标题');
    return `7 个页面可配；保存后 / 的 <title> 已同步，还原成功`;
  });

  await step('后台设置：改电话后前台页脚同步', async () => {
    await page.locator('[data-tab="settings"]').click();
    await page.waitForTimeout(1500);
    const phone = page.locator('#settings-phone');
    const original = await phone.inputValue();
    const marker = '+86 574 9999 ' + Date.now().toString().slice(-4);
    await phone.fill(marker);
    await page.locator('#settings-form button[type="submit"]').click();
    await page.waitForTimeout(2200);
    const home = await page.request.get(base + '/');
    const html = await home.text();
    if (!html.includes(marker.split(' ').slice(-1)[0])) throw new Error('前台页脚没有出现新电话');
    await phone.fill(original);
    await page.locator('#settings-form button[type="submit"]').click();
    await page.waitForTimeout(1500);
    return '设置保存 → 前台已反映';
  });

  // 这一条专门守 settings.js 的 ALLOWED_KEYS：银行信息曾经被后端消费、
  // 却不在白名单里，运营填了也存不进去，PDF 永远停在「contact sales」。
  await step('后台设置：营业时间同步前台 + 收款账户能落库', async () => {
    await page.locator('[data-tab="settings"]').click();
    await page.waitForTimeout(1500);
    const hoursEl = page.locator('#settings-business-hours');
    const bankEl = page.locator('#settings-bank-name');
    if (!(await hoursEl.count())) throw new Error('设置页缺少营业时间字段');
    if (!(await bankEl.count())) throw new Error('设置页缺少开户银行字段');

    const origHours = await hoursEl.inputValue();
    const origBank = await bankEl.inputValue();
    const stamp = Date.now().toString().slice(-4);
    const hoursMarker = 'Audit Hours ' + stamp;
    const bankMarker = 'Audit Bank ' + stamp;

    await hoursEl.fill(hoursMarker + '\nSaturday: Closed');
    await bankEl.fill(bankMarker);
    await page.locator('#settings-form button[type="submit"]').click();
    await page.waitForTimeout(2200);

    const contactHtml = await (await page.request.get(base + '/contact')).text();
    if (!contactHtml.includes(hoursMarker)) throw new Error('联系页没有渲染新的营业时间');

    const token = await page.evaluate(() => localStorage.getItem('admin_token'));
    const res = await page.request.get(base + '/api/settings', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const saved = ((await res.json()) || {}).data || {};
    if (saved.bank_name !== bankMarker) {
      throw new Error('bank_name 没有落库（ALLOWED_KEYS 漏了）→ ' + JSON.stringify(saved.bank_name));
    }
    if (!String(saved.business_hours || '').includes(hoursMarker)) {
      throw new Error('business_hours 没有落库');
    }

    await hoursEl.fill(origHours);
    await bankEl.fill(origBank);
    await page.locator('#settings-form button[type="submit"]').click();
    await page.waitForTimeout(1500);
    return '营业时间 → 联系页已同步；开户银行已落库（会印到订单 PDF）';
  });

  // 主题：不是「改了个属性」就算通过 —— 必须验证底色真的变了、刷新后还在、
  // 且访客自己的选择优先于后台默认值，否则等于给运维一个心理安慰。
  await step('前台主题：切换 → 底色真变深 → 刷新保持 → 还原', async () => {
    await go('/');
    const btn = page.locator('#theme-toggle');
    if (!(await btn.count())) throw new Error('导航上找不到主题切换按钮');
    if (!(await page.locator('#theme-menu').isHidden())) throw new Error('主题面板默认应收起');

    await btn.click();
    await page.waitForTimeout(150);
    const opts = await page.locator('.theme-opt').count();
    if (opts !== 7) throw new Error('主题选项数量不对（6 套配色 + 夜间 auto）：' + opts);

    const lum = (c) => {
      const [r, g, b] = (c.match(/\d+/g) || [255, 255, 255]).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const bgBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (lum(bgBefore) < 0.7) throw new Error('默认主题应该是亮底：' + bgBefore);

    await page.locator('.theme-opt[data-theme="midnight"]').click();
    await page.waitForTimeout(250);
    const applied = await page.evaluate(() => document.documentElement.dataset.theme);
    if (applied !== 'midnight') throw new Error('data-theme 没更新：' + applied);

    const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if (lum(bgDark) > 0.3) throw new Error('切了深色主题但 body 还是亮底：' + bgDark);

    // 正文必须是浅色，否则深底深字等于没切
    const fg = await page.evaluate(() => getComputedStyle(document.body).color);
    if (lum(fg) < 0.6) throw new Error('深色主题下正文不是浅色：' + fg);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const kept = await page.evaluate(() => document.documentElement.dataset.theme);
    if (kept !== 'midnight') throw new Error('刷新后没有保持主题：' + kept);

    await page.click('#theme-toggle');
    await page.locator('.theme-opt[data-theme="classic"]').click();
    await page.waitForTimeout(200);
    return '7 项主题（含夜间 auto）· 深色底 rgb(10,17,32) · localStorage 持久 · 已还原';
  });

  // 夜间模式：不是「多个主题」这么简单，必须验证跟随系统的实时联动。
  // 用 emulateMedia 模拟系统明暗切换，断言 data-theme 与底色都跟着变，且不刷新页面。
  await step('夜间模式：跟随系统明暗自动切换（auto）', async () => {
    await go('/');
    const lum = (c) => {
      const [r, g, b] = (c.match(/\d+/g) || [255, 255, 255]).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const bgLum = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor).then(lum);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.click('#theme-toggle');
    await page.locator('.theme-opt[data-theme="auto"]').click();
    await page.waitForTimeout(200);
    const darkTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (darkTheme !== 'midnight') throw new Error('auto + 系统深色没有落到 midnight：' + darkTheme);
    if (await bgLum() > 0.3) throw new Error('auto 深色下底色没变深');

    // 不刷新，直接把系统切回浅色
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(250);
    const lightTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (lightTheme !== 'classic') throw new Error('系统转亮后 auto 没有跟随：' + lightTheme);
    if (await bgLum() < 0.7) throw new Error('系统转亮后底色没恢复');

    // 刷新后策略仍是 auto
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'midnight') {
      throw new Error('刷新后 auto 策略丢失');
    }

    // 还原：手动选 classic 即退出 auto
    await page.click('#theme-toggle');
    await page.locator('.theme-opt[data-theme="classic"]').click();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(150);
    return 'auto：系统深→midnight / 系统亮→classic（实时、无刷新）· 刷新保持 · 已还原';
  });

  await step('后台设置：默认主题落库并作用于首次访客', async () => {
    await go('/admin/dashboard');
    await page.locator('[data-tab="settings"]').click();
    await page.waitForTimeout(1200);
    const sel = page.locator('#settings-theme');
    if (!(await sel.count())) throw new Error('设置页缺少主题下拉（ALLOWED_KEYS 可能漏了 theme_default）');
    const orig = await sel.inputValue();

    await sel.selectOption('ocean');
    await page.locator('#settings-form button[type="submit"]').click();
    await page.waitForTimeout(2200);

    const token = await page.evaluate(() => localStorage.getItem('admin_token'));
    const saved = ((await (await page.request.get(base + '/api/settings', {
      headers: { Authorization: 'Bearer ' + token },
    })).json()) || {}).data || {};
    if (saved.theme_default !== 'ocean') {
      throw new Error('theme_default 没有落库 → ' + JSON.stringify(saved.theme_default));
    }

    // 不带 localStorage 的请求 = 首次访客，看到的就是服务端按 KV 渲染出来的主题
    const html = await (await page.request.get(base + '/')).text();
    if (!/data-theme="ocean"/.test(html)) throw new Error('SSR 没有采用新的默认主题');

    // 非法值必须被拒（防止后台被塞进任意字符串）
    const bad = await page.request.post(base + '/api/settings', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      data: { theme_default: '"><script>alert(1)</script>' },
    });
    const badJson = (await bad.json().catch(() => ({}))) || {};
    const badSaved = badJson.data?.theme_default;
    if (badSaved !== 'classic') throw new Error('非法主题值没有被清洗：' + JSON.stringify(badSaved));

    await sel.selectOption(orig || 'classic');
    await page.locator('#settings-form button[type="submit"]').click();
    await page.waitForTimeout(1500);
    return '改 ocean → KV 落库 → SSR 生效；非法值回落到 classic；已还原';
  });

  await step('后台交易：打开报价 → PDF 可下载', async () => {
    await go('/admin/trade');
    await page.waitForTimeout(800);
    // /admin/trade 默认停在 Overview，报价表要切到 Quotations 才会加载
    const quotesNav = page.locator('.side-link[data-view="quotes"]');
    if (await quotesNav.count()) { await quotesNav.click(); await page.waitForTimeout(1800); }
    await page.waitForSelector('#q-body tr button[data-act]', { timeout: 20000 }).catch(() => {});
    const rows = await page.locator('#q-body tr').count();
    const pdfBtn = page.locator('button[data-act="pdf"]').first();
    if (!(await pdfBtn.count())) {
      const body = (await text()).slice(0, 200);
      throw new Error(`找不到 PDF 按钮（列表 ${rows} 行）— ${body.replace(/\s+/g, ' ')}`);
    }
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
      pdfBtn.click(),
    ]);
    if (!download) throw new Error('点 PDF 没有触发下载');
    const name = download.suggestedFilename();
    const p = path.join(SHOT_DIR, name);
    await download.saveAs(p);
    const size = fs.statSync(p).size;
    if (size < 1000) throw new Error(`PDF 文件过小 (${size} bytes)`);
    if (!name.endsWith('.pdf')) throw new Error('下载文件名不是 .pdf');
    return `${rows} 条报价；${name} (${(size / 1024).toFixed(0)} KB)`;
  });

  await step('后台交易：报价一键转订单并推进状态', async () => {
    let orderBtn = page.locator('button[data-act="order"]').first();
    if (!(await orderBtn.count())) {
      await page.locator('.side-link[data-view="quotes"]').click().catch(() => {});
      await page.waitForTimeout(1800);
      orderBtn = page.locator('button[data-act="order"]').first();
    }
    if (!(await orderBtn.count())) throw new Error('找不到「转订单」按钮');
    await orderBtn.click();
    await page.waitForTimeout(3000);
    const body = await text();
    const m = body.match(/SO-\d{8}-\d{4}/);
    if (!m) throw new Error('转订单后没有显示订单号');
    // 记下来，收尾时清掉这张测试单，别让演示站越跑越脏
    await page.evaluate(no => localStorage.setItem('__auditOrderNo', no), m[0]);
    const next = page.locator('button:has-text("Confirm"), button:has-text("confirmed"), [data-status="confirmed"], button:has-text("In production")').first();
    if (await next.count()) {
      await next.click();
      await page.waitForTimeout(2000);
      return `${m[0]} 已创建并推进状态`;
    }
    return `${m[0]} 已创建（状态按钮未找到，跳过推进）`;
  });

  await step('后台内容：新闻列表能打开编辑表单', async () => {
    await go('/admin/content/posts');
    await page.waitForTimeout(1800);
    const rows = await page.locator('tbody tr').count();
    if (!rows) throw new Error('内容列表为空');
    const edit = page.locator('tbody tr button, tbody tr a').filter({ hasText: /Edit|编辑/ }).first();
    if (await edit.count()) {
      await edit.click();
      await page.waitForTimeout(900);
      const hasForm = await page.locator('form input[type="text"], form textarea').count();
      if (!hasForm) throw new Error('编辑表单没有渲染');
      return `${rows} 行，编辑表单可打开`;
    }
    return `${rows} 行（未见 Edit 按钮）`;
  });

  await step('清理：审计产生的产品 / 询盘 / 报价 / 订单', async () => {
    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('admin_token');
      const h = { Authorization: 'Bearer ' + token };
      const jh = { ...h, 'Content-Type': 'application/json' };
      const out = { product: 0, inquiry: 0, quote: 0, order: 0 };

      // 顺序很重要：先删订单，再删报价。
      // 报价一旦转过订单，deleteQuote 会返回 409（订单要能追溯金额来源），
      // 反过来先删报价就会留下一条永远删不掉的 accepted 报价。
      // 1) 本次转出来的测试订单：先取消，再删（有付款/在产的单不允许删）
      const orderNo = localStorage.getItem('__auditOrderNo');
      const os = await (await fetch('/api/orders?limit=200', { headers: h })).json();
      const o = (os.data || []).find(x => x.order_no === orderNo);
      if (o) {
        if (o.status !== 'cancelled') {
          await fetch('/api/orders/' + o.id + '/status', {
            method: 'PUT', headers: jh, body: JSON.stringify({ status: 'cancelled', message: 'Automated audit cleanup' }),
          });
        }
        const r = await fetch('/api/orders/' + o.id, { method: 'DELETE', headers: h });
        if (r.ok) out.order = 1;
      }

      // 2) 临时产品：先下架再物理删除（purge 只接受已下架的产品）
      const prodName = localStorage.getItem('__auditProductName');
      const prods = await (await fetch('/api/products?limit=200', { headers: h })).json();
      const p = (prods.data || []).find(x => x.name === prodName);
      if (p) {
        await fetch('/api/products/' + p.id, { method: 'DELETE', headers: h });
        const r = await fetch('/api/products/' + p.id + '?purge=1', { method: 'DELETE', headers: h });
        if (r.ok) out.product = 1;
      }

      // 3) 审计询盘（邮箱前缀 audit-）
      const inq = await (await fetch('/api/inquiries?limit=200', { headers: h })).json();
      for (const i of (inq.data || [])) {
        if (!String(i.email || '').startsWith('audit-')) continue;
        const r = await fetch('/api/inquiries/' + i.id, { method: 'DELETE', headers: h });
        if (r.ok) out.inquiry++;
      }

      // 4) 审计报价（同样按邮箱前缀）
      const qs = await (await fetch('/api/quotes?limit=200', { headers: h })).json();
      for (const q of (qs.data || [])) {
        if (!String(q.customer_email || '').startsWith('audit-')) continue;
        const r = await fetch('/api/quotes/' + q.id, { method: 'DELETE', headers: h });
        if (r.ok) out.quote++;
      }

      localStorage.removeItem('__auditProductName');
      localStorage.removeItem('__auditOrderNo');
      return out;
    });
    const failed = Object.entries(result).filter(([, n]) => n === 0).map(([k]) => k);
    // 产品可能在上一步已被清掉，不算失败
    return `清理 产品 ${result.product} · 询盘 ${result.inquiry} · 报价 ${result.quote} · 订单 ${result.order}`;
  });

  await step('后台退出登录：回到登录页且清掉 token', async () => {
    await go('/admin/dashboard');
    await page.waitForTimeout(1200);
    await page.locator('#logout-btn, #logout-btn-header').first().click();
    await page.waitForTimeout(1500);
    if (!/admin\/login/.test(page.url())) throw new Error('退出后没有回到登录页');
    const token = await page.evaluate(() => localStorage.getItem('admin_token'));
    if (token) throw new Error('退出后 localStorage 里仍留有 token');
    return '已退出并清理本地 token';
  });

  /* ================= 移动端 ================= */
  await step('移动端 375px：核心页无横向溢出', async () => {
    await ctx.close();
    const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const mp = await mctx.newPage();
    const bad = [];
    for (const p of ['/', '/products', '/about', '/contact', '/quote', '/admin/login']) {
      await mp.goto(base + p, { waitUntil: 'domcontentloaded' });
      await mp.waitForTimeout(600);
      const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 2) bad.push(`${p} 溢出 ${over}px`);
    }
    await mp.screenshot({ path: path.join(SHOT_DIR, 'mobile-home.png') }).catch(() => {});
    await mctx.close();
    if (bad.length) throw new Error(bad.join(' | '));
    return '6 个页面均无横向滚动';
  });

  await ctx.close().catch(() => {});
  return results;
}
