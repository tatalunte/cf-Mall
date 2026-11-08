/**
 * 全站审计 runner —— 一条命令回答三个问题：
 *   1) 有没有死链？
 *   2) 每个按钮点下去有没有反应？
 *   3) 每个表单提交后有没有下文？
 *
 * 用法：node scripts/ui-audit.mjs
 * 产出：test-artifacts/audit-report.html（给人看）+ audit-report.json（给 CI 看）
 * 退出码：0 全绿 / 1 有问题
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { crawlSite, checkSitemap } from './audit/crawler.mjs';
import { runActions } from './audit/actions.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = 'test-artifacts';
const CREDS = { user: process.env.DEMO_USER || 'demo', pass: process.env.DEMO_PASS || 'Demo2026!b2b' };

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

if (!EDGE) { console.error('未找到 Edge/Chrome 可执行文件'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'audit'), { recursive: true });

const t0 = Date.now();
console.log('全站审计开始 — ' + BASE);

// 先确认服务活着，否则后面全是 ECONNREFUSED，报错信息会误导人
const alive = await fetch(BASE + '/').then(r => r.ok).catch(() => false);
if (!alive) {
  console.error(`\n服务未启动：${BASE}\n先跑 npm run dev，再到另一个终端跑这个脚本。`);
  process.exit(2);
}

// 后台爬取需要登录态
const loginRes = await fetch(BASE + '/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: CREDS.user, password: CREDS.pass }),
});
const loginJson = await loginRes.json().catch(() => ({}));
const adminToken = loginJson?.data?.token;
if (!adminToken) {
  console.error(`管理员登录失败：${JSON.stringify(loginJson).slice(0, 200)}`);
  console.error('先跑 node scripts/seed-demo.mjs --prepare 建演示管理员');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

console.log('\n[1/4] 爬公开站（从 / 出发，跟随每一条内链）');
const pub = await crawlSite(browser, { base: BASE, maxPages: 120, startPaths: ['/'], label: 'public' });
console.log(`  访问 ${pub.visited} 页：异常 ${pub.summary.bad} · 有缺陷 ${pub.summary.withIssues} · 控制台错误 ${pub.summary.consoleErrors} · 坏图 ${pub.summary.brokenImages}`);

console.log('\n[2/4] 爬后台（带登录态）');
const admin = await crawlSite(browser, {
  base: BASE,
  maxPages: 12,
  startPaths: ['/admin/dashboard', '/admin/trade', '/admin/content/posts'],
  label: 'admin',
  skipSeo: true,
  storage: { content: `try{localStorage.setItem('admin_token', ${JSON.stringify(adminToken)});localStorage.setItem('admin_role','super_admin');}catch(e){}` },
});
console.log(`  访问 ${admin.visited} 页：异常 ${admin.summary.bad} · 控制台错误 ${admin.summary.consoleErrors}`);

console.log('\n[3/4] 校验 sitemap.xml 里每一条 URL');
const sitemap = await checkSitemap(browser, BASE);
console.log(`  ${sitemap.count} 条 URL，坏链 ${sitemap.broken.length} 个`);

console.log('\n[4/4] 交互审计（表单 / 按钮 / 后台 CRUD）');
const actions = await runActions(browser, BASE, CREDS);

await browser.close();

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */
const allPages = [...pub.pages, ...admin.pages];
const deadLinks = allPages.filter(p => !p.ok);
const seoIssues = pub.pages.filter(p => p.issues.some(i => /title|description|canonical|h1/.test(i)));
const consoleIssues = allPages.filter(p => p.consoleErrors.length);
const imageIssues = allPages.filter(p => p.images.broken.length);
const actionFails = actions.filter(a => !a.ok);
const actionPass = actions.filter(a => a.ok);

const totalProblems =
  deadLinks.length + sitemap.broken.length + consoleIssues.length + imageIssues.length + actionFails.length;

