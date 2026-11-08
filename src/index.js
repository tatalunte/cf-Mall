/**
 * Worker 入口（阶段一A）
 * 新增：
 *  - 语言协商：?lang= > cookie(lang_pref) > cf.country > Accept-Language > 默认语言
 *  - 首次访问按协商结果 302 到本地化前缀，并用 cookie 记忆选择；爬虫与 /admin 不重定向
 *  - /sitemap.xml、/robots.txt、Queues 消费者、Cron 兜底、统一安全头
 */
import { handleApiRequest } from './api/router';
import { handlePageRequest } from './pages/router';
import { sitemapXml, robotsTxt } from './pages/seo';
import { handleMailQueue, retryFailedMails } from './mailer';
import { maybeSendFollowupDigest } from './crm-reminder';
import {
  pickLang, localizedUrl, parseLocalizedPath, langCookie, isBotRequest,
} from './i18n';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // 生产环境若无内联 script 依赖可升级为严格 CSP；本项目页面大量内联 JS，暂不启用 default-src
};

function withSecurity(response) {
  const next = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!next.headers.has(k)) next.headers.set(k, v);
  }
  return next;
}

/** 构造重定向（保留除 lang 外的其余查询参数），并写入语言 cookie */
function langRedirect(url, path, lang, env, extraHeaders = {}) {
  const params = new URLSearchParams(url.search);
  params.delete('lang');
  params.delete('fbclid');
  const qs = params.toString();
  const target = localizedUrl(path, lang, env) + (qs ? `?${qs}` : '');
  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Set-Cookie': langCookie(lang), 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/sitemap.xml') return withSecurity(await sitemapXml(request, env));
      // robotsTxt 是 async，漏掉 await 会把 Promise 当 body，返回空响应且丢 Content-Type
      if (path === '/robots.txt') return withSecurity(await robotsTxt(request, env));
      if (path.startsWith('/api/')) return withSecurity(await handleApiRequest(request, env));

      const defaultLang = env.DEFAULT_LANG || 'en';
      const { lang: pathLang } = parseLocalizedPath(path, env);
      const hasLangPrefix = pathLang !== defaultLang;
      const isAdminPath = path === '/admin' || path.startsWith('/admin/');
      const isPageGet = request.method === 'GET' || request.method === 'HEAD';

      // ---- 语言协商与重定向（只对前台页面 GET 生效）----
      if (isPageGet && !isAdminPath) {
        const explicit = url.searchParams.get('lang');
        if (explicit && !isBotRequest(request)) {
          // 显式切语言：跳到对应前缀（若已是目标语言则继续渲染，只补 cookie）
          const { lang } = pickLang(request, env, url);
          if (lang !== pathLang) {
            return withSecurity(langRedirect(url, parseLocalizedPath(path, env).path, lang, env));
          }
        } else if (!hasLangPrefix && !isBotRequest(request)) {
          // 无前缀且无显式参数：按 cookie→国家→Accept-Language 协商，非默认语言才跳
          const { lang, source } = pickLang(request, env, url);
          if (lang !== defaultLang && source !== 'default') {
            return withSecurity(langRedirect(url, path, lang, env));
          }
        }

        // 语言前缀 URL 顺带记忆，方便下次直达
        if (hasLangPrefix) {
          const res = withSecurity(await handlePageRequest(request, env));
          const headers = new Headers(res.headers);
          headers.append('Set-Cookie', langCookie(pathLang));
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
        }
      }

      return withSecurity(await handlePageRequest(request, env));
    } catch (error) {
      console.error('worker error', error);
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
      });
    }
  },

  /** Queue 消费者：每条消息对应一封询盘通知邮件 */
  async queue(batch, env, ctx) {
    await handleMailQueue(batch, env);
  },

  /** Cron 兜底：重发失败邮件（wrangler.toml 的 [triggers] crons） */
  async scheduled(event, env, ctx) {
    // 每小时：重发失败的通知邮件（幂等，靠 mail_status 判断）
    ctx.waitUntil(retryFailedMails(env));
    // 每天 UTC 08:00：一封「今日待跟进」摘要（内部按小时判断，其余轮次直接返回）
    ctx.waitUntil(
      maybeSendFollowupDigest(env, event.scheduledTime).catch(e =>
        console.error('follow-up digest failed', e.message)
      )
    );
  },
};
