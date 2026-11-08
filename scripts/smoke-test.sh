#!/usr/bin/env bash
# 线上冒烟测试：部署后跑一遍，覆盖「安全 / SEO / 多语言 / 询盘链路」
#
# 用法：
#   bash scripts/smoke-test.sh https://b2b.example.com
#   # 想连登录与询盘一起测：
#   ADMIN_USERNAME=you ADMIN_PASSWORD='***' SUBMIT_TEST=1 bash scripts/smoke-test.sh https://b2b.example.com
#
# 退出码 0 表示全部通过；有 FAIL 则非 0，方便接 CI。

set -uo pipefail
SITE="${1:-}"
[ -n "$SITE" ] || { echo "用法: bash scripts/smoke-test.sh https://your-domain"; exit 2; }
SITE="${SITE%/}"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1${2:+ — $2}"; FAIL=$((FAIL+1)); }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1"; }
code_post() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$1"; }
body() { curl -s --max-time 15 "$1"; }
has()  { if body "$2" | grep -qi -- "$3"; then ok "$1"; else bad "$1" "未匹配 $3"; fi; }

echo "▶ 目标站点：$SITE"
echo
echo "【1】页面可访问性"
[ "$(code "$SITE/")" = 200 ] && ok "首页 200" || bad "首页非 200"
[ "$(code "$SITE/products")" = 200 ] && ok "产品列表 200" || bad "产品列表非 200"
[ "$(code "$SITE/about")" = 200 ] && ok "关于页 200" || bad "关于页非 200"
[ "$(code "$SITE/contact")" = 200 ] && ok "联系页 200" || bad "联系页非 200"
[ "$(code "$SITE/privacy")" = 200 ] && ok "隐私政策 200（GDPR 需要）" || bad "隐私政策非 200"
[ "$(code "$SITE/admin/login")" = 200 ] && ok "后台登录页 200" || bad "后台登录页非 200"
[ "$(code "$SITE/definitely-not-exist")" = 404 ] && ok "未知路径 404" || bad "未知路径未返回 404"

echo
echo "【2】SEO / 多语言"
has "首页有 canonical" "$SITE/" 'rel="canonical"'
has "首页有 hreflang x-default" "$SITE/" 'hreflang="x-default"'
has "首页有 Organization JSON-LD" "$SITE/" '"@type"\s*:\s*"Organization"'
has "首页服务端直出产品名（非空壳）" "$SITE/" '<article'
has "robots.txt 含 Sitemap 行" "$SITE/robots.txt" 'Sitemap:'
has "sitemap.xml 含 urlset" "$SITE/sitemap.xml" '<urlset'
has "sitemap.xml 含 hreflang alternates" "$SITE/sitemap.xml" 'xhtml:link'
has "西语版可访问" "$SITE/es/products" 'lang="es"'
has "阿语版带 RTL" "$SITE/ar/" 'dir="rtl"'
if [ "$(code "$SITE/robots.txt")" = 200 ] && [ -z "$(body "$SITE/robots.txt")" ]; then
  bad "robots.txt 返回空 body" "检查 index.js 是否 await robotsTxt()"
fi

echo
echo "【3】安全响应头"
HDR="$(curl -sI --max-time 15 "$SITE/" || true)"
for h in 'X-Content-Type-Options: nosniff' 'X-Frame-Options: SAMEORIGIN' 'Referrer-Policy:'; do
  echo "$HDR" | grep -qi "${h%%:*}" && ok "含 $h" || bad "缺少 $h"
done

echo
echo "【4】未授权访问（原版这些接口全部返回 200 + 客户数据）"
[ "$(code "$SITE/api/inquiries")" = 401 ] && ok "GET /api/inquiries 401" || bad "GET /api/inquiries 未拒绝"
[ "$(code "$SITE/api/inquiries/export.csv")" = 401 ] && ok "CSV 导出 401" || bad "CSV 导出未拒绝"
[ "$(code "$SITE/api/admin/stats")" = 401 ] && ok "后台统计 401" || bad "后台统计未拒绝"
[ "$(code_post "$SITE/api/products")" = 401 ] && ok "匿名建产品 401" || bad "匿名建产品未拒绝"
[ "$(code_post "$SITE/api/upload/image")" = 401 ] && ok "匿名上传 401" || bad "匿名上传未拒绝"

