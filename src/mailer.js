/**
 * 询盘邮件（改造版新增）
 * 链路：POST /api/inquiries -> D1 落库 -> Queue -> 本文件消费 -> Resend HTTP API
 * 为什么必须异步：Workers Free 单请求仅 10ms CPU，同步 fetch 发信必然超时。
 * MailChannels 免费 Workers 集成已停用，不要再用 2024 年前的老教程。
 */
import { escapeHtml } from './utils/html';
import { getTemplates, renderTemplate, textToHtml } from './mail-templates';

export async function handleMailQueue(batch, env) {
  for (const msg of batch.messages) {
    const inquiryId = msg.body && msg.body.inquiryId;
    if (!inquiryId) { msg.ack(); continue; }

    let inquiry;
    try {
      inquiry = await env.DB.prepare(
        `SELECT i.*, p.name AS product_name FROM inquiries i
         LEFT JOIN products p ON p.id = i.product_id WHERE i.id = ?`
      ).bind(inquiryId).first();
    } catch (e) {
      console.error('mail queue db read failed', e);
      msg.retry();
      continue;
    }

    if (!inquiry || inquiry.mail_status === 'sent') { msg.ack(); continue; }

    try {
      await sendInquiryMail(env, inquiry);
      await env.DB.prepare(
        "UPDATE inquiries SET mail_status = 'sent', mail_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(inquiryId).run();
      if (env.AUTO_REPLY === 'true') await sendAutoReply(env, inquiry);
      msg.ack();
    } catch (error) {
      console.error('resend failed', error);
      await env.DB.prepare(
        "UPDATE inquiries SET mail_status = 'failed', mail_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).bind(String(error.message || error).slice(0, 500), inquiryId).run();
      msg.retry(); // max_retries=3 后进 DLQ
    }
  }
}

async function callResend(env, payload) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function rows(inquiry) {
  const item = (label, value) => value
    ? `<tr><th style="text-align:left;padding:6px 12px;color:#6b7280;">${escapeHtml(label)}</th><td style="padding:6px 12px;">${escapeHtml(value)}</td></tr>`
    : '';
  return [
    item('Inquiry ID', '#' + inquiry.id),
    item('Product', inquiry.product_name),
    item('Name', inquiry.name),
    item('Email', inquiry.email),
    item('Company', inquiry.company),
    item('Phone / WhatsApp', inquiry.phone),
    item('Country', inquiry.country),
    item('Language', inquiry.lang),
    item('Source', inquiry.source),
    item('Received', inquiry.created_at),
  ].join('');
}

async function sendInquiryMail(env, inquiry) {
  // 阶段二C：主题/标题/页脚走可编辑模板（KV），运营改话术不用重新部署
  const tpl = await getTemplates(env);
  const vars = {
    id: inquiry.id,
    name: inquiry.name,
    company: inquiry.company || '-',
    email: inquiry.email,
    country: inquiry.country || '-',
    product: inquiry.product_name || 'General',
  };
  const subject = renderTemplate(tpl.inquiry_subject, vars);
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px">
    <h2 style="color:#1d4ed8">${renderTemplate(tpl.inquiry_intro, vars)}</h2>
    <table style="border-collapse:collapse;background:#f9fafb;padding:12px">${rows(inquiry)}</table>
    <h3 style="margin-top:20px">Message</h3>
    <p style="white-space:pre-wrap;background:#f9fafb;padding:16px;border-radius:6px">${escapeHtml(inquiry.message)}</p>
    <p style="margin-top:24px;font-size:13px;color:#6b7280">
      ${renderTemplate(tpl.inquiry_footer, vars)}
    </p>
  </div>`;
  return callResend(env, {
    from: env.MAIL_FROM || 'B2B Inquiry <notify@yourdomain.com>',
    to: [env.MAIL_TO || 'sales@yourdomain.com'],
    reply_to: inquiry.email,
    subject,
    html,
  });
}

async function sendAutoReply(env, inquiry) {
  // 给客户的确认信（可选，AUTO_REPLY=true 开启）；注意 GDPR：不要塞营销内容
  const tpl = await getTemplates(env);
  const vars = {
    id: inquiry.id,
    name: inquiry.name,
    company: inquiry.company || '-',
    country: inquiry.country || '-',
    product: inquiry.product_name || 'our products',
  };
  return callResend(env, {
    from: env.MAIL_FROM,
    to: [inquiry.email],
    subject: renderTemplate(tpl.auto_reply_subject, vars),
    html: textToHtml(renderTemplate(tpl.auto_reply_body, vars)),
  });
}

/** Cron 兜底：把 24h 内发信失败的记录重新投递（需在 wrangler.toml 配 [triggers]） */
export async function retryFailedMails(env) {
  if (!env.INQUIRY_QUEUE) return { skipped: 'no queue binding' };
  const { results } = await env.DB.prepare(
    `SELECT id FROM inquiries
     WHERE mail_status = 'failed' AND created_at > datetime('now', '-1 day')
     LIMIT 50`
  ).all();
  for (const row of results) await env.INQUIRY_QUEUE.send({ inquiryId: row.id });
  return { requeued: results.length };
}
