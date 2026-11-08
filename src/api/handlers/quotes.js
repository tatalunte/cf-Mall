/**
 * 报价单 API（阶段三）
 *
 * 一张 quotes 表同时服务三类调用方，暴露面完全不同，代码按「后台 / 客户 / 访客」分区：
 *   - 后台（Bearer token）：建单、改单、发信、导出 PDF、删单
 *   - 客户（token 链接）：只能看自己那一张，字段必须白名单裁剪，内部字段绝不外泄
 *   - 访客（无鉴权）：/quote 页提交清单，靠蜜罐 + 频控挡机器人
 *
 * 两个贯穿全文的原则：
 *  1) 金额一律服务端重算（computeTotals）。前端传的 total 只可能是错的或被改过的，
 *     报价单是法律意义上的要约邀请，金额算错比接口报错贵得多。
 *  2) 发信是「附加动作」：Resend 挂掉不能让客户提交失败、也不能让销售发不出单，
 *     所有邮件调用都包 try/catch，只记日志。
 */
// 显式带 .js 扩展名：wrangler 打包不受影响，但 test-artifacts 里的纯函数自测能用原生 ESM 直接 import
import { requireAuth, requireSuperAdmin } from '../../utils/auth.js';
import { escapeHtml } from '../../utils/html.js';
import { PdfDoc, money, pdfDate } from '../../utils/pdf.js';
import { randomToken } from '../../utils/quote-token.js';

// 契约第 3 节：非法币种一律回落 USD，避免出现 "US$" 与 "USD" 混排的单据
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'AED', 'JPY', 'RUB', 'PT', 'BRL'];

// 报价状态；expired 由主控或运营手工置位，不由接口自动推断
const STATUSES = ['draft', 'sent', 'accepted', 'changes_requested', 'rejected', 'expired'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

/* ------------------------------------------------------------------ *
 * 金额计算（纯函数，可单测）
 * ------------------------------------------------------------------ */

/** 四舍五入到分。加 EPSILON 是为了 1.005*100=100.49999999999999 这类二进制误差。 */
export function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 契约第 3 节的金额规则，一处实现、全站复用（新建 / 更新 / 复制 / 公开询价）。
 *
 * 与契约的唯一差异：折扣被夹在 [0, subtotal] 区间。
 * 理由：折扣填超小计时，taxable 会变负数，total 变成负数发票，
 * 客户看到负金额只会认为系统坏了；测试用例也要求 total 不为负。
 */
export function computeTotals(input = {}) {
  const src = input || {};
  const discountType = src.discount_type === 'percent' || src.discount_type === 'amount'
    ? src.discount_type : null;
  const discountValue = Math.max(0, num(src.discount_value));
  const taxRate = Math.max(0, num(src.tax_rate));
  const shipping = Math.max(0, num(src.shipping_amount));
  const rawItems = Array.isArray(src.items) ? src.items : [];

  const normalizedItems = rawItems.map((raw, index) => {
    const it = raw || {};
    const qty = num(it.qty);
    const unitPrice = num(it.unit_price);
    const pid = it.product_id === undefined || it.product_id === null || it.product_id === ''
      ? null : (Number(it.product_id) || null);
    return {
      product_id: pid,
      name: String(it.name == null ? '' : it.name).trim(),
      spec: it.spec == null || String(it.spec).trim() === '' ? null : String(it.spec).trim(),
      qty,
      unit: String(it.unit == null ? '' : it.unit).trim() || 'pcs',
      unit_price: round2(unitPrice),
      amount: round2(qty * unitPrice),
      sort_order: Number.isInteger(it.sort_order) ? it.sort_order : index,
    };
  });

  const subtotal = round2(normalizedItems.reduce((sum, it) => sum + it.amount, 0));
  let discountAmount = 0;
  if (discountType === 'percent') discountAmount = round2((subtotal * discountValue) / 100);
  else if (discountType === 'amount') discountAmount = round2(discountValue);
  discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);

  const taxable = round2(subtotal - discountAmount);
  const taxAmount = round2((taxable * taxRate) / 100);
  const total = round2(taxable + taxAmount + shipping);

  return { subtotal, discount_amount: discountAmount, tax_amount: taxAmount, total, normalizedItems };
}

/* ------------------------------------------------------------------ *
 * 单号
 * ------------------------------------------------------------------ */

/**
 * 单号日期用 UTC，而不是本地时区。
 * D1 的 CURRENT_TIMESTAMP 就是 UTC，若单号按东八区算，
 * 每天 00:00~08:00（UTC+8）生成的单号日期会比 created_at 早一天，对账时很费解。
 */
export function todayStamp(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** QT-YYYYMMDD-0001；序号超过 4 位时不截断（宁可长一位，也不要撞号） */
export function quoteNoFor(stamp, seq) {
  return `QT-${stamp}-${String(Math.max(1, Math.trunc(seq))).padStart(4, '0')}`;
}

/**
 * 取下一个单号。
 * 首选用契约规定的「当天计数 + 1」；重试时改用当天最大序号 + 1。
 *
 * 为什么重试必须换算法：COUNT 只在插入成功后才增加，
 * 一旦当天删过单（0001、0003 存在而 0002 被删），计数永远指向已被占用的 0003，
 * 重试多少次都撞同一条 UNIQUE，接口直接 500。取 MAX 才能保证每次都往前走。
 */
async function nextQuoteNo(env, attempt = 0) {
  const stamp = todayStamp();
  const like = `QT-${stamp}-%`;
  if (attempt === 0) {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM quotes WHERE quote_no LIKE ?'
    ).bind(like).first();
    return quoteNoFor(stamp, num(row && row.count) + 1);
  }
  // substr 从第 13 位开始就是 4 位序号（'QT-' 3 位 + 8 位日期 + '-' 1 位）
  const row = await env.DB.prepare(
    'SELECT MAX(CAST(substr(quote_no, 13) AS INTEGER)) AS maxseq FROM quotes WHERE quote_no LIKE ?'
  ).bind(like).first();
  return quoteNoFor(stamp, num(row && row.maxseq) + 1);
}

