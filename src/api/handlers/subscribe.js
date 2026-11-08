/**
 * 邮件订阅（阶段二C）—— 双 opt-in
 *
 * 流程：提交 → 写 pending + 发确认信 → 点确认链接 → confirmed → （退订链接）→ unsubscribed
 *
 * 几个刻意的选择：
 *  - 提交接口永远返回 200 + 中性文案：不区分「已订阅」「刚发送确认信」，
 *    否则这个接口就成了「某邮箱是否在名单里」的探测器。
 *  - token 用 HMAC 签名而不是随机串落库后再查：省一次查询，且 token 无法被枚举。
 *    token 里带 email 与用途，签名校验失败直接拒。
 *  - 确认/退订都走 GET 页面（邮件里点链接只能是 GET），但改变状态的动作必须带签名。
 */
import { requireAuth } from '../../utils/auth';
import { getTemplates, renderTemplate, textToHtml } from '../../mail-templates';

const TOKEN_TTL_DAYS = 30;

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

function fromB64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

/** token = base64url({e:email,p:purpose,t:ts}).sig */
async function makeToken(env, email, purpose) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    e: email, p: purpose, t: Date.now(),
  })));
  const sig = await hmac(env.JWT_SECRET || 'no-secret', payload);
  return `${payload}.${sig}`;
}

async function parseToken(env, token, purpose) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = await hmac(env.JWT_SECRET || 'no-secret', payload);
  if (expect !== sig) return null;
  try {
    const obj = JSON.parse(fromB64url(payload));
    if (obj.p !== purpose) return null;
    if (Date.now() - Number(obj.t || 0) > TOKEN_TTL_DAYS * 864e5) return null;
    return obj;
  } catch { return null; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function sendMail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return { skipped: 'RESEND_API_KEY not configured' };
  const from = env.MAIL_FROM || 'Product Updates <notify@example.com>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`);
  }
  return { sent: true };
}

function siteBase(env, request) {
  return (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : new URL(request.url).origin;
}

/* ---------------- 公开接口 ---------------- */

export async function handleSubscribe(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'POST' && url.pathname === '/api/subscribe') return subscribe(request, env, corsHeaders);
  if (method === 'GET' && url.pathname === '/api/subscribe/confirm') return confirmPage(request, env);
  if (method === 'GET' && url.pathname === '/api/subscribe/unsubscribe') return unsubPage(request, env);

  return json({ error: 'Not found' }, 404, corsHeaders);
}

