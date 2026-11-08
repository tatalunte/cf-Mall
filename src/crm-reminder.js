/**
 * 跟进提醒（阶段二A）
 *
 * Cron 是每小时跑一次（邮件失败重试用），但提醒邮件不能每小时发一封——那就是垃圾邮件。
 * 所以在这里判断 UTC 小时：只有 08:00 那一轮才汇总发送，其余每小时只做邮件重试。
 *
 * 只发一封「今日待跟进」摘要，不发逐条提醒：
 * 外贸团队通常 1-3 人共用 sales@ 邮箱，逐条提醒会瞬间淹没收件箱。
 */
import { escapeHtml } from './utils/html';

/** 需要提醒的询盘：已到跟进时间且尚未结束 */
async function fetchDue(env) {
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.name, i.email, i.company, i.country, i.status, i.priority,
            i.next_follow_at, p.name AS product_name,
            CAST(julianday('now') - julianday(i.next_follow_at) AS INTEGER) AS overdue_days
       FROM inquiries i LEFT JOIN products p ON p.id = i.product_id
      WHERE i.next_follow_at IS NOT NULL
        AND date(i.next_follow_at) <= date('now')
        AND i.status NOT IN ('won', 'lost', 'spam')
      ORDER BY i.next_follow_at ASC
      LIMIT 100`
  ).all();
  return results || [];
}

function renderDigest(list, baseUrl) {
  const badge = (p) => {
    const map = { hot: '#dc2626', warm: '#f59e0b', cold: '#6b7280' };
    const bg = map[p] || map.warm;
    return `<span style="display:inline-block;padding:1px 7px;border-radius:9px;background:${bg};color:#fff;font-size:11px">${escapeHtml(p || 'warm')}</span>`;
  };
  const rows = list.map(i => {
    const overdue = Number(i.overdue_days || 0);
    const when = overdue > 0
      ? `<span style="color:#dc2626">${overdue} day(s) overdue</span>`
      : 'today';
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">
        <a href="${escapeHtml(baseUrl)}/admin/dashboard#inquiry-${i.id}" style="color:#2563eb;text-decoration:none">#${i.id}</a>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${badge(i.priority)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">
        ${escapeHtml(i.name || '')}${i.company ? `<br><span style="color:#6b7280;font-size:12px">${escapeHtml(i.company)}</span>` : ''}
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(i.country || '-')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(i.product_name || '-')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${escapeHtml(i.status || '-')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">${when}</td>
    </tr>`;
  }).join('');

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
    <h2 style="margin:0 0 4px">${list.length} follow-up${list.length > 1 ? 's' : ''} due today</h2>
    <p style="color:#6b7280;margin:0 0 16px;font-size:13px">
      Auto-generated daily digest. Only inquiries whose follow-up date is today or earlier are listed.
    </p>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead>
        <tr style="background:#f9fafb;text-align:left">
          <th style="padding:8px 10px">ID</th>
          <th style="padding:8px 10px">Priority</th>
          <th style="padding:8px 10px">Contact</th>
          <th style="padding:8px 10px">Country</th>
          <th style="padding:8px 10px">Product</th>
          <th style="padding:8px 10px">Status</th>
          <th style="padding:8px 10px">Due</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:18px">
      <a href="${escapeHtml(baseUrl)}/admin/dashboard"
         style="display:inline-block;padding:9px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">
        Open dashboard
      </a>
    </p>
  </div>`;
}

export async function sendFollowupDigest(env) {
  if (!env.RESEND_API_KEY || !env.MAIL_TO) return { skipped: 'mail not configured' };

  const list = await fetchDue(env);
  if (!list.length) return { skipped: 'nothing due' };

  // SITE_URL 未配置时用占位域名，至少链接不会崩
  const baseUrl = (env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_'))
    ? env.SITE_URL.replace(/\/$/, '')
    : 'https://example.com';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'B2B Notify <notify@example.com>',
      to: env.MAIL_TO.split(',').map(s => s.trim()).filter(Boolean),
      subject: `[Follow-up] ${list.length} inquir${list.length > 1 ? 'ies' : 'y'} due (${new Date().toISOString().slice(0, 10)})`,
      html: renderDigest(list, baseUrl),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${text.slice(0, 200)}`);
  }
  return { sent: list.length };
}

/**
 * Cron 入口：只在 UTC 08:00 那一轮发摘要。
 * 返回值用于本地测试断言，不影响线上行为。
 */
export async function maybeSendFollowupDigest(env, scheduledTime) {
  const d = new Date(scheduledTime || Date.now());
  if (d.getUTCHours() !== 8) return { skipped: `hour ${d.getUTCHours()} != 8` };
  return sendFollowupDigest(env);
}
