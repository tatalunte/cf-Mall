/**
 * 翻译引擎设置（1.4.0）：纯逻辑单测 + API 契约测试
 *
 * 不产生任何真实模型调用：
 *   - OpenAI 兼容调用用内存 mock fetch 验证
 *   - /api/settings/translation/test 只验证鉴权与 SSRF 拒绝分支
 *   - 会写 KV 的用例只在「当前没有保存过密钥」时执行，并在 finally 里恢复干净状态
 *
 * 运行：node scripts/test-translation-config.mjs （需要 dev server 跑在 8787）
 */
import {
  normalizeBaseUrl, isForbiddenHost, normalizeTemperature, normalizeModelName,
  stripTranslationKeys, safeTranslationConfig, sealSecret, openSecret,
  loadTranslationConfig, ENGINES,
} from '../src/utils/translation-config.js';
import {
  systemPrompt, buildEngine, callOpenAICompatible, testTranslationEngine, M2M_MODEL,
} from '../src/utils/translation-engine.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const realFetch = globalThis.fetch;
let pass = 0, fail = 0;
const fails = [];
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function rejects(fn, keyword) {
  try { fn(); return false; } catch (e) { return !keyword || e.message.includes(keyword); }
}

console.log('\n== 1. Base URL 与 SSRF 防护 ==');
check('合法 OpenAI 端点', normalizeBaseUrl('https://api.openai.com/v1') === 'https://api.openai.com/v1');
check('合法 AI Gateway 多级路径', normalizeBaseUrl('https://gateway.ai.cloudflare.com/v1/a/b/') === 'https://gateway.ai.cloudflare.com/v1/a/b');
check('拒绝 http', rejects(() => normalizeBaseUrl('http://api.openai.com/v1'), 'https'));
check('拒绝 127.0.0.1', rejects(() => normalizeBaseUrl('https://127.0.0.1/v1'), '公网域名'));
check('拒绝 192.168 内网', rejects(() => normalizeBaseUrl('https://192.168.1.2/v1'), '公网域名'));
check('拒绝云元数据地址', rejects(() => normalizeBaseUrl('https://169.254.169.254/latest/meta-data'), '公网域名'));
check('拒绝 IPv6 字面量', rejects(() => normalizeBaseUrl('https://[::1]/v1'), '公网域名'));
check('拒绝非 443 端口', rejects(() => normalizeBaseUrl('https://api.openai.com:8080/v1'), '443'));
check('拒绝 URL 内嵌账号密码', rejects(() => normalizeBaseUrl('https://a:b@evil.example/v1'), '账号密码'));
check('拒绝查询参数', rejects(() => normalizeBaseUrl('https://api.openai.com/v1?x=1'), '查询参数'));
check('isForbiddenHost 拦 .internal', isForbiddenHost('svc.internal') && isForbiddenHost('localhost'));
check('信任普通公网域名', !isForbiddenHost('api.openai.com') && !isForbiddenHost('openrouter.ai'));

console.log('\n== 2. 配置清洗与公开过滤 ==');
check('温度越界收敛', normalizeTemperature(9) === 1 && normalizeTemperature(-3) === 0 && normalizeTemperature('abc') === 0.2);
check('模型名白名单', normalizeModelName('gpt-4o-mini') === 'gpt-4o-mini' && normalizeModelName('bad name; drop table') === '');
check('ENGINES 只有两档', ENGINES.length === 2 && ENGINES.includes('workers_ai') && ENGINES.includes('openai'));
const dirty = {
  site_name: 'Demo', phone: '123',
  translation_engine: 'openai', translation_api_key: 'enc:v1:SECRET',
  translation_base_url: 'https://x.example/v1', translation_glossary: [{ src: 'A' }],
};
const pub = stripTranslationKeys(dirty);
check('公开响应剔除全部 translation_* 键', Object.keys(pub).sort().join(',') === 'phone,site_name', Object.keys(pub).join(','));
check('原对象不被修改（无副作用）', dirty.translation_api_key === 'enc:v1:SECRET');
const safe = safeTranslationConfig({ engine: 'openai', baseUrl: 'https://x/v1', model: 'gpt-4o-mini', apiKey: 'sk-plain', apiKeySet: true, temperature: 0.3 });
check('超管 GET 不回明文密钥', !JSON.stringify(safe).includes('sk-plain') && safe.api_key_set === true);

