/**
 * Upload API Handler
 * Handles file uploads to Cloudflare R2
 */

import { requireSuperAdmin } from '../../utils/auth';

export async function handleUpload(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const pathParts = url.pathname.split('/').filter(Boolean);

  // POST /api/upload/image - Upload image
  if (method === 'POST' && pathParts[2] === 'image') {
    return uploadImage(request, env, corsHeaders);
  }

  // GET /api/upload/image/:key - Get image URL
  // key can be multi-part like products/123-abc.jpg
  if (method === 'GET' && pathParts[2] === 'image' && pathParts[3]) {
    // Reconstruct the full key from remaining path parts
    const key = pathParts.slice(3).join('/');
    return getImageUrl(key, env, corsHeaders);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Upload image to R2
async function uploadImage(request, env, corsHeaders) {
  try {
    // 原版是 TODO 未鉴权：任何人都能往你的 R2 里灌文件。
    const admin = await requireSuperAdmin(request, env);
    if (!admin) {
      return new Response(JSON.stringify({ error: 'Unauthorized. Super admin required.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return new Response(JSON.stringify({
        error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return new Response(JSON.stringify({
        error: 'File too large. Maximum size is 5MB.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // file.type 由客户端提供，可以伪造；这里校验文件头魔数
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
    const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
      && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (!(isJpeg || isPng || isGif || isWebp)) {
      return new Response(JSON.stringify({ error: 'File content is not a valid image' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate unique filename（扩展名取自校验过的魔数，不信任客户端文件名）
    const timestamp = Date.now();
    const randomStr = crypto.randomUUID().slice(0, 8);
    const extension = isJpeg ? 'jpg' : isPng ? 'png' : isGif ? 'gif' : 'webp';
    const key = `products/${timestamp}-${randomStr}.${extension}`;

    // Upload to R2
    await env.IMAGES.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
        // 图片内容不可变（key 带时间戳 + 随机串），可以放心让浏览器缓存一年
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    // 生成 URL：
    //   配了 IMAGES_PUBLIC_BASE（R2 自定义域，如 https://img.example.com）就直接给直链，
    //   图片请求不再穿过 Worker —— 省请求数、降延迟，也避开 Worker 10ms CPU 限制。
    //   没配就退回 Worker 代理，本地开发和「懒得上自定义域」的场景都能用。
    const publicBase = (env.IMAGES_PUBLIC_BASE && !String(env.IMAGES_PUBLIC_BASE).startsWith('REPLACE_'))
      ? String(env.IMAGES_PUBLIC_BASE).replace(/\/$/, '')
      : '';
    const imageUrl = publicBase ? `${publicBase}/${key}` : `/api/upload/image/${key}`;

    return new Response(JSON.stringify({
      success: true,
      data: {
        url: imageUrl,
        key: key,
        size: file.size,
        type: file.type,
      },
    }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Get image from R2
async function getImageUrl(key, env, corsHeaders) {
  try {
    const object = await env.IMAGES.get(key);

    if (!object) {
      return new Response('Image not found', {
        status: 404,
        headers: corsHeaders,
      });
    }

    const headers = {
      ...corsHeaders,
      'Content-Type': object.httpMetadata.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': object.etag,
    };

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Get image error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