/* ------------------------------------------------------------------ *
 * 入参整理与校验
 * ------------------------------------------------------------------ */

function strOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function intOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function sanitizeCurrency(value) {
  const c = String(value == null ? '' : value).trim().toUpperCase();
  return CURRENCIES.includes(c) ? c : 'USD';
}

/** 只保留 YYYY-MM-DD：前端有时传 ISO 带 T/Z，混进 DATE 列会让同库排序错乱 */
function dateOnly(value) {
  const s = strOrNull(value);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function normEmail(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return s.length <= 254 ? s : '';
}

/** 逐行校验，错误信息带下标，运营能直接定位到第几行 */
function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'items must contain at least one row';
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    if (!String(it.name == null ? '' : it.name).trim()) return `items[${i}].name is required`;
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) return `items[${i}].qty must be > 0`;
    const price = Number(it.unit_price);
    if (!Number.isFinite(price) || price < 0) return `items[${i}].unit_price must be >= 0`;
  }
  return null;
}

/**
 * 把 body 与已有记录合并成完整表头。
 * 局部更新必须走合并：后台表单可能只提交改动的字段，
 * 直接按 HEAD_FIELDS 全量 SET 会把没传的字段清成 NULL（产品接口踩过这个坑）。
 */
function buildHead(data, base = {}) {
  const src = data || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
  const pick = (k) => (has(k) ? src[k] : base[k]);

  const discountTypeRaw = pick('discount_type');
  const discountType = discountTypeRaw === 'percent' || discountTypeRaw === 'amount' ? discountTypeRaw : null;

  return {
    inquiry_id: intOrNull(pick('inquiry_id')),
    customer_id: intOrNull(pick('customer_id')),
    customer_email: normEmail(pick('customer_email')),
    customer_name: strOrNull(pick('customer_name')),
    customer_company: strOrNull(pick('customer_company')),
    customer_country: strOrNull(pick('customer_country')),
    currency: sanitizeCurrency(pick('currency')),
    incoterm: strOrNull(pick('incoterm')),
    payment_terms: strOrNull(pick('payment_terms')),
    valid_until: dateOnly(pick('valid_until')),
    discount_type: discountType,
    discount_value: Math.max(0, num(pick('discount_value'))),
    tax_rate: Math.max(0, num(pick('tax_rate'))),
    shipping_amount: Math.max(0, num(pick('shipping_amount'))),
    notes: strOrNull(pick('notes')),
    terms: strOrNull(pick('terms')),
  };
}

function totalsFor(head, items) {
  return computeTotals({
    items,
    discount_type: head.discount_type,
    discount_value: head.discount_value,
    tax_rate: head.tax_rate,
    shipping_amount: head.shipping_amount,
  });
}

/** 响应里的金额字段（去掉 normalizedItems，避免把整张表回传给前端） */
function totalsOut(totals, extra) {
  return {
    subtotal: totals.subtotal,
    discount_amount: totals.discount_amount,
    tax_amount: totals.tax_amount,
    total: totals.total,
    // 后台编辑器保存后要立即重渲染行项目，返回摘要时一并带上，
    // 省掉一次 GET 往返（也让"保存后的值以服务端为准"这条规则更好落地）。
    ...(extra || {}),
  };
}

/* ------------------------------------------------------------------ *
 * DB 辅助
 * ------------------------------------------------------------------ */

/**
 * 迁移没跑时 D1 抛的是 "no such table: quotes"。
 * 如果直接冒泡，Worker 会返回一个没有 CORS 头的 500，前端只看到 "Failed to fetch"，
 * 排查方向完全跑偏；这里统一转成人能读懂的 JSON。
 */
function dbError(error, corsHeaders, label) {
  const msg = String((error && error.message) || error);
  console.error(`[quotes] ${label} failed:`, msg);
  if (msg.includes('no such table')) {
    return json({
      error: 'Quotations are not available yet (database table missing — apply schema/migrations/006-trade.sql)',
    }, 500, corsHeaders);
  }
  return json({ error: 'Database error', detail: msg.slice(0, 200) }, 500, corsHeaders);
}

