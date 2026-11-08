# 后台「一键生成译文」（1.4.0）

> 场景：运营用**中文或英文**发布产品 / 新闻，希望一次把其它语种都补齐，而不是每个 Tab 手填。
> 引擎：后台可切换 **Workers AI 内置模型（默认）** 或 **任意 OpenAI 兼容模型**（自带 API Key）。
> 两种引擎共用同一套术语保护、分段、回填与人工审核流程。

---

## 1. 运营怎么用（三步）

1. 后台打开 **Products → 编辑产品**，或 **Content → 新闻 / 案例 / 资质 / FAQ / 工厂实力** 的编辑弹窗。
2. 先把**主表单**（原文）写好。原文可以是中文，也可以是英文、西语、阿语等；工具栏的
   「原文语言」默认是 `自动检测（中文 / English）`，也可手动强制指定。
3. 选写入方式 → 点 **「一键生成译文」**。进度条会按 `(1/4) 正在生成 es …` 逐个语种回填到多语言 Tab，
   **核对一遍译文**（尤其是型号、认证号、SEO 标题），再点 **Save** 才真正入库。

| 写入方式 | 行为 |
|---|---|
| `只补空字段`（默认 / 推荐） | 已有译文的字段直接跳过，不花额度也不覆盖人工润色过的内容 |
| `覆盖已有译文` | 所有字段重新生成并覆盖 Tab 里的值；**保存前仍可手动改回** |

> ⚠️ 生成 ≠ 发布。译文只落在浏览器里的输入框，刷新页面不保存就丢失。
> 这是刻意设计：机器翻译直接入库会把 `HR-CP100`、`ISO 9001`、`DN50` 这类型号译错且没有回滚路径。

原文语种与目标语种相同时不产生任何请求，也不消耗额度。
`中文 → 繁体中文` 永远走本地转换表，**两种引擎下都不调用任何外部模型**。

---

## 2. 选择翻译引擎（后台 Settings → Translation Engine）

### 2.1 两档对比

| | `workers_ai`（默认） | `openai`（自定义） |
|---|---|---|
| 模型 | `@cf/meta/m2m100-1.2b` | 任意，如 `gpt-4o-mini` / `deepseek-chat` / OpenRouter 模型名 |
| API Key | 无，用 Cloudflare 账号鉴权 | 需要，填在后台，**加密后存 KV** |
| 成本 | 免费 10,000 Neurons / 天 | 按上游计费 |
| 数据 | Zero data retention | 取决于上游，取决于你选的服务商 |
| 端点 | 不可配 | 任意 HTTPS `/chat/completions` 兼容端点 |
| 本地 `--local` 开发 | ❌ AI binding 显示 `not supported` | ✅ 可用（走 `fetch`），适合本地先验证链路 |
| 适合 | 日常补译文、够用就好 | 想要更好文风 / 更多语种 / 已有大模型额度 |

### 2.2 配置步骤（超管）

1. Settings → **Translation Engine / 翻译引擎** 卡片，选引擎。
2. 选 `openai` 后填：
   - **API Base URL**：如 `https://api.openai.com/v1`、`https://api.deepseek.com/v1`、
     `https://openrouter.ai/api/v1`、`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai`。
     末尾不要带 `/chat/completions`，程序会自动拼。
   - **Model**：模型 ID，只允许字母数字与 `._:/-`。
   - **API Key**：`type=password` + `autocomplete=new-password`。**留空 = 保持已保存的密钥**；
     已配置时后台只显示「A key is saved (encrypted)」，永不回显明文或密文。
   - **Temperature**：0~1，默认 0.2（越低译文越稳定）。
3. 点 **Save engine settings**。切回 `workers_ai` 会清空端点/模型，但保留密钥方便再切回来。
4. 点 **Test connection** 会用一句固定的英文做一次真实调用，返回模型、延迟和译文片段。
   ⚠️ 这个按钮**会花一次额度/钱**；建议先测再存也可以（测试按当前表单值走，不必先保存）。

### 2.3 密钥是怎么存的（安全边界，改代码前必读）

- `GET /api/settings` 是**公开接口**（前台页脚 / SEO 都在读）。所以所有 `translation_*` 键
  都会从公开响应里**整体剔除**，连密文都不露。密钥只由 super admin 专用接口读写。
- 明文用 **AES-GCM** 加密后落 KV，格式 `enc:v1:<iv>.<ciphertext>`；密钥由
  `TRANSLATION_SECRET_KEY`（推荐）或既有的 `JWT_SECRET` 派生。换掉这个 secret 后旧密钥会失效，
  后台会显示「未配置」，重新填一次即可。
- 超管 GET 只回 `api_key_set: true/false`，**不回明文、不回密文**。
- 保存时传空字符串 / 掩码 / `__KEEP__` = 保持原密钥；`clear_api_key: true` 才删除。
- `requireSuperAdmin` 守住三个配置接口，普通管理员连按钮都是 disabled。

