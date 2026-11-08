/**
 * i18n 回归测试（阶段一A）
 * 运行： node scripts/test-i18n.mjs
 * 只用 node 内置 assert，不引入测试框架。
 */
import assert from 'node:assert/strict';
import {
  formatDate, formatDateTime, isoDate, formatNumber, formatPercent, formatCurrency,
  parseAcceptLanguage, negotiateLang, countryToLang, pickLang, langCookie,
  isBotRequest, parseCookies, localizedUrl, langSwitchItems, normalizeLang,
  supportedLangs, isRtl, translationCoverage, parseLocalizedPath,
} from '../src/i18n.js';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

const env = { SUPPORTED_LANGS: 'en,es,ar', DEFAULT_LANG: 'en', SITE_URL: 'https://example.com' };
const req = (headers = {}, cf = {}) => ({
  headers: { get: (k) => headers[k.toLowerCase()] ?? headers[k] ?? null },
  cf,
});

console.log('\n== 日期 / 数字 / 货币本地化 ==');
check('formatDate en 输出英文月份', () => {
  const s = formatDate('2026-11-08 06:00:00', 'en');
  assert.match(s, /Nov/);
  assert.match(s, /2026/);
});
check('formatDate es 输出西语月份且不含英文 Nov', () => {
  const s = formatDate('2026-11-08 06:00:00', 'es');
  assert.ok(!/Nov/.test(s), `es 仍是英文: ${s}`);
  assert.match(s, /2026/);
});
check('formatDate ar 输出阿拉伯语（非空且非 ISO）', () => {
  const s = formatDate('2026-11-08', 'ar');
  assert.ok(s.length > 0);
  assert.notEqual(s, '2026-11-08');
});
check('formatDate 空值返回空串', () => assert.equal(formatDate(null, 'en'), ''));
check('formatDate 非法值返回空串', () => assert.equal(formatDate('not-a-date', 'en'), ''));
check('isoDate 保持机器可读', () => assert.equal(isoDate('2026-11-08 23:00:00'), '2026-11-08'));
check('formatDateTime 含时间', () => assert.match(formatDateTime('2026-11-08T14:05:00Z', 'en'), /2026/));

check('formatNumber en 千分位逗号', () => assert.equal(formatNumber(1234567, 'en'), '1,234,567'));
check('formatNumber es 千分位点号', () => assert.equal(formatNumber(1234567, 'es'), '1.234.567'));
check('formatNumber 非数字原样返回', () => assert.equal(formatNumber('n/a', 'en'), 'n/a'));
check('formatPercent 0.256 → 26%', () => assert.match(formatPercent(0.256, 'en'), /26\s?%/));

check('formatCurrency USD', () => assert.equal(formatCurrency(1234.5, 'en', 'USD').replace(/\u00a0/g, ' '), '$1,234.50'));
check('formatCurrency EUR（es）含 €', () => assert.match(formatCurrency(1234.5, 'es', 'EUR'), /€/));
check('formatCurrency 非法金额返回空', () => assert.equal(formatCurrency('abc', 'en'), ''));

console.log('\n== 语言协商 ==');
check('parseAcceptLanguage 按 q 值排序', () => {
  assert.deepEqual(parseAcceptLanguage('es-MX,es;q=0.9,en;q=0.8'), ['es-mx', 'es', 'en']);
});
check('parseAcceptLanguage 处理通配符与空值', () => {
  assert.deepEqual(parseAcceptLanguage('*,en;q=0.5'), ['en']);
  assert.deepEqual(parseAcceptLanguage(''), []);
});
check('negotiateLang 命中带地区标签', () => assert.equal(negotiateLang('es-MX,es;q=0.9', env), 'es'));
check('negotiateLang 不支持的语言返回 null', () => assert.equal(negotiateLang('de-DE,de;q=0.9', env), null));
check('countryToLang 西班牙 → es', () => assert.equal(countryToLang('ES', env), 'es'));
check('countryToLang 沙特 → ar', () => assert.equal(countryToLang('sa', env), 'ar'));
check('countryToLang 德国（未启用 de）→ null', () => assert.equal(countryToLang('DE', env), null));
check('countryToLang 美国 → en', () => assert.equal(countryToLang('US', env), 'en'));