function itemInsertStmt(env, quoteId, item, index) {
  return env.DB.prepare(
    `INSERT INTO quote_items (quote_id, product_id, name, spec, qty, unit, unit_price, amount, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(quoteId, item.product_id, item.name, item.spec, item.qty, item.unit,
         item.unit_price, item.amount, Number.isInteger(item.sort_order) ? item.sort_order : index);
}

/** D1 的 batch 是一个事务，删除 + 重建行不会出现「只剩一半行」的中间态 */
async function replaceItems(env, quoteId, items) {
  const stmts = [env.DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(quoteId)];
  items.forEach((it, i) => stmts.push(itemInsertStmt(env, quoteId, it, i)));
  await env.DB.batch(stmts);
}

const QUOTE_INSERT_COLS = ['quote_no', 'inquiry_id', 'customer_id', 'customer_email',
  'customer_name', 'customer_company', 'customer_country', 'currency', 'incoterm',
  'payment_terms', 'valid_until', 'subtotal', 'discount_type', 'discount_value',
  'discount_amount', 'tax_rate', 'tax_amount', 'shipping_amount', 'total',
  'notes', 'terms', 'status', 'created_by'];

/**
 * 插入报价单，撞号重试。
 *
 * 为什么需要重试：序号来自 COUNT(*)，两个后台请求同时到会拿到同一个号码，
 * 后插入的那个触发 UNIQUE(quote_no)。重试时重新 COUNT 一次——此时前一条已入库，
 * 计数已经 +1，第二、第三次必然拿到新号。3 次是经验值：
 * 真实并发下连续撞 3 次说明有人在刷接口，直接报错比无限重试更安全。
 */
async function insertQuote(env, head, items, { status = 'draft', createdBy = null } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const quoteNo = await nextQuoteNo(env, attempt);
    const totals = totalsFor(head, items);
    const binds = [
      quoteNo, head.inquiry_id, head.customer_id, head.customer_email, head.customer_name,
      head.customer_company, head.customer_country, head.currency, head.incoterm,
      head.payment_terms, head.valid_until, totals.subtotal, head.discount_type,
      head.discount_value, totals.discount_amount, head.tax_rate, totals.tax_amount,
      head.shipping_amount, totals.total, head.notes, head.terms, status, createdBy,
    ];
    let created = null;
    try {
      const result = await env.DB.prepare(
        `INSERT INTO quotes (${QUOTE_INSERT_COLS.join(', ')})
         VALUES (${QUOTE_INSERT_COLS.map(() => '?').join(', ')})`
      ).bind(...binds).run();
      created = { id: result.meta.last_row_id, quote_no: quoteNo, totals };
    } catch (e) {
      if (!/UNIQUE/i.test(String((e && e.message) || e))) throw e;
      lastError = e;
      continue;
    }
    // 单号已占住，再写行；行写失败要把头一起撤掉，否则留下一张空单
    try {
      if (totals.normalizedItems.length) {
        await replaceItems(env, created.id, totals.normalizedItems);
      }
    } catch (e) {
      try { await env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(created.id).run(); } catch { /* 尽力而为 */ }
      throw e;
    }
    return created;
  }
  throw lastError || new Error('Could not allocate a unique quote number');
}

async function getQuoteRow(env, id) {
  return env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first();
}

async function getQuoteItems(env, quoteId, publicShape = false) {
  const cols = publicShape
    ? 'name, spec, qty, unit, unit_price, amount'
    : 'id, product_id, name, spec, qty, unit, unit_price, amount, sort_order';
  const { results } = await env.DB.prepare(
    `SELECT ${cols} FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC, id ASC`
  ).bind(quoteId).all();
  return results || [];
}

async function getQuoteByToken(env, token) {
  if (!token) return null;
  return env.DB.prepare('SELECT * FROM quotes WHERE token = ? LIMIT 1').bind(token).first();
}

/* ------------------------------------------------------------------ *
 * 站点信息 / 邮件
 * ------------------------------------------------------------------ */

async function readSettings(env) {
  try {
    if (!env.STATIC_ASSETS) return {};
    const raw = await env.STATIC_ASSETS.get('website_settings');
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // 抬头读不到就留空，不能因为 KV 抖动导致单据导不出
  }
}

function siteBase(env, request) {
  const configured = env.SITE_URL;
  if (configured && !String(configured).startsWith('REPLACE_')) {
    return String(configured).replace(/\/$/, '');
  }
  return new URL(request.url).origin;
}

/**
 * 本地薄封装（mailer.js 只导出 handleMailQueue/retryFailedMails，没有可直接调用的 sendMail）。
 * 与 subscribe.js 里的实现保持一致：没配 RESEND_API_KEY 就跳过而不是抛错。
 */
async function sendMail(env, { to, subject, html, replyTo }) {
  const targets = String(to || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!targets.length || !env.RESEND_API_KEY) return { skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'B2B Sales <notify@example.com>',
      to: targets,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${text.slice(0, 200)}`);
  }
  return { sent: true };
}

function fmtMoney(amount, currency) {
  return `${currency || 'USD'} ${Number(num(amount)).toFixed(2)}`;
}

function mailRow(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<tr><th style="text-align:left;padding:6px 12px;color:#6b7280;font-weight:600">${escapeHtml(label)}</th>`
    + `<td style="padding:6px 12px;color:#111827">${escapeHtml(value)}</td></tr>`;
}

/** 报价邮件正文：模板集中在 mail-templates.js，但那里是多代理共改区，这里内联更安全 */
function quoteMailHtml({ quote, settings, link }) {
  const cur = quote.currency || 'USD';
  const rows = [
    mailRow('Quotation No.', quote.quote_no),
    mailRow('Customer', quote.customer_name),
    mailRow('Company', quote.customer_company),
    mailRow('Email', quote.customer_email),
    mailRow('Total', fmtMoney(quote.total, cur)),
    mailRow('Valid until', quote.valid_until),
    mailRow('Incoterm', quote.incoterm),
    mailRow('Payment terms', quote.payment_terms),
  ].join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#111827">
    <h2 style="color:#1d4ed8;margin:0 0 12px">Quotation ${escapeHtml(quote.quote_no || '')}</h2>
    <p style="margin:0 0 16px">Dear ${escapeHtml(quote.customer_name || 'Sir/Madam')},</p>
    <p style="margin:0 0 16px">Please find our quotation below. The full document is available online through the link at the bottom of this email.</p>
    <table style="border-collapse:collapse;background:#f9fafb;border-radius:6px">${rows}</table>
    <p style="margin:20px 0 8px">
      <a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none">View quotation</a>
    </p>
    <p style="font-size:12px;color:#6b7280;word-break:break-all">${escapeHtml(link)}</p>
    <p style="margin-top:24px;font-size:13px;color:#6b7280">
      ${escapeHtml(settings.site_name || '')}${settings.email ? ' · ' + escapeHtml(settings.email) : ''}
    </p>
  </div>`;
}