async function subscribe(request, env, corsHeaders) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const email = String(data.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 190) {
    return json({ error: 'Please enter a valid email address' }, 400, corsHeaders);
  }
  // 蜜罐：正常用户看不到 company_url 这个字段
  if (data.company_url || data.website) {
    return json({ success: true, message: 'Please check your inbox to confirm.' }, 200, corsHeaders);
  }

  const base = siteBase(env, request);
  const token = await makeToken(env, email, 'sub');
  const confirmUrl = `${base}/api/subscribe/confirm?token=${encodeURIComponent(token)}`;

  let status = 'pending';
  try {
    const existing = await env.DB.prepare('SELECT id, status FROM subscribers WHERE email = ? LIMIT 1')
      .bind(email).first();
    if (existing) {
      status = existing.status;
      // 已退订的人再次提交：允许重新回到 pending，但必须重新确认
      if (status === 'unsubscribed') status = 'pending';
      if (status === 'pending') {
        await env.DB.prepare(
          'UPDATE subscribers SET token = ?, lang = ?, source = COALESCE(?, source), ip = ?, confirm_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).bind(token, data.lang || 'en', data.source || null,
               request.headers.get('CF-Connecting-IP') || null, existing.id).run();
      }
    } else {
      await env.DB.prepare(
        `INSERT INTO subscribers (email, token, status, lang, source, ip, confirm_sent_at)
         VALUES (?, ?, 'pending', ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(email, token, data.lang || 'en', data.source || null,
             request.headers.get('CF-Connecting-IP') || null).run();
    }
  } catch (e) {
    // 表不存在时明确告知，不要假装成功——否则运营以为在收名单其实是空的
    if (String(e.message || '').includes('no such table')) {
      return json({ error: 'Subscription is not available yet (migration 005 not applied)' }, 503, corsHeaders);
    }
    console.error('subscribe failed', e.message);
    return json({ error: 'Could not save subscription' }, 500, corsHeaders);
  }

  // 已确认的人再提交：不重复发确认信，但仍返回同样的文案（不泄露状态）
  if (status === 'confirmed') {
    return json({ success: true, message: 'Please check your inbox to confirm.' }, 200, corsHeaders);
  }

  const tpl = await getTemplates(env);
  const html = textToHtml(renderTemplate(tpl.subscribe_confirm_body, {
    confirm_url_raw: `<a href="${confirmUrl}">${confirmUrl}</a>`,
  }));

  // 本地/预览环境没有 Resend Key 时，把确认链接直接回传，方便自测整条链路。
  // 必须显式配置 DEV_MAIL_ECHO=1 才生效，生产环境不设该变量即不会泄露。
  if (env.DEV_MAIL_ECHO === '1') {
    return json({
      success: true,
      message: 'Please check your inbox to confirm.',
      dev_confirm_url: confirmUrl,
    }, 200, corsHeaders);
  }

  try {
    await sendMail(env, { to: email, subject: tpl.subscribe_confirm_subject, html });
  } catch (e) {
    console.error('confirm mail failed', e.message);
    return json({
      success: false,
      error: 'Could not send the confirmation email. Please try again later.',
      detail: env.ENVIRONMENT === 'production' ? undefined : e.message,
    }, 502, corsHeaders);
  }

  return json({ success: true, message: 'Please check your inbox to confirm.' }, 200, corsHeaders);
}

function page(title, bodyHtml) {
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#111}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:2.25rem;max-width:460px;
        box-shadow:0 8px 24px rgba(15,23,42,.06);text-align:center}
  h1{font-size:1.2rem;margin:0 0 .75rem}
  p{color:#4b5563;line-height:1.6;margin:0 0 .75rem;font-size:.95rem}
  a.btn{display:inline-block;margin-top:.75rem;padding:.7rem 1.2rem;background:#2563eb;color:#fff;
        border-radius:8px;text-decoration:none;font-size:.9rem}
</style></head><body><div class="card">${bodyHtml}</div></body></html>`, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}

async function confirmPage(request, env) {
  const token = new URL(request.url).searchParams.get('token');
  const parsed = await parseToken(env, token, 'sub');
  if (!parsed) {
    return page('Link expired', '<h1>This link is invalid or expired</h1><p>Please subscribe again from the website.</p>');
  }
  try {
    const row = await env.DB.prepare('SELECT id, status FROM subscribers WHERE email = ? LIMIT 1')
      .bind(parsed.e).first();
    if (!row) {
      return page('Not found', '<h1>Subscription not found</h1><p>Please subscribe again from the website.</p>');
    }
    if (row.status !== 'confirmed') {
      await env.DB.prepare(
        "UPDATE subscribers SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP, unsubscribed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(row.id).run();
    }
    // 确认后立刻给一封欢迎信 + 退订方式（合规要求每封营销邮件都能退订）
    try {
      const tpl = await getTemplates(env);
      const unsubToken = await makeToken(env, parsed.e, 'unsub');
      const unsubUrl = `${siteBase(env, request)}/api/subscribe/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
      await sendMail(env, {
        to: parsed.e,
        subject: tpl.subscribe_welcome_subject,
        html: textToHtml(renderTemplate(tpl.subscribe_welcome_body, {
          unsub_url_raw: `<a href="${unsubUrl}">${unsubUrl}</a>`,
        })),
      });
    } catch (e) {
      console.error('welcome mail failed', e.message);
    }
    return page('Subscribed', `<h1>You are subscribed</h1><p>Thanks — we will email you when there is something worth reading.</p>
      <a class="btn" href="${siteBase(env, request)}/">Back to site</a>`);
  } catch (e) {
    return page('Error', '<h1>Something went wrong</h1><p>Please try the link again later.</p>');
  }
}

async function unsubPage(request, env) {
  const token = new URL(request.url).searchParams.get('token');
  const parsed = await parseToken(env, token, 'unsub');
  if (!parsed) {
    return page('Link expired', '<h1>This link is invalid or expired</h1><p>Reply to any of our emails and we will remove you manually.</p>');
  }
  try {
    await env.DB.prepare(
      "UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE email = ?"
    ).bind(parsed.e).run();
    return page('Unsubscribed', `<h1>You have been unsubscribed</h1><p>${parsed.e} will not receive further updates.</p>
      <a class="btn" href="${siteBase(env, request)}/">Back to site</a>`);
  } catch {
    return page('Error', '<h1>Something went wrong</h1><p>Please try again later.</p>');
  }
}

/* ---------------- 后台接口 ---------------- */

export async function handleSubscribersAdmin(request, env, corsHeaders) {
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  const url = new URL(request.url);
  const method = request.method;

  if (method === 'GET') {
    const status = url.searchParams.get('status');
    const where = status && ['pending', 'confirmed', 'unsubscribed'].includes(status) ? 'WHERE status = ?' : '';
    const stmt = where
      ? env.DB.prepare(`SELECT * FROM subscribers ${where} ORDER BY created_at DESC LIMIT 500`).bind(status)
      : env.DB.prepare('SELECT * FROM subscribers ORDER BY created_at DESC LIMIT 500');
    const { results } = await stmt.all();
    const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status').all();
    return json({ success: true, data: results, counts: counts.results || [] }, 200, corsHeaders);
  }

  if (method === 'DELETE') {
    if (admin.role !== 'super_admin') return json({ error: 'Super admin required' }, 401, corsHeaders);
    const parts = url.pathname.split('/').filter(Boolean); // ['api','subscribers', id]
    const id = parts[2];
    if (!id) return json({ error: 'id required' }, 400, corsHeaders);
    await env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(id).run();
    return json({ success: true }, 200, corsHeaders);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}
