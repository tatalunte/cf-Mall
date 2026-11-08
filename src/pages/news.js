/**
 * 新闻 / 动态（阶段一B）
 * 列表 /news 与详情 /news/:slug 全部服务端直出，带 Article + BreadcrumbList 结构化数据。
 */
import { createLayout } from './layout';
import { escapeHtml, truncate, jsonLdScript } from '../utils/html';
import { renderMarkdown, markdownToText } from '../utils/markdown';
import { t, localizedUrl, localizedProduct, formatDate, isoDate } from '../i18n';

const PAGE_SIZE = 9;

function notFound(env) {
  const lang = env.LANG || 'en';
  return new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>404 - Article not found</title></head>
     <body style="font-family:system-ui;padding:4rem;text-align:center">
     <h1>404</h1><p>This article does not exist or has been unpublished.</p>
     <p><a href="${localizedUrl('/news', lang, env)}">Back to news</a></p></body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}

const CATEGORY_LABEL = {
  news: { en: 'News', es: 'Noticias', ar: 'أخبار' },
  event: { en: 'Events', es: 'Eventos', ar: 'فعاليات' },
  company: { en: 'Company', es: 'Empresa', ar: 'الشركة' },
};

function categoryLabel(cat, lang) {
  const m = CATEGORY_LABEL[cat] || CATEGORY_LABEL.news;
  return m[lang] || m.en;
}

function cardHtml(post, lang, env) {
  const title = localizedProduct(post, lang, 'title') || post.title;
  const excerpt = localizedProduct(post, lang, 'excerpt') || post.excerpt
    || markdownToText(post.content, 140);
  const href = localizedUrl(`/news/${post.slug || post.id}`, lang, env);
  const img = post.cover_image
    ? `<img src="${escapeHtml(post.cover_image)}" alt="${escapeHtml(title)}" loading="lazy"
         style="width:100%;height:180px;object-fit:cover;border-radius:.5rem .5rem 0 0">`
    : '';
  return `
    <article class="card" style="display:flex;flex-direction:column">
      <a href="${escapeHtml(href)}" style="text-decoration:none;color:inherit">
        ${img}
        <div style="padding:1.25rem;display:flex;flex-direction:column;gap:.5rem;flex:1">
          <div style="display:flex;gap:.5rem;align-items:center;font-size:.78rem;color:var(--text-light)">
            <span style="background:var(--bg-light);padding:.15rem .45rem;border-radius:.25rem">${escapeHtml(categoryLabel(post.category, lang))}</span>
            <time datetime="${isoDate(post.published_at)}">${escapeHtml(formatDate(post.published_at, lang))}</time>
          </div>
          <h2 style="font-size:1.05rem;line-height:1.4">${escapeHtml(title)}</h2>
          <p style="color:var(--text-light);font-size:.9rem;flex:1">${escapeHtml(truncate(excerpt, 150))}</p>
          <span style="color:var(--accent-color);font-size:.85rem;font-weight:600">${escapeHtml(t(lang, 'readMore'))} →</span>
        </div>
      </a>
    </article>`;
}

export async function newsListPage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = env.SETTINGS || {};
  const siteName = settings.site_name || 'B2B Product Exhibition';
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);

  let posts = [];
  let total = 0;
  try {
    const r = await env.DB.prepare(
      'SELECT * FROM posts WHERE is_published = 1 ORDER BY published_at DESC LIMIT ? OFFSET ?'
    ).bind(PAGE_SIZE, (page - 1) * PAGE_SIZE).all();
    posts = r.results || [];
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE is_published = 1').first();
    total = c?.n || 0;
  } catch (e) { console.error('news query failed', e); }

  const cards = posts.length
    ? posts.map(p => cardHtml(p, lang, env)).join('')
    : `<p style="grid-column:1/-1;text-align:center;color:var(--text-light)">No news yet.</p>`;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pagination = pages > 1 ? `
    <nav style="display:flex;gap:.5rem;justify-content:center;margin-top:2rem">
      ${page > 1 ? `<a class="btn" href="${localizedUrl('/news', lang, env)}?page=${page - 1}">← Prev</a>` : ''}
      <span style="padding:.5rem .75rem;color:var(--text-light)">${page} / ${pages}</span>
      ${page < pages ? `<a class="btn" href="${localizedUrl('/news', lang, env)}?page=${page + 1}">Next →</a>` : ''}
    </nav>` : '';

  const content = `
    <section class="hero" style="padding:3rem 2rem">
      <div class="container">
        <h1>${escapeHtml(t(lang, 'news'))}</h1>
        <p>Company updates, exhibitions and factory news.</p>
      </div>
    </section>
    <section class="container" style="margin:2rem auto 4rem">
      <div class="grid grid-3" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem">
        ${cards}
      </div>
      ${pagination}
    </section>`;

  return new Response(createLayout(
    `${t(lang, 'news')} - ${siteName}`,
    content,
    '',
    `Latest news and exhibitions from ${siteName}`,
    false,
    { env, request, lang, settings }
  ), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
}

