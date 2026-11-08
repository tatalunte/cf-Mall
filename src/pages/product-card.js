/**
 * 服务端直出的产品卡片（SEO 关键）
 * 原版所有产品卡片由客户端 innerHTML 渲染，Google 抓到的是 spinner；
 * 同时未转义的 D1 字段直接进 innerHTML，存在存储型 XSS。
 */
import { escapeHtml, truncate } from '../utils/html';
import { localizedProduct, localizedUrl, t } from '../i18n';
import { productPath } from './seo';
import { srcsetAttr, CARD_WIDTHS } from '../utils/image';

export function productCardHtml(product, lang, env) {
  const name = localizedProduct(product, lang, 'name') || product.name;
  const description = localizedProduct(product, lang, 'description') || product.description;
  const href = localizedUrl(productPath(product), lang, env);
  const image = product.image_url || '/images/placeholder.jpg';
  return `
    <article class="card product-card" itemscope itemtype="https://schema.org/Product">
      <a href="${escapeHtml(href)}" aria-label="${escapeHtml(name)}">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" class="card-image"
             loading="lazy" decoding="async" width="600" height="450" itemprop="image"
             sizes="(max-width: 640px) 92vw, (max-width: 1100px) 45vw, 360px"${srcsetAttr(env, image, CARD_WIDTHS)}
             onerror="this.onerror=null;this.src='/images/placeholder.svg'">
      </a>
      <div class="card-content">
        <span class="badge" style="background:var(--info-bg);color:var(--info-fg);padding:.2rem .7rem;border-radius:1rem;font-size:.8rem">
          ${escapeHtml(product.category || 'General')}
        </span>
        <h3 class="card-title" itemprop="name">${escapeHtml(name)}</h3>
        <p class="card-description" itemprop="description">${escapeHtml(truncate(description, 140))}</p>
        ${product.moq ? `<p style="font-size:.85rem;color:var(--text-light)">MOQ: ${escapeHtml(product.moq)}</p>` : ''}
        <a href="${escapeHtml(href)}" class="btn btn-primary">${escapeHtml(t(lang, 'viewDetails'))}</a>
      </div>
    </article>`;
}
