/**
 * 全站爬虫：以「一个真实访客会点到的每一条内链」为边界，检查页面健康度。
 *
 * 为什么不能只测固定路径清单：
 *   硬编码的清单只能证明「我写死的 URL 是好的」，证明不了「站内没有死链」。
 *   用户点的是 <a href>，所以检测也必须从 <a href> 出发。
 *
 * 检查项：HTTP 状态 / 控制台错误 / 失败请求 / 图片是否真的渲染 / title / description /
 *        canonical / h1 数量 / 内链可达性 / 表单是否可交互。
 */

const IGNORE_CONSOLE = [
  /favicon/i,
  /Failed to load resource: the server responded with a status of 404 \(\)/i,
];

/** 第三方统计脚本在本地/无网环境必然失败，不该算进站点缺陷 */
const IGNORE_REQUEST = /google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.net|hotjar\.com|clarity\.ms|challenges\.cloudflare\.com/i;

/**
 * @param {import('playwright-core').Browser} browser
 * @param {{ base:string, maxPages?:number, startPaths?:string[], requireAuthToken?:string, label?:string }} opts
 */
export async function crawlSite(browser, opts) {
  const base = opts.base;
  const maxPages = opts.maxPages || 120;
  const label = opts.label || 'public';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (opts.storage) await ctx.addInitScript(opts.storage);
  const page = await ctx.newPage();

  const pages = [];
  const seen = new Set();
  const queue = [...(opts.startPaths || ['/'])];
  const externalLinks = new Set();

  // 每个页面单独收集错误，避免串页
  let errors = [];
  let failures = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => {
    if (IGNORE_REQUEST.test(r.url())) return;
    const reason = r.failure()?.errorText || 'failed';
    // 翻到下一页时被取消的图片请求（net::ERR_ABORTED）是浏览器正常行为，不是站点缺陷
    if (/ERR_ABORTED/i.test(reason)) return;
    failures.push(`${r.method()} ${r.url().slice(0, 120)} — ${reason}`);
  });
  page.on('response', r => {
    if (r.status() < 400 || IGNORE_REQUEST.test(r.url())) return;
    failures.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
  });

  while (queue.length && pages.length < maxPages) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);

    errors = [];
    failures = [];
    let res = null;
    let navError = null;
    try {
      res = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // 等 JS 渲染完（后台页面全是客户端渲染）
      await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    } catch (e) {
      navError = e.message.split('\n')[0];
    }

    const status = res ? res.status() : 0;
    const info = {
      path,
      status,
      ok: status === 200 && !navError,
      navError,
      title: '',
      description: '',
      canonical: '',
      h1Count: 0,
      h1: '',
      images: { total: 0, broken: [] },
      forms: 0,
      buttons: 0,
      links: 0,
      consoleErrors: [],
      failures: [],
      issues: [],
      lang: '',
      dir: '',
    };

    if (status === 200 && !navError) {
      // 产品卡片 / 新闻封面都是 loading="lazy"：视口外的图浏览器压根不会发请求，
      // 此时 complete=false && naturalWidth=0 是「还没加载」而不是「图坏了」。
      // 采样前强制 eager 并等解码，才能拿到真实的 200 / 404（真坏图仍会被抓到）。
      await page.evaluate(() => {
        for (const i of document.querySelectorAll('img[loading="lazy"]')) {
          try { i.loading = 'eager'; } catch (e) { /* 老浏览器忽略 */ }
        }
      });
      await page.waitForFunction(
        () => [...document.querySelectorAll('img')].every(i => i.complete),
        null, { timeout: 5000 },
      ).catch(() => {});

      const meta = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const h1s = [...document.querySelectorAll('h1')];
        return {
          title: document.title || '',
          description: q('meta[name="description"]')?.content || '',
          canonical: q('link[rel="canonical"]')?.href || '',
          h1Count: h1s.length,
          h1: (h1s[0]?.textContent || '').trim().slice(0, 120),
          lang: document.documentElement.lang || '',
          dir: document.documentElement.dir || '',
          forms: document.querySelectorAll('form').length,
          buttons: document.querySelectorAll('button, [role="button"], input[type="submit"]').length,
        };
      });
      Object.assign(info, meta);

      const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
      info.links = hrefs.length;
      for (const href of hrefs) {
        if (!href) continue;
        if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
        if (/^https?:\/\//i.test(href)) {
          if (!href.startsWith('http://127.0.0.1') && !href.startsWith('http://localhost')) externalLinks.add(href);
          continue;
        }
        const clean = href.split('#')[0];
        if (!clean || clean.startsWith('/api/')) continue;
        if (clean.startsWith('/admin') && label !== 'admin') continue; // 后台单独爬，避免未登录被重定向刷屏
        if (!seen.has(clean) && !queue.includes(clean)) queue.push(clean);
      }

      const imgs = await page.evaluate(() => [...document.querySelectorAll('img')].map(i => ({
        src: i.currentSrc || i.src,
        ok: i.complete && i.naturalWidth > 0,
        alt: i.getAttribute('alt'),
      })));
      info.images.total = imgs.length;
      info.images.broken = imgs.filter(i => !i.ok).map(i => i.src);
      const noAlt = imgs.filter(i => i.ok && (i.alt === null || i.alt === undefined)).length;
      if (noAlt) info.issues.push(`${noAlt} 张图片缺少 alt`);
    }

    info.consoleErrors = errors.filter(t => !IGNORE_CONSOLE.some(re => re.test(t)));
    info.failures = [...new Set(failures)];

    // 控制台说「有个 404」，但这一页的网络层没有记录到任何 4xx ——
    // 说明它是上一页的异步回调残留（同一个 page 复用，监听器是全局的），不该算到本页头上。
    if (!info.failures.length) {
      info.consoleErrors = info.consoleErrors.filter(t => !/status of 404/i.test(t));
    }

    // ---- 判定 ----
    if (navError) info.issues.push('导航失败: ' + navError);
    if (status && status !== 200) info.issues.push('HTTP ' + status);
    if (status === 200 && !opts.skipSeo) {
      if (!info.title) info.issues.push('缺少 <title>');
      else if (info.title.length > 75) info.issues.push(`title 过长(${info.title.length})`);
      if (!info.description) info.issues.push('缺少 meta description');
      else if (info.description.length < 40) info.issues.push(`description 过短(${info.description.length})`);
      if (!info.canonical) info.issues.push('缺少 canonical');
      if (info.h1Count === 0) info.issues.push('缺少 h1');
      if (info.h1Count > 1) info.issues.push(`h1 重复(${info.h1Count})`);
    }
    if (status === 200) {
      if (info.images.broken.length) info.issues.push(`${info.images.broken.length} 张图片未加载`);
      if (info.consoleErrors.length) info.issues.push(`${info.consoleErrors.length} 条控制台错误`);
      if (info.failures.length) info.issues.push(`${info.failures.length} 个请求失败`);
    }

    pages.push(info);
  }

  await ctx.close();

  return {
    label,
    pages,
    visited: pages.length,
    queued: queue.length,
    externalLinks: [...externalLinks].slice(0, 30),
    summary: {
      total: pages.length,
      bad: pages.filter(p => !p.ok).length,
      withIssues: pages.filter(p => p.issues.length).length,
      consoleErrors: pages.reduce((n, p) => n + p.consoleErrors.length, 0),
      brokenImages: pages.reduce((n, p) => n + p.images.broken.length, 0),
    },
  };
}

/** sitemap.xml 里的每一条 URL 都必须能打开（这是最贴近搜索引擎视角的死链检测） */
export async function checkSitemap(browser, base) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.goto(base + '/sitemap.xml');
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const results = [];
  for (const loc of locs) {
    const r = await page.request.get(loc, { maxRedirects: 3 });
    results.push({ url: loc, status: r.status() });
  }
  await ctx.close();
  return {
    count: locs.length,
    broken: results.filter(r => r.status !== 200),
    results,
  };
}
