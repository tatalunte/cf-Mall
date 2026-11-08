/**
 * 轻 CRM API（阶段二A）
 *
 * 为什么不做完整 CRM：外贸站的真实工作流是「来询盘 → 回邮件 → 报价 → 催单 → 成单」，
 * 商机(Opportunity)/阶段概率/销售预测这套东西对 1-5 人的外贸团队是纯负担。
 * 所以只做三件事：
 *   1) customers —— 同一买家多次询盘的聚合视图（按邮箱唯一）
 *   2) activities —— 跟进时间线，一条记录能同时挂询盘与客户
 *   3) next_follow_at —— 绝对时间的提醒，靠 Cron 每天汇总，不做规则引擎
 *
 * 所有接口都需要登录；改归属/等级需要登录即可（admin 也要能改，不然协作不了），
 * 删除类操作不存在——CRM 数据只增不删，避免误删客户历史。
 */
import { requireAuth } from '../../utils/auth';

const LEVELS = ['new', 'lead', 'qualified', 'quote', 'negotiation', 'won', 'lost'];
const TYPES = ['note', 'call', 'email', 'meeting', 'quote', 'status'];

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

async function guard(request, env, corsHeaders) {
  const admin = await requireAuth(request, env);
  if (!admin) return { error: json({ error: 'Unauthorized' }, 401, corsHeaders), admin: null };
  return { error: null, admin };
}

export async function handleCrm(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'crm', ...]

  const res = await guard(request, env, corsHeaders);
  if (res.error) return res.error;

  // GET /api/crm/overview —— 首页漏斗 + 待跟进计数
  if (method === 'GET' && parts[2] === 'overview') return overview(env, corsHeaders);
  // GET /api/crm/reminders —— 今天该跟进的询盘
  if (method === 'GET' && parts[2] === 'reminders') return reminders(env, url, corsHeaders);

  // /api/crm/customers[/:id]
  if (parts[2] === 'customers') {
    if (method === 'GET' && !parts[3]) return listCustomers(env, url, corsHeaders);
    if (method === 'POST' && !parts[3]) return createCustomer(request, env, corsHeaders);
    if (method === 'GET' && parts[3]) return getCustomer(env, corsHeaders, parts[3]);
    if (method === 'PUT' && parts[3]) return updateCustomer(request, env, corsHeaders, parts[3], res.admin);
  }

  // /api/crm/activities[?inquiry_id=&customer_id=]  与 /api/crm/activities/:id/done
  if (parts[2] === 'activities') {
    if (method === 'GET' && !parts[3]) return listActivities(env, url, corsHeaders);
    if (method === 'POST' && !parts[3]) return createActivity(request, env, corsHeaders, res.admin);
    if (method === 'PUT' && parts[3] && parts[4] === 'done')
      return toggleActivity(request, env, corsHeaders, parts[3]);
  }

  return json({ error: 'Not found' }, 404, corsHeaders);
}

/* ---------------- 客户 ---------------- */

