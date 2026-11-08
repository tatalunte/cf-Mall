/**
 * i18n（阶段一A 增强）
 *
 * 能力：
 *  1. 词典（页面 UI 文案）
 *  2. 产品级翻译：products.translations = { es: { name, description, ... } }，缺失字段回退英文
 *  3. 语言协商：?lang= > cookie > cf.country > Accept-Language > 默认语言
 *  4. 本地化格式：日期 / 数字 / 货币（Intl，Worker 运行时原生支持）
 *  5. RTL（ar/he/fa/ur）
 *
 * 约定：默认语言 en 走根路径，其它语言走 /<lang>/ 前缀。
 */

// 注意：这里是带 .js 的显式扩展名。i18n.js 会被 Node 脚本直接 import
// （scripts/test-i18n.mjs），Node 的 ESM 解析器不做扩展名补全，
// 写成 './utils/json' 会 ERR_MODULE_NOT_FOUND。
import { parseJsonLoose } from './utils/json.js';

export const LANG_COOKIE = 'lang_pref';

/** 每种语言的展示信息与本地化 locale / 货币 */
export const LANG_META = {
  en: { name: 'English', locale: 'en-US', currency: 'USD', flag: 'EN' },
  es: { name: 'Español', locale: 'es-ES', currency: 'EUR', flag: 'ES' },
  ar: { name: 'العربية', locale: 'ar-SA', currency: 'SAR', flag: 'AR' },
  de: { name: 'Deutsch', locale: 'de-DE', currency: 'EUR', flag: 'DE' },
  fr: { name: 'Français', locale: 'fr-FR', currency: 'EUR', flag: 'FR' },
  ru: { name: 'Русский', locale: 'ru-RU', currency: 'RUB', flag: 'RU' },
  pt: { name: 'Português', locale: 'pt-BR', currency: 'BRL', flag: 'PT' },
  ja: { name: '日本語', locale: 'ja-JP', currency: 'JPY', flag: 'JA' },
  ko: { name: '한국어', locale: 'ko-KR', currency: 'KRW', flag: 'KO' },
  zh: { name: '简体中文', locale: 'zh-CN', currency: 'CNY', flag: 'ZH' },
  'zh-TW': { name: '繁體中文', locale: 'zh-TW', currency: 'TWD', flag: 'TW' },
};