export async function newsDetailPage(request, env, slug) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = env.SETTINGS || {};
  const siteName = settings.site_name || 'B2B Product Exhibition';

  let post = null;
  try {
    post = await env.DB.prepare('SELECT * FROM posts WHERE slug = ? AND is_published = 1').bind(slug).first();
  } catch (e) { console.error('news detail query failed', e); }
  if (!post) return notFound(env);

  const base = (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : new URL(request.url).origin;

  const title = localizedProduct(post, lang, 'title') || post.title;
  const excerpt = localizedProduct(post, lang, 'excerpt') || post.excerpt || markdownToText(post.content, 160);
  const body = renderMarkdown(localizedProduct(post, lang, 'content') || post.content);
  const seoTitle = localizedProduct(post, lang, 'seo_title') || post.seo_title || title;
  const seoDesc = localizedProduct(post, lang, 'seo_description') || post.seo_description || excerpt;
  const pagePath = `/news/${post.slug}`;

  const articleLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: truncate(title, 110),
    description: truncate(seoDesc, 200),
    image: post.cover_image ? [new URL(post.cover_image, base).toString()] : undefined,
    datePublished: post.published_at ? new Date(post.published_at.replace(' ', 'T') + 'Z').toISOString() : undefined,
    dateModified: post.updated_at ? new Date(String(post.updated_at).replace(' ', 'T') + 'Z').toISOString() : undefined,
    author: { '@type': 'Organization', name: siteName },
    publisher: { '@type': 'Organization', name: siteName },
    mainEntityOfPage: base + localizedUrl(pagePath, lang, env),
  });

  const breadcrumbLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t(lang, 'home'), item: base + localizedUrl('/', lang, env) },
      { '@type': 'ListItem', position: 2, name: t(lang, 'news'), item: base + localizedUrl('/news', lang, env) },
      { '@type': 'ListItem', position: 3, name: title },
    ],
  });

  const content = `
    <article class="container" style="max-width:820px;margin:2rem auto 4rem;padding:0 1rem">
      <nav style="font-size:.85rem;color:var(--text-light);margin-bottom:1rem">
        <a href="${localizedUrl('/', lang, env)}" style="color:var(--text-light)">${escapeHtml(t(lang, 'home'))}</a> /
        <a href="${localizedUrl('/news', lang, env)}" style="color:var(--text-light)">${escapeHtml(t(lang, 'news'))}</a>
      </nav>
      <div style="display:flex;gap:.6rem;align-items:center;font-size:.82rem;color:var(--text-light);margin-bottom:.75rem">
        <span style="background:var(--bg-light);padding:.15rem .5rem;border-radius:.25rem">${escapeHtml(categoryLabel(post.category, lang))}</span>
        <time datetime="${isoDate(post.published_at)}">${escapeHtml(formatDate(post.published_at, lang))}</time>
      </div>
      <h1 style="font-size:2rem;line-height:1.3;margin-bottom:1rem">${escapeHtml(title)}</h1>
      ${post.cover_image ? `<img src="${escapeHtml(post.cover_image)}" alt="${escapeHtml(title)}" style="width:100%;border-radius:.5rem;margin-bottom:1.5rem">` : ''}
      <div class="article-body" style="font-size:1.02rem;line-height:1.75">
        ${body}
      </div>
      <div style="margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--border-color);display:flex;gap:1rem;flex-wrap:wrap">
        <a class="btn btn-primary" href="${localizedUrl('/contact', lang, env)}">${escapeHtml(t(lang, 'contactUs'))}</a>
        <a class="btn" href="${localizedUrl('/news', lang, env)}">← ${escapeHtml(t(lang, 'allNews'))}</a>
      </div>
    </article>
    <style>
      .article-body h3 { font-size:1.2rem; margin:1.6rem 0 .6rem }
      .article-body h4 { font-size:1.05rem; margin:1.4rem 0 .5rem }
      .article-body p { margin:.75rem 0 }
      .article-body ul, .article-body ol { margin:.75rem 0 .75rem 1.4rem }
      .article-body li { margin:.3rem 0 }
      .article-body a { color:var(--primary-color) }
    </style>`;

  return new Response(createLayout(
    seoTitle,
    content,
    '',
    seoDesc,
    false,
    { env, request, lang, settings, path: pagePath, ogImage: post.cover_image, jsonld: articleLd + breadcrumbLd }
  ), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
}
