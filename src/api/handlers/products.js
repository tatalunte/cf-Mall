/**
 * 产品 API（改造版）
 * 修复：原版 "Authorization 头存在即视为管理员"（伪造 `Bearer x` 就能看到下架产品）；
 * 新增：slug 查询、translations / brand / moq / seo_* 字段、统一鉴权。
 * 依赖 schema/migrate.sql 已执行。
 */
import { requireAuth, requireSuperAdmin } from '../../utils/auth';
import { toJsonColumn } from '../../utils/json';

const FIELDS = ['name', 'description', 'detailed_description', 'specifications',
  'image_url', 'gallery_images', 'category', 'is_featured', 'is_active',
  'slug', 'translations', 'brand', 'moq', 'seo_title', 'seo_description',
  // 阶段一C
  'video_url', 'applications', 'customization', 'sample_policy', 'lead_time',
  'datasheet_url', 'related_ids'];

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

export async function handleProducts(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'GET' && parts.length === 2) return getAllProducts(request, env, corsHeaders);
  if (method === 'GET' && parts[2] === 'featured') return getFeaturedProducts(env, corsHeaders);
  if (method === 'GET' && parts[2] === 'export.csv') return exportProductsCsv(request, env);
  if (method === 'POST' && parts[2] === 'import') return importProducts(request, env, corsHeaders);
  if (method === 'GET' && parts.length === 3) return getProduct(request, env, corsHeaders, parts[2]);
  if (method === 'POST' && parts.length === 2) return createProduct(request, env, corsHeaders);
  if (method === 'PUT' && parts.length === 3) return updateProduct(request, env, corsHeaders, parts[2]);
  if (method === 'DELETE' && parts.length === 3) return deleteProduct(request, env, corsHeaders, parts[2]);

  return json({ error: 'Not found' }, 404, corsHeaders);
}

async function getAllProducts(request, env, corsHeaders) {
  const admin = await requireAuth(request, env); // 真校验，不再看请求头是否存在
  const sql = admin
    ? 'SELECT * FROM products ORDER BY created_at DESC'
    : 'SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC';
  const { results } = await env.DB.prepare(sql).all();
  return json({ success: true, data: results }, 200, corsHeaders);
}

async function getFeaturedProducts(env, corsHeaders) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM products WHERE is_featured = 1 AND is_active = 1 ORDER BY created_at DESC LIMIT 8'
  ).all();
  return json({ success: true, data: results }, 200, corsHeaders);
}

async function getProduct(request, env, corsHeaders, idOrSlug) {
  const admin = await requireAuth(request, env);
  const visibility = admin ? '' : 'AND is_active = 1';
  const product = await env.DB.prepare(
    `SELECT * FROM products WHERE (CAST(id AS TEXT) = ? OR slug = ?) ${visibility} LIMIT 1`
  ).bind(idOrSlug, idOrSlug).first();
  return product ? json({ success: true, data: product }, 200, corsHeaders)
                 : json({ error: 'Product not found' }, 404, corsHeaders);
}

function values(data) {
  return [
    data.name,
    data.description || null,
    data.detailed_description || null,
    data.specifications || null,
    data.image_url || null,
    toJsonColumn(data.gallery_images),
    data.category || null,
    data.is_featured ? 1 : 0,
    data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
    data.slug || null,
    // 用 toJsonColumn 而不是裸 JSON.stringify：调用方可能已经把 JSON 序列化过
    // （历史事故：库里存成双层编码，前台译文静默失效）
    toJsonColumn(data.translations),
    data.brand || null,
    data.moq || null,
    data.seo_title || null,
    data.seo_description || null,
    data.video_url || null,
    data.applications || null,
    data.customization || null,
    data.sample_policy || null,
    data.lead_time || null,
    data.datasheet_url || null,
    toJsonColumn(data.related_ids),
  ];
}

function slugify(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function createProduct(request, env, corsHeaders) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return json({ error: 'Unauthorized. Super admin required.' }, 401, corsHeaders);
  const data = await request.json();
  if (!data.name) return json({ error: 'name is required' }, 400, corsHeaders);
  const v = values(data);
  if (!v[9]) v[9] = slugify(data.name) + '-' + Date.now().toString(36); // 自动生成 slug
  try {
    const result = await env.DB.prepare(
      `INSERT INTO products (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')})`
    ).bind(...v).run();
    return json({ success: true, data: { id: result.meta.last_row_id, slug: v[9] } }, 201, corsHeaders);
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return json({ error: 'slug already exists, choose another one' }, 409, corsHeaders);
    }
    throw e;
  }
}

