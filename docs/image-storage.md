# 图片存储优化方案（Cloudflare R2）

> 适用：本项目的产品图、案例封面、新闻封面、证书图。
> 结论先说：**现在这套 R2 方案不缺存储，缺的是"不要用 Worker 转发图片"和"不要只出一档尺寸"。**
> 前一件是架构问题（会影响 Worker 免费额度），后一件是流量问题（手机白下 3 倍像素）。

---

## 一、现在的链路，以及三个隐性成本

```
后台上传 → POST /api/upload/image → R2（key = products/<时间戳>-<随机>.png）
前台展示 → GET  /api/upload/image/products/xxx.png → Worker 读 R2 → 回给浏览器
```

能跑，但有三个成本不会出现在 R2 账单上：

| 隐性成本 | 具体表现 | 量级 |
|---|---|---|
| **Worker 请求数** | 每张图都算一次 Worker 调用 | 免费版 10 万/天。100 张图 × 1000 PV/天 = 10 万，一天就打满 |
| **Worker CPU 时间** | 读 R2 + 转发流要走 Worker 的 10ms CPU 预算 | 图片多时并发一高，请求被限流 |
| **流量浪费** | 卡片位 360px 宽，下载的是 1000px 的原图 | 移动端图片体积约为实际需要的 3-4 倍，直接拖 LCP |

---

## 二、四层优化（按性价比排序）

### L0 —— 已经做完，不用再动

| 措施 | 状态 | 位置 |
|---|---|---|
| 上传前浏览器端压缩（长边 1600px → WebP 0.82） | ✅ 已实现 | `src/pages/admin-dashboard.js` `compressImage()` |
| 5 MB 上限 + 文件头魔数校验（不信任 `Content-Type`） | ✅ 已有 | `src/api/handlers/upload.js` |
| `Cache-Control: public, max-age=31536000, immutable` | ✅ 已有 | 同上 + `src/api/handlers/static.js` |
| 列表图 `loading="lazy" decoding="async"` + 宽高（防 CLS） | ✅ 已有 | `src/pages/product-card.js` |
| 详情主图 `fetchpriority="high"` + 宽高 | ✅ 已有 | `src/pages/product-detail.js` |
| 破图兜底（`onerror` → 内置 SVG 占位图） | ✅ 已有 | `src/pages/static.js` |
| 演示图零依赖生成（不依赖外部图床） | ✅ 已有 | `scripts/lib/png.mjs` |

### L1 —— 建议马上做：给 R2 绑自定义域

这是**投入最小、收益最大**的一步，10 分钟。

```
Cloudflare 控制台 → R2 → 你的桶 → Settings → Public access → Custom domain
绑定 img.yourdomain.com（同账号同 zone，自动配好 DNS 和证书）
```

然后设一个变量就完成切换：

```toml
# wrangler.toml
IMAGES_PUBLIC_BASE = "https://img.yourdomain.com"
```

代码已支持（`src/api/handlers/upload.js`）：配了就返回直链
`https://img.yourdomain.com/products/1794127918746-dd130fe5.png`，
没配就还是 `/api/upload/image/...` 的 Worker 代理。

**收益**：图片请求完全不经过 Worker —— 不占请求数、不吃 CPU、少一跳，延迟通常降 30-60ms。

**注意**：切换后老图仍然是 `/api/upload/image/...` 的地址（存在 D1 的 `image_url` 字段里）。
两条路径会共存，不影响显示。想统一的话跑一次迁移脚本把 `image_url` 的域名换掉即可，不是必须。

### L2 —— 建议做：一图多尺寸（响应式）

前提：在 Cloudflare 控制台开通 **Image Transformations**（免费版就有，见下方成本）。

开通后把 `IMAGE_RESIZE` 设为 `"1"`：

```toml
IMAGE_RESIZE = "1"
```

`src/utils/image.js` 就会给产品图输出 srcset：

```html
<img src="/api/upload/image/products/x.png"
     srcset="/cdn-cgi/image/width=400,quality=82,format=auto/api/upload/image/products/x.png 400w,
             /cdn-cgi/image/width=800,quality=82,format=auto/api/upload/image/products/x.png 800w,
             /cdn-cgi/image/width=1200,quality=82,format=auto/api/upload/image/products/x.png 1200w"
     sizes="(max-width: 640px) 92vw, (max-width: 1100px) 45vw, 360px"
     loading="lazy" decoding="async" width="600" height="450">
```

`format=auto` 会按浏览器的 `Accept` 头自动给 AVIF / WebP —— 比手工转格式省事，且转换结果有 CDN 缓存。

**为什么默认关着**：没开通 Transformations 就输出 `/cdn-cgi/image/`，图片会直接裂。
这就是为什么做成开关而不是默认开启。

### L3 —— 可选：命名规范、孤儿清理、防盗链

**命名规范**（现在已经是 `products/<时间戳>-<随机>.png`，可以再加一层业务前缀）：

```
products/2026/11/hr-cp100-01.webp
cases/2026/chile-water-utility-cover.webp
news/2026/canton-fair-booth.webp
tmp/                      ← 未保存的草稿图，定期清理
```

好处：R2 控制台能按目录翻；生命周期规则能只对 `tmp/` 生效。

