/**
 * Settings API Handler
 * Handles website settings stored in Cloudflare KV
 */

import { requireSuperAdmin } from './admin';
import { getTemplates, saveTemplates, resetTemplates, TEMPLATE_DEFAULTS, TEMPLATE_META } from '../../mail-templates';
import {
  stripTranslationKeys, safeTranslationConfig, loadTranslationConfig, readSettings,
  normalizeBaseUrl, normalizeTemperature, normalizeModelName, sealSecret, ENGINES,
} from '../../utils/translation-config.js';
import { testTranslationEngine } from '../../utils/translation-engine.js';

const SETTINGS_KEY = 'website_settings';
/** 前端已配置密钥时用这个占位值回显，后端收到它 = 保持原密钥不变 */
const KEEP_SECRET = '__KEEP__';

/** 允许通过 API 写入的键（新增设置项时同步这里，否则会被保存逻辑丢掉） */
const ALLOWED_KEYS = [
  'site_name', 'site_description', 'company_intro', 'email', 'phone', 'address',
  'linkedin', 'facebook', 'twitter',
  // 阶段一C
  'whatsapp', 'ga4_id',
  // 阶段一B About 页 Quick Facts
  'founded_at', 'employees', 'countries_served', 'annual_capacity',
  // 阶段四 页面级 SEO
  'seo_pages', 'seo_og_image',
  // 阶段五 收款与营业信息：orders.js 的 PDF / Stripe 降级分支已经在读这几个键，
  // 但白名单里一直没有 —— 结果是运营永远填不进去，单据永远是「请联系销售」。
  'beneficiary', 'bank_name', 'bank_account', 'swift', 'business_hours',
  // 主题：全站默认配色。访客在导航上手动切换后以 localStorage 为准，
  // 这里配的是「没选过的人第一次进来看到什么」。
  'theme_default',
];

/** 可选主题必须与 layout.js 的 html[data-theme="…"] 一致，白名单外的值一律回落到 classic */
const THEME_KEYS = ['classic', 'ocean', 'ember', 'forest', 'midnight', 'mono', 'auto'];

function sanitizeTheme(value) {
  const key = String(value || '').trim().toLowerCase();
  return THEME_KEYS.includes(key) ? key : 'classic';
}

/** 页面级 SEO 只认这 7 个一级页；详情页走产品/文章自己的字段 */
const SEO_PAGE_KEYS = ['/', '/products', '/cases', '/news', '/about', '/contact', '/faq'];

/**
 * 清洗 seo_pages：只保留已知页面、只保留 3 个字段，并限长。
 * 不做这一步的话，后台一个手滑就能把几 MB 的 JSON 塞进 KV 读到爆。
 */
function sanitizeSeoPages(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const page of SEO_PAGE_KEYS) {
    const src = input[page];
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    const item = {};
    const title = typeof src.title === 'string' ? src.title.trim().slice(0, 120) : '';
    const description = typeof src.description === 'string' ? src.description.trim().slice(0, 300) : '';
    const ogImage = typeof src.og_image === 'string' ? src.og_image.trim().slice(0, 500) : '';
    if (title) item.title = title;
    if (description) item.description = description;
    if (ogImage) item.og_image = ogImage;
    // 三项都空的页面不落库，避免 KV 里堆一堆空对象
    if (Object.keys(item).length) out[page] = item;
  }
  return out;
}

