/**
 * 订单 API（阶段三）
 *
 * 职责边界：订单头 + 行项目 + 时间线（order_events）+ Proforma Invoice + Stripe 收款。
 * 所有金额与行项目在创建时做「快照」，之后不回查 products —— 产品改名/涨价后，
 * 历史单据必须仍然显示成交当时的样子（这是外贸单据的合规要求）。
 *
 * 鉴权：除 Stripe webhook 外全部需要管理员登录。webhook 不可能带我们的 JWT，
 * 它的身份证明是 Stripe-Signature 的 HMAC，所以必须排在 requireAuth 之前。
 */
import { requireAuth } from '../../utils/auth';
import {
  ORDER_STATUSES, canTransition, nextStatuses, statusLabel, formatOrderNo,
} from '../../utils/order-state';
import { PdfDoc, money, pdfDate } from '../../utils/pdf';

const PAYMENT_STATUSES = ['unpaid', 'deposit_paid', 'paid', 'refunded'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'AED', 'JPY', 'RUB', 'PT', 'BRL'];
const TEXT_FIELDS = ['carrier', 'tracking_no', 'tracking_url', 'notes'];
const DATE_FIELDS = ['ship_date', 'eta'];
const EVENT_TYPES = ['note', 'shipping', 'payment', 'status'];

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

/** 表缺失（迁移没跑）时给运营一句能照做的话，而不是把 Worker 打崩 */
function dbFail(error, step, corsHeaders) {
  const msg = String(error && error.message ? error.message : error);
  console.error(`[orders] ${step} failed: ${msg}`);
  if (/no such table/i.test(msg)) {
    return json({
      error: `Database table missing while trying to ${step}: ${msg}. Run schema/migrations/006-trade.sql first.`,
    }, 500, corsHeaders);
  }
  return json({ error: `Failed to ${step}: ${msg}` }, 500, corsHeaders);
}

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export async function handleOrders(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean); // ['api','orders', ...]

  // Stripe 回调先于鉴权（见文件头注释）
  if (method === 'POST' && parts[2] === 'webhook' && parts[3] === 'stripe') {
    return stripeWebhook(request, env, corsHeaders);
  }

  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  if (method === 'GET' && parts.length === 2) return listOrders(env, url, corsHeaders);
  if (method === 'POST' && parts.length === 2) return createOrder(request, env, corsHeaders, admin);

  // 其它子路由的第三段必须是纯数字 id：/api/orders/webhook 之类不能被当成 id
  const id = parts[2];
  if (!id || !/^\d+$/.test(id)) return json({ error: 'Not found' }, 404, corsHeaders);

  if (method === 'GET' && parts.length === 3) return getOrder(env, corsHeaders, id);
  if (method === 'PUT' && parts.length === 3) return updateOrder(request, env, corsHeaders, id, admin);
  if (method === 'PUT' && parts.length === 4 && parts[3] === 'status')
    return updateStatus(request, env, corsHeaders, id, admin);
  if (method === 'POST' && parts.length === 4 && parts[3] === 'events')
    return addEvent(request, env, corsHeaders, id, admin);
  if (method === 'GET' && parts.length === 4 && parts[3] === 'pdf')
    return orderPdf(env, corsHeaders, id);
  if (method === 'POST' && parts.length === 4 && parts[3] === 'checkout')
    return createCheckout(request, env, corsHeaders, id);
  if (method === 'DELETE' && parts.length === 3) return deleteOrder(env, corsHeaders, id, admin);

  return json({ error: 'Not found' }, 404, corsHeaders);
}

/* ---------------- 列表 / 详情 ---------------- */

async function listOrders(env, url, corsHeaders) {
  const status = url.searchParams.get('status');
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  const where = [];
  const binds = [];
  if (status && ORDER_STATUSES.includes(status)) {
    where.push('o.status = ?');
    binds.push(status);
  }
  if (q) {
    where.push('(o.order_no LIKE ? OR o.customer_email LIKE ? OR o.customer_company LIKE ? OR o.tracking_no LIKE ?)');
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const totalRow = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM orders o ${clause}`
    ).bind(...binds).first();
    const { results } = await env.DB.prepare(
      `SELECT o.*, q.quote_no FROM orders o
       LEFT JOIN quotes q ON q.id = o.quote_id
       ${clause} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all();
    return json({
      success: true,
      data: results || [],
      total: totalRow ? totalRow.count : 0,
      limit,
      offset,
    }, 200, corsHeaders);
  } catch (e) {
    return dbFail(e, 'list orders', corsHeaders);
  }
}

