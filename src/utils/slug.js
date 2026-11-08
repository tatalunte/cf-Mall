/**
 * Slug 工具
 * 原版 products.js 里有一份同名实现，这里抽出来给内容模块复用。
 */

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')       // 去掉西语/法语变音符：Bomba rápida → bomba-rapida
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

/** 生成带短随机后缀的 slug，降低撞库概率 */
export function uniqueSlug(text) {
  const base = slugify(text) || 'item';
  return `${base}-${Date.now().toString(36)}`;
}
