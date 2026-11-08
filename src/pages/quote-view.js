/**
 * 客户查看报价单（/quote/:token）
 *
 * 服务端直接查库渲染，不 fetch 自己的 /api/quotes/view —— 多一跳往返、还多一处
 * 字段裁剪要同步维护。字段裁剪逻辑与契约 §3 的 view 接口保持一致：
 * created_by / customer_id / inquiry_id / id 一律不出现在客户侧 HTML 里。
 *
 * 版式按「打印单据」而不是营销页设计：客户会打印、转发、归档，甚至拿去和别家比价。
 */
import { createLayout } from './layout';
import { escapeHtml } from '../utils/html';
import { t, localizedUrl, parseLocalizedPath, formatDate } from '../i18n';

const STATUS_META = {
  draft: { label: 'Draft', cls: 'badge-gray' },
  sent: { label: 'Awaiting your response', cls: 'badge-blue' },
  accepted: { label: 'Accepted', cls: 'badge-green' },
  changes_requested: { label: 'Changes requested', cls: 'badge-amber' },
  rejected: { label: 'Declined', cls: 'badge-red' },
  expired: { label: 'Expired', cls: 'badge-gray' },
};

async function loadSettings(env) {
  try { return JSON.parse((await env.STATIC_ASSETS.get('website_settings')) || '{}'); }
  catch { return {}; }
}

/** B2B 单据必须带币种代码，"$1,250.00" 在跨币种报价里等于没写 */
function money(amount, currency) {
  const n = Number(amount);
  const v = Number.isFinite(n) ? n : 0;
  const cur = currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: cur, currencyDisplay: 'code',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(v);
  } catch (e) {
    return cur + ' ' + v.toFixed(2);
  }
}

function qtyText(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return '0';
  // 10.0 -> "10"，10.5 -> "10.5"：单据上不该出现多余的 .0
  return String(n);
}

