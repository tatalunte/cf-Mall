/**
 * 产品列表页（改造版：服务端直出 + 数据内联，保留分类/搜索交互）
 * 原版列表全靠客户端 fetch + innerHTML，SEO 为零且存在 XSS。
 */
import { createLayout } from './layout';
import { productCardHtml } from './product-card';
import { escapeHtml } from '../utils/html';
import { t, localizedUrl, localizedProduct } from '../i18n';

async function loadSettings(env) {
  try {
    const raw = await env.STATIC_ASSETS.get('website_settings');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function productsPage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = await loadSettings(env);
  const siteName = settings.site_name || 'B2B Product Exhibition';

  let products = [];
  try {
    const r = await env.DB.prepare(
      'SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC'
    ).all();
    products = r.results || [];
  } catch (e) { console.error('products query failed', e); }

  // 供客户端筛选使用的轻量数据（随 HTML 一起下发，避免二次请求）
  const light = products.map(p => ({
    id: p.id,
    name: localizedProduct(p, lang, 'name') || p.name,
    description: localizedProduct(p, lang, 'description') || p.description,
    category: p.category || '',
  }));
  const inlineData = JSON.stringify(light).replace(/</g, '\\u003c');
  const cardsHtml = products.length
    ? products.map(p => productCardHtml(p, lang, env)).join('')
    : '<p style="grid-column:1/-1;text-align:center;color:var(--text-light)">No products yet.</p>';

  const content = `
    <section class="hero" style="padding:3rem 2rem">
      <div class="container">
        <h1>${escapeHtml(t(lang, 'products'))}</h1>
        <p>${escapeHtml(settings.site_description || 'Explore our comprehensive range of high-quality products')}</p>
      </div>
    </section>

    <section class="container" style="margin-top:2rem;margin-bottom:3rem">
      <div style="background:var(--bg-card);padding:1.5rem;border-radius:.5rem;box-shadow:0 2px 4px rgba(0,0,0,.1);margin-bottom:2rem">
        <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center">
          <label style="font-weight:500">Category:</label>
          <select id="category-filter" class="form-input" style="max-width:200px">
            <option value="">${escapeHtml(t(lang, 'allCategories'))}</option>
          </select>
          <input type="text" id="search-input" placeholder="${escapeHtml(t(lang, 'searchPlaceholder'))}"
                 class="form-input" style="flex:1;min-width:200px">
          <button id="search-btn" class="btn btn-primary">${escapeHtml(t(lang, 'search'))}</button>
        </div>
      </div>

      <!-- 服务端直出，爬虫可见 -->
      <div id="products-container" class="grid grid-3">${cardsHtml}</div>
      <div id="no-results" style="display:none;text-align:center;padding:3rem">
        <p style="color:var(--text-light);font-size:1.2rem">${escapeHtml(t(lang, 'noResults'))}</p>
      </div>

      <script type="application/json" id="products-data">${inlineData}</script>
    </section>
  `;

  const scripts = `
    <script>
      (function () {
        var cards = Array.prototype.slice.call(document.querySelectorAll('#products-container .card'));
        var data = [];
        try { data = JSON.parse(document.getElementById('products-data').textContent); } catch (e) {}
        var select = document.getElementById('category-filter');
        var used = {};
        data.forEach(function (p) {
          if (p.category && !used[p.category]) {
            used[p.category] = true;
            var opt = document.createElement('option');
            opt.value = p.category; opt.textContent = p.category;
            select.appendChild(opt);
          }
        });
        function filter() {
          var cat = select.value;
          var q = document.getElementById('search-input').value.toLowerCase();
          var shown = 0;
          data.forEach(function (p, i) {
            var ok = (!cat || p.category === cat) &&
                     (!q || (p.name || '').toLowerCase().indexOf(q) >= 0 ||
                             (p.description || '').toLowerCase().indexOf(q) >= 0);
            if (cards[i]) cards[i].style.display = ok ? '' : 'none';
            if (ok) shown++;
          });
          document.getElementById('no-results').style.display = shown ? 'none' : 'block';
        }
        select.addEventListener('change', filter);
        document.getElementById('search-input').addEventListener('input', filter);
        document.getElementById('search-btn').addEventListener('click', filter);
        document.getElementById('search-input').addEventListener('keypress', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); filter(); }
        });
      })();
    </script>
    <style>
      @media (max-width: 768px) { #products-container { grid-template-columns: 1fr !important; } }
      .card-description { display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden }
    </style>
  `;

  return new Response(createLayout(
    `${t(lang, 'products')} - ${siteName}`,
    content,
    scripts,
    `Browse our comprehensive range of high-quality products - ${siteName}`,
    false,
    { env, request, lang, settings }
  ), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=0, s-maxage=300' } });
}