/**
 * 局部更新：只更新请求体里出现的字段。
 * 为什么不能全量覆盖：后台产品表单只提交 8 个基础字段，
 * 若按 FIELDS 全量 SET，会把 slug / translations / brand / moq / seo_* / gallery_images 全部写成 NULL，
 * 表现为「编辑一次产品，详情页 URL 从 /products/xxx 退回 /products/12，SEO 与多语言翻译一起消失」。
 * 另外 name 缺失时 bind(undefined) 会直接抛 D1_TYPE_ERROR。
 */
async function updateProduct(request, env, corsHeaders, id) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return json({ error: 'Unauthorized. Super admin required.' }, 401, corsHeaders);

  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

  const incoming = FIELDS.filter(f => Object.prototype.hasOwnProperty.call(data, f));
  if (!incoming.length) return json({ error: 'No updatable fields provided' }, 400, corsHeaders);
  if (incoming.includes('name') && !String(data.name || '').trim()) {
    return json({ error: 'name cannot be empty' }, 400, corsHeaders);
  }

  const sets = incoming.map(f => `${f} = ?`).join(', ');
  const binds = incoming.map(f => {
    if (f === 'gallery_images' || f === 'translations' || f === 'related_ids') {
      return toJsonColumn(data[f]);
    }
    if (f === 'is_featured' || f === 'is_active') return data[f] ? 1 : 0;
    return data[f] === undefined ? null : data[f];
  });

  try {
    await env.DB.prepare(
      `UPDATE products SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(...binds, id).run();
  } catch (e) {
    // slug 唯一索引冲突是最常见的失败原因，给出可读错误
    if (String(e.message || '').includes('UNIQUE')) {
      return json({ error: 'slug already exists, choose another one' }, 409, corsHeaders);
    }
    throw e;
  }
  return json({ success: true }, 200, corsHeaders);
}

/**
 * 产品 CSV 批量导入（后台运营刚需）。
 *
 * 设计取舍：
 * 1) 接受 text/csv 原文（不是 multipart），因为后台用 FileReader 读成文本后直接 POST，省一次 R2 往返；
 * 2) 匹配键优先 slug，其次 name —— 这样「先导出、改价、再导回」不会产生重复产品；
 * 3) 逐行独立失败，不因一行报错中断整批（运营最常见的场景是 200 行里 3 行缺 name）；
 * 4) 只写 CSV 里出现的列，避免把已有产品的详细描述、图片等覆盖成空。
 */
async function importProducts(request, env, corsHeaders) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return json({ error: 'Unauthorized. Super admin required.' }, 401, corsHeaders);

  const text = await request.text();
  if (!text || !text.trim()) return json({ error: 'Empty CSV body' }, 400, corsHeaders);

  const rows = parseCsv(text);
  if (rows.length < 2) {
    return json({ error: 'CSV needs a header row plus at least one data row' }, 400, corsHeaders);
  }

  const header = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const importable = FIELDS.filter(f => header.includes(f));
  if (!importable.length) {
    return json({
      error: 'No importable column found',
      hint: `Allowed columns: ${FIELDS.join(', ')}`,
    }, 400, corsHeaders);
  }
  // slug 未必在 CSV 里，但 upsert 需要它定位；没有就用 name 当业务键
  if (!header.includes('name') && !header.includes('slug')) {
    return json({ error: 'CSV must contain at least a "name" or "slug" column' }, 400, corsHeaders);
  }

  const BOOL_COLS = new Set(['is_featured', 'is_active']);
  const JSON_COLS = new Set(['gallery_images', 'translations', 'related_ids']);
  const LIST_COLS = new Set(['gallery_images', 'related_ids']);

  let created = 0, updated = 0, failed = 0;
  const errors = [];

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    if (!raw.length || raw.every(c => !String(c).trim())) continue; // 跳过空行

    const data = {};
    for (const col of importable) {
      const idx = header.indexOf(col);
      if (idx < 0) continue;
      let val = raw[idx] === undefined ? '' : String(raw[idx]).trim();
      if (val === '') continue; // 空单元格 = 不修改该字段

      if (BOOL_COLS.has(col)) {
        data[col] = /^(1|true|yes|y|是)$/i.test(val) ? 1 : 0;
      } else if (JSON_COLS.has(col)) {
        if (LIST_COLS.has(col)) {
          // 列表列支持两种写法：JSON 数组，或 "a|b|c" 竖线分隔
          if (val.startsWith('[')) {
            try { data[col] = JSON.parse(val); } catch { data[col] = val.split('|').map(s => s.trim()).filter(Boolean); }
          } else {
            data[col] = val.split('|').map(s => s.trim()).filter(Boolean);
          }
        } else {
          try { data[col] = JSON.parse(val); } catch {
            errors.push({ row: r + 1, error: `${col} is not valid JSON` });
            data[col] = null;
          }
        }
      } else {
        data[col] = val;
      }
    }

    const name = String(data.name || '').trim();
    const slug = String(data.slug || '').trim();
    if (!name && !slug) {
      failed++;
      errors.push({ row: r + 1, error: 'both name and slug are empty' });
      continue;
    }

    try {
      // 定位已有记录：slug 精确匹配优先，否则同名视为同一条
      let existing = null;
      if (slug) {
        existing = await env.DB.prepare('SELECT id FROM products WHERE slug = ? LIMIT 1').bind(slug).first();
      }
      if (!existing && name) {
        existing = await env.DB.prepare('SELECT id FROM products WHERE name = ? LIMIT 1').bind(name).first();
      }

      if (existing) {
        const cols = Object.keys(data).filter(c => c !== 'name' || name);
        if (!cols.length) { updated++; continue; }
        const sets = cols.map(c => `${c} = ?`).join(', ');
        const binds = cols.map(c => JSON_COLS.has(c) ? toJsonColumn(data[c]) : data[c]);
        await env.DB.prepare(
          `UPDATE products SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(...binds, existing.id).run();
        updated++;
      } else {
        if (!name) {
          failed++;
          errors.push({ row: r + 1, error: 'name is required when creating a new product' });
          continue;
        }
        const full = { ...data };
        if (!full.slug) full.slug = slugify(name) + '-' + Math.random().toString(36).slice(2, 7);
        const v = values(full);
        await env.DB.prepare(
          `INSERT INTO products (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')})`
        ).bind(...v).run();
        created++;
      }
    } catch (e) {
      failed++;
      errors.push({ row: r + 1, error: String(e.message || e).slice(0, 200) });
    }
  }

  return json({
    success: true,
    summary: { total: rows.length - 1, created, updated, failed },
    errors: errors.slice(0, 50), // 只回传前 50 条，避免响应体过大
  }, 200, corsHeaders);
}

