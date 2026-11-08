/**
 * Admin Dashboard Page
 * Main admin interface for managing products and inquiries
 */
import { supportedLangs, LANG_META } from '../i18n';

/** 多语言可编辑字段（与 products.translations 的键一致） */
const TR_FIELDS = [
  ['name', 'Product Name', 'input'],
  ['description', 'Short Description', 'textarea'],
  ['detailed_description', 'Detailed Description', 'textarea'],
  ['specifications', 'Specifications', 'textarea'],
  ['seo_title', 'SEO Title', 'input'],
  ['seo_description', 'SEO Description', 'textarea'],
];

export async function adminDashboard(request, env) {
  const defLang = env.DEFAULT_LANG || 'en';
  const trLangs = supportedLangs(env).filter(l => l !== defLang);

  // 一键翻译的「原文语言」下拉。默认 auto：按主表单里汉字/拉丁字母比例自动判中文或英文，
  // 运营用中文或英文发布都不用手动切；也可强制指定（例如原文其实是西语）。
  const sourceLangs = supportedLangs(env).map(l => ({
    code: l, name: (LANG_META[l] && LANG_META[l].name) || l,
  }));
  const sourceOptions = [{ code: 'auto', name: '自动检测（中文 / English）' }, ...sourceLangs]
    .map(o => `<option value="${o.code}">${o.name}</option>`).join('');

  // 服务端预渲染多语言 Tab（运营不用手写 JSON）
  const trTabs = trLangs.map(l => {
    const meta = LANG_META[l] || {};
    const label = meta.name || l.toUpperCase();
    const active = l === trLangs[0];
    return `<button type="button" class="tr-tab${active ? ' active' : ''}" data-lang="${l}" onclick="switchTrTab('${l}')">${label}<span class="dot" style="display:none"></span></button>`;
  }).join('');

  const trPanes = trLangs.map((l, i) => {
    const meta = LANG_META[l] || {};
    const fields = TR_FIELDS.map(([field, label, kind]) => {
      const id = `tr-${l}-${field}`;
      const ph = kind === 'input' ? '' : ` placeholder="留空则回退英文"`;
      const control = kind === 'input'
        ? `<input type="text" id="${id}" class="form-input" data-tr-field="${field}" oninput="onTrInput()">`
        : `<textarea id="${id}" class="form-textarea" data-tr-field="${field}" style="min-height:70px"${ph} oninput="onTrInput()"></textarea>`;
      return `<div class="form-group" style="margin-bottom:1rem">
            <label class="form-label" for="${id}" style="font-size:.85rem">${label} (${meta.name || l})</label>
            ${control}
          </div>`;
    }).join('');
    return `<div class="tr-pane" data-lang-pane="${l}" style="display:${i === 0 ? 'block' : 'none'}"${meta.locale && ['ar', 'he', 'fa', 'ur'].includes(l) ? ' dir="rtl"' : ''}>${fields}</div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard - B2B Product Exhibition</title>
  <style>
    /* Main Stylesheet for B2B Website */

    :root {
      --primary-color: #2563eb;
      --secondary-color: #1e40af;
      --accent-color: #f59e0b;
      --text-dark: #1f2937;
      --text-light: #6b7280;
      --bg-light: #f9fafb;
      --border-color: #e5e7eb;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: var(--text-dark);
      background: #ffffff;
    }

    /* Buttons */
    .btn {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      border-radius: 0.375rem;
      text-decoration: none;
      font-weight: 600;
      transition: all 0.3s;
      border: none;
      cursor: pointer;
    }

    .btn-primary {
      background: var(--primary-color);
      color: white;
    }

    .btn-primary:hover {
      background: var(--secondary-color);
    }

    .btn-secondary {
      background: var(--accent-color);
      color: white;
    }

    .btn-secondary:hover {
      background: #d97706;
    }

    /* Grid Layout */
    .grid {
      display: grid;
      gap: 2rem;
    }

    .grid-3 {
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    }

    /* Admin specific styles */
    .admin-layout {
      display: flex;
      min-height: 100vh;
    }
    .admin-sidebar {
      width: 250px;
      background: var(--text-dark);
      color: white;
      padding: 2rem 0;
      position: fixed;
      height: 100vh;
      overflow-y: auto;
    }
    .admin-content {
      flex: 1;
      margin-left: 250px;
      padding: 2rem;
      background: var(--bg-light);
      min-height: 100vh;
    }
    .admin-header {
      background: white;
      padding: 1.5rem 2rem;
      margin: -2rem -2rem 2rem -2rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .sidebar-nav {
      list-style: none;
    }
    .sidebar-nav li {
      margin: 0;
    }
    .sidebar-nav a {
      display: flex;
      align-items: center;
      padding: 1rem 2rem;
      color: #9ca3af;
      text-decoration: none;
      transition: all 0.3s;
    }
    .sidebar-nav a:hover,
    .sidebar-nav a.active {
      background: rgba(255,255,255,0.1);
      color: white;
    }
    .stat-card {
      background: white;
      padding: 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat-card h3 {
      color: var(--text-light);
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
    }
    .stat-card .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--primary-color);
    }
    .table-container {
      background: white;
      border-radius: 0.5rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
    }
    .table th {
      background: var(--bg-light);
      padding: 1rem;
      text-align: left;
      font-weight: 600;
      color: var(--text-dark);
      border-bottom: 2px solid var(--border-color);
    }
    .table td {
      padding: 1rem;
      border-bottom: 1px solid var(--border-color);
    }
    .table tr:hover {
      background: var(--bg-light);
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 1rem;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .badge-pending {
      background: #fef3c7;
      color: #92400e;
    }
    .badge-processing {
      background: #dbeafe;
      color: #1e40af;
    }
    .badge-completed {
      background: #d1fae5;
      color: #065f46;
    }
    .tab-nav {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 2rem;
      border-bottom: 2px solid var(--border-color);
    }
    .tab-btn {
      padding: 1rem 1.5rem;
      background: none;
      border: none;
      border-bottom: 3px solid transparent;
      color: var(--text-light);
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s;
    }
    .tab-btn:hover {
      color: var(--primary-color);
    }
    .tab-btn.active {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }

    /* Modal Styles */
    .modal {
      display: none;
      position: fixed;
      z-index: 10000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      overflow-y: auto;
    }

    .modal.active {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .modal-content {
      background-color: white;
      padding: 2rem;
      border-radius: 0.5rem;
      width: 100%;
      max-width: 600px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border-color);
    }

    .modal-header h2 {
      font-size: 1.5rem;
      color: var(--text-dark);
    }

    .modal-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: var(--text-light);
      padding: 0;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-close:hover {
      color: var(--text-dark);
    }

    .form-group {
      margin-bottom: 1.5rem;
    }

    .form-label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
      color: var(--text-dark);
    }

    .form-input,
    .form-textarea,
    .form-select {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 0.375rem;
      font-size: 1rem;
      transition: border-color 0.3s;
    }

    .form-input:focus,
    .form-textarea:focus,
    .form-select:focus {
      outline: none;
      border-color: var(--primary-color);
    }

    .form-textarea {
      resize: vertical;
      min-height: 100px;
    }

    /* 多语言 Tab（阶段一A） */
    .tr-tabs {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 0.9rem;
    }

    .tr-tab {
      border: none;
      background: none;
      padding: 0.45rem 0.8rem;
      cursor: pointer;
      font-size: 0.9rem;
      color: var(--text-light);
      border-bottom: 2px solid transparent;
      border-radius: 0.25rem 0.25rem 0 0;
    }

    .tr-tab:hover { background: var(--bg-light); }

    .tr-tab.active {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
      font-weight: 600;
      background: var(--bg-light);
    }

    .tr-tab .dot {
      display: inline-block;
      width: 0.45rem;
      height: 0.45rem;
      border-radius: 50%;
      background: #10b981;
      margin-inline-start: 0.35rem;
      vertical-align: middle;
    }

    .tr-pane { padding-top: 0.25rem; }
    .tr-hint { font-size: 0.78rem; color: var(--text-light); margin-bottom: 0.5rem; }

    /* 阶段二A：意向等级与跟进时间线 */
    .pri { display: inline-block; padding: 1px 8px; border-radius: 9px; font-size: 0.72rem; color: #fff; }
    .pri-hot { background: #dc2626; }
    .pri-warm { background: #f59e0b; }
    .pri-cold { background: #6b7280; }

    .inq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem 1.5rem; font-size: 0.88rem; }
    .inq-grid dt { color: var(--text-light); font-size: 0.78rem; }
    .inq-grid dd { margin: 0 0 0.5rem; word-break: break-word; }

    .timeline { border-left: 2px solid var(--border-color); margin: 0.75rem 0 0 0.4rem; padding-left: 1rem; }
    .tl-item { position: relative; padding-bottom: 0.9rem; }
    .tl-item::before {
      content: ''; position: absolute; left: -1.42rem; top: 4px;
      width: 9px; height: 9px; border-radius: 50%; background: #2563eb;
    }
    .tl-item.is-done::before { background: #059669; }
    .tl-meta { font-size: 0.74rem; color: var(--text-light); }
    .tl-body { font-size: 0.88rem; white-space: pre-wrap; word-break: break-word; }
    .tl-due { font-size: 0.74rem; color: #b45309; }

    .form-checkbox {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .form-checkbox input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border-color);
    }

    .btn-cancel {
      background: #6b7280;
      color: white;
    }

    .btn-cancel:hover {
      background: #4b5563;
    }

    .image-upload-container {
      margin-bottom: 1.5rem;
    }

    .image-preview {
      margin-top: 1rem;
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }

    .image-preview img {
      max-width: 200px;
      max-height: 200px;
      border-radius: 0.375rem;
      border: 1px solid var(--border-color);
      object-fit: cover;
    }

    .upload-btn-wrapper {
      position: relative;
      overflow: hidden;
      display: inline-block;
    }

    .upload-btn-wrapper input[type=file] {
      position: absolute;
      left: 0;
      top: 0;
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }

    .btn-upload {
      background: var(--primary-color);
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      border: none;
      cursor: pointer;
      font-weight: 500;
      transition: background 0.3s;
    }

    .btn-upload:hover {
      background: var(--secondary-color);
    }

    .uploading {
      color: var(--primary-color);
      font-size: 0.9rem;
      margin-top: 0.5rem;
    }

    @media (max-width: 768px) {
      .admin-sidebar {
        width: 100%;
        height: auto;
        position: relative;
      }
      .admin-content {
        margin-left: 0;
      }
    }
  </style>
</head>
<body>
  <div class="admin-layout">
    <!-- Sidebar -->
    <aside class="admin-sidebar">
      <div style="padding: 0 2rem 2rem 2rem;">
        <h2 style="color: var(--accent-color); font-size: 1.5rem;">B2B Admin</h2>
      </div>
      <ul class="sidebar-nav">
        <li><a href="#" data-tab="overview" class="active">📊 Overview</a></li>
        <li><a href="#" data-tab="products">📦 Products</a></li>
        <li><a href="#" data-tab="inquiries">💬 Inquiries</a></li>
        <li><a href="#" data-tab="seo">🔍 SEO</a></li>
        <li><a href="/admin/content/posts">📝 Content</a></li>
        <li><a href="/admin/trade">🧾 Quotes &amp; Orders</a></li>
        <li><a href="#" data-tab="settings">⚙️ Settings</a></li>
        <li><a href="#" id="logout-btn">🚪 Logout</a></li>
      </ul>
    </aside>

    <!-- Main Content -->
    <main class="admin-content">
      <div class="admin-header">
        <div>
          <h1 style="font-size: 1.5rem; margin-bottom: 0.25rem;">Dashboard</h1>
          <p style="color: var(--text-light); font-size: 0.9rem;">
            Welcome back, <span id="admin-username">Admin</span>
            <span id="admin-role-indicator" style="margin-left: 0.5rem; padding: 0.25rem 0.5rem; background: var(--primary-color); color: white; border-radius: 0.25rem; font-size: 0.75rem;">Loading...</span>
          </p>
        </div>
        <div style="display: flex; gap: 1rem;">
          <a href="/" target="_blank" class="btn btn-primary" style="text-decoration: none; display: flex; align-items: center; ">
            Preview
          </a>
          <button id="logout-btn-header" class="btn btn-secondary">Logout</button>
        </div>
      </div>

      <!-- Overview Tab -->
      <div id="overview-tab" class="tab-content active">
        <div class="grid grid-3" style="margin-bottom: 2rem;">
          <div class="stat-card">
            <h3>Total Products</h3>
            <div class="stat-value" id="stat-products">0</div>
          </div>
          <div class="stat-card">
            <h3>Total Inquiries</h3>
            <div class="stat-value" id="stat-inquiries">0</div>
          </div>
          <div class="stat-card">
            <h3>Pending Inquiries</h3>
            <div class="stat-value" id="stat-pending">0</div>
          </div>
        </div>

        <!-- 阶段二A：CRM 概览。待跟进是唯一需要「今天就动手」的数字，单独突出。 -->
        <div class="grid grid-3" style="margin-bottom: 2rem;">
          <div class="stat-card" id="stat-followup-card" style="cursor:pointer;border-left:4px solid #dc2626">
            <h3>Follow-ups Due</h3>
            <div class="stat-value" id="stat-followup">0</div>
            <div class="tr-hint" style="margin:0.35rem 0 0">Click to open the list</div>
          </div>
          <div class="stat-card">
            <h3>Customers</h3>
            <div class="stat-value" id="stat-customers">0</div>
          </div>
          <div class="stat-card">
            <h3>Won This Month</h3>
            <div class="stat-value" id="stat-won">0</div>
          </div>
        </div>

        <h2 style="font-size: 1.25rem; margin-bottom: 1rem; color: var(--text-dark);">Recent Inquiries</h2>
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Product</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody id="recent-inquiries-tbody">
              <tr><td colspan="5" style="text-align: center;">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Products Tab -->
      <div id="products-tab" class="tab-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h2 style="font-size: 1.25rem; color: var(--text-dark);">Manage Products</h2>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <button id="product-export-btn" class="btn" style="background:#059669;color:#fff">Export CSV</button>
            <button id="product-import-btn" class="btn" style="background:#2563eb;color:#fff">Import CSV</button>
            <input type="file" id="product-import-file" accept=".csv,text/csv" style="display:none">
            <button id="add-product-btn" class="btn btn-primary">+ Add Product</button>
          </div>
        </div>
        <p style="font-size:0.8rem;color:var(--text-light);margin:-0.75rem 0 1rem">
          Import matches by <code>slug</code> first, then <code>name</code> — export, edit the prices, import back and nothing gets duplicated.
          <code>gallery_images</code> / <code>related_ids</code> accept <code>a|b|c</code>; leave a cell empty to keep the existing value.
        </p>
        <div class="table-container">
          <div id="products-list">Loading...</div>
        </div>
      </div>

      <!-- Inquiries Tab -->
      <div id="inquiries-tab" class="tab-content">
        <h2 style="font-size: 1.25rem; margin-bottom: 1.5rem; color: var(--text-dark);">Manage Inquiries</h2>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center">
          <select id="inquiry-status-filter" class="form-input" style="max-width:190px">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="quoted">Quoted</option>
            <option value="completed">Completed</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="spam">Spam</option>
          </select>
          <input id="inquiry-search" class="form-input" placeholder="Search name / email / company" style="max-width:260px">
          <button type="button" id="inquiry-refresh" class="btn btn-primary">Refresh</button>
          <button type="button" id="inquiry-export" class="btn" style="background:#059669;color:#fff">Export CSV</button>
          <span style="font-size:.8rem;color:var(--text-light)">New inquiries trigger an email via Queue → Resend.</span>
        </div>
        <div class="table-container">
          <div id="inquiries-list">Loading...</div>
        </div>
      </div>

      <!-- Settings Tab -->
      <div id="settings-tab" class="tab-content">
        <h2 style="font-size: 1.25rem; margin-bottom: 1.5rem; color: var(--text-dark);">Website Settings</h2>
        <div style="background: white; padding: 2rem; border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 800px;">
          <form id="settings-form">
            <h3 style="font-size: 1.1rem; margin-bottom: 1rem; color: var(--primary-color); border-bottom: 2px solid var(--border-color); padding-bottom: 0.5rem;">
              Basic Information
            </h3>

            <div class="form-group">
              <label class="form-label" for="settings-site-name">Website Name</label>
              <input type="text" id="settings-site-name" name="site_name" class="form-input" placeholder="GlobalMart">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-site-description">Website Description</label>
              <textarea id="settings-site-description" name="site_description" class="form-textarea" placeholder="Your trusted partner for high-quality industrial products..."></textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-company-intro">Company Introduction</label>
              <textarea id="settings-company-intro" name="company_intro" class="form-textarea" placeholder="We are a leading manufacturer and supplier..."></textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-theme">Site Theme</label>
              <select id="settings-theme" name="theme_default" class="form-input">
                <option value="classic">Industrial Blue — general machinery, pumps, valves (default)</option>
                <option value="ocean">Deep Ocean — water treatment, environmental, marine</option>
                <option value="ember">Forge Orange — heavy machinery, welding, mining, building materials</option>
                <option value="forest">Machine Green — chemical, energy, agricultural machinery</option>
                <option value="midnight">Midnight Tech — instruments, electronics, automation (dark)</option>
                <option value="mono">Graphite — premium customisation, design-led catalogues</option>
                <option value="auto">Night (auto) — follow the visitor's system dark/light, midnight at night &amp; classic by day</option>
              </select>
              <div style="font-size:.8rem;color:var(--text-light);margin-top:.35rem;line-height:1.5">
                What first-time visitors see. Anyone can override it with the palette button in the header,
                and their pick is remembered in that browser. Saves to KV — no redeploy needed.
              </div>
            </div>

            <h3 style="font-size: 1.1rem; margin: 2rem 0 1rem; color: var(--primary-color); border-bottom: 2px solid var(--border-color); padding-bottom: 0.5rem;">
              Contact Information
            </h3>

            <div class="form-group">
              <label class="form-label" for="settings-email">Email</label>
              <input type="email" id="settings-email" name="email" class="form-input" placeholder="info@example.com">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-phone">Phone</label>
              <input type="text" id="settings-phone" name="phone" class="form-input" placeholder="+1 234 567 8900">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-address">Address</label>
              <input type="text" id="settings-address" name="address" class="form-input" placeholder="123 Business St, City, Country">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-business-hours">Business Hours</label>
              <textarea id="settings-business-hours" name="business_hours" class="form-textarea" rows="3" placeholder="Monday - Friday: 9:00 AM - 6:00 PM&#10;Saturday: 10:00 AM - 4:00 PM&#10;Sunday: Closed"></textarea>
              <small style="color:#6b7280">One line per row; shown on the Contact page. Leave empty to keep the default Mon-Fri schedule.</small>
            </div>

            <h3 style="font-size: 1.1rem; margin: 2rem 0 1rem; color: var(--primary-color); border-bottom: 2px solid var(--border-color); padding-bottom: 0.5rem;">
              Payment &amp; Banking
            </h3>
            <p class="tr-hint" style="margin-top:-0.5rem">
              Printed on order PDFs and returned by the payment API when Stripe is not configured.
              Leave everything blank and documents will say "contact sales for bank details".
            </p>

            <div class="form-group">
              <label class="form-label" for="settings-beneficiary">Beneficiary Name</label>
              <input type="text" id="settings-beneficiary" name="beneficiary" class="form-input" placeholder="GlobalMart Industrial Co., Ltd.">
              <small style="color:#6b7280">Defaults to the website name when empty.</small>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-bank-name">Bank Name</label>
              <input type="text" id="settings-bank-name" name="bank_name" class="form-input" placeholder="Bank of China, Guangzhou Branch">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-bank-account">Account Number</label>
              <input type="text" id="settings-bank-account" name="bank_account" class="form-input" placeholder="6013 8200 0000 0000 000">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-swift">SWIFT / BIC</label>
              <input type="text" id="settings-swift" name="swift" class="form-input" placeholder="BKCHCNBJ400">
            </div>

            <h3 style="font-size: 1.1rem; margin: 2rem 0 1rem; color: var(--primary-color); border-bottom: 2px solid var(--border-color); padding-bottom: 0.5rem;">
              Social Media Links
            </h3>

            <div class="form-group">
              <label class="form-label" for="settings-linkedin">LinkedIn URL</label>
              <input type="url" id="settings-linkedin" name="linkedin" class="form-input" placeholder="https://linkedin.com/company/yourcompany">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-facebook">Facebook URL</label>
              <input type="url" id="settings-facebook" name="facebook" class="form-input" placeholder="https://facebook.com/yourcompany">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-twitter">Twitter URL</label>
              <input type="url" id="settings-twitter" name="twitter" class="form-input" placeholder="https://twitter.com/yourcompany">
            </div>

            <!-- 阶段一C：直接决定询盘量与转化追踪 -->
            <div style="margin:1.75rem 0 0.25rem;padding-top:1.25rem;border-top:1px solid var(--border-color)">
              <strong style="font-size:0.9rem;color:var(--text-dark)">Conversion &amp; Tracking</strong>
              <p class="tr-hint">WhatsApp 悬浮球只填号码（含国家码，不要 + 和空格）。GA4 在未配置时不注入任何脚本。</p>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-whatsapp">WhatsApp Number</label>
              <input type="text" id="settings-whatsapp" name="whatsapp" class="form-input" placeholder="8613800000000">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-ga4">GA4 Measurement ID</label>
              <input type="text" id="settings-ga4" name="ga4_id" class="form-input" placeholder="G-XXXXXXXXXX">
              <small style="color:#6b7280">也可用环境变量 <code>GA4_ID</code> 覆盖；该变量优先。</small>
            </div>

            <!-- 阶段一B：About 页 Quick Facts -->
            <div style="margin:1.75rem 0 0.25rem;padding-top:1.25rem;border-top:1px solid var(--border-color)">
              <strong style="font-size:0.9rem;color:var(--text-dark)">Company Quick Facts</strong>
              <p class="tr-hint">Shown on the About page. Numbers build trust with first-time buyers.</p>
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-founded-at">Founded Year</label>
              <input type="text" id="settings-founded-at" name="founded_at" class="form-input" placeholder="2008">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-employees">Employees</label>
              <input type="text" id="settings-employees" name="employees" class="form-input" placeholder="150+">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-countries">Countries Served</label>
              <input type="text" id="settings-countries" name="countries_served" class="form-input" placeholder="40+">
            </div>

            <div class="form-group">
              <label class="form-label" for="settings-capacity">Annual Capacity</label>
              <input type="text" id="settings-capacity" name="annual_capacity" class="form-input" placeholder="500,000 pcs / year">
            </div>

            <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color);">
              <button type="submit" id="save-settings-btn" class="btn btn-primary" style="margin-right: 1rem;">Save Settings</button>
              <button type="button" class="btn btn-secondary" onclick="loadSettings()">Reset</button>
            </div>
          </form>

          <!-- 1.4.0 翻译引擎设置：刻意放在 settings-form 之外，
               避免 API Key 混进通用设置提交（那条链路是公开可读的 KV 数据） -->
          <div id="translation-card" style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border-color)">
            <h3 style="font-size:1.1rem;margin-bottom:.35rem;color:var(--primary-color)">Translation Engine / 翻译引擎</h3>
            <p class="tr-hint" style="margin:0 0 1rem">
              Choose what powers the "一键生成译文" button. API keys are encrypted before they touch KV and are never sent back to the browser.
            </p>

            <div class="form-group">
              <label class="form-label" for="tr-engine">Engine</label>
              <select id="tr-engine" class="form-input" onchange="onTranslationEngineChange()">
                <option value="workers_ai">Workers AI built-in model (default, free quota, zero API key)</option>
                <option value="openai">Custom OpenAI-compatible model</option>
              </select>
            </div>

            <div id="tr-openai-fields" style="display:none">
              <div class="form-group">
                <label class="form-label" for="tr-base-url">API Base URL</label>
                <input type="url" id="tr-base-url" class="form-input" placeholder="https://api.openai.com/v1" autocomplete="off">
                <div class="tr-hint" style="margin-top:.3rem">
                  Must be https + a public domain on port 443 (no IP / localhost / intranet).
                  Works with OpenAI, DeepSeek, OpenRouter, Cloudflare AI Gateway, etc.
                </div>
              </div>
              <div class="form-group">
                <label class="form-label" for="tr-model">Model</label>
                <input type="text" id="tr-model" class="form-input" placeholder="gpt-4o-mini" autocomplete="off">
              </div>
              <div class="form-group">
                <label class="form-label" for="tr-api-key">API Key</label>
                <input type="password" id="tr-api-key" class="form-input" placeholder="Leave blank to keep the saved key" autocomplete="new-password">
                <div id="tr-key-status" class="tr-hint" style="margin-top:.3rem">Checking…</div>
                <label style="display:flex;align-items:center;gap:.4rem;font-size:.82rem;margin-top:.4rem;color:var(--text-light)">
                  <input type="checkbox" id="tr-clear-key"> Clear the saved key
                </label>
              </div>
              <div class="form-group">
                <label class="form-label" for="tr-temperature">Temperature</label>
                <input type="number" id="tr-temperature" class="form-input" min="0" max="1" step="0.1" value="0.2">
              </div>
            </div>

            <div style="display:flex;flex-wrap:wrap;gap:.6rem;align-items:center">
              <button type="button" class="btn btn-primary" id="tr-save-btn" onclick="saveTranslationSettings()">Save engine settings</button>
              <button type="button" class="btn btn-secondary" id="tr-test-btn" onclick="testTranslationSettings()">Test connection</button>
              <span id="tr-engine-status" aria-live="polite" style="font-size:.82rem;color:var(--text-light)"></span>
            </div>
            <p class="tr-hint" style="margin:.7rem 0 0">
              "Test connection" makes one real model call (quota / billing applies). zh → zh-TW always uses the local converter and never calls any engine.
            </p>
          </div>

          <!-- 阶段二B：登录审计 -->
          <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border-color)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
              <div>
                <strong style="font-size:0.95rem">Recent sign-ins</strong>
                <p class="tr-hint" style="margin:0.25rem 0 0">
                  Last 100 attempts. 5 failed attempts within 15 minutes locks that username temporarily.
                </p>
              </div>
              <button type="button" class="btn btn-secondary" onclick="loadLoginLogs()">Refresh</button>
            </div>
            <div id="login-logs" class="table-container" style="max-height:320px;overflow:auto">
              <p style="padding:1rem;color:var(--text-light)">Loading...</p>
            </div>
          </div>

          <!-- 阶段二C：邮件模板（KV 覆盖，改话术不用重新部署） -->
          <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border-color)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
              <div>
                <strong style="font-size:0.95rem">Email templates</strong>
                <p class="tr-hint" style="margin:0.25rem 0 0">
                  Use <code>{{name}}</code> style placeholders. Saved to KV — changes apply to the next email, no deploy needed.
                </p>
              </div>
              <div style="display:flex;gap:0.5rem">
                <button type="button" class="btn btn-secondary" onclick="resetMailTemplates()">Reset to defaults</button>
                <button type="button" class="btn btn-primary" onclick="saveMailTemplates()">Save templates</button>
              </div>
            </div>
            <div id="mail-templates"><p style="padding:1rem;color:var(--text-light)">Loading...</p></div>
          </div>

          <!-- 阶段二C：订阅名单 -->
          <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border-color)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
              <div>
                <strong style="font-size:0.95rem">Subscribers</strong>
                <p class="tr-hint" style="margin:0.25rem 0 0">
                  Double opt-in: only <b>confirmed</b> addresses may receive marketing email.
                </p>
              </div>
              <button type="button" class="btn btn-secondary" onclick="loadSubscribers()">Refresh</button>
            </div>
            <div id="subscriber-stats" style="margin-bottom:0.75rem"></div>
            <div id="subscriber-list" class="table-container" style="max-height:280px;overflow:auto">
              <p style="padding:1rem;color:var(--text-light)">Loading...</p>
            </div>
          </div>
        </div>
      </div>
      <!-- SEO Tab（阶段四）：页面级 title / description / 分享图 -->
      <div id="seo-tab" class="tab-content">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:1.25rem">
          <div>
            <h2 style="font-size: 1.25rem; margin-bottom: 0.35rem; color: var(--text-dark);">Search Engine Optimization</h2>
            <p class="tr-hint" style="margin:0;max-width:640px">
              Per-page title and description for Google results, plus the image shown when a page is shared
              on WhatsApp / LinkedIn / Facebook. Leave a field empty to fall back to the built-in default.
            </p>
          </div>
          <a href="/sitemap.xml" target="_blank" class="btn btn-secondary" style="text-decoration:none">View sitemap.xml</a>
        </div>

        <div style="background:#fff;padding:1.5rem;border-radius:.5rem;box-shadow:0 2px 4px rgba(0,0,0,.1);max-width:900px">
          <div class="form-group">
            <label class="form-label" for="seo-og-image">Default share image (og:image)</label>
            <input type="text" id="seo-og-image" class="form-input" placeholder="/api/upload/image/products/xxx.jpg or https://cdn.example.com/cover.jpg">
            <small style="color:#6b7280">1200&times;630 px works best. Used when a page has no image of its own.</small>
          </div>

          <div id="seo-pages" style="margin-top:1rem">
            <p style="padding:1rem;color:var(--text-light)">Loading...</p>
          </div>

          <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--border-color);display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
            <button type="button" id="save-seo-btn" class="btn btn-primary" onclick="saveSeoSettings()">Save SEO settings</button>
            <button type="button" class="btn btn-secondary" onclick="loadSeoSettings()">Reload</button>
            <span class="tr-hint" style="margin:0">Saved to KV — live on the next page load, no redeploy.</span>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Product Edit/Add Modal -->
  <div id="product-modal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modal-title">Edit Product</h2>
        <button class="modal-close" onclick="closeProductModal()">&times;</button>
      </div>
      <form id="product-form">
        <input type="hidden" id="product-id" name="id">

        <div class="form-group">
          <label class="form-label" for="product-name">Product Name *</label>
          <input type="text" id="product-name" name="name" class="form-input" required>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-category">Category</label>
          <input type="text" id="product-category" name="category" class="form-input" placeholder="e.g., Electronics, Machinery">
        </div>

        <div class="form-group">
          <label class="form-label" for="product-description">Short Description</label>
          <textarea id="product-description" name="description" class="form-textarea" placeholder="Brief product description"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-detailed-description">Detailed Description</label>
          <textarea id="product-detailed-description" name="detailed_description" class="form-textarea" placeholder="Full product description"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-specifications">Specifications</label>
          <textarea id="product-specifications" name="specifications" class="form-textarea" placeholder="Technical specifications"></textarea>
        </div>

        <div class="image-upload-container">
          <label class="form-label">Product Image</label>
          <div class="upload-btn-wrapper">
            <button type="button" class="btn-upload">Choose Image</button>
            <input type="file" id="image-upload" accept="image/*" onchange="handleImageUpload(event)">
          </div>
          <div id="upload-status" class="uploading" style="display: none;">Uploading...</div>
          <div id="image-preview" class="image-preview"></div>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-image-url">Image URL (or upload above)</label>
          <input type="url" id="product-image-url" name="image_url" class="form-input" placeholder="https://example.com/image.jpg" readonly>
        </div>

        <!-- B2B / SEO / 多语言：这些字段决定详情页 URL、Google 摘要和西语阿语版本 -->
        <div class="form-group">
          <label class="form-label" for="product-slug">URL Slug</label>
          <input type="text" id="product-slug" name="slug" class="form-input" placeholder="e.g., stainless-steel-pump-100">
          <small style="color:#6b7280">详情页地址 /products/&lt;slug&gt;。留空则新建时自动生成；改动会让旧链接 404，建议上线前定好。</small>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-brand">Brand</label>
          <input type="text" id="product-brand" name="brand" class="form-input" placeholder="e.g., OEM / your brand">
        </div>

        <div class="form-group">
          <label class="form-label" for="product-moq">MOQ</label>
          <input type="text" id="product-moq" name="moq" class="form-input" placeholder="e.g., 100 pcs">
        </div>

        <!-- 阶段一C：影响询盘转化率的字段。买家最关心交期、能不能定制、能不能先拿样。 -->
        <div style="margin:1.25rem 0 0.25rem;padding-top:1rem;border-top:1px solid var(--border-color)">
          <strong style="font-size:0.9rem;color:var(--text-dark)">Sales &amp; Conversion</strong>
          <p class="tr-hint">These show up on the product page and are what overseas buyers actually ask in the first email.</p>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-lead-time">Lead Time</label>
          <input type="text" id="product-lead-time" name="lead_time" class="form-input" placeholder="e.g., 15-20 days after deposit">
        </div>

        <div class="form-group">
          <label class="form-label" for="product-sample-policy">Sample Policy</label>
          <input type="text" id="product-sample-policy" name="sample_policy" class="form-input" placeholder="e.g., Free sample, buyer pays freight">
        </div>

        <div class="form-group">
          <label class="form-label" for="product-customization">Customization</label>
          <textarea id="product-customization" name="customization" class="form-textarea" style="min-height:70px" placeholder="e.g., OEM logo, custom packaging, voltage / plug type, color"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-applications">Applications</label>
          <input type="text" id="product-applications" name="applications" class="form-input" placeholder="e.g., Food processing, Water treatment, Mining">
          <small style="color:#6b7280">Comma separated — rendered as tags on the product page.</small>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-video-url">Video URL</label>
          <input type="url" id="product-video-url" name="video_url" class="form-input" placeholder="https://www.youtube.com/watch?v=...">
        </div>

        <div class="form-group">
          <label class="form-label" for="product-datasheet-url">Datasheet / Drawing URL</label>
          <input type="url" id="product-datasheet-url" name="datasheet_url" class="form-input" placeholder="/api/upload/image/products/spec.pdf or https://...">
        </div>

        <div class="form-group">
          <label class="form-label" for="product-related-ids">Related Products (IDs, comma separated)</label>
          <input type="text" id="product-related-ids" name="related_ids" class="form-input" placeholder="e.g., 3, 7, 12">
          <small style="color:#6b7280">Leave empty to auto-suggest 3 products from the same category.</small>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-gallery">Gallery Images (one URL per line)</label>
          <textarea id="product-gallery" name="gallery_images" class="form-textarea" placeholder="/api/upload/image/products/xxx.jpg&#10;https://cdn.example.com/2.jpg"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label" for="product-seo-title">SEO Title</label>
          <input type="text" id="product-seo-title" name="seo_title" class="form-input" placeholder="留空则用产品名">
        </div>

        <div class="form-group">
          <label class="form-label" for="product-seo-description">SEO Description</label>
          <textarea id="product-seo-description" name="seo_description" class="form-textarea" placeholder="留空则用短描述（建议 120-160 字符）"></textarea>
        </div>

        <!-- 多语言内容（阶段一A）：按语种分 Tab，运营不用手写 JSON -->
        <div class="form-group">
          <label class="form-label">Translations</label>
          <p class="tr-hint">只填需要覆盖的语种；留空的字段自动回退英文。Tab 上的绿点表示该语种已填写。</p>

          <!-- 一键生成译文（Workers AI）。译文只回填到 Tab，不直接入库：必须人工核对后再保存。 -->
          <div class="tr-toolbar" style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end;margin:.1rem 0 .8rem;padding:.65rem .75rem;background:var(--bg-light,#f9fafb);border:1px solid var(--border-color,#e5e7eb);border-radius:.45rem">
            <div style="display:flex;flex-direction:column;gap:.2rem">
              <label for="tr-source-lang" style="font-size:.76rem;color:var(--text-light,#6b7280)">原文语言</label>
              <select id="tr-source-lang" class="form-input" style="min-width:170px;padding:.35rem .5rem;font-size:.84rem">${sourceOptions}</select>
            </div>
            <div style="display:flex;flex-direction:column;gap:.2rem">
              <label for="tr-mode" style="font-size:.76rem;color:var(--text-light,#6b7280)">写入方式</label>
              <select id="tr-mode" class="form-input" style="min-width:140px;padding:.35rem .5rem;font-size:.84rem">
                <option value="fill">只补空字段（推荐）</option>
                <option value="overwrite">覆盖已有译文</option>
              </select>
            </div>
            <button type="button" class="btn-upload" id="tr-auto-btn" onclick="autoTranslate()" style="padding:.4rem .8rem">一键生成译文</button>
            <span id="tr-progress" class="tr-hint" style="margin:0;flex:1 1 160px;min-height:1.2em" aria-live="polite"></span>
          </div>

          <div class="tr-tabs" id="product-tr-tabs">
            ${trTabs}
          </div>
          ${trPanes}
          <details style="margin-top:0.75rem">
            <summary style="cursor:pointer;font-size:0.82rem;color:var(--text-light)">Advanced: paste / edit JSON</summary>
            <textarea id="product-translations" class="form-textarea" style="margin-top:0.5rem;font-family:ui-monospace,Menlo,monospace;font-size:0.8rem;min-height:90px" placeholder='{"es":{"name":"..."},"ar":{"name":"..."}}'></textarea>
            <button type="button" class="btn-upload" style="margin-top:0.5rem" onclick="importTranslationsJson()">Import JSON into tabs</button>
            <div class="tr-hint" style="margin-top:0.35rem">此框为预览/导入用；保存时以上方 Tab 的内容为准。</div>
          </details>
        </div>

        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" id="product-is-featured" name="is_featured">
            <span>Featured Product</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" id="product-is-active" name="is_active" checked>
            <span>Active</span>
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-cancel" onclick="closeProductModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Product</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Inquiry detail / follow-up modal (阶段二A) -->
  <div id="inquiry-modal" class="modal">
    <div class="modal-content" style="max-width:820px">
      <div class="modal-header">
        <h2 id="inquiry-modal-title">Inquiry</h2>
        <button class="modal-close" onclick="closeInquiryModal()">&times;</button>
      </div>

      <div id="inquiry-body">Loading...</div>

      <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--border-color)">
        <strong style="font-size:0.9rem">Add follow-up</strong>
        <div style="display:grid;grid-template-columns:130px 1fr 150px;gap:0.6rem;margin-top:0.7rem">
          <select id="act-type" class="form-input">
            <option value="note">Note</option>
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="quote">Quote sent</option>
          </select>
          <input type="text" id="act-content" class="form-input" placeholder="What happened / what you said">
          <input type="date" id="act-due" class="form-input" title="Next follow-up date (optional)">
        </div>
        <div style="margin-top:0.6rem;display:flex;gap:0.6rem;align-items:center">
          <button type="button" class="btn btn-primary" onclick="addActivity()">Add</button>
          <span class="tr-hint">The date becomes the next follow-up reminder for this inquiry.</span>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn btn-cancel" onclick="closeInquiryModal()">Close</button>
      </div>
    </div>
  </div>

  <script>
    /**
     * Main JavaScript file for B2B Website
     * Handles common functionality across all pages
     */

    /**
     * 宽松解析 JSON 列。库里历史上存在双层编码的 translations
     * （"{\"es\":...}"），只 parse 一次会拿到字符串，译文 Tab 就是空的。
     * 后台一旦「读空 → 保存」，双层结构还会被写回去，所以必须拆到底。
     */
    function parseJsonLoose(value, fallback) {
      var fb = (fallback === undefined) ? {} : fallback;
      var cur = value;
      for (var i = 0; i < 3; i++) {
        if (cur === null || cur === undefined || cur === '') return fb;
        if (typeof cur !== 'string') return cur;
        try { cur = JSON.parse(cur); } catch (e) { return fb; }
      }
      return (typeof cur === 'string') ? fb : cur;
    }

    // Mobile menu toggle
    document.addEventListener('DOMContentLoaded', function() {
      const menuToggle = document.querySelector('.menu-toggle');
      const navMenu = document.querySelector('.nav-menu');

      if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', function() {
          navMenu.classList.toggle('active');
        });

        // Close menu when clicking outside
        document.addEventListener('click', function(event) {
          if (!menuToggle.contains(event.target) && !navMenu.contains(event.target)) {
            navMenu.classList.remove('active');
          }
        });
      }

      // Set active nav link based on current page
      const currentPath = window.location.pathname;
      const navLinks = document.querySelectorAll('.nav-link');

      navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPath) {
          link.classList.add('active');
        }
      });
    });

    // API helper functions
    const API = {
      baseURL: '/api',

      /**
       * 后台每一个请求都必须带 Bearer token。
       * requireAuth 只从 Authorization 头里取身份，缺头不会报「未登录」，
       * 而是静默降级成「匿名访客」：产品列表只剩已上架的、写操作 401。
       * 以前的 get/post/put/delete 全都没带 —— 表现为「删除点了没反应、已下架产品永远看不到」。
       */
      headers(extra) {
        const t = localStorage.getItem('admin_token');
        return Object.assign({}, extra || {}, t ? { Authorization: 'Bearer ' + t } : {});
      },

      async get(endpoint) {
        const response = await fetch(\`\${this.baseURL}\${endpoint}\`, { headers: this.headers() });
        if (!response.ok) {
          throw new Error(\`HTTP error! status: \${response.status}\`);
        }
        return await response.json();
      },

      async post(endpoint, data) {
        const response = await fetch(\`\${this.baseURL}\${endpoint}\`, {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          throw new Error(\`HTTP error! status: \${response.status}\`);
        }
        return await response.json();
      },

      async put(endpoint, data) {
        const response = await fetch(\`\${this.baseURL}\${endpoint}\`, {
          method: 'PUT',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          throw new Error(\`HTTP error! status: \${response.status}\`);
        }
        return await response.json();
      },

      async delete(endpoint) {
        const response = await fetch(\`\${this.baseURL}\${endpoint}\`, {
          method: 'DELETE',
          headers: this.headers(),
        });
        if (!response.ok) {
          throw new Error(\`HTTP error! status: \${response.status}\`);
        }
        return await response.json();
      },
    };

    // Form validation helper
    function validateEmail(email) {
      const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
      return re.test(String(email).toLowerCase());
    }

    // Show notification
    function showNotification(message, type = 'info') {
      const notification = document.createElement('div');
      notification.className = \`notification notification-\${type}\`;
      notification.textContent = message;
      notification.style.cssText = \`
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: \${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 0.5rem;
        box-shadow: 0 10px 15px rgba(0,0,0,0.1);
        z-index: 9999;
        animation: slideIn 0.3s ease-out;
      \`;

      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
      }, 3000);
    }

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = \`
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    \`;
    document.head.appendChild(style);

    // Export for use in other scripts
    window.API = API;
    window.validateEmail = validateEmail;
    window.showNotification = showNotification;
  </script>

  <script>
    /**
     * Admin Dashboard JavaScript
     * Handles all admin dashboard functionality
     */

    // Check authentication
    const token = localStorage.getItem('admin_token');
    const userRole = localStorage.getItem('admin_role') || 'admin';
    const isSuperAdmin = userRole === 'super_admin';

    if (!token) {
      window.location.href = '/admin/login';
    }

    // Verify token on page load and get user info
    API.post('/admin/verify', { token })
      .then(response => {
        if (response.success && response.data.user) {
          // Update role in localStorage
          localStorage.setItem('admin_role', response.data.user.role || 'admin');

          // Update role indicator
          const roleIndicator = document.getElementById('admin-role-indicator');
          if (roleIndicator) {
            roleIndicator.textContent = response.data.user.role === 'super_admin' ? 'Super Admin' : 'Admin';
          }
        }
      })
      .catch(() => {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_role');
        window.location.href = '/admin/login';
      });

    // Add authorization header to all API requests
    const originalPost = API.post;
    const originalPut = API.put;
    const originalDelete = API.delete;
    const originalGet = API.get;

    API.get = function(endpoint) {
      return fetch(\`\${this.baseURL}\${endpoint}\`, {
        headers: {
          'Authorization': \`Bearer \${token}\`,
        },
      }).then(res => res.json());
    };

    API.post = function(endpoint, data) {
      return fetch(\`\${this.baseURL}\${endpoint}\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${token}\`,
        },
        body: JSON.stringify(data),
      }).then(res => res.json());
    };

    API.put = function(endpoint, data) {
      return fetch(\`\${this.baseURL}\${endpoint}\`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${token}\`,
        },
        body: JSON.stringify(data),
      }).then(res => res.json());
    };

    API.delete = function(endpoint) {
      return fetch(\`\${this.baseURL}\${endpoint}\`, {
        method: 'DELETE',
        headers: {
          'Authorization': \`Bearer \${token}\`,
        },
      }).then(res => res.json());
    };

    // Logout functionality
    function logout() {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_role');
      window.location.href = '/admin/login';
    }

    document.getElementById('logout-btn').addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });

    document.getElementById('logout-btn-header').addEventListener('click', logout);

    // Tab Navigation
    const tabButtons = document.querySelectorAll('[data-tab]');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        const tabName = button.getAttribute('data-tab');

        // Update active states
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        button.classList.add('active');
        document.getElementById(\`\${tabName}-tab\`).classList.add('active');

        // Load data for specific tabs
        if (tabName === 'products') {
          loadProducts();
        } else if (tabName === 'inquiries') {
          loadInquiries();
        } else if (tabName === 'settings') {
          loadSettings();
          if (isSuperAdmin) {
            loadTranslationSettings();
            loadLoginLogs();
            loadMailTemplates();
            loadSubscribers();
          }
        } else if (tabName === 'seo') {
          loadSeoSettings();
        }
      });
    });

    // Load Dashboard Stats
    async function loadDashboardStats() {
      try {
        const response = await API.get('/admin/stats');
        if (response.success) {
          const { total_products, total_inquiries, pending_inquiries, recent_inquiries } = response.data;

          document.getElementById('stat-products').textContent = total_products || 0;
          document.getElementById('stat-inquiries').textContent = total_inquiries || 0;
          document.getElementById('stat-pending').textContent = pending_inquiries || 0;

          // Display recent inquiries
          const tbody = document.getElementById('recent-inquiries-tbody');
          if (recent_inquiries && recent_inquiries.length > 0) {
            tbody.innerHTML = recent_inquiries.map(inquiry => \`
              <tr>
                <td>\${inquiry.name}</td>
                <td>\${inquiry.email}</td>
                <td>\${inquiry.product_name || 'General Inquiry'}</td>
                <td><span class="badge badge-\${inquiry.status}">\${inquiry.status}</span></td>
                <td>\${new Date(inquiry.created_at).toLocaleDateString()}</td>
              </tr>
            \`).join('');
          } else {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No recent inquiries</td></tr>';
          }
        }
      } catch (error) {
        console.error('Error loading stats:', error);
      }

      // 阶段二A：CRM 概览（失败不影响上面的基础统计）
      try {
        const crm = await API.get('/crm/overview');
        if (crm.success) {
          const d = crm.data || {};
          document.getElementById('stat-followup').textContent = d.overdue_followups || 0;
          document.getElementById('stat-customers').textContent = d.customers_total || 0;
          document.getElementById('stat-won').textContent = d.won_this_month || 0;
          // 有逾期时把卡片做成可点，直接跳到询盘列表找那块最急的
          const card = document.getElementById('stat-followup-card');
          if (card) {
            card.onclick = function () {
              const nav = document.querySelector('a[data-tab="inquiries"]');
              if (nav) nav.click();
            };
          }
        }
      } catch (e) {
        console.warn('CRM overview unavailable (migration 004 not applied?)', e.message);
      }
    }

    // Load Products
    async function loadProducts() {
      try {
        const response = await API.get('/products');
        if (response.success) {
          const products = response.data || [];
          const container = document.getElementById('products-list');

          if (products.length === 0) {
            container.innerHTML = '<p style="padding: 2rem; text-align: center;">No products found.</p>';
            return;
          }

          container.innerHTML = \`
            <table class="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Featured</th>
                  <th>Status</th>
                  \${isSuperAdmin ? '<th>Actions</th>' : ''}
                </tr>
              </thead>
              <tbody>
                \${products.map(product => \`
                  <tr>
                    <td>\${product.id}</td>
                    <td>\${product.name}</td>
                    <td>\${product.category || 'N/A'}</td>
                    <td>\${product.is_featured ? '⭐ Yes' : 'No'}</td>
                    <td><span class="badge \${product.is_active ? 'badge-completed' : 'badge-pending'}">\${product.is_active ? 'Active' : 'Inactive'}</span></td>
                    \${isSuperAdmin ? \`
                    <td>
                      <button onclick="editProduct(\${product.id})" class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.85rem; margin-right: 0.5rem;">Edit</button>
                      \${product.is_active
                        ? \`<button onclick="deleteProduct(\${product.id})" class="btn" style="background: #dc2626; color: white; padding: 0.5rem 1rem; font-size: 0.85rem;">Delete</button>\`
                        : \`<button onclick="restoreProduct(\${product.id})" class="btn" style="background: #059669; color: white; padding: 0.5rem 1rem; font-size: 0.85rem;">Restore</button>\`}
                    </td>
                    \` : ''}
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          \`;
        }
      } catch (error) {
        console.error('Error loading products:', error);
        document.getElementById('products-list').innerHTML = '<p style="padding: 2rem; text-align: center; color: red;">Error loading products</p>';
      }
    }

    // 轻 CRM：状态筛选 / 搜索 / CSV 导出
    async function exportInquiriesCsv() {
      try {
        const res = await fetch('/api/inquiries/export.csv', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inquiries-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error('CSV export failed', e);
        alert('Export failed: ' + e.message);
      }
    }
    document.getElementById('inquiry-export')?.addEventListener('click', exportInquiriesCsv);
    document.getElementById('inquiry-refresh')?.addEventListener('click', loadInquiries);
    document.getElementById('inquiry-status-filter')?.addEventListener('change', loadInquiries);
    document.getElementById('inquiry-search')?.addEventListener('keypress', e => {
      if (e.key === 'Enter') loadInquiries();
    });

    // Load Inquiries
    async function loadInquiries() {
      try {
        const status = document.getElementById('inquiry-status-filter')?.value || '';
        const q = document.getElementById('inquiry-search')?.value || '';
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (q) params.set('q', q);
        const response = await API.get('/inquiries' + (params.toString() ? '?' + params : ''));
        if (response.success) {
          // 原版把 D1 字段直接拼进 innerHTML（存储型 XSS）。这里统一转义所有字符串字段。
          const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
          const inquiries = (response.data || []).map(row =>
            Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? esc(v) : v])));
          const container = document.getElementById('inquiries-list');

          if (inquiries.length === 0) {
            container.innerHTML = '<p style="padding: 2rem; text-align: center;">No inquiries found.</p>';
            return;
          }

          container.innerHTML = \`
            <table class="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Product</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Follow-up</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                \${inquiries.map(inquiry => \`
                  <tr>
                    <td>\${inquiry.id}</td>
                    <td>\${inquiry.name}</td>
                    <td>\${inquiry.email}</td>
                    <td>\${inquiry.product_name || 'General'}</td>
                    <td><span class="pri pri-\${inquiry.priority || 'warm'}">\${inquiry.priority || 'warm'}</span></td>
                    <td><span class="badge badge-\${inquiry.status}">\${inquiry.status}</span></td>
                    <td>\${inquiry.next_follow_at ? inquiry.next_follow_at.slice(0, 10) : '<span style="color:#9ca3af">-</span>'}</td>
                    <td>\${new Date(inquiry.created_at).toLocaleDateString()}</td>
                    <td>
                      <button onclick="viewInquiry(\${inquiry.id})" class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.85rem; margin-right: 0.5rem;">View</button>
                      \${isSuperAdmin ? \`<button onclick="deleteInquiry(\${inquiry.id})" class="btn" style="background: #dc2626; color: white; padding: 0.5rem 1rem; font-size: 0.85rem;">Delete</button>\` : ''}
                    </td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          \`;
        }
      } catch (error) {
        console.error('Error loading inquiries:', error);
        document.getElementById('inquiries-list').innerHTML = '<p style="padding: 2rem; text-align: center; color: red;">Error loading inquiries</p>';
      }
    }

    // Product Management Functions
    /**
     * 上传前先在浏览器里压一道。
     * 手机/相机直出 4-8MB 的原图直接塞进 R2，既拖慢后台，也让海外访客多等几秒。
     * 长边压到 1600px + WebP 0.82，实测 5MB 的图能落到 300-500KB，产品图肉眼无差。
     * GIF 不处理（压了就丢帧），小图不处理（再压只会更糊）。
     */
    async function compressImage(file) {
      if (file.type === 'image/gif') return file;
      if (file.size < 250 * 1024) return file;
      try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
        const blob = await new Promise(function (resolve) {
          canvas.toBlob(resolve, 'image/webp', 0.82);
        });
        if (!blob || blob.size >= file.size) return file;
        return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' });
      } catch (e) {
        console.warn('Image compression skipped:', e);
        return file;
      }
    }

    window.handleImageUpload = async function(event) {
      let file = event.target.files[0];
      if (!file) return;

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        showNotification('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.', 'error');
        return;
      }

      // 先压缩再校验体积：原图超 5MB 但压完只有 400KB 的情况非常常见
      const originalSize = file.size;
      file = await compressImage(file);

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        showNotification('File too large. Maximum size is 5MB.', 'error');
        return;
      }
      if (file.size < originalSize) {
        showNotification(
          'Optimised ' + Math.round(originalSize / 1024) + ' KB → ' + Math.round(file.size / 1024) + ' KB',
          'success'
        );
      }

      // Show uploading status
      const uploadStatus = document.getElementById('upload-status');
      uploadStatus.style.display = 'block';

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/upload/image', {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${token}\`,
          },
          body: formData,
        });

        const result = await response.json();

        if (result.success) {
          // Set the image URL
          document.getElementById('product-image-url').value = result.data.url;

          // Show preview
          const preview = document.getElementById('image-preview');
          preview.innerHTML = \`<img src="\${result.data.url}" alt="Product preview">\`;

          showNotification('Image uploaded successfully', 'success');
        } else {
          showNotification(result.error || 'Upload failed', 'error');
        }
      } catch (error) {
        console.error('Upload error:', error);
        showNotification('Error uploading image', 'error');
      } finally {
        uploadStatus.style.display = 'none';
      }
    };

    // ---- 多语言 Tab（阶段一A）：Tab 是真源，JSON 框只做预览/导入 ----
    var TR_LANGS = ${JSON.stringify(trLangs)};
    var TR_FIELDS = ['name', 'description', 'detailed_description', 'specifications', 'seo_title', 'seo_description'];

    window.switchTrTab = function(lang) {
      document.querySelectorAll('.tr-tab').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
      });
      document.querySelectorAll('.tr-pane').forEach(function(pane) {
        pane.style.display = pane.getAttribute('data-lang-pane') === lang ? 'block' : 'none';
      });
    };

    function collectTranslations() {
      var out = {};
      TR_LANGS.forEach(function(lang) {
        var obj = {};
        TR_FIELDS.forEach(function(field) {
          var el = document.getElementById('tr-' + lang + '-' + field);
          var v = el ? String(el.value || '').trim() : '';
          if (v) obj[field] = v;
        });
        if (Object.keys(obj).length) out[lang] = obj;
      });
      return out;
    }

    function updateTrDots() {
      document.querySelectorAll('.tr-tab').forEach(function(btn) {
        var lang = btn.getAttribute('data-lang');
        var filled = TR_FIELDS.some(function(field) {
          var el = document.getElementById('tr-' + lang + '-' + field);
          return el && String(el.value || '').trim();
        });
        var dot = btn.querySelector('.dot');
        if (dot) dot.style.display = filled ? 'inline-block' : 'none';
      });
    }

    function syncTrPreview() {
      var box = document.getElementById('product-translations');
      if (!box) return;
      var obj = collectTranslations();
      box.value = Object.keys(obj).length ? JSON.stringify(obj, null, 2) : '';
    }

    function fillTranslationTabs(tr) {
      tr = tr || {};
      TR_LANGS.forEach(function(lang) {
        TR_FIELDS.forEach(function(field) {
          var el = document.getElementById('tr-' + lang + '-' + field);
          if (el) el.value = (tr[lang] && tr[lang][field]) ? String(tr[lang][field]) : '';
        });
      });
      updateTrDots();
      syncTrPreview();
    }

    window.onTrInput = function() {
      updateTrDots();
      syncTrPreview();
    };

    window.importTranslationsJson = function() {
      var raw = document.getElementById('product-translations').value.trim();
      if (!raw) { showNotification('JSON is empty', 'error'); return; }
      var parsed = parseJsonLoose(raw, null);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        showNotification('Invalid JSON object, expected {"es":{"name":"..."}}', 'error');
        return;
      }
      fillTranslationTabs(parsed);
      showNotification('Imported into tabs - remember to save', 'success');
    };

    /* ---- 一键生成译文（Workers AI）----
       关键取舍：译文只回填到 Tab，绝不直接入库。
       机翻的型号 / SEO 标题必须让运营过一眼，且「保存」按钮是唯一的写入口。
       一次请求只翻一个语种（免费版 Worker 10ms CPU + 模型长度限制），
       串行调用配合进度提示，某一语种失败不阻断其余语种。 */
    var SRC_FIELD_IDS = {
      name: 'product-name',
      description: 'product-description',
      detailed_description: 'product-detailed-description',
      specifications: 'product-specifications',
      seo_title: 'product-seo-title',
      seo_description: 'product-seo-description'
    };

    // 自动检测只区分「中文 / 英文」，不猜简繁：
    // 繁体特征字里很容易混进简繁同形字（如「品」），一段「新产品」就会误判成 zh-TW。
    // 原文确实是繁体时，运营在下拉里手动选「繁體中文」即可。
    function detectSourceLang(text) {
      var str = String(text || '');
      // 注意：这段脚本在模板字符串里，Unicode 范围必须写双反斜杠，浏览器端才会收到转义序列
      var han = (str.match(/[\\u4e00-\\u9fff]/g) || []).length;
      var latin = (str.match(/[a-zA-Z]/g) || []).length;
      return (han === 0 || han < latin * 0.15) ? 'en' : 'zh';
    }

    window.autoTranslate = async function() {
      var btn = document.getElementById('tr-auto-btn');
      var prog = document.getElementById('tr-progress');
      if (!btn) return;

      var fields = {};
      Object.keys(SRC_FIELD_IDS).forEach(function(key) {
        var el = document.getElementById(SRC_FIELD_IDS[key]);
        var v = el ? String(el.value || '').trim() : '';
        if (v) fields[key] = v;
      });
      if (!Object.keys(fields).length) {
        showNotification('请先填写产品主字段（名称/描述/规格等）', 'error');
        return;
      }

      var chosen = (document.getElementById('tr-source-lang') || {}).value || 'auto';
      var sourceLang = chosen === 'auto'
        ? detectSourceLang(Object.keys(fields).map(function(k) { return fields[k]; }).join(' '))
        : chosen;
      var mode = (document.getElementById('tr-mode') || {}).value || 'fill';

      btn.disabled = true;
      var doneCount = 0, failLangs = [];
      try {
        for (var i = 0; i < TR_LANGS.length; i++) {
          var lang = TR_LANGS[i];
          if (prog) prog.textContent = '(' + (i + 1) + '/' + TR_LANGS.length + ') 正在生成 ' + lang + ' …';
          try {
            var existing = collectTranslations()[lang] || {};
            var res = await API.post('/translate', {
              sourceLang: sourceLang, target: lang, fields: fields, mode: mode, existing: existing
            });
            if (!res || res.success !== true) throw new Error((res && res.error) || '接口返回异常');
            var tr = (res.data && res.data.translations) || {};
            Object.keys(tr).forEach(function(f) {
              var el = document.getElementById('tr-' + lang + '-' + f);
              if (!el) return;
              // fill 模式下服务端已跳过已有字段，这里再兜一层，绝不误覆盖人工译文
              if (mode === 'fill' && String(el.value || '').trim()) return;
              el.value = tr[f];
            });
            doneCount += 1;
          } catch (e) {
            failLangs.push(lang);
            console.error('translate ' + lang + ' failed', e);
          }
        }
        updateTrDots();
        syncTrPreview();
        if (failLangs.length) {
          showNotification('部分语种生成失败（' + failLangs.join(', ') + '），其余已填入 Tab', 'error');
          if (prog) prog.textContent = '失败语种：' + failLangs.join(', ') + ' · 请检查 Workers AI 绑定/额度';
        } else {
          showNotification('译文已填入各语种 Tab，请核对后再点保存', 'success');
          if (prog) prog.textContent = '';
        }
      } finally {
        btn.disabled = false;
        if (doneCount === 0 && !failLangs.length && prog) prog.textContent = '';
      }
    };

    window.editProduct = async function(id) {
      try {
        // Fetch product details
        const response = await API.get(\`/products/\${id}\`);
        if (response.success) {
          const product = response.data;

          // Populate form
          document.getElementById('product-id').value = product.id;
          document.getElementById('product-name').value = product.name || '';
          document.getElementById('product-category').value = product.category || '';
          document.getElementById('product-description').value = product.description || '';
          document.getElementById('product-detailed-description').value = product.detailed_description || '';
          document.getElementById('product-specifications').value = product.specifications || '';
          document.getElementById('product-image-url').value = product.image_url || '';
          document.getElementById('product-is-featured').checked = product.is_featured === 1;
          document.getElementById('product-is-active').checked = product.is_active === 1;

          // B2B / SEO / 多语言字段（原先表单没有，只能在数据库里改）
          document.getElementById('product-slug').value = product.slug || '';
          document.getElementById('product-brand').value = product.brand || '';
          document.getElementById('product-moq').value = product.moq || '';
          document.getElementById('product-seo-title').value = product.seo_title || '';
          document.getElementById('product-seo-description').value = product.seo_description || '';

          // 阶段一C 转化字段
          document.getElementById('product-lead-time').value = product.lead_time || '';
          document.getElementById('product-sample-policy').value = product.sample_policy || '';
          document.getElementById('product-customization').value = product.customization || '';
          document.getElementById('product-applications').value = product.applications || '';
          document.getElementById('product-video-url').value = product.video_url || '';
          document.getElementById('product-datasheet-url').value = product.datasheet_url || '';
          var relatedIds = [];
          try { relatedIds = JSON.parse(product.related_ids || '[]'); } catch (e) { relatedIds = []; }
          document.getElementById('product-related-ids').value =
            Array.isArray(relatedIds) ? relatedIds.join(', ') : '';

          var gallery = parseJsonLoose(product.gallery_images, []);
          if (!Array.isArray(gallery)) gallery = [];
          document.getElementById('product-gallery').value = gallery.join('\\n');

          fillTranslationTabs(parseJsonLoose(product.translations, {}));

          // Show image preview if exists
          const preview = document.getElementById('image-preview');
          if (product.image_url) {
            preview.innerHTML = \`<img src="\${product.image_url}" alt="Product preview">\`;
          } else {
            preview.innerHTML = '';
          }

          // Update modal title
          document.getElementById('modal-title').textContent = 'Edit Product';

          // Show modal
          document.getElementById('product-modal').classList.add('active');
        }
      } catch (error) {
        showNotification('Error loading product details', 'error');
        console.error('Error loading product:', error);
      }
    };

    window.closeProductModal = function() {
      document.getElementById('product-modal').classList.remove('active');
      document.getElementById('product-form').reset();
      document.getElementById('product-id').value = '';
      document.getElementById('image-preview').innerHTML = '';
      document.getElementById('image-upload').value = '';
      fillTranslationTabs({});
    };

    window.openAddProductModal = function() {
      // Reset form
      document.getElementById('product-form').reset();
      document.getElementById('product-id').value = '';
      document.getElementById('product-is-active').checked = true;
      fillTranslationTabs({});

      // Update modal title
      document.getElementById('modal-title').textContent = 'Add New Product';

      // Show modal
      document.getElementById('product-modal').classList.add('active');
    };

    // Handle product form submission
    document.getElementById('product-form').addEventListener('submit', async function(e) {
      e.preventDefault();

      const productId = document.getElementById('product-id').value;

      // 图集按行拆成数组（后端会 JSON.stringify）
      var galleryLines = document.getElementById('product-gallery').value
        .split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);

      // 译文以 Tab 输入为准；全部留空则显式写 {} 以清空旧译文
      var translationsValue = collectTranslations();

      // 关联产品：逗号/空格/换行任意分隔，转成数字数组；全空则提交 null（退回自动推荐）
      var relatedIds = document.getElementById('product-related-ids').value
        .split(/[,\s]+/).map(function (s) { return parseInt(s, 10); })
        .filter(function (n) { return !isNaN(n) && n > 0; });

      const formData = {
        name: document.getElementById('product-name').value,
        category: document.getElementById('product-category').value,
        description: document.getElementById('product-description').value,
        detailed_description: document.getElementById('product-detailed-description').value,
        specifications: document.getElementById('product-specifications').value,
        image_url: document.getElementById('product-image-url').value,
        is_featured: document.getElementById('product-is-featured').checked,
        is_active: document.getElementById('product-is-active').checked,
        slug: document.getElementById('product-slug').value.trim() || null,
        brand: document.getElementById('product-brand').value.trim() || null,
        moq: document.getElementById('product-moq').value.trim() || null,
        seo_title: document.getElementById('product-seo-title').value.trim() || null,
        seo_description: document.getElementById('product-seo-description').value.trim() || null,
        gallery_images: galleryLines,
        lead_time: document.getElementById('product-lead-time').value.trim() || null,
        sample_policy: document.getElementById('product-sample-policy').value.trim() || null,
        customization: document.getElementById('product-customization').value.trim() || null,
        applications: document.getElementById('product-applications').value.trim() || null,
        video_url: document.getElementById('product-video-url').value.trim() || null,
        datasheet_url: document.getElementById('product-datasheet-url').value.trim() || null,
        related_ids: relatedIds.length ? relatedIds : null,
      };
      // 始终提交译文（tabs 全空时提交 {}，用于清空旧译文），后端按 JSON 存储
      formData.translations = translationsValue;

      try {
        let response;
        if (productId) {
          // Update existing product
          response = await API.put(\`/products/\${productId}\`, formData);
        } else {
          // Create new product
          response = await API.post('/products', formData);
        }

        if (response.success || response.data) {
          showNotification(productId ? 'Product updated successfully' : 'Product created successfully', 'success');
          closeProductModal();
          loadProducts();
          loadDashboardStats();
        } else {
          showNotification(response.error || 'Failed to save product', 'error');
        }
      } catch (error) {
        showNotification('Error saving product', 'error');
        console.error('Error saving product:', error);
      }
    });

    // Close modal when clicking outside
    document.getElementById('product-modal').addEventListener('click', function(e) {
      if (e.target === this) {
        closeProductModal();
      }
    });

    window.deleteProduct = async function(id) {
      if (!confirm('Are you sure you want to delete this product?')) {
        return;
      }

      try {
        await API.delete(\`/products/\${id}\`);
        showNotification('Product deleted successfully', 'success');
        loadProducts();
      } catch (error) {
        showNotification('Error deleting product', 'error');
      }
    };

    document.getElementById('add-product-btn').addEventListener('click', () => {
      openAddProductModal();
    });

    /** 软删除的产品不会真的消失，运营需要一个可见的恢复入口 */
    window.restoreProduct = async function(id) {
      if (!confirm('Put this product back online?')) return;
      try {
        await API.put(\`/products/\${id}\`, { is_active: 1 });
        showNotification('Product restored — it is live again', 'success');
        loadProducts();
      } catch (error) {
        showNotification('Error restoring product', 'error');
      }
    };

    // ---- Products CSV export / import (phase 1C) ----
    // 注意：后台是 Bearer token 鉴权（不用 cookie），漏掉 Authorization 头会直接 401
    document.getElementById('product-export-btn')?.addEventListener('click', async function() {
      try {
        const res = await fetch('/api/products/export.csv', {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'products-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification('CSV exported', 'success');
      } catch (err) {
        showNotification('Export failed: ' + err.message, 'error');
      }
    });

    var importFileInput = document.getElementById('product-import-file');
    document.getElementById('product-import-btn')?.addEventListener('click', function() {
      importFileInput.value = '';
      importFileInput.click();
    });

    importFileInput?.addEventListener('change', async function() {
      var file = this.files && this.files[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) {
        showNotification('CSV is larger than 4MB - split it first', 'error');
        return;
      }
      try {
        var text = await file.text();
        showNotification('Importing ' + file.name + ' ...', 'info');
        var res = await fetch('/api/products/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'text/csv;charset=UTF-8',
            'Authorization': 'Bearer ' + token,
          },
          body: text,
        });
        var data = await res.json();
        if (!res.ok) {
          showNotification(data.error || ('Import failed (HTTP ' + res.status + ')'), 'error');
          if (data.hint) console.warn('Import hint:', data.hint);
          return;
        }
        var s = data.summary || {};
        showNotification(
          'Import done - created ' + (s.created || 0) + ', updated ' + (s.updated || 0) +
          ', failed ' + (s.failed || 0),
          (s.failed ? 'error' : 'success')
        );
        if (data.errors && data.errors.length) {
          console.warn('Import row errors:', data.errors);
          alert('Some rows failed:\\n\\n' + data.errors.slice(0, 15)
            .map(function (e) { return 'Row ' + e.row + ': ' + e.error; }).join('\\n'));
        }
        loadProducts();
        loadDashboardStats();
      } catch (err) {
        showNotification('Import failed: ' + err.message, 'error');
      }
    });

    // Hide add / import / export buttons for non-super admins
    // （这三个接口都要求 super_admin，普通 admin 点了只会吃 401）
    if (!isSuperAdmin) {
      ['add-product-btn', 'product-import-btn', 'product-export-btn'].forEach(function(id) {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = 'none';
      });
    }

    // Inquiry Management Functions（阶段二A：从 alert 改为跟进工作台）
    var currentInquiry = null;

    var escHtml = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };

    window.viewInquiry = async function(id) {
      document.getElementById('inquiry-modal').classList.add('active');
      document.getElementById('inquiry-modal-title').textContent = 'Inquiry #' + id;
      document.getElementById('inquiry-body').textContent = 'Loading...';
      try {
        var response = await API.get('/inquiries/' + id);
        if (!response.success) {
          document.getElementById('inquiry-body').textContent = 'Inquiry not found.';
          return;
        }
        currentInquiry = response.data;
        var acts = { data: [] };
        try { acts = await API.get('/crm/activities?inquiry_id=' + id); } catch (e) { /* 迁移未执行时忽略 */ }
        renderInquiry(currentInquiry, (acts && acts.data) || []);
      } catch (error) {
        document.getElementById('inquiry-body').textContent = 'Error loading inquiry.';
        console.error(error);
      }
    };

    function renderInquiry(i, activities) {
      var statuses = ['pending', 'processing', 'quoted', 'completed', 'won', 'lost', 'spam'];
      var statusOpts = statuses.map(function (s) {
        return '<option value="' + s + '"' + (i.status === s ? ' selected' : '') + '>' + s + '</option>';
      }).join('');

      var attach = i.attachment_url
        ? '<a href="#" onclick="downloadAttachment(' + i.id + ');return false" style="color:#2563eb">'
          + escHtml(i.attachment_name || 'attachment') + '</a>'
        : '<span style="color:#9ca3af">none</span>';

      // UTM 只展示有值的，避免一排 '-' 干扰阅读
      var utmBits = [];
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        if (i[k]) utmBits.push('<span style="display:inline-block;background:#eef2ff;color:#3730a3;border-radius:9px;padding:1px 8px;font-size:0.72rem;margin-right:4px">' + escHtml(k.replace('utm_', '')) + ': ' + escHtml(i[k]) + '</span>');
      });

      var html = '<dl class="inq-grid">'
        + '<div><dt>Contact</dt><dd>' + escHtml(i.name) + '<br><a href="mailto:' + escHtml(i.email) + '">' + escHtml(i.email) + '</a>'
        + (i.phone ? '<br>' + escHtml(i.phone) : '') + '</dd></div>'
        + '<div><dt>Company / Country</dt><dd>' + escHtml(i.company || '-') + '<br>' + escHtml(i.country || '-') + '</dd></div>'
        + '<div><dt>Product</dt><dd>' + escHtml(i.product_name || 'General inquiry') + '</dd></div>'
        + '<div><dt>Received</dt><dd>' + escHtml(String(i.created_at || '')) + '<br><span class="tl-meta">mail: ' + escHtml(i.mail_status || 'n/a') + '</span></dd></div>'
        + '<div><dt>Attachment</dt><dd>' + attach + '</dd></div>'
        + '<div><dt>Language</dt><dd>' + escHtml(i.lang || 'en') + '</dd></div>'
        + '</dl>'
        + '<div style="margin-top:0.75rem"><dt class="tl-meta" style="color:var(--text-light);font-size:0.78rem">Message</dt>'
        + '<div style="white-space:pre-wrap;background:#f9fafb;border:1px solid var(--border-color);border-radius:6px;padding:0.7rem;font-size:0.88rem;margin-top:0.25rem">' + escHtml(i.message) + '</div></div>'
        + (utmBits.length ? '<div style="margin-top:0.6rem">' + utmBits.join('') + '</div>' : '')
        + (i.landing_page ? '<div class="tl-meta" style="margin-top:0.35rem">landing: ' + escHtml(i.landing_page) + '</div>' : '');

      // 意向等级 + 状态 + 下次跟进
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.6rem;margin-top:1rem">'
        + '<div><label class="form-label" style="font-size:0.78rem">Priority</label>'
        + '<select id="inq-priority" class="form-input" onchange="setPriority(' + i.id + ', this.value)">'
        + ['hot', 'warm', 'cold'].map(function (p) {
            return '<option value="' + p + '"' + ((i.priority || 'warm') === p ? ' selected' : '') + '>' + p + '</option>';
          }).join('')
        + '</select></div>'
        + '<div><label class="form-label" style="font-size:0.78rem">Status</label>'
        + '<select id="inq-status" class="form-input" onchange="setInquiryStatus(' + i.id + ', this.value)">' + statusOpts + '</select></div>'
        + '<div><label class="form-label" style="font-size:0.78rem">Next follow-up</label>'
        + '<input type="date" id="inq-follow" class="form-input" value="' + escHtml((i.next_follow_at || '').slice(0, 10)) + '" onchange="setFollowUp(' + i.id + ', this.value)"></div>'
        + '</div>';

      // 内部备注
      html += '<div style="margin-top:0.75rem"><label class="form-label" style="font-size:0.78rem">Internal notes</label>'
        + '<textarea id="inq-notes" class="form-textarea" style="min-height:70px" placeholder="Internal only - never shown to the customer">' + escHtml(i.notes || '') + '</textarea>'
        + '<button type="button" class="btn btn-secondary" style="margin-top:0.4rem" onclick="saveNotes(' + i.id + ')">Save notes</button></div>';

      // 跟进时间线
      html += '<div style="margin-top:1.25rem"><strong style="font-size:0.9rem">Follow-up history (' + activities.length + ')</strong>';
      if (!activities.length) {
        html += '<p class="tr-hint" style="margin-top:0.4rem">No follow-up yet. Use the form below to log the first call or email.</p>';
      } else {
        html += '<div class="timeline">' + activities.map(function (a) {
          var done = !!a.done_at;
          return '<div class="tl-item' + (done ? ' is-done' : '') + '">'
            + '<div class="tl-meta">' + escHtml(a.type) + ' · ' + escHtml(a.admin_user || 'system') + ' · ' + escHtml(String(a.created_at || '')) + '</div>'
            + '<div class="tl-body">' + escHtml(a.content) + '</div>'
            + (a.due_at ? '<div class="tl-due">reminder: ' + escHtml(a.due_at) + '</div>' : '')
            + '</div>';
        }).join('') + '</div>';
      }
      html += '</div>';

      document.getElementById('inquiry-body').innerHTML = html;
    }

    window.closeInquiryModal = function() {
      document.getElementById('inquiry-modal').classList.remove('active');
      currentInquiry = null;
    };

    window.setPriority = async function(id, value) {
      try {
        await API.put('/inquiries/' + id + '/priority', { value: value });
        showNotification('Priority set to ' + value, 'success');
        if (currentInquiry && currentInquiry.id === id) currentInquiry.priority = value;
        loadInquiries();
      } catch (e) {
        showNotification('Failed to set priority', 'error');
      }
    };

    window.setInquiryStatus = async function(id, value) {
      try {
        await API.put('/inquiries/' + id + '/status', { status: value });
        showNotification('Status changed to ' + value, 'success');
        if (currentInquiry && currentInquiry.id === id) currentInquiry.status = value;
        loadInquiries();
        loadDashboardStats();
      } catch (e) {
        showNotification('Failed to change status', 'error');
      }
    };

    window.setFollowUp = async function(id, value) {
      try {
        var out = await API.put('/inquiries/' + id + '/follow-up', { value: value });
        showNotification(value ? 'Reminder set for ' + value : 'Reminder cleared', 'success');
        if (currentInquiry && currentInquiry.id === id) {
          currentInquiry.next_follow_at = (out && out.value) || null;
        }
        loadInquiries();
      } catch (e) {
        showNotification('Failed to set reminder', 'error');
      }
    };

    window.saveNotes = async function(id) {
      var el = document.getElementById('inq-notes');
      try {
        await API.put('/inquiries/' + id + '/notes', { value: el.value });
        showNotification('Notes saved', 'success');
        loadInquiries();
      } catch (e) {
        showNotification('Failed to save notes', 'error');
      }
    };

    window.addActivity = async function() {
      if (!currentInquiry) return;
      var content = document.getElementById('act-content').value.trim();
      if (!content) { showNotification('Write what happened first', 'error'); return; }
      var due = document.getElementById('act-due').value;
      try {
        await API.post('/crm/activities', {
          inquiry_id: currentInquiry.id,
          customer_id: currentInquiry.customer_id || null,
          type: document.getElementById('act-type').value,
          content: content,
          due_at: due || null,
        });
        document.getElementById('act-content').value = '';
        document.getElementById('act-due').value = '';
        showNotification('Follow-up logged', 'success');
        // 重新拉一次，时间线与提醒日期同时刷新
        viewInquiry(currentInquiry.id);
        loadInquiries();
      } catch (e) {
        showNotification('Failed to add follow-up', 'error');
      }
    };

    /**
     * 附件下载。API 是 Bearer 鉴权，直接 window.open 不带 token 会 401，
     * 所以用 fetch 取 blob 再触发下载。
     */
    window.downloadAttachment = async function(id) {
      try {
        var res = await fetch('/api/inquiries/' + id + '/attachment', {
          headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var blob = await res.blob();
        var cd = res.headers.get('Content-Disposition') || '';
        var m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
        var name = m ? decodeURIComponent(m[1]) : 'attachment';
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        showNotification('Download failed: ' + e.message, 'error');
      }
    };


    window.deleteInquiry = async function(id) {
      if (!confirm('Are you sure you want to delete this inquiry?')) {
        return;
      }

      try {
        await API.delete(\`/inquiries/\${id}\`);
        showNotification('Inquiry deleted successfully', 'success');
        loadInquiries();
        loadDashboardStats();
      } catch (error) {
        showNotification('Error deleting inquiry', 'error');
      }
    };

    // Settings Management Functions
    async function loadSettings() {
      try {
        const response = await API.get('/settings');
        if (response.success) {
          const settings = response.data;

          // Populate form fields
          document.getElementById('settings-site-name').value = settings.site_name || '';
          document.getElementById('settings-site-description').value = settings.site_description || '';
          document.getElementById('settings-company-intro').value = settings.company_intro || '';
          document.getElementById('settings-email').value = settings.email || '';
          document.getElementById('settings-phone').value = settings.phone || '';
          document.getElementById('settings-address').value = settings.address || '';
          document.getElementById('settings-linkedin').value = settings.linkedin || '';
          document.getElementById('settings-facebook').value = settings.facebook || '';
          document.getElementById('settings-twitter').value = settings.twitter || '';
          document.getElementById('settings-whatsapp').value = settings.whatsapp || '';
          document.getElementById('settings-ga4').value = settings.ga4_id || '';
          document.getElementById('settings-founded-at').value = settings.founded_at || '';
          document.getElementById('settings-employees').value = settings.employees || '';
          document.getElementById('settings-countries').value = settings.countries_served || '';
          document.getElementById('settings-capacity').value = settings.annual_capacity || '';
          document.getElementById('settings-theme').value = settings.theme_default || 'classic';
          document.getElementById('settings-business-hours').value = settings.business_hours || '';
          document.getElementById('settings-beneficiary').value = settings.beneficiary || '';
          document.getElementById('settings-bank-name').value = settings.bank_name || '';
          document.getElementById('settings-bank-account').value = settings.bank_account || '';
          document.getElementById('settings-swift').value = settings.swift || '';
        }
      } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('Error loading settings', 'error');
      }
    }

    // 阶段四：页面级 SEO（和 settings.js 的 SEO_PAGE_KEYS 保持一致，多一个都存不进去）
    var SEO_PAGES = [
      { key: '/', label: 'Home' },
      { key: '/products', label: 'Products (list)' },
      { key: '/cases', label: 'Case Studies (list)' },
      { key: '/news', label: 'News (list)' },
      { key: '/about', label: 'About Us' },
      { key: '/contact', label: 'Contact' },
      { key: '/faq', label: 'FAQ' }
    ];

    function seoInputId(pageKey, field) {
      return 'seo-in-' + pageKey.replace(/[^a-z0-9]/gi, '') + '-' + field;
    }

    window.loadSeoSettings = async function () {
      var box = document.getElementById('seo-pages');
      if (!box) return;
      box.innerHTML = '<p style="padding:1rem;color:var(--text-light)">Loading...</p>';
      try {
        var res = await API.get('/settings');
        var settings = (res && res.data) || {};
        var pages = (settings.seo_pages && typeof settings.seo_pages === 'object') ? settings.seo_pages : {};
        var ogInput = document.getElementById('seo-og-image');
        if (ogInput) ogInput.value = settings.seo_og_image || '';

        box.innerHTML = SEO_PAGES.map(function (p) {
          var v = pages[p.key] || {};
          var state = (v.title || v.description)
            ? '<span style="color:#059669;font-size:.72rem">configured</span>'
            : '<span style="color:#9ca3af;font-size:.72rem">default</span>';
          var title = v.title || '';
          var desc = v.description || '';
          var og = v.og_image || '';
          return ''
            + '<details class="seo-page" data-page="' + escHtml(p.key) + '" style="border:1px solid var(--border-color);border-radius:.4rem;margin-bottom:.6rem;padding:.7rem .9rem">'
            +   '<summary style="cursor:pointer;font-size:.9rem;font-weight:600">'
            +     escHtml(p.label) + ' <code style="font-weight:400;color:#6b7280;font-size:.78rem">' + escHtml(p.key) + '</code> ' + state
            +   '</summary>'
            +   '<div style="margin-top:.8rem">'
            +     '<div class="form-group">'
            +       '<label class="form-label" for="' + seoInputId(p.key, 'title') + '">Title '
            +         '<span class="seo-count" style="font-weight:400;color:#9ca3af"></span></label>'
            +       '<input type="text" id="' + seoInputId(p.key, 'title') + '" class="form-input" data-field="title" maxlength="120" '
            +         'placeholder="Leave empty to use the built-in title" value="' + escHtml(title) + '" oninput="updateSeoPreview(this)">'
            +     '</div>'
            +     '<div class="form-group">'
            +       '<label class="form-label" for="' + seoInputId(p.key, 'desc') + '">Meta description '
            +         '<span class="seo-count" style="font-weight:400;color:#9ca3af"></span></label>'
            +       '<textarea id="' + seoInputId(p.key, 'desc') + '" class="form-textarea" data-field="description" maxlength="300" rows="2" '
            +         'placeholder="Leave empty to use the built-in description" oninput="updateSeoPreview(this)">' + escHtml(desc) + '</textarea>'
            +     '</div>'
            +     '<div class="form-group">'
            +       '<label class="form-label" for="' + seoInputId(p.key, 'og') + '">Share image for this page</label>'
            +       '<input type="text" id="' + seoInputId(p.key, 'og') + '" class="form-input" data-field="og_image" maxlength="500" '
            +         'placeholder="Optional — inherits the default share image" value="' + escHtml(og) + '">'
            +     '</div>'
            +     '<div class="seo-preview" style="border:1px solid #e5e7eb;border-radius:.4rem;padding:.7rem .8rem;background:#fafafa">'
            +       '<div data-preview-title style="color:#1a0dab;font-size:1rem;line-height:1.3;overflow:hidden;text-overflow:ellipsis"></div>'
            +       '<div data-preview-url style="color:#0f7a35;font-size:.78rem;margin:.15rem 0"></div>'
            +       '<div data-preview-desc style="color:#4b5563;font-size:.8rem;line-height:1.45"></div>'
            +     '</div>'
            +   '</div>'
            + '</details>';
        }).join('');

        // 首次渲染后填充预览
        box.querySelectorAll('.seo-page').forEach(function (d) {
          updateSeoPreview(d.querySelector('[data-field="title"]'));
        });
      } catch (e) {
        console.error('Error loading SEO settings:', e);
        box.innerHTML = '<p style="padding:1rem;color:#dc2626">Failed to load SEO settings: ' + escHtml(e.message) + '</p>';
      }
    };

    /** 实时 SERP 预览：运营能直接看到搜索结果里会显示成什么样 */
    window.updateSeoPreview = function (el) {
      if (!el) return;
      var details = el.closest('.seo-page');
      if (!details) return;
      var page = details.getAttribute('data-page') || '/';
      var titleEl = details.querySelector('[data-field="title"]');
      var descEl = details.querySelector('[data-field="description"]');
      var title = titleEl ? titleEl.value.trim() : '';
      var desc = descEl ? descEl.value.trim() : '';
      var siteName = 'Your site';

      var pTitle = details.querySelector('[data-preview-title]');
      var pUrl = details.querySelector('[data-preview-url]');
      var pDesc = details.querySelector('[data-preview-desc]');
      var fallbackTitle = page === '/' ? siteName : (page.replace('/', '').replace(/^./, function (c) { return c.toUpperCase(); }));
      if (pTitle) pTitle.textContent = title || (fallbackTitle + ' - ' + siteName);
      if (pUrl) pUrl.textContent = window.location.origin + page;
      if (pDesc) pDesc.textContent = desc || '(search engines will pick text from the page)';

      // 长度提示：标题 60 / 描述 155 是 Google 常见的截断点
      var counts = details.querySelectorAll('.seo-count');
      if (counts[0]) counts[0].textContent = (title.length) + '/60';
      if (counts[1]) counts[1].textContent = (desc.length) + '/155';
      if (counts[0]) counts[0].style.color = title.length > 60 ? '#dc2626' : '#9ca3af';
      if (counts[1]) counts[1].style.color = desc.length > 155 ? '#dc2626' : '#9ca3af';
    };

    window.saveSeoSettings = async function () {
      if (!isSuperAdmin) {
        showNotification('Only super admin can change SEO settings', 'error');
        return;
      }
      var pages = {};
      document.querySelectorAll('.seo-page').forEach(function (d) {
        var key = d.getAttribute('data-page');
        var title = (d.querySelector('[data-field="title"]') || {}).value || '';
        var desc = (d.querySelector('[data-field="description"]') || {}).value || '';
        var og = (d.querySelector('[data-field="og_image"]') || {}).value || '';
        if (title.trim() || desc.trim() || og.trim()) {
          pages[key] = { title: title.trim(), description: desc.trim(), og_image: og.trim() };
        }
      });
      var ogInput = document.getElementById('seo-og-image');
      var btn = document.getElementById('save-seo-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
      try {
        var res = await API.post('/settings', {
          seo_pages: pages,
          seo_og_image: ogInput ? ogInput.value.trim() : ''
        });
        if (res && res.success) {
          showNotification('SEO settings saved', 'success');
          loadSeoSettings();
        } else {
          showNotification((res && res.error) || 'Failed to save SEO settings', 'error');
        }
      } catch (e) {
        console.error('Error saving SEO settings:', e);
        showNotification('Error saving SEO settings', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save SEO settings'; }
      }
    };

    // 阶段二B：登录审计列表（仅超管可见）
    window.loadLoginLogs = async function() {
      var box = document.getElementById('login-logs');
      if (!box) return;
      try {
        var res = await API.get('/admin/login-logs');
        var rows = (res && res.data) || [];
        if (!rows.length) {
          box.innerHTML = '<p style="padding:1rem;color:var(--text-light)">No sign-in records yet.</p>';
          return;
        }
        var esc = function (s) {
          return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
          });
        };
        box.innerHTML = '<table class="table"><thead><tr>'
          + '<th>Time (UTC)</th><th>User</th><th>Result</th><th>IP</th><th>Country</th><th>Reason</th>'
          + '</tr></thead><tbody>'
          + rows.map(function (r) {
              return '<tr>'
                + '<td>' + esc(r.created_at) + '</td>'
                + '<td>' + esc(r.username || '-') + '</td>'
                + '<td><span class="badge badge-' + (r.ok ? 'completed' : 'pending') + '">' + (r.ok ? 'ok' : 'failed') + '</span></td>'
                + '<td>' + esc(r.ip || '-') + '</td>'
                + '<td>' + esc(r.country || '-') + '</td>'
                + '<td>' + esc(r.reason || '-') + '</td>'
                + '</tr>';
            }).join('')
          + '</tbody></table>';
      } catch (e) {
        box.innerHTML = '<p style="padding:1rem;color:#dc2626">' + escHtml(e.message) + '</p>';
      }
    };

    // ---------- 翻译引擎设置（1.4.0） ----------
    // 密钥只在「运营本次真的输入」时才离开浏览器；后端永远只回一个 api_key_set 布尔值。
    function trValue(id) {
      var el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    }
    function trStatus(text, isError) {
      var el = document.getElementById('tr-engine-status');
      if (!el) return;
      el.textContent = text || '';
      el.style.color = isError ? '#dc2626' : 'var(--text-light)';
    }
    function trForm() {
      var keyEl = document.getElementById('tr-api-key');
      return {
        engine: trValue('tr-engine') || 'workers_ai',
        base_url: trValue('tr-base-url'),
        model: trValue('tr-model'),
        api_key: keyEl ? String(keyEl.value || '').trim() : '',
        temperature: Number(trValue('tr-temperature') || 0.2),
        clear_api_key: !!(document.getElementById('tr-clear-key') || {}).checked
      };
    }
    window.onTranslationEngineChange = function() {
      var box = document.getElementById('tr-openai-fields');
      if (box) box.style.display = (trValue('tr-engine') === 'openai') ? 'block' : 'none';
    };

    // skipStatus=true 用于保存后重载：不要把刚显示的「Saved / 错误信息」冲掉
    async function loadTranslationSettings(skipStatus) {
      var keyStatus = document.getElementById('tr-key-status');
      if (!isSuperAdmin) {
        if (keyStatus) keyStatus.textContent = 'Super admin only';
        return;
      }
      try {
        var res = await API.get('/settings/translation');
        if (!res || !res.success) { trStatus((res && res.error) || 'Failed to load', true); return; }
        var d = res.data || {};
        var sel = document.getElementById('tr-engine');
        if (sel) sel.value = (d.engine === 'openai') ? 'openai' : 'workers_ai';
        var base = document.getElementById('tr-base-url'); if (base) base.value = d.base_url || '';
        var model = document.getElementById('tr-model'); if (model) model.value = d.model || '';
        var temp = document.getElementById('tr-temperature');
        if (temp) temp.value = (d.temperature === 0 ? 0 : (d.temperature || 0.2));
        var key = document.getElementById('tr-api-key'); if (key) key.value = '';
        var clear = document.getElementById('tr-clear-key'); if (clear) clear.checked = false;
        if (keyStatus) keyStatus.textContent = d.api_key_set
          ? 'A key is saved (encrypted). Leave the field blank to keep it.'
          : 'No key saved yet.';
        window.onTranslationEngineChange();
        if (!skipStatus) trStatus(d.engine === 'openai' ? 'Custom OpenAI-compatible engine' : 'Workers AI built-in engine');
      } catch (e) {
        if (!skipStatus) trStatus('Failed to load: ' + e.message, true);
      }
    }
    window.loadTranslationSettings = loadTranslationSettings;

    window.saveTranslationSettings = async function() {
      if (!isSuperAdmin) { showNotification('Only super admin can change the translation engine', 'error'); return; }
      var btn = document.getElementById('tr-save-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
      trStatus('Saving…');
      try {
        var res = await API.post('/settings/translation', trForm());
        if (res && res.success) {
          showNotification('Translation engine saved', 'success');
          await loadTranslationSettings(true);
          trStatus('Saved · ' + (res.data.engine === 'openai' ? 'custom OpenAI-compatible' : 'Workers AI'));
        } else {
          var msg = (res && res.error) || 'Failed to save';
          showNotification(msg, 'error');
          trStatus(msg, true);
        }
      } catch (e) {
        showNotification('Error saving translation settings', 'error');
        trStatus(e.message, true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save engine settings'; }
      }
    };

    window.testTranslationSettings = async function() {
      if (!isSuperAdmin) { showNotification('Only super admin can test the translation engine', 'error'); return; }
      var btn = document.getElementById('tr-test-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Testing...'; }
      trStatus('Testing connection (one real model call)…');
      try {
        var res = await API.post('/settings/translation/test', trForm());
        if (res && res.success) {
          var d = res.data || {};
          trStatus('OK · ' + d.model + ' · ' + (d.latencyMs || 0) + 'ms · ' + String(d.sample || '').slice(0, 60));
          showNotification('Connection OK', 'success');
        } else {
          var msg = (res && res.error) || 'Connection failed';
          trStatus(msg, true);
          showNotification(msg, 'error');
        }
      } catch (e) {
        trStatus('Connection failed: ' + e.message, true);
        showNotification('Connection failed', 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Test connection'; }
      }
    };

    window.loadSettings = loadSettings;

    /* ---- 阶段二C：邮件模板编辑 ---- */
    window.loadMailTemplates = async function() {
      var box = document.getElementById('mail-templates');
      if (!box) return;
      try {
        var res = await API.get('/settings/mail-templates');
        var data = (res && res.data) || {};
        var meta = (res && res.meta) || [];
        var defaults = (res && res.defaults) || {};
        if (!meta.length) { box.innerHTML = '<p style="padding:1rem;color:#dc2626">Template metadata unavailable.</p>'; return; }

        box.innerHTML = meta.map(function (m) {
          var val = data[m.key] == null ? '' : data[m.key];
          var isLong = val.indexOf('\\n') > -1 || val.length > 90 || /body/i.test(m.key);
          var input = isLong
            ? '<textarea data-tpl="' + m.key + '" class="form-textarea" style="min-height:90px;font-family:ui-monospace,Menlo,monospace;font-size:0.8rem">' + escHtml(val) + '</textarea>'
            : '<input type="text" data-tpl="' + m.key + '" class="form-input" value="' + escHtml(val) + '">';
          var ph = (m.placeholders || []).length
            ? '<span class="tr-hint">placeholders: ' + m.placeholders.map(function (p) { return '{{' + p + '}}'; }).join(' ') + '</span>'
            : '';
          var changed = defaults[m.key] !== val ? ' <span style="color:#b45309;font-size:0.75rem">modified</span>' : '';
          return '<div class="form-group"><label class="form-label" style="font-size:0.82rem">' + escHtml(m.label) + changed + '</label>'
            + input + ph + '</div>';
        }).join('');
      } catch (e) {
        box.innerHTML = '<p style="padding:1rem;color:#dc2626">' + escHtml(e.message) + '</p>';
      }
    };

    window.saveMailTemplates = async function() {
      var payload = {};
      document.querySelectorAll('[data-tpl]').forEach(function (el) {
        payload[el.getAttribute('data-tpl')] = el.value;
      });
      try {
        await API.post('/settings/mail-templates', payload);
        showNotification('Templates saved', 'success');
        loadMailTemplates();
      } catch (e) {
        showNotification('Save failed: ' + e.message, 'error');
      }
    };

    window.resetMailTemplates = async function() {
      if (!confirm('Reset all email templates to the built-in defaults?')) return;
      try {
        await API.delete('/settings/mail-templates');
        showNotification('Templates reset', 'success');
        loadMailTemplates();
      } catch (e) {
        showNotification('Reset failed: ' + e.message, 'error');
      }
    };

    /* ---- 阶段二C：订阅名单 ---- */
    window.loadSubscribers = async function() {
      var box = document.getElementById('subscriber-list');
      var stats = document.getElementById('subscriber-stats');
      if (!box) return;
      try {
        var res = await API.get('/subscribers');
        var rows = (res && res.data) || [];
        var counts = (res && res.counts) || [];
        if (stats) {
          stats.innerHTML = counts.length
            ? counts.map(function (c) {
                return '<span style="display:inline-block;margin-right:0.5rem;padding:2px 10px;border-radius:10px;background:#eef2ff;color:#3730a3;font-size:0.78rem">'
                  + escHtml(c.status) + ': ' + c.n + '</span>';
              }).join('')
            : '<span class="tr-hint">No subscribers yet.</span>';
        }
        if (!rows.length) {
          box.innerHTML = '<p style="padding:1rem;color:var(--text-light)">No subscribers yet. The signup form is in the site footer.</p>';
          return;
        }
        box.innerHTML = '<table class="table"><thead><tr>'
          + '<th>Email</th><th>Status</th><th>Lang</th><th>Source</th><th>Created</th><th>Confirmed</th>'
          + '</tr></thead><tbody>'
          + rows.map(function (r) {
              var cls = r.status === 'confirmed' ? 'completed' : (r.status === 'pending' ? 'pending' : 'processing');
              return '<tr>'
                + '<td>' + escHtml(r.email) + '</td>'
                + '<td><span class="badge badge-' + cls + '">' + escHtml(r.status) + '</span></td>'
                + '<td>' + escHtml(r.lang || 'en') + '</td>'
                + '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">' + escHtml(r.source || '-') + '</td>'
                + '<td>' + escHtml(r.created_at || '') + '</td>'
                + '<td>' + escHtml(r.confirmed_at || '-') + '</td>'
                + '</tr>';
            }).join('')
          + '</tbody></table>';
      } catch (e) {
        box.innerHTML = '<p style="padding:1rem;color:#dc2626">' + escHtml(e.message) + '</p>';
      }
    };

    // Disable settings save for non-super admins
    if (!isSuperAdmin) {
      const saveSettingsBtn = document.getElementById('save-settings-btn');
      if (saveSettingsBtn) {
        saveSettingsBtn.disabled = true;
        saveSettingsBtn.textContent = 'Save Settings (Super Admin Only)';
        saveSettingsBtn.style.opacity = '0.5';
        saveSettingsBtn.style.cursor = 'not-allowed';
      }

      // Make all settings form fields readonly for non-super admins
      const settingsForm = document.getElementById('settings-form');
      if (settingsForm) {
        const inputs = settingsForm.querySelectorAll('input, textarea');
        inputs.forEach(input => {
          input.readOnly = true;
          input.style.backgroundColor = '#f3f4f6';
        });
      }

      // 翻译引擎卡片在 form 之外，不会被上面的 readonly 覆盖，必须单独禁用：
      // 里面涉及模型密钥，非超管连「能不能改」都不该看见可用状态。
      const trCard = document.getElementById('translation-card');
      if (trCard) {
        trCard.querySelectorAll('input, select, button').forEach(el => { el.disabled = true; });
        const st = document.getElementById('tr-engine-status');
        if (st) st.textContent = 'Super admin only';
      }
    }

    // Handle settings form submission
    document.getElementById('settings-form').addEventListener('submit', async function(e) {
      e.preventDefault();

      // Check if user is super admin
      if (!isSuperAdmin) {
        showNotification('Only super admin can save settings', 'error');
        return;
      }

      const formData = {
        site_name: document.getElementById('settings-site-name').value,
        site_description: document.getElementById('settings-site-description').value,
        company_intro: document.getElementById('settings-company-intro').value,
        email: document.getElementById('settings-email').value,
        phone: document.getElementById('settings-phone').value,
        address: document.getElementById('settings-address').value,
        linkedin: document.getElementById('settings-linkedin').value,
        facebook: document.getElementById('settings-facebook').value,
        twitter: document.getElementById('settings-twitter').value,
        whatsapp: document.getElementById('settings-whatsapp').value,
        ga4_id: document.getElementById('settings-ga4').value,
        founded_at: document.getElementById('settings-founded-at').value,
        employees: document.getElementById('settings-employees').value,
        countries_served: document.getElementById('settings-countries').value,
        annual_capacity: document.getElementById('settings-capacity').value,
        theme_default: document.getElementById('settings-theme').value,
        business_hours: document.getElementById('settings-business-hours').value,
        beneficiary: document.getElementById('settings-beneficiary').value,
        bank_name: document.getElementById('settings-bank-name').value,
        bank_account: document.getElementById('settings-bank-account').value,
        swift: document.getElementById('settings-swift').value,
      };

      try {
        const response = await API.post('/settings', formData);
        if (response.success) {
          showNotification('Settings saved successfully', 'success');
        } else {
          showNotification(response.error || 'Failed to save settings', 'error');
        }
      } catch (error) {
        console.error('Error saving settings:', error);
        showNotification('Error saving settings', 'error');
      }
    });

    // Initialize dashboard
    loadDashboardStats();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
    },
  });
}