FORGED="$(node -e "
const b=s=>Buffer.from(JSON.stringify(s)).toString('base64url');
console.log(b({alg:'HS256',typ:'JWT'})+'.'+b({id:1,role:'super_admin',exp:9999999999})+'.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
" 2>/dev/null || true)"
if [ -n "$FORGED" ]; then
  C="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "Authorization: Bearer $FORGED" "$SITE/api/inquiries")"
  [ "$C" = 401 ] && ok "伪造 JWT 被拒" || bad "伪造 JWT 未被拒" "HTTP $C"
fi

echo
echo "【5】登录与询盘（可选）"
if [ -n "${ADMIN_USERNAME:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  LOGIN="$(curl -s --max-time 15 -X POST -H 'Content-Type: application/json' \
    -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" "$SITE/api/admin/login")"
  TOKEN="$(echo "$LOGIN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).data.token||'')}catch(e){console.log('')}})" 2>/dev/null)"
  if [ -n "$TOKEN" ]; then
    ok "管理员登录成功"
    [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$SITE/api/inquiries")" = 200 ] \
      && ok "带 token 读询盘 200" || bad "带 token 读询盘失败"
    [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$SITE/api/inquiries/export.csv")" = 200 ] \
      && ok "CSV 导出 200" || bad "CSV 导出失败"
  else
    bad "管理员登录失败" "检查账号密码 / 是否已执行 bootstrap.sql / JWT_SECRET 是否写入"
  fi

  if [ "${SUBMIT_TEST:-0}" = 1 ]; then
    EMAIL="smoke-$(date +%s)@example.com"
    R="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST -H 'Content-Type: application/json' \
      -d "{\"name\":\"Smoke Test\",\"email\":\"$EMAIL\",\"message\":\"smoke test from smoke-test.sh\",\"consent\":true}" "$SITE/api/inquiries")"
    if [ "$R" = 201 ] || [ "$R" = 200 ]; then
      ok "询盘提交成功（$R）"
      sleep 5
      SEEN="$(curl -s -H "Authorization: Bearer $TOKEN" "$SITE/api/inquiries?q=$EMAIL")"
      echo "$SEEN" | grep -q "$EMAIL" && ok "询盘已落库" || bad "询盘未落库"
      MS="$(echo "$SEEN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const d=JSON.parse(s).data[0]||{};console.log(d.mail_status||'')}catch(e){console.log('')}})" 2>/dev/null)"
      case "$MS" in
        sent) ok "通知邮件已发出（mail_status=sent）" ;;
        pending) bad "邮件仍为 pending" "检查 Queue 消费者与 Resend Key，或稍后再查" ;;
        failed) bad "邮件发送失败（mail_status=failed）" "查 D1 的 inquiries.mail_error 字段定位原因" ;;
        *) bad "拿不到邮件状态" ;;
      esac
    elif [ "$R" = 403 ]; then
      bad "询盘被 Captcha 拒绝" "脚本无法过 Turnstile，请改用浏览器手动测"
    else
      bad "询盘提交失败" "HTTP $R"
    fi
  fi
else
  echo "  ⏭ 未提供 ADMIN_USERNAME/ADMIN_PASSWORD，跳过"
fi

echo
echo "【6】阶段二接口（CRM / 订阅 / 审计）"
[ "$(code "$SITE/api/crm/overview")" = 401 ] && ok "CRM 概览匿名访问被拒（401）" || bad "CRM 概览未鉴权"
[ "$(code "$SITE/api/crm/customers")" = 401 ] && ok "客户列表匿名访问被拒（401）" || bad "客户列表未鉴权"
[ "$(code "$SITE/api/subscribers")" = 401 ] && ok "订阅名单匿名访问被拒（401）" || bad "订阅名单未鉴权"
[ "$(code "$SITE/api/admin/login-logs")" = 401 ] && ok "登录审计匿名访问被拒（401）" || bad "登录审计未鉴权"
[ "$(code "$SITE/api/settings/mail-templates")" = 401 ] && ok "邮件模板匿名访问被拒（401）" || bad "邮件模板未鉴权"
# 只发非法邮箱：验证接口与校验同时不产生垃圾订阅
R_SUB="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST -H 'Content-Type: application/json' -d '{"email":"not-an-email"}' "$SITE/api/subscribe")"
[ "$R_SUB" = 400 ] && ok "订阅接口拒绝非法邮箱（400）" || bad "订阅校验异常" "HTTP $R_SUB"

echo
echo "════════════════════════════════"
echo "  PASS=$PASS  FAIL=$FAIL"
echo "════════════════════════════════"
[ "$FAIL" -eq 0 ] || exit 1
