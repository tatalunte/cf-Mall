/**
 * 内容模块通用 CRUD API
 *
 *   GET    /api/content/:type            列表（含未发布，需登录）
 *   GET    /api/content/:type/:id        单条
 *   POST   /api/content/:type            新建（需登录）
 *   PUT    /api/content/:type/:id        局部更新（需登录）
 *   DELETE /api/content/:type/:id        删除（需 super_admin）
 *
 * 安全要点：
 *  - 表名与列名一律来自 content-schema.js 的白名单，绝不拼接用户输入
 *  - slug 冲突返回 409，而不是 500
 *  - translations / product_ids 统一按 JSON 文本存储
 */
import { requireAuth, requireSuperAdmin } from '../../utils/auth';
import { resolveContentType, writableFields } from '../../content-schema';
import { slugify } from '../../utils/slug';
import { toJsonColumn } from '../../utils/json';

function json(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

const JSON_FIELDS = new Set(['translations', 'product_ids']);

function normalizeValue(field, value) {
  if (JSON_FIELDS.has(field)) {
    // 统一归一成一层 JSON 文本：调用方可能已经把对象序列化过（历史双层编码事故）
    return toJsonColumn(value);
  }
  if (value === undefined) return null;
  return value;
}

export async function handleContent(request, env, corsHeaders) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // api / content / type / id
  const resolved = resolveContentType(parts[2]);
  if (!resolved) return json({ error: 'Unknown content type' }, 404, corsHeaders);

  const { key, config } = resolved;
  const cols = writableFields(config);
  const id = parts[3];
  const method = request.method;
  const table = config.table; // 来自白名单，安全

  // 列表 / 单条都要登录（内容里可能有未发布的草稿）
  if (method === 'GET') {
    const admin = await requireAuth(request, env);
    if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

    if (id) {
      const row = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
      return row ? json({ success: true, data: row }, 200, corsHeaders)
                 : json({ error: 'Not found' }, 404, corsHeaders);
    }
    const order = config.defaultOrder || 'id DESC';
    const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
    return json({ success: true, data: results, type: key }, 200, corsHeaders);
  }

  if (method === 'POST') {
    const admin = await requireAuth(request, env);
    if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);

    let data;
    try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

    const required = config.fields.filter(f => f.required).map(f => f.name);
    const missing = required.filter(f => !String(data[f] || '').trim());
    if (missing.length) return json({ error: `Missing required: ${missing.join(', ')}` }, 400, corsHeaders);

    // slug 自动生成
    if (config.slugField && !String(data[config.slugField] || '').trim()) {
      const base = String(data.title || data.name || data.question || '').trim();
      data[config.slugField] = `${slugify(base)}-${Date.now().toString(36)}`;
    }

    const incoming = cols.filter(f => Object.prototype.hasOwnProperty.call(data, f));
    const values = incoming.map(f => normalizeValue(f, data[f]));

    try {
      const result = await env.DB.prepare(
        `INSERT INTO ${table} (${incoming.join(', ')}) VALUES (${incoming.map(() => '?').join(', ')})`
      ).bind(...values).run();
      return json({ success: true, data: { id: result.meta.last_row_id } }, 201, corsHeaders);
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) {
        return json({ error: 'Slug already exists, choose another one' }, 409, corsHeaders);
      }
      throw e;
    }
  }

  if (method === 'PUT') {
    const admin = await requireAuth(request, env);
    if (!admin) return json({ error: 'Unauthorized' }, 401, corsHeaders);
    if (!id) return json({ error: 'id required' }, 400, corsHeaders);

    let data;
    try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

    const incoming = cols.filter(f => Object.prototype.hasOwnProperty.call(data, f));
    if (!incoming.length) return json({ error: 'No updatable fields provided' }, 400, corsHeaders);

    // 必填字段被显式清空则拒绝
    for (const f of config.fields.filter(x => x.required)) {
      if (incoming.includes(f.name) && !String(data[f.name] || '').trim()) {
        return json({ error: `${f.name} cannot be empty` }, 400, corsHeaders);
      }
    }

    const sets = incoming.map(f => `${f} = ?`).join(', ');
    const values = incoming.map(f => normalizeValue(f, data[f]));
    const hasUpdatedAt = config.fields.some(f => f.name === 'is_published') || table === 'posts' || table === 'cases';
    const tail = hasUpdatedAt ? ', updated_at = CURRENT_TIMESTAMP' : '';

    try {
      await env.DB.prepare(`UPDATE ${table} SET ${sets}${tail} WHERE id = ?`).bind(...values, id).run();
      return json({ success: true }, 200, corsHeaders);
    } catch (e) {
      if (String(e.message || '').includes('UNIQUE')) {
        return json({ error: 'Slug already exists, choose another one' }, 409, corsHeaders);
      }
      throw e;
    }
  }

  if (method === 'DELETE') {
    const admin = await requireSuperAdmin(request, env);
    if (!admin) return json({ error: 'Unauthorized. Super admin required.' }, 401, corsHeaders);
    if (!id) return json({ error: 'id required' }, 400, corsHeaders);

    // 有 is_active 的做软删除，避免误删后 SEO 页面 404
    if (config.fields.some(f => f.name === 'is_active')) {
      await env.DB.prepare(`UPDATE ${table} SET is_active = 0 WHERE id = ?`).bind(id).run();
    } else if (config.fields.some(f => f.name === 'is_published')) {
      await env.DB.prepare(`UPDATE ${table} SET is_published = 0 WHERE id = ?`).bind(id).run();
    } else {
      await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    }
    return json({ success: true }, 200, corsHeaders);
  }

  return json({ error: 'Method not allowed' }, 405, corsHeaders);
}
