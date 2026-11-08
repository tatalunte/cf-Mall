/**
 * 客户案例（阶段一B）
 * /cases 列表 + /cases/:slug 详情；详情展示国家/行业/关联产品，带 Article 结构化数据。
 */
import { createLayout } from './layout';
import { escapeHtml, truncate, jsonLdScript } from '../utils/html';
import { renderMarkdown, markdownToText } from '../utils/markdown';
import { t, localizedUrl, localizedProduct, formatDate, isoDate } from '../i18n';
import { productCardHtml } from './product-card';
import { parseJsonLoose } from '../utils/json';

function notFound(env) {
  const lang = env.LANG || 'en';
  return new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>404 - Case not found</title></head>
     <body style="font-family:system-ui;padding:4rem;text-align:center"><h1>404</h1>
     <p>This case study does not exist.</p>
     <p><a href="${localizedUrl('/cases', lang, env)}">Back to case studies</a></p></body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}

function cardHtml(c, lang, env) {
  const title = localizedProduct(c, lang, 'title') || c.title;
  const summary = localizedProduct(c, lang, 'summary') || c.summary || markdownToText(c.content, 140);
  const href = localizedUrl(`/cases/${c.slug || c.id}`, lang, env);
  const img = c.cover_image
    ? `<img src="${escapeHtml(c.cover_image)}" alt="${escapeHtml(title)}" loading="lazy"
         style="width:100%;height:180px;object-fit:cover;border-radius:.5rem .5rem 0 0">` : '';
  const meta = [c.country, c.industry].filter(Boolean).map(escapeHtml).join(' · ');
  return `
    <article class="card" style="display:flex;flex-direction:column">
      <a href="${escapeHtml(href)}" style="text-decoration:none;color:inherit">
        ${img}
        <div style="padding:1.25rem;display:flex;flex-direction:column;gap:.5rem;flex:1">
          ${meta ? `<div style="font-size:.78rem;color:var(--text-light)">${meta}</div>` : ''}
          <h2 style="font-size:1.05rem;line-height:1.4">${escapeHtml(title)}</h2>
          <p style="color:var(--text-light);font-size:.9rem;flex:1">${escapeHtml(truncate(summary, 150))}</p>
          <span style="color:var(--accent-color);font-size:.85rem;font-weight:600">${escapeHtml(t(lang, 'readMore'))} →</span>
        </div>
      </a>
    </article>`;
}

export async function casesListPage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = env.SETTINGS || {};
  const siteName = settings.site_name || 'B2B Product Exhibition';

  let cases = [];
  try {
    const r = await env.DB.prepare(
      'SELECT * FROM cases WHERE is_published = 1 ORDER BY created_at DESC LIMIT 30'
    ).all();
    cases = r.results || [];
  } catch (e) { console.error('cases query failed', e); }

  const cards = cases.length
    ? cases.map(c => cardHtml(c, lang, env)).join('')
    : `<p style="grid-column:1/-1;text-align:center;color:var(--text-light)">No case studies yet.</p>`;

  const content = `
    <section class="hero" style="padding:3rem 2rem">
      <div class="container">
        <h1>${escapeHtml(t(lang, 'cases'))}</h1>
        <p>How our products perform in real projects around the world.</p>
      </div>
    </section>
    <section class="container" style="margin:2rem auto 4rem">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem">${cards}</div>
    </section>`;

  return new Response(createLayout(
    `${t(lang, 'cases')} - ${siteName}`, content, '',
    `Customer case studies - ${siteName}`, false, { env, request, lang, settings }
  ), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
}

