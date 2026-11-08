# 手工测试指南（自己点一遍）

> 目的：不用看代码，按这份清单从「访客」一路点到「客户下单」，再进后台当运营改东西。
> 全程约 40 分钟。发现问题时按最后一节的格式记下来就行。

---

## 0. 先把站跑起来

```bash
cd cf-b2b-pro

# 第一次用（或换过电脑）：建演示账号，必须先停 dev server
npm run seed:prepare

# 起服务（这个终端放着别关）
npm run dev

# 另开一个终端，灌演示数据
npm run seed
```

打开 http://127.0.0.1:8787

| 入口 | 地址 | 账号 |
|---|---|---|
| 前台 | http://127.0.0.1:8787/ | 无需登录 |
| 后台 | http://127.0.0.1:8787/admin/login | `demo` / `Demo2026!b2b` |
| 客户门户 | http://127.0.0.1:8787/account | 用邮箱收魔法链接 |

演示数据：12 个产品（5 个分类）/ 4 个案例 / 5 篇新闻 / 8 条 FAQ / 8 条询盘 / 3 张报价单 / 1 张订单 / 6 条订阅。

> 想推倒重来：停掉 dev server → `npm run seed:reset` → `npm run dev` → `npm run seed`。约 15 秒回到干净状态。

---

## 1. 前台：当访客逛一圈

- [ ] 首页四块内容都有东西：分类入口、精选产品、案例、新闻 —— 没有「No products」空态
- [ ] 顶部导航 6 个链接都能到，且**点完地址栏和标题对得上**（不是每个页面都叫同一个 title）
- [ ] `/products` 搜索框输入 `pump` → 只剩泵类；清空 → 恢复 12 个
- [ ] `/products` 左侧「Category」下拉选 Pumps → 只剩 4 个；选回 All → 恢复
- [ ] `/products/stainless-steel-centrifugal-pump-hr-cp100` 进来：主图能显示、图库 4~5 张小图能点切换、规格表有数据、页脚有「相关产品」
- [ ] 详情页点「Request a Quote」→ 弹窗打开 → **什么都不填直接提交，应被拦下**（不能静默成功）
- [ ] 正常填姓名 / 邮箱 / 数量提交 → 出现成功提示
- [ ] `/contact` 表单提交 → 成功提示；地址、邮箱、电话、营业时间都是演示数据里的值（不是 `123 Business Street`）
- [ ] `/contact` 页面下方社交图标：演示数据配了 LinkedIn，应只出现 1 个，点开是新窗口
- [ ] `/faq` 点标题能展开 / 收起
- [ ] `/news` 点进任意一篇 → 正文有排版（标题、列表、加粗都正常）
- [ ] `/about` 有工厂数据（成立于 2008 / 180+ 员工 / 42 国 / 30 万台年产能）
- [ ] `/quote` 加两行产品、改数量 → 小计和总计跟着变；删一行 → 计数从 `2 ITEMS` 变 `1 ITEM`；提交后拿到 `QT-...` 单号
- [ ] 随便输一个不存在的地址（如 `/products/nope`）→ 404 页面，且有「返回首页」
- [ ] 右上角语言切到 ES → 地址变 `/es/...`，文案变西语，**切完还在当前页**（不是回首页）；切 AR → 整页从右往左排版

## 2. 客户侧：报价确认 → 门户

- [ ] 打开这封「已发送」报价的客户确认页：
      http://127.0.0.1:8787/quote/iKS4bRGZV0WZaDxjb4vRA22qjju4poBWU5qK1_kajZU
      页面有公司名、明细、合计；三个按钮 Accept / Request changes / Decline 都在
- [ ] 点 **Accept** → 状态变成已接受，并提示已通知销售
- [ ] **再刷新一次同一个链接** → 应提示「已响应过」，不会重复接受（token 一次性）
- [ ] 打开已接受的那张（同样应提示已响应）：
      http://127.0.0.1:8787/quote/sZD_ftRuRV4hJK8fD0JMjqRLZWJW0buRu5VIV0CrGLI
- [ ] `/account` 输入 `ahmed.alfarsi@acme-trading.example` → 提示「如果该邮箱存在，我们会发链接」
- [ ] 输入一个不存在的邮箱 → **必须得到同一句话**（不能暴露邮箱是否注册过）
- [ ] （可选，要在终端里拿链接）本地没配 Resend，邮件不会真发。用这条命令读魔法链接：
      ```bash
      npx wrangler d1 execute b2b_database --local --command="SELECT token, expires_at FROM magic_tokens ORDER BY id DESC LIMIT 1"
      ```
      然后访问 `http://127.0.0.1:8787/account/verify?token=...`，能看到自己的报价与订单

> 第 2 节会把那张报价「用掉」。想重测：`npm run seed:reset` → `npm run dev` → `npm run seed`，会生成新的 token。

## 3. 后台：当运营改东西（重点看「改了前台有没有变」）

登录 `/admin/login`（`demo / Demo2026!b2b`）。

**概览 Overview**
- [ ] 产品数 12、询盘数 8、待跟进、客户数都是有意义的数字（不是 0、不是 NaN）
- [ ] 最近登录列表有记录

