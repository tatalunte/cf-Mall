/**
 * 主题切换冒烟测试（临时脚本，确认无误后并入 scripts/audit/actions.mjs）
 *   1. 切换器存在且面板默认收起
 *   2. 点开能列出 7 项（6 套配色 + 夜间·跟随系统 auto）
 *   3. 点 midnight → html[data-theme] 变、body 背景真的变深、页脚仍深
 *   4. 刷新后保持（localStorage）
 *   5. 换回 classic → 背景恢复
 *   6. 夜间模式 auto：系统深色→midnight，系统浅色→classic，实时跟随
 *   7. 375px 不横向溢出
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const footerBg = () => page.evaluate(() => {
  const f = document.querySelector('footer');
  return f ? getComputedStyle(f).backgroundColor : '';
});

console.log('\n== 1. 切换器 ==');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
ok('导航上有主题按钮', await page.locator('#theme-toggle').isVisible());
ok('面板默认收起', await page.locator('#theme-menu').isHidden());

await page.click('#theme-toggle');
await page.waitForTimeout(150);
ok('点开后展开', await page.locator('#theme-menu').isVisible());
const optCount = await page.locator('.theme-opt').count();
ok('列出 7 项主题（6 套配色 + 夜间 auto）', optCount === 7, `实际 ${optCount}`);

const classicBg = await bg();
const classicFooter = await footerBg();
ok('默认是亮色底', classicBg === 'rgb(255, 255, 255)', classicBg);

console.log('\n== 2. 切到深色主题 ==');
await page.click('.theme-opt[data-theme="midnight"]');
await page.waitForTimeout(200);
ok('html[data-theme] 已更新', await page.evaluate(() => document.documentElement.dataset.theme) === 'midnight');
const darkBg = await bg();
ok('页面底色变深', darkBg !== classicBg && darkBg.startsWith('rgb(1'), darkBg);
const darkFooter = await footerBg();
ok('页脚比页面更深（没有被反色带跑）', darkFooter !== classicFooter, `${darkFooter} vs ${classicFooter}`);
const textColor = await page.evaluate(() => getComputedStyle(document.body).color);
const lum = (c) => {
  const [r, g, b] = c.match(/\d+/g).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
ok('深色主题下正文是浅色字', lum(textColor) > 0.6, `${textColor} lum=${lum(textColor).toFixed(2)}`);
ok('面板已关闭', await page.locator('#theme-menu').isHidden());

console.log('\n== 3. 刷新后保持 ==');
await page.reload({ waitUntil: 'domcontentloaded' });
ok('data-theme 仍是 midnight', await page.evaluate(() => document.documentElement.dataset.theme) === 'midnight');
ok('底色仍是深色', (await bg()) === darkBg, await bg());

console.log('\n== 4. 换回亮色 ==');
await page.click('#theme-toggle');
await page.click('.theme-opt[data-theme="classic"]');
await page.waitForTimeout(150);
ok('底色恢复', (await bg()) === classicBg, await bg());

console.log('\n== 4b. 夜间模式（auto · 跟随系统）==');
// 系统深色 → 选 auto 应即时落到 midnight（深底）
await page.emulateMedia({ colorScheme: 'dark' });
await page.click('#theme-toggle');
await page.click('.theme-opt[data-theme="auto"]');
await page.waitForTimeout(150);
ok('auto + 系统深色 → data-theme 落到 midnight', await page.evaluate(() => document.documentElement.dataset.theme) === 'midnight');
const autoDarkBg = await bg();
const isDeepBg = autoDarkBg !== classicBg && /^rgb\((?:0|1)\d{0,2},/.test(autoDarkBg);
ok('auto 深色下底色真变深', isDeepBg, autoDarkBg);
ok('auto 选中时面板高亮 auto 项（不是 midnight）',
  await page.locator('.theme-opt[data-theme="auto"]').getAttribute('aria-checked') === 'true');
// 系统切回浅色 → 不刷新，auto 应自动跟着变回 classic
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(200);
ok('auto 跟随系统回亮 → data-theme 变回 classic', await page.evaluate(() => document.documentElement.dataset.theme) === 'classic');
ok('auto 跟随系统回亮 → 底色恢复亮色', (await bg()) === classicBg, await bg());
// 持久化：刷新后 auto 仍生效
await page.emulateMedia({ colorScheme: 'dark' });
await page.reload({ waitUntil: 'domcontentloaded' });
ok('刷新后 auto 保持（深色系统）', await page.evaluate(() => document.documentElement.dataset.theme) === 'midnight');
// 还原：手动选 classic，退出 auto 策略
await page.click('#theme-toggle');
await page.click('.theme-opt[data-theme="classic"]');
await page.emulateMedia({ colorScheme: 'light' });

console.log('\n== 5. 多语言页也能切 ==');
await page.goto(BASE + '/es/products', { waitUntil: 'domcontentloaded' });
ok('西语页有切换器', await page.locator('#theme-toggle').isVisible());
ok('西语页 aria-label 已翻译',
  (await page.getAttribute('#theme-toggle', 'aria-label'))?.includes('Tema'),
  await page.getAttribute('#theme-toggle', 'aria-label'));
await page.click('#theme-toggle');
await page.click('.theme-opt[data-theme="ocean"]');
await page.waitForTimeout(150);
const oceanPrimary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim());
ok('ocean 主色生效', oceanPrimary === '#0e7490', oceanPrimary);
await page.click('#theme-toggle');
await page.click('.theme-opt[data-theme="classic"]');

console.log('\n== 6. 移动端 ==');
await page.setViewportSize({ width: 375, height: 720 });
for (const p of ['/', '/products', '/about', '/es/products']) {
  await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(`${p} 375px 无横向溢出`, overflow <= 1, `溢出 ${overflow}px`);
  ok(`${p} 切换器可见`, await page.locator('#theme-toggle').isVisible());
}

ok('全程无 JS 运行时错误', errs.length === 0, errs.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
