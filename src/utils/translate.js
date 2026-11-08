/**
 * 一键翻译的「纯逻辑」层：不碰 env.AI、不碰网络，方便直接单测。
 *
 * 三件事：
 *  1. 语言代码映射：m2m100 只有 `zh`，没有 `zh-TW`；繁体走「翻译成简体 → 简繁+用词转换」。
 *  2. 术语保护：型号 / 品牌 / 认证号 / 单位 / URL / 邮箱先换成占位符，翻完再还原，
 *     否则 HR-CP100 会被模型改成奇怪的东西，B2B 询盘里这是致命错误。
 *  3. 长文分段：1.2B 的 seq2seq 模型对超长输入会截断，按句切成小段再拼回去。
 */

/** 站点语言 code → m2m100 语言 code（ISO 639-1） */
export const M2M_LANG = {
  en: 'en', es: 'es', ar: 'ar', de: 'de', fr: 'fr', ru: 'ru', pt: 'pt',
  ja: 'ja', ko: 'ko', zh: 'zh', 'zh-TW': 'zh',
};

export function m2mLang(code) {
  return M2M_LANG[code] || String(code || '').split('-')[0] || 'en';
}

/** 目标是不是繁体中文（需要额外的简繁 + 台湾用词转换） */
export function isTraditionalTarget(code) {
  return code === 'zh-TW';
}

/* ------------------------------------------------------------------ *
 * 简繁 + 台湾用词转换
 * 为什么不用 OpenCC：完整词库几百 KB，塞进 Worker 包体不划算；
 * 这里只覆盖工业品 B2B 站的高频词，长词优先，再补单字。
 * ------------------------------------------------------------------ */

/** 大陆用语 → 台湾用语（长词优先，避免被单字表拆坏） */
const TW_PHRASES = [
  ['不锈钢', '不鏽鋼'], ['离心泵', '離心泵'], ['闸阀', '閘閥'], ['截止阀', '截止閥'],
  ['球阀', '球閥'], ['蝶阀', '蝶閥'], ['电机', '電機'], ['铸件', '鑄件'],
  ['叶轮', '葉輪'], ['法兰', '法蘭'], ['压力', '壓力'], ['扬程', '揚程'],
  ['转速', '轉速'], ['质保', '保固'], ['定制', '客製'], ['客制化', '客製化'],
  ['售后', '售後'], ['认证', '認證'], ['资质', '資格'], ['产品', '產品'],
  ['关于', '關於'], ['联系', '聯絡'], ['信息', '資訊'], ['软件', '軟體'],
  ['硬件', '硬體'], ['网络', '網路'], ['数据库', '資料庫'], ['数据', '數據'],
  ['标准', '標準'], ['规格', '規格'], ['型号', '型號'], ['材质', '材質'],
  ['温度', '溫度'], ['湿度', '濕度'], ['腐蚀', '腐蝕'], ['轴承', '軸承'],
  ['齿轮', '齒輪'], ['减速机', '減速機'], ['变频', '變頻'], ['控制柜', '控制櫃'],
  ['仪表', '儀表'], ['传感器', '感測器'], ['自动化', '自動化'], ['设备', '設備'],
  ['维护', '維護'], ['检测', '檢測'], ['试验', '試驗'], ['报告', '報告'],
  ['报价', '報價'], ['询价', '詢價'], ['客户', '客戶'], ['新闻', '新聞'],
  ['首页', '首頁'], ['分类', '分類'], ['详情', '詳情'], ['搜索', '搜尋'],
  ['电子邮箱', '電子信箱'], ['公司名称', '公司名稱'], ['内容', '內容'],
  ['提交', '送出'], ['技术参数', '技術規格'], ['隐私', '隱私權'],
  ['授权', '授權'], ['询问', '詢問'], ['管理员', '管理員'], ['登录', '登入'],
  ['发布于', '發布於'], ['最后更新', '最後更新'], ['相关产品', '相關產品'],
  ['应用领域', '應用領域'], ['样品', '樣品'], ['交货周期', '交貨週期'],
  ['资料下载', '資料下載'], ['产品手册', '產品手冊'], ['产品视频', '產品影片'],
  ['线上咨询', '線上諮詢'], ['我们的工厂', '我們的工廠'], ['值得信赖', '值得信賴'],
  ['产能概况', '產能概況'], ['质量管理', '品質管理'], ['质量控制', '品質管理'],
  ['质量', '品質'], ['取得报价', '取得報價'], ['图纸', '圖紙'], ['照片', '照片'],
  ['选填', '選填'], ['条款', '條款'], ['配色主题', '配色主題'],
  ['输入信箱', '輸入信箱'], ['订阅', '訂閱'], ['检查', '檢查'],
  ['视频', '影片'], ['单位', '單位'], ['设置', '設定'], ['默认', '預設'],
  ['文件', '檔案'], ['上传', '上傳'], ['下载', '下載'], ['兼容', '相容'],
  ['接口', '介面'], ['服务器', '伺服器'], ['分辨率', '解析度'], ['内存', '記憶體'],
  ['简体中文', '簡體中文'], ['繁体中文', '繁體中文'], ['语言', '語言'],
].sort((a, b) => b[0].length - a[0].length);