export const DICT = {
  en: {
    home: 'Home', products: 'Products', about: 'About Us', contact: 'Contact Us',
    news: 'News', certifications: 'Certifications', cases: 'Case Studies', faq: 'FAQ',
    featured: 'Featured Products', viewAll: 'View All Products', viewDetails: 'View Details',
    allCategories: 'All Categories', searchPlaceholder: 'Search products or models...',
    search: 'Search', noResults: 'No products found matching your criteria.',
    sendInquiry: 'Send Inquiry / Get a Quote', yourName: 'Your Name', email: 'Email',
    company: 'Company', phone: 'Phone / WhatsApp', country: 'Country', message: 'Message',
    subject: 'Subject', submit: 'Submit Inquiry', cancel: 'Cancel',
    description: 'Product Description', specifications: 'Specifications',
    consent: 'I agree to the Privacy Policy and consent to be contacted about my inquiry.',
    success: 'Thank you! Your inquiry has been received. We will reply within 24 hours.',
    failed: 'Submission failed. Please try again or email us directly.',
    aboutUs: 'About Us', quickLinks: 'Quick Links', contactInfo: 'Contact Info', followUs: 'Follow Us',
    adminLogin: 'Admin Login',
    // 阶段一新增
    readMore: 'Read more', allNews: 'All News', publishedOn: 'Published on',
    lastUpdated: 'Last updated', relatedProducts: 'Related Products',
    applications: 'Applications', customization: 'Customization', samplePolicy: 'Sample Policy',
    leadTime: 'Lead Time', downloads: 'Downloads', datasheet: 'Download Datasheet',
    video: 'Product Video', whatsapp: 'Chat on WhatsApp',
    ourFactory: 'Our Factory', ourCertifications: 'Certifications & Compliance',
    trustedBy: 'Trusted by', ourCases: 'Customer Cases',
    capabilities: 'Production Capabilities', qualityControl: 'Quality Control',
    contactUs: 'Contact Us', getQuote: 'Get a Quote',
    attachment: 'Attachment (drawing / photo / spec, max 5 MB)',
    required: 'Required', optional: 'Optional',
    privacyPolicy: 'Privacy Policy', terms: 'Terms of Service',
    theme: 'Colour theme',
    subscribePlaceholder: 'Email for product updates', subscribeCta: 'Subscribe',
    subscribeOk: 'Almost there — check your inbox to confirm.',
    subscribeErr: 'Subscription failed. Please try again.',
  },
  es: {
    home: 'Inicio', products: 'Productos', about: 'Sobre nosotros', contact: 'Contacto',
    news: 'Noticias', certifications: 'Certificaciones', cases: 'Casos de éxito', faq: 'Preguntas frecuentes',
    featured: 'Productos destacados', viewAll: 'Ver todos los productos', viewDetails: 'Ver detalles',
    allCategories: 'Todas las categorías', searchPlaceholder: 'Buscar productos o modelos...',
    search: 'Buscar', noResults: 'No se encontraron productos con esos criterios.',
    sendInquiry: 'Enviar consulta / Solicitar cotización', yourName: 'Su nombre', email: 'Correo',
    company: 'Empresa', phone: 'Teléfono / WhatsApp', country: 'País', message: 'Mensaje',
    subject: 'Asunto', submit: 'Enviar consulta', cancel: 'Cancelar',
    description: 'Descripción del producto', specifications: 'Especificaciones',
    consent: 'Acepto la Política de Privacidad y el contacto sobre mi consulta.',
    success: '¡Gracias! Hemos recibido su consulta. Le responderemos en 24 horas.',
    failed: 'No se pudo enviar. Inténtelo de nuevo o escríbanos por correo.',
    aboutUs: 'Sobre nosotros', quickLinks: 'Enlaces rápidos', contactInfo: 'Contacto', followUs: 'Síguenos',
    adminLogin: 'Acceso admin',
    readMore: 'Leer más', allNews: 'Todas las noticias', publishedOn: 'Publicado el',
    lastUpdated: 'Actualizado el', relatedProducts: 'Productos relacionados',
    applications: 'Aplicaciones', customization: 'Personalización', samplePolicy: 'Política de muestras',
    leadTime: 'Plazo de entrega', downloads: 'Descargas', datasheet: 'Descargar ficha técnica',
    video: 'Vídeo del producto', whatsapp: 'Chatear por WhatsApp',
    ourFactory: 'Nuestra fábrica', ourCertifications: 'Certificaciones y cumplimiento',
    trustedBy: 'Confían en nosotros', ourCases: 'Casos de clientes',
    capabilities: 'Capacidad de producción', qualityControl: 'Control de calidad',
    contactUs: 'Contáctenos', getQuote: 'Solicitar cotización',
    attachment: 'Adjunto (plano / foto / especificación, máx. 5 MB)',
    required: 'Obligatorio', optional: 'Opcional',
    privacyPolicy: 'Política de privacidad', terms: 'Términos del servicio',
    theme: 'Tema de color',
    subscribePlaceholder: 'Correo para novedades de producto', subscribeCta: 'Suscribirse',
    subscribeOk: 'Casi listo — revisa tu bandeja para confirmar.',
    subscribeErr: 'No se pudo suscribir. Inténtalo de nuevo.',
  },
  ar: {
    home: 'الرئيسية', products: 'المنتجات', about: 'من نحن', contact: 'اتصل بنا',
    news: 'الأخبار', certifications: 'الشهادات', cases: 'حالات العملاء', faq: 'الأسئلة الشائعة',
    featured: 'منتجات مميزة', viewAll: 'عرض كل المنتجات', viewDetails: 'عرض التفاصيل',
    allCategories: 'كل الفئات', searchPlaceholder: 'ابحث عن منتجات أو طرازات...',
    search: 'بحث', noResults: 'لم يتم العثور على منتجات مطابقة.',
    sendInquiry: 'إرسال استفسار / طلب عرض سعر', yourName: 'الاسم', email: 'البريد الإلكتروني',
    company: 'الشركة', phone: 'الهاتف / واتساب', country: 'الدولة', message: 'الرسالة',
    subject: 'الموضوع', submit: 'إرسال الاستفسار', cancel: 'إلغاء',
    description: 'وصف المنتج', specifications: 'المواصفات',
    consent: 'أوافق على سياسة الخصوصية وأقبل التواصل بخصوص استفساري.',
    success: 'شكرًا لك! تم استلام استفسارك، سنرد خلال 24 ساعة.',
    failed: 'تعذر الإرسال. يرجى المحاولة مرة أخرى أو مراسلتنا مباشرة.',
    aboutUs: 'من نحن', quickLinks: 'روابط سريعة', contactInfo: 'معلومات الاتصال', followUs: 'تابعنا',
    adminLogin: 'دخول الإدارة',
    readMore: 'اقرأ المزيد', allNews: 'كل الأخبار', publishedOn: 'نُشر في',
    lastUpdated: 'آخر تحديث', relatedProducts: 'منتجات ذات صلة',
    applications: 'التطبيقات', customization: 'التخصيص', samplePolicy: 'سياسة العينات',
    leadTime: 'مدة التسليم', downloads: 'التحميلات', datasheet: 'تحميل ورقة البيانات',
    video: 'فيديو المنتج', whatsapp: 'تواصل عبر واتساب',
    ourFactory: 'مصنعنا', ourCertifications: 'الشهادات والامتثال',
    trustedBy: 'يثق بنا', ourCases: 'حالات العملاء',
    capabilities: 'القدرات الإنتاجية', qualityControl: 'مراقبة الجودة',
    contactUs: 'اتصل بنا', getQuote: 'اطلب عرض سعر',
    attachment: 'مرفق (رسم / صورة / مواصفات، بحد أقصى 5 ميغابايت)',
    required: 'مطلوب', optional: 'اختياري',
    privacyPolicy: 'سياسة الخصوصية', terms: 'شروط الخدمة',
    theme: 'سمة الألوان',
    subscribePlaceholder: 'بريدك لتصلك تحديثات المنتجات', subscribeCta: 'اشترك',
    subscribeOk: 'اقتربت — تحقق من بريدك للتأكيد.',
    subscribeErr: 'تعذّر الاشتراك. حاول مرة أخرى.',
  },
  zh: {
    home: '首页', products: '产品中心', about: '关于我们', contact: '联系我们',
    news: '新闻动态', certifications: '资质认证', cases: '客户案例', faq: '常见问题',
    featured: '精选产品', viewAll: '查看全部产品', viewDetails: '查看详情',
    allCategories: '全部分类', searchPlaceholder: '搜索产品或型号…',
    search: '搜索', noResults: '没有找到匹配的产品。',
    sendInquiry: '发送询盘 / 获取报价', yourName: '您的姓名', email: '电子邮箱',
    company: '公司名称', phone: '电话 / WhatsApp', country: '国家', message: '留言内容',
    subject: '主题', submit: '提交询盘', cancel: '取消',
    description: '产品描述', specifications: '技术参数',
    consent: '我同意隐私政策，并授权就我的询盘与我联系。',
    success: '感谢您！我们已收到您的询盘，将在 24 小时内回复。',
    failed: '提交失败，请重试或直接邮件联系我们。',
    aboutUs: '关于我们', quickLinks: '快速导航', contactInfo: '联系方式', followUs: '关注我们',
    adminLogin: '管理员登录',
    readMore: '阅读更多', allNews: '全部新闻', publishedOn: '发布于',
    lastUpdated: '最后更新', relatedProducts: '相关产品',
    applications: '应用领域', customization: '定制服务', samplePolicy: '样品政策',
    leadTime: '交货周期', downloads: '资料下载', datasheet: '下载产品手册',
    video: '产品视频', whatsapp: 'WhatsApp 在线咨询',
    ourFactory: '我们的工厂', ourCertifications: '认证与合规',
    trustedBy: '值得信赖', ourCases: '客户案例',
    capabilities: '产能概况', qualityControl: '质量控制',
    contactUs: '联系我们', getQuote: '获取报价',
    attachment: '附件（图纸 / 照片 / 规格，最大 5 MB）',
    required: '必填', optional: '选填',
    privacyPolicy: '隐私政策', terms: '服务条款',
    theme: '配色主题',
    subscribePlaceholder: '输入邮箱获取产品更新', subscribeCta: '订阅',
    subscribeOk: '即将完成 — 请检查邮箱确认订阅。',
    subscribeErr: '订阅失败，请重试。',
  },
  'zh-TW': {
    home: '首頁', products: '產品中心', about: '關於我們', contact: '聯絡我們',
    news: '最新消息', certifications: '資格認證', cases: '客戶案例', faq: '常見問題',
    featured: '精選產品', viewAll: '查看全部產品', viewDetails: '查看詳情',
    allCategories: '全部分類', searchPlaceholder: '搜尋產品或型號…',
    search: '搜尋', noResults: '沒有找到符合的產品。',
    sendInquiry: '傳送詢問 / 取得報價', yourName: '您的姓名', email: '電子信箱',
    company: '公司名稱', phone: '電話 / WhatsApp', country: '國家', message: '留言內容',
    subject: '主旨', submit: '送出詢問', cancel: '取消',
    description: '產品描述', specifications: '技術規格',
    consent: '我同意隱私權政策，並授權就我的詢問與我聯絡。',
    success: '感謝您！我們已收到您的詢問，將在 24 小時內回覆。',
    failed: '送出失敗，請重試或直接來信聯絡我們。',
    aboutUs: '關於我們', quickLinks: '快速連結', contactInfo: '聯絡資訊', followUs: '追蹤我們',
    adminLogin: '管理員登入',
    readMore: '閱讀更多', allNews: '全部新聞', publishedOn: '發布於',
    lastUpdated: '最後更新', relatedProducts: '相關產品',
    applications: '應用領域', customization: '客製化服務', samplePolicy: '樣品政策',
    leadTime: '交貨週期', downloads: '資料下載', datasheet: '下載產品手冊',
    video: '產品影片', whatsapp: 'WhatsApp 線上諮詢',
    ourFactory: '我們的工廠', ourCertifications: '認證與合規',
    trustedBy: '值得信賴', ourCases: '客戶案例',
    capabilities: '產能概況', qualityControl: '品質管理',
    contactUs: '聯絡我們', getQuote: '取得報價',
    attachment: '附件（圖紙 / 照片 / 規格，最大 5 MB）',
    required: '必填', optional: '選填',
    privacyPolicy: '隱私權政策', terms: '服務條款',
    theme: '配色主題',
    subscribePlaceholder: '輸入信箱接收產品更新', subscribeCta: '訂閱',
    subscribeOk: '即將完成 — 請檢查信箱確認訂閱。',
    subscribeErr: '訂閱失敗，請重試。',
  },
};