async function loadOrder(env, id) {
  return env.DB.prepare(
    `SELECT o.*, q.quote_no FROM orders o
     LEFT JOIN quotes q ON q.id = o.quote_id
     WHERE o.id = ? LIMIT 1`
  ).bind(id).first();
}

async function getOrder(env, corsHeaders, id) {
  try {
    const order = await loadOrder(env, id);
    if (!order) return json({ error: 'Order not found' }, 404, corsHeaders);

    const items = await env.DB.prepare(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id'
    ).bind(id).all();
    const events = await env.DB.prepare(
      'SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at DESC, id DESC'
    ).bind(id).all();

    return json({
      success: true,
      data: { ...order, items: items.results || [], events: events.results || [] },
    }, 200, corsHeaders);
  } catch (e) {
    return dbFail(e, 'load order', corsHeaders);
  }
}

/* ---------------- 创建：从报价 / 手工 ---------------- */

async function createOrder(request, env, corsHeaders, admin) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body' }, 400, corsHeaders);

  return has(body, 'quote_id') && body.quote_id
    ? createFromQuote(env, corsHeaders, admin, body)
    : createManual(env, corsHeaders, admin, body);
}

async function createFromQuote(env, corsHeaders, admin, body) {
  const quoteId = Number(body.quote_id);
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return json({ error: 'quote_id must be a positive integer' }, 400, corsHeaders);
  }

  let quote;
  try {
    quote = await env.DB.prepare('SELECT * FROM quotes WHERE id = ? LIMIT 1').bind(quoteId).first();
  } catch (e) {
    return dbFail(e, 'load quote', corsHeaders);
  }
  if (!quote) return json({ error: 'Quote not found' }, 404, corsHeaders);

  // 一张报价只能转一张订单，否则重复点击会生成两张金额相同的订单
  let existing;
  try {
    existing = await env.DB.prepare(
      'SELECT id, order_no FROM orders WHERE quote_id = ? LIMIT 1'
    ).bind(quoteId).first();
  } catch (e) {
    return dbFail(e, 'check existing order for quote', corsHeaders);
  }
  if (existing) {
    return json({
      error: `Quote already converted to order ${existing.order_no}`,
      order_no: existing.order_no,
      order_id: existing.id,
    }, 409, corsHeaders);
  }

  let quoteItems;
  try {
    quoteItems = (await env.DB.prepare(
      'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order, id'
    ).bind(quoteId).all()).results || [];
  } catch (e) {
    return dbFail(e, 'load quote items', corsHeaders);
  }
  if (!quoteItems.length) return json({ error: 'Quote has no line items' }, 400, corsHeaders);

  const deposit = has(body, 'deposit_amount') && body.deposit_amount !== '' && body.deposit_amount != null
    ? round2(body.deposit_amount)
    : 0;

  const header = {
    quote_id: quote.id,
    inquiry_id: quote.inquiry_id ?? null,
    customer_id: quote.customer_id ?? null,
    customer_email: quote.customer_email,
    customer_name: quote.customer_name ?? null,
    customer_company: quote.customer_company ?? null,
    customer_country: quote.customer_country ?? null,
    currency: quote.currency || 'USD',
    total: round2(quote.total),
    deposit_amount: deposit,
    deposit_paid: 0,
    status: 'placed',
    payment_status: 'unpaid',
    incoterm: quote.incoterm ?? null,
    payment_terms: quote.payment_terms ?? null,
    notes: body.notes != null ? String(body.notes) : (quote.notes ?? null),
    created_by: admin.username || null,
  };

  const items = quoteItems.map((it, i) => ({
    product_id: it.product_id ?? null,
    name: String(it.name || '').trim(),
    spec: it.spec ?? null,
    qty: round2(it.qty),
    unit: it.unit || 'pcs',
    unit_price: round2(it.unit_price),
    sort_order: it.sort_order ?? i,
  }));

  let created;
  try {
    created = await insertOrder(env, header, items, `Created from quote ${quote.quote_no || quoteId}`, admin);
  } catch (e) {
    return dbFail(e, 'create order from quote', corsHeaders);
  }

  // 报价置 accepted：客户已经下单，报价单就不该再停在 draft/sent
  if (quote.status !== 'accepted') {
    try {
      await env.DB.prepare(
        `UPDATE quotes SET status = 'accepted',
           accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(quote.id).run();
    } catch (e) {
      console.error('[orders] mark quote accepted failed', e.message);
    }
  }

  // 回读一次，把 total/status 一并返回：后台"从报价转订单"后要立刻打开详情，
  // 只给 id+order_no 会让前端再发一次请求才能显示金额。
  const createdFull = await env.DB.prepare(
    'SELECT id, order_no, customer_email, status, payment_status, currency, total, created_at FROM orders WHERE id = ?'
  ).bind(created.id).first().catch(() => null);
  return json({ success: true, data: createdFull || { id: created.id, order_no: created.order_no } }, 201, corsHeaders);
}

async function createManual(env, corsHeaders, admin, body) {
  const email = String(body.customer_email || '').trim().toLowerCase();
  if (!email) return json({ error: 'customer_email is required' }, 400, corsHeaders);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: 'Invalid customer_email' }, 400, corsHeaders);
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) return json({ error: 'items must contain at least one line' }, 400, corsHeaders);

  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const it = rawItems[i] || {};
    const name = String(it.name || '').trim();
    const qty = Number(it.qty);
    const price = Number(it.unit_price);
    if (!name) return json({ error: `items[${i}].name is required` }, 400, corsHeaders);
    if (!Number.isFinite(qty) || qty <= 0) return json({ error: `items[${i}].qty must be > 0` }, 400, corsHeaders);
    if (!Number.isFinite(price) || price < 0) return json({ error: `items[${i}].unit_price must be >= 0` }, 400, corsHeaders);
    items.push({
      product_id: it.product_id ? Number(it.product_id) : null,
      name,
      spec: it.spec ? String(it.spec) : null,
      qty: round2(qty),
      unit: it.unit ? String(it.unit).slice(0, 20) : 'pcs',
      unit_price: round2(price),
      sort_order: Number.isFinite(Number(it.sort_order)) ? Number(it.sort_order) : i,
    });
  }

  // 服务端自己算总额，不信前端传的 total
  const total = round2(items.reduce((sum, it) => sum + it.qty * it.unit_price, 0));
  const currency = CURRENCIES.includes(String(body.currency || '').toUpperCase())
    ? String(body.currency).toUpperCase()
    : 'USD';

  const header = {
    quote_id: null,
    inquiry_id: body.inquiry_id ? Number(body.inquiry_id) : null,
    customer_id: body.customer_id ? Number(body.customer_id) : null,
    customer_email: email,
    customer_name: body.customer_name ? String(body.customer_name) : null,
    customer_company: body.customer_company ? String(body.customer_company) : null,
    customer_country: body.customer_country ? String(body.customer_country) : null,
    currency,
    total,
    deposit_amount: has(body, 'deposit_amount') && body.deposit_amount !== '' ? round2(body.deposit_amount) : 0,
    deposit_paid: 0,
    status: 'placed',
    payment_status: 'unpaid',
    incoterm: body.incoterm ? String(body.incoterm) : null,
    payment_terms: body.payment_terms ? String(body.payment_terms) : null,
    notes: body.notes ? String(body.notes) : null,
    created_by: admin.username || null,
  };

  let created;
  try {
    created = await insertOrder(env, header, items, 'Order created manually', admin);
  } catch (e) {
    return dbFail(e, 'create order', corsHeaders);
  }
  // 回读一次，把 total/status 一并返回：后台"从报价转订单"后要立刻打开详情，
  // 只给 id+order_no 会让前端再发一次请求才能显示金额。
  const createdFull = await env.DB.prepare(
    'SELECT id, order_no, customer_email, status, payment_status, currency, total, created_at FROM orders WHERE id = ?'
  ).bind(created.id).first().catch(() => null);
  return json({ success: true, data: createdFull || { id: created.id, order_no: created.order_no } }, 201, corsHeaders);
}

const ORDER_COLUMNS = [
  'order_no', 'quote_id', 'inquiry_id', 'customer_id', 'customer_email', 'customer_name',
  'customer_company', 'customer_country', 'currency', 'total', 'deposit_amount', 'deposit_paid',
  'status', 'payment_status', 'incoterm', 'payment_terms', 'notes', 'created_by',
];

/**
 * 插入订单头 + 行项目 + 创建事件。
 * 单号撞 UNIQUE（并发创建）时重试最多 3 次；行项目写失败则把刚建的空单删掉，
 * 避免运营在列表里看到一张没有明细的脏单。
 */
async function insertOrder(env, header, items, eventMessage, admin) {
  let orderId = null;
  let orderNo = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      orderNo = await nextOrderNo(env);
      const values = ORDER_COLUMNS.map(c => (c === 'order_no' ? orderNo : (header[c] === undefined ? null : header[c])));
      const res = await env.DB.prepare(
        `INSERT INTO orders (${ORDER_COLUMNS.join(', ')})
         VALUES (${ORDER_COLUMNS.map(() => '?').join(', ')})`
      ).bind(...values).run();
      orderId = res.meta.last_row_id;
      break;
    } catch (e) {
      const msg = String(e.message || e);
      // 只有单号冲突值得重试，其它错误（表缺失/约束）重试也没意义
      if (/UNIQUE/i.test(msg) && attempt < 3) continue;
      throw new Error(`insert order header (attempt ${attempt}): ${msg}`);
    }
  }

  try {
    const stmts = items.map((it, i) => env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, name, spec, qty, unit, unit_price, amount, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId,
      it.product_id ?? null,
      it.name,
      it.spec ?? null,
      it.qty ?? 0,
      it.unit || 'pcs',
      it.unit_price ?? 0,
      round2((it.qty || 0) * (it.unit_price || 0)),
      it.sort_order != null ? it.sort_order : i
    ));

    stmts.push(env.DB.prepare(
      `INSERT INTO order_events (order_id, type, to_value, message, admin_user)
       VALUES (?, 'status', 'placed', ?, ?)`
    ).bind(orderId, eventMessage, admin.username || null));

    await env.DB.batch(stmts);
  } catch (e) {
    try {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(orderId),
        env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(orderId),
      ]);
    } catch (cleanupError) {
      console.error('[orders] rollback after item insert failure failed', cleanupError.message);
    }
    throw new Error(`insert order items / created event: ${String(e.message || e)}`);
  }

  return { id: orderId, order_no: orderNo };
}

function todayStamp(date = new Date()) {
  // 统一用 UTC：D1 的 CURRENT_TIMESTAMP 也是 UTC，混用本地时区会让「当天单号」在跨零点时错位
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

async function nextOrderNo(env) {
  const stamp = todayStamp();
  const prefix = `SO-${stamp}-`;
  const row = await env.DB.prepare(
    'SELECT order_no FROM orders WHERE order_no LIKE ? ORDER BY order_no DESC LIMIT 1'
  ).bind(`${prefix}%`).first();

  let seq = 1;
  if (row && row.order_no) {
    const n = parseInt(String(row.order_no).slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return formatOrderNo(stamp, seq);
}

/* ---------------- 更新：物流 / 付款 / 状态 / 备注 ---------------- */

async function updateOrder(request, env, corsHeaders, id, admin) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body' }, 400, corsHeaders);

  const sets = [];
  const binds = [];

  for (const f of TEXT_FIELDS) {
    if (!has(body, f)) continue;
    // 空字符串 = 明确清空（运营删掉错填的单号时不该留个空串在库里）
    const v = body[f] == null ? '' : String(body[f]).trim();
    sets.push(`${f} = ?`);
    binds.push(v === '' ? null : v.slice(0, 2000));
  }

  for (const f of DATE_FIELDS) {
    if (!has(body, f)) continue;
    const v = body[f] == null ? '' : String(body[f]).trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return json({ error: `${f} must be YYYY-MM-DD` }, 400, corsHeaders);
    }
    sets.push(`${f} = ?`);
    binds.push(v || null);
  }

  if (has(body, 'deposit_amount')) {
    const n = Number(body.deposit_amount);
    if (!Number.isFinite(n) || n < 0) return json({ error: 'deposit_amount must be >= 0' }, 400, corsHeaders);
    sets.push('deposit_amount = ?');
    binds.push(round2(n));
  }

  if (has(body, 'deposit_paid')) {
    sets.push('deposit_paid = ?');
    binds.push(body.deposit_paid ? 1 : 0);
  }

  let payment = null;
  if (has(body, 'payment_status')) {
    payment = String(body.payment_status || '').trim();
    if (!PAYMENT_STATUSES.includes(payment)) {
      return json({ error: `payment_status must be one of ${PAYMENT_STATUSES.join(', ')}` }, 400, corsHeaders);
    }
    sets.push('payment_status = ?');
    binds.push(payment);
  }

  if (!sets.length) return json({ error: 'No updatable fields provided' }, 400, corsHeaders);

  let order;
  try {
    order = await loadOrder(env, id);
  } catch (e) {
    return dbFail(e, 'load order', corsHeaders);
  }
  if (!order) return json({ error: 'Order not found' }, 404, corsHeaders);

  const stmts = [
    env.DB.prepare(
      `UPDATE orders SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(...binds, id),
  ];

  // 付款状态变化必须留痕：财务对账时只看订单当前值是不够的
  if (payment && payment !== order.payment_status) {
    stmts.push(env.DB.prepare(
      `INSERT INTO order_events (order_id, type, from_value, to_value, message, admin_user)
       VALUES (?, 'payment', ?, ?, ?, ?)`
    ).bind(id, order.payment_status || null, payment,
      `Payment status: ${order.payment_status || 'unpaid'} -> ${payment}`, admin.username || null));
  }

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    return dbFail(e, 'update order', corsHeaders);
  }
  return json({ success: true }, 200, corsHeaders);
}

