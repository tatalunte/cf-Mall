/**
 * 输出转义与结构化数据工具
 * 原版把 D1 字段直接拼进 innerHTML / HTML 模板，存在存储型 XSS。
 * 服务端直出时所有动态内容一律经过 escapeHtml。
 */

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(text, max = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export function jsonLdScript(obj) {
  // 防止 </script> 提前闭合
  const json = JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/** 把 "Material: Steel\nMOQ: 100pcs" 这类纯文本规格转成表格行 */
export function specsToRows(specs) {
  if (!specs) return '';
  return String(specs).split('\n').map(line => {
    const i = line.indexOf(':');
    if (i < 0) return `<tr><td colspan="2">${escapeHtml(line)}</td></tr>`;
    return `<tr><th>${escapeHtml(line.slice(0, i).trim())}</th><td>${escapeHtml(line.slice(i + 1).trim())}</td></tr>`;
  }).join('');
}

/** 产品 JSON-LD（Google Rich Results 的 Product 结构化数据） */
export function productJsonLd(product, siteUrl, lang, productUrl) {
  const images = [product.image_url, ...safeParseArray(product.gallery_images)]
    .filter(Boolean)
    .map(u => new URL(u, siteUrl).toString());
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: truncate(product.description || product.detailed_description, 300),
    image: images,
    sku: String(product.id),
    category: product.category || undefined,
    url: productUrl,
    brand: { '@type': 'Brand', name: product.brand || undefined },
    // B2B 通常不公开价格；如公开可补 offers（Google 更偏好带 offers）
  };
}

export function organizationJsonLd(settings, siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: settings.site_name,
    url: siteUrl,
    description: settings.site_description,
    email: settings.email,
    telephone: settings.phone,
    address: settings.address,
    sameAs: [settings.linkedin, settings.facebook, settings.twitter].filter(Boolean),
  };
}

export function safeParseArray(text) {
  try {
    const v = JSON.parse(text || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
