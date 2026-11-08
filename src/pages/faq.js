/**
 * FAQ 页面（阶段一B）
 * 按分类分组 + FAQPage 结构化数据（有机会在 Google 搜索结果里直接展开）。
 */
import { createLayout } from './layout';
import { escapeHtml, jsonLdScript } from '../utils/html';
import { t, localizedUrl, localizedProduct } from '../i18n';

const CATEGORY_LABEL = {
  general: { en: 'General', es: 'General', ar: 'عام' },
  payment: { en: 'Payment', es: 'Pago', ar: 'الدفع' },
  shipping: { en: 'Shipping & Lead Time', es: 'Envío y plazos', ar: 'الشحن والتسليم' },
  'after-sales': { en: 'Warranty & After-sales', es: 'Garantía y posventa', ar: 'الضمان وخدمة ما بعد البيع' },
  customization: { en: 'Customization', es: 'Personalización', ar: 'التخصيص' },
};

const catLabel = (c, lang) => (CATEGORY_LABEL[c] || CATEGORY_LABEL.general)[lang] || c;

export async function faqPage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = env.SETTINGS || {};
  const siteName = settings.site_name || 'B2B Product Exhibition';

  let faqs = [];
  try {
    const r = await env.DB.prepare(
      'SELECT * FROM faqs WHERE is_active = 1 ORDER BY category, sort_order, id'
    ).all();
    faqs = r.results || [];
  } catch (e) { console.error('faq query failed', e); }

  // 按分类分组，保持插入顺序
  const groups = new Map();
  for (const f of faqs) {
    const key = f.category || 'general';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  const sections = [...groups.entries()].map(([cat, items]) => `
    <section style="margin-bottom:2.5rem">
      <h2 style="font-size:1.25rem;margin-bottom:1rem;padding-bottom:.5rem;border-bottom:1px solid var(--border-color)">
        ${escapeHtml(catLabel(cat, lang))}
      </h2>
      ${items.map(f => {
        const q = localizedProduct(f, lang, 'question') || f.question;
        const a = localizedProduct(f, lang, 'answer') || f.answer;
        return `<details style="margin-bottom:.75rem;background:var(--bg-card);border:1px solid var(--border-color);border-radius:.5rem;padding:.9rem 1.1rem">
          <summary style="cursor:pointer;font-weight:600">${escapeHtml(q)}</summary>
          <p style="margin-top:.7rem;color:var(--text-light);line-height:1.7">${escapeHtml(a)}</p>
        </details>`;
      }).join('')}
    </section>`).join('');

  const faqLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.slice(0, 20).map(f => ({
      '@type': 'Question',
      name: localizedProduct(f, lang, 'question') || f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: localizedProduct(f, lang, 'answer') || f.answer,
      },
    })),
  });

  const content = `
    <section class="hero" style="padding:3rem 2rem">
      <div class="container">
        <h1>${escapeHtml(t(lang, 'faq'))}</h1>
        <p>Payment, shipping, warranty and customization questions answered.</p>
      </div>
    </section>
    <section class="container" style="max-width:820px;margin:2rem auto 4rem">
      ${sections || `<p style="color:var(--text-light)">No FAQ entries yet.</p>`}
      <div style="margin-top:2rem;padding:1.25rem;background:var(--bg-light);border-radius:.5rem">
        <p style="margin-bottom:.75rem">Still have a question?</p>
        <a class="btn btn-primary" href="${localizedUrl('/contact', lang, env)}">${escapeHtml(t(lang, 'contactUs'))}</a>
      </div>
    </section>`;

  return new Response(createLayout(
    `${t(lang, 'faq')} - ${siteName}`, content, '',
    `Frequently asked questions about payment, shipping, warranty and customization - ${siteName}`,
    false, { env, request, lang, settings, jsonld: faqLd }
  ), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
}
