/**
 * 产品详情页（改造版：服务端直出 + 询盘表单 + 结构化数据）
 * 原版 HTML 里只有一个 spinner，产品名/参数全部靠客户端 innerHTML 渲染，
 * 且 D1 字段未转义直接进 innerHTML —— SEO 与 XSS 两头都不行。
 */
import { createLayout } from './layout';
import { productCardHtml } from './product-card';
import { escapeHtml, truncate, jsonLdScript, productJsonLd, specsToRows, safeParseArray } from '../utils/html';
import { localizedUrl, localizedProduct, t } from '../i18n';
import { productPath } from './seo';
import { srcsetAttr, HERO_WIDTHS } from '../utils/image';

async function loadSettings(env) {
  try { return JSON.parse((await env.STATIC_ASSETS.get('website_settings')) || '{}'); }
  catch { return {}; }
}

function siteBase(env, request) {
  return (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '') : new URL(request.url).origin;
}

export async function productDetailPage(request, env) {
  const url = new URL(request.url);
  const idOrSlug = decodeURIComponent(url.pathname.split('/').pop() || '');
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = await loadSettings(env);
  const base = siteBase(env, request);

  let product = null;
  try {
    product = await env.DB.prepare(
      `SELECT * FROM products WHERE (CAST(id AS TEXT) = ? OR slug = ?) AND is_active = 1 LIMIT 1`
    ).bind(idOrSlug, idOrSlug).first();
  } catch (e) { console.error('product query failed', e); }

  if (!product) {
    const body = createLayout('Product not found',
      '<section class="container" style="padding:4rem 0;text-align:center"><h1>Product not found</h1><p><a href="/products">Back to products</a></p></section>',
      '', 'Product not found', true, { env, request, lang, settings });
    return new Response(body, { status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  const p = { ...product };
  p.name = localizedProduct(product, lang, 'name') || product.name;
  p.description = localizedProduct(product, lang, 'description') || product.description;
  p.detailed_description = localizedProduct(product, lang, 'detailed_description') || product.detailed_description;
  const path = productPath(product);
  const productUrl = base + localizedUrl(path, lang, env);
  const image = product.image_url || '/images/placeholder.svg';
  const gallery = safeParseArray(product.gallery_images);

  // 相关产品（阶段一C）：优先用手工指定的 related_ids，否则同分类推荐
  let related = [];
  try {
    const ids = safeParseArray(product.related_ids).map(Number).filter(Boolean).slice(0, 4);
    if (ids.length) {
      const r = await env.DB.prepare(
        `SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND is_active = 1`
      ).bind(...ids).all();
      related = r.results || [];
    } else if (product.category) {
      const r = await env.DB.prepare(
        'SELECT * FROM products WHERE category = ? AND id != ? AND is_active = 1 LIMIT 3'
      ).bind(product.category, product.id).all();
      related = r.results || [];
    }
  } catch (e) { console.error('related products query failed', e); }

  const applications = String(product.applications || '')
    .split(/[,，\n;；]/).map(s => s.trim()).filter(Boolean).slice(0, 10);

  const jsonld = [
    jsonLdScript(productJsonLd(p, base, lang, productUrl)),
    jsonLdScript({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: t(lang, 'home'), item: base + localizedUrl('/', lang, env) },
        { '@type': 'ListItem', position: 2, name: t(lang, 'products'), item: base + localizedUrl('/products', lang, env) },
        { '@type': 'ListItem', position: 3, name: p.name, item: productUrl },
      ],
    }),
  ].join('\n  ');

  const turnstile = (env.TURNSTILE_SITEKEY && !env.TURNSTILE_SITEKEY.startsWith('REPLACE_'))
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
       <div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITEKEY)}" data-theme="light"></div>`
    : '<p style="font-size:.8rem;color:#b45309">⚠️ Turnstile 未配置，上线前务必配置，否则表单会被机器人灌爆。</p>';

  const content = `
    <div class="container" style="margin-top:2rem;margin-bottom:3rem">
      <nav aria-label="Breadcrumb" style="margin-bottom:2rem;font-size:.9rem">
        <a href="${escapeHtml(localizedUrl('/', lang, env))}">${escapeHtml(t(lang, 'home'))}</a> /
        <a href="${escapeHtml(localizedUrl('/products', lang, env))}">${escapeHtml(t(lang, 'products'))}</a> /
        <span style="color:var(--primary-color)">${escapeHtml(p.name)}</span>
      </nav>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3rem;margin-bottom:3rem" class="product-hero">
        <div>
          <img src="${escapeHtml(image)}" alt="${escapeHtml(p.name)}" itemprop="image"
               width="1000" height="750" decoding="async" fetchpriority="high"
               sizes="(max-width: 820px) 92vw, 46vw"${srcsetAttr(env, image, HERO_WIDTHS)}
               style="width:100%;height:auto;border-radius:.5rem" loading="eager">
          ${gallery.length ? `<div style="display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap">${gallery.map(g =>
            `<img src="${escapeHtml(g)}" alt="${escapeHtml(p.name)} gallery" loading="lazy" style="width:80px;height:80px;object-fit:cover;border-radius:.3rem">`
          ).join('')}</div>` : ''}
        </div>
        <div>
          <span style="background:var(--primary-color);color:var(--on-primary);padding:.25rem .75rem;border-radius:1rem;font-size:.85rem">
            ${escapeHtml(product.category || 'General')}
          </span>
          <h1 itemprop="name" style="font-size:2rem;margin:1rem 0">${escapeHtml(p.name)}</h1>
          <p itemprop="description" style="color:var(--text-light);font-size:1.1rem;line-height:1.8">
            ${escapeHtml(p.description || '')}
          </p>
          ${product.moq ? `<p style="margin-top:1rem"><strong>MOQ:</strong> ${escapeHtml(product.moq)}</p>` : ''}
          ${product.brand ? `<p><strong>Brand:</strong> ${escapeHtml(product.brand)}</p>` : ''}

          <!-- 阶段一C：交期 / 样品 / 定制 / 资料，都是海外买家决策要素 -->
          ${(product.lead_time || product.sample_policy || product.customization || product.datasheet_url || product.video_url) ? `
          <dl style="display:grid;grid-template-columns:auto 1fr;gap:.45rem 1rem;margin-top:1rem;font-size:.92rem;background:var(--bg-light);padding:1rem;border-radius:.5rem">
            ${product.lead_time ? `<dt style="color:var(--text-light)">${escapeHtml(t(lang, 'leadTime'))}</dt><dd style="margin:0">${escapeHtml(product.lead_time)}</dd>` : ''}
            ${product.sample_policy ? `<dt style="color:var(--text-light)">${escapeHtml(t(lang, 'samplePolicy'))}</dt><dd style="margin:0">${escapeHtml(product.sample_policy)}</dd>` : ''}
            ${product.customization ? `<dt style="color:var(--text-light)">${escapeHtml(t(lang, 'customization'))}</dt><dd style="margin:0">${escapeHtml(product.customization)}</dd>` : ''}
          </dl>` : ''}

          <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1rem">
            ${product.datasheet_url ? `<a class="btn" href="${escapeHtml(product.datasheet_url)}" target="_blank" rel="noopener" download>⬇ ${escapeHtml(t(lang, 'datasheet'))}</a>` : ''}
            ${product.video_url ? `<a class="btn" href="${escapeHtml(product.video_url)}" target="_blank" rel="noopener">▶ ${escapeHtml(t(lang, 'video'))}</a>` : ''}
          </div>

          <button id="send-inquiry-btn" class="btn btn-primary" style="font-size:1.1rem;padding:1rem 2rem;margin-top:1.5rem">
            ${escapeHtml(t(lang, 'sendInquiry'))}
          </button>
        </div>
      </div>

      <section style="background:var(--bg-light);padding:2rem;border-radius:.5rem;margin-bottom:2rem">
        <h2 style="font-size:1.5rem;margin-bottom:1rem;color:var(--primary-color)">${escapeHtml(t(lang, 'description'))}</h2>
        <div style="line-height:1.8;white-space:pre-line">${escapeHtml(p.detailed_description || p.description || '')}</div>
      </section>

      ${product.specifications ? `
      <section style="background:var(--bg-card);padding:2rem;border-radius:.5rem;box-shadow:0 2px 4px rgba(0,0,0,.1)">
        <h2 style="font-size:1.5rem;margin-bottom:1rem;color:var(--primary-color)">${escapeHtml(t(lang, 'specifications'))}</h2>
        <table style="width:100%;border-collapse:collapse">
          <tbody>${specsToRows(product.specifications)}</tbody>
        </table>
      </section>` : ''}

      ${applications.length ? `
      <section style="margin-top:2rem">
        <h2 style="font-size:1.35rem;margin-bottom:1rem;color:var(--primary-color)">${escapeHtml(t(lang, 'applications'))}</h2>
        <div style="display:flex;flex-wrap:wrap;gap:.5rem">
          ${applications.map(a => `<span style="background:var(--bg-light);border:1px solid var(--border-color);padding:.35rem .8rem;border-radius:1rem;font-size:.88rem">${escapeHtml(a)}</span>`).join('')}
        </div>
      </section>` : ''}

      ${related.length ? `
      <section style="margin-top:3rem">
        <h2 style="font-size:1.35rem;margin-bottom:1.25rem;color:var(--primary-color)">${escapeHtml(t(lang, 'relatedProducts'))}</h2>
        <div class="grid grid-3">${related.map(r => productCardHtml(r, lang, env)).join('')}</div>
      </section>` : ''}
    </div>

    <!-- 询盘弹窗 -->
    <div id="inquiry-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;padding:2rem">
      <div style="max-width:600px;margin:2rem auto;background:var(--bg-card);border-radius:.5rem;padding:2rem;max-height:90vh;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
          <h2 style="color:var(--primary-color)">${escapeHtml(t(lang, 'sendInquiry'))}</h2>
          <button type="button" id="close-modal" aria-label="Close"
                  style="background:none;border:none;font-size:1.5rem;cursor:pointer">&times;</button>
        </div>
        <form id="inquiry-form">
          <input type="hidden" id="inquiry-product-id" value="${escapeHtml(product.id)}">
          <input type="text" name="website" tabindex="-1" autocomplete="off"
                 style="position:absolute;left:-9999px" aria-hidden="true">
          <div class="form-group"><label class="form-label">${escapeHtml(t(lang, 'yourName'))} *</label>
            <input type="text" id="inquiry-name" class="form-input" required maxlength="120" autocomplete="name"></div>
          <div class="form-group"><label class="form-label">${escapeHtml(t(lang, 'email'))} *</label>
            <input type="email" id="inquiry-email" class="form-input" required maxlength="254" autocomplete="email"></div>
          <div class="form-group"><label class="form-label">${escapeHtml(t(lang, 'company'))}</label>
            <input type="text" id="inquiry-company" class="form-input" maxlength="120" autocomplete="organization"></div>
          <div class="form-group"><label class="form-label">${escapeHtml(t(lang, 'phone'))}</label>
            <input type="tel" id="inquiry-phone" class="form-input" maxlength="60" autocomplete="tel"></div>
          <div class="form-group"><label class="form-label">${escapeHtml(t(lang, 'country'))}</label>
            <input type="text" id="inquiry-country" class="form-input" maxlength="80" autocomplete="country-name"></div>
          <div class="form-group"><label class="form-label">${escapeHtml(t(lang, 'message'))} *</label>
            <textarea id="inquiry-message" class="form-textarea" required maxlength="5000"></textarea></div>
          <div class="form-group"><label class="form-label" for="inquiry-attachment">${escapeHtml(t(lang, 'attachment'))}</label>
            <input type="file" id="inquiry-attachment" class="form-input" accept=".pdf,.jpg,.jpeg,.png">
            <small style="color:var(--text-light);font-size:.75rem">PDF / JPG / PNG, max 5 MB</small></div>
          <div class="form-group" style="font-size:.85rem">
            <label><input type="checkbox" id="inquiry-consent" required> ${escapeHtml(t(lang, 'consent'))}
              (<a href="${escapeHtml(localizedUrl('/privacy', lang, env))}" target="_blank">Privacy Policy</a>)</label>
          </div>
          ${turnstile}
          <div style="display:flex;gap:1rem;margin-top:1rem">
            <button type="submit" class="btn btn-primary">${escapeHtml(t(lang, 'submit'))}</button>
            <button type="button" id="cancel-inquiry" class="btn" style="background:#6b7280;color:#fff">${escapeHtml(t(lang, 'cancel'))}</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const scripts = `
    <script>
      (function () {
        var modal = document.getElementById('inquiry-modal');
        var form = document.getElementById('inquiry-form');
        function open() { modal.style.display = 'block'; document.body.style.overflow = 'hidden'; }
        function close() { modal.style.display = 'none'; document.body.style.overflow = 'auto'; }
        document.getElementById('send-inquiry-btn').addEventListener('click', open);
        document.getElementById('close-modal').addEventListener('click', close);
        document.getElementById('cancel-inquiry').addEventListener('click', close);
        modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

        form.addEventListener('submit', async function (e) {
          e.preventDefault();
          var btn = form.querySelector('button[type="submit"]');
          btn.disabled = true; btn.textContent = 'Sending...';
          var tokenEl = form.querySelector('input[name="cf-turnstile-response"]');

          // multipart：附件与询盘一次提交
          var fd = new FormData();
          fd.append('product_id', document.getElementById('inquiry-product-id').value);
          fd.append('name', document.getElementById('inquiry-name').value);
          fd.append('email', document.getElementById('inquiry-email').value);
          fd.append('company', document.getElementById('inquiry-company').value);
          fd.append('phone', document.getElementById('inquiry-phone').value);
          fd.append('country', document.getElementById('inquiry-country').value);
          fd.append('message', document.getElementById('inquiry-message').value);
          fd.append('website', form.querySelector('input[name="website"]').value);
          fd.append('consent', document.getElementById('inquiry-consent').checked ? 'true' : 'false');
          fd.append('lang', '${lang}');
          fd.append('source', location.pathname + ' (product #${escapeHtml(String(product.id))})');
          fd.append('turnstile_token', tokenEl ? tokenEl.value : '');

          var fileEl = document.getElementById('inquiry-attachment');
          if (fileEl && fileEl.files && fileEl.files[0]) {
            if (fileEl.files[0].size > 5 * 1024 * 1024) {
              showNotification('Attachment must be under 5 MB', 'error');
              btn.disabled = false; btn.textContent = '${escapeHtml(t(lang, 'submit'))}';
              return;
            }
            fd.append('attachment', fileEl.files[0]);
          }

          var attr = window.getAttribution ? window.getAttribution() : {};
          Object.keys(attr).forEach(function (k) { if (attr[k]) fd.append(k, attr[k]); });

          try {
            var res = await fetch('/api/inquiries', { method: 'POST', body: fd });
            var out = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(out.error || 'failed');
            if (window.trackLead) window.trackLead({ source: 'product_inquiry', product_id: Number(document.getElementById('inquiry-product-id').value) });
            showNotification('${escapeHtml(t(lang, 'success'))}', 'success');
            form.reset(); close();
            if (window.turnstile) window.turnstile.reset();
          } catch (err) {
            showNotification(err.message || '${escapeHtml(t(lang, 'failed'))}', 'error');
            if (window.turnstile) window.turnstile.reset();
          } finally {
            btn.disabled = false; btn.textContent = '${escapeHtml(t(lang, 'submit'))}';
          }
        });
      })();
    </script>
    <style>
      @media (max-width: 768px) { .product-hero { grid-template-columns: 1fr !important; } }
    </style>
  `;

  const html = createLayout(
    product.seo_title || p.name,
    content,
    scripts,
    product.seo_description || truncate(p.description || p.detailed_description, 160),
    false,
    { env, request, lang, settings, path, product: true, ogImage: image, jsonld }
  );
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300',
    },
  });
}
