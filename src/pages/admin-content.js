/**
 * 后台内容管理（阶段一B）
 *
 * 一个页面管理 6 类内容：新闻 / 案例 / 资质 / 品牌 / FAQ / 工厂实力。
 * 表格列与表单字段全部由 src/content-schema.js 的配置驱动，
 * 新增内容类型不需要改这个文件。
 *
 * URL: /admin/content/:type
 */
import { resolveContentType, CONTENT_TYPES } from '../content-schema';
import { supportedLangs, LANG_META } from '../i18n';

export async function adminContentPage(request, env) {
  const url = new URL(request.url);
  const seg = url.pathname.split('/').filter(Boolean)[2] || 'posts';
  const resolved = resolveContentType(seg);

  if (!resolved) {
    return new Response('<!doctype html><html><body><h1>404</h1><p>Unknown content type.</p></body></html>', {
      status: 404, headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  const { key, config } = resolved;
  const defLang = env.DEFAULT_LANG || 'en';
  const allLangs = supportedLangs(env);
  const trLangs = allLangs.filter(l => l !== defLang);
  const sourceOptions = [{ code: 'auto', name: '自动检测（中文 / English）' }]
    .concat(allLangs.map(l => ({ code: l, name: (LANG_META[l] && LANG_META[l].name) || l })))
    .map(o => `<option value="${o.code}">${o.name}</option>`).join('');
  const payload = JSON.stringify({ key, config, trLangs, langMeta: LANG_META })
    .replace(/</g, '\\u003c');

  const navItems = Object.entries(CONTENT_TYPES).map(([k, c]) =>
    `<a href="/admin/content/${k}" class="side-link${k === key ? ' active' : ''}">${c.label}</a>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${config.label} - Admin</title>
<style>
  :root{--primary:#2563eb;--primary-dark:#1e40af;--accent:#f59e0b;--text:#1f2937;--muted:#6b7280;--bg:#f9fafb;--border:#e5e7eb;--ok:#10b981;--danger:#ef4444}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
  .layout{display:flex;min-height:100vh}
  .side{width:220px;background:#111827;color:#e5e7eb;padding:1.25rem 0;flex-shrink:0}
  .side .brand{color:var(--accent);font-weight:700;font-size:1.1rem;padding:0 1.25rem 1rem}
  .side .group{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;padding:.9rem 1.25rem .3rem}
  .side-link{display:block;padding:.55rem 1.25rem;color:#d1d5db;text-decoration:none;font-size:.9rem;border-left:3px solid transparent}
  .side-link:hover{background:#1f2937;color:#fff}
  .side-link.active{background:#1f2937;color:#fff;border-left-color:var(--accent)}
  .main{flex:1;min-width:0;padding:1.75rem 2rem 3rem}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1.5rem;flex-wrap:wrap}
  h1{font-size:1.45rem}
  .sub{color:var(--muted);font-size:.88rem;margin-top:.2rem}
  .btn{display:inline-flex;align-items:center;gap:.4rem;padding:.55rem 1rem;border-radius:.375rem;border:1px solid var(--border);background:#fff;color:var(--text);cursor:pointer;font-size:.9rem;text-decoration:none}
  .btn:hover{background:var(--bg)}
  .btn-primary{background:var(--primary);border-color:var(--primary);color:#fff}
  .btn-primary:hover{background:var(--primary-dark)}
  .btn-danger{background:var(--danger);border-color:var(--danger);color:#fff}
  .btn-sm{padding:.3rem .6rem;font-size:.8rem}
  .panel{background:#fff;border:1px solid var(--border);border-radius:.5rem;overflow:hidden}
  table{width:100%;border-collapse:collapse;font-size:.9rem}
  th{text-align:left;padding:.75rem 1rem;background:var(--bg);border-bottom:1px solid var(--border);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);white-space:nowrap}
  td{padding:.7rem 1rem;border-bottom:1px solid var(--border);vertical-align:middle}
  tr:last-child td{border-bottom:none}
  .primary-cell{font-weight:600}
  .muted{color:var(--muted);font-size:.82rem}
  .badge{display:inline-block;padding:.1rem .45rem;border-radius:.25rem;font-size:.72rem;background:var(--bg);color:var(--muted)}
  .badge-ok{background:#ecfdf5;color:#047857}
  .actions{display:flex;gap:.4rem;white-space:nowrap}
  .empty{padding:2.5rem;text-align:center;color:var(--muted)}
  .modal{display:none;position:fixed;inset:0;background:rgba(17,24,39,.55);z-index:100;padding:2rem 1rem;overflow-y:auto}
  .modal.active{display:block}
  .modal-box{max-width:760px;margin:0 auto;background:#fff;border-radius:.6rem;padding:1.5rem}
  .modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem}
  .modal-head h2{font-size:1.15rem}
  .close{border:none;background:none;font-size:1.5rem;line-height:1;cursor:pointer;color:var(--muted)}
  .field{margin-bottom:1rem}
  .field label{display:block;font-size:.84rem;font-weight:500;margin-bottom:.35rem}
  .input,.textarea,.select{width:100%;padding:.6rem .7rem;border:1px solid var(--border);border-radius:.375rem;font-size:.92rem;font-family:inherit}
  .input:focus,.textarea:focus,.select:focus{outline:none;border-color:var(--primary)}
  .textarea{resize:vertical;min-height:80px}
  .checkbox{display:flex;align-items:center;gap:.5rem;font-size:.9rem}
  .hint{font-size:.75rem;color:var(--muted);margin-top:.3rem}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  .tr-tabs{display:flex;gap:.25rem;border-bottom:1px solid var(--border);margin-bottom:.9rem;flex-wrap:wrap}
  .tr-tab{border:none;background:none;padding:.4rem .75rem;cursor:pointer;font-size:.86rem;color:var(--muted);border-bottom:2px solid transparent}
  .tr-tab.active{color:var(--primary);border-bottom-color:var(--primary);font-weight:600}
  .tr-pane{display:none}
  .tr-pane.active{display:block}
  .modal-foot{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)}
  .toast{position:fixed;right:1.25rem;bottom:1.25rem;padding:.75rem 1rem;border-radius:.4rem;color:#fff;font-size:.88rem;z-index:200;opacity:0;transform:translateY(8px);transition:.25s}
  .toast.show{opacity:1;transform:none}
  .toast.ok{background:#059669}.toast.err{background:#dc2626}
  @media(max-width:820px){.layout{flex-direction:column}.side{width:100%;display:flex;flex-wrap:wrap;align-items:center}.side .brand{padding:.6rem 1rem}.side .group{display:none}.side-link{padding:.5rem .8rem;border-left:none;border-bottom:3px solid transparent}.side-link.active{border-bottom-color:var(--accent)}.main{padding:1rem}.row2{grid-template-columns:1fr}td,th{padding:.55rem .6rem}}
</style>
</head>
<body>
<div class="layout">
  <aside class="side">
    <div class="brand">B2B Admin</div>
    <div class="group">Content</div>
    ${navItems}
    <div class="group">Back</div>
    <a href="/admin/trade" class="side-link">🧾 Quotes &amp; Orders</a>
    <a href="/admin/dashboard" class="side-link">← Dashboard</a>
    <a href="/admin/dashboard" class="side-link" onclick="localStorage.removeItem('admin_token');localStorage.removeItem('admin_role')">Logout</a>
  </aside>

  <main class="main">
    <div class="topbar">
      <div>
        <h1>${config.label}</h1>
        <p class="sub">用表格管理内容；所有改动立即写入 D1，前台服务端直出。</p>
      </div>
      <button class="btn btn-primary" onclick="openModal()">+ New ${config.label}</button>
    </div>

    <div class="panel">
      <table>
        <thead><tr id="thead-row"></tr></thead>
        <tbody id="tbody"><tr><td colspan="9" class="empty">Loading...</td></tr></tbody>
      </table>
    </div>
  </main>
</div>

<div class="modal" id="modal">
  <div class="modal-box">
    <div class="modal-head">
      <h2 id="modal-title">New</h2>
      <button class="close" onclick="closeModal()">&times;</button>
    </div>
    <form id="content-form">
      <input type="hidden" id="row-id">
      <div id="fields"></div>
      <div id="tr-section" style="display:none;margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)">
        <label style="display:block;font-size:.84rem;font-weight:500;margin-bottom:.5rem">Translations</label>
        <!-- 一键生成译文：只回填输入框，不入库；人工核对后点 Save 才落库 -->
        <div id="tr-toolbar" style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end;margin:0 0 .8rem;padding:.6rem .7rem;background:var(--bg-light,#f9fafb);border:1px solid var(--border,#e5e7eb);border-radius:.4rem">
          <div style="display:flex;flex-direction:column;gap:.2rem">
            <label for="tr-source-lang" style="font-size:.74rem;color:var(--muted,#6b7280)">原文语言</label>
            <select id="tr-source-lang" class="input" style="min-width:165px;padding:.3rem .45rem;font-size:.82rem">${sourceOptions}</select>
          </div>
          <div style="display:flex;flex-direction:column;gap:.2rem">
            <label for="tr-mode" style="font-size:.74rem;color:var(--muted,#6b7280)">写入方式</label>
            <select id="tr-mode" class="input" style="min-width:135px;padding:.3rem .45rem;font-size:.82rem">
              <option value="fill">只补空字段（推荐）</option>
              <option value="overwrite">覆盖已有译文</option>
            </select>
          </div>
          <button type="button" class="btn" id="tr-auto-btn" onclick="autoTranslate()" style="padding:.35rem .75rem">一键生成译文</button>
          <span id="tr-progress" class="hint" style="margin:0;flex:1 1 150px;min-height:1.2em" aria-live="polite"></span>
        </div>
        <div class="tr-tabs" id="tr-tabs"></div>
        <div id="tr-panes"></div>
        <p class="hint">留空的字段自动回退英文；保存时以各语种输入框为准。</p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="save-btn">Save</button>
      </div>
    </form>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
  var CONTENT = ${payload};
  var TOKEN = localStorage.getItem('admin_token');
  if (!TOKEN) { location.href = '/admin/login'; }
  var ROWS = [];

  function toast(msg, kind) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (kind === 'err' ? 'err' : 'ok');
    setTimeout(function () { el.className = 'toast ' + (kind === 'err' ? 'err' : 'ok'); }, 2600);
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    return fetch('/api' + path, opts).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * 宽松解析 JSON 列：库里可能存着双层编码的 translations
   * （历史上写入侧多 stringify 了一次），只 parse 一次会拿到字符串，
   * 多语言 Tab 就永远是空的，一保存还会把坏结构写回去。
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

  /* ---------------- 表格 ---------------- */

  function renderHead() {
    var tr = document.getElementById('thead-row');
    tr.innerHTML = CONTENT.config.listFields.map(function (f) {
      return '<th>' + esc(f.label) + '</th>';
    }).join('') + '<th style="width:140px">Actions</th>';
  }

  function formatCell(field, row) {
    var v = row[field.name];
    if (field.type === 'bool') {
      return v ? '<span class="badge badge-ok">Live</span>' : '<span class="badge">Hidden</span>';
    }
    if (field.type === 'date') {
      if (!v) return '<span class="muted">—</span>';
      return '<span class="muted">' + esc(String(v).slice(0, 10)) + '</span>';
    }
    if (v == null || v === '') return '<span class="muted">—</span>';
    var text = String(v);
    if (text.length > 80) text = text.slice(0, 80) + '...';
    return field.primary ? '<span class="primary-cell">' + esc(text) + '</span>' : esc(text);
  }

  function renderTable() {
    var tbody = document.getElementById('tbody');
    if (!ROWS.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No entries yet. Click "+ New" to create one.</td></tr>';
      return;
    }
    tbody.innerHTML = ROWS.map(function (row) {
      var cells = CONTENT.config.listFields.map(function (f) {
        return '<td>' + formatCell(f, row) + '</td>';
      }).join('');
      return '<tr data-id="' + row.id + '">' + cells +
        '<td><div class="actions">' +
        '<button class="btn btn-sm" onclick="openModal(' + row.id + ')">Edit</button>' +
        '<button class="btn btn-sm btn-danger" onclick="removeRow(' + row.id + ')">Delete</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function load() {
    api('/content/' + CONTENT.key).then(function (r) {
      if (!r.ok) { toast(r.body.error || 'Load failed', 'err'); return; }
      ROWS = r.body.data || [];
      renderTable();
    }).catch(function () { toast('Network error', 'err'); });
  }

  /* ---------------- 表单 ---------------- */

  function fieldControl(field, value) {
    var id = 'f-' + field.name;
    if (field.type === 'textarea') {
      return '<textarea class="textarea" id="' + id + '" data-name="' + field.name + '"' +
        (field.rows ? ' style="min-height:' + (field.rows * 1.5) + 'em"' : '') + '>' + esc(value || '') + '</textarea>';
    }
    if (field.type === 'select') {
      var opts = (field.options || []).map(function (o) {
        return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('');
      return '<select class="select" id="' + id + '" data-name="' + field.name + '">' + opts + '</select>';
    }
    if (field.type === 'bool') {
      return '<label class="checkbox"><input type="checkbox" id="' + id + '" data-name="' + field.name + '"' +
        (value ? ' checked' : '') + '> Active</label>';
    }
    if (field.type === 'image') {
      return '<div style="display:flex;gap:.5rem;align-items:center">' +
        '<input class="input" type="text" id="' + id + '" data-name="' + field.name + '" value="' + esc(value || '') + '" placeholder="/api/upload/image/... or https://...">' +
        '<label class="btn btn-sm" style="white-space:nowrap">Upload<input type="file" accept="image/*" style="display:none" onchange="uploadImage(event,\\'' + field.name + '\\')"></label>' +
        '</div>';
    }
    var type = field.type === 'number' ? 'number' : (field.type === 'date' ? 'date' : 'text');
    return '<input class="input" type="' + type + '" id="' + id + '" data-name="' + field.name + '" value="' + esc(value || '') + '">';
  }

  function renderFields(row) {
    var isNew = !row || !row.id;
    row = row || {};
    var html = '';
    var pairs = [];
    CONTENT.config.fields.forEach(function (field) {
      var value = row[field.name];
      // 新建时套用字段默认值（例如 is_published 默认 1、sort_order 默认 0）
      if (isNew && (value === undefined || value === null || value === '')) value = field.default;
      var control = '<div class="field"><label for="f-' + field.name + '">' + esc(field.label) +
        (field.required ? ' *' : '') + '</label>' + fieldControl(field, value) + '</div>';
      // 短字段两列，长字段整行
      if (field.type === 'textarea' || field.type === 'image') {
        html += pairs.length ? '<div class="row2">' + pairs.join('') + '</div>' : '';
        pairs = [];
        html += control;
      } else {
        pairs.push(control);
        if (pairs.length === 2) { html += '<div class="row2">' + pairs.join('') + '</div>'; pairs = []; }
      }
    });
    if (pairs.length) html += '<div class="row2">' + pairs.join('') + '</div>';
    document.getElementById('fields').innerHTML = html;
  }

  // 译文区的字段标签：把 title / seo_description 映射成可读英文
  var TR_LABEL = {
    title: 'Title', name: 'Name', question: 'Question', answer: 'Answer',
    excerpt: 'Excerpt', summary: 'Summary', content: 'Content',
    description: 'Description', seo_title: 'SEO Title', seo_description: 'SEO Description'
  };

  function renderTranslationSection(row) {
    var section = document.getElementById('tr-section');
    if (!CONTENT.config.hasTranslations || !CONTENT.trLangs.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    var tr = parseJsonLoose(row && row.translations, {});

    var tabs = CONTENT.trLangs.map(function (lang, i) {
      var meta = CONTENT.langMeta[lang] || {};
      return '<button type="button" class="tr-tab' + (i === 0 ? ' active' : '') + '" data-lang="' + lang + '" onclick="switchTab(\\'' + lang + '\\')">' + esc(meta.name || lang) + '</button>';
    }).join('');

    var panes = CONTENT.trLangs.map(function (lang, i) {
      var meta = CONTENT.langMeta[lang] || {};
      var dir = ['ar', 'he', 'fa', 'ur'].indexOf(lang) >= 0 ? ' dir="rtl"' : '';
      var inner = CONTENT.config.transFields.map(function (fname) {
        var isLong = fname === 'content' || fname === 'summary' || fname === 'seo_description' || fname === 'answer';
        var val = (tr[lang] && tr[lang][fname]) || '';
        var ctrl = isLong
          ? '<textarea class="textarea" data-tr-lang="' + lang + '" data-tr-field="' + fname + '">' + esc(val) + '</textarea>'
          : '<input class="input" type="text" data-tr-lang="' + lang + '" data-tr-field="' + fname + '" value="' + esc(val) + '">';
        return '<div class="field"><label>' + esc(TR_LABEL[fname] || fname.replace(/_/g, ' ')) + ' (' + esc(meta.name || lang) + ')</label>' + ctrl + '</div>';
      }).join('');
      return '<div class="tr-pane' + (i === 0 ? ' active' : '') + '" data-pane="' + lang + '"' + dir + '>' + inner + '</div>';
    }).join('');

    document.getElementById('tr-tabs').innerHTML = tabs;
    document.getElementById('tr-panes').innerHTML = panes;
  }

  window.switchTab = function (lang) {
    document.querySelectorAll('.tr-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
    document.querySelectorAll('.tr-pane').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-pane') === lang);
    });
  };

  function collectTranslations() {
    var out = {};
    CONTENT.trLangs.forEach(function (lang) {
      var obj = {};
      document.querySelectorAll('[data-tr-lang="' + lang + '"]').forEach(function (el) {
        var v = String(el.value || '').trim();
        if (v) obj[el.getAttribute('data-tr-field')] = v;
      });
      if (Object.keys(obj).length) out[lang] = obj;
    });
    return out;
  }

  /* ---- 一键生成译文（Workers AI）----
     与产品弹窗同一套约定：译文只回填输入框，不直接入库；
     一次请求只翻一个语种，串行 + 进度提示；默认只补空，不覆盖人工译文。 */
  // 自动检测只区分「中文 / 英文」，不猜简繁（繁体特征字容易混进同形字导致误判）。
  // 原文确实是繁体时，运营在下拉里手动选「繁體中文」。
  function detectSourceLang(text) {
    var str = String(text || '');
    // 注意：这段脚本在模板字符串里，Unicode 范围必须写双反斜杠，浏览器端才会收到转义序列
    var han = (str.match(/[\\u4e00-\\u9fff]/g) || []).length;
    var latin = (str.match(/[a-zA-Z]/g) || []).length;
    return (han === 0 || han < latin * 0.15) ? 'en' : 'zh';
  }

  window.autoTranslate = async function () {
    var btn = document.getElementById('tr-auto-btn');
    var prog = document.getElementById('tr-progress');
    if (!btn || !CONTENT.config.hasTranslations) return;

    var fields = {};
    CONTENT.config.transFields.forEach(function (fname) {
      var el = document.querySelector('[data-name="' + fname + '"]');
      var v = el ? String(el.value || '').trim() : '';
      if (v) fields[fname] = v;
    });
    if (!Object.keys(fields).length) { toast('请先填写主表单内容', 'err'); return; }

    var chosen = (document.getElementById('tr-source-lang') || {}).value || 'auto';
    var sourceLang = chosen === 'auto'
      ? detectSourceLang(Object.keys(fields).map(function (k) { return fields[k]; }).join(' '))
      : chosen;
    var mode = (document.getElementById('tr-mode') || {}).value || 'fill';

    btn.disabled = true;
    var failLangs = [];
    try {
      for (var i = 0; i < CONTENT.trLangs.length; i++) {
        var lang = CONTENT.trLangs[i];
        if (prog) prog.textContent = '(' + (i + 1) + '/' + CONTENT.trLangs.length + ') 正在生成 ' + lang + ' …';
        try {
          var existing = collectTranslations()[lang] || {};
          var r = await api('/translate', {
            method: 'POST',
            body: JSON.stringify({ sourceLang: sourceLang, target: lang, fields: fields, mode: mode, existing: existing })
          });
          if (!r.ok || !r.body || r.body.success !== true) {
            throw new Error((r.body && r.body.error) || ('HTTP ' + r.status));
          }
          var tr = (r.body.data && r.body.data.translations) || {};
          Object.keys(tr).forEach(function (f) {
            var el = document.querySelector('[data-tr-lang="' + lang + '"][data-tr-field="' + f + '"]');
            if (!el) return;
            if (mode === 'fill' && String(el.value || '').trim()) return;
            el.value = tr[f];
          });
        } catch (e) {
          failLangs.push(lang);
          console.error('translate ' + lang + ' failed', e);
        }
      }
      if (failLangs.length) {
        toast('部分语种生成失败：' + failLangs.join(', '), 'err');
        if (prog) prog.textContent = '失败：' + failLangs.join(', ') + ' · 检查 Workers AI 绑定/额度';
      } else {
        toast('译文已填入各语种，请核对后再保存', 'ok');
        if (prog) prog.textContent = '';
      }
    } finally {
      btn.disabled = false;
    }
  };

  window.openModal = function (id) {
    var row = id ? ROWS.filter(function (r) { return r.id === id; })[0] : null;
    document.getElementById('row-id').value = row ? row.id : '';
    document.getElementById('modal-title').textContent = row ? 'Edit ' + CONTENT.config.label : 'New ' + CONTENT.config.label;
    renderFields(row);
    renderTranslationSection(row);
    document.getElementById('modal').classList.add('active');
  };

  window.closeModal = function () {
    document.getElementById('modal').classList.remove('active');
  };

  window.removeRow = function (id) {
    if (!confirm('Delete this entry? (soft delete — it is hidden, not erased)')) return;
    api('/content/' + CONTENT.key + '/' + id, { method: 'DELETE' }).then(function (r) {
      if (r.ok) { toast('Deleted'); load(); } else { toast(r.body.error || 'Delete failed', 'err'); }
    });
  };

  window.uploadImage = function (event, fieldName) {
    var file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Max 5 MB', 'err'); return; }
    var fd = new FormData();
    fd.append('file', file);
    fetch('/api/upload/image', { method: 'POST', headers: { 'Authorization': 'Bearer ' + TOKEN }, body: fd })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success) {
          var input = document.querySelector('[data-name="' + fieldName + '"]');
          if (input) input.value = res.data.url;
          toast('Uploaded');
        } else { toast(res.error || 'Upload failed', 'err'); }
      })
      .catch(function () { toast('Upload failed', 'err'); });
  };

  document.getElementById('content-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = document.getElementById('row-id').value;
    var payload = {};

    CONTENT.config.fields.forEach(function (field) {
      var el = document.querySelector('[data-name="' + field.name + '"]');
      if (!el) return;
      var v;
      if (field.type === 'bool') v = el.checked ? 1 : 0;
      else if (field.type === 'number') v = el.value === '' ? null : Number(el.value);
      else v = el.value.trim() === '' ? null : el.value.trim();
      // 新建时留空就不要发送该字段，交给数据库默认值（如 published_at = CURRENT_TIMESTAMP）
      if (v === null && !id) return;
      payload[field.name] = v;
    });

    // 必填校验（前端先拦一次，后端还会校验）
    var missing = CONTENT.config.fields.filter(function (f) { return f.required; })
      .filter(function (f) { return !String(payload[f.name] || '').trim(); })
      .map(function (f) { return f.label; });
    if (missing.length) { toast('Required: ' + missing.join(', '), 'err'); return; }

    if (CONTENT.config.hasTranslations) payload.translations = collectTranslations();

    var btn = document.getElementById('save-btn');
    btn.disabled = true;
    var req = id
      ? api('/content/' + CONTENT.key + '/' + id, { method: 'PUT', body: JSON.stringify(payload) })
      : api('/content/' + CONTENT.key, { method: 'POST', body: JSON.stringify(payload) });

    req.then(function (r) {
      btn.disabled = false;
      if (r.ok) { toast('Saved'); closeModal(); load(); }
      else { toast(r.body.error || 'Save failed', 'err'); }
    }).catch(function () { btn.disabled = false; toast('Network error', 'err'); });
  });

  renderHead();
  load();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
  });
}
