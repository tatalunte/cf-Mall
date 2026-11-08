/**
 * 后台「翻译引擎」配置的读写与安全边界。
 *
 * 为什么单独一层：
 *  1. GET /api/settings 是**公开**接口（前台页脚/SEO 都在读），一旦把模型密钥塞进去就等于全网泄露。
 *     所以所有 translation_* 键必须从公开响应里剔除，只有超管专用接口能拿到「是否已配置」。
 *  2. 密钥不能明文存 KV。用 AES-GCM 加密，密钥由 JWT_SECRET / TRANSLATION_SECRET_KEY 派生；
 *     密文格式 enc:v1:<iv>.<ciphertext>，解密失败一律当作「未配置」，不抛栈给前端。
 *  3. 自定义 base_url 是典型的 SSRF 入口：管理员填一个内网地址就能让 Worker 去打内部服务。
 *     所以强制 https + 公网域名 + 443，禁止 IP 字面量 / 内网段 / 元数据地址。
 *
 * 纯函数 + WebCrypto，不依赖 Request/Response，可在 Node 单测里直接 import。
 */

export const TRANSLATION_PREFIX = 'translation_';
export const ENGINES = ['workers_ai', 'openai'];
export const DEFAULT_TRANSLATION_CONFIG = {
  engine: 'workers_ai',
  baseUrl: '',
  model: '',
  apiKey: '',
  apiKeySet: false,
  temperature: 0.2,
};

/** 公开 GET /api/settings 必须调用：任何 translation_* 键都不许出现在响应里 */
export function stripTranslationKeys(settings) {
  const out = { ...(settings || {}) };
  for (const key of Object.keys(out)) {
    if (key.startsWith(TRANSLATION_PREFIX)) delete out[key];
  }
  return out;
}

/** 给超管看的配置：永不含明文密钥，只回一个「是否已设置」布尔值 */
export function safeTranslationConfig(cfg) {
  return {
    engine: cfg.engine,
    base_url: cfg.baseUrl,
    model: cfg.model,
    api_key_set: Boolean(cfg.apiKeySet),
    temperature: cfg.temperature,
  };
}

/** 内网 / 元数据 / 本地地址一律拒绝（含 IPv4 私有段与全部 IPv6 字面量） */
export function isForbiddenHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata' || h === 'metadata.google.internal') return true;
  if (h.includes(':')) return true; // IPv6 字面量（含 ::1）全部拒绝
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const p = h.split('.').map(Number);
    if (p.some(n => n > 255)) return true;
    // 所有 IP 字面量都不接受：只让域名走，避免 DNS rebinding 绕开字符串检查
    return true;
  }
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) return true;
  return false;
}

/**
 * 校验并规范化 OpenAI 兼容端点。成功返回不带尾斜杠的 https://host/path，
 * 失败抛 Error（消息可直接给运营看）。
 */
export function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('自定义引擎必须填 API Base URL');
  if (value.length > 300) throw new Error('API Base URL 过长（上限 300 字符）');

  let u;
  try { u = new URL(value); } catch { throw new Error('API Base URL 不是合法 URL'); }
  if (u.protocol !== 'https:') throw new Error('API Base URL 必须是 https（本地模型请套一层 HTTPS 反代）');
  if (u.username || u.password) throw new Error('API Base URL 不允许带账号密码');
  if (u.port && u.port !== '443') throw new Error('API Base URL 只允许 443 端口');
  if (u.search || u.hash) throw new Error('API Base URL 不要带查询参数或锚点');
  if (isForbiddenHost(u.hostname)) throw new Error('API Base URL 必须是公网域名，不能是 IP / 内网 / localhost');

  const path = u.pathname.replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

/** 0 ~ 1 之间的数值，非法值回落 0.2 */
export function normalizeTemperature(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.2;
  return Math.min(1, Math.max(0, n));
}

/** 模型名只要 [A-Za-z0-9._:/-]，防止把 prompt 或整段配置塞进来 */
export function normalizeModelName(value) {
  const name = String(value || '').trim().slice(0, 120);
  if (!/^[A-Za-z0-9._:/-]+$/.test(name)) return '';
  return name;
}

function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(env) {
  const secret = env?.TRANSLATION_SECRET_KEY || env?.JWT_SECRET;
  if (!secret) throw new Error('缺少 JWT_SECRET / TRANSLATION_SECRET_KEY，无法加密保存模型密钥');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|b2b-translation-v1`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** 明文 → 密文（AES-GCM，每次随机 IV） */
export async function sealSecret(plain, env) {
  const key = await deriveKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plain)),
  );
  return `enc:v1:${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}

/** 密文 → 明文；格式不对/密钥变了/被篡改都返回空串，不抛错 */
export async function openSecret(sealed, env) {
  if (typeof sealed !== 'string' || !sealed.startsWith('enc:v1:')) return '';
  try {
    const [ivPart, ctPart] = sealed.slice(7).split('.');
    if (!ivPart || !ctPart) return '';
    const key = await deriveKey(env);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(ivPart) }, key, unb64(ctPart),
    );
    return new TextDecoder().decode(plain);
  } catch { return ''; }
}

/** 读 KV 里的原始 website_settings（容错：脏数据当空对象） */
export async function readSettings(env) {
  try {
    const raw = await env.STATIC_ASSETS.get('website_settings');
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

/**
 * 读取翻译引擎配置。includeSecret=true 时才解密密钥（只有服务端翻译调用会用），
 * 后台 GET 永远不要开这个开关。
 */
export async function loadTranslationConfig(env, { includeSecret = false } = {}) {
  const settings = await readSettings(env);
  const engine = ENGINES.includes(settings.translation_engine) ? settings.translation_engine : 'workers_ai';
  return {
    engine,
    baseUrl: typeof settings.translation_base_url === 'string' ? settings.translation_base_url : '',
    model: typeof settings.translation_model === 'string' ? settings.translation_model : '',
    apiKey: includeSecret ? await openSecret(settings.translation_api_key, env) : '',
    apiKeySet: typeof settings.translation_api_key === 'string' && settings.translation_api_key.startsWith('enc:v1:'),
    temperature: normalizeTemperature(settings.translation_temperature ?? 0.2),
  };
}
