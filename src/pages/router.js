/**
 * 页面路由（改造版）
 * 新增：/es/ /ar/ 语言前缀解析、统一的 (request, env) 页面签名、静态图片走 R2。
 * 所有页面函数签名已统一为 (request, env)，env 里多了 LANG 字段。
 */
import { homePage } from './home';
import { productsPage } from './products';
import { productDetailPage } from './product-detail';
import { aboutPage } from './about';
import { contactPage } from './contact';
import { adminLoginPage } from './admin-login';
import { adminDashboard } from './admin-dashboard';
import { adminContentPage } from './admin-content';
import { privacyPage } from './privacy';
import { newsListPage, newsDetailPage } from './news';
import { casesListPage, caseDetailPage } from './cases';
import { faqPage } from './faq';
import { quoteRequestPage } from './quote-request';
import { quoteViewPage } from './quote-view';
import { accountPage } from './account';
import { adminTradePage } from './admin-trade';
import { handleStaticAssets } from './static';
import { parseLocalizedPath } from '../i18n';

export async function handlePageRequest(request, env) {
  const url = new URL(request.url);
  const { lang, path } = parseLocalizedPath(url.pathname, env);
  // 统一读一次站点设置，供 layout 的品牌 / 页脚 / 联系方式使用（原版这些是全写死的）
  let settings = {};
  try {
    const raw = await env.STATIC_ASSETS.get('website_settings');
    if (raw) settings = JSON.parse(raw);
  } catch { /* 未配置 KV 时降级为默认值 */ }
  const ctx = Object.assign({}, env, { LANG: lang, SETTINGS: settings });

  // 页面内部拿到的 request 已去掉语言前缀，便于取 productId / 生成 canonical
  const pageUrl = new URL(path + url.search, url.origin);
  const pageRequest = new Request(pageUrl, request);

  if (path.startsWith('/images/')) return handleStaticAssets(pageRequest, env, 'image/*');

  if (path === '/' || path === '/home') return homePage(pageRequest, ctx);
  if (path === '/products') return productsPage(pageRequest, ctx);
  if (path.startsWith('/products/')) return productDetailPage(pageRequest, ctx);
  if (path === '/about') return aboutPage(pageRequest, ctx);
  if (path === '/contact') return contactPage(pageRequest, ctx);
  if (path === '/privacy') return privacyPage(pageRequest, ctx);

  // 内容模块（阶段一B）
  if (path === '/news') return newsListPage(pageRequest, ctx);
  if (path.startsWith('/news/')) return newsDetailPage(pageRequest, ctx, decodeURIComponent(path.slice('/news/'.length)));
  if (path === '/cases') return casesListPage(pageRequest, ctx);
  if (path.startsWith('/cases/')) return caseDetailPage(pageRequest, ctx, decodeURIComponent(path.slice('/cases/'.length)));
  if (path === '/faq') return faqPage(pageRequest, ctx);

  // 交易（阶段三）
  // /quote/:token 必须在 /quote 之后判断，且 token 不能含斜杠
  if (path === '/quote') return quoteRequestPage(pageRequest, ctx);
  if (path.startsWith('/quote/')) return quoteViewPage(pageRequest, ctx);
  if (path === '/account') return accountPage(pageRequest, ctx);

  if (path === '/admin' || path === '/admin/login') return adminLoginPage(pageRequest, ctx);
  if (path === '/admin/dashboard') return adminDashboard(pageRequest, ctx);
  if (path === '/admin/trade' || path.startsWith('/admin/trade/')) return adminTradePage(pageRequest, ctx);
  if (path.startsWith('/admin/content')) return adminContentPage(pageRequest, ctx);

  return new Response(`<!doctype html><html><head><title>404</title></head><body><h1>404 - Page not found</h1><p><a href="/">Back to home</a></p></body></html>`, {
    status: 404,
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}
