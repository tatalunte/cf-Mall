# cf-b2b-pro：完整外贸站改造版

基于 [`geeeeeeeek/cf_b2b`](https://github.com/geeeeeeeek/cf_b2b) 改造。原版是一个「Workers + D1 + R2 + KV」的 B2B 产品展示站 Demo，骨架好用，但存在多项 P0 级安全问题且缺外贸站刚需功能。本目录是**可落地的生产起点**，不是最终成品。

> ✅ 已验证（2026-11-08，本地 wrangler dev + 真实 D1/Queue 运行时）：
> 24 个 JS 模块语法通过、所有 import 目标存在；`wrangler deploy --dry-run` 打包 **178.36 KiB / gzip 40.60 KiB**；
> 端到端跑通 31 项检查 —— 前台 SSR、robots/sitemap、hreflang/RTL、越权拦截、伪造 JWT 拒绝、询盘落库、
> Queue 消费者发信失败回写 `mail_status=failed`、Cron 兜底重投（`updated_at` 前进 45s 已证实）。
> ⚠️ 未连接真实 Cloudflare 账号与 Resend 账号，邮件「到达收件箱」这一步必须在部署后按第 5 节验证。

---

## 1. 与原版的差异

| 维度 | 原版 | cf-b2b-pro |
|---|---|---|
| 管理员密钥 | `admin.js:8` 硬编码，源码公开可伪造 token | `env.JWT_SECRET`，未配置即拒绝所有后台接口 |
| 口令 | SHA-256 无盐，默认 `admin123/admin123` | PBKDF2 15 万次加盐，旧哈希登录时自动升级，附 `scripts/reset-admin.mjs` |
| JWT | `SHA-256(a.b.secret)` 伪签名 | HMAC-SHA256 + base64url，校验 alg/exp，常量时间比较 |
| 询盘接口 | GET 列表/详情、PUT 状态**完全无鉴权** + CORS `*` | 全接口鉴权、CORS 同源、后台表格统一转义 |
| 上传接口 | 无鉴权，只看客户端 `file.type` | 超管鉴权 + 文件头魔数校验 |
| 默认角色 | 两个账号都写成 `admin`，导致所有写操作 403 | `migrate.sql` 修正为 `super_admin` / `admin` |
| 防垃圾 | 无 | Turnstile + honeypot + 同邮箱 10 分钟 ≤3 条 + 长度限制 + GDPR consent |
| 邮件通知 | ❌ 完全没有 | D1 → **Queue → Resend** 异步发信，`reply_to`=客户，失败重试 + DLQ + Cron 兜底 |
| 前台渲染 | 客户端 `innerHTML`（爬虫看到 spinner、有 XSS） | **服务端直出**完整 HTML + `escapeHtml`，筛选数据内联下发 |
| SEO | 只有 title/description | canonical / hreflang / OG / Organization+Product+Breadcrumb JSON-LD / sitemap.xml / robots.txt / 语义化 slug |
| 多语言 | ❌ | `/es/` `/ar/` 路由 + UI 词典 + `products.translations` + RTL + 翻译回退 |
| 询盘后台 | 3 种状态、无备注无导出 | 7 状态 + 备注 + 指派 + 搜索筛选 + CSV 导出（防公式注入） |
| 站点设置 | 只影响首页 2 处，Logo/页脚写死 `GlobalMart` | 全站品牌、页脚联系方式、社交链接均由 KV 设置驱动 |
| 静态图 | `static.js` 占位实现，示例图全坏 | R2 读图，缺失时返回内联 SVG 占位图 |
| 其它 | — | 隐私政策页、安全响应头、统一 `(request, env)` 页面签名 |

---

## 2. 目录结构

```
cf-b2b-pro/
├── wrangler.toml                 # D1 / R2 / KV / Queues producer+consumer+DLQ / vars / Cron（REPLACE_* 待填）
├── deploy.sh                     # ★ 一键部署（建资源 → 灌库 → 建超管 → 部署）
├── src/
│   ├── index.js                 # fetch + queue() 消费者 + scheduled() 兜底 + 安全头
│   ├── mailer.js                # Queue → Resend 发信、自动回复（可选）、失败重投
│   ├── i18n.js                  # en/es/ar 词典、语言路由、hreflang、翻译回退
│   ├── utils/
│   │   ├── auth.js              # PBKDF2 + HMAC JWT + requireAuth / requireSuperAdmin
│   │   └── html.js              # escapeHtml / 规格表 / JSON-LD
│   ├── api/
│   │   ├── router.js            # 同源 CORS + API 分发
│   │   └── handlers/            # products / inquiries / admin / upload / settings
│   └── pages/
│       ├── router.js            # 语言前缀、隐私政策页、静态图
│       ├── layout.js            # SEO head + i18n 导航 + 设置驱动页脚
│       ├── home.js / products.js / product-detail.js   # 服务端直出
│       ├── product-card.js / seo.js / privacy.js / static.js
│       └── about.js / contact.js / admin-login.js / admin-dashboard.js
├── schema/
│   ├── bootstrap.sql            # ★ 全新安装：完整列 + 索引 + 示例产品，无默认账号（推荐）
│   ├── schema.sql               # 原版建表（含两个默认账号，仅用于理解原仓库）
│   └── migrate.sql              # 原版升级到改造版时用（已有库跑这个）
├── scripts/
│   ├── reset-admin.mjs          # ★ 生成 PBKDF2 管理员口令哈希
│   └── smoke-test.sh            # ★ 部署后线上冒烟测试（31 项：安全/SEO/多语言/询盘）
├── README.md / readme-cn.md     # 原版文档（部分内容已过时，以本文件为准）
└── .dev.vars                    # 本地开发用密钥（已 gitignore，勿提交）
```

---

## 3. 部署前准备

- 一个**NS 托管在 Cloudflare** 的域名
- Resend 账号：验证发信域名，加 SPF / DKIM / DMARC，拿 API Key
- Turnstile widget：拿 Sitekey（公开）和 Secret Key
- R2 需绑定信用卡才能开通（免费 10 GB）
- Node.js 18+

---

## 4. 部署步骤

### 4.1 一键部署（推荐）

```bash
cp .deploy.env.example .deploy.env   # 填入 Token / 域名 / 密钥
bash deploy.sh                       # 建 D1+R2+KV+Queues → 灌库 → 写 secrets → 建超管 → 部署
```

脚本会：① 复用已存在的资源；② 把 D1 / KV 的 ID 自动写回 `wrangler.toml`；③ 用 `bootstrap.sql` 初始化（幂等）；
④ 用 PBKDF2 创建/重置 your super_admin；⑤ 首次部署后再写 secrets（避免 Worker 不存在时写入失败）；⑥ 输出下一步。

> 脚本未在真实账号预跑过，首次执行请逐步看输出；任何一步失败都能按 4.2 手工续做，不会丢已建资源。

### 4.2 手工部署

```bash
npm install
npx wrangler login

# ① 建资源（把输出的 ID 填回 wrangler.toml 的 REPLACE_* 占位）
npx wrangler d1 create b2b_database
npx wrangler r2 bucket create b2b-product-images
npx wrangler kv namespace create "STATIC_ASSETS"
npx wrangler queues create b2b-inquiry-mail
npx wrangler queues create b2b-inquiry-mail-dlq   # DLQ 必须单独建，否则 deploy 报 queue not found

# ② 初始化（全新库只跑 bootstrap.sql；已有原版库则跑 schema.sql + migrate.sql）
npx wrangler d1 execute b2b_database --remote --file=./schema/bootstrap.sql

# ③ 首次部署（先让 Worker 存在）
npx wrangler deploy

# ④ 密钥（不要写进 wrangler.toml）
npx wrangler secret put JWT_SECRET              # openssl rand -hex 32
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put RESEND_API_KEY

# ⑤ 把 wrangler.toml 里改成真实值：
#   SITE_URL=https://你的域名   TURNSTILE_SITEKEY=0x...
#   MAIL_TO=sales@你的域名      MAIL_FROM=B2B Inquiry <notify@你的域名>
#   AUTO_REPLY=false           # 想给客户自动回执再改 true

# ⑥ 建自己的超管（脚本会打印可直接执行的 SQL）
node scripts/reset-admin.mjs '你的12位以上强密码'

# ⑦ 本地验证 / 上线
npm run dev        # http://localhost:8787
npm run deploy
```

Cron 兜底已在 `wrangler.toml` 内置（`crons = ["0 * * * *"]`），无需手动添加。
上线后：① 给 `/admin*` 加 Cloudflare Access；② 绑自定义域名（`SITE_URL` 必须与它一致，否则 canonical 会错）；
③ 跑 `bash scripts/smoke-test.sh https://你的域名`；④ 提一条测试询盘确认邮件进**收件箱**（不是垃圾箱）。

### 4.3 本地开发（不花钱、不碰线上）

```bash
# 本地 D1 初始化（只写 .wrangler/state，不影响线上）
npx wrangler d1 execute b2b_database --local --file=./schema/bootstrap.sql

# 本地密钥：.dev.vars（已 gitignore）
echo "JWT_SECRET=$(openssl rand -hex 32)" > .dev.vars

# 建一个本地管理员（把打印的 INSERT 语句用 --local 执行）
node scripts/reset-admin.mjs 'LocalDevPassw0rd!'

npm run dev      # http://localhost:8787，后台 /admin/login
```

本地不配 `RESEND_API_KEY` 时，询盘会落库、Queue 也会消费，但 `mail_status` 变成 `failed`、
`mail_error = "RESEND_API_KEY not configured"` —— 这是**预期行为**，正好用来验证失败回写与 Cron 重投。

---

## 5. 验收清单

**推荐：一条命令跑 31 项检查**

```bash
bash scripts/smoke-test.sh https://你的域名
# 连登录/询盘一起测（会自动提单并检查 mail_status）：
ADMIN_USERNAME=you ADMIN_PASSWORD='***' SUBMIT_TEST=1 bash scripts/smoke-test.sh https://你的域名
```

覆盖：页面可达性 / canonical+hreflang+JSON-LD / robots 非空 / sitemap alternates / es+ar+RTL /
安全响应头 / 6 个接口的未授权拦截 / 伪造 JWT / 登录 / 询盘落库 / 邮件状态。

手工复核（脚本测不到的部分）：

```bash
SITE=https://你的域名
curl -s $SITE/products | grep -oE '<article|&lt;script' | head        # SSR 直出 + 无未转义脚本
curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"a","email":"a@b.com","message":"m"}' $SITE/api/inquiries -i | head -3  # 期望 400（缺 consent）
# 浏览器里：提一条询盘 → 销售邮箱收到通知（reply_to=客户邮箱）→ 后台改状态/备注 → Export CSV 能打开且中文不乱码
```

---

## 6. 已知限制（别当成成品直接商用）

1. **只在本地运行时验证过**：D1 / Queue / Cron / 鉴权 / SSR 全部实测；**未连你的 CF 账号与 Resend 账号**，
   线上邮件到达率、Turnstile 真实拦截、自定义域名证书需部署后验。
2. **多语言内容是示例级**：en/es/ar UI 词典可直接用，产品译文需自己翻译后填进后台 `Translations (JSON)`，
   缺失字段自动回退英文；`/es/` `/ar/` 只有 UI 词典，法律页（privacy）不随语言切换。
3. **「业务员指派」仍无 UI**：`PUT /api/inquiries/:id/assignee` 与 `PUT /api/crm/customers/:id` 的 `owner`
   都已就绪，但只能通过 API 调用。单人运营不受影响，多人协作需要补一个下拉框。
4. **询盘详情已是跟进工作台**（阶段二A 完成，替换了原来的 `alert` + `prompt`）：
   含客户信息、UTM 来源、附件下载、意向等级、状态、下次跟进、内部备注、跟进时间线。
5. **CSP 未启用严格模式**：页面有大量内联 JS，只加了基础安全响应头；要上 CSP 需先把内联脚本抽成外部文件并加 nonce。
6. **管理员无自助改密/用户管理**：改密走 `scripts/reset-admin.mjs` + SQL；多业务员账号需手工插入 `admins` 表。
7. **许可证**：原仓库只在 README / package.json 声明 MIT，没有独立 LICENSE 文件，商用前向作者确认。
8. **免费层约束**：Workers 单请求 10ms CPU（发信已异步）、KV 写 1,000 次/天（别频繁保存设置）、
   Queues 10,000 ops/天、Resend 3,000 封/月。R2 取图走 Worker 会消耗请求数，量大时改绑 R2 自定义域名直连。
9. **图片**：已在上传前做浏览器端压缩（`createImageBitmap` → canvas，长边 1600px / WebP 0.82），
   R2 响应头为 `immutable`；但**服务端不再二次处理**，`/cdn-cgi/image` 多尺寸变换默认关闭（见 §9）。
   原图上限仍是 5 MB（R2 + Workers 请求体限制），建议运营自己先压到 500 KB 以内再传。
   详细成本测算与取舍见 `docs/image-storage.md`。

---

## 7. 阶段二完成情况（0.5.0 ~ 0.7.0）

| 能力 | 位置 | 说明 |
|---|---|---|
| 客户档案 / 跟进时间线 / 意向分级 | `/api/crm/*`、后台 Inquiries | 询盘提交时按邮箱自动归并客户，自动初判 hot/warm/cold |
| 每日跟进提醒 | `src/crm-reminder.js` | Cron 每小时跑，仅 UTC 08:00 汇总发一封，避免刷屏 |
| 登录审计 / 失败锁定 | `/api/admin/login-logs`、Settings 页 | 15 分钟内 5 次失败锁该用户名，返回 429 + Retry-After |
| 邮件订阅（双 opt-in） | 页脚表单、`/api/subscribe*` | 确认后才置 confirmed；确认/退订 token 用途分离 |
| 邮件模板可编辑 | `/api/settings/mail-templates`、Settings 页 | 存 KV，改话术不用重新部署；缺失自动回退默认 |

**新增环境变量**：`DEV_MAIL_ECHO=1`（仅本地/预览用，把订阅确认链接直接回传，生产不要设置）。

**新增迁移**：`004-crm.sql`、`005-subscribers.sql`。全新安装直接用 `schema/bootstrap.sql`（已包含）。

---

## 8. 阶段三完成情况（0.8.0 ~ 1.0.0）—— 交易与自动化

| 能力 | 位置 | 说明 |
|---|---|---|
| 报价单 | `/admin/trade`、`/api/quotes/*` | 多行项目、折扣/税率/运费、有效期；金额**服务端重算**，不信前端传的 total |
| 报价单 PDF | `GET /api/quotes/:id/pdf` | 自研 `src/utils/pdf.js`（零依赖、自动分页），见下方字符集限制 |
| 客户在线确认 | `/quote/<token>`、`POST /api/quotes/respond` | 无需登录，Accept / Request changes / Decline；一个 token 只能响应一次 |
| 询价清单页 | `/quote` | 多行编辑器、`?product=slug&qty=` 预填、蜜罐、10 分钟 3 次频控 |
| 订单 | `/admin/trade`、`/api/orders/*` | 从报价一键转单（行项目快照）、状态机、物流单号、状态时间线 |
| 订单确认单 PDF | `GET /api/orders/:id/pdf` | Proforma Invoice 版式，无 Stripe 时打印 T/T 银行信息 |
| Stripe 收款 | `POST /api/orders/:id/checkout` | 未配置密钥时返回 400 + 银行转账兜底；webhook 验签 + 幂等 |
| 客户门户 | `/account`、`/api/account/*` | 邮箱魔法链接，无密码；30 分钟一次性 token，可查看自己的报价与订单 |

### 三条安全边界（改代码时不要破坏）

1. **管理员 token 与客户 token 互斥**：payload 靠 `kind:'customer'` 区分，`requireAuth` 拒绝客户 token，
   `requireCustomer` 只收客户 token。已验证「客户 cookie 打 `/api/quotes` 返回 401」。
2. **公开报价接口做字段裁剪**：不返回 `created_by` / `customer_id` / `inquiry_id`，
   避免客户从 JSON 反推内部数据。
3. **防枚举**：订阅与魔法链接接口对「存在 / 不存在 / 超频 / 蜜罐」返回同一句话，
   只有邮箱格式非法才 400。

### PDF 的字符集限制（必须知道）

`src/utils/pdf.js` 只支持 WinAnsi（Latin-1）。**中文与阿拉伯文会被替换成 `?`**。
不是偷懒 —— 嵌入 CJK 字体子集动辄 3~8 MB，而 Worker 包体上限只有 3 MB（免费）/ 10 MB（付费）。
需要中文单据时用 `/quote/<token>` 的打印页（有 `@media print` 规则，浏览器 Ctrl+P 另存为 PDF，
字体和排版都比内置 PDF 好）。

**新增迁移**：`006-trade.sql`（7 张表：quotes / quote_items / orders / order_items / order_events /
customer_accounts / magic_tokens）。全新安装直接用 `schema/bootstrap.sql`（已包含，共 20 张表）。

**新增环境变量**（都可不配，不配则对应功能优雅降级）：

| 变量 | 作用 | 不配的后果 |
|---|---|---|
| `STRIPE_SECRET_KEY` | 在线收款 | checkout 返回 400 + 银行转账信息 |
| `STRIPE_WEBHOOK_SECRET` | webhook 验签 | webhook 一律 400（不会误标记已付） |

---

## 9. 演示站与全站审计（1.1.0）

### 9.1 一键造一个「有内容可点」的站

```bash
# 首次：建演示账号 demo / Demo2026!b2b（会写 D1，必须先把 dev server 停掉）
npm run seed:prepare

npm run dev          # 另开一个终端

# 灌演示数据（全部走真实 HTTP API，等于顺带一次接口回归）
npm run seed

# 推倒重来：清空业务数据 + 重放 bootstrap 基础行（同样要先停 dev server）
npm run seed:reset
```

> `--reset` 先 `DELETE` 全部业务表，再重跑一遍 `schema/bootstrap.sql`——
> 光删表不够，bootstrap 里有 5 条基础 FAQ 和示例产品是 `INSERT OR IGNORE` 种进去的，
> 删掉就再也回不来（FAQ 页会只剩后来追加的 3 条）。`admins` / `login_logs` 不动。
>
> 跑过 `npm run test:all` 之后站上会多出 `ui-test-*` / `csv-*` 产品、`crm-*@example.com` 的询盘、
> 以及几张转不了也删不掉的已发货订单 —— `npm run seed` 会顺手清掉按前缀能识别的残留，
> 想彻底干净就用 `seed:reset`。

手工点测清单见 **[`docs/manual-test-guide.md`](docs/manual-test-guide.md)**（前台 → 客户侧 → 后台 → 移动端，约 40 分钟）。

产出：12 个产品（5 个分类 · 含规格/应用/定制/SEO/西语阿语译文/图库）、4 个案例、5 篇新闻、
8 条 FAQ、8 条询盘（带 UTM 与意向等级）、3 张报价单（含已发送/已接受）、1 张订单（含状态时间线）、
6 条订阅、完整站点设置与 7 个页面 SEO。

- **幂等**：产品/案例/新闻按 `slug` upsert，询盘与报价按邮箱去重 —— 反复跑不会翻倍。
  （早期版本「删了重建」跑不通：DELETE 是软删除，`slug` 的 UNIQUE 索引仍被占着。）
- **图片本地生成**：`scripts/lib/png.mjs` 零依赖写 PNG（CRC32 + deflate），首跑上传 R2 后记进
  `.demo-images.json`（已 gitignore），不重复上传、不留孤儿对象。
- **一条命令重来**：`node scripts/seed-demo.mjs` 会把 `sample-*` 占位产品、`Audit Test Product`
  以及 bootstrap 自带的两篇示例新闻清干净。

### 9.2 一条命令做「像真人一样」的全站体检

```bash
npm run audit        # 需要 dev server 在跑
```

四步：爬公开站（跟随 `a[href]`，上限 120 页）→ 爬后台（注入 localStorage token）→
逐条校验 `sitemap.xml` → 32 个交互场景。产出 `test-artifacts/audit-report.html`（可直接点开看）
与同名 `.json`，退出码 0/1 可进 CI。

| 维度 | 判据 |
|---|---|
| 死链 | 站内 `<a href>` 全部 200/304；`href="#"` 必须带 `onclick`/`data-*` 行为 |
| SEO | 每页 `<title>` / `meta description` / canonical / 唯一 H1 |
| 资源 | 每个 `<img>` 必须加载成功且有 `alt`。产品卡片 / 新闻封面用了 `loading="lazy"`，采样前会强制改 `eager` 并等解码——否则视口外的图「根本没发请求」会被误判成坏图；翻页取消的 `net::ERR_ABORTED` 也不计入缺陷。真正的 404 仍会被抓到 |
| 控制台 | 本页网络层无 4xx 时，滤掉上一页异步回调残留的报错 |
| 移动端 | 375px 下 6 个核心页无横向滚动 |

**基线（v1.3.0）**：抓取 132 页 · 死链 0 · sitemap 坏链 0 · 控制台错误页 0 · 坏图页 0 · 交互场景 32/32。
交互场景自带清理（按 `audit-` 邮箱前缀 / 产品名 / 订单号精确删除，且**先删订单再删报价**——
已转订单的报价 `deleteQuote` 会返 409，顺序反了会留下永远删不掉的 accepted 报价）。

`npm run test:all` 已包含 `npm run audit`，共 14 套（v1.3.0 新增 `test:translate` 29 项、`ui:translate` 21 项；v1.4.0 新增 `test:engine` 53 项、`ui:engine` 23 项）。

### 9.3 图片两个新开关（都可留空）

| 变量 | 作用 | 不配的后果 |
|---|---|---|
| `IMAGES_PUBLIC_BASE` | R2 自定义域，如 `https://img.example.com`。配上后图片直链不再经 Worker | 走 `/api/upload/image/...`，每张图消耗一次 Worker 请求 + CPU |
| `IMAGE_RESIZE` | 设为 `1` 时输出 `/cdn-cgi/image/width=...` 的 `srcset` 多尺寸 | 单张原图，移动端流量浪费 3~4 倍 |

> `IMAGE_RESIZE=1` 只在**域名走 Cloudflare 代理**时有效，且 `/cdn-cgi/image` 只认同域图片
> （外链图会被打成 404，`src/utils/image.js` 已对非 `/` 开头的地址跳过）。免费额度 5,000 次唯一变换/月，
> 超限返回 9422。详见 `docs/image-storage.md`。

### 9.4 主题切换 + 夜间模式（1.3.0）

导航右侧多了一个调色盘按钮，访客可自选 **6 套配色 + 1 个「夜间·跟随系统」**，
选择存在 `localStorage`，刷新/换页都保持。

| 主题 | 适合的产品线 | 底色 |
|---|---|---|
| `classic` Industrial Blue | 通用机电、泵阀、五金 —— 最稳，不挑行业 | 亮 |
| `ocean` Deep Ocean | 水处理、环保、制冷、船舶 | 亮 |
| `ember` Forge Orange | 重型机械、焊接、矿山、建材 —— 强对比，衬设备大图 | 亮 |
| `forest` Machine Green | 化工、能源、农业机械 | 亮 |
| `midnight` Midnight Tech | 仪器仪表、电子、自动化 —— 深色底衬产品图 | **暗** |
| `mono` Graphite | 高端定制、设计导向 —— 让照片自己说话 | 亮 |
| `auto` **Night (auto)** | 全行业 —— 白天 `classic`、入夜 `midnight`，自动跟随系统 | **随系统** |

**夜间模式**：选 `auto` 后跟随访客系统的 `prefers-color-scheme`，系统明暗一变就实时切换，
不用刷新也不用再点。访客手动选任意具体配色即退出 `auto`（手动选择永远优先）。
服务端读不到系统偏好，先输出亮色兜底，`<head>` 内联脚本在 `<style>` 前纠正首帧防闪烁，
实时跟随由页面底部切换器 IIFE 里唯一的 `matchMedia('change')` 监听器负责。
后台默认主题也能设成 `auto`，首次访客直接按自己系统明暗看站。

**后台设默认值**：Settings → Site Theme。存 KV，保存即生效，不用重新部署。
优先级是 `localStorage（访客自选） > KV（后台默认） > classic`。

**实现要点**（改配色前先看这段，否则很容易把暗色主题弄花）：

- 所有组件只消费语义变量（`--bg-page` / `--bg-card` / `--text-dark` / `--band-bg` …），
  一套主题 = `src/pages/layout.js` 里十几行变量覆盖，**不要**为某套主题单独写选择器。
- 页脚用独立的 `--footer-*` 一组，不能跟着 `--text-dark` 走 —— 暗色主题里 `--text-dark` 是浅色，
  页脚会变成「比页面还亮的大白块」。
- 整块品牌色横幅（首页工厂实力数字条、About 的 CTA）用 `--band-bg` / `--band-fg`，
  不能直接用 `--primary-color` 当底 —— 暗色主题的 primary 是亮青，整条会变成刺眼亮带。
- 主色底上的文字一律 `--on-primary`（暗色主题里它是深色字）。
- 新增硬编码颜色是本项目最容易犯的错：`#fff` 白卡片在暗色主题下就是一块块白板。
  缺图占位图的 SVG 底必须是透明的（`src/pages/static.js`），由 `.card-image` 的
  `background: var(--bg-light)` 提供底色。

**加第 8 套配色**：`layout.js` 里 ① `THEMES` 数组加一项（切换器靠它渲染）
② CSS 加 `html[data-theme="xxx"] { … }` 变量覆盖块 ③ `settings.js` 的 `THEME_KEYS` 加 key
④ 后台下拉加一个 `<option>`。四处漏一处就会出现「能选但不生效」或「保存被静默丢掉」。
注意 `auto` 是策略键而非配色，没有自己的变量块，只映射到 `midnight` / `classic`。

`npm run test:theme` 是独立的主题冒烟（31 项断言：切换、真变色、持久化、夜间模式实时跟随、375px 不溢出）；
`npm run audit` 里另有 3 个常驻场景守住「深色主题底色真的变深」「夜间 auto 跟随系统」和
「后台默认值落 KV 并作用于首次访客」。详见 `docs/themes.md`。

### 9.5 后台一键生成译文（1.3.0）

运营用**中文或英文**发布产品 / 新闻，点一次「一键生成译文」即可把其它语种回填到多语言 Tab，
人工核对后再点 Save 才入库。覆盖产品 + 新闻 / 案例 / 资质 / FAQ / 工厂实力。

默认引擎是 Cloudflare Workers AI 的 `@cf/meta/m2m100-1.2b`，**零 API Key**（1.4.0 起也可切到自定义 OpenAI 兼容模型，见 §9.6），`wrangler.toml` 里只需：

```toml
[ai]
binding = "AI"
```

免费额度 10,000 Neurons/天、模型 Zero data retention。注意 `[ai]` 必须放在 `[vars]` **所有键之后** ——
TOML 的 `[table]` 会结束上一个表，放中间会把后面的 `TURNSTILE_SITEKEY` / `MAIL_TO` 静默吞进 `[ai]`。
**本地 `wrangler dev --local` 下 AI binding 是 `not supported`**，只有 `zh → zh-TW` 纯本地转换可用；
要跑真实模型用 `npx wrangler dev --remote`（先 login）或部署到线上，调用会实际计入额度。

三条不能破的约束：

- **译文不直接写库**。`/api/translate` 只返回文本回填输入框，写入仍只有保存逻辑里那条
  `toJsonColumn()` 路径（本项目踩过 translations 双层编码导致前台静默回退英文的坑）。
- **一次请求一个目标语种**，前端串行 4 次 + 进度提示。免费 Worker 单请求 10ms CPU、模型有长度上限，
  全塞一次容易超时；字段间也串行，避免 Workers AI 7505 限流。
- **默认 `fill` 只补空**，不覆盖人工润色过的译文；另有 `overwrite` 显式覆盖。

术语保护（型号 / 认证号 / URL / 单位）用 `__B2BK0__` 占位符，`zh → zh-TW` 走纯本地简繁 + 台湾用词转换
（m2m100 只有 `zh`，不区分简繁），因此这条路径**不花额度**。可在 KV `website_settings` 的
`translation_glossary` 里配品牌名/型号白名单。

```bash
npm run test:translate   # 29 项：纯逻辑 + API 契约（mock/本地，不消耗额度）
npm run ui:translate     # 21 项：产品 + 新闻弹窗流程，page.route 拦截后端
npm run test:all         # 两套已纳入全量回归，ui-audit 仍是最后一道
```

完整 API 契约、字段清单、排错表见 `docs/translation.md`。

### 9.6 翻译引擎设置：Workers AI / 自定义 OpenAI 兼容模型（1.4.0）

后台 **Settings → Translation Engine** 可切换两档引擎，存 KV，保存即生效、不用重新部署：

| 引擎 | 适用 | 本地 `--local` |
|---|---|---|
| `workers_ai`（默认） | `@cf/meta/m2m100-1.2b`，零 API Key、免费 10,000 Neurons/天 | ❌ binding 显示 `not supported` |
| `openai` | 任意 `/chat/completions` 端点（OpenAI / DeepSeek / OpenRouter / AI Gateway），自填 Base URL + Model + API Key | ✅ 可用，适合本地先验链路 |

四个不能破的安全点：

- `GET /api/settings` 是公开接口 → **所有 `translation_*` 键从公开响应整体剔除**，连密文都不露。
- API Key 用 **AES-GCM** 加密后落 KV（`enc:v1:<iv>.<ct>`），密钥由 `TRANSLATION_SECRET_KEY`
  或 `JWT_SECRET` 派生；超管 GET 只回 `api_key_set` 布尔值，永不回显明文/密文。
- 自定义 Base URL 做 **SSRF 校验**：只接受 https + 公网域名 + 443，拒绝 IP / 内网 / localhost /
  元数据地址 / 内嵌账号密码；`requireSuperAdmin` 守住全部配置接口。
- 引擎切换只替换「文本 → 译文」那一段，术语占位保护、分段、简繁转换、
  「译文只回填不入库、人工核对后才保存」全部共用；`zh → zh-TW` 两档都不调外部模型。

后台另有 **Test connection**（一次真实模型调用，会花额度/钱）和「只补空 / 覆盖」两种写入方式。
接口：`GET|POST /api/settings/translation`、`POST /api/settings/translation/test`。
详见 `docs/translation.md` §2。

---

## 10. 相关文档

- 主题系统与夜间模式：`docs/themes.md`
- 一键生成译文 + 双引擎设置：`docs/translation.md`
- **上线权限清单（Cloudflare API Token / GitHub PAT / 必需变量）**：`docs/deploy-permissions.md`
- 代码仓库与自动部署：`tatalunte/cf-Mall`（main 分支 push 触发 `.github/workflows/deploy.yml` 的 verify → deploy）；
  首次资源 bootstrap 用 `DRY_RUN=1 node scripts/go-live.mjs` 预检后再正式跑，细节见权限清单「本次实际部署」小节。
- 图片存储与 CDN 变换：`docs/image-storage.md`
- 阶段三接口契约：`docs/phase3-contract.md`
- 人工验收清单：`docs/manual-test-guide.md`
- 逐文件源码剖析、问题清单（含行号）、三阶段实现方案、免费额度对照：
  `../cf_b2b_源码深度解析与完整外贸站实现方案.md`
- 11 个候选项目横向对比与方案 B/C/D（组合式 / CMS / VPS）：
  `../外贸站_Cloudflare部署选型报告.md`
