/**
 * 客户自助门户页面 `/account`（阶段三）
 *
 * 为什么服务端直出而不是前端拉接口：
 *  - 客户会话在 HttpOnly cookie 里，页面本身能直接拿到身份；不需要把 token 透传给 JS；
 *  - 首屏就有内容，没有 FOUC，也不会出现「先渲染未登录、再闪成已登录」。
 * 内联脚本只负责两件事：提交登录表单、登出。
 *
 * 注意：本文件整页是模板字符串，内联脚本里绝对不写反斜杠 + n 的转义序列（会被插值成真实换行，
 * 导致单引号字符串跨行 → 整段脚本语法错误）。样式也一律内联或写在页面自带 <style> 里，
 * 不依赖 layout.js 里正在被并行修改的 .badge / .table 等类。
 */
import { createLayout } from './layout';
import { escapeHtml } from '../utils/html';
import { t, localizedUrl, formatDate, formatCurrency } from '../i18n';
import { requireCustomer } from '../utils/auth';
import { SAME_EMAIL_MESSAGE } from '../api/handlers/accounts';

/* 徽标配色：类名给未来 CSS 用，内联 style 保证「这一版就能看」 */
const BADGE_COLORS = {
  green: 'background:#dcfce7;color:#166534',
  blue: 'background:#dbeafe;color:#1e40af',
  amber: 'background:#fef3c7;color:#92400e',
  red: 'background:#fee2e2;color:#991b1b',
  gray: 'background:#f3f4f6;color:#374151',
};

const QUOTE_STATUS = {
  draft: 'gray', sent: 'blue', accepted: 'green',
  changes_requested: 'amber', rejected: 'red', expired: 'gray',
};

const ORDER_STATUS = {
  placed: 'blue', confirmed: 'blue', in_production: 'amber', ready: 'amber',
  shipped: 'blue', delivered: 'green', completed: 'green', cancelled: 'red',
};

const PAYMENT_STATUS = {
  unpaid: 'amber', deposit_paid: 'blue', paid: 'green', refunded: 'gray',
};

/**
 * 多语言取词。t() 在缺词条时会把 key 原样返回，所以不能写 `t(lang,'x') || 'English'`
 * （永远是真值），必须显式判断「返回值和 key 一样就当缺词条，回落英文」。
 */
function label(lang, key, fallback) {
  const value = t(lang, key);
  return value && value !== key ? value : fallback;
}

