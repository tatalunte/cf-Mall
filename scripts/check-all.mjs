/**
 * 一键体检：语法 / 模块引用 / 内联脚本 / 打包
 *
 *   node scripts/check-all.mjs                # 静态检查（快）
 *   node scripts/check-all.mjs --build        # 追加 wrangler dry-run 打包
 *   node scripts/check-all.mjs --url http://127.0.0.1:8787
 *                                            # 追加抓取运行中站点，校验页面内联 <script> 语法
 *
 * 内联脚本检查是为了防住一类真实 bug：Worker 把所有页面写成模板字符串，
 * 模板里的 JS 字符串字面量若写成 '\n'，会被服务端提前转义成真实换行，
 * 导致浏览器端整段 <script> 语法错误（后台所有按钮静默失效）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

let fail = 0;
const log = (ok, msg, extra = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${msg}${extra ? ' — ' + extra : ''}`);
};

const root = process.cwd();
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
};

console.log('\n== 1. 语法检查 ==');
const files = walk(path.join(root, 'src'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb2b-'));
for (const f of files) {
  const copy = path.join(tmp, path.relative(root, f).replace(/[\\/]/g, '_') + '.mjs');
  fs.copyFileSync(f, copy);
  try {
    execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
  } catch (e) {
    log(false, path.relative(root, f), String(e.stderr || e.message).split('\n').slice(0, 3).join(' '));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (files.length) log(true, `${files.length} 个源文件语法通过`);

console.log('\n== 2. 相对 import 校验 ==');
const missing = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const p = path.normalize(path.join(path.dirname(f), m[1]));
    if (!fs.existsSync(p) && !fs.existsSync(p + '.js')) missing.push(`${path.relative(root, f)} → ${m[1]}`);
  }
}
log(missing.length === 0, '所有相对 import 目标存在', missing.join('; '));

console.log('\n== 3. 页面模板内联 JS 的 \\n 字面量检查 ==');
// 为什么这里必须「判失败」而不是提示：
// src/pages/*.js 的整页都是模板字符串，里面写的 '\n' 在渲染时会被外层模板插值成真实换行，
// 浏览器拿到的就是「单引号里换行」→ Invalid or unexpected token，整段脚本全废。
// 这个坑在本项目已经踩了三次（join('\n')、alert('\n\n')、indexOf('\n')），所以升级为硬错误。
const risky = [];
const hardFail = [];
for (const f of files) {
  const rel = path.relative(root, f).replace(/\\/g, '/');
  const src = fs.readFileSync(f, 'utf8');
  // 只有「会往页面里注入内联 <script>」的文件才可能踩这个坑；
  // seo.js 拼的是 sitemap XML，join('\n') 完全正当。
  const isPageTemplate = rel.startsWith('src/pages/') && src.includes('<script');
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const hasLiteral = /'\\n'|"\\n"/.test(line);
    if (!hasLiteral) return;
    const entry = `${rel}:${i + 1}`;
    if (isPageTemplate) hardFail.push(entry);
    else risky.push(entry);
  });
}
if (risky.length) {
  console.log('  ⚠️  src/pages 之外发现 \\n 字面量（seo/html 的 XML 拼接属正常，仅提示）：');
  risky.forEach(r => console.log(`     - ${r}`));
}
log(hardFail.length === 0,
  hardFail.length ? 'src/pages 存在未转义的 \\n（应写成 \\\\n）' : 'src/pages 无未转义的 \\n 字面量',
  hardFail.join(', '));

const urlIdx = process.argv.indexOf('--url');
if (urlIdx > -1) {
  const base = process.argv[urlIdx + 1];
  console.log(`\n== 4. 内联脚本检查（${base}）==`);
  // 新增页面必须加进这里：本项目 80% 的运行时致命 bug 都是
  // 「页面模板里的内联脚本语法错」，只有渲染后逐块 node --check 才能发现。
  // /quote/:token 需要真实 token，无法静态列举，由 ui-test-phase3 覆盖。
  const pages = ['/', '/products', '/products/sample-industrial-pump', '/news', '/cases', '/faq',
    '/about', '/contact', '/quote', '/account', '/admin/login', '/admin/dashboard',
    '/admin/trade', '/admin/content/posts'];
  for (const p of pages) {
    let html = '';
    try {
      const res = await fetch(base + p, { headers: { 'User-Agent': 'check-all' } });
      html = await res.text();
    } catch (e) {
      log(false, `${p} 抓取失败`, e.message);
      continue;
    }
    // 只校验可执行脚本，跳过 JSON-LD（application/ld+json 是数据不是 JS）
    const scripts = [...html.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    let bad = null;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-'));
    scripts.forEach((code, i) => {
      if (!code.trim()) return;
      const f = path.join(dir, `s${i}.mjs`);
      fs.writeFileSync(f, code);
      try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
      catch (e) { bad = `脚本块 ${i}: ` + String(e.stderr || '').split('\n').find(l => l.includes('Error'))?.trim(); }
    });
    fs.rmSync(dir, { recursive: true, force: true });
    log(!bad, `${p}（${scripts.length} 个脚本块）`, bad || '');
  }
}

if (process.argv.includes('--build')) {
  console.log('\n== 5. Workers 打包（dry-run）==');
  try {
    // Windows 上 .cmd 不能直接 execFileSync（EINVAL），统一走 node + wrangler.js
    const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    const out = execFileSync(
      process.execPath,
      [wranglerBin, 'deploy', '--dry-run', '--outdir', 'dist-check'],
      { cwd: root, stdio: 'pipe', encoding: 'utf8' }
    );
    const size = out.split('\n').find(l => l.includes('Total Upload')) || '';
    log(true, '打包成功', size.trim());
  } catch (e) {
    log(false, '打包失败', String(e.stdout || e.stderr || e.message).slice(0, 300));
  } finally {
    fs.rmSync(path.join(root, 'dist-check'), { recursive: true, force: true });
  }
}

console.log(fail ? `\n❌ ${fail} 项未通过\n` : '\n✅ 全部检查通过\n');
process.exit(fail ? 1 : 0);