const report = {
  base: BASE,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - t0,
  summary: {
    pagesVisited: pub.visited + admin.visited,
    deadLinks: deadLinks.length,
    sitemapUrls: sitemap.count,
    sitemapBroken: sitemap.broken.length,
    seoIssues: seoIssues.length,
    consoleErrors: pub.summary.consoleErrors + admin.summary.consoleErrors,
    brokenImages: imageIssues.reduce((n, p) => n + p.images.broken.length, 0),
    actionsPassed: actionPass.length,
    actionsFailed: actionFails.length,
    totalProblems,
  },
  publicPages: pub.pages,
  adminPages: admin.pages,
  sitemap,
  actions,
};

fs.writeFileSync(path.join(OUT, 'audit-report.json'), JSON.stringify(report, null, 2));

/* ---------------- HTML 报告 ---------------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = (n) => n === 0 ? '<span class="pill ok">0</span>' : `<span class="pill bad">${n}</span>`;

const pageRows = pub.pages.map(p => `
  <tr class="${p.issues.length ? 'row-bad' : ''}">
    <td><code>${esc(p.path)}</code></td>
    <td class="num">${p.status || '—'}</td>
    <td class="num">${p.links}</td>
    <td class="num">${p.images.total}</td>
    <td>${p.issues.length ? p.issues.map(i => `<span class="tag">${esc(i)}</span>`).join('') : '<span class="muted">通过</span>'}</td>
  </tr>`).join('');

const actionRows = actions.map(a => `
  <tr class="${a.ok ? '' : 'row-bad'}">
    <td>${a.ok ? '✅' : '❌'}</td>
    <td>${esc(a.name)}</td>
    <td><span class="muted">${esc(a.detail)}</span></td>
    <td class="num">${a.ms}ms</td>
  </tr>`).join('');

const deadRows = deadLinks.length ? deadLinks.map(p => `
  <tr class="row-bad"><td><code>${esc(p.path)}</code></td><td class="num">${p.status || 'ERR'}</td><td>${esc(p.navError || '')}</td></tr>`).join('')
  : '<tr><td colspan="3" class="muted">没有死链</td></tr>';

const sitemapRows = sitemap.broken.length ? sitemap.broken.map(b => `
  <tr class="row-bad"><td><code>${esc(b.url.replace(BASE, ''))}</code></td><td class="num">${b.status}</td></tr>`).join('')
  : '<tr><td colspan="2" class="muted">sitemap 全部可访问</td></tr>';

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>全站审计报告 · ${new Date().toLocaleString('zh-CN')}</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--text:#111827;--muted:#6b7280;--border:#e5e7eb;--ok:#059669;--bad:#dc2626;--warn:#d97706}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Microsoft YaHei",sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:32px 20px 64px}
  h1{font-size:24px;margin:0 0 6px}
  h2{font-size:17px;margin:32px 0 12px}
  .sub{color:var(--muted);font-size:13px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:20px 0 8px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
  .card .k{font-size:12px;color:var(--muted);letter-spacing:.02em}
  .card .v{font-size:26px;font-weight:650;margin-top:2px;font-variant-numeric:tabular-nums}
  .card.badish .v{color:var(--bad)}
  .card.goodish .v{color:var(--ok)}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:13px}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--border);vertical-align:top}
  th{background:#fafafa;font-weight:600;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  tr:last-child td{border-bottom:none}
  tr.row-bad td{background:#fff8f8}
  .num{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
  code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12px}
  .tag{display:inline-block;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:999px;padding:0 8px;font-size:11px;margin:0 4px 3px 0}
  .pill{display:inline-block;min-width:28px;text-align:center;border-radius:999px;padding:0 8px;font-size:12px;font-weight:600}
  .pill.ok{background:#ecfdf5;color:var(--ok)}
  .pill.bad{background:#fef2f2;color:var(--bad)}
  .muted{color:var(--muted)}
  .verdict{border-radius:10px;padding:16px 18px;margin:18px 0 6px;font-size:15px;font-weight:600}
  .verdict.pass{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
  .verdict.fail{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
  .foot{margin-top:36px;color:var(--muted);font-size:12px}
</style></head><body><div class="wrap">
  <h1>全站审计报告</h1>
  <div class="sub">${esc(BASE)} · ${new Date().toLocaleString('zh-CN')} · 用时 ${(report.durationMs / 1000).toFixed(1)}s</div>

  <div class="verdict ${totalProblems === 0 ? 'pass' : 'fail'}">
    ${totalProblems === 0
      ? '全部通过：没有死链，没有控制台报错，交互场景全部可用。'
      : `发现 ${totalProblems} 个问题：死链 ${deadLinks.length} · sitemap 坏链 ${sitemap.broken.length} · 控制台错误页 ${consoleIssues.length} · 坏图页 ${imageIssues.length} · 交互失败 ${actionFails.length}`}
  </div>

  <div class="cards">
    <div class="card"><div class="k">抓取页面</div><div class="v">${report.summary.pagesVisited}</div></div>
    <div class="card ${deadLinks.length ? 'badish' : 'goodish'}"><div class="k">死链</div><div class="v">${deadLinks.length}</div></div>
    <div class="card ${sitemap.broken.length ? 'badish' : 'goodish'}"><div class="k">sitemap 坏链</div><div class="v">${sitemap.broken.length}</div></div>
    <div class="card ${consoleIssues.length ? 'badish' : 'goodish'}"><div class="k">控制台错误页</div><div class="v">${consoleIssues.length}</div></div>
    <div class="card ${imageIssues.length ? 'badish' : 'goodish'}"><div class="k">坏图页</div><div class="v">${imageIssues.length}</div></div>
    <div class="card ${actionFails.length ? 'badish' : 'goodish'}"><div class="k">交互失败</div><div class="v">${actionFails.length}/${actions.length}</div></div>
  </div>

  <h2>交互场景（模拟真人操作）</h2>
  <table><thead><tr><th style="width:44px">结果</th><th style="width:38%">场景</th><th>详情</th><th style="width:80px">耗时</th></tr></thead><tbody>${actionRows}</tbody></table>

  <h2>死链</h2>
  <table><thead><tr><th>路径</th><th style="width:90px">状态</th><th>错误</th></tr></thead><tbody>${deadRows}</tbody></table>

  <h2>sitemap.xml 校验</h2>
  <table><thead><tr><th>URL</th><th style="width:90px">状态</th></tr></thead><tbody>${sitemapRows}</tbody></table>

  <h2>页面健康度（公开站 ${pub.visited} 页）</h2>
  <table><thead><tr><th style="width:34%">路径</th><th style="width:70px">状态</th><th style="width:60px">内链</th><th style="width:60px">图片</th><th>问题</th></tr></thead><tbody>${pageRows}</tbody></table>

  <div class="foot">报告由 <code>node scripts/ui-audit.mjs</code> 生成 · 截图在 test-artifacts/audit/ · 机器可读结果在 test-artifacts/audit-report.json</div>
</div></body></html>`;

fs.writeFileSync(path.join(OUT, 'audit-report.html'), html);

console.log('\n' + '='.repeat(60));
console.log(`抓取 ${report.summary.pagesVisited} 页 · 死链 ${deadLinks.length} · sitemap 坏链 ${sitemap.broken.length}`);
console.log(`控制台错误页 ${consoleIssues.length} · 坏图页 ${imageIssues.length}`);
console.log(`交互场景 ${actionPass.length}/${actions.length} 通过`);
if (actionFails.length) {
  console.log('\n失败场景：');
  actionFails.forEach(a => console.log(`  ✗ ${a.name} — ${a.detail}`));
}
if (deadLinks.length) {
  console.log('\n死链：');
  deadLinks.slice(0, 20).forEach(p => console.log(`  ✗ ${p.path} (${p.status || 'ERR'})`));
}
console.log(`\n报告：${path.join(OUT, 'audit-report.html')}`);
console.log('='.repeat(60));
process.exit(totalProblems === 0 ? 0 : 1);