export async function caseDetailPage(request, env, slug) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = env.SETTINGS || {};
  const siteName = settings.site_name || 'B2B Product Exhibition';

  let item = null;
  try {
    item = await env.DB.prepare('SELECT * FROM cases WHERE slug = ? AND is_published = 1').bind(slug).first();
  } catch (e) { console.error('case detail query failed', e); }
  if (!item) return notFound(env);

  const base = (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : new URL(request.url).origin;

  const title = localizedProduct(item, lang, 'title') || item.title;
  const summary = localizedProduct(item, lang, 'summary') || item.summary || markdownToText(item.content, 160);
  const body = renderMarkdown(localizedProduct(item, lang, 'content') || item.content);
  const pagePath = `/cases/${item.slug}`;

  // 关联产品
  let related = [];
  try {
    const ids = parseJsonLoose(item.product_ids, []);
    if (Array.isArray(ids) && ids.length) {
      const ph = ids.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `SELECT * FROM products WHERE id IN (${ph}) AND is_active = 1`
      ).bind(...ids.map(Number)).all();
      related = r.results || [];
    }
  } catch { /* product_ids 非法 JSON 时忽略 */ }

  const articleLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: truncate(title, 110),
    description: truncate(summary, 200),
    image: item.cover_image ? [new URL(item.cover_image, base).toString()] : undefined,
    datePublished: item.created_at ? new Date(String(item.created_at).replace(' ', 'T') + 'Z').toISOString() : undefined,
    author: { '@type': 'Organization', name: siteName },
    publisher: { '@type': 'Organization', name: siteName },
    mainEntityOfPage: base + localizedUrl(pagePath, lang, env),
  });

  const facts = [
    [t(lang, 'country'), item.country],
    [t(lang, 'applications'), item.industry],
  ].filter(([, v]) => v);

  const content = `
    <article class="container" style="max-width:860px;margin:2rem auto 4rem;padding:0 1rem">
      <nav style="font-size:.85rem;color:var(--text-light);margin-bottom:1rem">
        <a href="${localizedUrl('/', lang, env)}" style="color:var(--text-light)">${escapeHtml(t(lang, 'home'))}</a> /
        <a href="${localizedUrl('/cases', lang, env)}" style="color:var(--text-light)">${escapeHtml(t(lang, 'cases'))}</a>
      </nav>
      <h1 style="font-size:2rem;line-height:1.3;margin-bottom:1rem">${escapeHtml(title)}</h1>
      ${item.cover_image ? `<img src="${escapeHtml(item.cover_image)}" alt="${escapeHtml(title)}" style="width:100%;border-radius:.5rem;margin-bottom:1.5rem">` : ''}
      ${facts.length ? `<dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;background:var(--bg-light);padding:1rem 1.25rem;border-radius:.5rem;margin-bottom:1.5rem">
        ${facts.map(([k, v]) => `<div><dt style="font-size:.78rem;color:var(--text-light)">${escapeHtml(k)}</dt><dd style="font-weight:600">${escapeHtml(v)}</dd></div>`).join('')}
      </dl>` : ''}
      <div class="article-body" style="font-size:1.02rem;line-height:1.75">${body}</div>

      ${related.length ? `<section style="margin-top:3rem">
        <h2 style="font-size:1.25rem;margin-bottom:1rem">${escapeHtml(t(lang, 'relatedProducts'))}</h2>
        <div class="grid grid-3">${related.map(p => productCardHtml(p, lang, env)).join('')}</div>
      </section>` : ''}

      <div style="margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--border-color)">
        <a class="btn btn-primary" href="${localizedUrl('/contact', lang, env)}">${escapeHtml(t(lang, 'getQuote'))}</a>
      </div>
    </article>
    <style>
      .article-body h3 { font-size:1.2rem; margin:1.6rem 0 .6rem }
      .article-body p { margin:.75rem 0 }
      .article-body ul, .article-body ol { margin:.75rem 0 .75rem 1.4rem }
      .article-body a { color:var(--primary-color) }
    </style>`;

  return new Response(createLayout(
    `${title} - ${siteName}`, content, '', summary, false,
    { env, request, lang, settings, path: pagePath, ogImage: item.cover_image, jsonld: articleLd }
  ), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
}
