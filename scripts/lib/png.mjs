/**
 * 零依赖 PNG 生成器 —— 只为演示站造产品图，不引入 canvas / sharp。
 *
 * 为什么不用 picsum / unsplash 之类的占位图服务：
 *   1) 本地测试要能离线跑，外网图会让「死链检测」误报；
 *   2) 生产环境不该依赖第三方图片源，演示站也一样。
 *
 * 编码格式：8-bit truecolor（color type 2），每条扫描线 filter=0，
 * IDAT 用 zlib deflate。足够让所有浏览器与 <img> 正常渲染。
 */
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * 画一张「工业产品感」的抽象图。
 * @param {number} hue      主色相 0-359
 * @param {number} variant  0 圆环 / 1 六边形 / 2 叠层 / 3 管线
 */
export function renderProductImage(width, height, hue, variant = 0) {
  const rgb = Buffer.alloc(width * height * 3);
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.30;
  const ringW = Math.min(width, height) * 0.075;
  // 背景固定中性冷灰蓝，只有强调色随产品变化 —— 背景跟着 hue 转会发脏（试过，偏土黄）
  const bgA = hslToRgb(216, 0.24, 0.15);
  const bgB = hslToRgb(210, 0.13, 0.46);
  const accent = hslToRgb(hue, 0.72, 0.56);
  const metalHi = hslToRgb(210, 0.08, 0.88);
  const metalLo = hslToRgb(212, 0.12, 0.40);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 对角渐变背景
      const t = (x / width) * 0.55 + (y / height) * 0.45;
      let r = bgA[0] + (bgB[0] - bgA[0]) * t;
      let g = bgA[1] + (bgB[1] - bgA[1]) * t;
      let b = bgA[2] + (bgB[2] - bgA[2]) * t;

      // 细网格，增加工业图纸感
      if (x % 48 === 0 || y % 48 === 0) {
        r += 9; g += 9; b += 9;
      }

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);

      if (variant === 0) {
        // 金属圆环 + 内圈光晕
        if (Math.abs(dist - R) < ringW) {
          const lit = 0.5 + 0.5 * Math.cos(ang - Math.PI * 0.75);
          r = metalLo[0] + (metalHi[0] - metalLo[0]) * lit;
          g = metalLo[1] + (metalHi[1] - metalLo[1]) * lit;
          b = metalLo[2] + (metalHi[2] - metalLo[2]) * lit;
        } else if (dist < R - ringW) {
          const k = 1 - dist / (R - ringW);
          r = r * (1 - k * 0.45) + accent[0] * k * 0.45;
          g = g * (1 - k * 0.45) + accent[1] * k * 0.45;
          b = b * (1 - k * 0.45) + accent[2] * k * 0.45;
        }
      } else if (variant === 1) {
        // 正六边形轮廓
        const k = Math.PI / 3;
        const a = ((ang % k) + k) % k - k / 2;
        const edge = (R * Math.cos(k / 2)) / Math.cos(a);
        if (Math.abs(dist - edge) < ringW * 0.9) {
          const lit = 0.5 + 0.5 * Math.cos(ang);
          r = metalLo[0] + (metalHi[0] - metalLo[0]) * lit;
          g = metalLo[1] + (metalHi[1] - metalLo[1]) * lit;
          b = metalLo[2] + (metalHi[2] - metalLo[2]) * lit;
        } else if (dist < edge - ringW * 0.9) {
          const kk = 1 - dist / edge;
          r = r * (1 - kk * 0.4) + accent[0] * kk * 0.4;
          g = g * (1 - kk * 0.4) + accent[1] * kk * 0.4;
          b = b * (1 - kk * 0.4) + accent[2] * kk * 0.4;
        }
      } else if (variant === 2) {
        // 三层堆叠矩形（设备机柜感）
        const bw = width * 0.44;
        const bh = height * 0.10;
        for (let i = 0; i < 3; i++) {
          const top = cy - bh * 2.4 + i * bh * 1.6;
          if (Math.abs(dx) < bw / 2 && y > top && y < top + bh) {
            const lit = 0.35 + 0.65 * (1 - Math.abs(dx) / (bw / 2));
            r = metalLo[0] + (metalHi[0] - metalLo[0]) * lit * 0.8;
            g = metalLo[1] + (metalHi[1] - metalLo[1]) * lit * 0.8;
            b = metalLo[2] + (metalHi[2] - metalLo[2]) * lit * 0.8;
            if (Math.abs(dx - bw * 0.36) < 6) { r = accent[0]; g = accent[1]; b = accent[2]; }
          }
        }
      } else {
        // 管线：两条平行弯管
        const band = Math.abs(Math.sin(dy / (height * 0.06)) * height * 0.16 - Math.abs(dx) * 0.55);
        if (band < ringW * 0.55) {
          const lit = 0.45 + 0.55 * Math.cos(ang * 0.5);
          r = metalLo[0] + (metalHi[0] - metalLo[0]) * lit;
          g = metalLo[1] + (metalHi[1] - metalLo[1]) * lit;
          b = metalLo[2] + (metalHi[2] - metalLo[2]) * lit;
        }
      }

      // 底部强调色条 + 顶部轻微暗角
      if (y > height * 0.94) {
        const t2 = (y - height * 0.94) / (height * 0.06);
        r = r * (1 - t2) + accent[0] * t2;
        g = g * (1 - t2) + accent[1] * t2;
        b = b * (1 - t2) + accent[2] * t2;
      }
      const vx = (x - cx) / cx;
      const vy = (y - cy) / cy;
      const vignette = 1 - Math.min(0.35, (vx * vx + vy * vy) * 0.12);
      r *= vignette; g *= vignette; b *= vignette;

      const idx = (y * width + x) * 3;
      rgb[idx] = Math.max(0, Math.min(255, Math.round(r)));
      rgb[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgb[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return encodePng(width, height, rgb);
}