/** 常见简→繁单字（只列会变化的，同形字不必列） */
const TW_CHARS = {
  钢: '鋼', 阀: '閥', 电: '電', 机: '機', 铸: '鑄', 铝: '鋁', 铜: '銅',
  铁: '鐵', 压: '壓', 转: '轉', 轴: '軸', 齿: '齒', 轮: '輪', 叶: '葉',
  兰: '蘭', 扬: '揚', 质: '質', 认: '認', 证: '證', 资: '資', 产: '產',
  关: '關', 于: '於', 联: '聯', 系: '繫', 络: '絡', 网: '網', 标: '標',
  准: '準', 规: '規', 号: '號', 温: '溫', 湿: '濕', 蚀: '蝕', 损: '損',
  减: '減', 频: '頻', 柜: '櫃', 仪: '儀', 传: '傳', 动: '動', 设: '設',
  备: '備', 维: '維', 护: '護', 检: '檢', 测: '測', 试: '試', 验: '驗',
  报: '報', 价: '價', 询: '詢', 盘: '盤', 户: '戶', 闻: '聞', 页: '頁',
  类: '類', 详: '詳', 没: '沒', 发: '發', 邮: '郵', 称: '稱',
  话: '話', 国: '國', 题: '題', 术: '術', 参: '參', 数: '數', 隐: '隱',
  权: '權', 问: '問', 员: '員', 读: '讀', 布: '佈', 后: '後', 应: '應',
  领: '領', 务: '務', 样: '樣', 货: '貨', 周: '週', 载: '載',
  册: '冊', 视: '視', 线: '線', 咨: '諮', 厂: '廠', 与: '與', 赖: '賴',
  况: '況', 图: '圖', 纸: '紙', 选: '選', 条: '條', 输: '輸',
  订: '訂', 阅: '閱', 将: '將', 请: '請', 复: '覆', 败: '敗',
  简: '簡', 繁: '繁', 体: '體', 语: '語', 义: '義', 个: '個',
  们: '們', 来: '來', 时: '時', 内: '內', 对: '對',
  该: '該', 为: '為', 并: '並', 获: '獲', 从: '從', 达: '達', 进: '進',
  过: '過', 还: '還', 这: '這', 边: '邊', 无: '無', 专: '專',
  业: '業', 实: '實', 现: '現', 场: '場', 环: '環',
  书: '書', 单: '單', 据: '據', 库: '庫', 储: '儲', 码: '碼', 签: '簽',
};

/** 简体中文 → 台湾用语繁体中文 */
export function toTraditional(text) {
  let out = String(text || '');
  for (const [from, to] of TW_PHRASES) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  // 单字替换放在最后：长词已经处理完，剩下的按字补
  out = out.replace(/./gu, ch => TW_CHARS[ch] || ch);
  return out;
}

/* ------------------------------------------------------------------ *
 * 术语保护
 * ------------------------------------------------------------------ */

/**
 * 不该被翻译的片段。顺序有意义：先 URL / 邮箱，再认证号 / 型号 / 带数字的单位，
 * 避免「ISO 9001」里的 9001 被后面的数字规则先吃掉。
 */
