/**
 * HTML Layout Template（改造版）
 * 新增：canonical / hreflang / OG / Organization+Product JSON-LD /
 *       lang + dir(rtl) / 站点设置驱动的品牌与页脚 / 所有动态内容转义（防 XSS）
 */
import { escapeHtml, truncate, jsonLdScript, organizationJsonLd } from '../utils/html';
import { t, isRtl, hreflangTags, localizedUrl, langSwitchItems } from '../i18n';

/**
 * 把路径归一化成「页面级 SEO 配置」的键。
 * 只覆盖一级页面（/、/products、/about…）；/products/xxx 这类详情页返回 null，
 * 因为详情页有自己的产品级 seo_title / seo_description，不能被列表页文案盖掉。
 */
export function seoPageKey(pathname) {
  const segs = String(pathname || '/').split('?')[0].split('#')[0].split('/').filter(Boolean);
  // 兼容未剥语言前缀的调用方：/es/products → /products
  if (segs.length && /^[a-z]{2}(-[a-z]{2})?$/i.test(segs[0])) segs.shift();
  if (segs.length === 0) return '/';
  if (segs.length > 1) return null;
  return '/' + segs[0].toLowerCase();
}

/**
 * 可选主题。key 必须与 CSS 里的 html[data-theme="…"] 一一对应，
 * swatch 只是切换器里的小色块预览（不改渲染）。
 *
 * 命名和配色是按行业调的，不是随手取：
 *   classic  通用机电/泵阀 —— 蓝色是工业品默认信任色，最不容易踩雷
 *   ocean    水处理/环保/制冷/船舶
 *   ember    重型机械/焊接/矿山/建材 —— 橙底黑字，设备大图很抓眼
 *   forest   化工/能源/农业机械
 *   midnight 仪器仪表/电子/自动化 —— 深色衬产品图，科技感最强，但长文阅读差
 *   mono     高端定制/设计导向 —— 黑白灰，让产品照片自己说话
 */
export const THEMES = [
  { key: 'classic', name: 'Industrial Blue', swatch: ['#2563eb', '#1e40af'] },
  { key: 'ocean', name: 'Deep Ocean', swatch: ['#0e7490', '#155e75'] },
  { key: 'ember', name: 'Forge Orange', swatch: ['#ea580c', '#c2410c'] },
  { key: 'forest', name: 'Machine Green', swatch: ['#15803d', '#166534'] },
  { key: 'midnight', name: 'Midnight Tech', swatch: ['#0a1120', '#38bdf8'] },
  { key: 'mono', name: 'Graphite', swatch: ['#111827', '#9ca3af'] },
  // 「夜间（跟随系统）」：不是第 7 套配色，而是一个「策略」。
  // 白天自动用 classic，系统切到深色后自动用 midnight，无需手动再点。
  // swatch 一半亮一半暗，正好表达「随系统明暗而变」。
  { key: 'auto', name: 'Night (auto)', swatch: ['#ffffff', '#0a1120'] },
];

/**
 * 主题名的多语言文案。前台切换器按当前语言显示，缺失语种回退到 THEMES[].name（英文）。
 * 放在这里而不是 i18n.js：主题是 layout 的私有概念，DICT 不该被 7 个 key 撑大。
 */
const THEME_LABELS = {
  classic:   { en: 'Industrial Blue', es: 'Azul Industrial', ar: 'أزرق صناعي', zh: '工业蓝', 'zh-TW': '工業藍' },
  ocean:     { en: 'Deep Ocean', es: 'Océano Profundo', ar: 'محيط عميق', zh: '深海青', 'zh-TW': '深海青' },
  ember:     { en: 'Forge Orange', es: 'Naranja Forja', ar: 'برتقالي الصهر', zh: '炉火橙', 'zh-TW': '爐火橙' },
  forest:    { en: 'Machine Green', es: 'Verde Maquinaria', ar: 'أخضر صناعي', zh: '机加工绿', 'zh-TW': '機加工綠' },
  midnight:  { en: 'Midnight Tech', es: 'Tecnología Medianoche', ar: 'تقنية منتصف الليل', zh: '午夜科技', 'zh-TW': '午夜科技' },
  mono:      { en: 'Graphite', es: 'Grafito', ar: 'جرافيت', zh: '石墨极简', 'zh-TW': '石墨極簡' },
  auto:      { en: 'Night (auto)', es: 'Noche (auto)', ar: 'ليلي (تلقائي)', zh: '夜间（跟随系统）', 'zh-TW': '夜間（跟隨系統）' },
};

function themeName(th, lang) {
  return (THEME_LABELS[th.key] && THEME_LABELS[th.key][lang]) || th.name;
}

/**
 * 任何来源（KV / 环境变量 / URL）的主题值都必须过这里，防止注入出非法属性。
 * 'auto' 是跟随系统的策略，SSR 时无法读 matchMedia，先渲染成经典亮色兜底，
 * 由 <head> 里的内联脚本按访客的系统偏好即时纠正（见 createLayout 头部脚本）。
 */
export function normalizeTheme(value) {
  const key = String(value || '').trim().toLowerCase();
  return THEMES.some(th => th.key === key) ? key : 'classic';
}

