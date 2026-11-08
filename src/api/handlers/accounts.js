/**
 * 客户自助门户 API（阶段三）
 *
 * 几个刻意的选择：
 *  - 只认邮箱魔法链接，不存口令：token 一次性、30 分钟有效，库里只留哈希前的随机串。
 *  - 防枚举是硬要求：request-link 无论「邮箱不存在 / 频率超限 / 发信失败」都回同一句话 + HTTP 200。
 *    任何差异化响应（404、429）都会把这个接口变成「某邮箱是不是我们的客户」的探测器。
 *  - 原子消费：先 SELECT 取 email，再用带 `used_at IS NULL` 条件的 UPDATE 抢锁，
 *    只有 meta.changes === 1 才算消费成功 —— 客户双击邮件里的链接不会签出两个会话。
 *  - 会话复用 utils/auth.js 的客户 JWT（kind:'customer'），与后台会话互相拒绝，不另造鉴权。
 */
import {
  requireCustomer,
  signCustomerToken,
  customerCookie,
  clearCustomerCookie,
} from '../../utils/auth';
import { escapeHtml } from '../../utils/html';

/** 防枚举的唯一响应文案：所有分支都返回它 */
export const SAME_EMAIL_MESSAGE = 'If this email has orders with us, a sign-in link is on its way.';

const LOGIN_TOKEN_TTL_MINUTES = 30;   // 契约要求 30 分钟
const RATE_WINDOW_MINUTES = 10;       // 同邮箱 10 分钟内
const RATE_MAX_PER_WINDOW = 3;        // 最多 3 封

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

function b64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------------
 * 纯函数（可被 test-artifacts 直接 import 做离线自测，不依赖 D1 / 网络）
 * ------------------------------------------------------------------ */

/** 32 字节随机 → base64url（去 `=`），43 字符且只含 [A-Za-z0-9_-] */
export function newMagicToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

/**
 * 生成 D1 里的时间字符串 `'YYYY-MM-DD HH:MM:SS'`。
 * toISOString() 是 UTC，D1 的 CURRENT_TIMESTAMP 也是 UTC —— 两边一致，
 * 所以绝不能在这里做本地时区偏移，否则「30 分钟有效」在北京时区会变成 8 小时 30 分。
 */
export function sqlTimeAfter(minutes) {
  const ms = Date.now() + Number(minutes) * 60000;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function isEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  return email.length > 0 && email.length <= 190 && EMAIL_RE.test(email);
}

/* ------------------------------------------------------------------
 * 小的共用件
 * ------------------------------------------------------------------ */

/** 与契约第 3 节一致：SITE_URL 没配（或还是占位符）时回落到请求 origin */
function siteBase(env, request) {
  return (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : new URL(request.url).origin;
}

/**
 * 发信。
 * 注意：src/mailer.js 只导出 handleMailQueue / retryFailedMails（队列链路，是给询盘用的），
 * 并没有导出 sendMail；这里按 subscribe.js 的既有写法在本地封装一次，不去改 mailer.js。
 */
async function sendMail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    // 没配 Key 时不算错误：本地/预览环境本来就不发信，静默跳过以免影响响应
    return { skipped: 'RESEND_API_KEY not configured' };
  }
  const from = env.MAIL_FROM || 'Customer Portal <notify@example.com>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${text.slice(0, 200)}`);
  }
  return { sent: true };
}