/** 国家/地区 → 推荐语言（只列有意义的，其余交给 Accept-Language） */
const COUNTRY_LANG = {
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', UY: 'es', BO: 'es', PY: 'es', CR: 'es', PA: 'es', DO: 'es', GT: 'es', HN: 'es', SV: 'es', NI: 'es', CU: 'es',
  SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar', JO: 'ar', LB: 'ar', IQ: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar', LY: 'ar', YE: 'ar', SD: 'ar',
  DE: 'de', AT: 'de', CH: 'de',
  FR: 'fr', BE: 'fr', LU: 'fr',
  RU: 'ru', BY: 'ru', KZ: 'ru',
  BR: 'pt', PT: 'pt', AO: 'pt', MZ: 'pt',
  JP: 'ja', KR: 'ko', CN: 'zh', HK: 'zh-TW', TW: 'zh-TW', MO: 'zh-TW',
  US: 'en', GB: 'en', AU: 'en', CA: 'en', NZ: 'en', IE: 'en', SG: 'en', IN: 'en', ZA: 'en', NG: 'en', PH: 'en', MY: 'en',
};

export function supportedLangs(env) {
  return (env?.SUPPORTED_LANGS || 'en,es,ar,zh,zh-TW').split(',').map(s => s.trim()).filter(Boolean);
}

