/**
 * 管理 API（改造版）
 * 原版第 8 行把 JWT_SECRET 硬编码成 'your-secret-key-change-this-in-production'，
 * 且 README 教用户 `wrangler secret put JWT_SECRET` 却根本没读 env —— 源码公开 => 任何人可伪造管理员 token。
 * 同时 /api/admin/stats 无鉴权。这里全部改成 env.JWT_SECRET + 真 HMAC 校验。
 */
import { verifyPassword, signJWT, verifyJWT, hashPassword, isLegacyHash, requireSuperAdmin } from '../../utils/auth';

// 兼容既有调用方（其它 handler 从这里取鉴权函数）
export { requireAuth, requireSuperAdmin } from '../../utils/auth';

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

export async function handleAdmin(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'POST' && parts[2] === 'login') return adminLogin(request, env, corsHeaders);
  if (method === 'POST' && parts[2] === 'verify') return verifyAdminToken(request, env, corsHeaders);
  if (method === 'POST' && parts[2] === 'logout') return json({ success: true }, 200, corsHeaders);
  if (method === 'GET' && parts[2] === 'stats') return getDashboardStats(request, env, corsHeaders);
  // 阶段二B：登录审计（仅超管）
  if (method === 'GET' && parts[2] === 'login-logs') return loginLogs(request, env, corsHeaders);

  return json({ error: 'Not found' }, 404, corsHeaders);
}

/* ---------------- 阶段二B：登录审计与失败锁定 ---------------- */

const LOCK_WINDOW_MIN = 15;   // 统计窗口
const LOCK_THRESHOLD = 5;     // 窗口内失败次数上限

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
    || null;
}

/**
 * 写登录日志。任何异常都吞掉——日志失败绝不能影响能不能登录。
 * user_agent 截断到 300 字符，避免有人用超长 UA 把表撑爆。
 */
async function recordLogin(env, request, username, ok, reason) {
  try {
    await env.DB.prepare(
      'INSERT INTO login_logs (username, ip, country, user_agent, ok, reason) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      String(username || '').slice(0, 120),
      clientIp(request),
      request.headers.get('CF-IPCountry') || request.cf?.country || null,
      String(request.headers.get('User-Agent') || '').slice(0, 300),
      ok ? 1 : 0,
      reason ? String(reason).slice(0, 120) : null,
    ).run();
  } catch (e) {
    console.error('login log failed', e.message);
  }
}

/**
 * 是否处于锁定状态。
 * 只按「用户名 + 失败次数 + 时间窗」判定，不按 IP：
 * 宿舍/办公室共用出口 IP 很常见，按 IP 锁会把整个团队挡在外面。
 */
