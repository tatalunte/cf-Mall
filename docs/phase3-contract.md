# 阶段三（交易与自动化）开发契约

> 本文件是并行开发的唯一接口契约。任何实现都必须与这里的路径、字段名、JSON 形状一致，
> 否则前后端会在联调时对不上。**不要擅自改动本文件定义的契约**，有疑问按契约走。

## 0. 环境与硬性约束

- 项目根：`cf-b2b-pro/`，Cloudflare Workers + D1 + R2 + KV + Queues，ES Module 语法，**无构建步骤**（wrangler 直接打包）。
- 依赖：除 `wrangler`、`playwright-core` 外**不允许新增任何 npm 依赖**（Worker 包体上限 3 MB）。
- 已存在并被多处在用的工具，直接复用，不要重写：
  - `src/utils/html.js` → `escapeHtml(str)`、`jsonLdScript(obj)`
  - `src/utils/auth.js` → `requireAuth(request, env)`、`requireSuperAdmin`、`verifyJWT`、`signJWT`、`requireCustomer`、`signCustomerToken`、`customerCookie`、`clearCustomerCookie`、`readCookie`
  - `src/utils/pdf.js` → `PdfDoc`、`money`、`pdfDate`、`textWidth`
  - `src/i18n.js` → `t(lang, key)`、`localizedUrl(path, lang, env)`、`LANG_META`、`supportedLangs(env)`
  - `src/pages/layout.js` → `createLayout(title, content, additionalScripts, metaDescription, useTitleSuffix, options)`
    - `options = { env, request, lang, settings, jsonld }`，`jsonld` 可传对象或对象数组
  - `src/mail-templates.js` → `getTemplates(env)`、`renderTemplate(str, vars)`、`textToHtml(str)`
  - `src/mailer.js` → `sendMail(env, { to, subject, html })`（已内部处理 Resend 调用与 DEV_MAIL_ECHO）
- **禁止**：修改 `src/api/router.js`、`src/pages/router.js`、`src/index.js`、`package.json`、`schema/**`、`wrangler.toml`。
  路由挂载由主控统一完成。
- **禁止**：运行 `wrangler` 任何命令、启动 dev server、运行 playwright/浏览器测试、执行 `git` 命令。
  你只做「写代码 + `node --check` 语法自检」。集成测试由主控统一跑，避免并行进程抢占 8787 端口和本地 D1。
- 允许并鼓励：写纯函数级自测脚本到 `test-artifacts/` 并用 `node` 跑（不得依赖网络与 dev server）。
- 代码风格：与现有文件一致 —— 2 空格缩进、单引号、语句带分号、中文注释解释「为什么」而不是「做了什么」。
- **绝对不要在 `src/pages/**` 文件的模板字符串里写 `'\n'`**：整页是模板字符串，`\n` 会被插值成真实换行，
  浏览器拿到「单引号内换行」→ `Invalid or unexpected token`，整段脚本全废。需要换行用 `String.fromCharCode(10)`。
- 后台是**纯 Bearer token 鉴权（不走 Cookie）**，任何新增 `fetch` 必须带 `Authorization: Bearer <localStorage.admin_token>`。

## 1. 数据模型（已建好，直接查）

完整 DDL 见 `schema/migrations/006-trade.sql`。要点：