async function listCustomers(env, url, corsHeaders) {
  const level = url.searchParams.get('level');
  const owner = url.searchParams.get('owner');
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

  const where = [];
  const binds = [];
  if (level && LEVELS.includes(level)) { where.push('c.level = ?'); binds.push(level); }
  if (owner) { where.push('c.owner = ?'); binds.push(owner); }
  if (q) {
    where.push('(c.company LIKE ? OR c.email LIKE ? OR c.country LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const { results } = await env.DB.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM inquiries i WHERE i.customer_id = c.id) AS inquiry_total,
            (SELECT MAX(i.created_at) FROM inquiries i WHERE i.customer_id = c.id) AS last_inquiry_at
       FROM customers c ${clause}
      ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC
      LIMIT ?`
  ).bind(...binds, limit).all();

  return json({ success: true, data: results }, 200, corsHeaders);
}

async function getCustomer(env, corsHeaders, id) {
  const customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ? LIMIT 1').bind(id).first();
  if (!customer) return json({ error: 'Customer not found' }, 404, corsHeaders);

  const inquiries = await env.DB.prepare(
    `SELECT i.id, i.name, i.email, i.company, i.country, i.status, i.priority,
            i.message, i.created_at, i.next_follow_at, p.name AS product_name
       FROM inquiries i LEFT JOIN products p ON p.id = i.product_id
      WHERE i.customer_id = ? ORDER BY i.created_at DESC LIMIT 50`
  ).bind(id).all();

  const activities = await env.DB.prepare(
    'SELECT * FROM activities WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(id).all();

  return json({
    success: true,
    data: {
      ...customer,
      inquiries: inquiries.results || [],
      activities: activities.results || [],
    },
  }, 200, corsHeaders);
}

async function createCustomer(request, env, corsHeaders) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
  const email = String(data.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'email is required' }, 400, corsHeaders);

  const existing = await env.DB.prepare('SELECT id FROM customers WHERE email = ? LIMIT 1').bind(email).first();
  if (existing) return json({ error: 'Customer with this email already exists', id: existing.id }, 409, corsHeaders);

  const result = await env.DB.prepare(
    `INSERT INTO customers (company, email, phone, country, website, level, owner, tags, notes, source, first_inquiry_at, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    data.company || null, email, data.phone || null, data.country || null, data.website || null,
    LEVELS.includes(data.level) ? data.level : 'new',
    data.owner || null,
    data.tags ? JSON.stringify(data.tags) : null,
    data.notes || null, data.source || null,
  ).run();

  return json({ success: true, data: { id: result.meta.last_row_id } }, 201, corsHeaders);
}

async function updateCustomer(request, env, corsHeaders, id, admin) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const sets = [];
  const binds = [];
  if (Object.prototype.hasOwnProperty.call(data, 'level')) {
    if (!LEVELS.includes(data.level)) return json({ error: 'Invalid level', allowed: LEVELS }, 400, corsHeaders);
    sets.push('level = ?'); binds.push(data.level);
  }
  for (const f of ['company', 'phone', 'country', 'website', 'owner', 'notes', 'source']) {
    if (Object.prototype.hasOwnProperty.call(data, f)) { sets.push(`${f} = ?`); binds.push(data[f] || null); }
  }
  if (Object.prototype.hasOwnProperty.call(data, 'tags')) {
    sets.push('tags = ?');
    binds.push(data.tags == null || data.tags === '' ? null : JSON.stringify(data.tags));
  }
  if (!sets.length) return json({ error: 'No updatable fields provided' }, 400, corsHeaders);

  await env.DB.prepare(
    `UPDATE customers SET ${sets.join(', ')}, last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(...binds, id).run();

  // 等级变化自动留痕，方便回溯「这单什么时候变热的」
  if (Object.prototype.hasOwnProperty.call(data, 'level')) {
    await env.DB.prepare(
      `INSERT INTO activities (customer_id, type, content, admin_user) VALUES (?, 'status', ?, ?)`
    ).bind(id, `Level changed to ${data.level}`, admin?.username || null).run();
  }

  return json({ success: true }, 200, corsHeaders);
}

/* ---------------- 跟进记录 ---------------- */

async function listActivities(env, url, corsHeaders) {
  const inquiryId = url.searchParams.get('inquiry_id');
  const customerId = url.searchParams.get('customer_id');
  if (!inquiryId && !customerId) {
    return json({ error: 'inquiry_id or customer_id is required' }, 400, corsHeaders);
  }
  const { results } = inquiryId
    ? await env.DB.prepare('SELECT * FROM activities WHERE inquiry_id = ? ORDER BY created_at DESC LIMIT 200').bind(inquiryId).all()
    : await env.DB.prepare('SELECT * FROM activities WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200').bind(customerId).all();
  return json({ success: true, data: results }, 200, corsHeaders);
}

async function createActivity(request, env, corsHeaders, admin) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const content = String(data.content || '').trim();
  if (!content) return json({ error: 'content is required' }, 400, corsHeaders);

  const inquiryId = data.inquiry_id ? Number(data.inquiry_id) : null;
  const customerId = data.customer_id ? Number(data.customer_id) : null;
  if (!inquiryId && !customerId) {
    return json({ error: 'inquiry_id or customer_id is required' }, 400, corsHeaders);
  }

  const type = TYPES.includes(data.type) ? data.type : 'note';
  const dueAt = normalizeDateTime(data.due_at);

  const result = await env.DB.prepare(
    'INSERT INTO activities (inquiry_id, customer_id, type, content, admin_user, due_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(inquiryId, customerId, type, content.slice(0, 4000), admin?.username || null, dueAt).run();

  // 客户档案的 last_activity_at 用于列表排序（最近有动作的排前面）
  if (customerId) {
    await env.DB.prepare('UPDATE customers SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?').bind(customerId).run();
  }
  // 询盘上同时写一份 next_follow_at，Cron 才能扫出来
  if (inquiryId && dueAt) {
    await env.DB.prepare('UPDATE inquiries SET next_follow_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(dueAt, inquiryId).run();
  }

  return json({ success: true, data: { id: result.meta.last_row_id, due_at: dueAt } }, 201, corsHeaders);
}

async function toggleActivity(request, env, corsHeaders, id) {
  let data = {};
  try { data = await request.json(); } catch { /* 允许空 body，视为标记完成 */ }
  const done = data.done === false ? 0 : 1;
  await env.DB.prepare(
    'UPDATE activities SET done_at = ? WHERE id = ?'
  ).bind(done ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, id).run();
  return json({ success: true, done: !!done }, 200, corsHeaders);
}

/* ---------------- 提醒与概览 ---------------- */

async function reminders(env, url, corsHeaders) {
  const days = Math.min(Number(url.searchParams.get('days')) || 0, 365);
  // 默认给「今天及以前」，Cron 汇总用的是同一段逻辑
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.name, i.email, i.company, i.status, i.priority, i.next_follow_at,
            p.name AS product_name,
            CAST(julianday('now') - julianday(i.next_follow_at) AS INTEGER) AS overdue_days
       FROM inquiries i LEFT JOIN products p ON p.id = i.product_id
      WHERE i.next_follow_at IS NOT NULL
        AND date(i.next_follow_at) <= date('now', ?)
        AND i.status NOT IN ('won', 'lost', 'spam')
      ORDER BY i.next_follow_at ASC
      LIMIT 200`
  ).bind(`+${days} days`).all();
  return json({ success: true, data: results }, 200, corsHeaders);
}

async function overview(env, corsHeaders) {
  const one = async (sql, ...binds) => {
    const row = await env.DB.prepare(sql).bind(...binds).first();
    return row ? Number(Object.values(row)[0] || 0) : 0;
  };

  const byStatus = await env.DB.prepare(
    'SELECT status, COUNT(*) AS n FROM inquiries GROUP BY status'
  ).all();
  const byPriority = await env.DB.prepare(
    "SELECT COALESCE(priority,'warm') AS priority, COUNT(*) AS n FROM inquiries GROUP BY priority"
  ).all();
  const byLevel = await env.DB.prepare(
    'SELECT level, COUNT(*) AS n FROM customers GROUP BY level'
  ).all();

  return json({
    success: true,
    data: {
      inquiries_total: await one('SELECT COUNT(*) FROM inquiries'),
      customers_total: await one('SELECT COUNT(*) FROM customers'),
      open_inquiries: await one("SELECT COUNT(*) FROM inquiries WHERE status NOT IN ('won','lost','spam')"),
      overdue_followups: await one(
        "SELECT COUNT(*) FROM inquiries WHERE next_follow_at IS NOT NULL AND date(next_follow_at) <= date('now') AND status NOT IN ('won','lost','spam')"
      ),
      won_this_month: await one(
        "SELECT COUNT(*) FROM inquiries WHERE status = 'won' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"
      ),
      by_status: byStatus.results || [],
      by_priority: byPriority.results || [],
      by_level: byLevel.results || [],
    },
  }, 200, corsHeaders);
}

/* ---------------- 工具 ---------------- */

/**
 * 统一时间格式：D1 的 DATETIME 比较是字符串比较，
 * 'YYYY-MM-DD HH:MM:SS' 与 'YYYY-MM-DDTHH:MM:SSZ' 混用会导致排序与比较全错。
 * 前端 <input type="date"> 只给 'YYYY-MM-DD'，补成当天 09:00。
 */
export function normalizeDateTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 09:00:00`;
  const d = new Date(s.replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