function requestMailHtml({ quote, settings, lines, message, link }) {
  const cur = (quote && quote.currency) || 'USD';
  const rows = [
    mailRow('Quotation No.', quote && quote.quote_no),
    mailRow('Customer', quote && quote.customer_name),
    mailRow('Company', quote && quote.customer_company),
    mailRow('Email', quote && quote.customer_email),
    mailRow('Country', quote && quote.customer_country),
    mailRow('Estimated total', fmtMoney(quote && quote.total, cur)),
    mailRow('Valid until', quote && quote.valid_until),
    mailRow('Line items', lines.length ? String(lines.length) : '0'),
  ].join('');
  const list = lines.length
    ? `<ol style="padding-left:20px;margin:12px 0">${lines.map(l =>
        `<li>${escapeHtml(l.name)}${l.spec ? ' — ' + escapeHtml(l.spec) : ''} · ${escapeHtml(String(l.qty))} ${escapeHtml(l.unit)}</li>`
      ).join('')}</ol>`
    : '<p style="color:#6b7280">No item list submitted.</p>';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#111827">
    <h2 style="color:#1d4ed8;margin:0 0 12px">New quote request</h2>
    <table style="border-collapse:collapse;background:#f9fafb;border-radius:6px">${rows}</table>
    <h3 style="margin:20px 0 4px;font-size:15px">Requested items</h3>${list}
    ${message ? `<h3 style="margin:20px 0 4px;font-size:15px">Customer message</h3>
      <p style="white-space:pre-wrap;background:#f9fafb;padding:14px;border-radius:6px">${escapeHtml(message)}</p>` : ''}
    ${link ? `<p style="margin:20px 0 6px"><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : ''}
    <p style="margin-top:24px;font-size:13px;color:#6b7280">${escapeHtml(settings.site_name || '')}</p>
  </div>`;
}

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

export async function handleQuotes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean); // ['api','quotes', ...]
  const tail = parts[2] || '';
  const sub = parts[3] || '';
  const isId = /^\d+$/.test(tail);

  /* 公开接口必须先于 :id 判断。
   * 顺序反了的话 /api/quotes/view 会命中「GET 三段」分支被当成 id 查询，
   * 客户点开邮件链接只会看到 404，而且这种错在联调时极难和前端拼错 path 区分开。 */
  if (parts.length === 3 && method === 'GET' && tail === 'view') return publicView(request, env, corsHeaders, url);
  if (parts.length === 3 && method === 'POST' && tail === 'respond') return publicRespond(request, env, corsHeaders);
  if (parts.length === 3 && method === 'POST' && tail === 'request') return publicRequest(request, env, corsHeaders);

  // 以下全部需要登录
  if (parts.length === 2 && method === 'GET') return listQuotes(request, env, corsHeaders, url);
  if (parts.length === 2 && method === 'POST') return createQuote(request, env, corsHeaders);
  if (parts.length === 3 && isId && method === 'GET') return getQuote(request, env, corsHeaders, tail);
  if (parts.length === 3 && isId && method === 'PUT') return updateQuote(request, env, corsHeaders, tail);
  if (parts.length === 3 && isId && method === 'DELETE') return deleteQuote(request, env, corsHeaders, tail);
  if (parts.length === 4 && isId && sub === 'send' && method === 'POST') return sendQuote(request, env, corsHeaders, tail);
  if (parts.length === 4 && isId && sub === 'duplicate' && method === 'POST') return duplicateQuote(request, env, corsHeaders, tail);
  if (parts.length === 4 && isId && sub === 'pdf' && method === 'GET') return quotePdf(request, env, corsHeaders, tail);

  return json({ error: 'Not found' }, 404, corsHeaders);
}

/* ------------------------------------------------------------------ *
 * 后台
 * ------------------------------------------------------------------ */

