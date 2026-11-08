/**
 * 一键翻译：纯逻辑单测 + API 契约测试
 *
 * 不依赖 Workers AI 额度：
 *   - 中文 → 繁体中文走纯本地转换表，不需要 AI 绑定，可以完整验证后端链路
 *   - 其它语种需要真实 AI，UI 流程由 scripts/ui-test-translate.mjs 用 route mock 覆盖
 *
 * 运行：node scripts/test-translate.mjs   （需要 dev server 跑在 8787）
 */
import {
  m2mLang, isTraditionalTarget, toTraditional,
  protectTerms, restoreTerms, splitText, joinParts, cleanFields,
} from '../src/utils/translate.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
const fails = [];
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('\n== 1. 语言映射与简繁转换 ==');
check('m2mLang(zh-TW) 落到 zh（模型不区分简繁）', m2mLang('zh-TW') === 'zh');
check('m2mLang(zh) = zh', m2mLang('zh') === 'zh');
check('m2mLang(ar) = ar', m2mLang('ar') === 'ar');
check('isTraditionalTarget 只认 zh-TW', isTraditionalTarget('zh-TW') && !isTraditionalTarget('zh'));
const tw = toTraditional('不锈钢离心泵 HR-CP100，产品中心，关于我们，质量控制');
check('简繁 + 台湾用词转换', tw.includes('不鏽鋼離心泵') && tw.includes('產品中心') && tw.includes('關於我們') && tw.includes('品質管理'), tw);
check('术语在简繁转换中原样保留', tw.includes('HR-CP100'));

console.log('\n== 2. 术语保护 ==');
const src = '型号 HR-CP100 符合 ISO 9001，压力 1.6 MPa，详见 https://example.com/a 或 sales@x.com';
const p = protectTerms(src, [{ src: 'Hengrui', keep: true }]);
check('型号被占位', p.text.includes('__B2BK') && !p.text.includes('HR-CP100'));
check('认证号被占位', !p.text.includes('ISO 9001'));
check('单位数值被占位', !p.text.includes('1.6 MPa'));
check('URL / 邮箱被占位', !p.text.includes('https://') && !p.text.includes('sales@x.com'));
const restored = restoreTerms(p.text.replace('型号', 'Model').replace('符合', 'meets'), p.tokens);
check('术语能还原', restored.includes('HR-CP100') && restored.includes('ISO 9001') && restored.includes('1.6 MPa') && restored.includes('https://example.com/a'), restored);
// 自定义术语：keep=false 时用 dst 替换
const g = protectTerms('恒瑞泵阀出口全球', [{ src: '恒瑞', dst: 'Hengrui', keep: false }]);
check('自定义术语按 dst 替换', restoreTerms(g.text, g.tokens).includes('Hengrui'), restoreTerms(g.text, g.tokens));

console.log('\n== 3. 长文分段 ==');
const parts = splitText('第一句。第二句！第三句？第四句；第五句. 第六句\n第七句。', 12, 5);
check('按句边界切段', parts.length >= 2 && parts.every(x => x.length <= 12), JSON.stringify(parts));
check('短文本不切', splitText('短句', 600, 5).length === 1);
check('中文拼接不加空格', joinParts(['甲', '乙'], 'zh') === '甲乙');
check('西语拼接加空格', joinParts(['a', 'b'], 'es') === 'a b');

console.log('\n== 4. 入参清洗 ==');
const cleaned = cleanFields({ name: '  ok  ', bad: 'x', num: 123, long: 'a'.repeat(5000) }, ['name', 'bad', 'num', 'long']);
check('去掉非字符串 / trim', cleaned.name === 'ok' && !('num' in cleaned));
check('超长字段截断到 4000', cleaned.long.length === 4000);
const cleaned2 = cleanFields({ name: 'a', evil: 'b' }, ['name']);
check('白名单外字段不进入请求', !('evil' in cleaned2));

console.log('\n== 5. API 契约（需要 dev server）==');
async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

let token = '';
try {
  const login = await fetch(BASE + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'Demo2026!b2b' }),
  });
  token = (await login.json().catch(() => ({}))).data?.token || '';
} catch { /* server 未启动 */ }
check('演示管理员登录成功', !!token);

if (token) {
  const anon = await post('/api/translate', { sourceLang: 'zh', target: 'zh-TW', fields: { name: '不锈钢离心泵' } });
  check('匿名调用被拒（401）', anon.status === 401, 'status=' + anon.status);

  const bad = await post('/api/translate', { sourceLang: 'xx', target: 'zh-TW', fields: { name: 'x' } }, token);
  check('非法语言被拒（400）', bad.status === 400, 'status=' + bad.status);

  // 中文 → 繁中：纯本地路径，不需要 AI 绑定，应完整返回译文
  const local = await post('/api/translate', {
    sourceLang: 'zh', target: 'zh-TW', mode: 'overwrite',
    fields: { name: '不锈钢离心泵 HR-CP100', description: '质量认证与资质，客户案例' },
  }, token);
  check('zh→zh-TW 接口 200', local.status === 200, 'status=' + local.status);
  check('zh→zh-TW 走本地引擎', local.body?.data?.engine === 'local-zh-tw', local.body?.data?.engine);
  check('zh→zh-TW 译文正确', /不鏽鋼離心泵/.test(local.body?.data?.translations?.name || ''), local.body?.data?.translations?.name);
  check('术语在译文里原样保留', (local.body?.data?.translations?.name || '').includes('HR-CP100'));

  // fill 模式：已有译文的字段应被跳过，不返回
  const fill = await post('/api/translate', {
    sourceLang: 'zh', target: 'zh-TW', mode: 'fill',
    fields: { name: '不锈钢离心泵', description: '质量认证' },
    existing: { name: '人工写好的名称' },
  }, token);
  check('fill 模式跳过已有人工译文', fill.body?.data?.skipped?.includes('name') && !('name' in (fill.body?.data?.translations || {})), JSON.stringify(fill.body?.data?.skipped));
  check('fill 模式仍生成空字段', !!fill.body?.data?.translations?.description, fill.body?.data?.translations?.description);

  const same = await post('/api/translate', { sourceLang: 'zh', target: 'zh', fields: { name: 'x' } }, token);
  check('源语言=目标语言时不花额度', same.status === 200 && same.body?.data?.engine === 'none');
}

console.log('\n' + '='.repeat(50));
console.log(`一键翻译单测：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('失败项：' + fails.join('、'));
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
