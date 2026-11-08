/**
 * API Router - handles all backend API requests
 */

export async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 原版是全局 `*` 跨域，配合无鉴权的 /api/inquiries 等于把客户资料开放给任意站点。
  // 改造后只允许本站来源；跨站调用请走同源 /api 或单独配置白名单。
  const siteUrl = (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : new URL(request.url).origin;
  const corsHeaders = {
    'Access-Control-Allow-Origin': siteUrl,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  // Handle OPTIONS request
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 一键生成译文（Workers AI）：必须放在 /api/settings 之前无冲突，
    // 独立前缀，且是唯一会消耗 AI 额度的接口
    if (path === '/api/translate') {
      const { handleTranslate } = await import('./handlers/translate');
      return handleTranslate(request, env, corsHeaders);
    }

    // Settings API
    if (path.startsWith('/api/settings')) {
      const { handleSettings } = await import('./handlers/settings');
      return handleSettings(request, env, corsHeaders);
    }

    // Upload API
    if (path.startsWith('/api/upload')) {
      const { handleUpload } = await import('./handlers/upload');
      return handleUpload(request, env, corsHeaders);
    }

    // Products API
    if (path.startsWith('/api/products')) {
      const { handleProducts } = await import('./handlers/products');
      return handleProducts(request, env, corsHeaders);
    }

    // Inquiries API
    if (path.startsWith('/api/inquiries')) {
      const { handleInquiries } = await import('./handlers/inquiries');
      return handleInquiries(request, env, corsHeaders);
    }

    // Content API（阶段一B：posts / cases / certifications / brands / faqs / factory-assets）
    if (path.startsWith('/api/content')) {
      const { handleContent } = await import('./handlers/content');
      return handleContent(request, env, corsHeaders);
    }

    // CRM API（阶段二A：customers / activities / reminders / overview）
    if (path.startsWith('/api/crm')) {
      const { handleCrm } = await import('./handlers/crm');
      return handleCrm(request, env, corsHeaders);
    }

    // 订阅名单管理（阶段二C，需登录；必须放在 /api/subscribe 之前，
    // 否则 /api/subscribers 会被前缀匹配到公开的订阅接口）
    if (path.startsWith('/api/subscribers')) {
      const { handleSubscribersAdmin } = await import('./handlers/subscribe');
      return handleSubscribersAdmin(request, env, corsHeaders);
    }

    // 公开订阅（阶段二C）：POST 提交 / GET 确认 / GET 退订
    if (path === '/api/subscribe' || path.startsWith('/api/subscribe/')) {
      const { handleSubscribe } = await import('./handlers/subscribe');
      return handleSubscribe(request, env, corsHeaders);
    }

    // 交易（阶段三）：报价单 / 订单 / 客户门户
    // 三者都是独立前缀，顺序无关；但必须放在 /api/admin 之前，
    // 否则将来若加 /api/admin/quotes 之类的路径会被第一条前缀吃掉。
    if (path.startsWith('/api/quotes')) {
      const { handleQuotes } = await import('./handlers/quotes');
      return handleQuotes(request, env, corsHeaders);
    }

    if (path.startsWith('/api/orders')) {
      const { handleOrders } = await import('./handlers/orders');
      return handleOrders(request, env, corsHeaders);
    }

    if (path.startsWith('/api/account')) {
      const { handleAccounts } = await import('./handlers/accounts');
      return handleAccounts(request, env, corsHeaders);
    }

    // Admin API
    if (path.startsWith('/api/admin')) {
      const { handleAdmin } = await import('./handlers/admin');
      return handleAdmin(request, env, corsHeaders);
    }

    // 404 Not Found
    return new Response(JSON.stringify({ error: 'API endpoint not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