async function listQuotes(request, env, corsHeaders, url) {
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  const status = url.searchParams.get('status');
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  const where = [];
  const binds = [];
  if (status && STATUSES.includes(status)) { where.push('status = ?'); binds.push(status); }
  if (q) {
    // LIKE 通配符来自用户输入，必须参数化；escape 不做，因为 % 号本身也算合法的模糊搜索
    where.push('(quote_no LIKE ? OR customer_email LIKE ? OR customer_company LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS count FROM quotes ${clause}`)
      .bind(...binds).first();
    const { results } = await env.DB.prepare(
      `SELECT * FROM quotes ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();
    return json({
      success: true,
      data: results || [],
      total: num(totalRow && totalRow.count),
      limit,
      offset,
    }, 200, corsHeaders);
  } catch (e) {
    return dbError(e, corsHeaders, 'list');
  }
}

async function getQuote(request, env, corsHeaders, id) {
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);
  try {
    const quote = await getQuoteRow(env, id);
    if (!quote) return json({ error: 'Quote not found' }, 404, corsHeaders);
    const items = await getQuoteItems(env, quote.id);
    return json({ success: true, data: { ...quote, items } }, 200, corsHeaders);
  } catch (e) {
    return dbError(e, corsHeaders, 'detail');
  }
}

async function createQuote(request, env, corsHeaders) {
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const head = buildHead(data);
  if (!head.customer_email) return json({ error: 'customer_email is required' }, 400, corsHeaders);
  if (!EMAIL_RE.test(head.customer_email)) return json({ error: 'customer_email is invalid' }, 400, corsHeaders);

  const items = Array.isArray(data.items) ? data.items.map((it, i) => ({ ...(it || {}), sort_order: i })) : [];
  const itemError = validateItems(items);
  if (itemError) return json({ error: itemError }, 400, corsHeaders);

  try {
    const created = await insertQuote(env, head, items, {
      status: 'draft',
      createdBy: admin.username || null,
    });
    return json({
      success: true,
      data: {
        id: created.id, quote_no: created.quote_no, status: 'draft',
        ...totalsOut(created.totals, { items: created.totals.normalizedItems }),
      },
    }, 201, corsHeaders);
  } catch (e) {
    return dbError(e, corsHeaders, 'create');
  }
}

async function updateQuote(request, env, corsHeaders, id) {
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  let current;
  try {
    current = await getQuoteRow(env, id);
  } catch (e) {
    return dbError(e, corsHeaders, 'update-read');
  }
  if (!current) return json({ error: 'Quote not found' }, 404, corsHeaders);

  const head = buildHead(data, current);
  if (!head.customer_email) return json({ error: 'customer_email is required' }, 400, corsHeaders);
  if (!EMAIL_RE.test(head.customer_email)) return json({ error: 'customer_email is invalid' }, 400, corsHeaders);

  const itemsProvided = Array.isArray(data.items);
  let items;
  if (itemsProvided) {
    const itemError = validateItems(data.items);
    if (itemError) return json({ error: itemError }, 400, corsHeaders);
    items = data.items.map((it, i) => ({ ...(it || {}), sort_order: i }));
  } else {
    // 没传 items 时用库里现有行重算，保证改了折扣/运费后 total 仍然自洽
    try {
      items = await getQuoteItems(env, current.id);
    } catch (e) {
      return dbError(e, corsHeaders, 'update-items');
    }
  }

  const totals = totalsFor(head, items);
  const sets = [
    'inquiry_id = ?', 'customer_id = ?', 'customer_email = ?', 'customer_name = ?',
    'customer_company = ?', 'customer_country = ?', 'currency = ?', 'incoterm = ?',
    'payment_terms = ?', 'valid_until = ?', 'subtotal = ?', 'discount_type = ?',
    'discount_value = ?', 'discount_amount = ?', 'tax_rate = ?', 'tax_amount = ?',
    'shipping_amount = ?', 'total = ?', 'notes = ?', 'terms = ?',
  ];
  const binds = [
    head.inquiry_id, head.customer_id, head.customer_email, head.customer_name,
    head.customer_company, head.customer_country, head.currency, head.incoterm,
    head.payment_terms, head.valid_until, totals.subtotal, head.discount_type,
    head.discount_value, totals.discount_amount, head.tax_rate, totals.tax_amount,
    head.shipping_amount, totals.total, head.notes, head.terms,
  ];
  // 状态只接受白名单值：非法字符串会让后台筛选和客户页判断全部失效
  if (Object.prototype.hasOwnProperty.call(data, 'status') && STATUSES.includes(data.status)) {
    sets.push('status = ?');
    binds.push(data.status);
  }

  try {
    await env.DB.prepare(
      `UPDATE quotes SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(...binds, current.id).run();
    if (itemsProvided) await replaceItems(env, current.id, totals.normalizedItems);
    return json({
      success: true,
      data: {
        id: current.id, quote_no: current.quote_no, status: current.status,
        ...totalsOut(totals, { items: totals.normalizedItems }),
      },
    }, 200, corsHeaders);
  } catch (e) {
    return dbError(e, corsHeaders, 'update');
  }
}

async function deleteQuote(request, env, corsHeaders, id) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return json({ error: 'Unauthorized. Super admin required.' }, 401, corsHeaders);

  try {
    const quote = await getQuoteRow(env, id);
    if (!quote) return json({ error: 'Quote not found' }, 404, corsHeaders);

    // 已转订单的报价单是订单的金额来源，删掉会让订单详情查不到出处，直接拒绝
    const order = await env.DB.prepare('SELECT id, order_no FROM orders WHERE quote_id = ? LIMIT 1')
      .bind(quote.id).first();
    if (order) {
      return json({
        error: 'This quotation has already been converted to an order and cannot be deleted',
        order_no: order.order_no,
      }, 409, corsHeaders);
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(quote.id),
      env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(quote.id),
    ]);
    return json({ success: true }, 200, corsHeaders);
  } catch (e) {
    return dbError(e, corsHeaders, 'delete');
  }
}