/** in_production -> In production；不认识的枚举也要能读 */
function humanize(value) {
  const s = String(value == null ? '' : value).replace(/_/g, ' ').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function badge(value, color) {
  const c = BADGE_COLORS[color] || BADGE_COLORS.gray;
  const key = BADGE_COLORS[color] ? color : 'gray';
  return `<span class="badge badge-${key}" style="display:inline-block;padding:.18rem .55rem;border-radius:999px;` +
    `font-size:.76rem;font-weight:600;white-space:nowrap;${c}">${escapeHtml(humanize(value))}</span>`;
}

function money(total, currency, lang) {
  // 金额为 null 时 formatCurrency 会返回空串，这里显式兜底成 '-'
  const out = formatCurrency(total == null ? 0 : total, lang, currency || 'USD');
  return escapeHtml(out || '-');
}

function dateCell(value, lang) {
  const out = formatDate(value, lang);
  return out ? `<time datetime="${escapeHtml(String(value).slice(0, 10))}">${escapeHtml(out)}</time>` : '-';
}

/* ------------------------------ 页面样式 ------------------------------ */

const PAGE_CSS = `
<style>
  .acc-wrap{max-width:980px;margin:2.25rem auto 4rem;padding:0 1rem}
  .acc-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 10px 30px rgba(15,23,42,.05)}
  .acc-login{max-width:470px;margin:3.5rem auto 4rem;padding:2.25rem 2rem;text-align:center}
  .acc-login h1{font-size:1.4rem;margin:0 0 .6rem}
  .acc-login p.acc-sub{color:#4b5563;font-size:.94rem;line-height:1.6;margin:0 0 1.5rem}
  .acc-field{display:block;text-align:left;margin-bottom:.9rem}
  .acc-field label{display:block;font-size:.82rem;font-weight:600;color:#374151;margin-bottom:.35rem}
  .acc-input{width:100%;box-sizing:border-box;padding:.72rem .85rem;font-size:.95rem;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#111827}
  .acc-input:focus{outline:2px solid #93c5fd;outline-offset:1px;border-color:#60a5fa}
  .acc-btn{display:inline-block;width:100%;box-sizing:border-box;padding:.78rem 1rem;font-size:.95rem;font-weight:600;
           color:#fff;background:#2563eb;border:0;border-radius:8px;cursor:pointer}
  .acc-btn:hover{background:#1d4ed8}
  .acc-btn:disabled{background:#93c5fd;cursor:default}
  .acc-msg{display:none;margin:1rem 0 0;padding:.7rem .85rem;border-radius:8px;background:#eff6ff;color:#1e40af;
           font-size:.88rem;line-height:1.5;text-align:left}
  .acc-hint{margin:1.1rem 0 0;font-size:.8rem;color:#6b7280;line-height:1.6}
  .acc-hint a{color:#2563eb;text-decoration:none}
  .acc-bar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between;
           padding:1rem 1.25rem;margin-bottom:1.25rem;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px}
  .acc-bar span{font-size:.92rem;color:#374151}
  .acc-bar strong{color:#111827;word-break:break-all}
  .acc-out{padding:.5rem .95rem;font-size:.85rem;font-weight:600;color:#374151;background:#fff;
           border:1px solid #d1d5db;border-radius:8px;cursor:pointer}
  .acc-out:hover{background:#f3f4f6}
  .acc-note{padding:.8rem 1rem;margin-bottom:1.25rem;border-radius:10px;background:#ecfdf5;color:#065f46;
            border:1px solid #a7f3d0;font-size:.9rem}
  .acc-sec{padding:1.25rem;margin-bottom:1.5rem}
  .acc-sec h2{font-size:1.08rem;margin:0 0 1rem;padding-bottom:.6rem;border-bottom:1px solid #e5e7eb}
  .acc-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .acc-table{width:100%;border-collapse:collapse;font-size:.9rem;min-width:640px}
  .acc-table thead th{text-align:left;font-size:.76rem;letter-spacing:.03em;text-transform:uppercase;
                      color:#6b7280;background:#f9fafb;padding:.6rem .75rem;white-space:nowrap;font-weight:600}
  .acc-table tbody td{padding:.7rem .75rem;border-top:1px solid #f1f5f9;color:#374151;vertical-align:middle}
  .acc-table tbody tr:nth-child(even){background:#fcfcfd}
  .acc-table a{color:#2563eb;text-decoration:none}
  .acc-table a:hover{text-decoration:underline}
  .acc-no{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem;color:#111827;white-space:nowrap}
  .acc-empty{padding:1.4rem 1rem;text-align:center;color:#6b7280;font-size:.9rem;line-height:1.65;background:#f9fafb;border-radius:10px}
  @media (max-width:640px){
    .acc-login{padding:1.6rem 1.15rem;margin-top:2rem}
    .acc-bar{align-items:flex-start}
  }
</style>`;

/* ------------------------------ 未登录 ------------------------------ */

function loginView(lang, env) {
  return `${PAGE_CSS}
  <div class="acc-wrap">
    <div class="acc-card acc-login">
      <h1>${escapeHtml(label(lang, 'customerPortal', 'Customer portal'))}</h1>
      <p class="acc-sub">${escapeHtml('No password needed — we\u2019ll email you a one-time sign-in link.')}</p>
      <form id="acc-form" novalidate>
        <div class="acc-field">
          <label for="acc-email">${escapeHtml(label(lang, 'email', 'Email'))}</label>
          <input id="acc-email" name="email" type="email" class="acc-input" autocomplete="email"
                 inputmode="email" required placeholder="you@company.com">
        </div>
        <input id="acc-hp" name="company_url" type="text" tabindex="-1" autocomplete="off"
               aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
        <button id="acc-submit" type="submit" class="acc-btn">Send sign-in link</button>
      </form>
      <p id="acc-msg" class="acc-msg" role="status" aria-live="polite"></p>
      <p class="acc-hint">
        Sign-in is available for the email address that received a quotation or an order from us.
        First time here? <a href="${escapeHtml(localizedUrl('/quote', lang, env))}">Request a quote</a>.
      </p>
    </div>
  </div>`;
}

/* ------------------------------ 已登录 ------------------------------ */

function quoteRows(quotes, lang, env) {
  if (!quotes.length) {
    return `<div class="acc-empty">No quotations yet — request a quote and we'll get back within 1 business day.</div>`;
  }
  const rows = quotes.map(q => {
    // token 只对 status='sent' 的报价返回；没有 token 就说明这条报价当前不可在线查看
    const href = q.status === 'sent' && q.token
      ? localizedUrl(`/quote/${q.token}`, lang, env)
      : '';
    const action = href
      ? `<a href="${escapeHtml(href)}">View quote</a>`
      : `<span style="color:#9ca3af">-</span>`;
    return `<tr>
      <td class="acc-no">${escapeHtml(q.quote_no || ('#' + q.id))}</td>
      <td>${dateCell(q.created_at, lang)}</td>
      <td style="white-space:nowrap">${money(q.total, q.currency, lang)}</td>
      <td>${badge(q.status, QUOTE_STATUS[q.status] || 'gray')}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
  return `<div class="acc-scroll"><table class="acc-table">
    <thead><tr>
      <th>Quote no.</th><th>Date</th><th>Amount</th><th>Status</th>
      <th>${escapeHtml(label(lang, 'details', 'Details'))}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function orderRows(orders, lang) {
  if (!orders.length) {
    return `<div class="acc-empty">No orders yet. Once a quotation is confirmed you'll see the order, payment and shipping progress here.</div>`;
  }
  const rows = orders.map(o => {
    let tracking = '<span style="color:#9ca3af">-</span>';
    if (o.tracking_url) {
      tracking = `<a href="${escapeHtml(o.tracking_url)}" target="_blank" rel="noopener">` +
        `${escapeHtml(o.tracking_no || 'Track shipment')}</a>`;
    } else if (o.tracking_no) {
      tracking = `<span class="acc-no">${escapeHtml(o.tracking_no)}</span>`;
    }
    return `<tr>
      <td class="acc-no">${escapeHtml(o.order_no || ('#' + o.id))}</td>
      <td>${dateCell(o.created_at, lang)}</td>
      <td style="white-space:nowrap">${money(o.total, o.currency, lang)}</td>
      <td>${badge(o.status, ORDER_STATUS[o.status] || 'gray')}</td>
      <td>${badge(o.payment_status, PAYMENT_STATUS[o.payment_status] || 'gray')}</td>
      <td>${tracking}</td>
    </tr>`;
  }).join('');
  return `<div class="acc-scroll"><table class="acc-table">
    <thead><tr>
      <th>Order no.</th><th>Date</th><th>Amount</th><th>Status</th><th>Payment</th><th>Tracking no.</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function accountView(account, quotes, orders, lang, env, showWelcome) {
  const email = escapeHtml(account.email || '');
  return `${PAGE_CSS}
  <div class="acc-wrap">
    <div class="acc-bar">
      <span>Signed in as <strong>${email}</strong></span>
      <button id="acc-signout" type="button" class="acc-out">Sign out</button>
    </div>
    ${showWelcome ? `<div class="acc-note">Welcome back — your quotations and orders are below.</div>` : ''}
    <section class="acc-card acc-sec">
      <h2>${escapeHtml(label(lang, 'yourQuotations', 'Your quotations'))}</h2>
      ${quoteRows(quotes, lang, env)}
    </section>
    <section class="acc-card acc-sec">
      <h2>${escapeHtml(label(lang, 'yourOrders', 'Your orders'))}</h2>
      ${orderRows(orders, lang)}
    </section>
  </div>`;
}

/* ------------------------------ 内联脚本 ------------------------------ */

function pageScripts(lang, env, loggedIn) {
  const langLiteral = JSON.stringify(String(lang));
  const fallback = JSON.stringify(SAME_EMAIL_MESSAGE);
  const accountPath = JSON.stringify(localizedUrl('/account', lang, env));

  // 注意：这里不能出现「反斜杠 + n」的转义序列（见文件头说明），所有客户端字符串都用单行写法
  const loginScript = loggedIn ? '' : `
    <script>
      (function () {
        var form = document.getElementById('acc-form');
        if (!form) return;
        var msg = document.getElementById('acc-msg');
        var btn = document.getElementById('acc-submit');
        var hp = document.getElementById('acc-hp');

        function showSent(text) {
          btn.disabled = true;
          btn.textContent = 'Link sent — check your inbox';
          if (msg) {
            msg.textContent = text;
            msg.style.display = 'block';
          }
        }

        form.addEventListener('submit', function (e) {
          e.preventDefault();
          // 蜜罐：真人看不到这个字段；被填写就是机器人，直接原地「假装成功」，不发请求
          if (hp && hp.value) { showSent(${fallback}); return; }

          var emailEl = document.getElementById('acc-email');
          var email = (emailEl && emailEl.value ? emailEl.value : '').trim();
          if (!email || email.indexOf('@') < 1 || email.indexOf('.') < 0) {
            if (msg) { msg.textContent = 'Please enter a valid email address.'; msg.style.display = 'block'; }
            return;
          }

          btn.disabled = true;
          btn.textContent = 'Sending...';

          fetch('/api/account/request-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, lang: ${langLiteral} })
          }).then(function (res) {
            return res.json().catch(function () { return {}; });
          }).then(function (data) {
            // 后端对所有情况都回同一句话，这里直接展示它，避免前后端文案漂移
            showSent((data && data.message) ? data.message : ${fallback});
          }).catch(function () {
            btn.disabled = false;
            btn.textContent = 'Send sign-in link';
            if (msg) { msg.textContent = 'Network error. Please check your connection and try again.'; msg.style.display = 'block'; }
          });
        });
      })();
    </script>`;

  const logoutScript = loggedIn ? `
    <script>
      (function () {
        var out = document.getElementById('acc-signout');
        if (!out) return;
        out.addEventListener('click', function () {
          out.disabled = true;
          out.textContent = 'Signing out...';
          // logout 返回 302 + 清 cookie；fetch 会跟随重定向，cookie 已在响应头里被清掉
          fetch('/api/account/logout', { method: 'POST' }).then(function () {
            window.location.href = ${accountPath};
          }).catch(function () {
            window.location.href = ${accountPath};
          });
        });
      })();
    </script>` : '';

  return loginScript + logoutScript;
}

/* ------------------------------ 入口 ------------------------------ */

export async function accountPage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const settings = env.SETTINGS || {};
  const siteName = settings.site_name || 'B2B Product Exhibition';
  const url = new URL(request.url);

  let account = null;
  try {
    account = await requireCustomer(request, env);
  } catch (e) {
    console.error('account session check failed', e.message);
  }

  let content;
  if (account) {
    // 服务端直出要用的数据：直接查库，不走自己家的 API（省一次往返，也不用把 cookie 透传给内部 fetch）
    let quotes = [];
    let orders = [];
    try {
      const q = await env.DB.prepare(
        `SELECT id, quote_no, status, currency, total, created_at, token
         FROM quotes WHERE LOWER(customer_email) = ? ORDER BY created_at DESC`
      ).bind(String(account.email || '').toLowerCase()).all();
      quotes = q.results || [];
    } catch (e) { console.error('account quotes query failed', e.message); }
    try {
      const o = await env.DB.prepare(
        `SELECT id, order_no, status, payment_status, currency, total,
                tracking_no, tracking_url, created_at
         FROM orders WHERE LOWER(customer_email) = ? ORDER BY created_at DESC`
      ).bind(String(account.email || '').toLowerCase()).all();
      orders = o.results || [];
    } catch (e) { console.error('account orders query failed', e.message); }

    content = accountView(account, quotes, orders, lang, env, url.searchParams.get('welcome') === '1');
  } else {
    content = loginView(lang, env);
  }

  const html = createLayout(
    label(lang, 'customerPortal', 'Customer portal'),
    content,
    pageScripts(lang, env, !!account),
    'Sign in to your customer portal to view your quotations, orders and shipment tracking.',
    true,
    // path 固定 '/account'：真实 URL 可能带 ?welcome=1 或 /es 前缀，canonical 必须稳定
    { env, request, lang, settings, path: '/account' }
  );

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      // 会话相关页面：既不能进 CDN 缓存，也不能进浏览器缓存，否则登出后还能看到上一个人的数据
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Vary': 'Cookie',
    },
  });
}
