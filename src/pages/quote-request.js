/**
 * 询价清单页（/quote）
 *
 * 为什么不是「下单页」：B2B 外贸的成交价由数量、材质、incoterm、汇率共同决定，
 * 前台露出价格只会制造错误预期与议价噪音。这里只收集「要什么、要多少」，
 * 由销售在后台出正式报价单（POST /api/quotes/request 会建 draft 报价）。
 *
 * 预填：?product=<slug>&qty=10 —— 产品详情页/广告落地页可直接带参数进来，
 * 省掉客户手动抄型号这一步，转化率差别很大。
 */
import { createLayout } from './layout';
import { escapeHtml } from '../utils/html';
import { t, localizedUrl, parseLocalizedPath, localizedProduct } from '../i18n';

const UNITS = ['pcs', 'sets', 'meters', 'kg', 'tons'];

// 常见贸易伙伴国；客户提交的是 ISO-3166 alpha-2，后台报价单/订单也用同一套代码
const COUNTRIES = [
  ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['QA', 'Qatar'],
  ['US', 'United States'], ['CA', 'Canada'], ['MX', 'Mexico'], ['BR', 'Brazil'],
  ['GB', 'United Kingdom'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'],
  ['IT', 'Italy'], ['NL', 'Netherlands'], ['PL', 'Poland'], ['TR', 'Türkiye'],
  ['RU', 'Russia'], ['IN', 'India'], ['SG', 'Singapore'], ['MY', 'Malaysia'],
  ['VN', 'Vietnam'], ['TH', 'Thailand'], ['JP', 'Japan'], ['KR', 'South Korea'],
  ['AU', 'Australia'], ['ZA', 'South Africa'], ['NG', 'Nigeria'],
];

async function loadSettings(env) {
  try { return JSON.parse((await env.STATIC_ASSETS.get('website_settings')) || '{}'); }
  catch { return {}; }
}

/** 单行编辑器；模板区与预填行共用同一段 HTML，避免两套结构走偏 */
function itemRowHtml({ pid = '', name = '', qty = 1, unit = 'pcs', spec = '' } = {}) {
  const unitOpts = UNITS
    .map(u => `<option value="${u}"${u === unit ? ' selected' : ''}>${u}</option>`)
    .join('');
  return `
        <div class="qi-row" data-row data-pid="${escapeHtml(String(pid))}">
          <div class="field">
            <span class="hint">Product / item</span>
            <input type="text" class="form-input" data-f="name" maxlength="200"
                   value="${escapeHtml(name)}" placeholder="Product name or model"
                   aria-label="Product name" autocomplete="off">
          </div>
          <div class="field">
            <span class="hint">Qty</span>
            <input type="number" class="form-input" data-f="qty" min="1" step="1" inputmode="numeric"
                   value="${escapeHtml(String(qty))}" aria-label="Quantity">
          </div>
          <div class="field">
            <span class="hint">Unit</span>
            <select class="form-input" data-f="unit" aria-label="Unit">${unitOpts}</select>
          </div>
          <div class="field">
            <span class="hint">Spec / notes</span>
            <input type="text" class="form-input" data-f="spec" maxlength="200"
                   value="${escapeHtml(spec)}" placeholder="Material / size"
                   aria-label="Specification or notes" autocomplete="off">
          </div>
          <button type="button" class="btn-ghost btn-sm qi-del" data-del
                  aria-label="Remove item" title="Remove item">&times;</button>
        </div>`;
}

export async function quoteRequestPage(request, env) {
  const url = new URL(request.url);
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = await loadSettings(env);
  const siteName = settings.site_name || 'B2B Product Exhibition';
  // 语言前缀由主控路由剥掉后 pathname 可能仍带 /es，canonical 不能重复拼前缀
  const pagePath = parseLocalizedPath(url.pathname, env).path;

  const slug = (url.searchParams.get('product') || '').trim();
  const qtyRaw = parseInt(url.searchParams.get('qty') || '', 10);
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.min(qtyRaw, 999999) : 1;

  // 只查真实存在的列：bootstrap.sql 的 products 没有 price / unit
  let product = null;
  if (slug) {
    try {
      product = await env.DB.prepare(
        'SELECT id, name, slug, image_url, moq, translations FROM products WHERE slug = ? LIMIT 1'
      ).bind(slug).first();
    } catch (e) { console.error('quote prefill query failed', e); }
  }

  const prefillName = product ? (localizedProduct(product, lang, 'name') || product.name || '') : '';
  const prefillSpec = product && product.moq ? `MOQ: ${product.moq}` : '';
  const firstRow = product
    ? itemRowHtml({ pid: product.id, name: prefillName, qty, unit: 'pcs', spec: prefillSpec })
    : itemRowHtml();

  const prefillNote = product ? `
        <div class="row" style="gap:.6rem;margin-bottom:.9rem;padding:.6rem .7rem;border:1px solid var(--line-soft);border-radius:10px;background:#fbfcfe">
          ${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="" width="40" height="40" style="width:40px;height:40px;object-fit:cover;border-radius:6px">` : ''}
          <span class="hint">Prefilled from <strong>${escapeHtml(prefillName)}</strong>${product.moq ? ` · MOQ ${escapeHtml(product.moq)}` : ''}. Adjust the quantity or replace the item if needed.</span>
        </div>` : '';

  const countryOpts = COUNTRIES
    .map(([code, label]) => `<option value="${code}">${escapeHtml(label)}</option>`)
    .join('');

  const content = `
    <style>
      /* 行编辑器：桌面一行四列 + 删除按钮；窄屏折成两列，品名/规格独占一行 */
      .qi-row {
        display: grid;
        grid-template-columns: minmax(0, 3fr) 5.5rem 6.5rem minmax(0, 1.4fr) auto;
        gap: .6rem;
        align-items: end;
        padding: .6rem;
        border: 1px solid var(--line-soft);
        border-radius: 10px;
        background: var(--bg-card);
      }
      .qi-row .qi-del { margin-bottom: 1px; color: var(--ink-2); font-size: 1.05rem; line-height: 1; }
      @media (max-width: 767px) {
        .qi-row { grid-template-columns: 1fr 1fr; }
        .qi-row > .field:nth-child(1),
        .qi-row > .field:nth-child(4) { grid-column: 1 / -1; }
        .qi-row > .qi-del { grid-column: 1 / -1; justify-self: end; }
      }
    </style>

    <section class="container" style="padding-top:1.5rem;padding-bottom:3rem">
      <nav aria-label="Breadcrumb" class="hint" style="margin-bottom:1rem">
        <a href="${escapeHtml(localizedUrl('/', lang, env))}">${escapeHtml(t(lang, 'home'))}</a>
        <span aria-hidden="true">/</span>
        <span style="color:var(--text-dark)">Request a quotation</span>
      </nav>

      <header style="margin-bottom:1.5rem">
        <h1 style="font-size:1.9rem;line-height:1.25;margin-bottom:.35rem">Request a quotation</h1>
        <p style="color:var(--text-light);max-width:62ch">
          List the items you need and our export team will come back with pricing, lead time and
          shipping options — usually within one business day.
        </p>
      </header>

      <form id="quote-form" class="split" novalidate>
        <div id="qf-error" class="alert alert-error split-full" role="alert" hidden></div>

        <div class="card">
          <div class="card-head">
            <h2>Your item list</h2>
            <span id="item-count" class="badge badge-gray">1 item</span>
          </div>
          <div class="card-pad">
            ${prefillNote}
            <div id="item-list" class="stack" style="gap:.85rem">
              ${firstRow}
            </div>
            <div class="row" style="margin-top:1rem">
              <button type="button" id="add-item" class="btn btn-ghost">+ Add item</button>
            </div>
            <p class="hint" style="margin-top:.9rem">
              Final pricing will be confirmed by our sales team.
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Your details</h2></div>
          <div class="card-pad stack">
            <div class="field">
              <label for="qf-email">Email <span style="color:#b91c1c">*</span></label>
              <input type="email" id="qf-email" name="email" maxlength="254" required
                     autocomplete="email" placeholder="you@company.com">
            </div>
            <div class="field">
              <label for="qf-name">Name</label>
              <input type="text" id="qf-name" name="name" maxlength="120" autocomplete="name">
            </div>
            <div class="field">
              <label for="qf-company">Company</label>
              <input type="text" id="qf-company" name="company" maxlength="120" autocomplete="organization">
            </div>
            <div class="field">
              <label for="qf-country">Country</label>
              <select id="qf-country" name="country">
                <option value="">Select country…</option>
                ${countryOpts}
              </select>
            </div>
            <div class="field">
              <label for="qf-message">Message</label>
              <textarea id="qf-message" name="message" maxlength="2000" rows="4"
                        placeholder="Target price, delivery port, certification requirements…"></textarea>
            </div>

            <!-- 蜜罐：真人看不见，机器人会填 -->
            <input type="text" id="qf-hp" name="company_url" tabindex="-1" autocomplete="off"
                   style="position:absolute;left:-9999px" aria-hidden="true">

            <button type="submit" id="qf-submit" class="btn btn-primary" style="width:100%">
              Send request for quotation
            </button>
            <p class="hint">We use your details only to prepare this quotation.</p>
          </div>
        </div>
      </form>

      <div id="qf-success" class="card" hidden style="max-width:640px;margin:0 auto">
        <div class="card-pad" style="text-align:center">
          <span class="badge badge-green">Request received</span>
          <h2 style="font-size:1.35rem;margin:.85rem 0 .5rem">Thank you — your enquiry is in.</h2>
          <p class="hint" style="margin-bottom:.2rem">Reference number</p>
          <p id="qf-quote-no" style="font-size:1.35rem;font-weight:700;letter-spacing:.05em">—</p>
          <p style="color:var(--text-light);margin-top:.75rem">
            Our sales team will reply within 1 business day.
          </p>
          <p style="margin-top:1.25rem">
            <a class="btn btn-primary" href="${escapeHtml(localizedUrl('/products', lang, env))}">Continue browsing products</a>
          </p>
        </div>
      </div>
    </section>

    <!-- 新增行的克隆源：JS 只做 cloneNode，不拼字符串，省掉一整套转义 -->
    <template id="row-tpl">${itemRowHtml()}
    </template>
  `;

  // 注意：整页是模板字符串，脚本里禁止出现 '\\n' 与 `${}`（会被 Worker 提前插值）
  const scripts = `
    <script>
      (function () {
        var form = document.getElementById('quote-form');
        var list = document.getElementById('item-list');
        var tpl = document.getElementById('row-tpl');
        var countEl = document.getElementById('item-count');
        var errEl = document.getElementById('qf-error');
        var submitBtn = document.getElementById('qf-submit');
        var successBox = document.getElementById('qf-success');
        var quoteNoEl = document.getElementById('qf-quote-no');

        function rowEls() {
          return Array.prototype.slice.call(list.querySelectorAll('[data-row]'));
        }

        function updateCount() {
          var n = rowEls().length;
          countEl.textContent = n + (n === 1 ? ' item' : ' items');
        }

        function clearRow(row) {
          Array.prototype.forEach.call(row.querySelectorAll('[data-f]'), function (el) {
            if (el.tagName === 'SELECT') el.selectedIndex = 0;
            else el.value = el.getAttribute('data-f') === 'qty' ? '1' : '';
          });
          row.setAttribute('data-pid', '');
        }

        function bindRow(row) {
          var del = row.querySelector('[data-del]');
          if (!del) return;
          del.addEventListener('click', function () {
            // 至少保留一行：只剩一行时清空，而不是删到 0 行让表单无处可填
            if (rowEls().length <= 1) clearRow(row);
            else row.remove();
            updateCount();
            hideError();
          });
        }

        rowEls().forEach(bindRow);

        document.getElementById('add-item').addEventListener('click', function () {
          var row = tpl.content.firstElementChild.cloneNode(true);
          list.appendChild(row);
          bindRow(row);
          updateCount();
          var input = row.querySelector('[data-f="name"]');
          if (input) input.focus();
        });

        function showError(msg) {
          errEl.textContent = msg;
          errEl.hidden = false;
          if (errEl.scrollIntoView) errEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }

        function hideError() {
          errEl.hidden = true;
          errEl.textContent = '';
        }

        function collectItems() {
          var items = [];
          rowEls().forEach(function (row) {
            var nameEl = row.querySelector('[data-f="name"]');
            var qtyEl = row.querySelector('[data-f="qty"]');
            var unitEl = row.querySelector('[data-f="unit"]');
            var specEl = row.querySelector('[data-f="spec"]');
            var name = nameEl && nameEl.value ? nameEl.value.trim() : '';
            if (!name) return; // 整行空白的直接丢弃，不当作错误
            var pid = row.getAttribute('data-pid');
            items.push({
              product_id: pid ? Number(pid) : null,
              name: name,
              qty: parseFloat(qtyEl && qtyEl.value),
              unit: (unitEl && unitEl.value) || 'pcs',
              spec: specEl && specEl.value ? specEl.value.trim() : ''
            });
          });
          return items;
        }

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          hideError();

          var emailEl = document.getElementById('qf-email');
          var email = (emailEl.value || '').trim();
          if (!email || email.indexOf('@') < 1) {
            showError('Please enter a valid email address — we need it to send the quotation.');
            emailEl.focus();
            return;
          }

          var items = collectItems();
          if (!items.length) {
            showError('Add at least one product — the item name is required.');
            return;
          }
          for (var i = 0; i < items.length; i++) {
            if (!(items[i].qty > 0)) {
              showError('Quantity for "' + items[i].name + '" must be greater than 0.');
              return;
            }
          }

          var payload = {
            email: email,
            name: (document.getElementById('qf-name').value || '').trim(),
            company: (document.getElementById('qf-company').value || '').trim(),
            country: document.getElementById('qf-country').value || '',
            message: (document.getElementById('qf-message').value || '').trim(),
            company_url: document.getElementById('qf-hp').value || '',
            items: items
          };

          submitBtn.disabled = true;
          var oldText = submitBtn.textContent;
          submitBtn.textContent = 'Sending…';

          window.API.post('/quotes/request', payload).then(function (res) {
            var no = res && res.data && res.data.quote_no ? String(res.data.quote_no) : '';
            quoteNoEl.textContent = no || 'Received';
            form.hidden = true;
            successBox.hidden = false;
            // GA4：layout 里的 trackLead 用 Object.assign 合并参数，传对象才不会塞进 0/1/2 索引键
            if (window.trackLead) window.trackLead({ source: 'quote_request' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }).catch(function (err) {
            showError((err && err.message) ? err.message
              : 'We could not send your request. Please try again or email us directly.');
            submitBtn.disabled = false;
            submitBtn.textContent = oldText;
          });
        });

        updateCount();
      })();
    </script>
  `;

  const html = createLayout(
    'Request a quotation',
    content,
    scripts,
    `Send us your item list and get a formal quotation with pricing, lead time and shipping options from ${siteName}.`,
    true,
    { env, request, lang, settings, path: pagePath }
  );

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      // 工具页，进 CDN 也安全；但不能长缓存，避免客户拿旧版本表单
      'Cache-Control': 'public, max-age=0, s-maxage=300',
    },
  });
}