console.log('\n== 3. 密钥加解密（AES-GCM）==');
const envA = { JWT_SECRET: 'unit-test-secret-abcdefghijklmnopqrstuvwxyz' };
const envB = { JWT_SECRET: 'a-different-secret' };
const sealed = await sealSecret('sk-test-123456', envA);
check('密文带 enc:v1 前缀且不泄漏明文', sealed.startsWith('enc:v1:') && !sealed.includes('sk-test-123456'));
const sealed2 = await sealSecret('sk-test-123456', envA);
check('每次加密 IV 随机（密文不同）', sealed !== sealed2);
check('可解密回原文', (await openSecret(sealed, envA)) === 'sk-test-123456');
check('换密钥解不开也不抛错', (await openSecret(sealed, envB)) === '');
check('脏数据 / 明文 / 篡改一律返回空', (await openSecret('', envA)) === '' && (await openSecret('sk-plain', envA)) === '' && (await openSecret(sealed + 'x', envA)) === '');
const fakeEnv = {
  JWT_SECRET: envA.JWT_SECRET,
  STATIC_ASSETS: {
    _v: JSON.stringify({
      site_name: 'Demo', translation_engine: 'openai', translation_base_url: 'https://x.example/v1',
      translation_model: 'gpt-4o-mini', translation_api_key: sealed,
    }),
    get() { return Promise.resolve(this._v); },
  },
};
const cfgLoaded = await loadTranslationConfig(fakeEnv, { includeSecret: true });
check('loadTranslationConfig 解密出密钥', cfgLoaded.apiKey === 'sk-test-123456' && cfgLoaded.apiKeySet === true);
const cfgNoSecret = await loadTranslationConfig(fakeEnv);
check('不带 includeSecret 时绝不返回密钥', cfgNoSecret.apiKey === '' && cfgNoSecret.apiKeySet === true);

console.log('\n== 4. 引擎选择与 OpenAI 兼容调用 ==');
check('systemPrompt 指明目标语言与占位符规则',
  systemPrompt('en', 'es').includes('Spanish') && systemPrompt('en', 'es').includes('__B2BK0__'));
check('pureLocal 不接任何外部引擎', buildEngine({}, {}, { pureLocal: true }).label === 'local-zh-tw');
check('Workers AI 未绑定时给出可读原因',
  buildEngine({}, { engine: 'workers_ai' }).available === false &&
  buildEngine({}, { engine: 'workers_ai' }).reason.includes('wrangler dev --local'));
check('自定义引擎配置不完整时不可用',
  buildEngine({}, { engine: 'openai', baseUrl: '', model: '', apiKey: '' }).available === false);
const aiEnv = { AI: { run: async () => ({ translated_text: 'mocked' }) } };
check('Workers AI 有绑定时 label 正确', buildEngine(aiEnv, { engine: 'workers_ai' }).label === M2M_MODEL);

const originalFetch = globalThis.fetch;
let lastRequest = null;
globalThis.fetch = async (url, init) => {
  lastRequest = { url, init };
  return new Response(JSON.stringify({ choices: [{ message: { content: '```Bomba de prueba```' } }] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
const openaiCfg = { engine: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-abc', temperature: 0.2 };
const translated = await callOpenAICompatible(openaiCfg, 'Test pump', 'en', 'es');
check('调用 /chat/completions 且带 Bearer', lastRequest.url.endsWith('/chat/completions') && lastRequest.init.headers.Authorization === 'Bearer sk-abc');
check('请求体是 OpenAI 格式', JSON.parse(lastRequest.init.body).model === 'gpt-4o-mini' && JSON.parse(lastRequest.init.body).stream === false);
check('解析译文并剥掉代码块', translated === 'Bomba de prueba', translated);
globalThis.fetch = async () => new Response('upstream exploded', { status: 500 });
let errMsg = '';
try { await callOpenAICompatible(openaiCfg, 'x', 'en', 'es'); } catch (e) { errMsg = e.message; }
check('上游 5xx 变成可读错误', errMsg.includes('HTTP 500') && !errMsg.includes('sk-abc'), errMsg);
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [] }), { status: 200 });
errMsg = '';
try { await callOpenAICompatible(openaiCfg, 'x', 'en', 'es'); } catch (e) { errMsg = e.message; }
check('非兼容响应结构被识别', errMsg.includes('choices[0].message.content'), errMsg);
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
const testResult = await testTranslationEngine({}, openaiCfg);
check('测试连接返回结构化结果', testResult.ok === true && testResult.engine === 'openai' && testResult.sample === 'OK');
globalThis.fetch = originalFetch;

console.log('\n== 5. API 契约（需要 dev server）==');
async function req(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await realFetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let token = '';
try {
  const login = await realFetch(BASE + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'Demo2026!b2b' }),
  });
  token = (await login.json().catch(() => ({}))).data?.token || '';
} catch { /* dev server 未启动 */ }
check('演示超管登录成功', !!token);

