/**
 * 认证工具（改造版）
 * 修复原版 4 个问题：
 *  1. SHA-256 无盐口令 -> PBKDF2-SHA256 加盐（兼容旧哈希，便于平滑迁移）
 *  2. "SHA-256(a.b.secret)" 伪 JWT -> 真正的 HMAC-SHA256 JWT（base64url）
 *  3. 硬编码 JWT_SECRET -> 从 env.JWT_SECRET 读取，未配置则拒绝所有后台请求（fail-closed）
 *  4. 校验 alg / exp / 签名常量时间比较
 */

const enc = new TextEncoder();
const PBKDF2_ITER = 150000;

function b64url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 生成 PBKDF2 口令串：pbkdf2$迭代数$盐$哈希 */
export async function hashPassword(password, iterations = PBKDF2_ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(bits)}`;
}

/** 校验口令；同时兼容原版遗留的纯 SHA-256 hex（迁移期用，登录成功后应立即写回 PBKDF2） */
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2$')) {
    const [, iterStr, saltStr, hashStr] = stored.split('$');
    const iterations = Number(iterStr);
    const salt = fromB64url(saltStr);
    const expected = fromB64url(hashStr);
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
    ));
    if (bits.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
    return diff === 0;
  }
  return (await sha256Hex(password)) === stored;
}

export function isLegacyHash(stored) {
  return !!stored && !stored.startsWith('pbkdf2$');
}

/** 签发 HMAC-SHA256 JWT */
export async function signJWT(payload, secret, ttlSeconds = 24 * 60 * 60) {
  if (!secret) throw new Error('JWT_SECRET is not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })));
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(sig)}`;
}

/** 校验 JWT：alg 固定 HS256、校验 exp、签名用 subtle.verify（常量时间） */
export async function verifyJWT(token, secret) {
  if (!token || !secret) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 统一鉴权：原来是 "有 Bearer 头就算管理员"，现在必须真校验签名 + 查库 */
export async function requireAuth(request, env) {
  const secret = env.JWT_SECRET;
  if (!secret) return null; // fail-closed：没配密钥就不放行任何后台接口

  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const payload = await verifyJWT(authHeader.slice(7), secret);
  // 客户会话与管理员会话共用 JWT_SECRET，必须靠 kind 显式拒绝，
  // 否则客户 token 里的 email 会被当成管理员 id 去查 admins 表（虽然查不到，
  // 但依赖"恰好查不到"不是安全设计）。
  if (!payload || !payload.id || payload.kind === 'customer') return null;

  try {
    return await env.DB.prepare(
      'SELECT id, username, email, role FROM admins WHERE id = ?'
    ).bind(payload.id).first();
  } catch {
    return null;
  }
}

export async function requireSuperAdmin(request, env) {
  const admin = await requireAuth(request, env);
  return admin && admin.role === 'super_admin' ? admin : null;
}

// 兼容旧调用名（老代码里叫 generateToken / verifyToken）
export const generateToken = signJWT;
export const verifyToken = verifyJWT;

/* ------------------------------------------------------------------
 * 客户门户会话（阶段三）
 *
 * 与管理员会话共用 HMAC 密钥，但 payload 带 kind:'customer'，
 * 两条鉴权链互相拒绝对方的 token：
 *   - requireAuth 看到 kind:'customer' 直接返回 null
 *   - requireCustomer 只接受 kind:'customer'
 * 这样即使把客户 cookie 拿去调后台接口，也不可能通过。
 * ------------------------------------------------------------------ */

export const CUSTOMER_COOKIE = 'cust_session';

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

/** 客户会话 JWT（默认 7 天） */
export async function signCustomerToken(email, secret, ttlSeconds = 7 * 24 * 60 * 60) {
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return signJWT({ kind: 'customer', email: String(email).toLowerCase() }, secret, ttlSeconds);
}

/** Set-Cookie 值；生产走 https 时加 Secure */
export function customerCookie(token, { maxAge = 7 * 24 * 60 * 60, secure = true } = {}) {
  return `${CUSTOMER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearCustomerCookie() {
  return `${CUSTOMER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** 当前登录的客户（查库拿最新档案；被封禁的账号立即失效） */
export async function requireCustomer(request, env) {
  const secret = env.JWT_SECRET;
  if (!secret) return null;

  let token = '';
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token) token = readCookie(request, CUSTOMER_COOKIE);
  if (!token) return null;

  const payload = await verifyJWT(token, secret);
  if (!payload || payload.kind !== 'customer' || !payload.email) return null;

  try {
    const account = await env.DB.prepare(
      'SELECT * FROM customer_accounts WHERE email = ? AND status = ?'
    ).bind(payload.email, 'active').first();
    return account || null;
  } catch {
    return null;
  }
}
