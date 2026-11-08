/**
 * 极简 PDF 生成器（阶段三）
 *
 * 为什么自己写：Workers 运行时没有 canvas / 无头浏览器，任何依赖
 * （pdfkit / puppeteer）都跑不起来。报价单和订单确认单是纯文字表格，
 * 手写 PDF 1.4 对象流完全够用，还能把包体控制在 0 依赖。
 *
 * ⚠️ 只支持 WinAnsi（Latin-1）字符集：
 *    中文 / 阿拉伯文会被替换成 '?'。这不是偷懒 —— 嵌入 CJK 字体子集
 *    动辄 3~8 MB，Worker 包体上限只有 3 MB（免费）/ 10 MB（付费），
 *    塞不进去。中文单据请用 /quote/:token 的打印友好 HTML 页
 *    （浏览器 Ctrl+P → 另存为 PDF，字体和排版都更好）。
 *
 * 用法：
 *   const doc = new PdfDoc({ title: 'QUOTATION' });
 *   doc.heading('QUOTATION');
 *   doc.text('Quote No: QT-20261108-0001');
 *   doc.rule();
 *   doc.table({ columns: [...], rows: [...] });
 *   const bytes = doc.build();   // Uint8Array
 */

/* Helvetica 标准字宽表（/1000 em），用于右对齐与文本截断。
   仅覆盖可打印 ASCII，其余按 556 估算。 */
const HELV = (() => {
  const t = new Array(256).fill(556);
  const set = (chars, w) => { for (const c of chars) t[c.charCodeAt(0)] = w; };
  set(' ', 278); set('!', 278); set('"', 355); set('#', 556); set('$', 556); set('%', 889);
  set('&', 667); set("'", 191); set('(', 333); set(')', 333); set('*', 389); set('+', 584);
  set(',', 278); set('-', 333); set('.', 278); set('/', 278);
  set('0123456789', 556);
  set(':', 278); set(';', 278); set('<', 584); set('=', 584); set('>', 584); set('?', 556); set('@', 1015);
  set('A', 667); set('B', 667); set('C', 722); set('D', 722); set('E', 667); set('F', 611);
  set('G', 778); set('H', 722); set('I', 278); set('J', 500); set('K', 667); set('L', 556);
  set('M', 833); set('N', 722); set('O', 778); set('P', 667); set('Q', 778); set('R', 722);
  set('S', 667); set('T', 611); set('U', 722); set('V', 667); set('W', 944); set('X', 667);
  set('Y', 667); set('Z', 611);
  set('[', 278); set('\\', 278); set(']', 278); set('^', 469); set('_', 556); set('`', 333);
  set('a', 556); set('b', 556); set('c', 500); set('d', 556); set('e', 556); set('f', 278);
  set('g', 556); set('h', 556); set('i', 222); set('j', 222); set('k', 500); set('l', 222);
  set('m', 833); set('n', 556); set('o', 556); set('p', 556); set('q', 556); set('r', 333);
  set('s', 500); set('t', 278); set('u', 556); set('v', 500); set('w', 722); set('x', 500);
  set('y', 500); set('z', 500);
  set('{', 334); set('|', 260); set('}', 334); set('~', 584);
  return t;
})();

/** 估算文本宽度（pt）。bold 按 1.03 系数近似，用于对齐足够。 */
export function textWidth(str, size = 10, bold = false) {
  let w = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    w += (c < 256 ? HELV[c] : 556);
  }
  return (w / 1000) * size * (bold ? 1.03 : 1);
}

/** 转成 PDF 字面量：非 Latin-1 一律降级为 '?'，并转义 () \ */
function pdfString(str) {
  let out = '';
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c === 0x28) out += '\\(';
    else if (c === 0x29) out += '\\)';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x0a) out += ' ';
    else if (c >= 0x20 && c <= 0x7e) out += ch;
    else if (c >= 0xa0 && c <= 0xff) out += '\\' + c.toString(8).padStart(3, '0');
    else out += '?';
  }
  return out;
}

const A4 = { width: 595.28, height: 841.89 };

export class PdfDoc {
  constructor(opts = {}) {
    const page = opts.pageSize === 'LETTER'
      ? { width: 612, height: 792 }
      : A4;
    this.pageW = page.width;
    this.pageH = page.height;
    this.margin = Object.assign({ top: 56, right: 48, bottom: 56, left: 48 }, opts.margins || {});
    this.title = opts.title || 'Document';
    this.author = opts.author || '';
    this.footerText = opts.footerText || '';
    this.pages = [];         // 每页一个内容流字符串数组
    this.cursorY = 0;
    this.pageIndex = -1;
    this.newPage();
  }