export async function handleSettings(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 翻译引擎配置：单独走超管接口，绝不混进公开的 /api/settings
  if (path === '/api/settings/translation/test') {
    return handleTranslationTest(request, env, corsHeaders, method);
  }
  if (path === '/api/settings/translation') {
    return handleTranslationSettings(request, env, corsHeaders, method);
  }

  // 邮件模板（阶段二C）：运营可自行改话术，不用重新部署
  if (path === '/api/settings/mail-templates') {
    return handleMailTemplates(request, env, corsHeaders, method);
  }

  // GET /api/settings - Get all settings
  if (method === 'GET') {
    return getSettings(env, corsHeaders);
  }

  // POST /api/settings - Update settings (Super Admin only)
  if (method === 'POST') {
    return updateSettings(request, env, corsHeaders);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Get settings from KV
async function getSettings(env, corsHeaders) {
  try {
    const settingsJson = await env.STATIC_ASSETS.get(SETTINGS_KEY);

    let settings = {};
    if (settingsJson) {
      settings = JSON.parse(settingsJson);
    } else {
      // Default settings if not found
      settings = {
        site_name: 'GlobalMart',
        site_description: 'Your trusted partner for high-quality industrial products and innovative solutions worldwide',
        company_intro: 'We are a leading manufacturer and supplier of high-quality industrial products. With over 20 years of experience, we serve clients across the globe with innovative solutions and exceptional customer service.',
        email: 'info@example.com',
        phone: '+1 234 567 8900',
        address: '123 Business St, City, Country',
        linkedin: '',
        facebook: '',
        twitter: '',
      };
    }

    // 公开接口：translation_* 里可能有加密后的模型密钥，一个都不能露出去
    return new Response(JSON.stringify({ success: true, data: stripTranslationKeys(settings) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Update settings in KV (Super Admin only)
async function updateSettings(request, env, corsHeaders) {
  try {
    // Check if user is super admin
    const admin = await requireSuperAdmin(request, env);
    if (!admin) {
      return new Response(JSON.stringify({
        error: 'Unauthorized. Super admin access required.'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await request.json();

    // 原版是「白名单重建」：只保留 9 个字段，任何新增项（GA4 / WhatsApp / 工厂数据）
    // 都会在下一次保存设置时被静默抹掉。改为在现有设置上做局部合并。
    let existing = {};
    try {
      existing = JSON.parse((await env.STATIC_ASSETS.get(SETTINGS_KEY)) || '{}') || {};
    } catch { existing = {}; }

    const settings = { ...existing };
    for (const key of ALLOWED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      // seo_pages 是嵌套对象，必须走白名单清洗，不能按字符串处理
      if (key === 'seo_pages') {
        settings.seo_pages = sanitizeSeoPages(data.seo_pages);
        continue;
      }
      // 主题只认 6 个已知 key：写错一个字母就整站变成默认蓝，很难查
      if (key === 'theme_default') {
        settings.theme_default = sanitizeTheme(data.theme_default);
        continue;
      }
      const v = data[key];
      settings[key] = typeof v === 'string' ? v.trim().slice(0, 2000) : v;
    }
    settings.site_name = settings.site_name || 'GlobalMart';
    settings.updated_at = new Date().toISOString();

    // Save to KV
    await env.STATIC_ASSETS.put(SETTINGS_KEY, JSON.stringify(settings));

    return new Response(JSON.stringify({
      success: true,
      message: 'Settings saved successfully',
      data: stripTranslationKeys(settings)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

/* ---------------- 翻译引擎设置（1.4.0） ---------------- */

function settingsJson(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

/**
 * GET  /api/settings/translation  → 引擎配置（密钥只回「是否已设置」，永不回明文/密文）
 * POST /api/settings/translation  → 保存配置（密钥 AES-GCM 加密后落 KV）
 *
 * 公开的 /api/settings 会剔除全部 translation_* 键；这里必须 requireSuperAdmin。
 */
async function handleTranslationSettings(request, env, corsHeaders, method) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return settingsJson({ error: 'Unauthorized. Super admin access required.' }, 403, corsHeaders);

  if (method === 'GET') {
    const cfg = await loadTranslationConfig(env);
    return settingsJson({ success: true, data: safeTranslationConfig(cfg) }, 200, corsHeaders);
  }
  if (method !== 'POST') return settingsJson({ error: 'Method not allowed' }, 405, corsHeaders);

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return settingsJson({ error: 'Invalid JSON' }, 400, corsHeaders);

    const engine = ENGINES.includes(body.engine) ? body.engine : 'workers_ai';
    const settings = await readSettings(env);

    let baseUrl = '';
    let model = '';
    let temperature = 0.2;
    if (engine === 'openai') {
      // SSRF 校验放在服务端，前端校验只是体验
      baseUrl = normalizeBaseUrl(body.base_url);
      model = normalizeModelName(body.model);
      if (!model) return settingsJson({ error: '模型名不合法（只允许字母、数字、点、下划线、冒号、连字符）' }, 400, corsHeaders);
      temperature = normalizeTemperature(body.temperature);
    }

    // 空 / 掩码 / __KEEP__ = 保持原密钥；clear_api_key=true 才删
    const incoming = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    const cleared = body.clear_api_key === true;
    if (cleared) {
      delete settings.translation_api_key;
    } else if (incoming && incoming !== KEEP_SECRET && !/^[•*]+$/.test(incoming)) {
      settings.translation_api_key = await sealSecret(incoming.slice(0, 500), env);
    }
    // 首次启用自定义引擎必须有 key；但「主动清除」是合法操作（之后翻译会明确报配置不完整）
    if (engine === 'openai' && !settings.translation_api_key && !cleared) {
      return settingsJson({ error: '自定义引擎需要先填写 API Key' }, 400, corsHeaders);
    }

    settings.translation_engine = engine;
    settings.translation_base_url = baseUrl;
    settings.translation_model = model;
    settings.translation_temperature = temperature;
    settings.updated_at = new Date().toISOString();
    await env.STATIC_ASSETS.put(SETTINGS_KEY, JSON.stringify(settings));

    const cfg = await loadTranslationConfig(env);
    return settingsJson({ success: true, data: safeTranslationConfig(cfg) }, 200, corsHeaders);
  } catch (e) {
    // normalizeBaseUrl / sealSecret 抛出的消息都可直接给运营看
    return settingsJson({ error: e.message }, 400, corsHeaders);
  }
}

/**
 * POST /api/settings/translation/test —— 「测试连接」。
 * 支持先测后存：body 带表单值就按表单值测，不带就按已保存配置测。
 * 会真实调用一次模型（花额度/钱），所以必须超管。
 */
async function handleTranslationTest(request, env, corsHeaders, method) {
  if (method !== 'POST') return settingsJson({ error: 'Method not allowed' }, 405, corsHeaders);
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return settingsJson({ error: 'Unauthorized. Super admin access required.' }, 403, corsHeaders);

  const body = await request.json().catch(() => null) || {};
  const saved = await loadTranslationConfig(env, { includeSecret: true });
  const engine = ENGINES.includes(body.engine) ? body.engine : saved.engine;

  let cfg;
  try {
    if (engine === 'openai') {
      const baseUrl = normalizeBaseUrl(body.base_url || saved.baseUrl);
      const model = normalizeModelName(body.model || saved.model);
      if (!model) throw new Error('模型名不合法或为空');
      const supplied = typeof body.api_key === 'string' ? body.api_key.trim() : '';
      const apiKey = (supplied && supplied !== KEEP_SECRET && !/^[•*]+$/.test(supplied))
        ? supplied.slice(0, 500) : saved.apiKey;
      cfg = {
        engine: 'openai', baseUrl, model, apiKey,
        temperature: normalizeTemperature(body.temperature ?? saved.temperature),
      };
    } else {
      cfg = { ...saved, engine: 'workers_ai' };
    }
  } catch (e) {
    return settingsJson({ success: false, error: e.message }, 400, corsHeaders);
  }

  const result = await testTranslationEngine(env, cfg);
  return settingsJson(
    { success: result.ok, data: result, ...(result.ok ? {} : { error: result.error }) },
    result.ok ? 200 : 502,
    corsHeaders,
  );
}

/* ---------------- 邮件模板（阶段二C） ---------------- */

async function handleMailTemplates(request, env, corsHeaders, method) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized. Super admin required.' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    if (method === 'GET') {
      return new Response(JSON.stringify({
        success: true,
        data: await getTemplates(env),
        defaults: TEMPLATE_DEFAULTS,
        meta: TEMPLATE_META,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const saved = await saveTemplates(env, body);
      return new Response(JSON.stringify({ success: true, data: await getTemplates(env), saved }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (method === 'DELETE') {
      await resetTemplates(env);
      return new Response(JSON.stringify({ success: true, data: await getTemplates(env) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
