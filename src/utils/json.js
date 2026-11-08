/**
 * JSON 列（translations / gallery_images / product_ids …）的读写归一化。
 *
 * 背景（真事故）：D1 里这些列都是 TEXT。历史上有调用方把「已经序列化过的字符串」
 * 又 stringify 了一次，库里存成 "{\"es\":{...}}"（双层编码）。
 * 读取侧只 JSON.parse 一次，拿到的是**字符串**而不是对象，
 * 于是 translations['es'] 恒为 undefined —— 前台西语/阿语页面静默回退英文，
 * 验收时肉眼看不出报错，只有断言能抓到。
 *
 * 对策两件事：
 *   - 读：parseJsonLoose() 最多拆 3 层，容忍历史脏数据；
 *   - 写：toJsonColumn() 一律归一成「一层 JSON 文本」，新写入不再产生双层。
 */

/**
 * 宽松解析：接受对象、一层 JSON 串、甚至双层/三层编码的串。
 * 任何一层失败都返回 fallback —— 脏数据不该让页面 500。
 */
export function parseJsonLoose(value, fallback = {}) {
  let cur = value;
  for (let i = 0; i < 3; i += 1) {
    if (cur === null || cur === undefined || cur === '') return fallback;
    if (typeof cur !== 'string') return cur;
    try {
      cur = JSON.parse(cur);
    } catch {
      // 纯字符串（形如 "abc" 不是合法 JSON）也走这里
      return fallback;
    }
  }
  return typeof cur === 'string' ? fallback : cur;
}

/**
 * 归一成入库用的一层 JSON 文本。
 * 对象 / 数组 / 一层串 / 多层串 都能吃；空值与不可解析值统一返 null。
 */
export function toJsonColumn(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string' ? parseJsonLoose(value, null) : value;
  if (parsed === null || typeof parsed !== 'object') return null;
  return JSON.stringify(parsed);
}