export function createLayout(title, content, additionalScripts = '', metaDescription = 'B2B Product Exhibition - High-quality industrial products and solutions', useTitleSuffix = true, options = {}) {
  const env = options.env || {};
  const request = options.request;
  const lang = options.lang || env.LANG || env.DEFAULT_LANG || 'en';
  const settings = options.settings || env.SETTINGS || {};
  const base = (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : (request ? new URL(request.url).origin : '');
  const path = options.path || (request ? new URL(request.url).pathname : '/');
  const canonical = base + localizedUrl(path, lang, env);
  const siteName = settings.site_name || 'B2B Product Exhibition';

  // 主题：服务端先按「后台默认值」渲染 html[data-theme]（无 JS 也能生效），
  // 访客自己的选择由 <head> 里的内联脚本在样式表解析前覆盖，避免闪一帧白底。
  const theme = normalizeTheme(options.theme || settings.theme_default || env.THEME_DEFAULT);
  // 'auto' 是跟随系统的策略：服务端（无法读 matchMedia）先渲染成亮色 classic 兜底，
  // 并打上 data-theme-auto 标记；<head> 内联脚本再按访客系统偏好即时纠正到 midnight/classic。
  // 这样无 JS 的用户仍拿到可用的亮色站，而不是白屏或错色。
  const themeAttr = theme === 'auto' ? 'classic' : theme;
  const autoTheme = theme === 'auto';

  // 后台页面级 SEO（阶段四）：运营不碰代码就能改 title / description / 分享图。
  // 优先级：后台配置 > 代码里的默认值；留空则完全走原逻辑，不会因为没配而变空标题。
  const key = seoPageKey(path);
  const seoPages = (settings.seo_pages && typeof settings.seo_pages === 'object') ? settings.seo_pages : {};
  const pageSeo = (key && seoPages[key]) || {};
  const seoTitle = typeof pageSeo.title === 'string' ? pageSeo.title.trim() : '';
  const seoDesc = typeof pageSeo.description === 'string' ? pageSeo.description.trim() : '';

  const pageTitle = seoTitle || (useTitleSuffix ? `${title} - ${siteName}` : title);
  const desc = truncate(seoDesc || metaDescription, 160);
  const rawOgImage = options.ogImage || pageSeo.og_image || settings.seo_og_image || '';
  const ogImage = rawOgImage
    ? (rawOgImage.startsWith('http') ? rawOgImage : base + rawOgImage)
    : '';

  // GA4（阶段一C）：只在配置了真实 Measurement ID 时注入。
  // 取值优先级：环境变量 > 后台设置。运营没有 wrangler 权限，不该为换个 ID 就去改配置重部署。
  const ga4Raw = (env.GA4_ID && !String(env.GA4_ID).startsWith('REPLACE_'))
    ? env.GA4_ID
    : (settings.ga4_id || '');
  const ga4Id = /^G-[A-Z0-9]{6,}$/i.test(String(ga4Raw).trim()) ? String(ga4Raw).trim() : '';
  const ga4 = ga4Id ? `
  <script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${escapeHtml(ga4Id)}', { anonymize_ip: true });
  </script>` : '';

  // WhatsApp 悬浮（阶段一C）：海外买家最常用的联系方式
  const waDigits = String(settings.whatsapp || '').replace(/\D/g, '');
  const whatsappFloat = waDigits ? `
  <a href="https://wa.me/${waDigits}?text=${encodeURIComponent('Hello, I would like to inquire about your products.')}"
     target="_blank" rel="noopener" aria-label="WhatsApp"
     style="position:fixed;right:1.1rem;bottom:1.1rem;z-index:60;background:#25D366;width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,.2);text-decoration:none">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.4.5-.6.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.2-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 1.9 3 4.7 4.1 2.3.9 2.8.8 3.3.7.5-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.2-.2-.5-.3z"/>
      <path d="M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.2-1.3c1.5.8 3.1 1.3 4.8 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3.1.8.8-3-.2-.3C4.3 15.2 3.8 13.6 3.8 12 3.8 7.5 7.5 3.8 12 3.8S20.2 7.5 20.2 12 16.5 20.2 12 20.2z"/>
    </svg>
  </a>` : '';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}"${isRtl(lang) ? ' dir="rtl"' : ''}${autoTheme ? ' data-theme-auto=""' : ''} data-theme="${themeAttr}">
<head>
  <meta charset="UTF-8">
  <script>
    /* 主题恢复：必须跑在 <style> 之前。
       否则浏览器会先按服务端默认色画一帧，再跳成访客选过的主题（暗色主题下尤其刺眼）。

       优先级：localStorage['b2b_theme'] > 服务端默认 > classic。
       'auto' 是跟随系统的策略，不是某套具体配色：
         - 读到 'auto' 时，按当前 prefers-color-scheme 即时落到 midnight(深)/classic(浅)
         - 并注册 matchMedia change 监听，之后系统明暗一变就自动跟着切，无需刷新 */
    (function () {
      try {
        var root = document.documentElement;
        var KEY = 'b2b_theme';
        var saved = localStorage.getItem(KEY);
        var dark = false;
        try { dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
        if (saved) {
          if (saved === 'auto') {
            // 首帧按当前系统偏好定色，避免闪一帧白底。
            // 后续「系统明暗变化」的实时跟随由页面底部主题切换 IIFE 的统一
            // matchMedia 监听器负责（systemListener），这里不再重复注册。
            var effective = dark ? 'midnight' : 'classic';
            root.setAttribute('data-theme', effective);
          } else {
            root.setAttribute('data-theme', saved);
          }
        } else if (root.hasAttribute('data-theme-auto') && dark) {
          // 服务端默认就是 auto 且访客没手动选过：首帧跟随系统深色，
          // 实时变化同样交给切换器 IIFE 的 systemListener。
          root.setAttribute('data-theme', 'midnight');
        }
      } catch (e) { /* 隐私模式 / 禁用存储：保持服务端默认值即可 */ }
    })();
  </script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(desc)}">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%232563eb'/%3E%3Ctext x='16' y='22.5' font-family='Arial,Helvetica,sans-serif' font-size='17' font-weight='700' fill='%23ffffff' text-anchor='middle'%3E${escapeHtml((siteName || 'H').trim().charAt(0).toUpperCase())}%3C/text%3E%3C/svg%3E">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  ${base ? hreflangTags(base, path, env) : ''}
  <meta property="og:type" content="${options.product ? 'product' : 'website'}">
  <meta property="og:site_name" content="${escapeHtml(siteName)}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(desc)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ''}
  ${jsonLdScript(organizationJsonLd({ ...settings, site_name: siteName }, base))}
  ${options.jsonld || ''}
  ${ga4}
  <style>
    /* Main Stylesheet for B2B Website */

    :root {
      /* ---- 品牌色 ---- */
      --primary-color: #2563eb;
      --secondary-color: #1e40af;
      --accent-color: #f59e0b;
      /* accent 上的文字色：橙黄底配白字只有 2.9:1，不达标；深色字反而更清楚 */
      --accent-fg: #1f2937;
      --accent-hover: #d97706;
      /* 主色底上的文字：深色主题的主色是浅亮色，白字会看不清 */
      --on-primary: #ffffff;
      /* 「工厂实力数字条」这类整块品牌色横幅。
         不能用 primary 直接当底色：深色主题里 primary 是亮青，整条会变成刺眼亮带。
         独立成一对变量后，暗色主题可以换成深底浅字。 */
      --band-bg: var(--primary-color);
      --band-fg: var(--on-primary);

      /* ---- 文字 ---- */
      --text-dark: #1f2937;
      --text-light: #6b7280;

      /* ---- 表面层（主题切换的主战场）
         把「页面底 / 卡片底 / 导航底 / 浅色区块」拆成四个独立变量，
         暗色主题才能只换这几行就整体变深，而不是逐组件打补丁。 ---- */
      --bg-page: #ffffff;
      --bg-card: #ffffff;
      --bg-nav: #ffffff;
      --bg-light: #f9fafb;
      --bg-subtle: #f6f8fb;

      /* ---- 边框 ---- */
      --border-color: #e5e7eb;

      /* ---- 页脚：不能跟着 --text-dark 反色，否则暗色主题下页脚比页面还亮 ---- */
      --footer-bg: #1f2937;
      --footer-fg: #9ca3af;
      --footer-border: #374151;

      /* ---- 状态色 ---- */
      --ok-bg: #e7f6ec;   --ok-fg: #0f6b35;
      --warn-bg: #fdf3d8; --warn-fg: #7a4a02;
      --err-bg: #fdeaea;  --err-fg: #9b1c1c;
      --info-bg: #e8f0fe; --info-fg: #1a4fbb;
      --gray-bg: #f1f3f7; --gray-fg: #374151;

      /* ---- 阴影 / 焦点环 / 首屏渐变 ---- */
      --shadow-card: 0 4px 6px rgba(0, 0, 0, 0.1);
      --shadow-card-hover: 0 10px 15px rgba(0, 0, 0, 0.15);
      --shadow-pop: 0 12px 32px rgba(15, 23, 42, 0.16);
      --ring: 0 0 0 3px rgba(37, 99, 235, 0.18);
      --hero-gradient: linear-gradient(135deg, var(--primary-color), var(--secondary-color));

      color-scheme: light;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: var(--text-dark);
      background: var(--bg-page);
    }

    /* Navigation */
    .navbar {
      background: var(--bg-nav);
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      position: sticky;
      top: 0;
      z-index: 1000;
    }

    .nav-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .logo {
      font-size: 1.5rem;
      font-weight: bold;
      color: var(--primary-color);
      text-decoration: none;
    }

    .nav-menu {
      display: flex;
      list-style: none;
      gap: 2rem;
    }

    .nav-link {
      text-decoration: none;
      color: var(--text-dark);
      font-weight: 500;
      transition: color 0.3s;
    }

    .nav-link:hover,
    .nav-link.active {
      color: var(--primary-color);
    }

    /* Mobile Menu Toggle */
    .menu-toggle {
      display: none;
      flex-direction: column;
      cursor: pointer;
    }

    .menu-toggle span {
      width: 25px;
      height: 3px;
      background: var(--text-dark);
      margin: 3px 0;
      transition: 0.3s;
    }

    /* Container */
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    /* Hero Section */
    .hero {
      background: var(--hero-gradient);
      color: white;
      padding: 4rem 2rem;
      text-align: center;
    }

    .hero h1 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }

    .hero p {
      font-size: 1.2rem;
      max-width: 600px;
      margin: 0 auto;
    }

    /* Buttons */
    .btn {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      border-radius: 0.375rem;
      text-decoration: none;
      font-weight: 600;
      transition: all 0.3s;
      border: none;
      cursor: pointer;
    }

    .btn-primary {
      background: var(--primary-color);
      color: var(--on-primary);
    }

    .btn-primary:hover {
      background: var(--secondary-color);
    }

    .btn-secondary {
      background: var(--accent-color);
      color: var(--accent-fg);
    }

    .btn-secondary:hover {
      background: var(--accent-hover);
    }

    /* Cards */
    .card {
      background: var(--bg-card);
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      overflow: hidden;
      transition: transform 0.3s;
    }

    .card:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 15px rgba(0,0,0,0.15);
    }

    .card-image {
      width: 100%;
      height: 200px;
      object-fit: cover;
      /* 透明占位图（缺图时）会透出这层底色，深浅主题都不刺眼 */
      background: var(--bg-light);
    }

    .card-content {
      padding: 1.5rem;
    }

    .card-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .card-description {
      color: var(--text-light);
      margin-bottom: 1rem;
    }

    /* Grid Layout */
    .grid {
      display: grid;
      gap: 2rem;
    }

    .grid-2 {
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      max-width: 100%;
    }

    .grid-3 {
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      max-width: 100%;
    }

    /* Limit card max width when there are few items */
    .grid > .card {
      max-width: 400px;
      justify-self: start;
    }

    @media (min-width: 768px) {
      .grid > .card {
        justify-self: stretch;
      }
    }

    /* Form Styles */
    .form-group {
      margin-bottom: 1.5rem;
    }

    .form-label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }

    .form-input,
    .form-textarea {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 0.375rem;
      font-size: 1rem;
      /* 不设 background/color 的话，深色主题里输入框会退回浏览器 UA 的灰底，
         跟卡片底色差一截，看起来像块补丁 */
      background: var(--bg-card);
      color: var(--text-dark);
      font-family: inherit;
      transition: border-color 0.3s;
    }

    .form-input::placeholder,
    .form-textarea::placeholder {
      color: var(--text-light);
    }

    .form-input:focus,
    .form-textarea:focus {
      outline: none;
      border-color: var(--primary-color);
    }

    .form-textarea {
      resize: vertical;
      min-height: 120px;
    }

    /* Footer */
    .footer {
      background: var(--footer-bg);
      color: var(--footer-fg);
      padding: 3rem 2rem 1rem;
      margin-top: 4rem;
    }

    .footer-content {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 2rem;
    }

    .footer-section h3 {
      margin-bottom: 1rem;
      color: var(--accent-color);
    }

    .footer-section ul {
      list-style: none;
    }

    .footer-section a {
      color: var(--footer-fg);
      text-decoration: none;
      transition: color 0.3s;
    }

    .footer-section a:hover {
      color: #ffffff;
    }

    .footer-bottom {
      text-align: center;
      padding-top: 2rem;
      margin-top: 2rem;
      border-top: 1px solid var(--footer-border);
      color: var(--footer-fg);
    }

    /* ---- 主题切换器 ----
       放在语言切换器左边。用原生 button + 绝对定位面板，不引第三方库：
       这个站的首要指标是首屏体积和 LCP，34px 的按钮不值得多 20KB JS。 */
    .theme-switch {
      position: relative;
      display: flex;
      align-items: center;
      flex: 0 0 auto;
    }

    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--bg-card);
      color: var(--text-dark);
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }

    .theme-toggle:hover,
    .theme-toggle[aria-expanded="true"] {
      border-color: var(--primary-color);
      color: var(--primary-color);
    }

    .theme-menu {
      position: absolute;
      top: calc(100% + 8px);
      inset-inline-end: 0;
      z-index: 1200;
      min-width: 210px;
      padding: 0.35rem;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      box-shadow: var(--shadow-pop);
    }

    .theme-menu[hidden] {
      display: none !important;
    }

    .theme-opt {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      width: 100%;
      padding: 0.45rem 0.5rem;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--text-dark);
      font: inherit;
      font-size: 0.84rem;
      text-align: start;
      cursor: pointer;
    }

    .theme-opt:hover {
      background: var(--bg-subtle);
    }

    .theme-opt[aria-checked="true"] {
      background: var(--bg-light);
      font-weight: 600;
    }

    .theme-dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      flex: 0 0 auto;
      border: 1px solid rgba(0, 0, 0, 0.14);
    }

    .theme-opt .tick {
      margin-inline-start: auto;
      color: var(--primary-color);
      font-weight: 700;
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      .nav-menu {
        position: fixed;
        left: -100%;
        top: 70px;
        flex-direction: column;
        background-color: var(--bg-nav);
        width: 100%;
        text-align: center;
        transition: 0.3s;
        box-shadow: 0 10px 27px rgba(0,0,0,0.1);
        padding: 2rem 0;
      }

      .nav-menu.active {
        left: 0;
      }

      .menu-toggle {
        display: flex;
      }

      .hero h1 {
        font-size: 2rem;
      }

      .grid-2,
      .grid-3 {
        grid-template-columns: 1fr;
      }
    }

    /* Loading Spinner */
    .spinner {
      border: 3px solid var(--line);
      border-top: 3px solid var(--primary-color);
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 2rem auto;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* =========================================================================
       设计系统（阶段三追加）
       -------------------------------------------------------------------------
       只追加工具类，createNavbar / createFooter 的 HTML 结构一个字都不动
       （19 项多语言测试依赖语言切换器选择器与 hreflang 属性）。
       配色全部走既有变量，新增变量只在本块定义，避免污染旧组件。
       ========================================================================= */

    :root {
      --line: #e5e9f0;
      --line-soft: #eef2f7;
      --ink-2: #4b5563;
      --radius-md: 10px;
    }

    /* =========================================================================
       主题（Theme）
       -------------------------------------------------------------------------
       <html data-theme="…"> 决定用哪一套配色。默认值来自后台站点设置
       （theme_default），访客在导航上手动切换后写 localStorage，
       优先级：localStorage > 后台默认 > classic。

       为什么是「换变量」而不是「换样式表」：
       全站组件都只消费 var(--primary-color) / var(--bg-card) 这类语义变量，
       所以一套主题 = 十几行变量覆盖，不需要为每套主题维护一份 CSS。

       为什么页脚单独一套 --footer-*：
       页脚原本用 var(--text-dark) 当底色。暗色主题里 --text-dark 是浅色，
       页脚会变成「比页面还亮的大白块」。解耦后无论主题明暗，页脚都是深色收尾。

       选型建议（后台设置页有同样的说明）：
         classic  通用机电 / 泵阀 / 五金 —— 最稳，转换率导向
         ocean    水处理 / 环保 / 制冷 / 船舶
         ember    重型机械 / 焊接 / 矿山 / 建材 —— 强对比，适合设备大图
         forest   化工 / 能源 / 农业机械
         midnight 仪器仪表 / 电子 / 自动化 —— 深色底衬产品图，科技感
         mono     高端定制 / 设计导向 —— 让产品照片自己说话
       ========================================================================= */

    /* 深海青：水处理、环保、船舶 */
    html[data-theme="ocean"] {
      --primary-color: #0e7490;
      --secondary-color: #155e75;
      --accent-color: #f59e0b;
      --accent-hover: #d97706;
      --bg-light: #f2f9fb;
      --bg-subtle: #eef7fa;
      --line: #d7e8ef;
      --line-soft: #e8f2f7;
      --ink-2: #41616e;
      --footer-bg: #0d3b47;
      --footer-fg: #93b8c4;
      --footer-border: #1b4f5d;
      --info-bg: #e0f2fe;
      --info-fg: #075985;
      --ring: 0 0 0 3px rgba(14, 116, 144, 0.18);
    }

    /* 炉火橙：重型机械、焊接、矿山、建材 */
    html[data-theme="ember"] {
      --primary-color: #ea580c;
      --secondary-color: #c2410c;
      --accent-color: #0891b2;
      --accent-fg: #ffffff;
      --accent-hover: #0e7490;
      --bg-light: #fdf7f3;
      --bg-subtle: #fbf2ec;
      --line: #f0ddd2;
      --line-soft: #f7eae2;
      --ink-2: #6b4a3a;
      --text-light: #7c5b4a;
      --footer-bg: #26201d;
      --footer-fg: #b3a29a;
      --footer-border: #3d332e;
      --ring: 0 0 0 3px rgba(234, 88, 12, 0.18);
      /* hero 不能也用亮橙：首页 hero 下面紧跟橙色数字条，两块同色只隔一条白缝，
         看起来像渲染错误。改成深棕渐变，让橙色只出现在按钮和数字条上。 */
      --hero-gradient: linear-gradient(135deg, #7c2d12 0%, #1c1210 100%);
    }

    /* 机加工绿：化工、能源、农业机械 */
    html[data-theme="forest"] {
      --primary-color: #15803d;
      --secondary-color: #166534;
      --accent-color: #f59e0b;
      --accent-hover: #d97706;
      --bg-light: #f4faf5;
      --bg-subtle: #eff8f1;
      --line: #d8e8dc;
      --line-soft: #e8f2ea;
      --ink-2: #44604c;
      --footer-bg: #16301f;
      --footer-fg: #96b3a1;
      --footer-border: #274734;
      --ok-bg: #dff3e6;
      --ring: 0 0 0 3px rgba(21, 128, 61, 0.18);
    }

    /* 午夜科技：仪器仪表、电子、自动化（深色） */
    html[data-theme="midnight"] {
      --primary-color: #38bdf8;
      --secondary-color: #0ea5e9;
      --accent-color: #fbbf24;
      --accent-fg: #0b1120;
      --accent-hover: #f59e0b;
      --on-primary: #0b1120;
      --band-bg: #16263d;
      --band-fg: #bae6fd;

      --text-dark: #e6edfa;
      --text-light: #93a7c4;
      --ink-2: #a9bcd6;

      --bg-page: #0a1120;
      --bg-card: #121c2e;
      --bg-nav: #0e1728;
      --bg-light: #162034;
      --bg-subtle: #18233a;

      --border-color: #24304a;
      --line: #24304a;
      --line-soft: #1b2539;

      --footer-bg: #060b16;
      --footer-fg: #8fa3bf;
      --footer-border: #1b2539;

      --ok-bg: #0f2e21;   --ok-fg: #6ee7a8;
      --warn-bg: #33270d; --warn-fg: #fcd34d;
      --err-bg: #3a1618;  --err-fg: #fca5a5;
      --info-bg: #10263f; --info-fg: #7dd3fc;
      --gray-bg: #1a2436; --gray-fg: #b6c4d8;

      --shadow-card: 0 4px 6px rgba(0, 0, 0, 0.4);
      --shadow-card-hover: 0 12px 22px rgba(0, 0, 0, 0.55);
      --shadow-pop: 0 16px 40px rgba(0, 0, 0, 0.6);
      --ring: 0 0 0 3px rgba(56, 189, 248, 0.28);
      --hero-gradient: linear-gradient(135deg, #0f3b52, #0a1120);

      color-scheme: dark;
    }

    /* 石墨极简：高端定制、设计导向 */
    html[data-theme="mono"] {
      --primary-color: #111827;
      --secondary-color: #000000;
      --accent-color: #b45309;
      --accent-fg: #ffffff;
      --accent-hover: #92400e;
      --bg-light: #f7f7f8;
      --bg-subtle: #f2f2f4;
      --line: #e2e2e6;
      --line-soft: #eeeeef;
      --ink-2: #57575f;
      --text-light: #6f6f78;
      --footer-bg: #101014;
      --footer-fg: #9a9aa3;
      --footer-border: #2a2a31;
      --ring: 0 0 0 3px rgba(17, 24, 39, 0.16);
    }

    /* 键盘焦点统一可见（鼠标点击不出现），对比度 3:1 以上 */
    :focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }

    [hidden] {
      display: none !important;
    }

    /* ---- 布局 ---- */

    .card {
      background: var(--bg-card);
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    /* 覆盖旧的 6px 重阴影：保留上浮过渡，只把阴影收轻 */
    .card:hover {
      box-shadow: var(--shadow-card-hover);
    }

    .card-pad {
      padding: 1.25rem;
    }

    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--line-soft);
    }

    .card-head h1,
    .card-head h2,
    .card-head h3 {
      font-size: 1.02rem;
      line-height: 1.35;
      margin: 0;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }

    /* 两栏容器：≥768px 双列，窄屏单列 */
    .split {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }

    .split > * {
      min-width: 0;
    }

    .split-full {
      grid-column: 1 / -1;
    }

    @media (min-width: 768px) {
      .split {
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
        align-items: start;
      }
    }

    /* ---- 徽标 ---- */

    .badge {
      display: inline-block;
      padding: 0.18rem 0.5rem;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      line-height: 1.5;
      white-space: nowrap;
    }

    .badge-green { background: var(--ok-bg); color: var(--ok-fg); }
    .badge-amber { background: var(--warn-bg); color: var(--warn-fg); }
    .badge-red   { background: var(--err-bg); color: var(--err-fg); }
    .badge-blue  { background: var(--info-bg); color: var(--info-fg); }
    .badge-gray  { background: var(--gray-bg); color: var(--gray-fg); }

    .pill {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--bg-light);
      color: var(--ink-2);
      font-size: 0.78rem;
      line-height: 1.5;
    }

    /* ---- 表格 ---- */

    .table-wrap {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .table-wrap > .table {
      min-width: 520px;
    }

    .table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92rem;
      color: var(--text-dark);
    }

    .table thead th {
      background: var(--bg-subtle);
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      padding: 0.55rem 0.65rem;
      font-size: 0.74rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--ink-2);
      text-align: left;
      white-space: nowrap;
    }

    .table tbody td {
      padding: 0.7rem 0.65rem;
      border-bottom: 1px solid var(--line-soft);
      vertical-align: top;
    }

    .table tbody tr:nth-child(even) {
      background: var(--bg-light);
    }

    .table tfoot td {
      padding: 0.6rem 0.65rem;
      font-weight: 600;
    }

    .table .num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    /* ---- 表单 ---- */

    .field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      min-width: 0;
    }

    .field > label,
    .field > .field-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: var(--ink-2);
    }

    .field input,
    .field select,
    .field textarea {
      width: 100%;
      padding: 0.55rem 0.7rem;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--bg-card);
      color: var(--text-dark);
      font-size: 0.95rem;
      font-family: inherit;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .field textarea {
      min-height: 96px;
      resize: vertical;
    }

    .field input:focus,
    .field select:focus,
    .field textarea:focus {
      outline: none;
      border-color: var(--primary-color);
      box-shadow: var(--ring);
    }

    .hint {
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-light);
    }

    .field > .hint {
      color: var(--ink-2);
      font-weight: 600;
    }

    .empty {
      padding: 2.5rem 1rem;
      border: 1px dashed var(--line);
      border-radius: var(--radius-md);
      background: var(--bg-subtle);
      text-align: center;
      color: var(--text-light);
      font-size: 0.92rem;
    }

    /* ---- 按钮变体 ---- */

    .btn-ghost {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      padding: 0.55rem 0.9rem;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: transparent;
      color: var(--text-dark);
      font-size: 0.9rem;
      font-weight: 600;
      font-family: inherit;
      line-height: 1.4;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.15s, border-color 0.15s;
    }

    .btn-ghost:hover {
      background: var(--bg-subtle);
      border-color: var(--line);
    }

    .btn-sm {
      padding: 0.35rem 0.6rem;
      font-size: 0.82rem;
    }

    .btn-danger {
      border-color: #b91c1c;
      background: #b91c1c;
      color: #fff;
    }

    .btn-danger:hover {
      background: #991b1b;
      border-color: #991b1b;
    }

    /* ---- 提示条 ---- */

    .alert {
      display: block;
      padding: 0.7rem 0.9rem;
      border: 1px solid transparent;
      border-radius: 8px;
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .alert-error {
      background: var(--err-bg);
      border-color: var(--err-bg);
      color: var(--err-fg);
    }

    .alert-success {
      background: var(--ok-bg);
      border-color: var(--ok-bg);
      color: var(--ok-fg);
    }

    /* ---- 响应式 ---- */

    @media (max-width: 767px) {
      .split {
        grid-template-columns: 1fr;
      }

      .hide-sm {
        display: none !important;
      }

      .table {
        font-size: 13px;
      }

      .card-head {
        padding: 0.85rem 1rem;
      }

      .card-pad {
        padding: 1rem;
      }
    }

    /* ---- 打印：报价单/订单确认单可直接另存 PDF ---- */

    @media print {
      nav,
      footer,
      .no-print,
      .wa-float,
      a[aria-label="WhatsApp"],
      .menu-toggle {
        display: none !important;
      }

      body {
        background: #fff;
      }

      .card {
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }

      .container {
        max-width: none;
        padding: 0;
      }

      a[href]::after {
        content: "";
      }

      .table thead th {
        background: #f6f8fb !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    /* ---- 产品卡片：等高 + 按钮吸底 ----
       描述文字长短不一会让同一行卡片的按钮位置参差，视觉上非常明显。
       用 flex 列 + 描述 flex:1 把按钮压到底部，整行卡片自动对齐。 */
    .product-card {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .product-card .card-content {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      gap: .5rem;
    }

    .product-card .card-title {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 2.7em;
      margin-bottom: 0;
    }

    .product-card .card-description {
      flex: 1 1 auto;
      margin-bottom: .25rem;
    }

    .product-card .btn {
      margin-top: auto;
      align-self: flex-start;
    }

    /* ---- 移动端：悬浮球缩小，避免压住正文 ---- */
    @media (max-width: 767px) {
      a[aria-label="WhatsApp"] {
        transform: scale(.82);
        transform-origin: bottom right;
      }
    }
  </style>
</head>
<body>
  ${createNavbar({ lang, env, settings, path, theme })}

  <main>
    ${content}
  </main>

  ${createFooter({ lang, env, settings })}

  ${whatsappFloat}

  <script>
    /**
     * Main JavaScript file for B2B Website
     * Handles common functionality across all pages
     */

    // Mobile menu toggle
    document.addEventListener('DOMContentLoaded', function() {
      const menuToggle = document.querySelector('.menu-toggle');
      const navMenu = document.querySelector('.nav-menu');

      if (menuToggle && navMenu) {
        menuToggle.addEventListener('click', function() {
          navMenu.classList.toggle('active');
        });

        // Close menu when clicking outside
        document.addEventListener('click', function(event) {
          if (!menuToggle.contains(event.target) && !navMenu.contains(event.target)) {
            navMenu.classList.remove('active');
          }
        });
      }

      // Set active nav link based on current page
      const currentPath = window.location.pathname;
      const navLinks = document.querySelectorAll('.nav-link');

      navLinks.forEach(link => {
        const href = link.getAttribute('href');
        // 语言前缀（/es/products）下也要正确高亮
        if (href === currentPath || (href !== '/' && currentPath.endsWith(href)) || (href === '/' && currentPath === '/')) {
          link.classList.add('active');
        }
      });
    });

    // API helper functions
    // 失败时抛出的是服务端给的 error 文案（如「Too many failed attempts…」），
    // 而不是裸的 "HTTP error! status: 429" —— 后者对用户毫无意义。
    const API = {
      baseURL: '/api',

      async _request(method, endpoint, data) {
        const opts = { method };
        if (data !== undefined) {
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify(data);
        }
        const response = await fetch(\`\${this.baseURL}\${endpoint}\`, opts);
        let body = null;
        try { body = await response.json(); } catch (e) { body = null; }
        if (!response.ok) {
          const err = new Error((body && body.error) || \`HTTP error! status: \${response.status}\`);
          err.status = response.status;
          err.body = body;
          throw err;
        }
        return body;
      },

      get(endpoint) { return this._request('GET', endpoint); },
      post(endpoint, data) { return this._request('POST', endpoint, data); },
      put(endpoint, data) { return this._request('PUT', endpoint, data); },
      delete(endpoint) { return this._request('DELETE', endpoint); },
    };

    // Form validation helper
    function validateEmail(email) {
      const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
      return re.test(String(email).toLowerCase());
    }

    // Show notification
    function showNotification(message, type = 'info') {
      const notification = document.createElement('div');
      notification.className = \`notification notification-\${type}\`;
      notification.textContent = message;
      notification.style.cssText = \`
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: \${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
        color: white;
        border-radius: 0.5rem;
        box-shadow: 0 10px 15px rgba(0,0,0,0.1);
        z-index: 9999;
        animation: slideIn 0.3s ease-out;
      \`;

      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
      }, 3000);
    }

    // Add CSS animations
    // 变量名不能叫 style：页面附加脚本拼在同一个 <script> 顶层，contact 页也声明过 const style，
    // 两处相撞直接 SyntaxError，整段脚本不执行，联系表单因此永远提交不了。
    const animStyle = document.createElement('style');
    animStyle.textContent = \`
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    \`;
    document.head.appendChild(animStyle);

    // Load and apply website settings
    async function loadWebsiteSettings() {
      try {
        const response = await API.get('/settings');
        if (response.success) {
          const settings = response.data;

          // Update logo/site name
          const logo = document.querySelector('.logo');
          if (logo && settings.site_name) {
            logo.textContent = settings.site_name;
          }

          // Update footer About Us section
          const aboutSection = document.querySelector('.footer-section p');
          if (aboutSection && settings.site_description) {
            aboutSection.textContent = settings.site_description;
          }

          // Update footer Contact Info
          const contactItems = document.querySelectorAll('.footer-section:nth-child(3) ul li');
          if (contactItems.length >= 3) {
            if (settings.email) contactItems[0].textContent = \`Email: \${settings.email}\`;
            if (settings.phone) contactItems[1].textContent = \`Phone: \${settings.phone}\`;
            if (settings.address) contactItems[2].textContent = \`Address: \${settings.address}\`;
          }

          // Update social media links
          const socialLinks = document.querySelectorAll('.footer-section:nth-child(4) ul li a');
          if (socialLinks.length >= 3) {
            if (settings.linkedin) {
              socialLinks[0].href = settings.linkedin;
              if (settings.linkedin === '#') socialLinks[0].parentElement.style.display = 'none';
            }
            if (settings.facebook) {
              socialLinks[1].href = settings.facebook;
              if (settings.facebook === '#') socialLinks[1].parentElement.style.display = 'none';
            }
            if (settings.twitter) {
              socialLinks[2].href = settings.twitter;
              if (settings.twitter === '#') socialLinks[2].parentElement.style.display = 'none';
            }
          }
        }
      } catch (error) {
        console.error('Error loading website settings:', error);
      }
    }

    // Load settings on page load
    loadWebsiteSettings();

    // Export for use in other scripts
    window.API = API;

    /* ---- 来源归因（阶段一C）----
     * UTM 通常只出现在广告落地页，用户跳到 /contact 时已丢失。
     * 这里在首次落地时写入 sessionStorage，之后整个会话都能带上。 */
    (function () {
      try {
        var p = new URLSearchParams(location.search);
        var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
        var hasUtm = keys.some(function (k) { return p.get(k); });
        if (!hasUtm || sessionStorage.getItem('b2b_attr')) return;
        var obj = { landing_page: location.pathname + location.search };
        keys.forEach(function (k) { if (p.get(k)) obj[k] = p.get(k); });
        if (document.referrer) obj.referrer = document.referrer;
        sessionStorage.setItem('b2b_attr', JSON.stringify(obj));
      } catch (e) { /* 隐私模式下 sessionStorage 可能抛错，忽略 */ }
    })();

    window.getAttribution = function () {
      try {
        var saved = JSON.parse(sessionStorage.getItem('b2b_attr') || '{}');
        if (!saved.landing_page) saved.landing_page = location.pathname;
        return saved;
      } catch (e) { return {}; }
    };

    /* ---- 邮件订阅（阶段二C）---- */
    (function () {
      var form = document.getElementById('subscribe-form');
      if (!form) return;
      var msg = document.getElementById('subscribe-msg');
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var emailEl = document.getElementById('subscribe-email');
        var hp = document.getElementById('subscribe-hp');
        var btn = form.querySelector('button[type="submit"]');
        var email = (emailEl.value || '').trim();
        if (!email) return;
        btn.disabled = true;
        var old = btn.textContent;
        btn.textContent = '...';
        try {
          var res = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: email,
              lang: document.documentElement.lang || 'en',
              source: location.pathname,
              company_url: hp ? hp.value : '',
            }),
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          msg.textContent = ${JSON.stringify(t(lang, 'subscribeOk'))};
          msg.style.color = '#86efac';
          form.reset();
        } catch (err) {
          msg.textContent = (err.message && err.message !== 'Failed to fetch')
            ? err.message
            : ${JSON.stringify(t(lang, 'subscribeErr'))};
          msg.style.color = '#fca5a5';
        } finally {
          msg.style.display = 'block';
          btn.disabled = false;
          btn.textContent = old;
        }
      });
    })();

    /* ---- 主题切换 ----
       服务端已经把后台默认主题写进 html[data-theme]；这里只负责
       「访客自己换」：写 localStorage + 立即改属性，不刷页面。
       面板用 hidden 属性控制而不是加/删 class —— [hidden] 已在全局强制 display:none，
       不会因为某个主题把 display 改成 flex 就漏出来。

       'auto'（夜间·跟随系统）特殊处理：
         - 它是「策略」不是某套配色，所以写进 localStorage 的值就是 'auto'，
           真正的视觉主题按系统 prefers-color-scheme 即时取 midnight/classic；
         - 面板里高亮的是「当前选中项」，auto 选中时高亮 auto 按钮本身，
           而不必去高亮它解析出来的 midnight。 */
    (function () {
      var root = document.documentElement;
      var btn = document.getElementById('theme-toggle');
      var menu = document.getElementById('theme-menu');
      if (!btn || !menu) return;

      var KEY = 'b2b_theme';
      var opts = Array.prototype.slice.call(menu.querySelectorAll('.theme-opt'));
      var mq = null;
      try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { mq = null; }

      // 全局唯一的 matchMedia 监听器：只要「当前仍是 auto」，系统明暗一变就重算视觉主题。
      // 无论 auto 来自 head 脚本（服务端默认 auto）还是访客点击，都走这一条，避免重复叠加。
      var systemListener = function () {
        var cur = null;
        try { cur = localStorage.getItem(KEY); } catch (e) {}
        var isAuto = cur === 'auto' || (cur === null && root.hasAttribute('data-theme-auto'));
        if (!isAuto) return; // 访客手动选了别的主题，尊重之
        root.setAttribute('data-theme', (mq && mq.matches) ? 'midnight' : 'classic');
      };
      if (mq && mq.addEventListener) mq.addEventListener('change', systemListener);
      else if (mq && mq.addListener) mq.addListener(systemListener);

      // 当前选中的「策略键」（可能是 auto），决定面板里哪个按钮打勾
      function currentChoice() {
        var c = null;
        try { c = localStorage.getItem(KEY); } catch (e) {}
        if (c) return c;
        // 没手动选过：服务端默认。auto 默认下，root 可能已被 head 脚本改过
        return root.hasAttribute('data-theme-auto') ? 'auto' : (root.getAttribute('data-theme') || 'classic');
      }

      function paint(choice) {
        opts.forEach(function (o) {
          var on = o.getAttribute('data-theme') === choice;
          o.setAttribute('aria-checked', on ? 'true' : 'false');
          var tick = o.querySelector('.tick');
          if (tick) tick.textContent = on ? '\\u2713' : '';
        });
      }

      function close() {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }

      function open() {
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }

      // 选中项决定打勾，视觉主题另算：auto 时按系统偏好即时取 midnight/classic
      function applyChoice(key) {
        var visual = key;
        if (key === 'auto') {
          visual = (mq && mq.matches) ? 'midnight' : 'classic';
        }
        root.setAttribute('data-theme', visual);
        try {
          if (key === 'auto') { root.setAttribute('data-theme-auto', ''); }
          else if (root.hasAttribute('data-theme-auto')) { root.removeAttribute('data-theme-auto'); }
        } catch (e) {}
        try { localStorage.setItem(KEY, key); } catch (e) { /* 隐私模式忽略 */ }
        paint(key);
      }

      paint(currentChoice());

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (menu.hidden) open(); else close();
      });

      opts.forEach(function (o) {
        o.addEventListener('click', function () {
          var key = o.getAttribute('data-theme');
          applyChoice(key);
          close();
          // 供埋点/审计订阅：不改变样式，只是让外部知道访客选了哪套
          document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: key } }));
        });
      });

      document.addEventListener('click', function (e) {
        if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close();
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); }
      });
    })();

    /* ---- GA4 转化事件（未配置 GA4_ID 时为 no-op）---- */
    window.trackLead = function (extra) {
      try {
        if (typeof gtag === 'function') {
          gtag('event', 'generate_lead', Object.assign({ currency: 'USD', value: 0 }, extra || {}));
        }
      } catch (e) { /* 统计失败不能影响业务 */ }
    };
    window.validateEmail = validateEmail;
    window.showNotification = showNotification;
  </script>
  ${additionalScripts}
</body>
</html>`;
}

function createNavbar({ lang, env, settings, path = '/', theme = 'classic' }) {
  const L = (p) => localizedUrl(p, lang, env);
  const links = [
    ['/', 'home'], ['/products', 'products'], ['/cases', 'cases'],
    ['/news', 'news'], ['/about', 'about'], ['/contact', 'contact'],
  ].map(([p, key]) =>
    `<li><a href="${L(p)}" class="nav-link">${escapeHtml(t(lang, key))}</a></li>`
  ).join('\n        ');
  // 语言切换保留当前页面路径（原版全部跳回首页）
  const switches = langSwitchItems(path, lang, env).map(item =>
    item.active
      ? `<a href="${escapeHtml(item.href)}" hreflang="${item.code}" title="${escapeHtml(item.name)}" lang="${item.code}" aria-current="true" style="color:var(--accent-fg);background:var(--accent-color);text-decoration:none;padding:.2rem .45rem;border-radius:.3rem;font-weight:600">${escapeHtml(item.label)}</a>`
      : `<a href="${escapeHtml(item.href)}" hreflang="${item.code}" title="${escapeHtml(item.name)}" lang="${item.code}" rel="alternate" style="color:var(--text-light);text-decoration:none;padding:.2rem .45rem">${escapeHtml(item.label)}</a>`
  ).join('');

  const themeLabel = escapeHtml(t(lang, 'theme'));
  // 首屏打勾应对应「当前实际视觉主题」，而不是策略键。
  // 服务端 SSR 拿不到 matchMedia：auto 先按亮色 classic 打勾，head 内联脚本会在
  // <style> 前把数据改好，切换器 IIFE 启动时再按 localStorage 重算高亮，最终一定正确。
  const activeTheme = theme === 'auto' ? 'classic' : theme;
  const themeOptions = THEMES.map(th => {
    const label = escapeHtml(themeName(th, lang));
    return `
          <button type="button" class="theme-opt" data-theme="${th.key}" role="menuitemradio"
                  aria-checked="${th.key === activeTheme ? 'true' : 'false'}" title="${label}">
            <span class="theme-dot" aria-hidden="true" style="background:linear-gradient(135deg,${th.swatch[0]},${th.swatch[1]})"></span>
            <span>${label}</span>
            <span class="tick" aria-hidden="true">${th.key === activeTheme ? '&#10003;' : ''}</span>
          </button>`;
  }).join('');

  return `
  <nav class="navbar">
    <div class="nav-container">
      <a href="${L('/')}" class="logo">${escapeHtml(settings.site_name || 'GlobalMart')}</a>
      <div class="menu-toggle">
        <span></span><span></span><span></span>
      </div>
      <ul class="nav-menu">
        ${links}
      </ul>
      <div class="theme-switch">
        <button type="button" class="theme-toggle" id="theme-toggle"
                aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu"
                aria-label="${themeLabel}" title="${themeLabel}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9"></circle>
            <circle cx="9.2" cy="9.4" r="1.25" fill="currentColor" stroke="none"></circle>
            <circle cx="14.6" cy="8.6" r="1.25" fill="currentColor" stroke="none"></circle>
            <circle cx="16.1" cy="13.5" r="1.25" fill="currentColor" stroke="none"></circle>
            <circle cx="11.3" cy="16.1" r="1.25" fill="currentColor" stroke="none"></circle>
          </svg>
        </button>
        <div class="theme-menu" id="theme-menu" role="menu" aria-label="${themeLabel}" hidden>${themeOptions}
        </div>
      </div>
      <div class="lang-switch" style="display:flex;gap:.25rem;font-size:.78rem;align-items:center">
        ${switches}
      </div>
    </div>
  </nav>`;
}

function createFooter({ lang, env, settings }) {
  const L = (p) => localizedUrl(p, lang, env);
  const social = [
    ['linkedin', settings.linkedin], ['facebook', settings.facebook], ['twitter', settings.twitter],
  ].filter(([, url]) => url).map(([name, url]) =>
    `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener nofollow">${name[0].toUpperCase() + name.slice(1)}</a></li>`
  ).join('');
  return `
  <footer class="footer">
    <div class="footer-content">
      <div class="footer-section">
        <h3>${escapeHtml(t(lang, 'aboutUs'))}</h3>
        <p>${escapeHtml(settings.company_intro || settings.site_description || '')}</p>
      </div>
      <div class="footer-section">
        <h3>${escapeHtml(t(lang, 'quickLinks'))}</h3>
        <ul>
          <li><a href="${L('/')}">${escapeHtml(t(lang, 'home'))}</a></li>
          <li><a href="${L('/products')}">${escapeHtml(t(lang, 'products'))}</a></li>
          <li><a href="${L('/cases')}">${escapeHtml(t(lang, 'cases'))}</a></li>
          <li><a href="${L('/news')}">${escapeHtml(t(lang, 'news'))}</a></li>
          <li><a href="${L('/about')}">${escapeHtml(t(lang, 'about'))}</a></li>
          <li><a href="${L('/contact')}">${escapeHtml(t(lang, 'contact'))}</a></li>
          <li><a href="${L('/faq')}">${escapeHtml(t(lang, 'faq'))}</a></li>
          <li><a href="${L('/privacy')}">${escapeHtml(t(lang, 'privacyPolicy'))}</a></li>
        </ul>
      </div>
      <div class="footer-section">
        <h3>${escapeHtml(t(lang, 'contactInfo'))}</h3>
        <ul>
          <li>Email: <a href="mailto:${escapeHtml(settings.email || '')}">${escapeHtml(settings.email || '')}</a></li>
          <li>Phone: ${escapeHtml(settings.phone || '')}</li>
          <li>Address: ${escapeHtml(settings.address || '')}</li>
        </ul>
      </div>
      <div class="footer-section">
        <h3>${escapeHtml(t(lang, 'followUs'))}</h3>
        <ul>${social}</ul>
      </div>
    </div>
    <div class="footer-bottom">
      <!-- 阶段二C：订阅（双 opt-in）。放在页脚而不是弹窗——
           弹窗订阅在欧美站点已被用户训练成「闭眼关掉」，页脚转化率反而更高。 -->
      <form id="subscribe-form" style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:1rem">
        <input type="email" id="subscribe-email" required maxlength="190"
               placeholder="${escapeHtml(t(lang, 'subscribePlaceholder'))}"
               aria-label="Email"
               style="padding:.6rem .8rem;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:inherit;min-width:240px">
        <!-- 蜜罐：对用户不可见，机器人会填 -->
        <input type="text" id="subscribe-hp" tabindex="-1" autocomplete="off"
               style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" aria-hidden="true">
        <button type="submit" class="btn btn-primary" style="padding:.6rem 1.1rem">${escapeHtml(t(lang, 'subscribeCta'))}</button>
      </form>
      <p id="subscribe-msg" style="display:none;font-size:.85rem;margin:0 0 .75rem"></p>
      <p>&copy; ${new Date().getFullYear()} ${escapeHtml(settings.site_name || 'B2B Product Exhibition')}. All rights reserved.
        | <a href="${L('/privacy')}" style="color:var(--text-light)">${escapeHtml(t(lang, 'privacyPolicy'))}</a>
        | <a href="/admin" style="color:var(--accent-color);text-decoration:none">${escapeHtml(t(lang, 'adminLogin'))}</a></p>
    </div>
  </footer>`;
}
