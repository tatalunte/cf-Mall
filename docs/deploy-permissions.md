# 上线权限清单（Cloudflare / GitHub）

> 目的：你按这份清单生成最小权限的凭据给我，我用 `scripts/go-live.mjs` 端到端部署上线。
> **在拿到凭据之前，不会执行任何线上写操作**（不建资源、不部署、不推代码）。

---

## 0. 先选部署路径（决定你到底要不要给 GitHub token）

| 路径 | 需要给你的凭据 | 我会做什么 | 适合 |
|---|---|---|---|
| **A. 直接 Wrangler 部署（推荐）** | 只要 `CF_API_TOKEN` + `CF_ACCOUNT_ID` | 建 D1/R2/KV/Queue → 跑迁移 → 写 secrets → `wrangler deploy` → 建超管 | 现在就上线，最快 |
| **B. GitHub + Actions 自动部署** | A 的 CF 凭据 **+** GitHub fine-grained PAT | 推代码到仓库、写 `.github/workflows/deploy.yml`；CF token 存成 repo secrets（建议你自己加） | 以后每次 push 自动上线 |
| **C. Cloudflare Workers Builds（Git 集成）** | 不需要 PAT，但要在 CF 控制台**手动授权 GitHub App** | 配置 Workers Builds 连仓库 | 喜欢 CF 面板里看构建状态 |

**只走 A 的话，GitHub token 完全不用给。** 你若两个都给，我默认按 B 做（代码推 GitHub + 配置自动部署），因为你已经提到 GitHub。

### 本次实际部署（2026-11-08，路径 B）

| 项 | 值 |
|---|---|
| 仓库 | `tatalunte/cf-Mall`（**public**），main 分支，代码 + `.github/workflows/deploy.yml` |
| Worker | `cf-b2b-pro.talunte28.workers.dev` |
| 目标域名 | `xdl.de5.net`（账号里独立的 active zone，DNS 记录原本 0 条） |
| repo secrets | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，已写入 |
| 资源 | D1 `b2b_database`、R2 `b2b-product-images`、KV `STATIC_ASSETS`、Queue ×2，均已创建 |

踩过的两个真实坑（都已写进脚本/流程）：

1. **Account API Token 缺 `D1:Edit`** → `wrangler d1 create` 报 `Authentication error [10000]`，但读操作（`d1 list`）和其它资源写入全部正常，很容易误判成"token 无效"。补 `D1:Edit` 后不需要换 token 值，编辑现有 token 保存即可。
2. **Zone 级权限不给就绑不了自定义域**：`POST /zones/.../dns_records` 返回 10000、`POST /zones/.../workers/routes` 返回 `No access to the specified resource`、`POST /accounts/.../workers/domains`（Custom Domains）返回 `10405 Method not allowed for this authentication scheme`（该 API 要求 user 级认证，Account API Token 用不了）。**结论：绑 `xdl.de5.net` 要么补 `Zone → DNS:Edit` + `Zone → Workers Routes:Edit`，要么在控制台手动点一次 Workers & Pages → cf-b2b-pro → Settings → Domains & Routes → Add Custom Domain。**

`go-live.mjs` 现已支持断点续跑：设 `D1_DATABASE_ID` / `KV_NAMESPACE_ID` 可直接复用已建资源，不依赖 `d1 list --json` 的输出格式；`DRY_RUN=1` 不再改写 `wrangler.toml`（以前会把全 0 假 ID 写进磁盘）。

---

## 1. Cloudflare API Token（路径 A / B 都要）

### 生成位置

Cloudflare Dashboard → 右上角头像 → **My Profile → API Tokens → Create Token**
→ 选 **Create Custom Token**（或从 **Edit Cloudflare Workers** 模板起步再改）。

### 权限项（逐条照抄）

| 类型 | 权限 | 级别 | 为什么必须有 |
|---|---|---|---|
| Account | **Workers Scripts** | Edit | `wrangler deploy` / `wrangler secret put` |
| Account | **D1** | Edit | `wrangler d1 create` + `d1 execute --remote`（建表、写超管） |
| Account | **Workers R2 Storage** | Edit | `wrangler r2 bucket create`（产品图） |
| Account | **Workers KV Storage** | Edit | `wrangler kv namespace create`（站点设置、翻译引擎配置） |
| Account | **Queues** | Edit | `wrangler queues create` ×2（询盘发信 + DLQ） |
| Account | **Account Settings** | Read | 读取账号信息 / 校验 token |