| 表 | 关键字段 |
|---|---|
| `quotes` | `quote_no`(唯一,`QT-YYYYMMDD-0001`)、`inquiry_id`、`customer_id`、`customer_email`(必填)、`customer_name/company/country`、`currency`(默认 USD)、`incoterm`、`payment_terms`、`valid_until`、`subtotal`、`discount_type`(percent/amount)、`discount_value`、`discount_amount`、`tax_rate`、`tax_amount`、`shipping_amount`、`total`、`notes`、`terms`、`status`(draft/sent/accepted/changes_requested/rejected/expired)、`token`(唯一,null 表示未发送)、`sent_at`、`responded_at`、`accepted_at`、`created_by` |
| `quote_items` | `quote_id`、`product_id`、`name`、`spec`、`qty`、`unit`(默认 pcs)、`unit_price`、`amount`、`sort_order` |
| `orders` | `order_no`(唯一,`SO-YYYYMMDD-0001`)、`quote_id`、`inquiry_id`、`customer_id`、`customer_email`(必填)、`customer_name/company/country`、`currency`、`total`、`deposit_amount`、`deposit_paid`(0/1)、`status`(placed/confirmed/in_production/ready/shipped/delivered/completed/cancelled)、`payment_status`(unpaid/deposit_paid/paid/refunded)、`incoterm`、`payment_terms`、`carrier`、`tracking_no`、`tracking_url`、`ship_date`、`eta`、`notes`、`created_by` |
| `order_items` | 同 `quote_items`，键为 `order_id` |
| `order_events` | `order_id`、`type`(status/payment/shipping/note)、`from_value`、`to_value`、`message`、`admin_user` |
| `customer_accounts` | `email`(唯一)、`name`、`company`、`phone`、`country`、`lang`、`status`(active/blocked)、`last_login_at` |
| `magic_tokens` | `email`、`token`(唯一)、`purpose`(login/quote)、`expires_at`、`used_at`、`ip` |

时间字段统一存 `'YYYY-MM-DD HH:MM:SS'`（D1 的 `CURRENT_TIMESTAMP` 就是这个格式），
日期字段存 `'YYYY-MM-DD'`。**不要写 ISO 带 T/Z 的字符串**，否则同库排序会错乱。

## 2. 通用响应约定

```js
// 成功
{ "success": true, "data": ... }
// 失败
{ "error": "human readable message" }   // 配合 HTTP 4xx/5xx
// 列表
{ "success": true, "data": [...], "total": 123, "limit": 20, "offset": 0 }
```

`corsHeaders` 由 `handleApiRequest` 传入，所有响应都要带 `{ ...corsHeaders, 'Content-Type': 'application/json' }`。

## 3. 报价单 API（`src/api/handlers/quotes.js`，导出 `handleQuotes`）

挂载前缀 `/api/quotes`。

### 后台（需登录：`requireAuth`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/quotes?status=&q=&limit=20&offset=0` | 列表，`q` 匹配 quote_no / customer_email / customer_company（LIKE）；返回 `{data,total,limit,offset}` |
| GET | `/api/quotes/:id` | `{success,data:{...quote, items:[...]}}` |
| POST | `/api/quotes` | 新建，body 见下；自动生成 `quote_no`，`status='draft'` |
| PUT | `/api/quotes/:id` | 局部更新头字段；body 里带 `items` 时**整体替换**（先 DELETE 再 INSERT） |
| DELETE | `/api/quotes/:id` | 仅 super_admin；已转订单的报价返回 409 |
| POST | `/api/quotes/:id/send` | 生成 `token`（32 字节 base64url）、`status='sent'`、`sent_at=now`，发邮件给客户（含 `{SITE}/quote/{token}`）；返回 `{success,data:{token,url}}` |
| POST | `/api/quotes/:id/duplicate` | 复制为新 draft（新 quote_no） |
| GET | `/api/quotes/:id/pdf` | 返回 `application/pdf`，`Content-Disposition: attachment; filename="QT-xxx.pdf"` |

POST/PUT body：

```json
{
  "inquiry_id": 12, "customer_id": 3,
  "customer_email": "buyer@acme.example", "customer_name": "Ahmed",
  "customer_company": "Acme Trading LLC", "customer_country": "AE",
  "currency": "USD", "incoterm": "FOB", "payment_terms": "30% T/T deposit, balance before shipment",
  "valid_until": "2026-12-08", "discount_type": "percent", "discount_value": 5,
  "tax_rate": 0, "shipping_amount": 480, "notes": "...", "terms": "...",
  "items": [
    { "product_id": 7, "name": "Centrifugal pump CPS-200", "spec": "SS316L / 15kW",
      "qty": 10, "unit": "pcs", "unit_price": 1250 }
  ]
}
```

