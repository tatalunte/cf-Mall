/**
 * 询盘 API（改造版）
 * 原版问题：GET 列表/详情、PUT 状态、stats 全部标着 "TODO: Add authentication check"，
 *          即任何人 GET /api/inquiries 就能拖走全部客户姓名/邮箱/电话/公司；CORS 还是 *。
 *          另外没有邮件通知、防垃圾、备注、导出、GDPR 同意。
 * 改造后：写库 -> Queue 异步发信；读改删全部鉴权；Turnstile + honeypot + D1 频控；轻 CRM + CSV。
 */
import { requireAuth, requireSuperAdmin } from '../../utils/auth';
import { normalizeDateTime } from './crm';

const STATUSES = ['pending', 'processing', 'quoted', 'completed', 'won', 'lost', 'spam'];

/* ---------------- 附件（阶段一C）----------------
 * 附件与询盘在同一次 multipart 请求里提交：
 *  - 不额外开放公开上传接口，避免被当成免费图床
 *  - 魔数校验（不信任 Content-Type / 扩展名）
 *  - 存 R2，只在后台通过鉴权接口下载，客户资料不外泄
 */
const ATTACH_MAX = 5 * 1024 * 1024;

function detectFileKind(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  return null;
}

/** 同时兼容 JSON（旧前端）与 multipart/form-data（带附件） */
async function parseInquiryBody(request) {
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    const fd = await request.formData();
    const data = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string') data[k] = v;
    }
    data.consent = data.consent === 'true' || data.consent === '1' || data.consent === 'on';
    const file = fd.get('attachment');
    if (file && typeof file !== 'string' && file.size > 0) data.__file = file;
    return data;
  }
  return await request.json();
}

function json(data, status, corsHeaders, extra = {}) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8', ...extra },
  });
}

export async function handleInquiries(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean); // ['api','inquiries', ...]

  // 公开：提交询盘
  if (method === 'POST' && parts.length === 2) return createInquiry(request, env, corsHeaders);

  // 以下全部需要登录
  if (method === 'GET' && parts[2] === 'export.csv') return exportCsv(request, env, corsHeaders);
  if (method === 'GET' && parts.length === 4 && parts[3] === 'attachment')
    return downloadAttachment(request, env, corsHeaders, parts[2]);
  if (method === 'GET' && parts.length === 2) return listInquiries(request, env, corsHeaders, url);
  if (method === 'GET' && parts.length === 3) return getInquiry(request, env, corsHeaders, parts[2]);
  if (method === 'PUT' && parts.length === 4 && parts[3] === 'status')
    return updateStatus(request, env, corsHeaders, parts[2]);
  if (method === 'PUT' && parts.length === 4 && ['notes', 'assignee', 'priority', 'follow-up'].includes(parts[3]))
    return updateCrm(request, env, corsHeaders, parts[2], parts[3]);
  if (method === 'DELETE' && parts.length === 3) return deleteInquiry(request, env, corsHeaders, parts[2]);

  return json({ error: 'Not found' }, 404, corsHeaders);
}

async function guard(request, env, corsHeaders, superOnly) {
  const admin = superOnly
    ? await requireSuperAdmin(request, env)
    : await requireAuth(request, env);
  if (!admin) {
    return {
      error: json({ error: 'Unauthorized' }, 401, corsHeaders),
      admin: null,
    };
  }
  return { error: null, admin };
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'Captcha token missing' };
  try {
    const body = new URLSearchParams();
    body.set('secret', env.TURNSTILE_SECRET_KEY);
    body.set('response', token);
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body,
    });
    const out = await res.json();
    return { ok: !!out.success, error: out['error-codes']?.join(',') || 'Captcha verification failed' };
  } catch (e) {
    return { ok: false, error: 'Captcha service unavailable' };
  }
}