**Products**
- [ ] 列表 12 行，状态都是 Active
- [ ] 「Add Product」→ 填名称、价格、分类、上传一张图 → 保存 → 列表出现；前台 `/products` 也能看到
- [ ] 编辑刚建的产品 → 改名称 → 保存 → 列表和前台都变了
- [ ] 点 Delete → **行还在，但变成 Inactive，并出现 Restore 按钮**（软删除，不是消失）
- [ ] 点 Restore → 回到 Active
- [ ] 上传大图（随便找张 3~5 MB 的）→ 上传后提示里有「Optimised xxx → xxx」
- [ ] 「Export CSV」能下载，用 Excel 打开中文不乱码；改一行再「Import CSV」能更新而不是新建重复

**Inquiries**
- [ ] 刚才前台提交的询盘在这里出现，来源带了 UTM（google / cpc 之类）
- [ ] 点进去：客户信息、原文、意向等级、状态、跟进日期、内部备注都能改
- [ ] 改意向等级 → 右侧时间线自动多一条记录（操作人是 demo）

**SEO**（这块是这一版新加的）
- [ ] 7 个页面各有一个折叠块，展开后能填 title / description / og:image
- [ ] 改首页 title → 保存 → 打开前台 `/`，浏览器标签页标题立刻变（不用重启）
- [ ] 下方 SERP 预览会实时显示你填的内容；标题超过 60 字变红
- [ ] 点「Reload」能读回刚才存的值
- [ ] 页面底部 `sitemap.xml` 链接能打开，里面 URL 都带 `<lastmod>`

**Content**
- [ ] 新闻 / 案例 / FAQ 三个类型能切换，列表有数据
- [ ] 新建一篇新闻 → 前台 `/news` 立刻出现；编辑能改回来

**Quotes & Orders**
- [ ] 左侧切到 Quotations，能看到 3 张报价；点 PDF 能下载，打开后**付款区印着 Beneficiary / Bank / Account / SWIFT**（这是这一版修的 bug，之前是「contact sales」）
- [ ] 把一张 draft 报价点 Send → 状态变 sent
- [ ] 点「转为订单」→ 生成 `SO-...` 单号；在 Orders 里能看到，能推进状态（确认 → 生产 → 发货）
- [ ] 下载订单 PDF，同样是 Proforma Invoice 版式、带银行信息

**Settings**（这一版补了营业时间和收款账户）
- [ ] 改电话 → 保存 → 前台任意页页脚电话变了
- [ ] 改 Business Hours（一行一条）→ 保存 → `/contact` 的营业时间跟着变
- [ ] 填 Bank Name / Account / SWIFT / Beneficiary → 保存 → 再下一次订单 PDF，刚才填的银行信息印上去了
- [ ] 清空银行四项 → 保存 → PDF 回到「contact sales for bank details」
- [ ] WhatsApp 号码填上 → 前台右下角出现悬浮球
- [ ] 非超管账号（如另建的 staff）登录后，设置页输入框是灰的、保存按钮不可点

**退出**
- [ ] 点 Logout → 回到登录页；直接访问 `/admin/dashboard` 应被弹回登录页

## 4. 手机尺寸

浏览器 F12 → 设备模拟 → iPhone SE（375px），六个页面各看一眼：
`/`、`/products`、产品详情、`/contact`、`/quote`、`/admin/dashboard`
- [ ] **都不出现左右横向滚动条**（这一版修了 contact 页溢出 71px 的问题）
- [ ] 导航能展开，文字不被裁

## 5. 一条命令自动体检（不想手点就靠它）

```bash
npm run audit
```

跑完打开 `test-artifacts/audit-report.html`：顶部是结论色块，然后依次是
死链表（应为空）、sitemap 校验表、每个页面的健康度、29 个交互场景的通过情况。

**当前基线**：抓取 100+ 页 · 死链 0 · sitemap 坏链 0 · 控制台错误页 0 · 坏图页 0 · 交互场景 29/29。
它测不到的：视觉美观、文案是否地道、真实邮件到达率、真实支付。

---

## 6. 发现问题怎么记

按这五行发给我就行，比「有个地方坏了」有效十倍：

```
页面：/products
操作：点 Request a Quote → 填邮箱 → 提交
期望：出现成功提示
实际：按钮变灰卡住，控制台报 500
截图/报错：api/inquiries 返回 {"error":"..."}
```

浏览器 F12 的两个地方最有用：**Console**（红字）和 **Network**（红色那条点开看 response）。
截图直接拖进对话框，我能看到。

---

## 7. 几个「看起来像 bug、其实是设计」的点

| 现象 | 原因 |
|---|---|
| 后台点了 Delete，产品还在列表里 | 软删除（`is_active=0`），为了订单能追溯历史产品。要真删先下架再 `?purge=1` |
| 已转订单的报价删不掉 | 故意的：订单要能追溯金额来源，会返回 409 |
| PDF 里中文变 `?` | 自研 PDF 只支持 WinAnsi；中文单据走 `/quote/<token>` 打印页 Ctrl+P |
| 本地提交表单没收到邮件 | 没配 `RESEND_API_KEY`，询盘会落库但 `mail_status=failed`，属预期 |
| 报价链接第二次打开提示已响应 | 魔法链接一次性消费，防重复接受 |
| 图片走 `/api/upload/image/...` 而不是域名直链 | 没配 `IMAGES_PUBLIC_BASE`，退回 Worker 代理模式 |