/**
 * 最小 CSV 解析器：支持双引号包裹、引号内逗号与换行、"" 转义。
 * 不能用 split(',')：产品描述里几乎必然带逗号。
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/^\uFEFF/, ''); // 去 BOM，Excel 导出必带

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * 导出产品 CSV。列与 importProducts 的可写字段完全一致，保证「导出 → 改 → 导回」闭环。
 * 带 UTF-8 BOM，否则 Excel 打开中文/西语全是乱码。
 */
async function exportProductsCsv(request, env) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return json({ error: 'Unauthorized. Super admin required.' }, 401, {});

  const { results } = await env.DB.prepare(
    'SELECT * FROM products ORDER BY id ASC'
  ).all();

  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = [FIELDS.join(',')];
  for (const row of results || []) {
    lines.push(FIELDS.map(f => {
      const v = row[f];
      // 列表字段导出成 a|b|c，比 JSON 在 Excel 里好编辑得多
      if ((f === 'gallery_images' || f === 'related_ids') && v) {
        try {
          const arr = JSON.parse(v);
          return esc(Array.isArray(arr) ? arr.join('|') : v);
        } catch { return esc(v); }
      }
      return esc(v);
    }).join(','));
  }

  const body = '\uFEFF' + lines.join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv;charset=UTF-8',
      'Content-Disposition': `attachment; filename="products-${stamp}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

async function deleteProduct(request, env, corsHeaders, id) {
  const admin = await requireSuperAdmin(request, env);
  if (!admin) return json({ error: 'Unauthorized. Super admin required.' }, 401, corsHeaders);

  // 默认软删除：直接物理删除会让旧链接 404，也丢掉「误删可恢复」这条退路。
  // ?purge=1 是给清理演示数据/测试数据用的：必须先下架，避免一次误点把在售产品删掉。
  const purge = new URL(request.url).searchParams.get('purge') === '1';
  if (purge) {
    const row = await env.DB.prepare('SELECT is_active FROM products WHERE id = ?').bind(id).first();
    if (!row) return json({ error: 'Product not found' }, 404, corsHeaders);
    if (row.is_active) return json({ error: 'Archive the product first (is_active = 0), then purge' }, 409, corsHeaders);
    await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
    return json({ success: true, purged: true }, 200, corsHeaders);
  }

  await env.DB.prepare(
    'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(id).run();
  return json({ success: true }, 200, corsHeaders);
}