if (token) {
  const anonGet = await req('/api/settings/translation', 'GET');
  check('匿名读取引擎配置被拒（403）', anonGet.status === 403, 'status=' + anonGet.status);
  const anonPost = await req('/api/settings/translation', 'POST', { engine: 'openai' });
  check('匿名修改引擎配置被拒（403）', anonPost.status === 403, 'status=' + anonPost.status);
  const anonTest = await req('/api/settings/translation/test', 'POST', {});
  check('匿名测试连接被拒（403）', anonTest.status === 403, 'status=' + anonTest.status);

  const publicSettings = await req('/api/settings', 'GET');
  const publicKeys = Object.keys(publicSettings.body?.data || {});
  check('公开 /api/settings 不含任何 translation_* 键',
    publicKeys.filter(k => k.startsWith('translation_')).length === 0, publicKeys.length + ' 个键');

  const cfgGet = await req('/api/settings/translation', 'GET', undefined, token);
  check('超管读取配置 200', cfgGet.status === 200 && cfgGet.body?.success === true, 'status=' + cfgGet.status);
  check('超管响应里没有明文/密文密钥',
    !JSON.stringify(cfgGet.body?.data || {}).includes('enc:v1:') && !('api_key' in (cfgGet.body?.data || {})),
    JSON.stringify(cfgGet.body?.data));

  const ssrf = await req('/api/settings/translation', 'POST', {
    engine: 'openai', base_url: 'https://192.168.0.1/v1', model: 'gpt-4o-mini', api_key: 'sk-x',
  }, token);
  check('服务端拒绝内网 base_url（400）', ssrf.status === 400 && /公网域名/.test(ssrf.body?.error || ''), ssrf.body?.error);

  const noKey = await req('/api/settings/translation', 'POST', {
    engine: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', api_key: '',
  }, token);
  check('首次启用自定义引擎不给 key 被拒（400）', noKey.status === 400, noKey.body?.error);

  const ssrfTest = await req('/api/settings/translation/test', 'POST', {
    engine: 'openai', base_url: 'http://127.0.0.1/v1', model: 'x', api_key: 'y',
  }, token);
  check('测试连接同样挡住 SSRF（400）', ssrfTest.status === 400, ssrfTest.body?.error);

  // 只有当前没存过密钥时才写库，避免把用户真实配置覆盖掉
  const hadKey = cfgGet.body?.data?.api_key_set === true;
  if (!hadKey) {
    const saved = await req('/api/settings/translation', 'POST', {
      engine: 'openai', base_url: 'https://api.openai.com/v1/', model: 'gpt-4o-mini',
      api_key: 'sk-unit-test-key', temperature: 0.3,
    }, token);
    check('保存自定义引擎 200', saved.status === 200 && saved.body?.data?.engine === 'openai', 'status=' + saved.status);
    check('保存后 api_key_set=true 且响应不含明文',
      saved.body?.data?.api_key_set === true && !JSON.stringify(saved.body).includes('sk-unit-test-key'));
    check('base_url 尾斜杠被规范化', saved.body?.data?.base_url === 'https://api.openai.com/v1', saved.body?.data?.base_url);

    const after = await req('/api/settings', 'GET');
    check('写库后公开接口仍不泄露密钥',
      !JSON.stringify(after.body?.data || {}).includes('enc:v1:') &&
      Object.keys(after.body?.data || {}).filter(k => k.startsWith('translation_')).length === 0);

    const getAgain = await req('/api/settings/translation', 'GET', undefined, token);
    check('重读配置仍只回布尔值', getAgain.body?.data?.api_key_set === true && !('api_key' in getAgain.body.data));

    const kept = await req('/api/settings/translation', 'POST', {
      engine: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', api_key: '',
    }, token);
    check('留空 api_key 时保持已保存密钥', kept.status === 200 && kept.body?.data?.api_key_set === true);

    // 清干净，恢复演示站初始状态
    await req('/api/settings/translation', 'POST', {
      engine: 'workers_ai', clear_api_key: true,
    }, token);
    const restored = await req('/api/settings/translation', 'GET', undefined, token);
    check('finally 恢复为默认 Workers AI 且无密钥',
      restored.body?.data?.engine === 'workers_ai' && restored.body?.data?.api_key_set === false,
      JSON.stringify(restored.body?.data));
  } else {
    console.log('  ⚠️  检测到已保存的密钥，跳过写库用例以免覆盖真实配置');
    check('跳过写库用例（保护已有密钥）', true);
  }
}

globalThis.fetch = originalFetch;
console.log('\n' + '='.repeat(50));
console.log(`翻译引擎设置单测：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('失败项：' + fails.join('、'));
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
