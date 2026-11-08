/**
 * About Page（阶段一B 重写）
 *
 * 原版是纯硬编码英文、且调用 createLayout 时没传 env/request，
 * 导致 canonical / hreflang / 语言切换器在 About 页全部失效。
 *
 * 新版：公司介绍来自站点设置，工厂实力 / 资质 / 品牌来自 D1，全部支持翻译。
 */
import { createLayout } from './layout';
import { escapeHtml, jsonLdScript } from '../utils/html';
import { t, localizedUrl, localizedProduct } from '../i18n';

const KIND_LABEL = {
  equipment: { en: 'Production Equipment', es: 'Equipo de producción', ar: 'معدات الإنتاج' },
  capacity: { en: 'Production Capacity', es: 'Capacidad de producción', ar: 'القدرة الإنتاجية' },
  qc: { en: 'Quality Control', es: 'Control de calidad', ar: 'مراقبة الجودة' },
};

const kindLabel = (k, lang) => (KIND_LABEL[k] || KIND_LABEL.equipment)[lang] || k;

export async function aboutPage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = env.SETTINGS || {};
  const siteName = settings.site_name || 'B2B Product Exhibition';

  let factory = [];
  let certs = [];
  let brands = [];
  try {
    const [f, c, b] = await Promise.all([
      env.DB.prepare('SELECT * FROM factory_assets WHERE is_active = 1 ORDER BY sort_order, id').all(),
      env.DB.prepare('SELECT * FROM certifications WHERE is_active = 1 ORDER BY sort_order, id').all(),
      env.DB.prepare('SELECT * FROM brands WHERE is_active = 1 ORDER BY sort_order, id').all(),
    ]);
    factory = f.results || [];
    certs = c.results || [];
    brands = b.results || [];
  } catch (e) { console.error('about content query failed', e); }

  // 工厂实力按 kind 分组
  const groups = new Map();
  for (const item of factory) {
    const k = item.kind || 'equipment';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }

  const intro = settings.company_intro
    || 'We are a manufacturer and exporter of industrial equipment, serving distributors and OEM clients worldwide.';

  const facts = [
    [lang === 'es' ? 'Fundada' : lang === 'ar' ? 'تأسست' : 'Founded', settings.founded_at || '2000'],
    [lang === 'es' ? 'Empleados' : lang === 'ar' ? 'الموظفون' : 'Employees', settings.employees || '500+'],
    [lang === 'es' ? 'Países atendidos' : lang === 'ar' ? 'الدول' : 'Countries Served', settings.countries_served || '50+'],
    [lang === 'es' ? 'Capacidad anual' : lang === 'ar' ? 'الطاقة السنوية' : 'Annual Capacity', settings.annual_capacity || '300,000 units'],
  ];

  const factoryHtml = [...groups.entries()].map(([kind, items]) => `
    <section style="margin-bottom:2.5rem">
      <h3 style="font-size:1.15rem;margin-bottom:1rem;color:var(--primary-color)">${escapeHtml(kindLabel(kind, lang))}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem">
        ${items.map(item => `
          <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:.5rem;padding:1.1rem">
            ${item.metric ? `<div style="font-size:1.35rem;font-weight:700;color:var(--accent-color)">${escapeHtml(item.metric)}</div>` : ''}
            <div style="font-weight:600;margin:.35rem 0">${escapeHtml(localizedProduct(item, lang, 'title') || item.title)}</div>
            <p style="font-size:.85rem;color:var(--text-light);line-height:1.6">${escapeHtml(localizedProduct(item, lang, 'description') || item.description || '')}</p>
          </div>`).join('')}
      </div>
    </section>`).join('');

  const certsHtml = certs.length ? `
    <section style="margin-top:3rem">
      <h2 style="font-size:1.5rem;margin-bottom:1.25rem">${escapeHtml(t(lang, 'ourCertifications'))}</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem">
        ${certs.map(c => `
          <div style="border:1px solid var(--border-color);border-radius:.5rem;padding:1rem;background:var(--bg-card);display:flex;gap:.9rem;align-items:center">
            ${c.image_url ? `<img src="${escapeHtml(c.image_url)}" alt="${escapeHtml(c.name)}" loading="lazy" style="width:56px;height:56px;object-fit:contain">` : ''}
            <div>
              <div style="font-weight:600;font-size:.95rem">${escapeHtml(localizedProduct(c, lang, 'name') || c.name)}</div>
              <div style="font-size:.78rem;color:var(--text-light)">
                ${escapeHtml([c.issuer, c.cert_no].filter(Boolean).join(' · '))}
              </div>
              ${c.file_url ? `<a href="${escapeHtml(c.file_url)}" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--primary-color)">${escapeHtml(t(lang, 'downloads'))}</a>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </section>` : '';

  const brandsHtml = brands.length ? `
    <section style="margin-top:3rem">
      <h2 style="font-size:1.5rem;margin-bottom:1rem">${escapeHtml(t(lang, 'trustedBy'))}</h2>
      <div style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:center;background:var(--bg-card);border:1px solid var(--border-color);border-radius:.5rem;padding:1.5rem">
        ${brands.map(b => b.logo_url
          ? `<a href="${escapeHtml(b.website || '#')}" target="_blank" rel="noopener nofollow" title="${escapeHtml(b.name)}"><img src="${escapeHtml(b.logo_url)}" alt="${escapeHtml(b.name)}" style="height:38px;object-fit:contain;filter:grayscale(1)" loading="lazy"></a>`
          : `<span style="font-weight:600;color:var(--text-light)">${escapeHtml(b.name)}</span>`).join('')}
      </div>
    </section>` : '';

  const orgLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: `About ${siteName}`,
    description: intro,
    publisher: { '@type': 'Organization', name: siteName, url: settings.site_url || undefined },
  });

  const content = `
    <section class="hero" style="padding:3rem 2rem">
      <div class="container">
        <h1>${escapeHtml(t(lang, 'about'))}</h1>
        <p>${escapeHtml(settings.site_description || 'Manufacturer, exporter and OEM partner.')}</p>
      </div>
    </section>

    <section class="container" style="margin:3rem auto">
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:2.5rem;align-items:start" class="about-grid">
        <div>
          <h2 style="font-size:1.5rem;margin-bottom:1rem;color:var(--primary-color)">${escapeHtml(lang === 'es' ? 'Quiénes somos' : lang === 'ar' ? 'من نحن' : 'Who We Are')}</h2>
          <p style="color:var(--text-light);line-height:1.85">${escapeHtml(intro)}</p>
        </div>
        <div style="background:var(--bg-light);padding:1.5rem;border-radius:.5rem">
          <h3 style="color:var(--primary-color);margin-bottom:1rem;font-size:1.05rem">${escapeHtml(lang === 'es' ? 'Datos rápidos' : lang === 'ar' ? 'معلومات سريعة' : 'Quick Facts')}</h3>
          <ul style="list-style:none">
            ${facts.map(([k, v], i) => `<li style="display:flex;justify-content:space-between;padding:.5rem 0;${i < facts.length - 1 ? 'border-bottom:1px solid var(--border-color)' : ''}">
              <span style="color:var(--text-light);font-size:.88rem">${escapeHtml(k)}</span>
              <strong style="font-size:.9rem">${escapeHtml(v)}</strong></li>`).join('')}
          </ul>
        </div>
      </div>
    </section>

    ${factory.length ? `<section class="container" style="margin:2rem auto 3rem">
      <h2 style="font-size:1.5rem;margin-bottom:1.5rem">${escapeHtml(t(lang, 'ourFactory'))}</h2>
      ${factoryHtml}
    </section>` : ''}

    ${certsHtml}
    ${brandsHtml}

    <section class="container" style="margin:3rem auto 4rem">
      <div style="background:var(--band-bg);color:var(--band-fg);padding:2rem;border-radius:.6rem;display:flex;justify-content:space-between;align-items:center;gap:1.5rem;flex-wrap:wrap">
        <div>
          <h2 style="font-size:1.3rem;margin-bottom:.35rem">${escapeHtml(t(lang, 'getQuote'))}</h2>
          <p style="opacity:.9;font-size:.92rem">Send your specification and we will reply within 24 hours.</p>
        </div>
        <a href="${localizedUrl('/contact', lang, env)}" style="background:var(--accent-color);color:#111;padding:.7rem 1.4rem;border-radius:.375rem;text-decoration:none;font-weight:600">${escapeHtml(t(lang, 'contactUs'))}</a>
      </div>
    </section>

    <style>@media(max-width:768px){.about-grid{grid-template-columns:1fr !important}}</style>`;

  return new Response(createLayout(
    `${t(lang, 'about')} - ${siteName}`,
    content,
    '',
    settings.site_description || `About ${siteName} - manufacturer and exporter`,
    false,
    { env, request, lang, settings, jsonld: orgLd }
  ), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
}
