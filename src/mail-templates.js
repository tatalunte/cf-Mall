/**
 * 可编辑邮件模板（阶段二C）
 *
 * 为什么放 KV：外贸业务的话术改起来很频繁（换展会、换促销、加一句「我们支持 OEM」），
 * 为了改一句话就重新部署一次不现实，运营也没 wrangler 权限。
 *
 * 设计：
 *  - 代码里保留一份 DEFAULTS，KV 只存被改过的键；KV 缺失/损坏一律回退默认，永不让发信失败
 *  - 占位符 {{name}} 形式，渲染时默认做 HTML 转义（防有人在模板里插客户可控内容造成注入）
 *  - 以 _raw 结尾的键（如 {{confirm_url_raw}}）不转义，用于插入已构造好的链接
 */

const KEY = 'mail_templates';

export const TEMPLATE_DEFAULTS = {
  inquiry_subject: '[New Inquiry #{{id}}] {{product}} — {{company}}',
  inquiry_intro: 'New inquiry received',
  inquiry_footer: 'Reply directly to this email — reply_to is set to the buyer address. Mark the status in admin: /admin/dashboard',

  auto_reply_subject: 'We have received your inquiry',
  auto_reply_body: 'Dear {{name}},\n\nThank you for your interest in {{product}}. Our sales team will get back to you within 24 hours (business days).\n\nReference: #{{id}}',

  subscribe_confirm_subject: 'Please confirm your subscription',
  subscribe_confirm_body: 'Hi,\n\nPlease confirm you want to receive occasional product updates from us:\n\n{{confirm_url_raw}}\n\nIf you did not request this, ignore this email — you will not be subscribed.',

  subscribe_welcome_subject: 'You are subscribed',
  subscribe_welcome_body: 'Thanks for subscribing. We will only email you when there is something worth reading — new products, price updates, and technical notes. No weekly newsletters.\n\nUnsubscribe anytime: {{unsub_url_raw}}',
};

export const TEMPLATE_META = [
  { key: 'inquiry_subject', label: 'Inquiry notification — subject', placeholders: ['id', 'product', 'company', 'name'] },
  { key: 'inquiry_intro', label: 'Inquiry notification — heading', placeholders: [] },
  { key: 'inquiry_footer', label: 'Inquiry notification — footer note', placeholders: [] },
  { key: 'auto_reply_subject', label: 'Buyer auto-reply — subject', placeholders: ['id', 'name', 'product'] },
  { key: 'auto_reply_body', label: 'Buyer auto-reply — body', placeholders: ['id', 'name', 'product', 'company', 'country'] },
  { key: 'subscribe_confirm_subject', label: 'Subscription — confirm subject', placeholders: [] },
  { key: 'subscribe_confirm_body', label: 'Subscription — confirm body', placeholders: ['confirm_url_raw'] },
  { key: 'subscribe_welcome_subject', label: 'Subscription — welcome subject', placeholders: [] },
  { key: 'subscribe_welcome_body', label: 'Subscription — welcome body', placeholders: ['unsub_url_raw'] },
];

/** 读取模板：KV 覆盖默认值。任何异常都回退默认。 */
export async function getTemplates(env) {
  let overrides = {};
  try {
    const raw = await env.STATIC_ASSETS.get(KEY);
    if (raw) overrides = JSON.parse(raw) || {};
  } catch { overrides = {}; }

  const out = { ...TEMPLATE_DEFAULTS };
  for (const k of Object.keys(TEMPLATE_DEFAULTS)) {
    if (typeof overrides[k] === 'string' && overrides[k].trim()) out[k] = overrides[k];
  }
  return out;
}

export async function saveTemplates(env, data) {
  const clean = {};
  for (const k of Object.keys(TEMPLATE_DEFAULTS)) {
    if (typeof data?.[k] === 'string') clean[k] = data[k].slice(0, 4000);
  }
  await env.STATIC_ASSETS.put(KEY, JSON.stringify(clean));
  return clean;
}

export async function resetTemplates(env) {
  try { await env.STATIC_ASSETS.delete(KEY); } catch { /* 忽略 */ }
  return { ...TEMPLATE_DEFAULTS };
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

/**
 * 占位符替换。未提供的变量替换成空串，避免模板里残留 {{xxx}}。
 * 键名以 _raw 结尾的不转义。
 */
export function renderTemplate(tpl, vars = {}) {
  return String(tpl || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, name) => {
    const key = String(name);
    const value = vars[key];
    if (value == null) return '';
    return key.endsWith('_raw') ? String(value) : esc(value);
  });
}

/** 纯文本模板转 HTML 段落（保留换行语义） */
export function textToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map(para => `<p style="margin:0 0 12px">${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
