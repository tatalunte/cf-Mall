/**
 * 主题视觉快照：同一批页面 × 两套极端主题（classic / midnight），
 * 用来人眼检查有没有「白底浅字」「深底深字」这类对比度翻车。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const OUT = 'test-artifacts/theme';
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(p => fs.existsSync(p));

fs.mkdirSync(OUT, { recursive: true });

const pages = [
  ['home', '/'],
  ['products', '/products'],
  ['detail', '/products/stainless-steel-centrifugal-pump-hr-cp100'],
  ['about', '/about'],
  ['faq', '/faq'],
  ['contact', '/contact'],
  ['quote', '/quote'],
  ['cases', '/cases'],
  ['news', '/news'],
];

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

for (const theme of ['classic', 'midnight', 'ember']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(t => {
    try { localStorage.setItem('b2b_theme', t); } catch (e) {}
  }, theme);
  const page = await ctx.newPage();
  for (const [name, url] of pages) {
    await page.goto(BASE + url, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${theme}-${name}.png`), fullPage: false });
  }
  await ctx.close();
  console.log(`✓ ${theme}`);
}

await browser.close();
console.log('快照目录：' + OUT);
