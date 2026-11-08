/**
 * 翻译引擎调用层：Workers AI 内置模型 / 任意 OpenAI 兼容端点，二选一。
 *
 * 这一层不碰 Request/Response、不碰 D1，只负责「给一段文本 → 返回译文」，
 * 因此 /api/translate 与 /api/settings/translation/test 可以共用同一套逻辑。
 */

export const M2M_MODEL = '@cf/meta/m2m100-1.2b';
export const DEFAULT_MODEL = 'gpt-4o-mini';

const LANG_LABELS = {
  en: 'English', es: 'Spanish (Español)', ar: 'Arabic (العربية)',
  zh: 'Simplified Chinese (简体中文)', 'zh-TW': 'Traditional Chinese used in Taiwan (繁體中文)',
  de: 'German', fr: 'French', ru: 'Russian', pt: 'Portuguese', ja: 'Japanese', ko: 'Korean',
};

const SYSTEM_PROMPT = `You are a professional translator for B2B industrial product catalogues.
Translate the user's text from {FROM} to {TO}.
Rules:
- Output ONLY the translated text. No explanation, no preamble, no quotes, no markdown code fences.
- Keep placeholders such as __B2BK0__ EXACTLY as written, including the underscores and digits.
- Keep product model numbers, certification codes, units, URLs and email addresses unchanged.
- Preserve line breaks and paragraph structure.
- Do not translate or rewrite anything that is already a proper noun or a trademark.`;

export function systemPrompt(sourceLang, targetLang) {
  return SYSTEM_PROMPT
    .replace('{FROM}', LANG_LABELS[sourceLang] || sourceLang)
    .replace('{TO}', LANG_LABELS[targetLang] || targetLang);
}

function timeoutSignal(ms) {
  try { return AbortSignal.timeout(ms); } catch {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  }
}

/** Cloudflare Workers AI 内置 m2m100；本地 --local 模式下 env.AI 可能不存在 */
export async function callWorkersAI(env, text, sourceLang, targetLang) {
  const out = await env.AI.run(M2M_MODEL, {
    text,
    source_lang: sourceLang,
    target_lang: targetLang,
  });
  if (typeof out === 'string') return out;
  const value = (out && (out.translated_text || out.translation || out.text)) || '';
  if (!value) throw new Error('Workers AI 返回空译文');
  return value;
}

/** OpenAI 兼容 /chat/completions；兼容 OpenAI / DeepSeek / OpenRouter / AI Gateway 等 */
export async function callOpenAICompatible(cfg, text, sourceLang, targetLang) {
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model || DEFAULT_MODEL,
      stream: false,
      temperature: cfg.temperature ?? 0.2,
      messages: [
        { role: 'system', content: systemPrompt(sourceLang, targetLang) },
        { role: 'user', content: text },
      ],
    }),
    signal: timeoutSignal(20000),
  });

  if (!res.ok) {
    // 上游错误体可能很长，截断后再回；绝不把 Authorization 头带进去
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`上游返回 HTTP ${res.status}${detail ? `：${detail}` : ''}`);
  }

  const payload = await res.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('响应里没有 choices[0].message.content（确认端点是否兼容 /chat/completions）');
  }
  // 有些模型爱裹 ``` 代码块。只认「成对围栏」，
  // 不能用 /^```[\w-]*/ 去猜语言标签 —— 紧凑格式 ```Bomba de prueba``` 里的
  // "Bomba" 会被当成语言标签吃掉，译文就缺了第一个词。
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
  if (fenced) return fenced[1].trim();
  if (/^```[^`]*```$/.test(trimmed)) return trimmed.slice(3, -3).trim();
  return trimmed;
}

/**
 * 根据后台配置挑引擎。pureLocal（zh → zh-TW）时直接走本地转换，不产生任何外部调用。
 * 返回 { available, reason, kind, label, call }；available=false 时 reason 可直接展示给运营。
 */
export function buildEngine(env, cfg, { pureLocal = false } = {}) {
  if (pureLocal) {
    return {
      available: true,
      kind: 'local',
      label: 'local-zh-tw',
      call: async (text) => text,
    };
  }

  if (cfg.engine === 'openai') {
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
      return {
        available: false, kind: 'openai', label: `openai:${cfg.model || DEFAULT_MODEL}`,
        reason: '自定义模型配置不完整：需要 API Base URL、模型名和 API Key',
      };
    }
    return {
      available: true, kind: 'openai', label: `openai:${cfg.model}`,
      call: (text, sourceLang, targetLang) => callOpenAICompatible(cfg, text, sourceLang, targetLang),
    };
  }

  if (!env.AI) {
    return {
      available: false, kind: 'workers_ai', label: M2M_MODEL,
      reason: 'Workers AI 不可用：确认 wrangler.toml 有 [ai] binding = "AI"；本地 wrangler dev --local 不支持 AI，请改用 --remote 或部署到线上',
    };
  }
  return {
    available: true, kind: 'workers_ai', label: M2M_MODEL,
    call: (text, sourceLang, targetLang) => callWorkersAI(env, text, sourceLang, targetLang),
  };
}

/** 后台「测试连接」：翻一句极短的固定文本，返回结构化结果（不抛异常给前端） */
export async function testTranslationEngine(env, cfg) {
  const engine = buildEngine(env, cfg);
  if (!engine.available) return { ok: false, engine: engine.kind, model: engine.label, error: engine.reason };

  const started = Date.now();
  try {
    const sample = await engine.call('Stainless steel centrifugal pump, model HR-CP100.', 'en', 'es');
    return {
      ok: true,
      engine: engine.kind,
      model: engine.label,
      latencyMs: Date.now() - started,
      sample: String(sample).slice(0, 200),
    };
  } catch (e) {
    return {
      ok: false, engine: engine.kind, model: engine.label,
      latencyMs: Date.now() - started,
      error: e?.message || '调用失败',
    };
  }
}