async function createInquiry(request, env, corsHeaders) {
  let data;
  try { data = await parseInquiryBody(request); }
  catch { return json({ error: 'Invalid request body' }, 400, corsHeaders); }

  // 蜜罐：正常用户看不到该字段，机器人会填
  if (data.website || data.url || data._gotcha) {
    return json({ success: true, message: 'ok' }, 200, corsHeaders); // 假成功，不暴露规则
  }
  if (!data.name || !data.email || !data.message) {
    return json({ error: 'Name, email and message are required' }, 400, corsHeaders);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254) {
    return json({ error: 'Invalid email' }, 400, corsHeaders);
  }
  if (String(data.name).length > 120 || String(data.message).length > 5000) {
    return json({ error: 'Content too long' }, 400, corsHeaders);
  }
  if (data.consent !== true && data.consent !== 1 && data.consent !== 'true') {
    return json({ error: 'Privacy consent is required' }, 400, corsHeaders);
  }

  const captcha = await verifyTurnstile(request, env, data.turnstile_token || data['cf-turnstile-response']);
  if (!captcha.ok) return json({ error: captcha.error }, 403, corsHeaders);

  // 简易频控：同一邮箱 10 分钟内最多 3 条（不额外建表，直接查 D1）
  try {
    const { count } = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM inquiries
       WHERE email = ? AND created_at > datetime('now', '-10 minutes')`
    ).bind(data.email).first();
    if (count >= 3) return json({ error: 'Too many requests, please try again later' }, 429, corsHeaders);
  } catch { /* D1 异常时不阻断主流程 */ }

  // ---- 附件 ----
  let attachmentKey = null;
  let attachmentName = null;
  if (data.__file) {
    const file = data.__file;
    if (file.size > ATTACH_MAX) {
      return json({ error: 'Attachment too large (max 5 MB)' }, 400, corsHeaders);
    }
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const kind = detectFileKind(head);
    if (!kind) {
      return json({ error: 'Attachment must be PDF, JPG or PNG' }, 400, corsHeaders);
    }
    if (!env.IMAGES) {
      return json({ error: 'File storage unavailable' }, 503, corsHeaders);
    }
    attachmentKey = `inquiries/${Date.now().toString(36)}-${crypto.randomUUID()}.${kind.ext}`;
    try {
      await env.IMAGES.put(attachmentKey, file.stream(), {
        httpMetadata: { contentType: kind.mime },
      });
      attachmentName = String(file.name || 'attachment').slice(0, 120);
    } catch (e) {
      console.error('attachment upload failed', e);
      return json({ error: 'Attachment upload failed' }, 500, corsHeaders);
    }
  }

  // ---- 来源归因：只收白名单键，长度截断 ----
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'landing_page', 'referrer']) {
    const v = data[k];
    utm[k] = v ? String(v).slice(0, 200) : null;
  }
  if (!utm.referrer && request.headers.get('Referer')) {
    utm.referrer = request.headers.get('Referer').slice(0, 200);
  }

  let result;
  try {
    result = await env.DB.prepare(
      `INSERT INTO inquiries
       (product_id, name, email, company, phone, country, message, status,
        lang, source, consent, mail_status,
        attachment_url, attachment_name,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_page, referrer)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.product_id || null,
      String(data.name).trim(),
      String(data.email).trim().toLowerCase(),
      data.company || null,
      data.phone || null,
      data.country || null,
      String(data.message).trim(),
      data.lang || 'en',
      data.source || utm.utm_source || request.headers.get('Referer') || null,
      attachmentKey,
      attachmentName,
      utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term,
      utm.utm_content, utm.landing_page, utm.referrer
    ).run();
  } catch (error) {
    // 若尚未执行 003 迁移，退化为最小字段集，保证站点不因迁移遗漏而完全不可用
    console.error('inquiry insert with ext columns failed, falling back', error.message);
    try {
      result = await env.DB.prepare(
        `INSERT INTO inquiries (product_id, name, email, company, phone, country, message, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
      ).bind(data.product_id || null, data.name, data.email, data.company || null,
             data.phone || null, data.country || null, data.message).run();
    } catch (e2) {
      return json({ error: 'Database error' }, 500, corsHeaders);
    }
  }

  const id = result.meta.last_row_id;

  /* 阶段二A：自动归并客户档案 + 初判意向等级。
   * 为什么要自动：外贸站的询盘里 30%~50% 是同一买家反复来问，
   * 手工建客户没人做；先自动建档，销售再改等级/归属，成本最低。
   * 失败不影响主流程——询盘已经落库了，CRM 只是附加信息。 */
  try {
    const email = String(data.email).trim().toLowerCase();
    let customerId = null;
    const existing = await env.DB.prepare('SELECT id FROM customers WHERE email = ? LIMIT 1').bind(email).first();
    if (existing) {
      customerId = existing.id;
      await env.DB.prepare(
        `UPDATE customers SET
           inquiry_count = inquiry_count + 1,
           last_activity_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           company = COALESCE(NULLIF(?, ''), company),
           phone   = COALESCE(NULLIF(?, ''), phone),
           country = COALESCE(NULLIF(?, ''), country)
         WHERE id = ?`
      ).bind(data.company || '', data.phone || '', data.country || '', customerId).run();
    } else {
      const ins = await env.DB.prepare(
        `INSERT INTO customers
           (company, email, phone, country, level, source, first_inquiry_at, last_activity_at, inquiry_count)
         VALUES (?, ?, ?, ?, 'new', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)`
      ).bind(data.company || null, email, data.phone || null, data.country || null,
             utm.utm_source || 'direct').run();
      customerId = ins.meta.last_row_id;
    }
    await env.DB.prepare('UPDATE inquiries SET customer_id = ?, priority = ? WHERE id = ?')
      .bind(customerId, guessPriority(data), id).run();
  } catch (e) {
    console.error('crm link failed (inquiry still saved)', e.message);
  }

  // 异步投递；Queue 不可用时记录 failed，Cron 兜底重发，绝不阻塞用户响应
  try {
    if (env.INQUIRY_QUEUE) await env.INQUIRY_QUEUE.send({ inquiryId: id });
  } catch (e) {
    console.error('queue send failed', e);
  }

  return json({ success: true, data: { id, attachment: attachmentKey ? 'stored' : null } }, 201, corsHeaders);
}

/**
 * 初判意向等级（只作为销售的第一眼参考，随时可改）。
 * 判定偏向保守：宁可标 warm 让人点开看，也不要全站 hot 导致优先级失去意义。
 *   hot  = 有明确询价词 + 有数量，或出现紧急词
 *   cold = 求职 / 推广 / 换链接 这类与我们业务无关的内容
 */
function guessPriority(data) {
  const text = `${data.message || ''}`.toLowerCase();
  if (!text) return 'warm';
  if (/(job|resume|cv\b|hiring|seo service|guest post|link exchange|backlink|we offer|we are a manufacturer of the same)/.test(text)) {
    return 'cold';
  }
  const wantsQuote = /(quote|quotation|price|pricing|price list|order|po\b|fob|cif|exw|sample order|moq)/.test(text);
  const hasQty = /\d{2,}\s*(pcs|pieces|units|sets|tons?|mt|containers?|cartons?)/.test(text);
  const urgent = /(urgent|asap|immediately|right away|this week|end of month|deadline)/.test(text);
  if (urgent) return 'hot';
  if (wantsQuote && hasQty) return 'hot';
  return 'warm';
}

/** 附件下载：必须登录；R2 key 只存在附件路径里，前台拿不到 */async function downloadAttachment(request, env, corsHeaders, id) {
  const { error } = await guard(request, env, corsHeaders, false);
  if (error) return error;
  const row = await env.DB.prepare(
    'SELECT attachment_url, attachment_name FROM inquiries WHERE id = ?'
  ).bind(id).first();
  if (!row || !row.attachment_url) return json({ error: 'No attachment' }, 404, corsHeaders);

  const obj = await env.IMAGES.get(row.attachment_url);
  if (!obj) return json({ error: 'File not found in storage' }, 404, corsHeaders);

  const name = encodeURIComponent(row.attachment_name || 'attachment');
  return new Response(obj.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${name}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function listInquiries(request, env, corsHeaders, url) {
  const { error } = await guard(request, env, corsHeaders, false);
  if (error) return error;

  const status = url.searchParams.get('status');
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
  const where = [];
  const binds = [];
  if (status && STATUSES.includes(status)) { where.push('i.status = ?'); binds.push(status); }
  if (q) {
    where.push('(i.name LIKE ? OR i.email LIKE ? OR i.company LIKE ? OR i.message LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const { results } = await env.DB.prepare(
    `SELECT i.*, p.name AS product_name FROM inquiries i
     LEFT JOIN products p ON p.id = i.product_id
     ${clause} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  return json({ success: true, data: results }, 200, corsHeaders);
}

async function getInquiry(request, env, corsHeaders, id) {
  const { error } = await guard(request, env, corsHeaders, false);
  if (error) return error;
  const row = await env.DB.prepare(
    `SELECT i.*, p.name AS product_name FROM inquiries i
     LEFT JOIN products p ON p.id = i.product_id WHERE i.id = ?`
  ).bind(id).first();
  return row ? json({ success: true, data: row }, 200, corsHeaders)
             : json({ error: 'Not found' }, 404, corsHeaders);
}

async function updateStatus(request, env, corsHeaders, id) {
  const { error } = await guard(request, env, corsHeaders, false);
  if (error) return error;
  const data = await request.json();
  if (!STATUSES.includes(data.status)) {
    return json({ error: 'Invalid status. Allowed: ' + STATUSES.join(', ') }, 400, corsHeaders);
  }
  try {
    await env.DB.prepare(
      `UPDATE inquiries SET status = ?, quoted_at = CASE WHEN ? = 'quoted' THEN CURRENT_TIMESTAMP ELSE quoted_at END,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(data.status, data.status, id).run();
  } catch {
    await env.DB.prepare(
      'UPDATE inquiries SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(data.status, id).run();
  }
  return json({ success: true }, 200, corsHeaders);
}

async function updateCrm(request, env, corsHeaders, id, field) {
  const { error, admin } = await guard(request, env, corsHeaders, false);
  if (error) return error;
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  // 阶段二A：priority / follow-up 的入参是结构化值，不能按自由文本写
  if (field === 'priority') {
    const v = String(data.value || '').trim();
    if (!['hot', 'warm', 'cold'].includes(v)) {
      return json({ error: 'priority must be hot / warm / cold' }, 400, corsHeaders);
    }
    await env.DB.prepare('UPDATE inquiries SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(v, id).run();
    await env.DB.prepare(
      "INSERT INTO activities (inquiry_id, customer_id, type, content, admin_user) SELECT ?, customer_id, 'status', ?, ? FROM inquiries WHERE id = ?"
    ).bind(id, `Priority set to ${v}`, admin?.username || null, id).run();
    return json({ success: true, value: v }, 200, corsHeaders);
  }

  if (field === 'follow-up') {
    // 传空值表示清除提醒
    const raw = data.value == null ? '' : String(data.value).trim();
    const when = raw ? normalizeDateTime(raw) : null;
    if (raw && !when) return json({ error: 'Invalid date' }, 400, corsHeaders);
    await env.DB.prepare('UPDATE inquiries SET next_follow_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(when, id).run();
    return json({ success: true, value: when }, 200, corsHeaders);
  }

  const value = String(data.value || '').slice(0, 4000);
  await env.DB.prepare(
    `UPDATE inquiries SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(value, id).run();
  return json({ success: true }, 200, corsHeaders);
}

async function deleteInquiry(request, env, corsHeaders, id) {
  const { error } = await guard(request, env, corsHeaders, true);
  if (error) return error;
  await env.DB.prepare('DELETE FROM inquiries WHERE id = ?').bind(id).run();
  return json({ success: true }, 200, corsHeaders);
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // 防止 CSV 公式注入（Excel 打开时执行 =cmd|...）
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

async function exportCsv(request, env, corsHeaders) {
  const { error } = await guard(request, env, corsHeaders, false);
  if (error) return error;
  const { results } = await env.DB.prepare(
    `SELECT i.*, p.name AS product_name FROM inquiries i
     LEFT JOIN products p ON p.id = i.product_id ORDER BY i.created_at DESC LIMIT 10000`
  ).all();
  const cols = ['id', 'created_at', 'status', 'product_name', 'name', 'email', 'company',
                'phone', 'country', 'lang', 'source', 'utm_source', 'utm_medium', 'utm_campaign',
                'landing_page', 'attachment_name', 'assignee', 'notes', 'mail_status', 'message'];
  const lines = [cols.join(','), ...results.map(r => cols.map(c => csvCell(r[c])).join(','))];
  return new Response('\uFEFF' + lines.join('\r\n'), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/csv;charset=UTF-8',
      'Content-Disposition': 'attachment; filename="inquiries.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