> 这 6 项与 `scripts/go-live.mjs` 顶部注释里的清单一致 —— 脚本实际会依次调用这些命令。

### 按需追加（不给也能上线）

| 类型 | 权限 | 级别 | 什么时候需要 |
|---|---|---|---|
| Zone | **Workers Routes** | Edit | 绑定自定义域名 / routes 时。只用 `*.workers.dev` 不需要 |
| Zone | **Zone** | Read | 查 zone id 时 |
| Zone | **DNS** | Edit | 给 R2 绑 `img.yourdomain.com` 自定义域时 |
| Account | **Workers AI** | Edit | 只有直接调 AI REST API 才需要；本项目用 `[ai]` binding，**不需要** |

> ⚠️ **首次创建 Worker 的权限坑**：Cloudflare 新的 Workers 权限模型里，`Editor` 只能部署**已存在**的 Worker；
> 创建一个全新 Worker 需要 product 级 `Admin`（Full manage）。如果 `wrangler deploy` 报权限不足，
> 二选一：① 临时把 token 的 Workers 权限提到 **Admin**（上线后降回 Editor）；
> ② 你先在控制台 **Workers & Pages → Create → 新建名为 `cf-b2b-pro` 的 Hello World Worker**，之后 Editor 就够。

### 作用域与有效期（安全边界）

- **Account Resources** → `Include` → **只选目标账号**（不要 All accounts）。
- **Zone Resources** → 只在追加 Zone 权限时选目标 zone。
- **TTL**：建议设一个结束日期（比如 7 天），上线后在 API Tokens 页面 **Roll / Delete**。
- **不要**给 Global API Key；**不要**用 "Edit All Resources" 模板；**不要**开 Billing / Memberships / API Tokens 写权限。
- Client IP 过滤先别开：我用的是你本机的出口 IP，开了容易把 wrangler 自己挡掉；上线后可再加。

### 同时告诉我 Account ID

Workers & Pages 概览右侧栏的 **Account ID**（32 位十六进制），或跑 `npx wrangler whoami`。

---

## 2. GitHub 权限（只有路径 B 需要）

### 生成位置

GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens**
→ Generate new token。

### 设置

| 项 | 值 |
|---|---|
| Token name | `cf-b2b-pro-deploy` |
| Expiration | 7~30 天 |
| Repository access | **Only select repositories** → 只选目标仓库 |
| Repository permissions → **Metadata** | Read-only（强制项，自动带） |
| Repository permissions → **Contents** | **Read and Write**（push 代码 / 建分支） |
| Repository permissions → **Workflows** | **Read and Write**（写 `.github/workflows/deploy.yml`） |
| Repository permissions → **Actions** | Read-only（可选，看 workflow 运行状态） |

**不要勾**：Administration、Secrets、Deploy keys、Packages、Pages 写权限。fine-grained PAT 也**不能创建仓库** ——
如果仓库还不存在，请你先在 GitHub 网页建一个**空仓库**（不要勾 README / .gitignore），把 `owner/repo` 告诉我。

> 本次用的是 **classic PAT**（`ghp_` 前缀，scopes 含 `repo / workflow / user / admin:org / …`）。它能直接 `POST /user/repos` 创建仓库，也够写 Actions secrets；但权限面明显过宽，**上线后应立即删除或换成仅 `repo` + `workflow` 的短期 token**。另外 classic PAT 没有 `delete_repo` scope，删仓库会返回 403，需要到网页操作。

### Repo secrets（建议你自己在网页加，我就不需要 Secrets 写权限）

仓库 → Settings → Secrets and variables → Actions → **New repository secret**：

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 上面第 1 节的 token |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Account ID |

> 安全提醒：fork 的 PR 默认拿不到 repo secrets；workflow 里只监听 `push` 到 `main`，不要对 `pull_request` 暴露凭据。

### 如果你选路径 C（Workers Builds）

不需要 PAT，但 CF 侧需要**用户级**（user-scoped）token，权限是
`Workers Builds Configuration: Edit` + `Workers Scripts: Read`；且 GitHub App 授权必须你在
控制台点一次（Workers & Pages → 你的 Worker → Settings → Builds → Connect）。这一步我替不了。

---

## 3. 除 token 之外，还需要你给的值

`go-live.mjs` 的必需 / 可选环境变量：

