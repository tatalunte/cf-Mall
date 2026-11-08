/**
 * 首页（改造版：服务端直出精选产品 + 站点设置 + 多语言）
 * 原版首页产品区是 spinner，Google 抓不到任何产品信息。
 */
import { createLayout } from './layout';
import { productCardHtml } from './product-card';
import { escapeHtml, truncate } from '../utils/html';
import { markdownToText } from '../utils/markdown';
import { t, localizedUrl, localizedProduct, formatDate, isoDate } from '../i18n';

const DEFAULTS = {
  site_name: 'B2B Product Exhibition',
  site_description: 'Your trusted partner for high-quality industrial products and innovative solutions worldwide',
  company_intro: 'We are a leading manufacturer and supplier of high-quality industrial products. With over 20 years of experience, we serve clients across the globe with innovative solutions and exceptional customer service.',
};

async function loadSettings(env) {
  try {
    const raw = await env.STATIC_ASSETS.get('website_settings');
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export async function homePage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = await loadSettings(env);

  let featured = [];
  let latest = [];
  let metrics = [];
  let certs = [];
  let brands = [];
  try {
    const [f, n, a, c, b] = await Promise.all([
      env.DB.prepare('SELECT * FROM products WHERE is_featured = 1 AND is_active = 1 ORDER BY created_at DESC LIMIT 8').all(),
      env.DB.prepare('SELECT * FROM posts WHERE is_published = 1 ORDER BY published_at DESC LIMIT 3').all(),
      env.DB.prepare('SELECT * FROM factory_assets WHERE is_active = 1 AND metric IS NOT NULL ORDER BY sort_order, id LIMIT 4').all(),
      env.DB.prepare('SELECT * FROM certifications WHERE is_active = 1 ORDER BY sort_order, id LIMIT 6').all(),
      env.DB.prepare('SELECT * FROM brands WHERE is_active = 1 ORDER BY sort_order, id LIMIT 8').all(),
    ]);
    featured = f.results || [];
    latest = n.results || [];
    metrics = a.results || [];
    certs = c.results || [];
    brands = b.results || [];
  } catch (e) { console.error('home query failed', e); }

  const featuredHtml = featured.length
    ? featured.map(p => productCardHtml(p, lang, env)).join('')
    : `<p style="grid-column:1/-1;text-align:center;color:var(--text-light)">
         No featured products yet — add products and mark them as featured in the admin dashboard.
       </p>`;

  const content = `
    <section class="hero">
      <div class="container">
        <h1>${escapeHtml(settings.site_name)}</h1>
        <p id="hero-subtitle">${escapeHtml(settings.site_description)}</p>
        <div style="margin-top:2rem">
          <a href="${escapeHtml(localizedUrl('/products', lang, env))}" class="btn btn-primary hide-on-mobile" style="margin-right:1rem">
            ${escapeHtml(t(lang, 'products'))}
          </a>
          <a href="${escapeHtml(localizedUrl('/contact', lang, env))}" class="btn btn-secondary">
            ${escapeHtml(t(lang, 'sendInquiry'))}
          </a>
        </div>
      </div>
    </section>

    ${metrics.length ? `
    <!-- 工厂实力数字条（阶段一B，来自 factory_assets） -->
    <section style="background:var(--band-bg);color:var(--band-fg);padding:2rem 0;margin-top:2rem">
      <div class="container" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1.5rem;text-align:center">
        ${metrics.map(m => `<div>
          <div style="font-size:1.5rem;font-weight:700">${escapeHtml(m.metric)}</div>
          <div style="font-size:.82rem;opacity:.92;margin-top:.2rem">${escapeHtml(localizedProduct(m, lang, 'title') || m.title)}</div>
        </div>`).join('')}
      </div>
    </section>` : ''}

    <section class="container" style="margin-top:3rem">
      <div style="text-align:center;max-width:800px;margin:0 auto">
        <h2 style="font-size:2rem;margin-bottom:1rem;color:var(--primary-color)">${escapeHtml(t(lang, 'aboutUs'))}</h2>
        <p id="company-intro" style="color:var(--text-light);font-size:1.1rem;line-height:1.8">
          ${escapeHtml(settings.company_intro)}
        </p>
      </div>
    </section>

    <!-- Featured Products：服务端直出，爬虫可直接读取 -->
    <section class="container" style="margin-top:3rem;margin-bottom:3rem">
      <h2 style="text-align:center;font-size:2rem;margin-bottom:2rem;color:var(--primary-color)">
        ${escapeHtml(t(lang, 'featured'))}
      </h2>
      <div id="featured-products" class="grid grid-3">${featuredHtml}</div>
      <div style="text-align:center;margin-top:2rem">
        <a href="${escapeHtml(localizedUrl('/products', lang, env))}" class="btn btn-primary">
          ${escapeHtml(t(lang, 'viewAll'))}
        </a>
      </div>
    </section>

    ${latest.length ? `
    <!-- 最新动态（阶段一B） -->
    <section class="container" style="margin:3rem auto 1rem">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1.25rem;gap:1rem;flex-wrap:wrap">
        <h2 style="font-size:1.5rem;color:var(--primary-color)">${escapeHtml(t(lang, 'news'))}</h2>
        <a href="${localizedUrl('/news', lang, env)}" style="color:var(--text-light);font-size:.88rem;text-decoration:none">${escapeHtml(t(lang, 'allNews'))} →</a>
      </div>
      <div class="grid grid-3">
        ${latest.map(p => {
          const title = localizedProduct(p, lang, 'title') || p.title;
          const excerpt = localizedProduct(p, lang, 'excerpt') || p.excerpt || markdownToText(p.content, 110);
          return `<article class="card"><a href="${localizedUrl('/news/' + (p.slug || p.id), lang, env)}" style="text-decoration:none;color:inherit;display:block">
            <div style="padding:1.15rem">
              <time datetime="${isoDate(p.published_at)}" style="font-size:.75rem;color:var(--text-light)">${escapeHtml(formatDate(p.published_at, lang))}</time>
              <h3 style="font-size:1rem;margin:.4rem 0;line-height:1.4">${escapeHtml(title)}</h3>
              <p style="font-size:.85rem;color:var(--text-light)">${escapeHtml(truncate(excerpt, 100))}</p>
            </div></a></article>`;
        }).join('')}
      </div>
    </section>` : ''}

    ${certs.length ? `
    <!-- 资质证书（可信度） -->
    <section class="container" style="margin:2rem auto">
      <h2 style="font-size:1.35rem;text-align:center;margin-bottom:1.25rem">${escapeHtml(t(lang, 'ourCertifications'))}</h2>
      <div style="display:flex;flex-wrap:wrap;gap:1rem;justify-content:center">
        ${certs.map(c => `<div style="border:1px solid var(--border-color);border-radius:.5rem;padding:.75rem 1.1rem;background:var(--bg-card);text-align:center;min-width:150px">
          <div style="font-weight:600;font-size:.9rem">${escapeHtml(localizedProduct(c, lang, 'name') || c.name)}</div>
          <div style="font-size:.72rem;color:var(--text-light)">${escapeHtml(c.issuer || '')}</div>
        </div>`).join('')}
      </div>
    </section>` : ''}

    ${brands.length ? `
    <section class="container" style="margin:2rem auto 3rem">
      <h2 style="font-size:1.35rem;text-align:center;margin-bottom:1rem">${escapeHtml(t(lang, 'trustedBy'))}</h2>
      <div style="display:flex;flex-wrap:wrap;gap:2rem;justify-content:center;align-items:center">
        ${brands.map(b => b.logo_url
          ? `<img src="${escapeHtml(b.logo_url)}" alt="${escapeHtml(b.name)}" title="${escapeHtml(b.name)}" style="height:34px;object-fit:contain;filter:grayscale(1);opacity:.8" loading="lazy">`
          : `<span style="font-weight:600;color:var(--text-light);font-size:.95rem">${escapeHtml(b.name)}</span>`).join('')}
      </div>
    </section>` : ''}

    <style>
      @media (max-width: 768px) { .hide-on-mobile { display: none !important; } }
      .card-description { display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden }
    </style>
  `;

  return new Response(createLayout(
    settings.site_name,
    content,
    '', // 不再需要客户端拉取产品
    settings.site_description,
    false,
    { env, request, lang, settings }
  ), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
}