### 2.4 端点限制（SSRF 防护）

自定义 base_url 是典型的 SSRF 入口：一个管理员填内网地址就能让 Worker 去打内部服务。
服务端强制校验（`src/utils/translation-config.js` 的 `normalizeBaseUrl`）：

- 只接受 **https**；只允许 **443**（或不写端口）；
- 只接受**公网域名**，拒绝一切 IP 字面量（含 IPv4 私有段 / IPv6 / `169.254.169.254` 元数据）、
  `localhost` / `*.local` / `*.internal`；
- 拒绝 URL 内嵌账号密码、查询参数、锚点；
- 调用超时 20s，上游错误体截断到 300 字符再回显（不会带出 `Authorization`）。

本地 Ollama / vLLM 这类只有 `http://localhost` 的服务，请自己套一层 HTTPS 反代
（Cloudflare Tunnel 亦可）再填进来。

### 2.5 配置 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/settings/translation` | super admin | 返回 `{engine, base_url, model, api_key_set, temperature}` |
| POST | `/api/settings/translation` | super admin | 保存；非法端点 400，缺 key 400 |
| POST | `/api/settings/translation/test` | super admin | 测试连接；200 或 502（带可读 error） |

### 2.6 Workers AI 的部署前提

`wrangler.toml` 已加好绑定（在所有 `[vars]` 键**之后**）：

```toml
[ai]
binding = "AI"
```

| 项 | 说明 |
|---|---|
| 线上 | `npm run deploy` 后绑定自动生效，无需额外建资源 |
| 本地开发 | **`wrangler dev --local` 下 AI binding 是 `not supported`**：只有 `zh → zh-TW` 纯本地转换能跑。要跑真实模型用 `npx wrangler dev --remote`（先 `npx wrangler login`）或直接部署；也可切到自定义 OpenAI 引擎在本地验证 |
| 额度 | AI 永远访问远程资源，即使 `--remote` 本地调试也计入 10,000 Neurons/天 |

**TOML 坑（本项目实际踩过）**：`[ai]` 是 TOML table，放在 `[vars]` 中间会**结束 vars 表**，
后面的 `TURNSTILE_SITEKEY` / `MAIL_TO` / `MAIL_FROM` / `AUTO_REPLY` 会被静默解析进 `[ai]`，
表现为「后台设置读不到邮件配置」。改完用
`python -c "import tomllib;print(tomllib.load(open('wrangler.toml','rb'))['vars'].keys())"` 核一遍。

可选：单独设一个加密密钥，避免轮换 `JWT_SECRET` 时把模型密钥一起弄失效：

```bash
npx wrangler secret put TRANSLATION_SECRET_KEY   # 32+ 字节随机串
```

---

## 3. 数据流

```
主表单原文
   │  autoDetect: 汉字数 vs 拉丁字母数 → zh / en（不猜简繁）
   ▼
前端 autoTranslate()  —— 对每个非默认语种【串行】发一次 POST /api/translate
   │                       body: { sourceLang, target, fields, mode, existing }
   ▼
handleTranslate()
   ├─ requireAuth()                     匿名 401，额度不能被白嫖
   ├─ 语言白名单校验                    必须在 SUPPORTED_LANGS 内，否则 400
   ├─ loadTranslationConfig(includeSecret)  ← KV，解密密钥（仅服务端）
   ├─ buildEngine()                     workers_ai / openai / local-zh-tw
   ├─ fill 模式跳过已有译文
   ├─ 每个字段：保护术语 → 按 600 字分段（≤5 段）→ 逐段调引擎 → 还原术语 → 拼接
   └─ 返回 { translations, skipped, failed, engine }
   ▼
前端回填 #tr-{lang}-{field} / [data-tr-lang][data-tr-field]，点亮 Tab 绿点，同步 JSON 预览
   ▼
【人工核对】 → 点 Save → 既有保存逻辑经 toJsonColumn() 写入 D1 的 translations TEXT 列
```

**关键**：`/api/translate` 全程不碰 D1，写入侧仍然只有原来的 `toJsonColumn()` 一条路径。
本项目踩过 `translations` 被双层 `JSON.stringify` 导致前台静默回退英文的坑，新增功能绝不另开写入口。
引擎切换只换「文本 → 译文」这一段，术语保护 / 分段 / 简繁 / 回填全部共用。

---

## 4. API 契约：`POST /api/translate`

需管理员 token；在 `/api/settings` 之前注册的精确路径。

