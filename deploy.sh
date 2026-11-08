#!/usr/bin/env bash
# cf-b2b-pro 一键部署脚本（Cloudflare Workers + D1 + R2 + KV + Queues）
#
# 用法：
#   1) 复制 .deploy.env.example 为 .deploy.env，填入真实值
#   2) bash deploy.sh
#
# 幂等性：D1/R2/KV/Queues 已存在时会复用或跳过；bootstrap.sql 全部是 IF NOT EXISTS / INSERT OR IGNORE，
#         重复执行不会清数据。但 wrangler.toml 中的绑定 ID 会被覆盖为本次查到的值，请先提交 git。
#
# 说明：脚本本身未在真实 CF 账号上跑过（沙箱内无法登录你的账号），首次执行请留意每步输出；
#       若某步失败，可按《CF_B2B_PRO_完整部署方案.md》第 3 节手工执行对应命令。

set -euo pipefail
cd "$(dirname "$0")"

# ---------- 0. 读取配置 ----------
if [ -f .deploy.env ]; then set -a; . ./.deploy.env; set +a; fi

req() { if [ -z "${!1:-}" ]; then echo "❌ 缺少环境变量 $1（$2）"; exit 1; fi; }
req CF_API_TOKEN "Cloudflare API Token，需 Workers/D1/R2/KV/Queues 编辑权限"
req CF_ACCOUNT_ID "Cloudflare Account ID"
req SITE_URL "站点根地址，如 https://b2b.example.com（不带尾斜杠）"
req JWT_SECRET "随机 32+ 字节字符串，可用 openssl rand -hex 32 生成"
req MAIL_TO "接收询盘通知的销售邮箱"
req MAIL_FROM "Resend 已验证域名的发件地址，如 B2B Inquiry <notify@example.com>"
req RESEND_API_KEY "Resend API Key（re_ 开头）"

WORKER_NAME="${WORKER_NAME:-cf-b2b-pro}"
D1_NAME="${D1_NAME:-b2b_database}"
R2_NAME="${R2_NAME:-b2b-product-images}"
KV_NAME="${KV_NAME:-STATIC_ASSETS}"
QUEUE_NAME="${QUEUE_NAME:-b2b-inquiry-mail}"
DLQ_NAME="${DLQ_NAME:-b2b-inquiry-mail-dlq}"
TURNSTILE_SITEKEY="${TURNSTILE_SITEKEY:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"
WR="npx --yes wrangler@4"

echo "▶ Worker=$WORKER_NAME  D1=$D1_NAME  R2=$R2_NAME  Queue=$QUEUE_NAME"

# ---------- 工具：改 wrangler.toml 的 key = "value" ----------
patch_toml() { # $1=key  $2=value
  node - "$1" "$2" <<'NODE'
const fs = require('fs');
const [key, val] = process.argv.slice(2);
const file = 'wrangler.toml';
let src = fs.readFileSync(file, 'utf8');
const re = new RegExp('^(\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*).*$', 'm');
if (!re.test(src)) { console.error('未找到配置项 ' + key); process.exit(1); }
src = src.replace(re, (m, p1) => p1 + JSON.stringify(val));
fs.writeFileSync(file, src);
console.log('  · ' + key + ' = ' + val);
NODE
}

# ---------- 1. D1 ----------
echo "▶ [1/8] D1 数据库"
D1_ID="$($WR d1 list --json 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const a=JSON.parse(s);const f=a.find(x=>x.name==='$D1_NAME');console.log(f?f.uuid:'')}catch(e){console.log('')}
});" 2>/dev/null || true)"
if [ -z "$D1_ID" ]; then
  OUT="$($WR d1 create "$D1_NAME" 2>&1 || true)"
  echo "$OUT" | tail -3
  D1_ID="$(echo "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
else
  echo "  已存在，复用 $D1_ID"
fi
[ -n "$D1_ID" ] || { echo "❌ 没能拿到 D1 database_id，请手动 npx wrangler d1 create $D1_NAME 后填入 wrangler.toml"; exit 1; }
patch_toml database_id "$D1_ID"

# ---------- 2. R2 ----------
echo "▶ [2/8] R2 存储桶"
$WR r2 bucket create "$R2_NAME" 2>&1 | grep -vi "already exists" | tail -2 || true

# ---------- 3. KV ----------
echo "▶ [3/8] KV 命名空间"
KV_ID="$($WR kv namespace list --json 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const a=JSON.parse(s);const f=a.find(x=>x.title==='$KV_NAME');console.log(f?f.id:'')}catch(e){console.log('')}
});" || true)"
if [ -z "$KV_ID" ]; then
  OUT="$($WR kv namespace create "$KV_NAME" 2>&1 || true)"
  echo "$OUT" | tail -3
  KV_ID="$(echo "$OUT" | grep -oE '[0-9a-f]{32}' | head -1)"