const PAGE_HEADERS = {
  'Content-Type': 'text/html;charset=UTF-8',
  // 客户专属单据，绝不能进 CDN / 代理缓存
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function invalidResponse(env, request, lang, settings) {
  const content = `
    <section class="container" style="padding:4rem 0;text-align:center">
      <div class="empty" style="max-width:520px;margin:0 auto">
        <h1 style="font-size:1.4rem;margin-bottom:.6rem;color:var(--text-dark)">This quotation link is invalid or has expired</h1>
        <p style="margin-bottom:1.25rem">
          The link may have been replaced by a newer revision, or the quotation was withdrawn.
          Please contact us and we will send a fresh copy.
        </p>
        <a class="btn btn-primary" href="${escapeHtml(localizedUrl('/contact', lang, env))}">Contact us</a>
      </div>
    </section>`;

  const html = createLayout(
    'Quotation not found',
    content,
    '',
    'This quotation link is invalid or has expired.',
    true,
    { env, request, lang, settings, path: parseLocalizedPath(new URL(request.url).pathname, env).path }
  );
  return new Response(html, { status: 404, headers: PAGE_HEADERS });
}

export async function quoteViewPage(request, env) {
  const url = new URL(request.url);
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = await loadSettings(env);
  const siteName = settings.site_name || 'B2B Product Exhibition';
  const pagePath = parseLocalizedPath(url.pathname, env).path;

  const rawToken = pagePath.slice('/quote/'.length);
  let token = rawToken;
  try { token = decodeURIComponent(rawToken); } catch (e) { token = rawToken; }

  // token 是 32 字节 base64url，出现斜杠/空白基本就是伪造或截断
  if (!token || token.length > 128 || /[\/\s]/.test(token)) {
    return invalidResponse(env, request, lang, settings);
  }

  let quote = null;
  let items = [];
  try {
    quote = await env.DB.prepare('SELECT * FROM quotes WHERE token = ? LIMIT 1').bind(token).first();
    if (quote) {
      const r = await env.DB.prepare(
        'SELECT name, spec, qty, unit, unit_price, amount FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC, id ASC'
      ).bind(quote.id).all();
      items = r.results || [];
    }
  } catch (e) {
    console.error('quote view query failed', e);
  }

  if (!quote) return invalidResponse(env, request, lang, settings);

  // 白名单式裁剪：只把客户该看的字段带进模板
  const q = {
    quote_no: quote.quote_no || '',
    status: STATUS_META[quote.status] ? quote.status : 'draft',
    currency: quote.currency || 'USD',
    incoterm: quote.incoterm || '',
    payment_terms: quote.payment_terms || '',
    valid_until: quote.valid_until || '',
    created_at: quote.created_at || '',
    responded_at: quote.responded_at || quote.accepted_at || '',
    subtotal: quote.subtotal,
    discount_type: quote.discount_type || '',
    discount_value: quote.discount_value,
    discount_amount: quote.discount_amount,
    tax_rate: quote.tax_rate,
    tax_amount: quote.tax_amount,
    shipping_amount: quote.shipping_amount,
    total: quote.total,
    notes: quote.notes || '',
    terms: quote.terms || '',
    customer_email: quote.customer_email || '',
    customer_name: quote.customer_name || '',
    customer_company: quote.customer_company || '',
    customer_country: quote.customer_country || '',
  };

  const meta = STATUS_META[q.status];
  const createdText = formatDate(q.created_at, lang) || '—';
  const validText = q.valid_until ? (formatDate(q.valid_until, lang) || '—') : '—';
  const respondedText = q.responded_at ? formatDate(q.responded_at, lang) : '';

  const itemRows = items.length
    ? items.map(it => `
              <tr>
                <td>${escapeHtml(it.name || '')}</td>
                <td style="color:var(--text-light)">${escapeHtml(it.spec || '—')}</td>
                <td class="num">${escapeHtml(qtyText(it.qty))}</td>
                <td>${escapeHtml(it.unit || 'pcs')}</td>
                <td class="num">${escapeHtml(money(it.unit_price, q.currency))}</td>
                <td class="num">${escapeHtml(money(it.amount, q.currency))}</td>
              </tr>`).join('')
    : `
              <tr><td colspan="6" style="color:var(--text-light)">No line items on this quotation.</td></tr>`;

  // 只有真的有折扣/税/运费时才出这一行，否则客户会追问「为什么是 0」
  const extraRows = [];
  if (Number(q.discount_amount) > 0) {
    const dLabel = q.discount_type === 'percent' && Number(q.discount_value) > 0
      ? `Discount (${q.discount_value}%)` : 'Discount';
    extraRows.push(`<div class="trow"><span>${escapeHtml(dLabel)}</span><span class="num">- ${escapeHtml(money(q.discount_amount, q.currency))}</span></div>`);
  }
  if (Number(q.tax_amount) > 0) {
    const tLabel = Number(q.tax_rate) > 0 ? `Tax (${q.tax_rate}%)` : 'Tax';
    extraRows.push(`<div class="trow"><span>${escapeHtml(tLabel)}</span><span class="num">${escapeHtml(money(q.tax_amount, q.currency))}</span></div>`);
  }
  if (Number(q.shipping_amount) > 0) {
    extraRows.push(`<div class="trow"><span>Shipping</span><span class="num">${escapeHtml(money(q.shipping_amount, q.currency))}</span></div>`);
  }

  // 已响应过就只读展示；只有 sent 才给三个操作按钮
  const statusBar = q.status === 'sent' ? `
        <div class="card-pad" style="border-top:1px solid var(--line-soft);background:#fbfcfe">
          <div class="row" style="justify-content:space-between">
            <div class="row" style="gap:.5rem">
              <span class="badge ${meta.cls}">${escapeHtml(meta.label)}</span>
              <span class="hint">Confirm the quotation, or tell us what to adjust.</span>
            </div>
            <div class="row no-print" id="quote-actions" style="gap:.5rem">
              <button type="button" class="btn btn-primary" data-action="accept">Accept quotation</button>
              <button type="button" class="btn btn-ghost" data-action="changes">Request changes</button>
              <button type="button" class="btn btn-ghost" data-action="reject" style="color:#9b1c1c;border-color:#f3c2c2">Decline</button>
            </div>
          </div>

          <div id="respond-panel" class="no-print" hidden style="margin-top:1rem">
            <div class="field">
              <label for="respond-msg" id="respond-label">Message (optional)</label>
              <textarea id="respond-msg" rows="3" maxlength="2000"
                        placeholder="e.g. please revise the unit price for 500 pcs, or ship CIF Jebel Ali"></textarea>
            </div>
            <div id="respond-error" class="alert alert-error" hidden style="margin-top:.75rem"></div>
            <div class="row" style="justify-content:flex-end;margin-top:.75rem">
              <button type="button" class="btn btn-ghost" id="respond-cancel">Cancel</button>
              <button type="button" class="btn btn-primary" id="respond-send">Confirm</button>
            </div>
          </div>
        </div>` : `
        <div class="card-pad" style="border-top:1px solid var(--line-soft);background:#fbfcfe">
          <div class="row" style="gap:.5rem">
            <span class="badge ${meta.cls}">${escapeHtml(meta.label)}</span>
            <span class="hint">
              ${q.status === 'accepted' ? `Accepted${respondedText ? ` on ${escapeHtml(respondedText)}` : ''} — thank you, our team will follow up with the order confirmation.` : ''}
              ${q.status === 'changes_requested' ? `Changes requested${respondedText ? ` on ${escapeHtml(respondedText)}` : ''} — our sales team is revising the quotation.` : ''}
              ${q.status === 'rejected' ? `Declined${respondedText ? ` on ${escapeHtml(respondedText)}` : ''}. If this was a mistake, please contact us.` : ''}
              ${q.status === 'expired' ? 'This quotation has expired — contact us for an updated offer.' : ''}
              ${q.status === 'draft' ? 'This quotation has not been sent yet. Please contact us if you received this link by mistake.' : ''}
            </span>
          </div>
        </div>`;

  const content = `
    <style>
      /* 单据版式：屏幕上按 A4 视觉宽度收窄，打印时铺满纸张 */
      .doc { max-width: 920px; margin: 0 auto; }
      /* 单据不是营销卡片：鼠标划过不该上浮 */
      .doc.card:hover { transform: none; }
      .doc-head { display: flex; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap; }
      .doc-title { font-size: 1.55rem; font-weight: 700; letter-spacing: .14em; line-height: 1.2; }
      .doc-meta { text-align: right; min-width: 190px; }
      .doc-meta div { font-size: .86rem; color: var(--ink-2); line-height: 1.7; }
      .totals { margin-left: auto; width: 100%; max-width: 340px; margin-top: 1rem; }
      .trow { display: flex; justify-content: space-between; gap: 1rem; padding: .3rem 0; font-size: .92rem; }
      .trow.total { border-top: 2px solid var(--text-dark); margin-top: .5rem; padding-top: .6rem; font-size: 1.15rem; font-weight: 700; }
      @media (max-width: 767px) {
        .doc-meta { text-align: left; }
        .totals { max-width: none; }
      }
      @media print {
        .doc { max-width: none; }
      }
    </style>

    <section class="container" style="padding-top:1.5rem;padding-bottom:3rem">
      <div class="row no-print" style="justify-content:space-between;margin-bottom:1rem">
        <nav aria-label="Breadcrumb" class="hint">
          <a href="${escapeHtml(localizedUrl('/', lang, env))}">${escapeHtml(t(lang, 'home'))}</a>
          <span aria-hidden="true">/</span>
          <span style="color:var(--text-dark)">Quotation ${escapeHtml(q.quote_no)}</span>
        </nav>
        <button type="button" id="print-doc" class="btn btn-ghost btn-sm">Print / Save as PDF</button>
      </div>

      <!-- 报价页不进索引：createLayout 不支持额外 head 标签，改用响应头 X-Robots-Tag -->
      <div class="doc card">
        <div class="card-pad doc-head">
          <div>
            <div style="font-size:1.15rem;font-weight:700;margin-bottom:.35rem">${escapeHtml(siteName)}</div>
            <div class="hint" style="line-height:1.8">
              ${settings.email ? `${escapeHtml(settings.email)}<br>` : ''}
              ${settings.phone ? `${escapeHtml(settings.phone)}<br>` : ''}
              ${settings.address ? `${escapeHtml(settings.address)}<br>` : ''}
              ${settings.whatsapp ? `WhatsApp: ${escapeHtml(settings.whatsapp)}` : ''}
            </div>
          </div>
          <div class="doc-meta">
            <div class="doc-title">QUOTATION</div>
            <div style="margin-top:.4rem">
              <strong>No. ${escapeHtml(q.quote_no)}</strong><br>
              Date: ${escapeHtml(createdText)}<br>
              Valid until: ${escapeHtml(validText)}
            </div>
          </div>
        </div>

        ${statusBar}

        <div class="split card-pad" style="border-top:1px solid var(--line-soft)">
          <div>
            <div class="hint" style="font-weight:700;letter-spacing:.08em;margin-bottom:.4rem">BILL TO</div>
            <div style="font-weight:600">${escapeHtml(q.customer_company || q.customer_name || '—')}</div>
            <div class="hint" style="line-height:1.8">
              ${q.customer_company && q.customer_name ? `${escapeHtml(q.customer_name)}<br>` : ''}
              ${q.customer_email ? `${escapeHtml(q.customer_email)}<br>` : ''}
              ${q.customer_country ? `${escapeHtml(q.customer_country)}` : ''}
            </div>
          </div>
          <div>
            <div class="hint" style="font-weight:700;letter-spacing:.08em;margin-bottom:.4rem">TERMS</div>
            <div class="hint" style="line-height:1.9">
              <div><span style="display:inline-block;min-width:88px">Incoterm</span> ${escapeHtml(q.incoterm || '—')}</div>
              <div><span style="display:inline-block;min-width:88px">Payment</span> ${escapeHtml(q.payment_terms || '—')}</div>
              <div><span style="display:inline-block;min-width:88px">Currency</span> ${escapeHtml(q.currency)}</div>
            </div>
          </div>
        </div>

        <div style="border-top:1px solid var(--line-soft);padding:1rem 1.25rem 0">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Spec</th>
                  <th class="num">Qty</th>
                  <th>Unit</th>
                  <th class="num">Unit price</th>
                  <th class="num">Amount</th>
                </tr>
              </thead>
              <tbody>${itemRows}
              </tbody>
            </table>
          </div>

          <div class="totals">
            <div class="trow"><span>Subtotal</span><span class="num">${escapeHtml(money(q.subtotal, q.currency))}</span></div>
            ${extraRows.join('')}
            <div class="trow total"><span>TOTAL</span><span class="num">${escapeHtml(money(q.total, q.currency))}</span></div>
          </div>
        </div>

        ${q.notes ? `
        <div class="card-pad" style="border-top:1px solid var(--line-soft)">
          <div class="hint" style="font-weight:700;letter-spacing:.08em;margin-bottom:.35rem">NOTES</div>
          <div style="white-space:pre-wrap;font-size:.92rem">${escapeHtml(q.notes)}</div>
        </div>` : ''}

        ${q.terms ? `
        <div class="card-pad" style="border-top:1px solid var(--line-soft)">
          <div class="hint" style="font-weight:700;letter-spacing:.08em;margin-bottom:.35rem">TERMS &amp; CONDITIONS</div>
          <div style="white-space:pre-wrap;font-size:.86rem;color:var(--ink-2)">${escapeHtml(q.terms)}</div>
        </div>` : ''}

        <div class="card-pad" style="border-top:1px solid var(--line-soft);text-align:center">
          <p class="hint">Thank you for your business. Questions about this quotation?
            ${settings.email ? `Email <a href="mailto:${escapeHtml(settings.email)}">${escapeHtml(settings.email)}</a>.` : `Use the <a href="${escapeHtml(localizedUrl('/contact', lang, env))}">contact form</a>.`}
          </p>
        </div>
      </div>
    </section>
  `;

  // 整页是模板字符串：脚本里不出现 '\\n'，也不出现会被 Worker 提前插值的 ${}
  const scripts = `
    <script>
      (function () {
        var TOKEN = ${JSON.stringify(token)};

        var printBtn = document.getElementById('print-doc');
        if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

        var actions = document.getElementById('quote-actions');
        if (!actions) return; // 已响应过：整块是只读状态条

        var panel = document.getElementById('respond-panel');
        var msg = document.getElementById('respond-msg');
        var label = document.getElementById('respond-label');
        var errBox = document.getElementById('respond-error');
        var sendBtn = document.getElementById('respond-send');
        var cancelBtn = document.getElementById('respond-cancel');

        var COPY = {
          accept: { label: 'Anything we should know? (optional)', cta: 'Confirm acceptance' },
          changes: { label: 'What should we revise?', cta: 'Send change request' },
          reject: { label: 'Reason (optional)', cta: 'Confirm decline' }
        };

        var action = '';

        actions.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-action]');
          if (!btn) return;
          action = btn.getAttribute('data-action');
          var copy = COPY[action] || COPY.accept;
          label.textContent = copy.label;
          sendBtn.textContent = copy.cta;
          errBox.hidden = true;
          msg.value = '';
          panel.hidden = false;
          msg.focus();
        });

        cancelBtn.addEventListener('click', function () {
          panel.hidden = true;
          action = '';
        });

        sendBtn.addEventListener('click', function () {
          if (!action) return;
          errBox.hidden = true;
          sendBtn.disabled = true;
          var oldText = sendBtn.textContent;
          sendBtn.textContent = 'Sending…';

          fetch('/api/quotes/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: TOKEN, action: action, message: msg.value })
          }).then(function (res) {
            return res.json().catch(function () { return {}; }).then(function (body) {
              if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status));
              return body;
            });
          }).then(function () {
            // 让服务端渲染出对应状态，前端不再维护第二套状态文案
            location.reload();
          }).catch(function (err) {
            errBox.textContent = (err && err.message) ? err.message
              : 'We could not submit your response. Please try again or email us directly.';
            errBox.hidden = false;
            sendBtn.disabled = false;
            sendBtn.textContent = oldText;
          });
        });
      })();
    </script>
  `;

  const html = createLayout(
    `Quotation ${q.quote_no}`,
    content,
    scripts,
    `Quotation ${q.quote_no} from ${siteName} — review the line items, terms and total, then accept, request changes or decline.`,
    true,
    { env, request, lang, settings, path: pagePath }
  );

  return new Response(html, { headers: PAGE_HEADERS });
}