```jsonc
// 请求
{
  "sourceLang": "zh",              // 或 en/es/ar/zh-TW，必须是 SUPPORTED_LANGS 之一
  "target": "es",                  // 一次只翻一个目标语种
  "mode": "fill",                  // fill | overwrite
  "fields": { "name": "不锈钢离心泵 HR-CP100", "description": "…" },
  "existing": { "name": "人工润色过的西语名" }   // fill 模式下该字段会被 skip
}

// 200
{
  "success": true,
  "data": {
    "translations": { "description": "Bomba centrífuga…" },
    "skipped": ["name"],
    "failed": [],
    "engine": "@cf/meta/m2m100-1.2b",   // 或 openai:gpt-4o-mini / local-zh-tw / none
    "target": "es",
    "sourceLang": "zh"
  }
}
```

| 状态 | 含义 |
|---|---|
| `401` | 未登录 / token 失效 |
| `400` | JSON 非法、语言不在白名单 |
| `405` | 非 POST |
| `503` | 引擎不可用（本地 AI 未绑定 / 自定义配置不完整），`error` 里给具体原因 |
| `502` | 所有待翻字段都失败（额度耗尽 / 限流 / 上游 5xx），后台提示「稍后重试」 |

限额：单请求最多 **12 个字段**、单字段 **4000 字符**；字段名只允许 `[a-z_]`，防止前端塞任意键烧额度。
单个字段失败不影响其它字段，失败字段名回传给前端。

---

## 5. 为什么这么设计（改代码前先读）

1. **不并发打模型**。Workers AI 有速率限制（错误码 7505），第三方也有 RPM/TPM 限制；
   这里全部串行。耗时主要是 I/O 等待，**不计入**免费 Worker 的 10ms CPU 预算。
2. **一次请求一个语种**。`en,es,ar,zh,zh-TW` 全塞进一次请求，模型对长文有长度上限，
   免费版单请求容易超时；前端串行 4 次并显示进度，失败一个语种不影响其它三个。
3. **术语保护**。调用模型前把 URL、邮箱、认证号（`ISO 9001` / `CE` / `API 6D`）、
   型号、DN/PN、数值与单位换成 `__B2BK0__` 占位符，翻译完再还原。
   正则在 `src/utils/translate.js` 的 `KEEP_PATTERNS`；自定义引擎的 system prompt 里
   也明确要求「占位符原样保留」，双保险。
4. **zh-TW 不走普通翻译**。m2m100 只有 `zh`，不区分简繁：
   - `中文 → 繁中`：**纯本地**简繁 + 台湾技术/商业用词转换（`软件→軟體`、`不锈钢→不鏽鋼`、
     `网络→網路`），不调模型、不花钱、也不会改写型号，`engine: 'local-zh-tw'`；
   - `英文/西语/阿语 → 繁中`：先让模型翻成简体中文，再本地转繁体。
5. **自动检测只分中/英**。曾经用「繁体特征字」猜简繁，结果「新产**品**」里的「品」被当成繁体特征误判。
   现在只按汉字/拉丁字母比例判 `zh` / `en`；原文确实是繁体时，运营在下拉里手动选「繁體中文」。
6. **长文分段**。seq2seq 模型对超长输入会截断，`splitText()` 按句子边界切 600 字、最多 5 段，
   逐段翻译后拼接，避免「详细描述后半段消失」。
7. **密钥绝不进前端渲染**。公开 KV 接口过滤、超管接口只回布尔值、密码框 `new-password`、
   DOM 里搜不到明文 —— 四条一起才敢把「后台填 API Key」这件事做出来。

---

## 6. 可翻字段

**产品**（`src/pages/admin-dashboard.js` 的 `SRC_FIELD_IDS`）：
`name`、`description`、`detailed_description`、`specifications`、`seo_title`、`seo_description`。

**内容**（`src/content-schema.js` 的 `transFields`，5 类）：

| 类型 | 字段 |
|---|---|
| 新闻 `posts` | title, excerpt, content, seo_title, seo_description |
| 案例 `cases` | title, summary, content |
| 资质 `certifications` | name |
| FAQ `faqs` | question, answer |
| 工厂实力 | title, description |

品牌 `brands` 没有 translations 配置，工具栏会自动隐藏。

> 新增语言：改 `src/i18n.js` 的 `DICT` / `LANG_META` + `wrangler.toml` 的 `SUPPORTED_LANGS`，
> 后台 Tab 与 `sourceOptions` 自动跟着变；还要在 `src/utils/translation-engine.js` 的
> `LANG_LABELS` 加一条（自定义引擎的 system prompt 用），并确认 Workers AI 的
> `M2M_LANG` 映射（`src/utils/translate.js`）支持该语种。

---

## 7. 术语表（可选）

在 KV 的 `website_settings` 里加 `translation_glossary`，最多 100 条，按 `src` 长度倒序匹配：

```json
[
  { "src": "Hengrui", "keep": true },
  { "src": "恒瑞", "dst": "Hengrui", "keep": false },
  { "src": "HR-CP100", "keep": true }
]
```

