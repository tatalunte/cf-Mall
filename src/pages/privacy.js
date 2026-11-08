/**
 * 隐私政策页（GDPR 必备，询盘表单 consent 勾选项指向这里）
 * 上线前请替换成你公司的真实条款（数据控制者、留存期、删除权、联系方式）。
 */
import { createLayout } from './layout';

export async function privacyPage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  const site = env.SITE_URL && !env.SITE_URL.startsWith('REPLACE_')
    ? env.SITE_URL.replace(/\/$/, '') : new URL(request.url).origin;
  const content = `
  <section class="container" style="margin:3rem auto;max-width:820px;line-height:1.9">
    <h1>Privacy Policy</h1>
    <p>Last updated: ${new Date().toISOString().slice(0, 10)}</p>
    <h2>1. What we collect</h2>
    <p>When you submit an inquiry we collect your name, email address, company, phone number,
       country and the content of your message, plus technical data such as your language preference.</p>
    <h2>2. Why we collect it</h2>
    <p>Solely to reply to your inquiry, prepare a quotation and maintain the business relationship.
       We do not sell your data and we do not use it for advertising without your explicit consent.</p>
    <h2>3. Retention</h2>
    <p>Inquiry records are kept for 24 months and then deleted, unless a longer period is required by law.</p>
    <h2>4. Your rights</h2>
    <p>You may request access, correction or deletion of your personal data at any time by emailing
       the address shown on our Contact page.</p>
    <h2>5. Processors</h2>
    <p>Our site runs on Cloudflare (hosting, security, object storage) and uses Resend to deliver
       notification emails. Both act as data processors under their own privacy terms.</p>
    <p>This site: ${site}</p>
  </section>`;
  return new Response(createLayout('Privacy Policy', content, '', 'How we collect, use and store inquiry data, newsletter addresses and analytics — and how to request deletion.', true, {
    env, request, lang,
  }), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