async function updateStatus(request, env, corsHeaders, id, admin) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const target = String((body && body.status) || '').trim();
  if (!ORDER_STATUSES.includes(target)) {
    return json({ error: `Invalid status. Allowed: ${ORDER_STATUSES.join(', ')}` }, 400, corsHeaders);
  }

  let order;
  try {
    order = await env.DB.prepare(
      'SELECT id, order_no, status FROM orders WHERE id = ? LIMIT 1'
    ).bind(id).first();
  } catch (e) {
    return dbFail(e, 'load order', corsHeaders);
  }
  if (!order) return json({ error: 'Order not found' }, 404, corsHeaders);

  if (!canTransition(order.status, target)) {
    return json({
      error: `Cannot move from ${order.status} to ${target}`,
      allowed: nextStatuses(order.status),
    }, 400, corsHeaders);
  }

  const message = body.message ? String(body.message).slice(0, 2000) : null;

  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(target, id),
      env.DB.prepare(
        `INSERT INTO order_events (order_id, type, from_value, to_value, message, admin_user)
         VALUES (?, 'status', ?, ?, ?, ?)`
      ).bind(id, order.status, target, message, admin.username || null),
    ]);
  } catch (e) {
    return dbFail(e, 'update order status', corsHeaders);
  }

  return json({
    success: true,
    data: { id: Number(id), status: target, allowed: nextStatuses(target) },
  }, 200, corsHeaders);
}