async function lockState(env, username) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n, MAX(created_at) AS last
         FROM login_logs
        WHERE username = ? AND ok = 0
          AND created_at > datetime('now', ?)`
    ).bind(String(username), `-${LOCK_WINDOW_MIN} minutes`).first();
    const fails = Number(row?.n || 0);
    const locked = fails >= LOCK_THRESHOLD;
    // 解锁时间 = 最后一次失败 + 窗口
    let retryAfter = 0;
    if (locked && row?.last) {
      const lastMs = Date.parse(String(row.last).replace(' ', 'T') + 'Z');
      retryAfter = Math.max(0, Math.ceil((lastMs + LOCK_WINDOW_MIN * 60000 - Date.now()) / 1000));
    }
    return { locked, fails, retryAfter };
  } catch {
    // 表不存在（未执行 004 迁移）时视为不锁定，保证老部署仍能登录
    return { locked: false, fails: 0, retryAfter: 0 };
  }
}

async function loginLogs(request, env, corsHeaders) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return json({ error: 'Unauthorized. Super admin required.' }, 401, corsHeaders);
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM login_logs ORDER BY created_at DESC LIMIT 100'
    ).all();
    return json({ success: true, data: results }, 200, corsHeaders);
  } catch {
    return json({ success: true, data: [], note: 'login_logs table missing (run migration 004)' }, 200, corsHeaders);
  }
}

async function adminLogin(request, env, corsHeaders) {
  if (!env.JWT_SECRET) {
    return json({ error: 'Server misconfigured: JWT_SECRET missing' }, 500, corsHeaders);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
  const { username, password } = body || {};
  if (!username || !password) return json({ error: 'Username and password are required' }, 400, corsHeaders);

  // 锁定检查放在查库与 PBKDF2 之前：爆破时连哈希成本都不用付
  const lock = await lockState(env, username);
  if (lock.locked) {
    return new Response(JSON.stringify({
      error: `Too many failed attempts. Try again in ${Math.ceil(lock.retryAfter / 60)} minute(s).`,
      retry_after: lock.retryAfter,
    }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(lock.retryAfter) },
    });
  }

  const admin = await env.DB.prepare('SELECT * FROM admins WHERE username = ?').bind(username).first();
  // 统一错误信息 + 恒定耗时，避免用户名枚举：用户不存在时也做一次同等成本的 PBKDF2
  if (!admin) {
    await hashPassword(password);
    await recordLogin(env, request, username, false, 'no such user');
    const after = await lockState(env, username);
    return json({
      error: 'Invalid username or password',
      attempts_left: Math.max(0, LOCK_THRESHOLD - after.fails),
    }, 401, corsHeaders);
  }
  const valid = await verifyPassword(password, admin.password_hash);
  if (!valid) {
    await recordLogin(env, request, username, false, 'bad password');
    const after = await lockState(env, username);
    // 剩余次数提示能给正常用户「我是不是打错了」，对爆破者没有价值
    return json({
      error: 'Invalid username or password',
      attempts_left: Math.max(0, LOCK_THRESHOLD - after.fails),
    }, 401, corsHeaders);
  }

  // 旧版 SHA-256 哈希登录成功后自动升级为 PBKDF2
  if (isLegacyHash(admin.password_hash)) {
    try {
      await env.DB.prepare('UPDATE admins SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(password), admin.id).run();
    } catch { /* 迁移失败不阻断登录 */ }
  }

  await env.DB.prepare('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(admin.id).run();

  // 成功登录也留痕：只有失败日志的话，看不出「谁在什么时候进来过」
  await recordLogin(env, request, admin.username, true, 'ok');

  const token = await signJWT({
    id: admin.id, username: admin.username, role: admin.role,
  }, env.JWT_SECRET, 8 * 60 * 60); // 后台 token 缩短到 8 小时

  return json({
    success: true,
    data: {
      token,
      user: { id: admin.id, username: admin.username, email: admin.email, role: admin.role },
    },
  }, 200, corsHeaders);
}

async function verifyAdminToken(request, env, corsHeaders) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
  const payload = await verifyJWT(body?.token, env.JWT_SECRET);
  if (!payload) return json({ error: 'Invalid or expired token' }, 401, corsHeaders);
  const admin = await env.DB.prepare(
    'SELECT id, username, email, role FROM admins WHERE id = ?'
  ).bind(payload.id).first();
  return admin ? json({ success: true, data: { user: admin } }, 200, corsHeaders)
               : json({ error: 'User not found' }, 404, corsHeaders);
}

async function getDashboardStats(request, env, corsHeaders) {
  const { requireAuth } = await import('../../utils/auth');
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  const [products, inquiries, pending, recent] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS c FROM products WHERE is_active = 1').first(),
    env.DB.prepare('SELECT COUNT(*) AS c FROM inquiries').first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM inquiries WHERE status = 'pending'").first(),
    env.DB.prepare(
      `SELECT i.id, i.name, i.email, i.status, i.created_at, p.name AS product_name
       FROM inquiries i LEFT JOIN products p ON i.product_id = p.id
       ORDER BY i.created_at DESC LIMIT 5`
    ).all(),
  ]);

  return json({
    success: true,
    data: {
      total_products: products?.c || 0,
      total_inquiries: inquiries?.c || 0,
      pending_inquiries: pending?.c || 0,
      recent_inquiries: recent.results || [],
    },
  }, 200, corsHeaders);
}