- `keep: true` → 原样保留（品牌名、型号）；
- `keep: false` + `dst` → 先替换成指定写法再翻译，且该写法同样被占位保护。

适合「公司名 / 系列名 / 客户指定的产品叫法」。KV 不可用或格式不对时按空表处理，不影响主流程。
注意这个键同样以 `translation_` 开头，不会出现在公开 `/api/settings` 响应里。

---

## 8. 测试

```bash
npm run test:translate   # 29 项：纯逻辑（简繁、术语、分段、字段清洗）+ 翻译 API 契约
npm run ui:translate     # 21 项：产品 + 新闻弹窗的一键生成流程（mock 后端）
npm run test:engine      # 53 项：URL/SSRF、AES-GCM 加解密、公开过滤、OpenAI 兼容调用、配置 API 契约
npm run ui:engine        # 23 项：后台引擎设置卡片（切换/保存/测试/失败提示/密钥不回显）
npm run test:all         # 14 套已全部纳入；ui-audit 仍是最后一道
```

所有测试**不产生真实模型调用**：`ui:translate` / `ui:engine` 用 `page.route` mock，
`test:engine` 用内存 mock fetch，真实 `zh → zh-TW` 路径走本地 HTTP（纯本地引擎）。
需要真实模型验证时，用后台的 **Test connection**，或本地切到自定义 OpenAI 引擎点一次生成。

`test:engine` 里会写 KV 的用例**只在当前没有保存过密钥时执行**，并在末尾恢复成
`workers_ai` + 无密钥，不会覆盖你真实的模型配置。

---

## 9. 排错

| 现象 | 原因 / 处理 |
|---|---|
| 后台提示「Workers AI 不可用」（503） | 本地 `--local` 模式本就不支持 AI → 换 `wrangler dev --remote`（先 login）、部署，或切到自定义 OpenAI 引擎；线上检查 `[ai]` 表是否在 `[vars]` 之后 |
| 后台提示「自定义模型配置不完整」 | 三件套缺一：Base URL / Model / API Key。去 Settings 补，或切回默认引擎 |
| Test connection 返回 401 / 404 | Key 不对，或端点没按 `/v1` 形式填（程序会自动拼 `/chat/completions`）；OpenRouter / AI Gateway 的路径要写到兼容前缀为止 |
| 提示「API Base URL 必须是公网域名」 | SSRF 校验生效：不接受 IP / localhost / 内网 / 非 443 / http。本地模型请套 HTTPS 反代 |
| 全部字段失败（502） | 额度用尽、限流、上游 5xx；等次日 / 分批 / 换模型。`failed` 数组会列出字段名 |
| 只有繁中能生成、西/阿语全失败 | 符合预期：`zh → zh-TW` 是纯本地引擎，其它语种需要可用的外部引擎 |
| 译文少了开头第一个词 | 已修：旧版剥 markdown 代码块的正则把 `` ```Bomba de prueba``` `` 里的 "Bomba" 当语言标签吃了 |
| 译文里型号被改写 | 把型号加进 `translation_glossary` 的 `keep: true`，或检查 `KEEP_PATTERNS` 是否覆盖该格式 |
| 保存后前台仍显示英文 | 不是翻译的问题，是 `translations` 被双层 JSON 编码。写入必须走 `toJsonColumn()`，见 `src/utils/json.js` |
| 换过 `JWT_SECRET` 后模型密钥失效 | 重新在后台填一次 API Key（推荐改设独立的 `TRANSLATION_SECRET_KEY`） |
| 繁中译文是简体字 | 检查 `target` 是否真的传了 `zh-TW`；`SUPPORTED_LANGS` 里 `zh-TW` 带连字符，解析路径时不要被 `/` 切掉 |
| 原文是繁体却按简体处理 | 自动检测不猜简繁，在「原文语言」下拉手动选「繁體中文」 |
| 长时间无响应 | 4 个语种 × 多字段本来就是串行；看进度条 `(n/4)`。不要在页面上连点按钮 |

---

## 10. 已知取舍

- 这是**草稿级机翻**，不是本地化。SEO 标题、营销话术、阿语 RTL 排版仍建议人工过一遍。
- 模型对中英混排的技术规格书表现一般，术语表能救一部分；自定义大模型通常比 m2m100 好。
- 图片里的文字、PDF 规格书**不翻**；只处理 D1 里的文本字段。
- 免费版 Worker 的 10ms CPU 不影响本功能（等待模型是 I/O），但单请求仍不宜塞超长文本，
  所以有 4000 字符 / 5 段的上限。
- 自定义引擎的密钥存在 KV 里（已加密）。若你的合规要求「密钥只能放 secret 环境变量」，
  请改用 `wrangler secret put TRANSLATION_API_KEY` 并让 `loadTranslationConfig` 优先读 env ——
  后台填写的便利性会相应失去。