async function addEvent(request, env, corsHeaders, id, admin) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const message = String((body && body.message) || '').trim();
  if (!message) return json({ error: 'message is required' }, 400, corsHeaders);
  // 只允许时间线里定义过的类型；乱传的按内部备注处理，不堵住运营写话
  const type = EVENT_TYPES.includes(String(body.type || '')) ? String(body.type) : 'note';

  try {
    const order = await env.DB.prepare('SELECT id FROM orders WHERE id = ? LIMIT 1').bind(id).first();
    if (!order) return json({ error: 'Order not found' }, 404, corsHeaders);

    const res = await env.DB.prepare(
      `INSERT INTO order_events (order_id, type, message, admin_user) VALUES (?, ?, ?, ?)`
    ).bind(id, type, message.slice(0, 4000), admin.username || null).run();
    return json({ success: true, data: { id: res.meta.last_row_id, type } }, 201, corsHeaders);
  } catch (e) {
    return dbFail(e, 'add order event', corsHeaders);
  }
}

/* ---------------- PDF：Proforma Invoice ---------------- */

async function orderPdf(env, corsHeaders, id) {
  let order, items;
  try {
    order = await loadOrder(env, id);
    if (!order) return json({ error: 'Order not found' }, 404, corsHeaders);
    items = (await env.DB.prepare(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id'
    ).bind(id).all()).results || [];
  } catch (e) {
    return dbFail(e, 'load order for pdf', corsHeaders);
  }

  const settings = await loadSettings(env);
  const bytes = buildProforma(order, items, settings, stripeConfigured(env));

  return new Response(bytes, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${order.order_no}.pdf"`,
      // 单据含客户与价格，绝不能被 CDN/代理缓存
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * 两列信息块（Seller / Buyer）。
 * PdfDoc 是单光标流式排版，这里临时保存/恢复 cursorY 来并排画两栏；
 * 只用于页首 4~6 行，不会触发换页，所以恢复光标是安全的。
 */
function renderColumns(doc, columns, gap = 18) {
  const startY = doc.cursorY;
  const startPage = doc.pageIndex;
  const colW = (doc.contentW - gap * (columns.length - 1)) / columns.length;
  let bottom = startY;

  columns.forEach((col, i) => {
    doc.cursorY = startY;
    const x = doc.margin.left + i * (colW + gap);
    doc.text(col.title, { x, size: 8.5, bold: true, color: [0.42, 0.47, 0.55], maxWidth: colW });
    for (const line of col.lines) {
      if (line == null || line === '') continue;
      doc.text(String(line), { x, size: 9.5, lineHeight: 13, maxWidth: colW });
    }
    bottom = Math.min(bottom, doc.cursorY);
  });

  doc.pageIndex = startPage;
  doc.cursorY = bottom - 6;
}

function buildProforma(order, items, settings, hasStripe) {
  const cur = order.currency || 'USD';
  const siteName = settings.site_name || 'Our Company';
  const doc = new PdfDoc({
    title: `PROFORMA INVOICE ${order.order_no}`,
    author: siteName,
    footerText: `${siteName} - page {page} of {total}`,
  });

  const amount = (n) => money(n, '').trim();

  doc.heading('PROFORMA INVOICE');
  doc.text(`Order No. ${order.order_no}`, { size: 11, color: [0.42, 0.47, 0.55] });
  doc.spacer(6);
  doc.rule();

  renderColumns(doc, [
    { title: 'SELLER', lines: [siteName, settings.address, settings.email, settings.phone] },
    {
      title: 'BUYER',
      lines: [order.customer_company, order.customer_name, order.customer_email, order.customer_country],
    },
  ]);

  doc.spacer(6);
  doc.fields([
    ['Order date', pdfDate(order.created_at)],
    ['Quotation ref.', order.quote_no],
    ['Status', statusLabel(order.status)],
  ]);

  doc.spacer(8);
  doc.table({
    columns: [
      { label: 'Item', width: 196 },
      { label: 'Spec', width: 108 },
      { label: 'Qty', width: 42, align: 'right' },
      { label: 'Unit', width: 42, align: 'right' },
      { label: 'Unit price', width: 72, align: 'right' },
      { label: 'Amount', width: 80, align: 'right' },
    ],
    rows: items.map(it => [
      it.name,
      it.spec || '',
      String(Number(it.qty || 0)),
      it.unit || 'pcs',
      amount(it.unit_price),
      amount(it.amount != null ? it.amount : Number(it.qty || 0) * Number(it.unit_price || 0)),
    ]),
  });

  doc.spacer(4);
  doc.total(`TOTAL  ${money(order.total, cur)}`);

  const deposit = Number(order.deposit_amount || 0);
  if (deposit > 0) {
    doc.text(`Deposit  ${money(deposit, cur)}`, { size: 10, align: 'right' });
    doc.text(`Balance  ${money(Number(order.total || 0) - deposit, cur)}`, { size: 10, align: 'right' });
  }

  doc.spacer(10);
  doc.text('TERMS & SHIPPING', { size: 9, bold: true, color: [0.42, 0.47, 0.55] });
  doc.spacer(2);
  doc.fields([
    ['Payment terms', order.payment_terms],
    ['Incoterm', order.incoterm],
    ['Carrier', order.carrier],
    ['Tracking No.', order.tracking_no],
    ['ETD', pdfDate(order.ship_date)],
    ['ETA', pdfDate(order.eta)],
  ]);

  if (order.notes) {
    doc.spacer(4);
    doc.text('Notes', { size: 9, bold: true, color: [0.42, 0.47, 0.55] });
    doc.paragraph(order.notes, { size: 8.5 });
  }

  doc.spacer(10);
  doc.text('PAYMENT', { size: 9, bold: true, color: [0.42, 0.47, 0.55] });
  doc.spacer(2);
  if (hasStripe) {
    doc.paragraph('Card payment is available online from your order page.', { size: 8.5 });
  } else {
    // 没接 Stripe 的站点靠 T/T 收款，银行信息必须印在单据上，否则客户还得来回问
    const hasBank = !!(settings.bank_name || settings.bank_account || settings.swift);
    if (hasBank) {
      doc.fields([
        ['Beneficiary', settings.beneficiary || siteName],
        ['Bank', settings.bank_name],
        ['Account', settings.bank_account],
        ['SWIFT', settings.swift],
      ]);
    } else {
      // 破折号是非 Latin-1 字符，PdfDoc 会降级成 '?'，这里用普通连字符
      doc.paragraph('Payment by T/T - please contact sales for bank details', { size: 8.5 });
    }
  }

  return doc.build();
}

/* ---------------- Stripe ---------------- */

function stripeConfigured(env) {
  const key = env.STRIPE_SECRET_KEY;
  return !!key && !String(key).startsWith('REPLACE_');
}

async function loadSettings(env) {
  try {
    if (!env.STATIC_ASSETS) return {};
    const raw = await env.STATIC_ASSETS.get('website_settings');
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch {
    return {};
  }
}

function bankTransferInfo(settings) {
  // 严格按契约：settings 缺哪项就给空串，让前端自己决定是否隐藏该行
  return {
    bank_name: settings.bank_name || '',
    bank_account: settings.bank_account || '',
    swift: settings.swift || '',
    beneficiary: settings.beneficiary || '',
  };
}

async function createCheckout(request, env, corsHeaders, id) {
  let order;
  try {
    order = await loadOrder(env, id);
  } catch (e) {
    return dbFail(e, 'load order', corsHeaders);
  }
  if (!order) return json({ error: 'Order not found' }, 404, corsHeaders);

  const settings = await loadSettings(env);

  // 未配置 Stripe 不是错误，是「请走 T/T」——把银行信息一起给前端，客户页可以直接展示
  if (!stripeConfigured(env)) {
    return json({
      error: 'Online payment is not configured',
      bank_transfer: bankTransferInfo(settings),
    }, 400, corsHeaders);
  }

  const currency = String(order.currency || 'USD').toLowerCase();
  const cents = Math.round(Number(order.total || 0) * 100); // Stripe 只接受整数分
  if (!Number.isFinite(cents) || cents <= 0) {
    return json({ error: 'Order total must be greater than zero' }, 400, corsHeaders);
  }

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('success_url', `${origin}/account?paid=1`);
  form.set('cancel_url', `${origin}/account`);
  form.set('client_reference_id', order.order_no);
  form.set('metadata[order_id]', String(order.id));
  form.set('line_items[0][price_data][currency]', currency);
  form.set('line_items[0][price_data][product_data][name]', `Order ${order.order_no}`);
  form.set('line_items[0][price_data][unit_amount]', String(cents));
  form.set('line_items[0][quantity]', '1');

  let res, payload;
  try {
    res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    payload = await res.json();
  } catch (e) {
    return json({ error: `Stripe request failed: ${e.message}` }, 502, corsHeaders);
  }

  if (!res.ok) {
    // 把 Stripe 的原因透出去（币种不支持 / 金额过低 等），吞掉只会让运营抓瞎
    return json({ error: (payload && payload.error && payload.error.message) || 'Stripe rejected the checkout session' }, 502, corsHeaders);
  }

  return json({ success: true, data: { url: payload.url } }, 200, corsHeaders);
}

/** 解析 `t=123,v1=abc,v1=def`，v1 可能有多个（密钥轮换期） */
function parseStripeSignature(header) {
  const out = { t: null, v1: [] };
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') out.t = v;
    else if (k === 'v1' && v) out.v1.push(v);
  }
  return out;
}

async function hmacHex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 常量时间比较：提前 return 会泄漏「前几个字符对上了」，给签名爆破留时间差 */
function timingSafeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function stripeWebhook(request, env, corsHeaders) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret || String(secret).startsWith('REPLACE_')) {
    return json({ error: 'Webhook secret is not configured' }, 400, corsHeaders);
  }

  // 必须读原始字符串：签名基于原始字节，request.json() 再序列化会改变字节
  const raw = await request.text();
  const sig = parseStripeSignature(request.headers.get('Stripe-Signature'));
  if (!sig.t || !sig.v1.length) {
    return json({ error: 'Missing Stripe-Signature' }, 400, corsHeaders);
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = Number(sig.t);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
    return json({ error: 'Signature timestamp is outside the 300s tolerance' }, 400, corsHeaders);
  }

  const expected = await hmacHex(secret, `${sig.t}.${raw}`);
  if (!sig.v1.some(v => timingSafeEqual(expected, v))) {
    return json({ error: 'Invalid signature' }, 400, corsHeaders);
  }

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON payload' }, 400, corsHeaders); }

  if (event.type !== 'checkout.session.completed') {
    // 其它事件照 200 回，否则 Stripe 会一直重投我们不关心的事件
    return json({ received: true, ignored: event.type || null }, 200, corsHeaders);
  }

  const session = (event.data && event.data.object) || {};
  const sessionId = String(session.id || '');
  const orderId = session.metadata && session.metadata.order_id ? Number(session.metadata.order_id) : null;
  const orderNo = session.client_reference_id || null;

  let order;
  try {
    if (orderId) {
      order = await env.DB.prepare(
        'SELECT id, order_no, payment_status FROM orders WHERE id = ? LIMIT 1'
      ).bind(orderId).first();
    }
    if (!order && orderNo) {
      order = await env.DB.prepare(
        'SELECT id, order_no, payment_status FROM orders WHERE order_no = ? LIMIT 1'
      ).bind(orderNo).first();
    }
  } catch (e) {
    return dbFail(e, 'find order for stripe session', corsHeaders);
  }
  if (!order) return json({ error: 'Order not found for this session' }, 404, corsHeaders);

  // 幂等：Stripe 超时会重投同一事件，按 session 判重，避免时间线上出现两条 Paid
  if (sessionId) {
    try {
      const dup = await env.DB.prepare(
        `SELECT id FROM order_events
         WHERE order_id = ? AND type = 'payment' AND message LIKE ? LIMIT 1`
      ).bind(order.id, `%session=${sessionId}%`).first();
      if (dup) return json({ received: true, duplicate: true }, 200, corsHeaders);
    } catch (e) {
      return dbFail(e, 'check duplicate stripe event', corsHeaders);
    }
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE orders SET payment_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(order.id),
      env.DB.prepare(
        `INSERT INTO order_events (order_id, type, from_value, to_value, message, admin_user)
         VALUES (?, 'payment', ?, 'paid', ?, 'stripe')`
      ).bind(order.id, order.payment_status || 'unpaid',
        `Paid via Stripe, session=${sessionId || 'unknown'}`),
    ]);
  } catch (e) {
    return dbFail(e, 'record stripe payment', corsHeaders);
  }

  return json({ received: true }, 200, corsHeaders);
}