const KEEP_PATTERNS = [
  /https?:\/\/[^\s<>"'()]+/gi,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  /\b(?:ISO|IEC|CE|DIN|ANSI|API|GB|TÜV|TUV|SGS|ATEX|RoHS|REACH|UL|CSA)\s?[\w./-]*\d[\w./-]*/gi,
  /\b[A-Z][A-Z0-9]{1,}(?:[-–/][A-Z0-9][A-Z0-9-]*)+\b/g,   // HR-CP100 / QT-2026-001
  /\b(?:DN|PN|NPS|DN\d+|PN\d+)\s?\d*\b/gi,                    // DN50 / PN16
  /\b\d+(?:[.,]\d+)?\s?(?:MPa|bar|kW|m³\/h|m3\/h|L\/min|rpm|mm|cm|kg|Hz|V|A|W|°C|℃|%)\b/gi,
];

/**
 * 把不该翻译的片段换成 `__B2BK0__` 之类的占位符。
 * @param {string} text 原文
 * @param {Array<{src:string, dst?:string, keep?:boolean}>} glossary 后台术语表
 * @returns {{ text:string, tokens:Array<{token:string, value:string}> }}
 */
export function protectTerms(text, glossary = []) {
  let out = String(text || '');
  const tokens = [];
  let n = 0;

  const stash = (value) => {
    const token = `__B2BK${n++}__`;
    tokens.push({ token, value });
    return token;
  };

  // 后台自定义术语表优先（长词在前），keep=true 原样保留，否则用 dst 替换
  const custom = (Array.isArray(glossary) ? glossary : [])
    .filter(g => g && typeof g.src === 'string' && g.src.trim())
    .sort((a, b) => b.src.length - a.src.length);
  for (const g of custom) {
    const src = g.src.trim();
    if (!out.includes(src)) continue;
    const value = g.keep === false && g.dst ? String(g.dst) : src;
    out = out.split(src).join(stash(value));
  }

  for (const re of KEEP_PATTERNS) {
    out = out.replace(re, (m) => stash(m));
  }
  return { text: out, tokens };
}

/** 翻译后把占位符还原 */
export function restoreTerms(text, tokens = []) {
  let out = String(text || '');
  for (const { token, value } of tokens) {
    // 模型偶尔会在 token 里插空格或改写大小写，做一次宽松匹配兜底
    out = out.replace(new RegExp(token, 'gi'), value);
    if (out.includes(token.toLowerCase())) {
      out = out.split(token.toLowerCase()).join(value);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 长文分段（m2m100 是 seq2seq，超长输入会被截断）
 * ------------------------------------------------------------------ */

/** 按句边界切，单段不超过 maxChars；返回字符串数组 */
export function splitText(text, maxChars = 600, maxParts = 5) {
  const src = String(text || '').trim();
  if (!src) return [];
  if (src.length <= maxChars) return [src];

  // 中英文句末标点 + 换行都是安全切点
  const sentences = src.split(/(?<=[。！？!?；;.\n])/u).filter(Boolean);
  const parts = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && (buf + s).length > maxChars) { parts.push(buf.trim()); buf = ''; }
    if (s.length > maxChars) {
      // 单句就超长：硬切，但尽量别把占位符 __B2BK0__ 从中间劈开
      for (let i = 0; i < s.length; i += maxChars) {
        parts.push(s.slice(i, i + maxChars));
        if (parts.length >= maxParts) break;
      }
      if (parts.length >= maxParts) break;
      continue;
    }
    buf += s;
    if (parts.length >= maxParts) break;
  }
  if (buf.trim() && parts.length < maxParts) parts.push(buf.trim());
  return parts.slice(0, maxParts);
}

/** 拼回分段结果（中文之间不加空格，西语/阿语之间加空格） */
export function joinParts(parts, targetLang) {
  const sep = /^(zh|ja|ko)/i.test(targetLang) ? '' : ' ';
  return parts.map(p => String(p || '').trim()).filter(Boolean).join(sep);
}

/* ------------------------------------------------------------------ *
 * 入参清洗
 * ------------------------------------------------------------------ */

/**
 * 只保留 allowedFields 里的键、去掉非字符串、限长。
 * 不做这一步的话，前端能把整库内容塞进一次请求把额度烧光。
 */
export function cleanFields(fields, allowedFields, maxLen = 4000) {
  const out = {};
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return out;
  for (const key of allowedFields) {
    const v = fields[key];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed) out[key] = trimmed.slice(0, maxLen);
  }
  return out;
}