金额计算规则（**服务端必须自己算，不能信前端传的 total**）：

```
line.amount     = round(qty * unit_price, 2)
subtotal        = sum(line.amount)
discount_amount = discount_type==='percent' ? round(subtotal*value/100,2)
                : discount_type==='amount'  ? round(value,2) : 0
taxable         = subtotal - discount_amount
tax_amount      = round(taxable * tax_rate/100, 2)
total           = round(taxable + tax_amount + shipping_amount, 2)
```

校验：`customer_email` 必填且格式合法；`items` 至少 1 行且每行 `name` 非空、`qty>0`、`unit_price>=0`；
`currency` 限 `USD/EUR/GBP/CNY/AED/JPY/RUB/PT/BRL`（非法一律回落 `USD`）。
错误返回 400 + 明确字段名，例如 `{error:'items[2].qty must be > 0'}`。

### 公开（无鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/quotes/view?token=` | 返回给客户看的报价：**必须剥离** `created_by`/`customer_id`/`inquiry_id` 等内部字段；含 `items` 与公司抬头（从 `env.STATIC_ASSETS` 的 `website_settings` 读 `site_name/email/phone/address/whatsapp`）。token 无效/过期/已作废 → 404 `{error:'Quote not found or link expired'}` |
| POST | `/api/quotes/respond` | body `{token, action:'accept'\|'changes'\|'reject', message?}`。只允许从 `sent` 状态流转；`accept` → `status='accepted'`, `accepted_at=now`；`changes` → `'changes_requested'`；`reject` → `'rejected'`。写一条 `activities`（type=`quote_<action>`，content 含客户留言），并发邮件通知销售（`MAIL_TO`）。重复提交同一 token → 409。 |
| POST | `/api/quotes/request` | **公开询价清单**（前台 `/quote` 页提交）。body `{email,name,company,country,message,items:[{product_id,name,qty,unit,spec}],company_url}`（`company_url` 是蜜罐，非空直接返回 `{success:true}` 不落库）。行为：① 建 `inquiries` 记录（`product_name` = 首个品名 + `(+N more)`，`message` 含清单文本）② 建 `quotes` 记录 `status='draft'`、行来自 items（`unit_price=0`）③ 发通知邮件给 `MAIL_TO` ④ 返回 `{success:true,data:{quote_no}}`。频率限制：同邮箱 10 分钟内最多 3 次，超限 429。 |

Token 生成：`crypto.getRandomValues(new Uint8Array(32))` → base64url（去 `=`）。**不要**把 id 编码进 token。

## 4. 订单 API（`src/api/handlers/orders.js`，导出 `handleOrders`）

挂载前缀 `/api/orders`。全部需登录。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/orders?status=&q=&limit=20&offset=0` | 列表 |
| GET | `/api/orders/:id` | `{data:{...order, items:[], events:[]}}` |
| POST | `/api/orders` | body `{quote_id}`（从报价转订单，复制行、金额、客户信息，报价置 `status='accepted'`）或手工 `{customer_email, items:[...], currency, incoterm, payment_terms, notes, deposit_amount}` |
| PUT | `/api/orders/:id` | 改 `carrier/tracking_no/tracking_url/ship_date/eta/notes/payment_status/deposit_amount/deposit_paid`；`payment_status` 变更写 `order_events(type='payment')` |
| PUT | `/api/orders/:id/status` | body `{status, message?}`；走状态机，非法迁移 400；成功写 `order_events(type='status', from_value, to_value)` |
| POST | `/api/orders/:id/events` | body `{type:'note', message}` 加内部备注 |
| GET | `/api/orders/:id/pdf` | 订单确认单 PDF（Proforma Invoice 风格，含行项目、合计、付款条款、银行信息来自 settings） |
| POST | `/api/orders/:id/checkout` | 创建 Stripe Checkout Session。**未配置 `env.STRIPE_SECRET_KEY` 时返回 400 `{error:'Online payment is not configured', bank_transfer:{...}}`**（前端据此展示 T/T 信息）。配置了则调 `https://api.stripe.com/v1/checkout/sessions`，返回 `{success,data:{url}}` |
| POST | `/api/orders/webhook/stripe` | 校验 `Stripe-Signature`（HMAC-SHA256，格式 `t=...,v1=...`，容差 300 秒），`checkout.session.completed` → `payment_status='paid'` 并写 events。密钥缺失或签名错 → 400 |