**孤儿图片清理**（产品删了、图还留在 R2）：
本项目产品是软删除，所以图一般还有引用；但如果运营反复上传再换图，`products/` 下会积累没人引用的对象。
建议每月跑一次对账：

```sql
-- D1：拿出所有还在用的图片 key
SELECT image_url FROM products WHERE image_url IS NOT NULL
UNION SELECT cover_image FROM posts WHERE cover_image IS NOT NULL
UNION SELECT cover_image FROM cases WHERE cover_image IS NOT NULL;
```

和 R2 的对象列表做差集，超过 30 天没人引用的删掉。

**防盗链**：R2 自定义域不支持 Referer 白名单，需要的话套一层 Worker 或用 Cloudflare 的 WAF 规则。
对外贸站通常不必——产品图本来就希望被 Google 图片搜索和客户转发。

---

## 三、成本测算（按 2026 年官方定价）

| 场景 | 图片数 | 存储 | 变换次数/月 | 月成本 |
|---|---|---|---|---|
| 演示站 / 小站 | 40 | 20 MB | 120（40×3 档） | **$0** |
| 中等站 | 500 | 250 MB | 1,500 | **$0** |
| 较大站 | 3,000 | 1.5 GB | 9,000（超出 4,000） | **≈ $2.00** |
| 大站 | 20,000 | 10 GB | 60,000（超出 55,000） | **≈ $27.50** |

定价依据：

- **R2**：10 GB 存储免费，超出 $0.015/GB/月；**出口流量永久免费**；A 类操作 100 万次/月免费。
- **Image Transformations**：免费版每月 **5,000 次唯一变换**；超出后新的变换返回 `9422` 错误（**不扣费，但图会裂**）。
  付费版 $0.50 / 1,000 次。
- **唯一变换按 30 天滑动窗口计**：同一个「原图 + 同一组参数」30 天内只算一次，所以稳态成本远低于首月。
- **Cloudflare Images（托管）**：$5 / 10 万张存储 + $1 / 10 万次交付。**本方案不需要**——
  同样 20,000 张图，R2 只要 $0（10 GB 以内），Images 要 $5/月，而且我们已经有 R2 了。
  只有当你要 signed URL、Direct Creator Upload 这类能力时才值得换。

> 数字以 Cloudflare 官方定价页为准，这里给的是量级判断：**日常站点基本都在免费额度内，
> 只有上千个 SKU 且每张都要多档尺寸时才需要关注 $0.50/1000。**

---

## 四、七个坑（都是踩过的）

1. **单文件 25 MiB 天花板**。R2 单个对象没问题，但 Pages / Workers 静态资源单文件限 25 MiB。
   产品图经 Worker 代理不受此限，但**不要把大图打进代码包**。
2. **`/cdn-cgi/image/` 只认同域路径**。图片放在 `img.other-domain.com` 且没配 remote 白名单，
   套上变换必然 404。`variantUrl()` 里已经只处理 `/` 开头的路径，就是为了防这个。
3. **换图后旧 URL 不会自动失效**。`image_url` 存在 D1 里，图片对象在 R2 里，两者没有外键。
   后台换图只是把字段指向新 key，旧对象要等清理脚本处理。
4. **文件名别用中文**。虽然 R2 支持，但 URL 编码后在部分邮件客户端和旧浏览器里会出问题；
   上传接口已经强制用「时间戳 + 随机串 + 校验过的扩展名」重命名，不要改回原文件名。
5. **`Cache-Control` 必须是 immutable**。key 里带时间戳和随机串，内容永不变化；
   不加 `immutable` 浏览器仍会发条件请求，白跑一趟 RTT。
6. **EXIF 会泄露拍摄位置**。浏览器端 canvas 压缩会丢掉 EXIF（这是好事），但如果运营直接填外链，
   EXIF 会跟着走。要严谨的话在上传接口加一道 EXIF 剥离。
7. **演示数据的图片会重复上传**。`scripts/seed-demo.mjs` 已经做了本地缓存（`.demo-images.json`），
   同一张演示图只进 R2 一次；否则每跑一次种子脚本就往桶里多塞 39 个孤儿对象。

---

## 五、代码位置索引

| 想改什么 | 改哪里 |
|---|---|
| 上传大小上限、允许格式、魔数校验 | `src/api/handlers/upload.js` |
| 图片直链域名（走不走 Worker） | `wrangler.toml` → `IMAGES_PUBLIC_BASE` |
| 响应式 srcset 开关 | `wrangler.toml` → `IMAGE_RESIZE`，逻辑在 `src/utils/image.js` |
| 上传前压缩参数（长边 / 质量） | `src/pages/admin-dashboard.js` → `compressImage()` |
| 破图占位图 | `src/pages/static.js` |
| 演示图生成 | `scripts/lib/png.mjs` |

---

## 六、立刻可做的三件事

1. R2 绑一个 `img.` 子域，把 `IMAGES_PUBLIC_BASE` 填上 → 图片不再吃 Worker 额度。
2. 控制台开通 Image Transformations，`IMAGE_RESIZE="1"` → 移动端图片体积降 50-70%。
3. 上线前跑 `node scripts/ui-audit.mjs` → 里面有「坏图页」一项，任何图片 404 都会被抓出来。
