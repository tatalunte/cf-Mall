/**
 * 订单状态机（阶段三）
 *
 * 为什么单独抽成纯函数：
 *  1) 后台交易工作台要按「允许的下一步」渲染按钮，规则若在页面里复制一份，
 *     两处一旦漂移就会出现「按钮点了却 400」的体验；
 *  2) 无副作用，可以直接用 node 跑自测（test-artifacts/b-orders-test.mjs）。
 *
 * 规则来自 docs/phase3-contract.md 第 4 节：只能向前推进。
 * shipped 之后不再允许 cancelled —— 货已发出，取消要走退货流程，不是改个状态能了事的。
 */

export const ORDER_STATUSES = [
  'placed',
  'confirmed',
  'in_production',
  'ready',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
];

const TRANSITIONS = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['in_production', 'cancelled'],
  in_production: ['ready', 'cancelled'],
  ready: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

const LABELS = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  in_production: 'In Production',
  ready: 'Ready to Ship',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** 对应 .badge-{green,amber,red,blue,gray}，未知状态一律灰色，避免前端拼出不存在的类名 */
const COLORS = {
  placed: 'gray',
  confirmed: 'blue',
  in_production: 'amber',
  ready: 'amber',
  shipped: 'blue',
  delivered: 'green',
  completed: 'green',
  cancelled: 'red',
};

export function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(to);
}

/** 终态返回空数组（前端据此隐藏「推进状态」按钮） */
export function nextStatuses(status) {
  const allowed = TRANSITIONS[status];
  return Array.isArray(allowed) ? allowed.slice() : [];
}

export function statusLabel(status) {
  return LABELS[status] || String(status || '');
}

export function statusColor(status) {
  return COLORS[status] || 'gray';
}

/**
 * 单号 `SO-YYYYMMDD-####`。
 * 放在这里是为了让「生成」与「自测」共用同一份实现，避免测试脚本里再抄一遍格式。
 */
export function formatOrderNo(stamp, seq) {
  return `SO-${stamp}-${String(seq).padStart(4, '0')}`;
}
