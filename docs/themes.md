# 主题系统（Theme）

> 一句话：**六套配色 + 一个「夜间·跟随系统」，访客一键切换，运营在后台设默认值，改一行变量就能加配色。**

## 1. 为什么不是「一个暗色开关」

外贸站的客户是不同行业：卖泵阀的和卖仪器仪表的，买家对「专业」的心理预期完全不同。
一个蓝白站卖给做水处理的没问题，拿去卖 PLC 控制柜就显得廉价。

所以这里做的不是「亮/暗」二选一，而是**按产品线预置了几套调性**：

| key | 名称 | 适合什么产品 | 底色 | 想解决的观感问题 |
|---|---|---|---|---|
| `classic` | Industrial Blue | 通用机电、泵阀、五金、紧固件 | 亮 | 「这家看起来很正规」——蓝色是工业品的默认信任色，最不容易踩雷 |
| `ocean` | Deep Ocean | 水处理、环保、制冷、船舶、海洋工程 | 亮 | 冷色让「流体」类产品看起来更贴题 |
| `ember` | Forge Orange | 重型机械、焊接、矿山、建材、工程机械 | 亮 | 强对比 + 深棕首屏，衬得住巨大的设备照片，显得「能干活」 |
| `forest` | Machine Green | 化工、能源、农业机械、园林设备 | 亮 | 绿色在化工/农业语境里天然安全 |
| `midnight` | Midnight Tech | 仪器仪表、电子、自动化、PLC、传感器 | **暗** | 深色底能让带背光的设备图、参数曲线跳出来，科技展厅感 |
| `mono` | Graphite | 高端定制、非标件、设计导向的产品册 | 亮 | 黑白灰不抢戏，让产品照片自己说话 |
| `auto` | **Night (auto)** | 全行业，尤其是夜间浏览占比高的站点 | **随系统** | 白天 `classic`、入夜 `midnight`，无需访客手动操作 |

判断依据很简单：**客户展台上摆的是什么，就选哪套**。拿不准就用 `classic`；
如果不想强迫访客做选择、希望「到点自动变暗」，后台默认设成 `auto`。

## 2. 三个使用入口

### 2.1 访客自己切（前台）

导航右侧调色盘按钮 → 下拉 7 个色块（6 套配色 + 1 个夜间 auto）→ 点了立即生效，不刷新页面。
选择写进 `localStorage['b2b_theme']`，同浏览器下次打开还是这套。

支持键盘：`Enter` 打开、`Esc` 关闭、`Tab` 在选项间移动（`role="menuitemradio"`）。

### 2.2 运营设默认（后台）

`/admin/dashboard` → Settings → **Site Theme** → 选一套 → Save Settings。

存在 KV 的 `website_settings.theme_default`，**保存即生效，不需要重新部署**。
这是给「没手动选过的人」看的默认值。

### 2.3 优先级

```
localStorage（访客手动选过）
      ↓ 没有则
KV theme_default（后台设置）
      ↓ 没有则
classic
```

访客的自主选择**永远优先**。运营换默认值，不会把已经选过深色主题的老访客拽回蓝色。

### 2.4 夜间模式（`auto`）

`auto` 不是第 7 套配色，而是一个**策略**：跟着访客系统的 `prefers-color-scheme` 走。

```
系统在深色模式 → data-theme = midnight（深底浅字）
系统在浅色模式 → data-theme = classic（亮底深字）
系统明暗一变   → 自动跟着切，无需刷新，也无需重新点
```

三条实现要点（改动前务必理解，否则很容易出现「选了 auto 但系统切了不跟着变」）：

1. **SSR 拿不到 `matchMedia`**：Worker 渲染时不知道访客系统是明是暗，所以服务端先输出
   `data-theme="classic" data-theme-auto`（亮色兜底，无 JS 的爬虫/禁用脚本用户也能正常看）。
2. **`<head>` 内联脚本在 `<style>` 之前纠正首帧**：读到 `localStorage['b2b_theme'] === 'auto'`
   （或服务端标记 `data-theme-auto`）时，按当前系统偏好立刻改 `data-theme`，避免闪一帧白底。
3. **实时跟随统一由页面底部切换器 IIFE 的 `systemListener` 负责**：一个全局唯一的
   `matchMedia('change')` 监听器，只要当前选择仍是 `auto` 就重算视觉主题。
   不在 `<head>` 里另注册一遍，避免多个监听器叠加打架。

访客一旦手动选了任意具体配色，就退出 `auto`，系统再怎么变都不再覆盖——**手动选择永远优先**。

后台的默认主题也可以设成 `auto`：首次访客（无 localStorage）会自动按自己系统明暗看到对应版本，
运营不用猜「客户是白天看还是晚上看」。

## 3. 实现：为什么换主题只需要改变量

全站组件只消费语义变量，没有一处「因为主题不同而不同的选择器」。所以一套主题 = 十几行变量覆盖。

### 3.1 变量清单

