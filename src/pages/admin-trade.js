/**
 * 后台交易工作台（阶段三）
 *
 * URL: /admin/trade —— 报价 + 订单管理，独立 shell（不套前台 layout）。
 * 结构照抄 admin-content.js：侧边栏 / 顶栏 / toast / 模态框 / Bearer token。
 *
 * 为什么整页是纯客户端渲染：
 *   报价与订单的写操作全部走 /api/quotes、/api/orders，服务端只需要吐一个骨架；
 *   列表筛选（状态 + 关键词）在客户端切换视图，不必每次整页刷新，运营连续改价更顺手。
 *   代价是页面本身不查库 —— 迁移未跑时接口 404，页面用错误条提示而不是白屏。
 *
 * ⚠️ 本文件整页是一个模板字符串：里面绝对不能出现反斜杠转义或 ${ 插值（除服务端刻意保留的），
 *    否则 \n 会被插值成真实换行，浏览器拿到「单引号内换行」→ 整段脚本报错。
 */
export async function adminTradePage(request, env) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Trade workspace - Admin</title>
<style>
  :root{--primary:#2563eb;--primary-dark:#1e40af;--accent:#f59e0b;--text:#1f2937;--muted:#6b7280;--bg:#f9fafb;--border:#e5e7eb;--ok:#10b981;--danger:#ef4444}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
  .layout{display:flex;min-height:100vh}
  .side{width:220px;background:#111827;color:#e5e7eb;padding:1.25rem 0;flex-shrink:0}
  .side .brand{color:var(--accent);font-weight:700;font-size:1.1rem;padding:0 1.25rem 1rem}
  .side .group{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;padding:.9rem 1.25rem .3rem}
  .side-link{display:block;padding:.55rem 1.25rem;color:#d1d5db;text-decoration:none;font-size:.9rem;border-left:3px solid transparent;cursor:pointer}
  .side-link:hover{background:#1f2937;color:#fff}
  .side-link.active{background:#1f2937;color:#fff;border-left-color:var(--accent)}
  .main{flex:1;min-width:0;padding:1.75rem 2rem 3rem}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
  .topbar-right{display:flex;align-items:center;gap:.6rem}
  h1{font-size:1.45rem}
  .sub{color:var(--muted);font-size:.88rem;margin-top:.2rem}
  .user-chip{display:inline-block;padding:.25rem .6rem;border:1px solid var(--border);background:#fff;border-radius:999px;font-size:.82rem;color:var(--text);white-space:nowrap}
  .btn{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .9rem;border-radius:.375rem;border:1px solid var(--border);background:#fff;color:var(--text);cursor:pointer;font-size:.88rem;text-decoration:none;font-family:inherit}
  .btn:hover{background:var(--bg)}
  .btn:disabled{opacity:.55;cursor:not-allowed}
  .btn-primary{background:var(--primary);border-color:var(--primary);color:#fff}
  .btn-primary:hover{background:var(--primary-dark)}
  .btn-danger{background:#fff;border-color:#f3c2c2;color:#b91c1c}
  .btn-danger:hover{background:#fef2f2;border-color:#e9a0a0}
  .btn-sm{padding:.28rem .55rem;font-size:.78rem}
  .card{background:#fff;border:1px solid var(--border);border-radius:.5rem}
  .card-pad{padding:1.25rem}
  .card-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:1rem 1.25rem;border-bottom:1px solid var(--border);flex-wrap:wrap}
  .card-head h2{font-size:1rem}
  .toolbar{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem}
  .spacer{flex:1}
  .table-wrap{overflow-x:auto}
  table.data{width:100%;border-collapse:collapse;font-size:.9rem}
  table.data th{text-align:left;padding:.7rem .9rem;background:var(--bg);border-bottom:1px solid var(--border);font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);white-space:nowrap}
  table.data td{padding:.65rem .9rem;border-bottom:1px solid var(--border);vertical-align:middle}
  table.data tr:last-child td{border-bottom:none}
  table.data tbody tr:hover{background:#fbfdff}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85rem}
  .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .muted{color:var(--muted);font-size:.82rem}
  .actions{display:flex;gap:.3rem;flex-wrap:wrap;white-space:nowrap;min-width:300px}
  .badge{display:inline-block;padding:.1rem .45rem;border-radius:.25rem;font-size:.72rem;background:#f3f4f6;color:#4b5563;white-space:nowrap}
  .badge-gray{background:#f3f4f6;color:#4b5563}
  .badge-blue{background:#dbeafe;color:#1e40af}
  .badge-green{background:#d1fae5;color:#065f46}
  .badge-amber{background:#fef3c7;color:#92400e}
  .badge-red{background:#fee2e2;color:#991b1b}
  .empty{padding:2rem;text-align:center;color:var(--muted)}
  .err-box{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:.4rem;padding:.7rem .9rem;font-size:.86rem;margin-bottom:1rem}
  .stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.25rem}
  .stat{padding:1.1rem 1.25rem}
  .stat-label{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .stat-value{font-size:1.9rem;font-weight:700;color:var(--primary);line-height:1.35;margin-top:.15rem}
  .stat-value.sm{font-size:1.02rem;color:var(--text);font-weight:600}
  .stat-hint{font-size:.75rem;color:var(--muted);margin-top:.25rem}
  .cur-line{font-variant-numeric:tabular-nums}
  .modal{display:none;position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:100;padding:1.5rem 1rem;overflow-y:auto}
  .modal.active{display:block}
  .modal-box{background:#fff;border-radius:.6rem;max-width:760px;margin:0 auto;padding:1.5rem;max-height:88vh;overflow:auto;box-shadow:0 20px 40px rgba(15,23,42,.18)}
  .modal-box.wide{max-width:1000px}
  .modal-box.narrow{max-width:520px}
  .modal-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1.1rem}
  .modal-head h2{font-size:1.15rem}
  .close{border:none;background:none;font-size:1.5rem;line-height:1;cursor:pointer;color:var(--muted)}
  .modal-foot{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)}
  .field{margin-bottom:.9rem}
  .field label{display:block;font-size:.8rem;font-weight:500;margin-bottom:.3rem}
  .input,.select,.textarea{width:100%;padding:.5rem .6rem;border:1px solid var(--border);border-radius:.375rem;font-size:.9rem;font-family:inherit;background:#fff;color:var(--text)}
  .input:focus,.select:focus,.textarea:focus{outline:none;border-color:var(--primary)}
  .textarea{resize:vertical;min-height:78px}
  .input-sm{padding:.35rem .45rem;font-size:.85rem}
  .checkbox{display:flex;align-items:center;gap:.45rem;font-size:.85rem}
  .hint{font-size:.75rem;color:var(--muted);margin-top:.3rem}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 .9rem}
  .subhead{font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:1.4rem 0 .6rem;padding-top:.9rem;border-top:1px solid var(--border)}
  table.items{width:100%;border-collapse:collapse;font-size:.85rem}
  table.items th{text-align:left;padding:.4rem .35rem;background:var(--bg);font-size:.72rem;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);white-space:nowrap}
  table.items td{padding:.3rem .25rem;border-bottom:1px solid #f3f4f6;vertical-align:middle}
  .totals{margin:1rem 0 0 auto;max-width:340px;font-size:.88rem}
  .trow{display:flex;justify-content:space-between;gap:1rem;padding:.2rem 0}
  .trow.total{border-top:1px solid var(--border);margin-top:.35rem;padding-top:.5rem;font-size:1rem;font-weight:700}
  .trow b{font-variant-numeric:tabular-nums}
  .detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap}
  .detail-head .big{font-size:1.05rem;font-weight:700}
  .badges{display:flex;gap:.35rem;flex-wrap:wrap}
  .kv{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem 1rem;margin-top:1rem;font-size:.88rem}
  .kv span{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .kv b{font-weight:600;word-break:break-word}
  .md-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-top:1rem;background:var(--bg);border:1px solid var(--border);border-radius:.4rem;padding:.8rem 1rem;font-size:.92rem}
  .md-totals span{display:block;font-size:.72rem;text-transform:uppercase;color:var(--muted);font-weight:400}
  .timeline{border-left:2px solid var(--border);margin:.4rem 0 0 .5rem;padding-left:1rem}
  .tl-item{position:relative;padding-bottom:.85rem}
  .tl-item::before{content:'';position:absolute;left:-1.42rem;top:5px;width:9px;height:9px;border-radius:50%;background:var(--primary)}
  .tl-meta{font-size:.72rem;color:var(--muted)}
  .tl-body{font-size:.88rem}
  .tl-msg{font-size:.85rem;color:#374151;background:var(--bg);border-radius:.35rem;padding:.4rem .6rem;margin-top:.3rem;white-space:pre-wrap;word-break:break-word}
  .note-box{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:.4rem;padding:.6rem .75rem;font-size:.85rem;white-space:pre-wrap;margin-bottom:.6rem}
  .toast{position:fixed;right:1.25rem;bottom:1.25rem;padding:.75rem 1rem;border-radius:.4rem;color:#fff;font-size:.88rem;z-index:200;opacity:0;transform:translateY(8px);transition:.25s;max-width:min(420px,90vw)}
  .toast.show{opacity:1;transform:none}
  .toast.ok{background:#059669}.toast.err{background:#dc2626}
  @media(max-width:1100px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:820px){.layout{flex-direction:column}.side{width:100%;display:flex;flex-wrap:wrap;align-items:center}.side .brand{padding:.6rem 1rem}.side .group{display:none}.side-link{padding:.5rem .8rem;border-left:none;border-bottom:3px solid transparent}.side-link.active{border-bottom-color:var(--accent)}.main{padding:1rem}.grid2{grid-template-columns:1fr}.kv{grid-template-columns:1fr 1fr}.md-totals{grid-template-columns:1fr}td,th{padding:.5rem .55rem}}
  @media(max-width:560px){.stat-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="layout">
  <aside class="side">
    <div class="brand">B2B Admin</div>
    <div class="group">Trade</div>
    <a href="#" class="side-link active" data-view="overview">Overview</a>
    <a href="#" class="side-link" data-view="quotes">Quotations</a>
    <a href="#" class="side-link" data-view="orders">Orders</a>
    <div class="group">Back</div>
    <a href="/admin/dashboard" class="side-link">&larr; Dashboard</a>
    <a href="/" class="side-link" target="_blank" rel="noopener">View site</a>
    <a href="#" class="side-link" id="logout-link">Logout</a>
  </aside>

  <main class="main">
    <div class="topbar">
      <div>
        <h1 id="page-title">Overview</h1>
        <p class="sub" id="page-sub">Quotations, orders and shipments in one place.</p>
      </div>
      <div class="topbar-right">
        <span class="user-chip" id="admin-name">Admin</span>
        <button type="button" class="btn btn-sm" id="logout-btn">Logout</button>
      </div>
    </div>

    <section class="view active" data-view="overview">
      <div id="ov-error"></div>
      <div class="stat-grid">
        <div class="card stat">
          <div class="stat-label">Open quotations</div>
          <div class="stat-value" id="ov-open">-</div>
          <div class="stat-hint">Draft + sent</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Accepted</div>
          <div class="stat-value" id="ov-accepted">-</div>
          <div class="stat-hint">This month</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Active orders</div>
          <div class="stat-value" id="ov-active">-</div>
          <div class="stat-hint">Not completed or cancelled</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Order value</div>
          <div class="stat-value sm" id="ov-value">-</div>
          <div class="stat-hint">This month, per currency</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Needs attention</h2>
          <span class="muted">Sent quotations past their valid-until date</span>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Quote No</th>
                <th>Customer</th>
                <th class="num">Amount</th>
                <th>Valid until</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="ov-attention">
              <tr><td colspan="5" class="empty">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="view" data-view="quotes">
      <div class="toolbar">
        <select class="select" id="q-filter-status" style="max-width:210px">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="accepted">Accepted</option>
          <option value="changes_requested">Changes requested</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
        <input class="input" id="q-search" placeholder="Search quote no / email / company" style="max-width:300px">
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary" id="q-new">+ New quotation</button>
      </div>
      <div id="q-error"></div>
      <div class="card">
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Quote No</th>
                <th>Customer</th>
                <th class="num">Amount</th>
                <th>Status</th>
                <th>Valid until</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="q-body">
              <tr><td colspan="7" class="empty">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="view" data-view="orders">
      <div class="toolbar">
        <select class="select" id="o-filter-status" style="max-width:210px">
          <option value="">All statuses</option>
          <option value="placed">Placed</option>
          <option value="confirmed">Confirmed</option>
          <option value="in_production">In production</option>
          <option value="ready">Ready to ship</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select class="select" id="o-filter-payment" style="max-width:190px">
          <option value="">All payments</option>
          <option value="unpaid">Unpaid</option>
          <option value="deposit_paid">Deposit paid</option>
          <option value="paid">Paid</option>
          <option value="refunded">Refunded</option>
        </select>
        <input class="input" id="o-search" placeholder="Search order no / email / company" style="max-width:300px">
      </div>
      <div id="o-error"></div>
      <div class="card">
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Order No</th>
                <th>Customer</th>
                <th class="num">Amount</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Tracking</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="o-body">
              <tr><td colspan="8" class="empty">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </main>
</div>

<div class="modal" id="quote-modal">
  <div class="modal-box wide">
    <div class="modal-head">
      <h2 id="quote-modal-title">New quotation</h2>
      <button type="button" class="close" data-close="quote-modal">&times;</button>
    </div>
    <form id="quote-form" novalidate>
      <input type="hidden" id="q-id">
      <div class="grid2">
        <div class="field">
          <label for="q-email">Customer email *</label>
          <input class="input" type="email" id="q-email" placeholder="buyer@acme.example" autocomplete="off">
        </div>
        <div class="field">
          <label for="q-name">Name</label>
          <input class="input" id="q-name" placeholder="Ahmed" autocomplete="off">
        </div>
        <div class="field">
          <label for="q-company">Company</label>
          <input class="input" id="q-company" placeholder="Acme Trading LLC" autocomplete="off">
        </div>
        <div class="field">
          <label for="q-country">Country (ISO-2)</label>
          <input class="input" id="q-country" maxlength="2" placeholder="AE" autocomplete="off">
        </div>
        <div class="field">
          <label for="q-currency">Currency</label>
          <select class="select" id="q-currency">
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="CNY">CNY</option>
            <option value="AED">AED</option>
            <option value="JPY">JPY</option>
            <option value="RUB">RUB</option>
            <option value="PT">PT</option>
            <option value="BRL">BRL</option>
          </select>
        </div>
        <div class="field">
          <label for="q-incoterm">Incoterm</label>
          <select class="select" id="q-incoterm">
            <option value="">-</option>
            <option value="EXW">EXW</option>
            <option value="FOB">FOB</option>
            <option value="CIF">CIF</option>
            <option value="DDP">DDP</option>
            <option value="CFR">CFR</option>
          </select>
        </div>
        <div class="field">
          <label for="q-payment-terms">Payment terms</label>
          <input class="input" id="q-payment-terms" placeholder="30% T/T deposit, balance before shipment" autocomplete="off">
        </div>
        <div class="field">
          <label for="q-valid-until">Valid until</label>
          <input class="input" type="date" id="q-valid-until">
        </div>
      </div>

      <div class="subhead">Line items</div>
      <div class="table-wrap">
        <table class="items">
          <thead>
            <tr>
              <th style="width:30%">Name *</th>
              <th style="width:24%">Spec</th>
              <th style="width:90px">Qty</th>
              <th style="width:80px">Unit</th>
              <th style="width:120px">Unit price</th>
              <th style="width:130px" class="num">Amount</th>
              <th style="width:44px"></th>
            </tr>
          </thead>
          <tbody id="q-items"></tbody>
        </table>
      </div>
      <div style="margin-top:.5rem">
        <button type="button" class="btn btn-sm" id="q-add-row">+ Add row</button>
      </div>

      <div class="grid2" style="margin-top:1rem">
        <div class="field">
          <label for="q-discount-type">Discount type</label>
          <select class="select" id="q-discount-type">
            <option value="">None</option>
            <option value="percent">Percent (%)</option>
            <option value="amount">Amount</option>
          </select>
        </div>
        <div class="field">
          <label for="q-discount-value">Discount value</label>
          <input class="input" type="number" min="0" step="0.01" id="q-discount-value" value="0">
        </div>
        <div class="field">
          <label for="q-tax-rate">Tax rate (%)</label>
          <input class="input" type="number" min="0" step="0.01" id="q-tax-rate" value="0">
        </div>
        <div class="field">
          <label for="q-shipping">Shipping amount</label>
          <input class="input" type="number" min="0" step="0.01" id="q-shipping" value="0">
        </div>
      </div>

      <div class="totals" id="q-totals">
        <div class="trow"><span>Subtotal</span><b id="t-sub">USD 0.00</b></div>
        <div class="trow"><span>Discount</span><b id="t-disc">USD 0.00</b></div>
        <div class="trow"><span>Tax</span><b id="t-tax">USD 0.00</b></div>
        <div class="trow"><span>Shipping</span><b id="t-ship">USD 0.00</b></div>
        <div class="trow total"><span>Total</span><b id="t-total">USD 0.00</b></div>
      </div>
      <p class="hint">Totals above are a live preview. After saving, the numbers returned by the server are authoritative.</p>

      <div class="field" style="margin-top:1rem">
        <label for="q-notes">Notes (shown to the customer)</label>
        <textarea class="textarea" id="q-notes" placeholder="Lead time, packing details, payment notes..."></textarea>
      </div>
      <div class="field">
        <label for="q-doc-terms">Terms &amp; conditions</label>
        <textarea class="textarea" id="q-doc-terms" placeholder="Validity, warranty, force majeure..."></textarea>
      </div>

      <div class="modal-foot">
        <button type="button" class="btn" data-close="quote-modal">Cancel</button>
        <button type="submit" class="btn btn-primary" id="q-save">Save quotation</button>
      </div>
    </form>
  </div>
</div>

<div class="modal" id="link-modal">
  <div class="modal-box narrow">
    <div class="modal-head">
      <h2>Customer link</h2>
      <button type="button" class="close" data-close="link-modal">&times;</button>
    </div>
    <p class="muted" id="link-hint" style="margin-bottom:.6rem">Anyone with this link can view and respond to the quotation.</p>
    <input class="input mono" id="link-url" readonly>
    <div class="modal-foot">
      <button type="button" class="btn" data-close="link-modal">Close</button>
      <button type="button" class="btn btn-primary" id="link-copy">Copy</button>
    </div>
  </div>
</div>

<div class="modal" id="order-modal">
  <div class="modal-box wide">
    <div class="modal-head">
      <h2 id="order-modal-title">Order</h2>
      <button type="button" class="close" data-close="order-modal">&times;</button>
    </div>
    <div id="order-body">Loading...</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
  var TOKEN = localStorage.getItem('admin_token');
  if (!TOKEN) { location.href = '/admin/login'; }
  var ROLE = localStorage.getItem('admin_role') || 'admin';

  function decodeJwt(t) {
    try {
      var part = String(t || '').split('.')[1] || '';
      var s = part.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) { s = s + '='; }
      var bin = atob(s);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return {}; }
  }

  var ME = decodeJwt(TOKEN);
  if (ME.role) { ROLE = ME.role; }
  var IS_SUPER = ROLE === 'super_admin';

  var QUOTE_STATUS = {
    draft: 'Draft', sent: 'Sent', accepted: 'Accepted',
    changes_requested: 'Changes requested', rejected: 'Rejected', expired: 'Expired'
  };
  var QUOTE_BADGE = {
    draft: 'gray', sent: 'blue', accepted: 'green',
    changes_requested: 'amber', rejected: 'red', expired: 'gray'
  };
  var ORDER_STATUS = {
    placed: 'Placed', confirmed: 'Confirmed', in_production: 'In production',
    ready: 'Ready to ship', shipped: 'Shipped', delivered: 'Delivered',
    completed: 'Completed', cancelled: 'Cancelled'
  };
  var ORDER_BADGE = {
    placed: 'blue', confirmed: 'blue', in_production: 'amber', ready: 'amber',
    shipped: 'blue', delivered: 'green', completed: 'green', cancelled: 'red'
  };
  var PAYMENT = { unpaid: 'Unpaid', deposit_paid: 'Deposit paid', paid: 'Paid', refunded: 'Refunded' };
  var PAY_BADGE = { unpaid: 'gray', deposit_paid: 'amber', paid: 'green', refunded: 'red' };
  // 与 src/utils/order-state.js 的状态机保持一致；前端只渲染允许的迁移按钮，真正拦截仍在服务端
  var NEXT_STATUS = {
    placed: ['confirmed', 'cancelled'],
    confirmed: ['in_production', 'cancelled'],
    in_production: ['ready', 'cancelled'],
    ready: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: ['completed'],
    completed: [],
    cancelled: []
  };

  var NF = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var VIEW_TITLE = { overview: 'Overview', quotes: 'Quotations', orders: 'Orders' };
  var VIEW_SUB = {
    overview: 'Quotations, orders and shipments in one place.',
    quotes: 'Draft, send and track quotations. Sending generates a customer link.',
    orders: 'Fulfilment board. Advance status, record tracking and payments.'
  };

  var quoteState = { status: '', q: '', rows: [] };
  var orderState = { status: '', payment: '', q: '', rows: [] };
  var editorItems = [];
  var currentOrder = null;

  function $(id) { return document.getElementById(id); }

  function toast(msg, kind) {
    var el = $('toast');
    el.textContent = String(msg || '');
    el.className = 'toast show ' + (kind === 'err' ? 'err' : 'ok');
    setTimeout(function () { el.className = 'toast ' + (kind === 'err' ? 'err' : 'ok'); }, 2600);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function errBox(msg) {
    return '<div class="err-box">' + esc(msg || 'Something went wrong.') + '</div>';
  }

  function money(cur, v) {
    return (cur || 'USD') + ' ' + NF.format(Number(v) || 0);
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function monthKey() { return today().slice(0, 7); }

  function dateOnly(v) {
    return v ? String(v).slice(0, 10) : '-';
  }

  function dateVal(v) {
    return v ? String(v).slice(0, 10) : '';
  }

  function trimOrNull(v) {
    var s = String(v == null ? '' : v).trim();
    return s ? s : null;
  }

  function val(id) {
    var el = $(id);
    return el ? String(el.value == null ? '' : el.value).trim() : '';
  }

  function validEmail(v) {
    var s = String(v || '');
    var at = s.indexOf('@');
    if (at < 1 || s.indexOf(' ') >= 0 || s.indexOf('@', at + 1) >= 0) { return false; }
    return s.indexOf('.', at) > at + 1;
  }

  function badge(kind, text) {
    return '<span class="badge badge-' + (kind || 'gray') + '">' + esc(text) + '</span>';
  }

  function debounce(fn, ms) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ---------------- 统一 fetch 封装：Bearer token + 错误文案 ---------------- */

  var API_QUOTES = '/api/quotes';
  var API_ORDERS = '/api/orders';

  function apiUrl(path) {
    return path.indexOf('/api/') === 0 ? path : ('/api' + path);
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    var res;
    try {
      res = await fetch(apiUrl(path), Object.assign({}, opts, { headers: headers }));
    } catch (e) {
      var netErr = new Error('Network error - check your connection');
      netErr.status = 0;
      throw netErr;
    }
    var text = await res.text();
    var body = null;
    if (text) { try { body = JSON.parse(text); } catch (e2) { body = null; } }
    if (!res.ok) {
      var msg = (body && body.error) ? body.error : 'Request failed';
      var err = new Error(msg + ' (HTTP ' + res.status + ')');
      err.status = res.status;
      err.body = body;
      if (res.status === 401) {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_role');
        location.href = '/admin/login';
      }
      throw err;
    }
    return body || {};
  }

  /* ---------------- 模态框 / 视图切换 ---------------- */

  function openModal(id) {
    var m = $(id);
    if (!m) { return; }
    m.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    var m = $(id);
    if (!m) { return; }
    m.classList.remove('active');
    if (id === 'order-modal') { currentOrder = null; }
    if (!document.querySelector('.modal.active')) { document.body.style.overflow = ''; }
  }

  function switchView(name) {
    document.querySelectorAll('.side-link[data-view]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === name);
    });
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.getAttribute('data-view') === name);
    });
    $('page-title').textContent = VIEW_TITLE[name] || 'Trade';
    $('page-sub').textContent = VIEW_SUB[name] || '';
    if (name === 'overview') { loadOverview(); }
    if (name === 'quotes') { loadQuotes(); }
    if (name === 'orders') { loadOrders(); }
  }

  /* ---------------- Overview ---------------- */

  async function loadOverview() {
    $('ov-error').innerHTML = '';
    $('ov-open').textContent = '-';
    $('ov-accepted').textContent = '-';
    $('ov-active').textContent = '-';
    $('ov-value').innerHTML = '<span class="muted">Loading...</span>';
    $('ov-attention').innerHTML = '<tr><td colspan="5" class="empty">Loading...</td></tr>';

    try {
      var results = await Promise.all([api(API_QUOTES + '?limit=200'), api(API_ORDERS + '?limit=200')]);
      var quotes = (results[0] && results[0].data) || [];
      var orders = (results[1] && results[1].data) || [];
      var m = monthKey();

      var open = 0;
      var accepted = 0;
      quotes.forEach(function (q) {
        if (q.status === 'draft' || q.status === 'sent') { open++; }
        if (q.status === 'accepted' && String(q.accepted_at || q.created_at || '').slice(0, 7) === m) { accepted++; }
      });

      var active = 0;
      var byCurrency = {};
      orders.forEach(function (o) {
        if (o.status !== 'completed' && o.status !== 'cancelled') { active++; }
        if (o.status === 'cancelled') { return; }
        if (String(o.created_at || '').slice(0, 7) !== m) { return; }
        var c = o.currency || 'USD';
        byCurrency[c] = round2((byCurrency[c] || 0) + num(o.total));
      });

      $('ov-open').textContent = String(open);
      $('ov-accepted').textContent = String(accepted);
      $('ov-active').textContent = String(active);

      var keys = Object.keys(byCurrency).sort();
      $('ov-value').innerHTML = keys.length
        ? keys.map(function (c) {
            return '<div class="cur-line">' + esc(c) + ' ' + esc(NF.format(byCurrency[c])) + '</div>';
          }).join('')
        : '<span class="muted" style="font-size:.9rem">No orders this month</span>';

      renderAttention(quotes);
    } catch (e) {
      $('ov-value').innerHTML = '<span class="muted">-</span>';
      $('ov-attention').innerHTML = '<tr><td colspan="5" class="empty">Could not load.</td></tr>';
      $('ov-error').innerHTML = errBox(e.message);
    }
  }

  function renderAttention(quotes) {
    var t = today();
    var rows = quotes.filter(function (q) {
      return q.status === 'sent' && q.valid_until && String(q.valid_until).slice(0, 10) < t;
    }).sort(function (a, b) {
      return String(a.valid_until) < String(b.valid_until) ? -1 : 1;
    }).slice(0, 5);

    var tbody = $('ov-attention');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty">Nothing overdue - every sent quotation is still valid.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (q) {
      return '<tr>' +
        '<td class="mono">' + esc(q.quote_no) + '</td>' +
        '<td><div>' + esc(q.customer_company || q.customer_name || '-') + '</div>' +
          '<div class="muted">' + esc(q.customer_email) + '</div></td>' +
        '<td class="num">' + esc(money(q.currency, q.total)) + '</td>' +
        '<td class="muted">' + esc(dateOnly(q.valid_until)) + '</td>' +
        '<td><button type="button" class="btn btn-sm" data-attn="' + q.id + '">Open</button></td>' +
        '</tr>';
    }).join('');
  }

  $('ov-attention').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-attn]') : null;
    if (!b) { return; }
    openQuoteEditor(Number(b.getAttribute('data-attn')));
  });

  /* ---------------- Quotations 列表 ---------------- */

  async function loadQuotes() {
    var tbody = $('q-body');
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Loading...</td></tr>';
    $('q-error').innerHTML = '';

    var qs = [];
    if (quoteState.status) { qs.push('status=' + encodeURIComponent(quoteState.status)); }
    if (quoteState.q) { qs.push('q=' + encodeURIComponent(quoteState.q)); }
    qs.push('limit=50');

    try {
      var res = await api(API_QUOTES + '?' + qs.join('&'));
      quoteState.rows = res.data || [];
      renderQuotes();
    } catch (e) {
      quoteState.rows = [];
      tbody.innerHTML = '<tr><td colspan="7" class="empty">Could not load quotations.</td></tr>';
      $('q-error').innerHTML = errBox(e.message);
    }
  }

  function renderQuotes() {
    var tbody = $('q-body');
    if (!quoteState.rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No quotations yet. Click "+ New quotation" to draft one.</td></tr>';
      return;
    }
    tbody.innerHTML = quoteState.rows.map(function (q) {
      var acts = '<div class="actions">' +
        '<button type="button" class="btn btn-sm" data-act="edit" data-id="' + q.id + '">Edit</button>' +
        '<button type="button" class="btn btn-sm" data-act="send" data-id="' + q.id + '">Send</button>' +
        '<button type="button" class="btn btn-sm" data-act="pdf" data-id="' + q.id + '">PDF</button>' +
        '<button type="button" class="btn btn-sm" data-act="dup" data-id="' + q.id + '" title="Duplicate this quotation">Copy</button>' +
        '<button type="button" class="btn btn-sm" data-act="order" data-id="' + q.id + '" title="Create a sales order from this quotation">Order &rarr;</button>' +
        (IS_SUPER ? '<button type="button" class="btn btn-sm btn-danger" data-act="del" data-id="' + q.id + '" title="Delete this quotation">Del</button>' : '') +
        '</div>';
      return '<tr>' +
        '<td class="mono">' + esc(q.quote_no || '-') + '</td>' +
        '<td><div>' + esc(q.customer_company || q.customer_name || '-') + '</div>' +
          '<div class="muted">' + esc(q.customer_email) + '</div></td>' +
        '<td class="num">' + esc(money(q.currency, q.total)) + '</td>' +
        '<td>' + badge(QUOTE_BADGE[q.status], QUOTE_STATUS[q.status] || q.status || '-') + '</td>' +
        '<td class="muted">' + esc(dateOnly(q.valid_until)) + '</td>' +
        '<td class="muted">' + esc(dateOnly(q.created_at)) + '</td>' +
        '<td>' + acts + '</td>' +
        '</tr>';
    }).join('');
  }

  $('q-body').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) { return; }
    var id = Number(btn.getAttribute('data-id'));
    var act = btn.getAttribute('data-act');
    var q = null;
    quoteState.rows.forEach(function (r) { if (r.id === id) { q = r; } });
    if (!q) { return; }
    if (act === 'edit') { openQuoteEditor(id); }
    else if (act === 'send') { sendQuote(q); }
    else if (act === 'pdf') { fetchPdf(API_QUOTES + '/' + id + '/pdf', (q.quote_no || 'quote') + '.pdf'); }
    else if (act === 'dup') { duplicateQuote(q); }
    else if (act === 'order') { createOrderFromQuote(q); }
    else if (act === 'del') { deleteQuote(q); }
  });

  async function sendQuote(q) {
    if (q.token) { showLink(q.token, q.quote_no); return; }
    if (!confirm('Send ' + (q.quote_no || 'this quotation') + ' to ' + (q.customer_email || 'the customer') + '?')) { return; }
    try {
      var res = await api(API_QUOTES + '/' + q.id + '/send', { method: 'POST', body: '{}' });
      var data = (res && res.data) || {};
      toast('Quotation sent');
      if (data.token) { showLink(data.token, q.quote_no); }
      loadQuotes();
    } catch (e) { toast(e.message, 'err'); }
  }

  function showLink(token, quoteNo) {
    if (!token) { toast('No link token returned by the server', 'err'); return; }
    $('link-url').value = location.origin + '/quote/' + token;
    $('link-hint').textContent = quoteNo
      ? 'Customer link for ' + quoteNo + '. Anyone with this link can view and respond.'
      : 'Anyone with this link can view and respond to the quotation.';
    openModal('link-modal');
  }

  async function duplicateQuote(q) {
    try {
      var res = await api(API_QUOTES + '/' + q.id + '/duplicate', { method: 'POST', body: '{}' });
      var d = (res && res.data) || {};
      toast('Duplicated' + (d.quote_no ? ' as ' + d.quote_no : ''));
      loadQuotes();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function deleteQuote(q) {
    if (!confirm('Delete ' + (q.quote_no || 'this quotation') + '? This cannot be undone.')) { return; }
    try {
      await api(API_QUOTES + '/' + q.id, { method: 'DELETE' });
      toast('Quotation deleted');
      loadQuotes();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function createOrderFromQuote(q) {
    if (!confirm('Create an order from ' + (q.quote_no || 'this quotation') + '?')) { return; }
    try {
      var res = await api(API_ORDERS, { method: 'POST', body: JSON.stringify({ quote_id: q.id }) });
      var o = (res && res.data) || {};
      toast('Order created' + (o.order_no ? ': ' + o.order_no : ''));
      loadQuotes();
      if (o.id) { openOrderDetail(o.id); }
    } catch (e) {
      if (e.status === 409) {
        var raw = (e.body && e.body.error) ? String(e.body.error) : '';
        var found = raw.match(/SO-[0-9]+-[0-9]+/);
        toast(found ? ('Order already exists: ' + found[0]) : (raw || 'An order already exists for this quotation'), 'err');
      } else {
        toast(e.message, 'err');
      }
    }
  }

  // PDF 必须是二进制流，不能经过 api()（它会把响应体当 JSON 解析），所以单独走 fetch + blob
  async function fetchPdf(path, filename) {
    try {
      var res = await fetch(apiUrl(path), { headers: { 'Authorization': 'Bearer ' + TOKEN } });
      if (!res.ok) {
        var msg = 'PDF failed (HTTP ' + res.status + ')';
        try {
          var b = await res.json();
          if (b && b.error) { msg = b.error + ' (HTTP ' + res.status + ')'; }
        } catch (e2) { /* 非 JSON 响应就保留状态码提示 */ }
        throw new Error(msg);
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'document.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- 报价编辑器 ---------------- */

  function blankItem() {
    return { product_id: null, name: '', spec: '', qty: 1, unit: 'pcs', unit_price: 0 };
  }

  function defaultValidUntil() {
    var d = new Date(Date.now() + 30 * 86400000);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function resetQuoteForm() {
    $('q-id').value = '';
    $('q-email').value = '';
    $('q-name').value = '';
    $('q-company').value = '';
    $('q-country').value = '';
    $('q-currency').value = 'USD';
    $('q-incoterm').value = 'FOB';
    $('q-payment-terms').value = '';
    $('q-valid-until').value = defaultValidUntil();
    $('q-discount-type').value = '';
    $('q-discount-value').value = '0';
    $('q-tax-rate').value = '0';
    $('q-shipping').value = '0';
    $('q-notes').value = '';
    $('q-doc-terms').value = '';
    $('q-items').innerHTML = '';
    editorItems = [];
  }

  function fillQuoteForm(q) {
    $('q-id').value = q.id ? String(q.id) : '';
    $('q-email').value = q.customer_email || '';
    $('q-name').value = q.customer_name || '';
    $('q-company').value = q.customer_company || '';
    $('q-country').value = q.customer_country || '';
    $('q-currency').value = q.currency || 'USD';
    $('q-incoterm').value = q.incoterm || '';
    $('q-payment-terms').value = q.payment_terms || '';
    $('q-valid-until').value = dateVal(q.valid_until);
    $('q-discount-type').value = q.discount_type || '';
    $('q-discount-value').value = String(q.discount_value == null ? 0 : q.discount_value);
    $('q-tax-rate').value = String(q.tax_rate == null ? 0 : q.tax_rate);
    $('q-shipping').value = String(q.shipping_amount == null ? 0 : q.shipping_amount);
    $('q-notes').value = q.notes || '';
    $('q-doc-terms').value = q.terms || '';

    editorItems = (q.items || []).map(function (it) {
      return {
        product_id: it.product_id || null,
        name: it.name || '',
        spec: it.spec || '',
        qty: num(it.qty),
        unit: it.unit || 'pcs',
        unit_price: num(it.unit_price)
      };
    });
    if (!editorItems.length) { editorItems.push(blankItem()); }
    renderItems();
    renderTotals();
  }

  async function openQuoteEditor(id) {
    resetQuoteForm();
    if (!id) {
      $('quote-modal-title').textContent = 'New quotation';
      editorItems.push(blankItem());
      renderItems();
      renderTotals();
      openModal('quote-modal');
      return;
    }
    $('quote-modal-title').textContent = 'Edit quotation';
    try {
      var res = await api(API_QUOTES + '/' + id);
      fillQuoteForm((res && res.data) || {});
      openModal('quote-modal');
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderItems() {
    var tbody = $('q-items');
    var currency = $('q-currency').value || 'USD';
    tbody.innerHTML = editorItems.map(function (it, i) {
      return '<tr data-i="' + i + '">' +
        '<td><input class="input input-sm" data-f="name" value="' + esc(it.name) + '" placeholder="Product name"></td>' +
        '<td><input class="input input-sm" data-f="spec" value="' + esc(it.spec) + '" placeholder="Spec / model"></td>' +
        '<td><input class="input input-sm num" type="number" min="0" step="0.01" data-f="qty" value="' + esc(it.qty) + '"></td>' +
        '<td><input class="input input-sm" data-f="unit" value="' + esc(it.unit) + '"></td>' +
        '<td><input class="input input-sm num" type="number" min="0" step="0.01" data-f="unit_price" value="' + esc(it.unit_price) + '"></td>' +
        '<td class="num" data-amt="' + i + '">' + esc(money(currency, round2(num(it.qty) * num(it.unit_price)))) + '</td>' +
        '<td><button type="button" class="btn btn-sm btn-danger" data-del="' + i + '" title="Remove row">&times;</button></td>' +
        '</tr>';
    }).join('');
  }

  function updateLineAmount(i) {
    var cell = document.querySelector('[data-amt="' + i + '"]');
    var it = editorItems[i];
    if (!cell || !it) { return; }
    cell.textContent = money($('q-currency').value || 'USD', round2(num(it.qty) * num(it.unit_price)));
  }

  function addItemRow() {
    editorItems.push(blankItem());
    renderItems();
    renderTotals();
    var rows = $('q-items').querySelectorAll('tr');
    if (rows.length && rows[rows.length - 1].scrollIntoView) {
      rows[rows.length - 1].scrollIntoView({ block: 'nearest' });
    }
  }

  $('q-items').addEventListener('input', function (e) {
    var t = e.target;
    var f = t.getAttribute('data-f');
    if (!f) { return; }
    var tr = t.closest('tr');
    if (!tr) { return; }
    var i = Number(tr.getAttribute('data-i'));
    var it = editorItems[i];
    if (!it) { return; }
    if (f === 'qty' || f === 'unit_price') {
      it[f] = num(t.value);
      updateLineAmount(i);
    } else {
      it[f] = t.value;
    }
    renderTotals();
  });

  $('q-items').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-del]') : null;
    if (!b) { return; }
    var i = Number(b.getAttribute('data-del'));
    editorItems.splice(i, 1);
    if (!editorItems.length) { editorItems.push(blankItem()); }
    renderItems();
    renderTotals();
  });

  function calcTotals() {
    var currency = $('q-currency').value || 'USD';
    var subtotal = 0;
    editorItems.forEach(function (it) { subtotal += round2(num(it.qty) * num(it.unit_price)); });
    subtotal = round2(subtotal);

    var dtype = $('q-discount-type').value;
    var dvalue = num($('q-discount-value').value);
    var discount = 0;
    if (dtype === 'percent') { discount = round2(subtotal * dvalue / 100); }
    else if (dtype === 'amount') { discount = round2(dvalue); }

    var taxable = round2(subtotal - discount);
    var tax = round2(taxable * num($('q-tax-rate').value) / 100);
    var shipping = round2(num($('q-shipping').value));
    var total = round2(taxable + tax + shipping);

    return { currency: currency, subtotal: subtotal, discount: discount, tax: tax, shipping: shipping, total: total };
  }

  function renderTotals() {
    var t = calcTotals();
    $('t-sub').textContent = money(t.currency, t.subtotal);
    $('t-disc').textContent = '-' + money(t.currency, t.discount);
    $('t-tax').textContent = money(t.currency, t.tax);
    $('t-ship').textContent = money(t.currency, t.shipping);
    $('t-total').textContent = money(t.currency, t.total);
  }

  ['q-discount-type', 'q-discount-value', 'q-tax-rate', 'q-shipping'].forEach(function (id) {
    $(id).addEventListener('input', renderTotals);
    $(id).addEventListener('change', renderTotals);
  });

  $('q-currency').addEventListener('change', function () {
    editorItems.forEach(function (item, i) { updateLineAmount(i); });
    renderTotals();
  });

  $('q-add-row').addEventListener('click', addItemRow);

  $('quote-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    var email = val('q-email');
    if (!validEmail(email)) {
      toast('A valid customer email is required', 'err');
      $('q-email').focus();
      return;
    }

    var items = [];
    var missingName = -1;
    var badQty = -1;
    editorItems.forEach(function (it, i) {
      var name = String(it.name || '').trim();
      var spec = String(it.spec || '').trim();
      var qty = num(it.qty);
      var price = num(it.unit_price);
      if (!name && !spec && !qty && !price) { return; }
      if (!name) { if (missingName < 0) { missingName = i; } return; }
      if (!(qty > 0)) { if (badQty < 0) { badQty = i; } return; }
      items.push({
        product_id: it.product_id || null,
        name: name,
        spec: spec || null,
        qty: qty,
        unit: String(it.unit || 'pcs').trim() || 'pcs',
        unit_price: price
      });
    });
    if (missingName >= 0) { toast('Row ' + (missingName + 1) + ': name is required', 'err'); return; }
    if (badQty >= 0) { toast('Row ' + (badQty + 1) + ': qty must be greater than 0', 'err'); return; }
    if (!items.length) { toast('Add at least one line item', 'err'); return; }

    var payload = {
      customer_email: email,
      customer_name: trimOrNull($('q-name').value),
      customer_company: trimOrNull($('q-company').value),
      customer_country: trimOrNull($('q-country').value),
      currency: $('q-currency').value,
      incoterm: $('q-incoterm').value || null,
      payment_terms: trimOrNull($('q-payment-terms').value),
      valid_until: $('q-valid-until').value || null,
      discount_type: $('q-discount-type').value || null,
      discount_value: num($('q-discount-value').value),
      tax_rate: num($('q-tax-rate').value),
      shipping_amount: num($('q-shipping').value),
      notes: trimOrNull($('q-notes').value),
      terms: trimOrNull($('q-doc-terms').value),
      items: items
    };

    var id = $('q-id').value;
    var btn = $('q-save');
    btn.disabled = true;
    try {
      var res = await api(id ? (API_QUOTES + '/' + id) : API_QUOTES, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      var saved = (res && res.data) || {};
      toast(id ? 'Quotation updated' : ('Quotation created' + (saved.quote_no ? ': ' + saved.quote_no : '')));
      closeModal('quote-modal');
      loadQuotes();
    } catch (err) {
      toast(err.message, 'err');
    }
    btn.disabled = false;
  });

  $('link-copy').addEventListener('click', async function () {
    var v = $('link-url').value;
    try {
      await navigator.clipboard.writeText(v);
      toast('Link copied');
    } catch (e) {
      $('link-url').select();
      try { document.execCommand('copy'); toast('Link copied'); }
      catch (e2) { toast('Copy failed - select the link manually', 'err'); }
    }
  });

  /* ---------------- Orders 列表 ---------------- */

  async function loadOrders() {
    var tbody = $('o-body');
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Loading...</td></tr>';
    $('o-error').innerHTML = '';

    var qs = [];
    if (orderState.status) { qs.push('status=' + encodeURIComponent(orderState.status)); }
    if (orderState.payment) { qs.push('payment_status=' + encodeURIComponent(orderState.payment)); }
    if (orderState.q) { qs.push('q=' + encodeURIComponent(orderState.q)); }
    qs.push('limit=50');

    try {
      var res = await api(API_ORDERS + '?' + qs.join('&'));
      var rows = res.data || [];
      // 付款状态可能被后端忽略，这里兜一层，保证筛选结果一定正确
      if (orderState.payment) {
        rows = rows.filter(function (o) { return o.payment_status === orderState.payment; });
      }
      orderState.rows = rows;
      renderOrders();
    } catch (e) {
      orderState.rows = [];
      tbody.innerHTML = '<tr><td colspan="8" class="empty">Could not load orders.</td></tr>';
      $('o-error').innerHTML = errBox(e.message);
    }
  }

  function renderOrders() {
    var tbody = $('o-body');
    if (!orderState.rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">No orders yet. Create one from an accepted quotation.</td></tr>';
      return;
    }
    tbody.innerHTML = orderState.rows.map(function (o) {
      var tracking = o.tracking_no
        ? esc(o.tracking_no) + (o.carrier ? '<div class="muted">' + esc(o.carrier) + '</div>' : '')
        : '<span class="muted">-</span>';
      return '<tr>' +
        '<td class="mono">' + esc(o.order_no || '-') + '</td>' +
        '<td><div>' + esc(o.customer_company || o.customer_name || '-') + '</div>' +
          '<div class="muted">' + esc(o.customer_email) + '</div></td>' +
        '<td class="num">' + esc(money(o.currency, o.total)) + '</td>' +
        '<td>' + badge(ORDER_BADGE[o.status], ORDER_STATUS[o.status] || o.status || '-') + '</td>' +
        '<td>' + badge(PAY_BADGE[o.payment_status], PAYMENT[o.payment_status] || o.payment_status || '-') + '</td>' +
        '<td>' + tracking + '</td>' +
        '<td class="muted">' + esc(dateOnly(o.created_at)) + '</td>' +
        '<td><div class="actions">' +
          '<button type="button" class="btn btn-sm btn-primary" data-oact="view" data-id="' + o.id + '">View</button>' +
          '<button type="button" class="btn btn-sm" data-oact="pdf" data-id="' + o.id + '">PDF</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  }

  $('o-body').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-oact]') : null;
    if (!btn) { return; }
    var id = Number(btn.getAttribute('data-id'));
    var act = btn.getAttribute('data-oact');
    var o = null;
    orderState.rows.forEach(function (r) { if (r.id === id) { o = r; } });
    if (act === 'view') { openOrderDetail(id); }
    else if (act === 'pdf' && o) { fetchPdf(API_ORDERS + '/' + id + '/pdf', (o.order_no || 'order') + '.pdf'); }
  });

  /* ---------------- 订单详情 ---------------- */

  async function openOrderDetail(id) {
    $('order-body').innerHTML = '<p class="muted">Loading...</p>';
    $('order-modal-title').textContent = 'Order';
    openModal('order-modal');
    try {
      var res = await api(API_ORDERS + '/' + id);
      currentOrder = (res && res.data) || null;
      if (!currentOrder) {
        $('order-body').innerHTML = errBox('Order not found.');
        return;
      }
      $('order-modal-title').textContent = currentOrder.order_no || 'Order';
      renderOrderDetail(currentOrder);
    } catch (e) {
      $('order-body').innerHTML = errBox(e.message);
    }
  }

  function renderOrderDetail(o) {
    var cur = o.currency || 'USD';
    var html = '';

    html += '<div class="detail-head">' +
      '<div><div class="mono big">' + esc(o.order_no || '-') + '</div>' +
      '<div class="muted">Created ' + esc(dateOnly(o.created_at)) + '</div></div>' +
      '<div class="badges">' +
        badge(ORDER_BADGE[o.status], ORDER_STATUS[o.status] || o.status || '-') +
        badge(PAY_BADGE[o.payment_status], PAYMENT[o.payment_status] || o.payment_status || '-') +
      '</div>' +
    '</div>';

    html += '<div class="kv">' +
      '<div><span>Customer</span><b>' + esc(o.customer_name || '-') + '</b></div>' +
      '<div><span>Email</span><b>' + esc(o.customer_email || '-') + '</b></div>' +
      '<div><span>Company</span><b>' + esc(o.customer_company || '-') + '</b></div>' +
      '<div><span>Country</span><b>' + esc(o.customer_country || '-') + '</b></div>' +
      '<div><span>Incoterm</span><b>' + esc(o.incoterm || '-') + '</b></div>' +
      '<div><span>Payment terms</span><b>' + esc(o.payment_terms || '-') + '</b></div>' +
    '</div>';

    html += '<div class="md-totals">' +
      '<div><span>Order total</span><b>' + esc(money(cur, o.total)) + '</b></div>' +
      '<div><span>Deposit</span><b>' + esc(money(cur, o.deposit_amount)) + '</b></div>' +
      '<div><span>Deposit received</span><b>' + (o.deposit_paid ? 'Yes' : 'No') + '</b></div>' +
    '</div>';

    var items = o.items || [];
    html += '<div class="subhead">Line items</div>';
    if (!items.length) {
      html += '<p class="muted">No line items on this order.</p>';
    } else {
      html += '<div class="table-wrap"><table class="items"><thead><tr>' +
        '<th>Item</th><th>Spec</th><th class="num">Qty</th><th>Unit</th>' +
        '<th class="num">Unit price</th><th class="num">Amount</th>' +
        '</tr></thead><tbody>';
      items.forEach(function (it) {
        html += '<tr>' +
          '<td>' + esc(it.name) + '</td>' +
          '<td class="muted">' + esc(it.spec || '-') + '</td>' +
          '<td class="num">' + esc(String(num(it.qty))) + '</td>' +
          '<td>' + esc(it.unit || 'pcs') + '</td>' +
          '<td class="num">' + esc(money(cur, it.unit_price)) + '</td>' +
          '<td class="num">' + esc(money(cur, it.amount)) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    var nexts = NEXT_STATUS[o.status] || [];
    html += '<div class="subhead">Advance status</div>';
    if (!nexts.length) {
      html += '<p class="muted">' + esc(ORDER_STATUS[o.status] || o.status || '-') +
        ' is a final state - no further transitions are allowed.</p>';
    } else {
      html += '<div class="actions">';
      nexts.forEach(function (s) {
        html += '<button type="button" class="btn btn-sm ' + (s === 'cancelled' ? 'btn-danger' : 'btn-primary') +
          '" data-next="' + esc(s) + '">Mark ' + esc(ORDER_STATUS[s] || s) + '</button>';
      });
      html += '</div><p class="hint">Only transitions allowed by the order state machine are listed.</p>';
    }

    html += '<div class="subhead">Shipping</div>' +
      '<div class="grid2">' +
        '<div class="field"><label for="o-carrier">Carrier</label>' +
          '<input class="input" id="o-carrier" value="' + esc(o.carrier || '') + '" placeholder="DHL / Maersk"></div>' +
        '<div class="field"><label for="o-tracking-no">Tracking no</label>' +
          '<input class="input" id="o-tracking-no" value="' + esc(o.tracking_no || '') + '"></div>' +
        '<div class="field"><label for="o-tracking-url">Tracking URL</label>' +
          '<input class="input" id="o-tracking-url" value="' + esc(o.tracking_url || '') + '" placeholder="https://..."></div>' +
        '<div class="field"><label for="o-ship-date">Ship date</label>' +
          '<input class="input" type="date" id="o-ship-date" value="' + esc(dateVal(o.ship_date)) + '"></div>' +
        '<div class="field"><label for="o-eta">ETA</label>' +
          '<input class="input" type="date" id="o-eta" value="' + esc(dateVal(o.eta)) + '"></div>' +
        '<div class="field" style="display:flex;align-items:flex-end">' +
          '<button type="button" class="btn btn-primary" data-act="save-shipping">Save shipping</button></div>' +
      '</div>';

    var payOptions = '';
    ['unpaid', 'deposit_paid', 'paid', 'refunded'].forEach(function (k) {
      payOptions += '<option value="' + k + '"' + (o.payment_status === k ? ' selected' : '') + '>' +
        esc(PAYMENT[k]) + '</option>';
    });

    html += '<div class="subhead">Payment</div>' +
      '<div class="grid2">' +
        '<div class="field"><label for="o-payment">Payment status</label>' +
          '<select class="select" id="o-payment">' + payOptions + '</select></div>' +
        '<div class="field"><label for="o-deposit">Deposit amount</label>' +
          '<input class="input" type="number" min="0" step="0.01" id="o-deposit" value="' + esc(num(o.deposit_amount)) + '"></div>' +
        '<div class="field"><label>Deposit flag</label>' +
          '<label class="checkbox"><input type="checkbox" id="o-deposit-paid"' + (o.deposit_paid ? ' checked' : '') +
          '> Deposit received</label></div>' +
        '<div class="field" style="display:flex;align-items:flex-end">' +
          '<button type="button" class="btn btn-primary" data-act="save-payment">Save payment</button></div>' +
      '</div>';

    html += '<div class="subhead">Internal notes</div>';
    if (o.notes) { html += '<div class="note-box">' + esc(o.notes) + '</div>'; }
    html += '<textarea class="textarea" id="o-note" placeholder="Add a note - visible to staff only"></textarea>' +
      '<div style="margin-top:.5rem"><button type="button" class="btn btn-primary btn-sm" data-act="add-note">Add note</button></div>';

    var events = (o.events || []).slice().sort(function (a, b) {
      var x = String(a.created_at || '');
      var y = String(b.created_at || '');
      if (x === y) { return (a.id || 0) - (b.id || 0); }
      return x < y ? -1 : 1;
    });

    html += '<div class="subhead">Timeline</div>';
    if (!events.length) {
      html += '<p class="muted">No events recorded yet.</p>';
    } else {
      html += '<div class="timeline">';
      events.forEach(function (ev) {
        var label = 'Note';
        if (ev.type === 'status') {
          label = 'Status: ' + (ORDER_STATUS[ev.from_value] || ev.from_value || '-') + ' → ' +
            (ORDER_STATUS[ev.to_value] || ev.to_value || '-');
        } else if (ev.type === 'payment') {
          label = 'Payment: ' + (PAYMENT[ev.from_value] || ev.from_value || '-') + ' → ' +
            (PAYMENT[ev.to_value] || ev.to_value || '-');
        } else if (ev.type === 'shipping') {
          label = 'Shipping update';
        }
        html += '<div class="tl-item">' +
          '<div class="tl-meta">' + esc(ev.type || 'event') + ' &middot; ' + esc(ev.admin_user || 'system') +
            ' &middot; ' + esc(String(ev.created_at || '')) + '</div>' +
          '<div class="tl-body">' + esc(label) + '</div>' +
          (ev.message ? '<div class="tl-msg">' + esc(ev.message) + '</div>' : '') +
          '</div>';
      });
      html += '</div>';
    }

    $('order-body').innerHTML = html;
  }

  $('order-body').addEventListener('click', function (e) {
    var nx = e.target.closest ? e.target.closest('button[data-next]') : null;
    if (nx) { advanceStatus(nx.getAttribute('data-next')); return; }
    var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!btn) { return; }
    var act = btn.getAttribute('data-act');
    if (act === 'save-shipping') { saveShipping(); }
    else if (act === 'save-payment') { savePayment(); }
    else if (act === 'add-note') { addNote(); }
  });

  async function advanceStatus(next) {
    var o = currentOrder;
    if (!o) { return; }
    var label = ORDER_STATUS[next] || next;
    if (!confirm('Move ' + (o.order_no || 'this order') + ' to "' + label + '"?')) { return; }
    var msg = prompt('Optional note for the timeline (leave empty to skip):', '');
    if (msg === null) { msg = ''; }
    var payload = { status: next };
    if (String(msg).trim()) { payload.message = String(msg).trim(); }
    try {
      await api(API_ORDERS + '/' + o.id + '/status', { method: 'PUT', body: JSON.stringify(payload) });
      toast('Status changed to ' + label);
      await openOrderDetail(o.id);
      loadOrders();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function saveShipping() {
    var o = currentOrder;
    if (!o) { return; }
    var payload = {
      carrier: trimOrNull(val('o-carrier')),
      tracking_no: trimOrNull(val('o-tracking-no')),
      tracking_url: trimOrNull(val('o-tracking-url')),
      ship_date: val('o-ship-date') || null,
      eta: val('o-eta') || null
    };
    try {
      await api(API_ORDERS + '/' + o.id, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Shipping saved');
      await openOrderDetail(o.id);
      loadOrders();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function savePayment() {
    var o = currentOrder;
    if (!o) { return; }
    var payload = {
      payment_status: val('o-payment'),
      deposit_amount: num(val('o-deposit')),
      deposit_paid: $('o-deposit-paid').checked ? 1 : 0
    };
    try {
      await api(API_ORDERS + '/' + o.id, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Payment updated');
      await openOrderDetail(o.id);
      loadOrders();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function addNote() {
    var o = currentOrder;
    if (!o) { return; }
    var message = val('o-note');
    if (!message) { toast('Write a note first', 'err'); return; }
    try {
      await api(API_ORDERS + '/' + o.id + '/events', {
        method: 'POST',
        body: JSON.stringify({ type: 'note', message: message })
      });
      toast('Note added');
      await openOrderDetail(o.id);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------------- 筛选 / 导航 / 启动 ---------------- */

  document.querySelectorAll('.side-link[data-view]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      switchView(a.getAttribute('data-view'));
    });
  });

  $('q-filter-status').addEventListener('change', function () {
    quoteState.status = this.value;
    loadQuotes();
  });

  $('q-search').addEventListener('input', debounce(function () {
    quoteState.q = val('q-search');
    loadQuotes();
  }, 300));

  $('q-new').addEventListener('click', function () { openQuoteEditor(null); });

  $('o-filter-status').addEventListener('change', function () {
    orderState.status = this.value;
    loadOrders();
  });

  $('o-filter-payment').addEventListener('change', function () {
    orderState.payment = this.value;
    loadOrders();
  });

  $('o-search').addEventListener('input', debounce(function () {
    orderState.q = val('o-search');
    loadOrders();
  }, 300));

  document.querySelectorAll('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { closeModal(b.getAttribute('data-close')); });
  });

  document.querySelectorAll('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) {
      if (e.target === m) { closeModal(m.id); }
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') { return; }
    var open = document.querySelector('.modal.active');
    if (open) { closeModal(open.id); }
  });

  function logout() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
    location.href = '/admin/login';
  }

  $('logout-btn').addEventListener('click', logout);
  $('logout-link').addEventListener('click', function (e) {
    e.preventDefault();
    logout();
  });

  $('admin-name').textContent = ME.username || 'Admin';

  if (TOKEN) { switchView('overview'); }
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}
