/**
 * 静态图片（改造版）
 * 原版是占位实现：/images/* 一律返回一段文本却声明 Content-Type: image/*，
 * 导致 schema.sql 里三条示例产品的 /images/product1.jpg 全是坏图。
 * 现在优先从 R2 读 images/<name>，找不到时返回内嵌 SVG 占位图（不会出现破图）。
 */

const TYPES = {
  css: 'text/css', js: 'application/javascript',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
};

function contentType(path) {
  return TYPES[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
}

export async function handleStaticAssets(request, env, defaultContentType) {
  const path = new URL(request.url).pathname;
  const key = path.replace(/^\//, ''); // images/product1.jpg

  try {
    const object = env.IMAGES && await env.IMAGES.get(key);
    if (object) {
      return new Response(object.body, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || contentType(path),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'ETag': object.etag,
        },
      });
    }
  } catch (e) {
    console.error('R2 read failed', e);
  }

  // 友好占位图（内联 SVG，不依赖第三方 placeholder 服务）
  //
  // 底必须是**透明**：这个站有亮/暗两套主题，写死 #f1f5f9 的话，
  // 深色主题下每张缺图的产品卡都是一块刺眼的白板。
  // 透明之后由 .card-image 的 background（= --bg-light）决定底色，
  // 线条用中灰，在浅底和深底上都看得见。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <g fill="none" stroke="#94a3b8" stroke-width="8">
      <rect x="250" y="180" width="300" height="240" rx="12"/>
      <circle cx="340" cy="260" r="26"/>
      <path d="M270 400l90-90 60 60 50-40 90 90"/>
    </g>
    <text x="400" y="470" font-family="Arial" font-size="22" fill="#94a3b8" text-anchor="middle">Image coming soon</text>
  </svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
