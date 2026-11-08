/**
 * 客户链接 token（报价单 / 后续订单共用）
 *
 * 为什么用 32 字节随机数而不是「加密 id」：
 *  1) id 可枚举，签名 key 一旦泄漏（或以 DEV 变量形式留在本地）历史链接全部可伪造；
 *     纯随机串落库后比对，泄漏 key 也推不出别的 token。
 *  2) 不需要额外的 HMAC 校验代码，D1 的唯一索引就是校验。
 * 32 字节 = 256 bit，base64url 后 43 个字符，URL 里安全且不可猜。
 */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 生成 base64url token（去 padding）。
 * 不直接用 btoa：部分运行时（旧 Node / 测试环境）对二进制串的 btoa 行为不一致，
 * 手写查表既没有 padding 也避开了 '+' '/' 需要替换的麻烦。
 */
export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64URL[(n >> 18) & 63];
    out += B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}