/** 精确或地区标签匹配到受支持语言；匹配不到返回 null（不回落默认） */
function matchSupported(value, env) {
  const supported = supportedLangs(env);
  if (!value) return null;
  const lower = String(value).toLowerCase();
  return supported.find(l => l.toLowerCase() === lower)
    || supported.find(l => lower.startsWith(l.toLowerCase() + '-'))
    || null;
}

export function normalizeLang(value, env) {
  return matchSupported(value, env) || (env?.DEFAULT_LANG || 'en');
}

export function isRtl(lang) {
  return ['ar', 'he', 'fa', 'ur'].includes(lang);
}

export function localeOf(lang, env) {
  return LANG_META[lang]?.locale || lang || 'en-US';
}

export function currencyOf(lang, env) {
  return env?.DISPLAY_CURRENCY || LANG_META[lang]?.currency || 'USD';
}

/* ------------------------------ 本地化格式 ------------------------------ */

function safeDate(value) {
  if (!value) return null;
  // D1 返回 "2026-11-08 06:00:00"（UTC 无时区标记），补 Z 避免被当本地时间
  const s = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const d = value instanceof Date ? value : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** 本地化日期，默认 medium（2026年11月8日 / Nov 8, 2026 / ٨‏/١١‏/٢٠٢٦） */
export function formatDate(value, lang = 'en', options = {}) {
  const d = safeDate(value);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(localeOf(lang), {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC', ...options,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** 本地化日期+时间 */
export function formatDateTime(value, lang = 'en', options = {}) {
  return formatDate(value, lang, { hour: '2-digit', minute: '2-digit', ...options });
}

/** ISO 短日期（给 <time datetime> 用，保持机器可读） */
export function isoDate(value) {
  const d = safeDate(value);
  return d ? d.toISOString().slice(0, 10) : '';
}

export function formatNumber(value, lang = 'en', options = {}) {
  const n = Number(value);
  if (!isFinite(n)) return String(value ?? '');
  try {
    return new Intl.NumberFormat(localeOf(lang), options).format(n);
  } catch {
    return String(n);
  }
}

export function formatPercent(value, lang = 'en', fractionDigits = 0) {
  const n = Number(value);
  if (!isFinite(n)) return '';
  try {
    return new Intl.NumberFormat(localeOf(lang), {
      style: 'percent', minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
    }).format(n);
  } catch {
    return `${(n * 100).toFixed(fractionDigits)}%`;
  }
}

/** 本地化货币；amount 为最小货币单位（如分）时传 minorUnits=true */
export function formatCurrency(amount, lang = 'en', currency, options = {}) {
  const n = Number(amount);
  if (!isFinite(n)) return '';
  const cur = currency || currencyOf(lang);
  try {
    return new Intl.NumberFormat(localeOf(lang), {
      style: 'currency', currency: cur, ...options,
    }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`;
  }
}

/* ------------------------------ 语言协商 ------------------------------ */

/** 解析 Cookie 头为对象 */
export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

/** 按 q 值解析 Accept-Language，返回按优先级排列的语言标签 */
export function parseAcceptLanguage(header) {
  return String(header || '')
    .split(',')
    .map(part => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find(p => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.split('=')[1]) : 1;
      return { tag: tag.trim().toLowerCase(), q: isNaN(q) ? 0 : q };
    })
    .filter(x => x.tag && x.tag !== '*')
    .sort((a, b) => b.q - a.q)
    .map(x => x.tag);
}

/** 从 Accept-Language 里挑第一个受支持的语言 */
export function negotiateLang(acceptLanguage, env) {
  const supported = supportedLangs(env);
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    if (supported.includes(tag)) return tag;
    const base = tag.split('-')[0];
    if (supported.includes(base)) return base;
  }
  return null;
}

/** 国家（cf.country，ISO-3166 alpha-2）→ 受支持语言 */
export function countryToLang(country, env) {
  if (!country) return null;
  const mapped = COUNTRY_LANG[String(country).toUpperCase()];
  if (!mapped) return null;
  return supportedLangs(env).includes(mapped) ? mapped : null;
}

/**
 * 计算本次请求应使用的语言。
 * 优先级：?lang= 显式指定 > cookie 记忆 > cf.country > Accept-Language > 默认
 * 返回 { lang, source }，source 便于调试与埋点。
 */
export function pickLang(request, env, url) {
  const supported = supportedLangs(env);
  const def = env?.DEFAULT_LANG || 'en';

  const explicit = url?.searchParams?.get('lang');
  if (explicit) {
    const lang = matchSupported(explicit, env);
    if (lang) return { lang, source: 'query' };
    // 不支持的语言标签忽略，继续按 cookie / 国家 / 请求头判断
  }

  const cookies = parseCookies(request?.headers?.get('Cookie'));
  if (cookies[LANG_COOKIE]) {
    const lang = matchSupported(cookies[LANG_COOKIE], env);
    if (lang) return { lang, source: 'cookie' };
  }

  // cf.country 是 Workers 运行时字段；CF-IPCountry 是等价请求头（Cloudflare 会覆盖客户端伪造值，
  // 本地 miniflare 只提供后者，所以两个都读）
  const country = request?.cf?.country || request?.headers?.get('CF-IPCountry');
  const byCountry = countryToLang(country, env);
  if (byCountry) return { lang: byCountry, source: 'country' };

  const byHeader = negotiateLang(request?.headers?.get('Accept-Language'), env);
  if (byHeader) return { lang: byHeader, source: 'accept-language' };

  return { lang: def, source: 'default' };
}

/** 生成 Set-Cookie 值（一年有效，SameSite=Lax，非敏感） */
export function langCookie(lang) {
  return `${LANG_COOKIE}=${encodeURIComponent(lang)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** 爬虫 / 预取请求不应被 302 到别的语言，否则索引会乱 */
export function isBotRequest(request) {
  const ua = (request?.headers?.get('User-Agent') || '').toLowerCase();
  if (!ua) return false;
  return /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|headlesschrome|lighthouse/.test(ua);
}

/* ------------------------------ 路径与链接 ------------------------------ */

/** 返回 { lang, path }：/es/products/12 -> { lang:'es', path:'/products/12' } */
export function parseLocalizedPath(pathname, env) {
  const def = env?.DEFAULT_LANG || 'en';
  const supported = supportedLangs(env);
  const seg = pathname.split('/').filter(Boolean)[0];
  if (supported.includes(seg) && seg !== def) {
    return { lang: seg, path: '/' + pathname.split('/').filter(Boolean).slice(1).join('/') || '/' };
  }
  return { lang: def, path: pathname || '/' };
}

export function localizedUrl(path, lang, env) {
  const def = env?.DEFAULT_LANG || 'en';
  const clean = path === '/' ? '/' : path.replace(/\/+$/, '');
  return lang === def ? clean : `/${lang}${clean === '/' ? '/' : clean}`;
}

export function t(lang, key) {
  return (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key;
}

/** 生成 hreflang / alternate 标签（含 x-default） */
export function hreflangTags(siteUrl, path, env) {
  const langs = supportedLangs(env);
  const def = env?.DEFAULT_LANG || 'en';
  const base = (env?.SITE_URL && !env.SITE_URL.startsWith('REPLACE_') ? env.SITE_URL : siteUrl || '').replace(/\/$/, '');
  const tags = langs.map(l =>
    `<link rel="alternate" hreflang="${l}" href="${base}${localizedUrl(path, l, env)}">`
  );
  tags.push(`<link rel="alternate" hreflang="x-default" href="${base}${localizedUrl(path, def, env)}">`);
  return tags.join('\n  ');
}

/** 语言切换项：保留当前页面路径，而不是都跳回首页 */
export function langSwitchItems(path, currentLang, env) {
  return supportedLangs(env).map(code => ({
    code,
    label: LANG_META[code]?.flag || code.toUpperCase(),
    name: LANG_META[code]?.name || code,
    href: localizedUrl(path, code, env),
    active: code === currentLang,
    rtl: isRtl(code),
  }));
}

/** 按语言取产品字段，缺翻译回退英文 */
export function localizedProduct(product, lang, field) {
  // 用 parseJsonLoose 而非裸 JSON.parse：历史上库里存在双层编码的
  // translations（"{\"es\":...}"），只 parse 一次会拿到字符串，
  // translations['es'] 恒为 undefined —— 译文静默失效，页面看起来正常。
  const translations = parseJsonLoose(product && product.translations, {});
  const v = translations?.[lang]?.[field];
  return (v && String(v).trim()) ? v : (product[field] || '');
}

/** 翻译覆盖率：后台用来提示"哪些语种还没翻译" */
export function translationCoverage(product, env) {
  const tr = parseJsonLoose(product && product.translations, {});
  const fields = ['name', 'description', 'detailed_description', 'seo_title', 'seo_description'];
  return supportedLangs(env).map(code => {
    const filled = fields.filter(f => tr?.[code]?.[f] && String(tr[code][f]).trim()).length;
    return { code, filled, total: fields.length, complete: filled === fields.length };
  });
}