/* ------------------------------------------------------------------ *
 * 删除订单（仅清理用）
 *
 * 只允许删两种单：还没付款的 placed 草稿、已取消的单。
 * 有付款记录或在产的单必须留着 —— 删掉之后财务对不上账，
 * 这也是为什么后台 UI 不暴露这个按钮，只给脚本/运维用。
 * ------------------------------------------------------------------ */
async function deleteOrder(env, corsHeaders, id, admin) {
  if (!admin || admin.role !== 'super_admin') {
    return json({ error: 'Super admin required' }, 403, corsHeaders);
  }
  let row;
  try {
    row = await env.DB.prepare('SELECT status, payment_status FROM orders WHERE id = ?').bind(id).first();
  } catch (e) {
    return dbFail(e, 'load order for delete', corsHeaders);
  }
  if (!row) return json({ error: 'Order not found' }, 404, corsHeaders);

  const removable = row.status === 'cancelled' || (row.status === 'placed' && row.payment_status === 'unpaid');
  if (!removable) {
    return json({
      error: `Cannot delete an order in status "${row.status}" with payment "${row.payment_status}". Cancel it first.`,
    }, 409, corsHeaders);
  }

  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM order_events WHERE order_id = ?').bind(id),
      env.DB.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id),
      env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id),
    ]);
  } catch (e) {
    return dbFail(e, 'delete order', corsHeaders);
  }
  return json({ success: true }, 200, corsHeaders);
}