状态机（`src/utils/order-state.js`，导出 `ORDER_STATUSES`、`canTransition(from,to)`、`statusLabel(s)`、`nextStatuses(s)`）：

```
placed        → confirmed, cancelled
confirmed     → in_production, cancelled
in_production → ready, cancelled
ready         → shipped, cancelled
shipped       → delivered
delivered     → completed
completed     → (终态)
cancelled     → (终态)
```

单号：`SO-YYYYMMDD-####`，当天计数 +1，补零 4 位。

## 5. 客户门户（`src/api/handlers/accounts.js` 导出 `handleAccounts`；`src/pages/account.js` 导出 `accountPage`）

挂载前缀 `/api/account`，页面路由 `/account`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/account/request-link` | body `{email, lang?}`。若该邮箱在 `quotes`/`orders` 里存在，则建 `magic_tokens`（purpose=login，30 分钟有效）并发信（含 `{SITE}/account/verify?token=xxx`）。**无论邮箱是否存在都返回同一句** `{success:true,message:'If this email has orders with us, a sign-in link is on its way.'}`（防邮箱枚举）。10 分钟内同邮箱最多 3 次。 |
| GET | `/api/account/verify?token=` | 校验并消费 token（`used_at` 置位，只可用一次）；upsert `customer_accounts`；签发客户 JWT 并 `Set-Cookie: cust_session`（用 `customerCookie()`），302 到 `/account?welcome=1` |
| POST | `/api/account/logout` | 清 cookie，302 到 `/account` |
| GET | `/api/account/me` | 需 `requireCustomer`。返回 `{data:{account:{...}, quotes:[...], orders:[...]}}`：报价只返回 `id/quote_no/status/currency/total/valid_until/created_at/token`（`token` 仅在 `status='sent'` 时给，用于跳 `/quote/{token}`）；订单返回 `id/order_no/status/payment_status/currency/total/carrier/tracking_no/tracking_url/ship_date/eta/created_at` |

页面 `/account` 用 `createLayout`：

- 未登录：居中卡片 + 邮箱输入 + 提交按钮 + 文案「No password needed — we'll email you a one-time link.」
- 已登录：欢迎条（含登出）、「Your quotations」表格、「Your orders」表格（订单行可展开看状态时间线，调 `/api/account/me` 里的 events？—— 若接口未返回 events，则只显示状态徽标与物流单号）。
- 所有客户可见文本按 `env.LANG` 本地化（`t()`；缺词条时回退英文即可）。
- 页面 `Cache-Control: private, no-store`（会话相关，绝不能进 CDN 缓存）。

`/account/verify` 与 `/api/account/verify` 同名冲突：**页面路由由主控处理，你只实现 `/api/account/verify`**，
它会 302 到 `/account`，页面路由不需要单独实现 verify 页。

## 6. 前台页面（`src/pages/quote-request.js` 导出 `quoteRequestPage`；`src/pages/quote-view.js` 导出 `quoteViewPage`）

| 路由 | 文件 | 说明 |
|---|---|---|
| `/quote` | `quoteRequest.js` | 询价清单页。支持 `?product=<slug>&qty=10` 预填一行（服务端查 products 取名/图）。含多行编辑器（JS 增删行、小计实时计算）、客户信息、留言、蜜罐字段，提交到 `POST /api/quotes/request`（不走 `API` 封装，因为该页用的是全站 `createLayout` 里的 `API`；用 `API.post('/quotes/request', {...})` 即可 —— 注意 `API` 内部会自己拼 `/api` 前缀）。成功后就地显示 `quote_no` 与「销售会在 1 个工作日内回复」。 |
| `/quote/:token` | `quote-view.js` | 客户查看报价页。服务端直接**查库**渲染（不要服务端 fetch 自己的 API，那是多余的一次往返），需要与 `/api/quotes/view` 相同的字段裁剪逻辑。含 Accept / Request changes / Decline 三个操作，`fetch('/api/quotes/respond', ...)`；已响应过（非 `sent`）则显示只读状态条。`<meta name="robots" content="noindex,nofollow">`，`Cache-Control: no-store`。 |

两页都必须：`lang` 前缀正确（用 `localizedUrl`）、canonical、面包屑。

## 7. 后台交易工作台（`src/pages/admin-trade.js` 导出 `adminTradePage`）

路由 `/admin/trade`（由主控挂载）。风格与 `src/pages/admin-content.js` 保持一致的独立 shell：
左侧栏（Overview / Quotations / Orders / 返回 Dashboard）、顶栏用户名与登出、toast。
读取 `localStorage.admin_token`，无 token 跳 `/admin/login`。

必须实现：

1. **Quotations 列表**：编号、客户、金额、状态徽标、有效期、操作（编辑 / 发送 / PDF / 复制 / 删除）。
2. **报价编辑器**（模态框）：客户信息、币种、Incoterm、付款条款、有效期、折扣、税率、运费、行项目增删（品名/规格/数量/单位/单价，金额实时算）、备注与条款。保存走 `POST/PUT /api/quotes`。
3. **发送报价**：调 `/api/quotes/:id/send`，成功后弹出可复制的客户链接（`{origin}/quote/{token}`）。
4. **Orders 列表**：单号、客户、金额、状态、付款状态、物流单号、操作（详情 / 状态流转 / 录入物流 / PDF）。
5. **订单详情**（模态框）：行项目、金额、状态时间线（`events`）、状态推进按钮（只显示 `nextStatuses` 允许的）、
   物流表单（carrier / tracking_no / tracking_url / ship_date / eta）、付款状态切换、备注追加。
6. **从报价转订单**：报价行上的 `Create order` 按钮 → `POST /api/orders {quote_id}` → 跳订单详情。

所有金额显示 `currency + toFixed(2)`（用 `Intl.NumberFormat`）。所有用户输入进 DOM 前必须转义（页面内有 `esc()` helper）。

## 8. UI 设计系统（仅 `src/pages/layout.js` 的 `<style>` 块）

只允许**在现有 `<style>` 内追加/覆盖 CSS**，以及新增独立的工具类；**不要改动 `createNavbar` / `createFooter` 的 HTML 结构**
（已有 19 项多语言测试依赖语言切换器的选择器与 `hreflang` 属性）。

要求：
- 建立一组可复用类：`.card`、`.card-pad`、`.stack`、`.row`、`.badge`、`.badge-{green,amber,red,blue,gray}`、`.btn-ghost`、`.table`（含 `thead` 底色与斑马纹）、`.field`、`.hint`、`.empty`、`.pill`。
- 移动端：≥768px 两列，<768px 单列；表格在窄屏横向滚动而不撑破布局（`overflow-x:auto` 包裹）。
- 打印：`@media print` 隐藏导航/页脚/悬浮球，去过场阴影，`a[href]::after` 不打印 URL。
- 不引入外部字体/CDN（离线可用、CSP 友好）。
- 保持现有配色变量与暗色兼容（若有）。改完必须保证首页、产品列表、产品详情、新闻、案例、关于、联系、FAQ 八个页面视觉不塌。

## 9. 自检要求（每个代理交付前）

1. `node --check <你写的每个文件>` 全部通过。
2. 若写了纯函数（状态机、金额计算、token 生成、PDF），必须在 `test-artifacts/` 写脚本跑一遍并附结果。
3. 交付时说明：改了哪些文件、新增哪些文件、接口与契约有无偏差、遗留问题。
