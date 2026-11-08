#!/usr/bin/env node
/**
 * 一键上线（Cloudflare）
 *
 * 为什么要有这个脚本：手工上线要建 1 个 D1 + 1 个 R2 + 1 个 KV + 2 个 Queue，
 * 改 5 处 wrangler.toml 占位符，跑迁移，设 5 个 secret，再建管理员账号。
 * 任何一步顺序错或 ID 抄错，表现出来的都是「部署成功但一登录就 500」。
 *
 * 用法（PowerShell / bash 均可）：
 *   CF_API_TOKEN=xxx CF_ACCOUNT_ID=yyy SITE_URL=https://www.example.com \
 *   ADMIN_PASSWORD='StrongPass!2026' RESEND_API_KEY=re_xxx \
 *   node scripts/go-live.mjs
 *
 * 只跑构建不部署：加 DRY_RUN=1
 *
 * 需要的 Token 权限（Workers 的 API Token 模板 + 追加）：
 *   Workers Scripts:Edit、D1:Edit、R2:Edit、Workers KV Storage:Edit、Queues:Edit、Account Settings:Read
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const TOML = path.join(ROOT, 'wrangler.toml');

const env = process.env;
const DRY = env.DRY_RUN === '1';

const need = (name, hint) => {
  const v = env[name];
  if (!v || !String(v).trim()) {
    console.error(`\n❌ 缺少环境变量 ${name}${hint ? '\n   ' + hint : ''}\n`);
    process.exit(1);
  }
  return String(v).trim();
};

function run(args, { input, allowFail = false, quiet = false } = {}) {
  try {
    const out = execFileSync(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT,
      input,
      encoding: 'utf8',
      stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      env: { ...env, CLOUDFLARE_API_TOKEN: env.CF_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CF_ACCOUNT_ID },
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, out: out || '' };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    if (allowFail) return { ok: false, out };
    if (!quiet) console.error(out.slice(-1500));
    throw new Error(`wrangler ${args.join(' ')} 失败`);
  }
}

/** wrangler 的 --json 输出前面会混一行 "Proxy environment variables detected."，
 *  直接 JSON.parse 会炸，必须从第一个 [ 或 { 开始截。 */