async function sendQuote(request, env, corsHeaders, id) {
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  let quote;
  try {
    quote = await getQuoteRow(env, id);
  } catch (e) {
    return dbError(e, corsHeaders, 'send-read');
  }
  if (!quote) return json({ error: 'Quote not found' }, 404, corsHeaders);
  if (!quote.customer_email) return json({ error: 'customer_email is required before sending' }, 400, corsHeaders);

  /* 已经发过的单子复用旧链接：客户可能已经在邮件里点了收藏或转发给同事，
   * 重新发送就换地址会让这些链接全部失效。草稿阶段没有对外发过链接，可以重新生成。 */
  const token = (!quote.token || quote.status === 'draft') ? randomToken(32) : quote.token;

  try {
    await env.DB.prepare(
      `UPDATE quotes SET token = ?, status = 'sent', sent_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(token, quote.id).run();
  } catch (e) {
    return dbError(e, corsHeaders, 'send-write');
  }

  const site = siteBase(env, request);
  const link = `${site}/quote/${token}`;
  const settings = await readSettings(env);

  // 发信失败只记日志：状态已经置为 sent，链接已在返回值里，销售可以手工转发
  try {
    await sendMail(env, {
      to: quote.customer_email,
      subject: `Quotation ${quote.quote_no} from ${settings.site_name || 'our sales team'}`,
      html: quoteMailHtml({ quote: { ...quote, token }, settings, link }),
      replyTo: env.MAIL_TO ? String(env.MAIL_TO).split(',')[0].trim() : undefined,
    });
  } catch (e) {
    console.error('[quotes] send mail failed', String(e && e.message || e));
  }

  return json({ success: true, data: { token, url: link } }, 200, corsHeaders);
}

async function duplicateQuote(request, env, corsHeaders, id) {
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  try {
    const quote = await getQuoteRow(env, id);
    if (!quote) return json({ error: 'Quote not found' }, 404, corsHeaders);
    const items = await getQuoteItems(env, quote.id);

    // 复制必须是干净的新草案：token / 发送与响应时间都要清掉，
    // 否则两张单会共用一条客户链接，客户点开看到的是另一张。
    const head = buildHead(quote);
    const created = await insertQuote(env, head, items, {
      status: 'draft',
      createdBy: admin.username || null,
    });
    return json({
      success: true,
      data: {
        id: created.id, quote_no: created.quote_no, status: 'draft',
        ...totalsOut(created.totals, { items: created.totals.normalizedItems }),
      },
    }, 201, corsHeaders);
  } catch (e) {
    return dbError(e, corsHeaders, 'duplicate');
  }
}

async function quotePdf(request, env, corsHeaders, id) {
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  let quote;
  let items;
  try {
    quote = await getQuoteRow(env, id);
    if (!quote) return json({ error: 'Quote not found' }, 404, corsHeaders);
    items = await getQuoteItems(env, quote.id);
  } catch (e) {
    return dbError(e, corsHeaders, 'pdf');
  }

  const settings = await readSettings(env);
  const cur = quote.currency || 'USD';
  const doc = new PdfDoc({ title: 'QUOTATION ' + (quote.quote_no || ''), footerText: 'Page {page} of {total}' });

  doc.heading('QUOTATION');
  if (settings.site_name) doc.text(String(settings.site_name), { size: 10, color: [0.32, 0.37, 0.45] });
  if (settings.address) doc.text(String(settings.address), { size: 9, color: [0.42, 0.47, 0.55] });
  const contact = [settings.email, settings.phone, settings.whatsapp].filter(Boolean).join('  |  ');
  if (contact) doc.text(contact, { size: 9, color: [0.42, 0.47, 0.55] });

  doc.spacer(6);
  doc.rule();
  doc.fields([
    ['Quote No.', quote.quote_no],
    ['Date', pdfDate(quote.created_at)],
    ['Valid until', pdfDate(quote.valid_until)],
    ['Currency', cur],
    ['Incoterm', quote.incoterm],
  ]);

  doc.spacer(6);
  doc.text('Bill to', { bold: true, size: 10 });
  doc.fields([
    ['Customer', quote.customer_name],
    ['Company', quote.customer_company],
    ['Email', quote.customer_email],
    ['Country', quote.customer_country],
  ]);

  doc.spacer(8);
  doc.table({
    columns: [
      { label: 'Item', width: 210 },
      { label: 'Spec', width: 120 },
      { label: 'Qty', width: 50, align: 'right' },
      { label: 'Unit', width: 50, align: 'right' },
      { label: 'Unit price', width: 70, align: 'right' },
      { label: 'Amount', width: 75, align: 'right' },
    ],
    rows: items.map(it => [
      it.name,
      it.spec || '',
      String(it.qty == null ? '' : it.qty),
      it.unit || '',
      money(it.unit_price, cur).replace(cur + ' ', ''),
      money(it.amount, cur).replace(cur + ' ', ''),
    ]),
  });

  // 合计区逐行右对齐；TOTAL 用 doc.total 自带分隔线和大号字，便于客户一眼看到
  doc.spacer(4);
  doc.text('Subtotal  ' + money(quote.subtotal, cur), { size: 9.5, align: 'right' });
  if (num(quote.discount_amount) > 0) {
    const label = quote.discount_type === 'percent'
      ? `Discount (${num(quote.discount_value)}%)`
      : 'Discount';
    doc.text(label + '  -' + money(quote.discount_amount, cur), { size: 9.5, align: 'right' });
  }
  if (num(quote.tax_amount) > 0) {
    doc.text(`Tax (${num(quote.tax_rate)}%)  ` + money(quote.tax_amount, cur), { size: 9.5, align: 'right' });
  }
  if (num(quote.shipping_amount) > 0) {
    doc.text('Shipping  ' + money(quote.shipping_amount, cur), { size: 9.5, align: 'right' });
  }
  doc.total('TOTAL  ' + money(quote.total, cur));

  doc.spacer(10);
  if (quote.payment_terms) doc.paragraph('Payment terms: ' + quote.payment_terms, { size: 8.5 });
  if (quote.terms) doc.paragraph('Terms and conditions: ' + quote.terms, { size: 8.5 });
  if (quote.notes) doc.paragraph('Notes: ' + quote.notes, { size: 8.5 });

  const bytes = doc.build();
  return new Response(bytes, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/pdf',
      // 用字符串拼接而不是嵌套模板字符串：filename 里本身有双引号，嵌套时极易写出无法解析的引号
      'Content-Disposition': 'attachment; filename="' + (quote.quote_no || 'quotation') + '.pdf"',
      'Cache-Control': 'private, no-store',
    },
  });
}

/* ------------------------------------------------------------------ *
 * 客户（token）
 * ------------------------------------------------------------------ */

/**
 * 公开详情。
 * 逐字段白名单构造响应对象，而不是对 SELECT * 的结果 delete 几个键：
 * 以后表加字段（比如内部备注、成本价）时，白名单默认不泄漏，
 * delete 式裁剪默认泄漏——安全默认值必须选前者。
 */
async function publicView(request, env, corsHeaders, url) {
  const token = (url.searchParams.get('token') || '').trim();
  if (!token) return json({ error: 'Quote not found or link expired' }, 404, corsHeaders);

  let quote;
  let items;
  try {
    quote = await getQuoteByToken(env, token);
    if (!quote || quote.status === 'draft' || quote.status === 'expired') {
      return json({ error: 'Quote not found or link expired' }, 404, corsHeaders);
    }
    items = await getQuoteItems(env, quote.id, true);
  } catch (e) {
    return dbError(e, corsHeaders, 'public-view');
  }

  const settings = await readSettings(env);
  const data = {
    quote_no: quote.quote_no,
    status: quote.status,
    currency: quote.currency,
    incoterm: quote.incoterm,
    payment_terms: quote.payment_terms,
    valid_until: quote.valid_until,
    subtotal: quote.subtotal,
    discount_amount: quote.discount_amount,
    tax_amount: quote.tax_amount,
    shipping_amount: quote.shipping_amount,
    total: quote.total,
    notes: quote.notes,
    terms: quote.terms,
    customer_name: quote.customer_name,
    customer_company: quote.customer_company,
    // 邮箱是客户自己提交的，脱敏反而让客户认不出这是不是给自己的单
    customer_email: quote.customer_email,
    sent_at: quote.sent_at,
    accepted_at: quote.accepted_at,
    items: items.map(it => ({
      name: it.name,
      spec: it.spec,
      qty: it.qty,
      unit: it.unit,
      unit_price: it.unit_price,
      amount: it.amount,
    })),
    company: {
      site_name: settings.site_name || '',
      email: settings.email || '',
      phone: settings.phone || '',
      address: settings.address || '',
      whatsapp: settings.whatsapp || '',
    },
  };
  return json({ success: true, data }, 200, corsHeaders);
}

const RESPOND_MAP = {
  accept: { status: 'accepted', label: 'accepted' },
  changes: { status: 'changes_requested', label: 'requested changes to' },
  reject: { status: 'rejected', label: 'declined' },
};

async function publicRespond(request, env, corsHeaders) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const token = String(data.token || '').trim();
  const action = String(data.action || '').trim();
  if (!token) return json({ error: 'token is required' }, 400, corsHeaders);
  if (!RESPOND_MAP[action]) {
    return json({ error: "action must be 'accept', 'changes' or 'reject'" }, 400, corsHeaders);
  }
  const message = String(data.message == null ? '' : data.message).slice(0, 2000);

  let quote;
  try {
    quote = await getQuoteByToken(env, token);
  } catch (e) {
    return dbError(e, corsHeaders, 'respond-read');
  }
  if (!quote) return json({ error: 'Quote not found or link expired' }, 404, corsHeaders);

  const next = RESPOND_MAP[action];
  let changed = 0;
  try {
    /* 条件更新（WHERE status='sent'）是关键：
     * 客户手抖点两次 Accept、或邮件客户端预取了链接，两次请求都会到。
     * 先查后写会让两个请求都通过检查，最后 accepted_at 被覆盖成第二次的时间；
     * 用 meta.changes 判断，只有真正从 sent 流转的那一次算成功，另一次返回 409。 */
    const result = await env.DB.prepare(
      `UPDATE quotes SET status = ?, responded_at = CURRENT_TIMESTAMP,
         accepted_at = CASE WHEN ? = 'accepted' THEN CURRENT_TIMESTAMP ELSE accepted_at END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'sent'`
    ).bind(next.status, next.status, quote.id).run();
    changed = num(result && result.meta && result.meta.changes);
  } catch (e) {
    return dbError(e, corsHeaders, 'respond-write');
  }
  if (!changed) {
    return json({ error: 'This quotation has already been responded to' }, 409, corsHeaders);
  }

  // activities 是销售侧的跟进时间线；写失败不影响客户看到的「已提交成功」
  try {
    const content = `Quote ${quote.quote_no} ${next.label} by ${quote.customer_email}`
      + (message ? `: ${message}` : '');
    await env.DB.prepare(
      `INSERT INTO activities (inquiry_id, customer_id, type, content, admin_user)
       VALUES (?, ?, ?, ?, NULL)`
    ).bind(quote.inquiry_id || null, quote.customer_id || null, `quote_${action}`, content).run();
  } catch (e) {
    console.error('[quotes] activity write failed', String(e && e.message || e));
  }

  const settings = await readSettings(env);
  try {
    await sendMail(env, {
      to: env.MAIL_TO,
      subject: `Quotation ${quote.quote_no}: customer ${next.label}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px">
        <h2 style="color:#1d4ed8;margin:0 0 12px">Quotation ${escapeHtml(quote.quote_no || '')}</h2>
        <table style="border-collapse:collapse;background:#f9fafb">${[
          mailRow('Customer', quote.customer_name),
          mailRow('Company', quote.customer_company),
          mailRow('Email', quote.customer_email),
          mailRow('Action', next.label),
          mailRow('Total', fmtMoney(quote.total, quote.currency)),
        ].join('')}</table>
        ${message ? `<p style="white-space:pre-wrap;background:#f9fafb;padding:14px;border-radius:6px">${escapeHtml(message)}</p>` : ''}
        <p style="margin-top:20px;font-size:13px;color:#6b7280">${escapeHtml(settings.site_name || '')}</p>
      </div>`,
      replyTo: quote.customer_email || undefined,
    });
  } catch (e) {
    console.error('[quotes] respond mail failed', String(e && e.message || e));
  }

  return json({ success: true, data: { status: next.status } }, 200, corsHeaders);
}

/* ------------------------------------------------------------------ *
 * 访客（/quote 页提交清单）
 * ------------------------------------------------------------------ */

async function publicRequest(request, env, corsHeaders) {
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  /* 蜜罐：company_url 在页面上是视觉隐藏的，真人填不到。
   * 命中时返回 success 而不落库——告诉机器人「规则已被识别」等于教它换字段名。 */
  if (String(data.company_url == null ? '' : data.company_url).trim()) {
    return json({ success: true }, 200, corsHeaders);
  }

  const email = normEmail(data.email);
  if (!email || !EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 400, corsHeaders);
  const name = strOrNull(data.name) || email.split('@')[0];
  const customerMessage = String(data.message == null ? '' : data.message).slice(0, 5000);

  // 频控：同邮箱 10 分钟最多 3 次。查 inquiries 而不是另建表，少一张表和一次清理任务。
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM inquiries
       WHERE email = ? AND created_at > datetime('now', '-10 minutes')`
    ).bind(email).first();
    if (num(row && row.count) >= 3) {
      return json({ error: 'Too many requests, please try again later' }, 429, corsHeaders);
    }
  } catch (e) {
    // 频控查询本身失败时放行：宁可偶尔收到一条垃圾询价，也不让真实客户提交不了
    console.error('[quotes] rate limit check failed', String(e && e.message || e));
  }

  // 行项目宽松清洗：这是公开接口，任何字段都可能是任意类型，先归一化再进库
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const lines = [];
  for (const raw of rawItems) {
    const it = raw || {};
    const itemName = strOrNull(it.name);
    if (!itemName) continue;
    const qty = num(it.qty);
    lines.push({
      product_id: intOrNull(it.product_id),
      name: itemName.slice(0, 200),
      spec: strOrNull(it.spec) ? String(it.spec).trim().slice(0, 300) : null,
      qty: qty > 0 ? qty : 1,
      unit: strOrNull(it.unit) || 'pcs',
      unit_price: 0,
      amount: 0,
    });
  }

  // 品名汇总：契约要求 product_name = 首个品名 + (+N more)，但 inquiries 表没有该列，
  // 因此写进 message 首行（销售在后台列表里能直接看到），同时用于通知邮件标题区。
  const firstName = lines.length ? lines[0].name : '';
  const summary = firstName
    ? firstName + (lines.length > 1 ? ` (+${lines.length - 1} more)` : '')
    : (customerMessage.slice(0, 80) || 'Quote request');

  const listText = lines
    .map((l, i) => `${i + 1}. ${l.name}${l.spec ? ' / ' + l.spec : ''} x ${l.qty} ${l.unit}`)
    .join('\n');
  const messageParts = [`Product: ${summary}`];
  if (listText) messageParts.push(`Items:\n${listText}`);
  if (customerMessage) messageParts.push(`Message:\n${customerMessage}`);
  const inquiryMessage = messageParts.join('\n\n').slice(0, 8000);

  // ---- 建询盘 ----
  let inquiryId = null;
  try {
    const result = await env.DB.prepare(
      `INSERT INTO inquiries
       (product_id, name, email, company, country, message, status, lang, source, consent, mail_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'quote-request', 1, 'pending')`
    ).bind(
      lines.length ? lines[0].product_id : null,
      String(name).slice(0, 120),
      email,
      strOrNull(data.company),
      strOrNull(data.country),
      inquiryMessage,
      strOrNull(data.lang) || 'en'
    ).run();
    inquiryId = result.meta.last_row_id;
  } catch (e) {
    // 老库可能缺 lang/source/consent 列（migrate.sql 未执行），退化到基础字段，别把询价丢了
    console.error('[quotes] inquiry insert with ext columns failed', String(e && e.message || e));
    try {
      const result = await env.DB.prepare(
        `INSERT INTO inquiries (name, email, company, country, message, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      ).bind(String(name).slice(0, 120), email, strOrNull(data.company),
             strOrNull(data.country), inquiryMessage).run();
      inquiryId = result.meta.last_row_id;
    } catch (e2) {
      return json({ error: 'Could not save your request, please try again later' }, 500, corsHeaders);
    }
  }

  // ---- 建草稿报价（单价为 0，等销售核价）----
  const head = buildHead({
    inquiry_id: inquiryId,
    customer_email: email,
    customer_name: name,
    customer_company: strOrNull(data.company),
    customer_country: strOrNull(data.country),
    currency: data.currency,
    notes: customerMessage ? customerMessage.slice(0, 1000) : null,
  });

  let quote = null;
  try {
    quote = await insertQuote(env, head, lines, { status: 'draft', createdBy: 'web-request' });
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error('[quotes] request quote insert failed', msg);
    if (msg.includes('no such table')) {
      return json({
        error: 'Quotations are not available yet (database table missing — apply schema/migrations/006-trade.sql)',
      }, 500, corsHeaders);
    }
    return json({ error: 'Could not create your quotation, please contact us by email' }, 500, corsHeaders);
  }

  const settings = await readSettings(env);
  const site = siteBase(env, request);
  // 草稿还没有 token（未发送），给销售的是后台链接；有 token 时才是客户链接
  const link = quote.quote_no
    ? `${site}/admin/trade?quote=${quote.id}`
    : '';
  try {
    await sendMail(env, {
      to: env.MAIL_TO,
      subject: `New quote request ${quote.quote_no} — ${summary}`.slice(0, 200),
      html: requestMailHtml({ quote, settings, lines, message: customerMessage, link }),
      replyTo: email,
    });
  } catch (e) {
    console.error('[quotes] request mail failed', String(e && e.message || e));
  }

  return json({ success: true, data: { quote_no: quote.quote_no } }, 201, corsHeaders);
}
