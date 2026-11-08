/**
 * 极简 Markdown 渲染（白名单式，先转义再替换）
 *
 * 只支持运营真正会用到的子集，刻意不做完整 Markdown：
 *   ## / ### 标题、- 无序列表、1. 有序列表、**粗体**、[文字](链接)、空行分段、单个换行 <br>
 *
 * 安全前提：所有输入先 escapeHtml，链接只允许 http(s):// 与站内相对路径（挡 javascript:）。
 */

import { escapeHtml } from './html';

function safeUrl(url) {
  const u = String(url || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/[^/]/.test(u) || u === '/') return u;
  if (/^mailto:[^\s]+@/i.test(u)) return u;
  return '#';
}

function inline(text) {
  // 传入的 text 已经过 escapeHtml，这里只做结构替换，不能再转义一次（否则 & 会变 &amp;amp;）
  // 先把链接抽出（避免链接文字里的 ** 干扰），再处理粗体
  const parts = [];
  let s = String(text).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    parts.push(`<a href="${safeUrl(url)}" rel="noopener nofollow">${label}</a>`);
    return `\u0000${parts.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[Number(i)]);
  return s;
}

/** Markdown → 安全 HTML */
export function renderMarkdown(src) {
  if (!src) return '';
  const lines = escapeHtml(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let listType = null;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) { flushPara(); closeList(); continue; }

    const h = /^(#{2,4})\s+(.*)$/.exec(trimmed);
    if (h) {
      flushPara(); closeList();
      const level = Math.min(h[1].length + 1, 5); // ## → h3，保持 h1 唯一
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    const ul = /^[-*]\s+(.*)$/.exec(trimmed);
    if (ul) {
      flushPara();
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ol) {
      flushPara();
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    closeList();
    para.push(trimmed);
  }
  flushPara();
  closeList();
  return out.join('\n');
}

/** 取纯文本摘要（用于 meta description / 列表卡片） */
export function markdownToText(src, max = 160) {
  const t = String(src || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*>`_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
