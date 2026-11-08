/**
 * 响应式图片（可选，靠开关启用）
 *
 * 为什么要抽出来：
 *   产品图目前只有一种尺寸，卡片上 360px 的位置下载的是 1000px 的图 —— 手机流量
 *   和 LCP 都在为用不到的像素付钱。做成 srcset 后浏览器自己挑最合适的一档。
 *
 * 为什么默认关闭：
 *   `/cdn-cgi/image/...` 依赖 Cloudflare Image Transformations（免费版每月 5000 次
 *   唯一变换，超出后新变换返回 9422）。没开通就输出这种 URL，图片会直接裂掉。
 *   所以只有 wrangler.toml 里 IMAGE_RESIZE="1" 时才启用，其余情况输出普通 <img>。
 */

/** 覆盖卡片 / 详情页 / 移动端三种真实场景 */
export const CARD_WIDTHS = [400, 800, 1200];
export const HERO_WIDTHS = [800, 1200, 1600];

export function resizeEnabled(env) {
  return String(env?.IMAGE_RESIZE || '') === '1';
}

/**
 * 把一个站内绝对路径包成 Cloudflare 图片变换 URL。
 * 只处理相对路径 —— 外部图床的图不在我们的 zone 里，套 /cdn-cgi/image 必然 404。
 */
export function variantUrl(src, width, quality = 82) {
  if (!src || !src.startsWith('/')) return src;
  return `/cdn-cgi/image/width=${width},quality=${quality},format=auto${src}`;
}

/** 生成 srcset 的属性片段（不含前导空格），未启用时返回空串 */
export function srcsetAttr(env, src, widths) {
  if (!resizeEnabled(env)) return '';
  const list = widths.map(w => `${variantUrl(src, w)} ${w}w`).join(', ');
  return ` srcset="${list}"`;
}