check('pickLang 优先级：query 最高', () => {
  const u = new URL('https://x.test/?lang=ar');
  const r = req({ cookie: 'lang_pref=es', 'accept-language': 'es' }, { country: 'ES' });
  assert.deepEqual(pickLang(r, env, u), { lang: 'ar', source: 'query' });
});
check('pickLang 优先级：cookie 高于 country', () => {
  const u = new URL('https://x.test/');
  const r = req({ cookie: 'lang_pref=ar', 'accept-language': 'es' }, { country: 'ES' });
  assert.deepEqual(pickLang(r, env, u), { lang: 'ar', source: 'cookie' });
});
check('pickLang 优先级：country 高于 Accept-Language', () => {
  const u = new URL('https://x.test/');
  const r = req({ 'accept-language': 'en-US,en;q=0.9' }, { country: 'SA' });
  assert.deepEqual(pickLang(r, env, u), { lang: 'ar', source: 'country' });
});
check('pickLang 无 cookie/country 时用 Accept-Language', () => {
  const u = new URL('https://x.test/');
  const r = req({ 'accept-language': 'es-ES,es;q=0.9' });
  assert.deepEqual(pickLang(r, env, u), { lang: 'es', source: 'accept-language' });
});
check('pickLang 全无信号 → 默认 en', () => {
  const u = new URL('https://x.test/');
  assert.deepEqual(pickLang(req(), env, u), { lang: 'en', source: 'default' });
});
check('pickLang 非法 query 回退后续信号', () => {
  const u = new URL('https://x.test/?lang=xx');
  const r = req({ 'accept-language': 'es' });
  assert.equal(pickLang(r, env, u).lang, 'es');
});

console.log('\n== Cookie / 爬虫 / 路径 ==');
check('parseCookies 解析多值', () => {
  assert.deepEqual(parseCookies('a=1; lang_pref=es; b=x%20y'), { a: '1', lang_pref: 'es', b: 'x y' });
});
check('langCookie 含 Path 与 SameSite', () => {
  const c = langCookie('es');
  assert.match(c, /^lang_pref=es;/);
  assert.match(c, /Path=\//);
  assert.match(c, /SameSite=Lax/);
});
check('isBotRequest 识别 Googlebot', () => assert.equal(isBotRequest(req({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' })), true));
check('isBotRequest 识别 lighthouse', () => assert.equal(isBotRequest(req({ 'user-agent': 'Chrome-Lighthouse' })), true));
check('isBotRequest 正常浏览器不误判', () => assert.equal(isBotRequest(req({ 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/120' })), false));

check('localizedUrl 默认语言无前缀', () => assert.equal(localizedUrl('/products', 'en', env), '/products'));
check('localizedUrl 其它语言加前缀', () => assert.equal(localizedUrl('/products/1', 'es', env), '/es/products/1'));
check('localizedUrl 根路径 es → /es/', () => assert.equal(localizedUrl('/', 'es', env), '/es/'));
check('parseLocalizedPath 剥离前缀', () => {
  assert.deepEqual(parseLocalizedPath('/es/products/1', env), { lang: 'es', path: '/products/1' });
});
check('parseLocalizedPath /ar 根路径', () => {
  assert.deepEqual(parseLocalizedPath('/ar', env), { lang: 'ar', path: '/' });
});

console.log('\n== 语言切换器 ==');
check('langSwitchItems 保留当前页面路径', () => {
  const items = langSwitchItems('/products/1', 'es', env);
  assert.equal(items.find(i => i.code === 'es').href, '/es/products/1');
  assert.equal(items.find(i => i.code === 'en').href, '/products/1');
  assert.equal(items.find(i => i.code === 'ar').href, '/ar/products/1');
  assert.equal(items.find(i => i.code === 'es').active, true);
});
check('langSwitchItems 标记 RTL', () => {
  assert.equal(langSwitchItems('/', 'en', env).find(i => i.code === 'ar').rtl, true);
});
check('isRtl 判断', () => {
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('es'), false);
});
check('supportedLangs 读 env', () => assert.deepEqual(supportedLangs(env), ['en', 'es', 'ar']));
check('normalizeLang 地区标签归一', () => assert.equal(normalizeLang('es-MX', env), 'es'));
check('normalizeLang 不支持回默认', () => assert.equal(normalizeLang('de', env), 'en'));

console.log('\n== 翻译覆盖率 ==');
check('translationCoverage 统计已填字段', () => {
  const p = { translations: JSON.stringify({ es: { name: 'Bomba', description: 'x' } }) };
  const c = translationCoverage(p, env);
  assert.equal(c.find(x => x.code === 'es').filled, 2);
  assert.equal(c.find(x => x.code === 'es').complete, false);
  assert.equal(c.find(x => x.code === 'ar').filled, 0);
});
check('translationCoverage 容忍坏 JSON', () => {
  const c = translationCoverage({ translations: '{bad' }, env);
  assert.equal(c.every(x => x.filled === 0), true);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