function parseJson(out) {
  const i = out.search(/[[{]/);
  if (i < 0) return null;
  try { return JSON.parse(out.slice(i)); } catch { return null; }
}

const step = (n, total, msg) => console.log(`\n\x1b[1;36m▸ ${n}/${total} ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

/* ============================ 0. 前置校验 ============================ */

console.log('\n\x1b[1mcf-b2b-pro 一键上线\x1b[0m' + (DRY ? '  \x1b[33m(DRY RUN：不实际部署)\x1b[0m' : ''));

const CF_TOKEN = need('CF_API_TOKEN', 'Cloudflare API Token（Workers Scripts:Edit + D1:Edit + R2:Edit + KV:Edit + Queues:Edit）');
const CF_ACCOUNT = need('CF_ACCOUNT_ID', '在 Cloudflare 控制台右侧栏或 workers.dev 页面 URL 里');
const SITE_URL = need('SITE_URL', '例如 https://www.example.com（必须带 https，绑好自定义域名后再跑）').replace(/\/$/, '');
const ADMIN_PASSWORD = need('ADMIN_PASSWORD', '至少 12 位，含大小写与符号；这是后台超管口令');
const ADMIN_USERNAME = env.ADMIN_USERNAME || 'admin';
const ADMIN_EMAIL = env.ADMIN_EMAIL || `admin@${SITE_URL.replace(/^https?:\/\//, '').replace(/^www\./, '')}`;
const MAIL_FROM = env.MAIL_FROM || `B2B <notify@${SITE_URL.replace(/^https?:\/\//, '').replace(/^www\./, '')}>`;
const MAIL_TO = env.MAIL_TO || ADMIN_EMAIL;

if (ADMIN_PASSWORD.length < 12) {
  console.error('\n❌ ADMIN_PASSWORD 至少 12 位\n');
  process.exit(1);
}
if (!/^https:\/\//.test(SITE_URL)) warn('SITE_URL 不是 https，Turnstile 与安全 Cookie 会失效');

console.log(`  账号   ${CF_ACCOUNT}`);
console.log(`  站点   ${SITE_URL}`);
console.log(`  超管   ${ADMIN_USERNAME} <${ADMIN_EMAIL}>`);

/* ============================ 1. 身份验证 ============================ */

step(1, 8, '验证 API Token');
const who = run(['whoami'], { allowFail: true });
if (!who.ok) {
  console.error('  无法用该 Token 认证。检查 Token 是否有 Account Settings:Read 权限，以及 ACCOUNT_ID 是否正确。');
  console.error(who.out.slice(-500));
  process.exit(1);
}
ok('Token 有效');

/* ============================ 2. 资源准备 ============================ */

step(2, 8, '准备 D1 / R2 / KV / Queues');

const results = { d1: '', r2: '', kv: '', queues: [] };

// --- D1 ---
const d1List = parseJson(run(['d1', 'list', '--json'], { allowFail: true }).out) || [];
const existingD1 = (Array.isArray(d1List) ? d1List : d1List.result || [])
  .find(d => (d.name || '') === 'b2b_database');
if (env.D1_DATABASE_ID) {
  // 断点续跑：资源已建好时直接复用，不依赖 `d1 list --json` 的输出格式
  results.d1 = env.D1_DATABASE_ID.trim();
  ok(`D1 复用已提供的 ID：b2b_database (${results.d1.slice(0, 8)}…)`);
} else if (existingD1) {
  results.d1 = existingD1.uuid || existingD1.database_id || '';
  ok(`D1 已存在：b2b_database (${results.d1.slice(0, 8)}…)`);
} else if (DRY) {
  results.d1 = '00000000-0000-0000-0000-000000000000';
  warn('DRY RUN：跳过 D1 创建');
} else {
  const created = run(['d1', 'create', 'b2b_database'], { allowFail: true });
  const m = created.out.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
  if (!m) { console.error(created.out.slice(-800)); throw new Error('D1 创建失败，没解析到 database_id'); }
  results.d1 = m[1];
  ok(`D1 已创建：b2b_database (${results.d1.slice(0, 8)}…)`);
}

// --- R2 ---
const r2List = run(['r2', 'bucket', 'list'], { allowFail: true }).out;
if (/b2b-product-images/.test(r2List)) {
  ok('R2 桶已存在：b2b-product-images');
} else if (DRY) {
  warn('DRY RUN：跳过 R2 创建');
} else {
  const r = run(['r2', 'bucket', 'create', 'b2b-product-images'], { allowFail: true });
  if (!r.ok && !/already|exist/i.test(r.out)) { console.error(r.out.slice(-500)); throw new Error('R2 创建失败'); }
  ok('R2 桶已创建：b2b-product-images');
}
results.r2 = 'b2b-product-images';

// --- KV ---
const kvList = parseJson(run(['kv', 'namespace', 'list'], { allowFail: true }).out) || [];
const kvArr = Array.isArray(kvList) ? kvList : kvList.result || [];
const existingKv = kvArr.find(k => (k.title || '') === 'STATIC_ASSETS');
if (env.KV_NAMESPACE_ID) {
  results.kv = env.KV_NAMESPACE_ID.trim();
  ok(`KV 复用已提供的 ID：STATIC_ASSETS (${results.kv.slice(0, 8)}…)`);
} else if (existingKv) {
  results.kv = existingKv.id;
  ok(`KV 已存在：STATIC_ASSETS (${results.kv.slice(0, 8)}…)`);
} else if (DRY) {
  results.kv = '00000000000000000000000000000000';
  warn('DRY RUN：跳过 KV 创建');
} else {
  const created = run(['kv', 'namespace', 'create', 'STATIC_ASSETS'], { allowFail: true });
  const m = created.out.match(/([0-9a-f]{32})/);
  if (!m) { console.error(created.out.slice(-800)); throw new Error('KV 创建失败'); }
  results.kv = m[1];
  ok(`KV 已创建：STATIC_ASSETS (${results.kv.slice(0, 8)}…)`);
}

// --- Queues ---
const qList = run(['queues', 'list'], { allowFail: true }).out;
for (const name of ['b2b-inquiry-mail', 'b2b-inquiry-mail-dlq']) {
  if (qList.includes(name)) {
    ok(`队列已存在：${name}`);
  } else if (DRY) {
    warn(`DRY RUN：跳过队列 ${name}`);
  } else {
    const r = run(['queues', 'create', name], { allowFail: true });
    if (!r.ok && !/already|exist/i.test(r.out)) { console.error(r.out.slice(-400)); throw new Error(`队列 ${name} 创建失败`); }
    ok(`队列已创建：${name}`);
  }
  results.queues.push(name);
}

/* ============================ 3. 写入配置 ============================ */

step(3, 8, '写入 wrangler.toml');
// DRY RUN 绝不能改生产配置：预检时用的是全 0 假 ID，写进磁盘会被误当成真配置。
const tomlBackup = DRY ? null : `${TOML}.bak-${Date.now()}`;
if (tomlBackup) fs.copyFileSync(TOML, tomlBackup);

let toml = fs.readFileSync(TOML, 'utf8');
toml = toml
  .replace(/SITE_URL = "[^"]*"/, `SITE_URL = "${SITE_URL}"`)
  .replace(/database_id = "[^"]*"/, `database_id = "${results.d1}"`)
  .replace(/(\[\[kv_namespaces\]\][\s\S]*?)id = "[^"]*"/, `$1id = "${results.kv}"`);

// 没配 Turnstile 时也要把占位符清成空串：前台靠 REPLACE_ 前缀判断不渲染 widget，
// 但留着占位符会让 CI 的占位符扫描与排错文档持续告警。
toml = toml.replace(/TURNSTILE_SITEKEY = "[^"]*"/,
  `TURNSTILE_SITEKEY = "${String(env.TURNSTILE_SITEKEY || '').replace(/"/g, '\\"')}"`);
// 无论是否显式提供都要落盘：否则会留下 yourdomain.com 占位地址，日后配了 Resend 会静默发错
toml = toml.replace(/MAIL_FROM = "[^"]*"/, `MAIL_FROM = "${MAIL_FROM.replace(/"/g, '\\"')}"`);
toml = toml.replace(/MAIL_TO = "[^"]*"/, `MAIL_TO = "${MAIL_TO.replace(/"/g, '\\"')}"`);
// 图片两开关：默认留空 = 走 Worker 代理 + 单张原图，能跑但流量不经济
if (env.IMAGES_PUBLIC_BASE) {
  toml = toml.replace(/IMAGES_PUBLIC_BASE = "[^"]*"/, `IMAGES_PUBLIC_BASE = "${env.IMAGES_PUBLIC_BASE.replace(/\/$/, '')}"`);
}
if (env.IMAGE_RESIZE) toml = toml.replace(/IMAGE_RESIZE = "[^"]*"/, `IMAGE_RESIZE = "${env.IMAGE_RESIZE}"`);

if (DRY) warn('DRY RUN：跳过写入 wrangler.toml（磁盘上的配置保持原样）');
else fs.writeFileSync(TOML, toml);
const left = (toml.match(/REPLACE_[A-Z_]+/g) || []);
if (left.length) warn(`仍有占位符未替换：${[...new Set(left)].join(', ')}（TURNSTILE / 邮箱相关可留空，但 Turnstile 留占位符会让验证永远失败）`);
else ok('占位符已全部替换');
if (!env.IMAGES_PUBLIC_BASE) warn('未提供 IMAGES_PUBLIC_BASE：图片经 Worker 代理输出（能跑，但每张图占一次请求）。建议之后绑一个 R2 自定义域再填上');
if (String(toml.match(/IMAGE_RESIZE = "([^"]*)"/)?.[1] || '') === '1') warn('IMAGE_RESIZE=1：请确认 Cloudflare 后台已开通 Image Transformations，否则 /cdn-cgi/image 会返 404');
if (tomlBackup) ok(`原配置备份在 ${path.basename(tomlBackup)}`);

/* ============================ 4. 建表 ============================ */

step(4, 8, '在远端 D1 执行 schema/bootstrap.sql（20 张表，幂等）');
if (DRY) {
  warn('DRY RUN：跳过远端建表');
} else {
  const r = run(['d1', 'execute', 'b2b_database', '--remote', '--file=schema/bootstrap.sql'], { allowFail: true });
  if (!r.ok) {
    console.error(r.out.slice(-1200));
    throw new Error('建表失败。常见原因：Token 缺 D1:Edit，或 database_id 写错');
  }
  ok('建表完成');
}

/* ============================ 5. 密钥 ============================ */

step(5, 8, '写入运行时密钥');

const jwtSecret = crypto.randomBytes(32).toString('hex');
const secrets = {
  JWT_SECRET: jwtSecret,
  ...(env.RESEND_API_KEY ? { RESEND_API_KEY: env.RESEND_API_KEY } : {}),
  ...(env.TURNSTILE_SECRET_KEY ? { TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY } : {}),
  ...(env.STRIPE_SECRET_KEY ? { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY } : {}),
  ...(env.STRIPE_WEBHOOK_SECRET ? { STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET } : {}),
};

if (DRY) {
  warn(`DRY RUN：将写入 ${Object.keys(secrets).join(', ')}`);
} else {
  for (const [k, v] of Object.entries(secrets)) {
    const r = run(['secret', 'put', k], { input: v, allowFail: true });
    if (!r.ok) { console.error(r.out.slice(-500)); throw new Error(`secret ${k} 写入失败`); }
    ok(`已写入 ${k}`);
  }
  if (!env.RESEND_API_KEY) warn('未提供 RESEND_API_KEY：询盘通知邮件不会发出（表单仍可用）');
  if (!env.TURNSTILE_SECRET_KEY) warn('未提供 TURNSTILE_SECRET_KEY：人机验证不会生效');
}

/* ============================ 6. 建管理员 ============================ */

step(6, 8, '创建超管账号');

// 与 src/utils/auth.js 的 hashPassword 保持同一格式：pbkdf2$迭代数$盐$哈希
const ITER = 150000;
const salt = crypto.randomBytes(16);
const bits = crypto.pbkdf2Sync(ADMIN_PASSWORD, salt, ITER, 32, 'sha256');
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hash = `pbkdf2$${ITER}$${b64url(salt)}$${b64url(bits)}`;

const esc = (s) => String(s).replace(/'/g, "''");
const sql = `INSERT INTO admins (username, password_hash, email, role) VALUES ('${esc(ADMIN_USERNAME)}', '${hash}', '${esc(ADMIN_EMAIL)}', 'super_admin') ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, email = excluded.email, role = 'super_admin', updated_at = CURRENT_TIMESTAMP;`;

if (DRY) {
  warn('DRY RUN：跳过管理员写入');
} else {
  const r = run(['d1', 'execute', 'b2b_database', '--remote', '--command', sql], { allowFail: true });
  if (!r.ok) { console.error(r.out.slice(-800)); throw new Error('管理员写入失败'); }
  ok(`超管已就绪：${ADMIN_USERNAME}（口令不在日志里回显）`);
}

/* ============================ 7. 部署 ============================ */

step(7, 8, 'wrangler deploy');
if (DRY) {
  const r = run(['deploy', '--dry-run', '--outdir=dist-check'], { allowFail: true });
  console.log(r.out.slice(-600));
  warn('DRY RUN：只做打包，没有真正部署');
} else {
  const r = run(['deploy'], { allowFail: true });
  if (!r.ok) {
    console.error(r.out.slice(-1500));
    throw new Error('部署失败');
  }
  const m = r.out.match(/https:\/\/[^\s]+\.workers\.dev/);
  ok('部署完成' + (m ? `：${m[0]}` : ''));
}

/* ============================ 8. 冒烟 ============================ */

step(8, 8, '线上冒烟测试');
if (DRY) {
  warn('DRY RUN：跳过冒烟');
} else {
  const r = run(['deployments', 'status'], { allowFail: true });
  console.log(r.out.slice(-300));
  console.log(`\n  现在跑完整冒烟：\n    ADMIN_USERNAME=${ADMIN_USERNAME} ADMIN_PASSWORD='<你的口令>' bash scripts/smoke-test.sh ${SITE_URL}\n`);
}

/* ============================ 收尾 ============================ */

// JWT_SECRET 必须落到本地，否则以后想复现问题或重置会丢（预检不落盘）
let secretFile = null;
if (!DRY) {
  const backupDir = path.join(ROOT, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  secretFile = path.join(backupDir, `deploy-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
  fs.writeFileSync(secretFile, JSON.stringify({
    deployedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    accountId: CF_ACCOUNT,
    d1DatabaseId: results.d1,
    kvNamespaceId: results.kv,
    r2Bucket: results.r2,
    queues: results.queues,
    adminUsername: ADMIN_USERNAME,
    adminEmail: ADMIN_EMAIL,
    jwtSecret,
    note: 'JWT_SECRET 丢失后所有后台与客户会话失效，重新 wrangler secret put JWT_SECRET 即可；本文件已在 .gitignore 内。',
  }, null, 2));
}

console.log(`\n\x1b[1;32m上线流程结束\x1b[0m`);
if (secretFile) console.log(`  资源清单与 JWT_SECRET：${path.relative(ROOT, secretFile)}（已 gitignore，请自行备份）`);
if (left.length) console.log(`  \x1b[33m待你补齐\x1b[0m：${[...new Set(left)].join(', ')}`);