/** 登录邮件正文（内联样式；刻意不走 mail-templates，避免和改模板的代理互相踩） */
function loginMailHtml({ link, siteName }) {
  const href = escapeHtml(link);
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:8px;color:#111827">
  <h2 style="font-size:18px;margin:0 0 12px">Sign in to your ${escapeHtml(siteName)} account</h2>
  <p style="font-size:14px;line-height:1.7;color:#4b5563;margin:0 0 20px">
    You (or someone using your email) asked for a one-time sign-in link to the customer portal.
    Click the button below to see your quotations and orders.
  </p>
  <p style="margin:0 0 20px">
    <a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 26px;border-radius:8px">
      Sign in to your portal
    </a>
  </p>
  <p style="font-size:13px;line-height:1.7;color:#6b7280;margin:0 0 8px">
    This link is valid for 30 minutes and can be used only once.
  </p>
  <p style="font-size:13px;line-height:1.7;color:#6b7280;margin:0 0 16px">
    If you did not request it, you can safely ignore this email — nothing will change.
  </p>
  <p style="font-size:12px;line-height:1.6;color:#9ca3af;margin:0;word-break:break-all">
    Button not working? Paste this address into your browser:<br>${href}
  </p>
</div>`;
}

/** verify 失败/服务端异常用的极简 HTML 页（这里必须是 HTML，客户是点邮件链接进来的） */
function htmlPage(title, bodyHtml, status) {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#111827}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:2.25rem;max-width:440px;
        box-shadow:0 10px 30px rgba(15,23,42,.06);text-align:center}
  h1{font-size:1.15rem;margin:0 0 .75rem}
  p{color:#4b5563;line-height:1.65;margin:0 0 .9rem;font-size:.94rem}
  a.btn{display:inline-block;margin-top:.6rem;padding:.7rem 1.2rem;background:#2563eb;color:#fff;
        border-radius:8px;text-decoration:none;font-size:.9rem}
</style></head><body><div class="card">${bodyHtml}</div></body></html>`, {
    status: status || 200,
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

function linkExpiredPage() {
  return htmlPage('Link expired or already used',
    `<h1>Link expired or already used</h1>
     <p>Sign-in links are valid for 30 minutes and can only be used once.</p>
     <p>Request a fresh link and you can get straight back to your quotations and orders.</p>
     <a class="btn" href="/account">Back to /account</a>`, 400);
}

function serverMisconfiguredPage() {
  return htmlPage('Server misconfigured',
    `<h1>Server misconfigured</h1>
     <p>Sign-in is temporarily unavailable. Please contact us and we will help you directly.</p>`, 500);
}

/* ------------------------------------------------------------------
 * 路由分派：挂载前缀 /api/account
 * ------------------------------------------------------------------ */

export async function handleAccounts(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  // 去掉尾斜杠，避免 /api/account/me/ 落到 404
  const path = url.pathname.replace(/\/+$/, '');

  if (method === 'POST' && path === '/api/account/request-link') {
    return requestLink(request, env, corsHeaders);
  }
  if (method === 'GET' && path === '/api/account/verify') return verifyLink(request, env);
  if (method === 'POST' && path === '/api/account/logout') return logout();
  if (method === 'GET' && path === '/api/account/me') return me(request, env, corsHeaders);

  return json({ error: 'Not found' }, 404, corsHeaders);
}

/* ------------------------------------------------------------------
 * POST /api/account/request-link
 * ------------------------------------------------------------------ */

async function requestLink(request, env, corsHeaders) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const email = String(data.email == null ? '' : data.email).trim().toLowerCase();
  // 只有「格式非法」才回 4xx —— 这是唯一可以安全区分的情况，与账号是否存在无关
  if (!isEmail(email)) {
    return json({ error: 'Please enter a valid email address' }, 400, corsHeaders);
  }
  // 蜜罐：真人不填。填了就直接当成功返回，不发信也不落库（避免暴露给爬虫任何信号）
  if (data.company_url || data.website) {
    return json({ success: true, message: SAME_EMAIL_MESSAGE }, 200, corsHeaders);
  }

  if (!env.JWT_SECRET) {
    return json({ error: 'Server misconfigured: JWT_SECRET is not set' }, 500, corsHeaders);
  }

  const ok = () => json({ success: true, message: SAME_EMAIL_MESSAGE }, 200, corsHeaders);

  try {
    // 频率限制：超限也回同一个成功响应（429 会变成「这个邮箱有人在尝试登录」的信号）
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM magic_tokens
       WHERE email = ? AND purpose = 'login' AND created_at > datetime('now', ?)`
    ).bind(email, `-${RATE_WINDOW_MINUTES} minutes`).first();
    if (Number(recent?.n || 0) >= RATE_MAX_PER_WINDOW) return ok();

    // 只有确实有报价/订单的邮箱才值得发信：陌生人提交不会产生任何邮件
    const hit = await env.DB.prepare(
      `SELECT 1 AS found FROM quotes WHERE LOWER(customer_email) = ?
       UNION SELECT 1 FROM orders WHERE LOWER(customer_email) = ? LIMIT 1`
    ).bind(email, email).first();
    if (!hit) return ok();

    const token = newMagicToken();
    await env.DB.prepare(
      `INSERT INTO magic_tokens (email, token, purpose, expires_at, ip)
       VALUES (?, ?, 'login', ?, ?)`
    ).bind(
      email, token, sqlTimeAfter(LOGIN_TOKEN_TTL_MINUTES),
      request.headers.get('CF-Connecting-IP') || null
    ).run();

    const link = `${siteBase(env, request)}/api/account/verify?token=${encodeURIComponent(token)}`;
    const siteName = (env.SETTINGS && env.SETTINGS.site_name) || 'our store';
    try {
      await sendMail(env, {
        to: email,
        subject: 'Your sign-in link',
        html: loginMailHtml({ link, siteName }),
      });
    } catch (e) {
      // 发信失败不能影响响应：一是保持防枚举文案一致，二是别让客户对着错误页发呆
      console.error('account login mail failed', e.message);
    }

    return ok();
  } catch (e) {
    // 表还没迁移等情况：同样不区分邮箱，只给一条通用 500
    console.error('request-link failed', e.message);
    return json({ error: 'Could not process the request. Please try again later.' }, 500, corsHeaders);
  }
}

/* ------------------------------------------------------------------
 * GET /api/account/verify
 * ------------------------------------------------------------------ */

async function verifyLink(request, env) {
  if (!env.JWT_SECRET) return serverMisconfiguredPage();

  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '').trim();
  if (!token) return linkExpiredPage();

  let row;
  try {
    row = await env.DB.prepare(
      `SELECT id, email, expires_at, used_at FROM magic_tokens
       WHERE token = ? AND purpose = 'login' LIMIT 1`
    ).bind(token).first();
  } catch (e) {
    console.error('verify lookup failed', e.message);
    return htmlPage('Something went wrong',
      '<h1>Something went wrong</h1><p>Please try again in a moment.</p><a class="btn" href="/account">Back to /account</a>', 500);
  }
  if (!row) return linkExpiredPage();

  // 原子消费：条件全部放在 UPDATE 的 WHERE 里，并发双击时只有一次 changes === 1
  let consumed;
  try {
    consumed = await env.DB.prepare(
      `UPDATE magic_tokens SET used_at = CURRENT_TIMESTAMP
       WHERE token = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`
    ).bind(token).run();
  } catch (e) {
    console.error('verify consume failed', e.message);
    return linkExpiredPage();
  }
  if (!consumed || !consumed.meta || consumed.meta.changes !== 1) return linkExpiredPage();

  const email = String(row.email || '').toLowerCase();

  try {
    // 首次登录建档案，之后只更新 last_login_at（保留运营补的 name/company/phone，别覆盖成空）
    await env.DB.prepare(
      `INSERT INTO customer_accounts (email, lang, status, last_login_at)
       VALUES (?, ?, 'active', CURRENT_TIMESTAMP)
       ON CONFLICT(email) DO UPDATE SET last_login_at = CURRENT_TIMESTAMP`
    ).bind(email, (env.LANG || env.DEFAULT_LANG || 'en')).run();
  } catch (e) {
    console.error('customer upsert failed', e.message);
    return htmlPage('Something went wrong',
      '<h1>Something went wrong</h1><p>Please try again in a moment.</p><a class="btn" href="/account">Back to /account</a>', 500);
  }

  let session;
  try {
    session = await signCustomerToken(email, env.JWT_SECRET);
  } catch (e) {
    console.error('customer token sign failed', e.message);
    return serverMisconfiguredPage();
  }

  // 本地 http 下不能加 Secure，否则浏览器直接丢掉这个 cookie，表现为「登录后又变回未登录」
  const secure = url.protocol === 'https:';
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/account?welcome=1',
      'Set-Cookie': customerCookie(session, { secure }),
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------------
 * POST /api/account/logout
 * ------------------------------------------------------------------ */

function logout() {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/account',
      'Set-Cookie': clearCustomerCookie(),
      'Cache-Control': 'no-store',
    },
  });
}

/* ------------------------------------------------------------------
 * GET /api/account/me
 * ------------------------------------------------------------------ */

async function me(request, env, corsHeaders) {
  const account = await requireCustomer(request, env);
  if (!account) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  const email = String(account.email || '').toLowerCase();
  try {
    const qRes = await env.DB.prepare(
      `SELECT id, quote_no, status, currency, total, valid_until, created_at, token
       FROM quotes WHERE LOWER(customer_email) = ? ORDER BY created_at DESC`
    ).bind(email).all();
    const oRes = await env.DB.prepare(
      `SELECT id, order_no, status, payment_status, currency, total, carrier,
              tracking_no, tracking_url, ship_date, eta, created_at
       FROM orders WHERE LOWER(customer_email) = ? ORDER BY created_at DESC`
    ).bind(email).all();

    // 字段裁剪：内部字段（created_by / customer_id / inquiry_id / notes）一律不外泄。
    // token 只对 status='sent' 的报价给，否则等于把已作废/已签署的链接重新递出去。
    const quotes = (qRes.results || []).map(q => ({
      id: q.id,
      quote_no: q.quote_no,
      status: q.status,
      currency: q.currency,
      total: q.total,
      valid_until: q.valid_until,
      created_at: q.created_at,
      token: q.status === 'sent' ? q.token : null,
    }));
    const orders = (oRes.results || []).map(o => ({
      id: o.id,
      order_no: o.order_no,
      status: o.status,
      payment_status: o.payment_status,
      currency: o.currency,
      total: o.total,
      carrier: o.carrier,
      tracking_no: o.tracking_no,
      tracking_url: o.tracking_url,
      ship_date: o.ship_date,
      eta: o.eta,
      created_at: o.created_at,
    }));

    return new Response(JSON.stringify({
      success: true,
      data: {
        account: {
          id: account.id,
          email: account.email,
          name: account.name,
          company: account.company,
          phone: account.phone,
          country: account.country,
          lang: account.lang,
          status: account.status,
          last_login_at: account.last_login_at,
          created_at: account.created_at,
        },
        quotes,
        orders,
      },
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json;charset=UTF-8',
        // 会话相关数据绝不能进 CDN / 浏览器缓存
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('account me failed', e.message);
    return json({ error: 'Could not load your account' }, 500, corsHeaders);
  }
}