| 变量 | 含义 | 默认 |
|---|---|---|
| `--primary-color` | 主色（按钮、链接、品牌块） | `#2563eb` |
| `--secondary-color` | 主色 hover / 渐变终点 | `#1e40af` |
| `--accent-color` | 强调色（次要按钮、页脚小标题） | `#f59e0b` |
| `--accent-fg` | **强调色底上的文字** | `#1f2937` |
| `--on-primary` | **主色底上的文字** | `#ffffff` |
| `--text-dark` | 正文 | `#1f2937` |
| `--text-light` | 辅助文字 | `#6b7280` |
| `--ink-2` | 次级标签（表头、字段名） | `#4b5563` |
| `--bg-page` | 页面底 | `#ffffff` |
| `--bg-card` | 卡片 / 面板底 | `#ffffff` |
| `--bg-nav` | 导航条底 | `#ffffff` |
| `--bg-light` | 浅色区块 / 斑马行 | `#f9fafb` |
| `--bg-subtle` | 表头 / hover 底 | `#f6f8fb` |
| `--border-color` `--line` `--line-soft` | 三级边框 | 灰阶 |
| `--footer-bg` `--footer-fg` `--footer-border` | **页脚独立一套** | 深灰 |
| `--band-bg` `--band-fg` | **整块品牌色横幅** | 跟随 primary |
| `--ok-bg/fg` `--warn-bg/fg` `--err-bg/fg` `--info-bg/fg` `--gray-bg/fg` | 状态色（徽章、提示条） | 浅底深字 |
| `--shadow-card` `--shadow-card-hover` `--shadow-pop` | 三级阴影 | 黑 10% |
| `--ring` | 焦点环 | 主色 18% |
| `--hero-gradient` | 首屏渐变 | primary → secondary |
| `color-scheme` | 让滚动条/原生控件跟着变 | `light` |

### 3.2 三个容易踩的结构性坑

这三条是实际做的时候踩出来的，改配色前务必看：

**① 页脚不能用 `--text-dark` 当底色。**
原代码 `.footer { background: var(--text-dark) }`。暗色主题里 `--text-dark` 是 `#e6edfa`（浅色），
页脚会变成页面底部一块比正文还亮的大白板。现在页脚有独立的 `--footer-*`，任何主题下都是深色收尾。

**② 整块品牌色横幅不能直接用 `--primary-color` 当底。**
首页的「18 sets / 300,000 units」数字条、About 页的 CTA 条，原来都是 `background: var(--primary-color)`。
暗色主题的 primary 是亮青 `#38bdf8`，整条横幅会变成横贯全屏的荧光带，白字在上面几乎看不清。
现在走 `--band-bg` / `--band-fg`，暗色主题下是深蓝底 + 浅青字。

**③ 主色底上的文字必须是 `--on-primary`。**
深色主题的主色是浅亮色，白字对比度只有 1.9:1。`--on-primary` 在暗色主题里是深色字。

### 3.3 缺图占位图

`src/pages/static.js` 生成的占位 SVG **底必须是透明的**。
写死 `fill="#f1f5f9"` 的话，暗色主题下每张缺图的产品卡都是一块刺眼的白板。
透明之后由 `.card-image { background: var(--bg-light) }` 提供底色，浅底深底都正常。

## 4. 加第七套配色

四处，漏一处就会出现「能选但不生效」或「保存被静默丢掉」：

1. **`src/pages/layout.js`** → `THEMES` 数组加一项 `{ key, name, swatch }`（切换器靠它渲染）
2. **`src/pages/layout.js`** → CSS 里加 `html[data-theme="你的key"] { --primary-color: …; … }`
3. **`src/api/handlers/settings.js`** → `THEME_KEYS` 数组加 key（否则后台保存会被清洗回 `classic`）
4. **`src/pages/admin-dashboard.js`** → Settings 里 `<select id="settings-theme">` 加一个 `<option>`

然后更新 `npm run test:theme` 里的选项数量断言，并确认切换与持久化正常。
注意 `auto` 是策略键，不是配色：它没有自己的 `html[data-theme="auto"]` 变量块，
只在 JS 里映射到 `midnight` / `classic`。

## 5. 验证

```bash
npm run test:theme    # 独立冒烟：31 项断言，约 30 秒
npm run theme:shots   # 给 9 个页面 × 3 套主题拍快照，人眼检查用
npm run audit         # 全站体检，含 3 个常驻主题场景
```

`test:theme` 断言的重点不是「属性改了」，而是**视觉真的变了**：

- 切到 `midnight` 后 `body` 背景亮度的确降到 0.3 以下（不是只改了 `data-theme` 属性）
- 正文颜色亮度 > 0.6（深底深字等于没切）
- 页脚比页面更深（防止坑 ① 复发）
- 刷新后仍保持（`localStorage` 生效）
- 375px 下切换按钮不挤爆导航、无横向溢出
- **夜间 `auto`**：用 `emulateMedia` 模拟系统明暗，断言深色落到 `midnight`、切回浅色变 `classic`、
  底色真的跟着变、且全程不刷新页面；面板高亮的是 `auto` 项本身而不是它解析出来的 `midnight`

`audit` 里另有三个场景：前台切换（含 7 项计数）、夜间模式实时跟随、
后台默认值写入 KV 并作用于首次访客（含非法值清洗验证）。

## 6. 已知取舍

- **客户门户（`/account`）与后台不跟随主题**。这两处是工具界面，自带一套完整配色，
  在任何主题下都能读；强行接入反而要做一次大改，收益不成比例。
- **`auto` 只映射到 `midnight` / `classic`**，不会把 `ocean`、`ember` 等其它配色也做一套暗色版。
  做全套暗色变体意味着每套主题都要单独设计一套深色变量，维护成本翻倍；
  夜间只需要「看得舒服」，不需要「保持品牌色相」。
- **主题切换不做过渡动画**。整页变色的 200ms 渐变在多主题切换时像故障，直接切换反而干净。
- **`localStorage` 被禁用时（隐私模式）**：切换只在当前页生效，换页回到默认值，不报错；
  `auto` 在隐私模式下仍能按系统明暗显示，只是选择不会被记住。