| 变量 | 必需 | 说明 |
|---|---|---|
| `CF_API_TOKEN` | ✅ | 第 1 节的 token |
| `CF_ACCOUNT_ID` | ✅ | 32 位 Account ID |
| `SITE_URL` | ✅ | 正式域名，带 `https://`，如 `https://www.example.com`。用于 canonical / sitemap / hreflang / CORS；**必须和绑定的自定义域一致** |
| `ADMIN_PASSWORD` | ✅ | 后台超管口令，≥12 位含大小写与符号。脚本会自己算 PBKDF2 哈希，不会打印明文 |
| `RESEND_API_KEY` | 推荐 | 询盘通知邮件。不给的话表单能提交但不发信 |
| `TURNSTILE_SITEKEY` | 推荐 | 前台人机验证公开 key。留占位值时代码会自动不渲染 widget（表单仍可用） |
| `TURNSTILE_SECRET_KEY` | 推荐 | 服务端校验用。没配则人机验证不生效 |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` | 可选 | 默认 `admin` / `admin@<域名>` |
| `MAIL_FROM` / `MAIL_TO` | 可选 | 发件地址（需在 Resend 验证过域名）/ 销售收件箱 |
| `IMAGES_PUBLIC_BASE` | 可选 | R2 自定义域，如 `https://img.example.com`，图片不经 Worker |
| `IMAGE_RESIZE` | 可选 | 设 `1` 开 srcset（需先开 Image Transformations） |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | 可选 | 在线收款；不配走「请联系销售」 |
| `TRANSLATION_SECRET_KEY` | 可选 | 独立加密后台自定义模型 API Key；不给则复用 `JWT_SECRET` |

**不用你给**：`JWT_SECRET` 脚本会生成 32 字节随机值并写进 Worker secret；
D1 / KV / R2 / Queue 的 ID 脚本会创建后自动回填 `wrangler.toml`。

### 平台侧前提

- **R2 需要在 Cloudflare 绑定付款方式**（哪怕只用免费额度），否则 `r2 bucket create` 会失败。
- Workers AI 免费 10,000 Neurons/天；`[ai]` binding 部署时自动生效，不需要单独申请。
- Queues 免费 1 万 ops/天；DLQ 队列会单独创建，否则 deploy 报 `queue not found`。
- 自定义域名需要该域名已接入 Cloudflare（或先用 `cf-b2b-pro.<你的子域>.workers.dev` 上线，之后再绑）。

---

## 4. 我拿到凭据后会执行的命令（可复核）

```bash
# ① 先只打包不部署，确认配置没写错
DRY_RUN=1 CF_API_TOKEN=... CF_ACCOUNT_ID=... SITE_URL=... ADMIN_PASSWORD=... \
  node scripts/go-live.mjs

# ② 正式上线：建资源 → 回填 ID → bootstrap.sql → 写 secrets → 建超管 → wrangler deploy
CF_API_TOKEN=... CF_ACCOUNT_ID=... SITE_URL=... ADMIN_PASSWORD=... \
RESEND_API_KEY=... TURNSTILE_SITEKEY=... TURNSTILE_SECRET_KEY=... \
  node scripts/go-live.mjs

# ③ 线上冒烟（页面 / 登录 / 询盘 / 主题 / 翻译接口）
bash scripts/smoke-test.sh https://你的域名
```

路径 B 额外：

```bash
git remote add origin https://github.com/tatalunte/cf-Mall.git
git -c http.extraheader="AUTHORIZATION: bearer <PAT>" push -u origin main
# PAT 只放在命令里，不写进 .git/config，也不落盘
# 首次 push 到 main 会自动触发 verify → deploy 两个 job；以后每次 push main 自动上线
```

凭据我只放在进程环境变量或已 gitignore 的 `.deploy.env` 里，**不会提交进 git、不会写进文档**。
`go-live.mjs` 会把生成的 `JWT_SECRET` 存到 `backups/deploy-*.json`（已 gitignore）——
这个文件请自己留档，丢了会导致所有后台/客户会话失效。

---

## 5. 上线后我会回报什么

- Worker 访问地址（`*.workers.dev` 或自定义域）与后台超管账号
- 建出来的资源 ID 清单（D1 / KV / R2 / 2 个 Queue）
- `smoke-test.sh` 结果，以及一次真实的「一键生成译文」调用结果
  （默认 Workers AI；若你已在后台配了自定义模型，就按你配的引擎测）
- 需要你手动收尾的两件事：给 `/admin*` 加 **Cloudflare Access**、给域名开 HTTPS/缓存规则
- 建议立即轮换 / 删除临时 API Token