  get contentW() {
    return this.pageW - this.margin.left - this.margin.right;
  }

  newPage() {
    this.pages.push([]);
    this.pageIndex = this.pages.length - 1;
    this.cursorY = this.pageH - this.margin.top;
    return this;
  }

  /** 剩余高度不足时自动换页 */
  ensure(h) {
    if (this.cursorY - h < this.margin.bottom) this.newPage();
    return this;
  }

  raw(op) {
    this.pages[this.pageIndex].push(op);
    return this;
  }

  spacer(h = 8) {
    this.cursorY -= h;
    return this;
  }

  /** 单行文本。align: left | right | center */
  text(str, opts = {}) {
    const size = opts.size || 10;
    const bold = !!opts.bold;
    const color = opts.color || [0.12, 0.16, 0.22];
    const lineHeight = opts.lineHeight || size * 1.35;
    const s = String(str == null ? '' : str);

    this.ensure(lineHeight);
    let x = opts.x != null ? opts.x : this.margin.left;
    const maxW = opts.maxWidth || (this.pageW - this.margin.right - x);
    let shown = s;
    if (textWidth(shown, size, bold) > maxW) {
      // 截断并加省略号（省略号不在 WinAnsi 安全区，用三个点）
      while (shown.length > 1 && textWidth(shown + '...', size, bold) > maxW) {
        shown = shown.slice(0, -1);
      }
      shown = shown.replace(/\s+$/, '') + '...';
    }
    const w = textWidth(shown, size, bold);
    if (opts.align === 'right') x = this.pageW - this.margin.right - w;
    else if (opts.align === 'center') x = (this.pageW - w) / 2;

    const y = this.cursorY - size;
    this.raw(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color[0]} ${color[1]} ${color[2]} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfString(shown)}) Tj ET`);
    this.cursorY -= lineHeight;
    return this;
  }

  /** 自动换行的段落 */
  paragraph(str, opts = {}) {
    const size = opts.size || 9.5;
    const bold = !!opts.bold;
    const width = opts.maxWidth || this.contentW;
    const x = opts.x != null ? opts.x : this.margin.left;
    const words = String(str || '').split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (textWidth(test, size, bold) > width && line) {
        this.text(line, { ...opts, x, size, bold, maxWidth: width });
        line = w;
      } else {
        line = test;
      }
    }
    if (line) this.text(line, { ...opts, x, size, bold, maxWidth: width });
    return this;
  }

  heading(str, opts = {}) {
    return this.text(str, { size: 20, bold: true, color: [0.09, 0.13, 0.2], lineHeight: 26, ...opts });
  }

  rule(color = [0.85, 0.88, 0.92], width = 0.8) {
    this.ensure(10);
    const y = this.cursorY - 2;
    this.raw(`${color[0]} ${color[1]} ${color[2]} RG ${width} w ${this.margin.left} ${y.toFixed(2)} m ${(this.pageW - this.margin.right).toFixed(2)} ${y.toFixed(2)} l S`);
    this.cursorY -= 10;
    return this;
  }

  /** 两列信息块：左标签右值，用于抬头 / 客户信息 */
  fields(pairs, opts = {}) {
    const size = opts.size || 9.5;
    const gap = opts.gap || 14;
    for (const [k, v] of pairs) {
      if (v == null || v === '') continue;
      this.ensure(size * 1.5);
      const y = this.cursorY - size;
      this.raw(`BT /F1 ${size} Tf 0.42 0.47 0.55 rg ${this.margin.left} ${y.toFixed(2)} Td (${pdfString(String(k))}) Tj ET`);
      const vs = String(v);
      const w = textWidth(vs, size, false);
      this.raw(`BT /F1 ${size} Tf 0.12 0.16 0.22 rg ${(this.pageW - this.margin.right - w).toFixed(2)} ${y.toFixed(2)} Td (${pdfString(vs)}) Tj ET`);
      this.cursorY -= gap;
    }
    return this;
  }

  /**
   * 表格。columns: [{ label, width, align }]
   * 行高固定，超长单元格截断；跨页时自动重绘表头。
   */
  table({ columns, rows, size = 9, headerBg = [0.95, 0.96, 0.98], zebra = true }) {
    const totalW = columns.reduce((s, c) => s + c.width, 0);
    const scale = totalW > this.contentW ? this.contentW / totalW : 1;
    const cols = columns.map(c => ({ ...c, width: c.width * scale }));
    const rowH = size * 2.2;

    const drawHeader = () => {
      this.ensure(rowH);
      const top = this.cursorY;
      this.raw(`${headerBg[0]} ${headerBg[1]} ${headerBg[2]} rg ${this.margin.left} ${(top - rowH).toFixed(2)} ${this.contentW.toFixed(2)} ${rowH.toFixed(2)} re f`);
      let x = this.margin.left + 4;
      for (const c of cols) {
        const tw = textWidth(c.label, size, true);
        const tx = c.align === 'right' ? x + c.width - 8 - tw : c.align === 'center' ? x + (c.width - tw) / 2 : x;
        this.raw(`BT /F2 ${size} Tf 0.25 0.3 0.38 rg ${tx.toFixed(2)} ${(top - rowH + size * 0.8).toFixed(2)} Td (${pdfString(c.label)}) Tj ET`);
        x += c.width;
      }
      this.cursorY -= rowH;
    };

    drawHeader();
    rows.forEach((row, idx) => {
      if (this.cursorY - rowH < this.margin.bottom) {
        this.newPage();
        drawHeader();
      }
      if (zebra && idx % 2 === 1) {
        const top = this.cursorY;
        this.raw(`0.985 0.99 1 rg ${this.margin.left} ${(top - rowH).toFixed(2)} ${this.contentW.toFixed(2)} ${rowH.toFixed(2)} re f`);
      }
      let x = this.margin.left + 4;
      row.forEach((cell, i) => {
        const c = cols[i];
        if (!c) return;
        let s = String(cell == null ? '' : cell);
        const maxW = c.width - 10;
        while (s.length > 1 && textWidth(s, size, false) > maxW) s = s.slice(0, -1);
        const w = textWidth(s, size, false);
        const tx = c.align === 'right' ? x + c.width - 8 - w : c.align === 'center' ? x + (c.width - w) / 2 : x;
        this.raw(`BT /F1 ${size} Tf 0.16 0.2 0.26 rg ${tx.toFixed(2)} ${(this.cursorY - rowH + size * 0.85).toFixed(2)} Td (${pdfString(s)}) Tj ET`);
        x += c.width;
      });
      this.cursorY -= rowH;
    });
    this.cursorY -= 4;
    return this;
  }

  /** 右对齐的大号合计金额 */
  total(str, opts = {}) {
    this.ensure(30);
    this.rule([0.83, 0.86, 0.9]);
    return this.text(str, { size: 13, bold: true, align: 'right', color: [0.09, 0.13, 0.2], ...opts });
  }

  build() {
    const esc = (s) => String(s).replace(/([()\\])/g, '\\$1');
    const objects = [];       // 1-based
    const push = (body) => { objects.push(body); return objects.length; };

    // 预留：1=Catalog 2=Pages，其余按需
    const catalogId = 1;
    const pagesId = 2;
    objects.push(null, null); // 占位

    const fontF1 = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontF2 = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const pageIds = [];
    for (let i = 0; i < this.pages.length; i++) {
      const ops = this.pages[i].slice();
      // 页脚
      if (this.footerText) {
        const label = `${this.footerText.replace(/\{page\}/g, String(i + 1)).replace(/\{total\}/g, String(this.pages.length))}`;
        const w = textWidth(label, 7.5, false);
        ops.push(`BT /F1 7.5 Tf 0.55 0.6 0.67 rg ${((this.pageW - w) / 2).toFixed(2)} ${(this.margin.bottom - 24).toFixed(2)} Td (${pdfString(label)}) Tj ET`);
      }
      const stream = ops.join('\n');
      const contentId = push(`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`);
      const pageId = push(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageW} ${this.pageH}] ` +
        `/Resources << /Font << /F1 ${fontF1} 0 R /F2 ${fontF2} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
      pageIds.push(pageId);
    }

    objects[0] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;

    const infoId = push(
      `<< /Title (${esc(this.title)}) /Author (${esc(this.author || this.title)}) ` +
      `/Producer (cf-b2b-pro PDF) /CreationDate (D:${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}) >>`
    );

    // 组装文件并记录每个对象的字节偏移
    const enc = new TextEncoder();
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(enc.encode(out).length);
      out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefPos = enc.encode(out).length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
    out += xref;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    return enc.encode(out);
  }
}

/** 金额格式化（PDF 里不带千分位分隔符以外的花哨符号） */
export function money(n, currency = 'USD') {
  const v = Number(n || 0);
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 日期格式化为 08 Nov 2026 */
export function pdfDate(value) {
  if (!value) return '';
  const d = new Date(String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return String(value);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${month} ${d.getUTCFullYear()}`;
}
