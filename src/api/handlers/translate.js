/**
 * 后台「一键生成译文」API —— POST /api/translate
 *
 * 双引擎（后台 Settings → Translation Engine 可切换，存 KV）：
 *  A. Workers AI 内置 @cf/meta/m2m100-1.2b —— 默认，零 API Key、10,000 Neurons/天免费
 *  B. 任意 OpenAI 兼容 /chat/completions 端点 —— 自定义 base_url / model / api_key
 *
 * 三条设计约束（都是这个项目的实际约束，不是通用模板）：
 *  1. **不写库**。只返回译文，由后台填进多语言 Tab，人工核对后点「保存」才落 D1。
 *     机器翻译直接入库 = 型号被翻错、SEO 标题变味，且没有回滚路径。
 *  2. **一次请求只翻一个目标语种**。免费版 Worker 单请求 10ms CPU +
 *     模型对长文有长度上限，4 个语种一次做完容易超时；前端串行调用 + 进度条。
 *  3. **写入侧只认 toJsonColumn()**。本项目踩过 translations 双层 JSON.stringify
 *     的坑（前台静默回退英文），保存逻辑在 admin-*.js，本 handler 完全不碰 D1。
 *
 * zh-TW 特殊处理：m2m100 只有 `zh`，不区分简繁；两种引擎都沿用这套本地转换，
 *   - 中文 → 繁中：走简繁 + 台湾用词转换表，不调模型（更准、不花额度）
 *   - 英文/其它 → 繁中：先翻成简体中文，再转繁体
 *
 * 注意：`wrangler dev --local` 下 AI binding 是 `not supported`，自定义 OpenAI 引擎在本地仍可用。
 */
import { requireAuth } from '../../utils/auth';
import { supportedLangs } from '../../i18n';
import {
  m2mLang, isTraditionalTarget, toTraditional,
  protectTerms, restoreTerms, splitText, joinParts, cleanFields,
} from '../../utils/translate';
import { loadTranslationConfig } from '../../utils/translation-config.js';
import { buildEngine } from '../../utils/translation-engine.js';

const MAX_FIELDS = 12;
const MAX_FIELD_LEN = 4000;
const MAX_PARTS = 5;
const PART_CHARS = 600;


function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

/** 字段名只允许小写字母和下划线，防止前端塞进任意键把额度烧光 */
function validFieldNames(fields) {
  return Object.keys(fields).filter(k => /^[a-z_]{1,40}$/.test(k)).slice(0, MAX_FIELDS);
}

/**
 * 翻一个字段：术语保护 → 分段 → 逐段调引擎 → 还原术语 → 简繁转换 → 拼接
 * 单个字段失败不影响其它字段，失败的名字回给前端提示。
 */
async function translateField(engine, raw, sourceLang, targetLang, glossary) {
  const directTw = isTraditionalTarget(targetLang) && sourceLang === 'zh';
  const needTw = isTraditionalTarget(targetLang);

  const protectedText = protectTerms(raw, glossary);
  const parts = splitText(protectedText.text, PART_CHARS, MAX_PARTS);

  const done = [];
  for (const part of parts) {
    let piece;
    if (directTw) {
      // 中文 → 繁中：纯本地转换，不花额度，也不会被模型改写型号
      piece = part;
    } else {
      piece = await engine.call(part, m2mLang(sourceLang), m2mLang(targetLang));
      if (!piece) throw new Error('empty model output');
    }
    done.push(needTw ? toTraditional(piece) : piece);
  }

  return restoreTerms(joinParts(done, targetLang), protectedText.tokens);
}

export async function handleTranslate(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  // 翻译要花额度，不能是匿名接口
  const admin = await requireAuth(request, env);
  if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body' }, 400, corsHeaders);

  const langs = supportedLangs(env);
  const sourceLang = String(body.sourceLang || '').trim();
  const target = String(body.target || '').trim();
  if (!langs.includes(sourceLang) || !langs.includes(target)) {
    return json({ error: 'Unsupported language', supported: langs }, 400, corsHeaders);
  }
  if (sourceLang === target) {
    return json({ success: true, data: { translations: {}, skipped: [], engine: 'none' } }, 200, corsHeaders);
  }

  const mode = body.mode === 'overwrite' ? 'overwrite' : 'fill';
  const existing = (body.existing && typeof body.existing === 'object' && !Array.isArray(body.existing))
    ? body.existing : {};

  const fields = cleanFields(body.fields, validFieldNames(body.fields || {}), MAX_FIELD_LEN);
  const names = Object.keys(fields);
  if (!names.length) return json({ success: true, data: { translations: {}, skipped: [], engine: 'none' } }, 200, corsHeaders);

  // fill 模式：已有人工译文的字段直接跳过，不花额度也不返回
  const skipped = mode === 'fill'
    ? names.filter(k => String(existing[k] || '').trim())
    : [];
  const todo = names.filter(k => !skipped.includes(k));

  // 中文 → 繁中完全不需要外部模型；其余路径按后台配置挑引擎
  const pureLocal = isTraditionalTarget(target) && sourceLang === 'zh';
  const cfg = await loadTranslationConfig(env, { includeSecret: true });
  const engine = buildEngine(env, cfg, { pureLocal });
  if (!engine.available) {
    return json({ error: engine.reason }, 503, corsHeaders);
  }

  // 术语表：后台可在 KV 的 website_settings.translation_glossary 配
  // 形如 [{ "src": "Hengrui", "keep": true }, { "src": "恒瑞", "dst": "Hengrui", "keep": false }]
  let glossary = [];
  try {
    const raw = await env.STATIC_ASSETS.get('website_settings');
    const settings = raw ? JSON.parse(raw) : {};
    if (Array.isArray(settings.translation_glossary)) glossary = settings.translation_glossary.slice(0, 100);
  } catch { /* KV 不可用就用默认空表 */ }

  const translations = {};
  const failed = [];
  // 串行而不是 Promise.all：模型有速率限制（Workers AI 7505），
  // 6 个字段并发打过去容易触发限流；这里的耗时主要是 I/O 等待，不占 10ms CPU 预算。
  for (const name of todo) {
    try {
      const value = await translateField(engine, fields[name], sourceLang, target, glossary);
      if (value) translations[name] = value;
      else failed.push(name);
    } catch (e) {
      failed.push(name);
      console.error('translate field failed', name, e?.message || e);
    }
  }

  // 全部字段都失败且不是「本来就都跳过」→ 视为上游故障，让前端能明确提示
  if (todo.length && failed.length === todo.length) {
    return json({
      error: '翻译服务调用失败，请稍后重试或检查 Workers AI 额度与绑定。',
      failed,
    }, 502, corsHeaders);
  }

  return json({
    success: true,
    data: {
      translations,
      skipped,
      failed,
      engine: engine.label,
      target,
      sourceLang,
    },
  }, 200, corsHeaders);
}
