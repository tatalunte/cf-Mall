/**
 * 内容模块的类型定义（服务端与后台共用同一份配置）
 *
 * 后台 /admin/content/:type 用它渲染表格与表单；API /api/content/:type 用它做字段白名单，
 * 因此「新增一个内容类型」只需要改这里 + 建表，不用写新的 CRUD 代码。
 */

export const CONTENT_TYPES = {
  posts: {
    label: 'News',
    table: 'posts',
    slugField: 'slug',
    publicPath: '/news',
    hasTranslations: true,
    defaultOrder: 'published_at DESC',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'slug', label: 'URL Slug', type: 'slug', from: 'title' },
      { name: 'category', label: 'Category', type: 'select', options: ['news', 'event', 'company'] },
      { name: 'excerpt', label: 'Excerpt', type: 'textarea' },
      { name: 'content', label: 'Content (Markdown)', type: 'textarea', rows: 12 },
      { name: 'cover_image', label: 'Cover Image', type: 'image' },
      { name: 'seo_title', label: 'SEO Title', type: 'text' },
      { name: 'seo_description', label: 'SEO Description', type: 'textarea' },
      { name: 'published_at', label: 'Publish Date', type: 'date' },
      { name: 'is_published', label: 'Published', type: 'bool', default: 1 },
    ],
    listFields: [
      { name: 'title', label: 'Title', primary: true },
      { name: 'category', label: 'Category' },
      { name: 'published_at', label: 'Date', type: 'date' },
      { name: 'is_published', label: 'Live', type: 'bool' },
    ],
    transFields: ['title', 'excerpt', 'content', 'seo_title', 'seo_description'],
  },

  cases: {
    label: 'Case Studies',
    table: 'cases',
    slugField: 'slug',
    publicPath: '/cases',
    hasTranslations: true,
    defaultOrder: 'created_at DESC',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'slug', label: 'URL Slug', type: 'slug', from: 'title' },
      { name: 'country', label: 'Country', type: 'text' },
      { name: 'industry', label: 'Industry', type: 'text' },
      { name: 'client_name', label: 'Client (anonymized)', type: 'text' },
      { name: 'summary', label: 'Summary', type: 'textarea' },
      { name: 'content', label: 'Content (Markdown)', type: 'textarea', rows: 10 },
      { name: 'cover_image', label: 'Cover Image', type: 'image' },
      { name: 'product_ids', label: 'Related Product IDs (comma separated)', type: 'text' },
      { name: 'is_published', label: 'Published', type: 'bool', default: 1 },
    ],
    listFields: [
      { name: 'title', label: 'Title', primary: true },
      { name: 'country', label: 'Country' },
      { name: 'industry', label: 'Industry' },
      { name: 'is_published', label: 'Live', type: 'bool' },
    ],
    transFields: ['title', 'summary', 'content'],
  },

  certifications: {
    label: 'Certifications',
    table: 'certifications',
    hasTranslations: true,
    defaultOrder: 'sort_order ASC, id ASC',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'issuer', label: 'Issuer', type: 'text' },
      { name: 'cert_no', label: 'Certificate No.', type: 'text' },
      { name: 'issued_at', label: 'Issued (YYYY-MM)', type: 'text' },
      { name: 'expires_at', label: 'Expires (YYYY-MM)', type: 'text' },
      { name: 'image_url', label: 'Certificate Image', type: 'image' },
      { name: 'file_url', label: 'PDF File URL', type: 'text' },
      { name: 'sort_order', label: 'Sort Order', type: 'number', default: 0 },
      { name: 'is_active', label: 'Active', type: 'bool', default: 1 },
    ],
    listFields: [
      { name: 'name', label: 'Name', primary: true },
      { name: 'issuer', label: 'Issuer' },
      { name: 'cert_no', label: 'No.' },
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
    transFields: ['name'],
  },

  brands: {
    label: 'Brands',
    table: 'brands',
    defaultOrder: 'sort_order ASC, id ASC',
    fields: [
      { name: 'name', label: 'Brand Name', type: 'text', required: true },
      { name: 'logo_url', label: 'Logo URL', type: 'text' },
      { name: 'website', label: 'Website', type: 'text' },
      { name: 'sort_order', label: 'Sort Order', type: 'number', default: 0 },
      { name: 'is_active', label: 'Active', type: 'bool', default: 1 },
    ],
    listFields: [
      { name: 'name', label: 'Brand', primary: true },
      { name: 'website', label: 'Website' },
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
  },

  faqs: {
    label: 'FAQ',
    table: 'faqs',
    hasTranslations: true,
    defaultOrder: 'sort_order ASC, id ASC',
    fields: [
      { name: 'question', label: 'Question', type: 'text', required: true },
      { name: 'answer', label: 'Answer', type: 'textarea', rows: 4 },
      { name: 'category', label: 'Category', type: 'select', options: ['general', 'payment', 'shipping', 'after-sales', 'customization'] },
      { name: 'sort_order', label: 'Sort Order', type: 'number', default: 0 },
      { name: 'is_active', label: 'Active', type: 'bool', default: 1 },
    ],
    listFields: [
      { name: 'question', label: 'Question', primary: true },
      { name: 'category', label: 'Category' },
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
    transFields: ['question', 'answer'],
  },

  'factory-assets': {
    label: 'Factory & QC',
    table: 'factory_assets',
    hasTranslations: true,
    defaultOrder: 'sort_order ASC, id ASC',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'kind', label: 'Kind', type: 'select', options: ['equipment', 'capacity', 'qc'] },
      { name: 'metric', label: 'Highlight Metric', type: 'text' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'image_url', label: 'Image', type: 'image' },
      { name: 'sort_order', label: 'Sort Order', type: 'number', default: 0 },
      { name: 'is_active', label: 'Active', type: 'bool', default: 1 },
    ],
    listFields: [
      { name: 'title', label: 'Title', primary: true },
      { name: 'kind', label: 'Kind' },
      { name: 'metric', label: 'Metric' },
      { name: 'is_active', label: 'Active', type: 'bool' },
    ],
    transFields: ['title', 'description'],
  },
};

/** URL 段 → 类型 key（兼容 factory-assets 这种带连字符的） */
export function resolveContentType(segment) {
  if (!segment) return null;
  const key = String(segment).toLowerCase();
  if (CONTENT_TYPES[key]) return { key, config: CONTENT_TYPES[key] };
  const alt = key.replace(/-/g, '_');
  const hit = Object.keys(CONTENT_TYPES).find(k => k.replace(/-/g, '_') === alt);
  return hit ? { key: hit, config: CONTENT_TYPES[hit] } : null;
}

/** 该类型允许写入的列（用于 API 字段白名单，防越权写表结构） */
export function writableFields(config) {
  const fields = config.fields.map(f => f.name);
  // translations 不是普通表单字段，但该类型支持翻译时也必须可写，否则译文会被白名单静默丢弃
  if (config.hasTranslations && !fields.includes('translations')) fields.push('translations');
  return fields;
}