else
  echo "  已存在，复用 $KV_ID"
fi
[ -n "$KV_ID" ] || { echo "❌ 没能拿到 KV id，请手动创建后填入 wrangler.toml"; exit 1; }
patch_toml id "$KV_ID"

# ---------- 4. Queues ----------
echo "▶ [4/8] 队列（主 + 死信）"
$WR queues create "$QUEUE_NAME" 2>&1 | grep -vi "already exists" | tail -2 || true
$WR queues create "$DLQ_NAME" 2>&1 | grep -vi "already exists" | tail -2 || true

# ---------- 5. vars ----------
echo "▶ [5/8] 写入 vars"
patch_toml SITE_URL "${SITE_URL%/}"
patch_toml MAIL_TO "$MAIL_TO"
patch_toml MAIL_FROM "$MAIL_FROM"
[ -n "$TURNSTILE_SITEKEY" ] && patch_toml TURNSTILE_SITEKEY "$TURNSTILE_SITEKEY"
grep -q "REPLACE_WITH" wrangler.toml && echo "⚠️ wrangler.toml 里仍有 REPLACE_WITH_*，请检查（TURNSTILE_SITEKEY 可留占位，仅影响前端是否渲染验证码）"

# ---------- 6. 首次部署（先让 Worker 存在，secret put 才有目标）----------
echo "▶ [6/9] 首次部署"
$WR deploy --name "$WORKER_NAME"

# ---------- 7. secrets ----------
echo "▶ [7/9] 写入 secrets（不回显）"
printf '%s' "$JWT_SECRET" | $WR secret put JWT_SECRET --name "$WORKER_NAME" >/dev/null
printf '%s' "$RESEND_API_KEY" | $WR secret put RESEND_API_KEY --name "$WORKER_NAME" >/dev/null
if [ -n "${TURNSTILE_SECRET_KEY:-}" ]; then
  printf '%s' "$TURNSTILE_SECRET_KEY" | $WR secret put TURNSTILE_SECRET_KEY --name "$WORKER_NAME" >/dev/null
else
  echo "  ⚠️ 未提供 TURNSTILE_SECRET_KEY：后端会跳过验证码校验，上线前务必补"
fi

# ---------- 8. 建库 + 建管理员 ----------
echo "▶ [8/9] 初始化 D1 结构与管理员"
$WR d1 execute "$D1_NAME" --remote --file=./schema/bootstrap.sql >/dev/null
echo "  · bootstrap.sql 已应用（幂等）"

if [ -n "$ADMIN_USERNAME" ] && [ -n "$ADMIN_PASSWORD" ]; then
  command -v node >/dev/null || { echo "❌ 需要 node 生成 PBKDF2 哈希"; exit 1; }
  HASH="$(node -e "
const enc=new TextEncoder();
const b64u=(i)=>{const b=i instanceof Uint8Array?i:new Uint8Array(i);let s='';for(const x of b)s+=String.fromCharCode(x);return Buffer.from(s,'binary').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+\$/,'')};
(async()=>{const salt=crypto.getRandomValues(new Uint8Array(16));
const k=await crypto.subtle.importKey('raw',enc.encode(process.argv[1]),'PBKDF2',false,['deriveBits']);
const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},k,256);
console.log('pbkdf2\$150000\$'+b64u(salt)+'\$'+b64u(bits));})();
" "$ADMIN_PASSWORD")"
  $WR d1 execute "$D1_NAME" --remote --command \
    "INSERT INTO admins (username,password_hash,email,role) VALUES ('$ADMIN_USERNAME','$HASH','${ADMIN_EMAIL:-$ADMIN_USERNAME@localhost}','super_admin') ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role='super_admin';" >/dev/null
  echo "  · 超级管理员 $ADMIN_USERNAME 已创建/重置"
else
  echo "  ⚠️ 未提供 ADMIN_USERNAME / ADMIN_PASSWORD，登录前先执行："
  echo "     node scripts/reset-admin.mjs '你的强密码'"
fi

# ---------- 9. 最终部署 + 冒烟 ----------
echo "▶ [9/9] 应用最终配置"
$WR deploy --name "$WORKER_NAME"
echo
echo "✅ 部署完成。下一步："
echo "   1) 绑定自定义域名：Cloudflare Dashboard → Workers → $WORKER_NAME → Settings → Domains & Routes"
echo "   2) 跑冒烟测试：bash scripts/smoke-test.sh ${SITE_URL%/}"
echo "   3) 用 /admin/login 登录，改站点设置，提一条测试询盘确认邮件进收件箱"
