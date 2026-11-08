/**
 * SEO 端点（改造版新增）
 * 原版没有 sitemap.xml / robots.txt / canonical / hreflang / JSON-LD，
 * 且产品正文靠客户端 JS 渲染，Google 抓到的是空壳。
 */
import { escapeHtml } from '../utils/html';
import { localizedUrl, supportedLangs } from '../i18n';

export async function sitemapXml(request, env) {
  const base = (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : new URL(request.url).origin;
  const langs = supportedLangs(env);
  const def = env.DEFAULT_LANG || 'en';

  const products = (await env.DB.prepare(
    'SELECT id, slug, updated_at, image_url, name FROM products WHERE is_active = 1 ORDER BY id'
  ).all()).results || [];

  // 内容模块（阶段一B）：失败时不影响 sitemap 其余部分
  let posts = [];
  let cases = [];
  try {
    posts = (await env.DB.prepare(
      'SELECT slug, updated_at, published_at FROM posts WHERE is_published = 1 ORDER BY published_at DESC'
    ).all()).results || [];
    cases = (await env.DB.prepare(
      'SELECT slug, updated_at, created_at FROM cases WHERE is_published = 1'
    ).all()).results || [];
  } catch (e) { console.error('sitemap content query failed', e); }

  const alternates = (path) => [
    ...langs.map(l =>
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeHtml(base + localizedUrl(path, l, env))}"/>`
    ),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(base + localizedUrl(path, def, env))}"/>`,
  ].join('\n');

  const staticPaths = ['/', '/products', '/cases', '/news', '/about', '/contact', '/faq'];
  const entries = [
    ...staticPaths.map(p => ({ path: p, lastmod: null, priority: p === '/' ? '1.0' : '0.8' })),
    ...products.map(p => ({ path: productPath(p), lastmod: p.updated_at, priority: '0.7' })),
    ...posts.map(p => ({ path: `/news/${p.slug}`, lastmod: p.updated_at || p.published_at, priority: '0.6' })),
    ...cases.map(c => ({ path: `/cases/${c.slug}`, lastmod: c.updated_at || c.created_at, priority: '0.6' })),
  ];

  const urls = entries.map(({ path, lastmod, priority }) => `  <url>
    <loc>${escapeHtml(base + localizedUrl(path, def, env))}</loc>${lastmod ? `\n    <lastmod>${escapeHtml(String(lastmod).slice(0, 10))}</lastmod>` : ''}
${alternates(path)}
    <changefreq>${path === '/' ? 'daily' : 'weekly'}</changefreq>
    <priority>${priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export function productPath(p) {
  return `/products/${p.slug || p.id}`;
}

export async function robotsTxt(request, env) {
  const base = (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : new URL(request.url).origin;
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /*?*q=

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Cache-Control': 'public, max-age=86400' },
  });
}
