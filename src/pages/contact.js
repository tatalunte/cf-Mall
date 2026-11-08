/**
 * Contact Page
 * Displays contact information and inquiry form
 */

import { createLayout } from './layout';
import { escapeHtml } from '../utils/html';
import { t, localizedUrl } from '../i18n';

export async function contactPage(request, env) {
  const lang = env.LANG || env.DEFAULT_LANG || 'en';
  let settings = { site_name: 'B2B Product Exhibition' };
  try {
    const raw = await env.STATIC_ASSETS.get('website_settings');
    if (raw) settings = { ...settings, ...JSON.parse(raw) };
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  const siteName = settings.site_name;
  const turnstile = (env.TURNSTILE_SITEKEY && !env.TURNSTILE_SITEKEY.startsWith('REPLACE_'))
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
       <div class="cf-turnstile" data-sitekey="${escapeHtml(env.TURNSTILE_SITEKEY)}" data-theme="light"></div>`
    : '<p style="font-size:.8rem;color:#b45309">Turnstile is not configured yet — set it up before going live.</p>';

  // 社交图标：原来三个都是 href="#" 的空链接，点了没反应（审计脚本抓到的死按钮）。
  // 改成由后台设置驱动：没配就整块不渲染，配了才出对应图标。
  const socialLinks = [
    ['Facebook', 'f', settings.facebook],
    ['LinkedIn', 'in', settings.linkedin],
    ['Twitter / X', 't', settings.twitter],
  ].filter(([, , url]) => typeof url === 'string' && /^https?:\/\//i.test(url.trim()));
  const socialBlock = socialLinks.length ? `
          <div>
            <h3 style="font-size: 1.25rem; margin-bottom: 1rem; color: var(--primary-color);">Follow Us</h3>
            <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
              ${socialLinks.map(([label, glyph, url]) => `<a href="${escapeHtml(url.trim())}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--primary-color); color: var(--on-primary); border-radius: 50%; text-decoration: none; font-size: 1.2rem;">${glyph}</a>`).join('')}
            </div>
          </div>` : '';

  // 营业时间：原来是写死的三行英文，改了就得重新部署。改为后台可配（每行一条），
  // 留空则回落到原来的默认值，老数据不受影响。
  const DEFAULT_HOURS = ['Monday - Friday: 9:00 AM - 6:00 PM', 'Saturday: 10:00 AM - 4:00 PM', 'Sunday: Closed'];
  const hoursLines = (typeof settings.business_hours === 'string' && settings.business_hours.trim())
    ? settings.business_hours.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    : DEFAULT_HOURS;
  const businessHoursHtml = hoursLines.map(escapeHtml).join('<br>');

  const content = `
    <!-- Page Header -->
    <section class="hero" style="padding: 3rem 2rem;">
      <div class="container">
        <h1>Contact Us</h1>
        <p>Get in touch with us - we'd love to hear from you!</p>
      </div>
    </section>

    <!-- Contact Section -->
    <section class="container" style="margin-top: 3rem; margin-bottom: 3rem;">
      <div class="contact-grid" style="display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 3rem;">
        <!-- Contact Information -->
        <div>
          <h2 style="font-size: 1.75rem; margin-bottom: 1.5rem; color: var(--primary-color);">Get In Touch</h2>
          <p style="color: var(--text-light); line-height: 1.8; margin-bottom: 2rem;">
            Have a question or want to learn more about our products? We're here to help.
            Fill out the form or use our contact information below.
          </p>

          <div style="margin-bottom: 3rem;">
            <div style="display: flex; align-items: start; margin-bottom: 1.5rem;">
              <div style="font-size: 1.5rem; margin-right: 1rem; color: var(--primary-color);">📍</div>
              <div>
                <h3 style="font-weight: 600; margin-bottom: 0.25rem;">Address</h3>
                <p id="contact-address" style="color: var(--text-light);">123 Business Street<br>Industrial Zone<br>City, Country 12345</p>
              </div>
            </div>

            <div style="display: flex; align-items: start; margin-bottom: 1.5rem;">
              <div style="font-size: 1.5rem; margin-right: 1rem; color: var(--primary-color);">📧</div>
              <div>
                <h3 style="font-weight: 600; margin-bottom: 0.25rem;">Email</h3>
                <p id="contact-email-info" style="color: var(--text-light);">
                  <a id="contact-email-link" href="mailto:info@example.com" style="color: var(--primary-color);">info@example.com</a>
                </p>
              </div>
            </div>

            <div style="display: flex; align-items: start; margin-bottom: 1.5rem;">
              <div style="font-size: 1.5rem; margin-right: 1rem; color: var(--primary-color);">📞</div>
              <div>
                <h3 style="font-weight: 600; margin-bottom: 0.25rem;">Phone</h3>
                <p id="contact-phone-info" style="color: var(--text-light);">
                  +1 234 567 8900
                </p>
              </div>
            </div>

            <div style="display: flex; align-items: start;">
              <div style="font-size: 1.5rem; margin-right: 1rem; color: var(--primary-color);">🕐</div>
              <div>
                <h3 style="font-weight: 600; margin-bottom: 0.25rem;">Business Hours</h3>
                <p style="color: var(--text-light);">
                  ${businessHoursHtml}
                </p>
              </div>
            </div>
          </div>

          <!-- Social Media（仅当后台配置了链接时才渲染） -->
          ${socialBlock}
        </div>

        <!-- Contact Form -->
        <div>
          <div class="card">
            <div class="card-content" style="padding: 2rem;">
              <h2 style="font-size: 1.75rem; margin-bottom: 1.5rem; color: var(--primary-color);">Send Us a Message</h2>

              <form id="contact-form">
                <div class="form-group">
                  <label class="form-label">Your Name *</label>
                  <input type="text" id="contact-name" class="form-input" required>
                </div>

                <div class="form-group">
                  <label class="form-label">Email Address *</label>
                  <input type="email" id="contact-email" class="form-input" required>
                </div>

                <div class="form-group">
                  <label class="form-label">Company</label>
                  <input type="text" id="contact-company" class="form-input">
                </div>

                <div class="form-group">
                  <label class="form-label">Phone Number</label>
                  <input type="tel" id="contact-phone" class="form-input">
                </div>

                <div class="form-group">
                  <label class="form-label">Country</label>
                  <input type="text" id="contact-country" class="form-input">
                </div>

                <div class="form-group">
                  <label class="form-label">Subject *</label>
                  <select id="contact-subject" class="form-input" required>
                    <option value="">Select a subject...</option>
                    <option value="Product Inquiry">Product Inquiry</option>
                    <option value="Quote Request">Quote Request</option>
                    <option value="Technical Support">Technical Support</option>
                    <option value="Partnership">Partnership Opportunity</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label">Message *</label>
                  <textarea id="contact-message" class="form-textarea" required placeholder="Tell us how we can help you..."></textarea>
                </div>

                <div class="form-group">
                  <label class="form-label" for="contact-attachment">${escapeHtml(t(lang, 'attachment'))}</label>
                  <input type="file" id="contact-attachment" class="form-input" accept=".pdf,.jpg,.jpeg,.png">
                  <small style="color:var(--text-light);font-size:.75rem">PDF / JPG / PNG, max 5 MB. Attach drawings, photos or specifications to speed up quoting.</small>
                </div>

                <input type="text" name="website" tabindex="-1" autocomplete="off"
                       style="position:absolute;left:-9999px" aria-hidden="true">
                <div class="form-group" style="font-size:.85rem">
                  <label><input type="checkbox" id="contact-consent" required>
                    ${escapeHtml(t(lang, 'consent'))}
                    (<a href="${escapeHtml(localizedUrl('/privacy', lang, env))}" target="_blank">Privacy Policy</a>)</label>
                </div>
                ${turnstile}
                <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">
                  ${escapeHtml(t(lang, 'submit'))}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  const scripts = `
    <script>
      // Handle contact form submission
      document.getElementById('contact-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        // Validate email
        const email = document.getElementById('contact-email').value;
        if (!validateEmail(email)) {
          showNotification('Please enter a valid email address', 'error');
          return;
        }

        const form = document.getElementById('contact-form');
        const tokenEl = form.querySelector('input[name="cf-turnstile-response"]');

        // 带附件时必须用 multipart（附件与询盘同一次请求提交，不额外开放上传接口）
        const fd = new FormData();
        fd.append('name', document.getElementById('contact-name').value);
        fd.append('email', email);
        fd.append('company', document.getElementById('contact-company').value);
        fd.append('phone', document.getElementById('contact-phone').value);
        fd.append('country', document.getElementById('contact-country').value);
        fd.append('message', document.getElementById('contact-subject').value + ': ' + document.getElementById('contact-message').value);
        fd.append('website', form.querySelector('input[name="website"]').value);
        fd.append('consent', document.getElementById('contact-consent').checked ? 'true' : 'false');
        fd.append('lang', '${lang}');
        fd.append('source', 'contact page');
        fd.append('turnstile_token', tokenEl ? tokenEl.value : '');

        const fileEl = document.getElementById('contact-attachment');
        if (fileEl && fileEl.files && fileEl.files[0]) {
          if (fileEl.files[0].size > 5 * 1024 * 1024) {
            showNotification('Attachment must be under 5 MB', 'error');
            return;
          }
          fd.append('attachment', fileEl.files[0]);
        }

        // 来源归因：UTM / 落地页 / referrer 由公共脚本在首次落地时记住
        const attr = window.getAttribution ? window.getAttribution() : {};
        Object.keys(attr).forEach(function (k) { if (attr[k]) fd.append(k, attr[k]); });

        try {
          const submitBtn = e.target.querySelector('button[type="submit"]');
          submitBtn.disabled = true;
          submitBtn.textContent = 'Sending...';

          const res = await fetch('/api/inquiries', { method: 'POST', body: fd });
          const out = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(out.error || ('HTTP ' + res.status));

          if (window.trackLead) window.trackLead({ source: 'contact_form' });
          showNotification('Thank you for contacting us! We will respond shortly.', 'success');
          document.getElementById('contact-form').reset();

          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Message';
        } catch (error) {
          console.error('Error sending message:', error);
          showNotification('Failed to send message. Please try again or contact us directly.', 'error');

          const submitBtn = e.target.querySelector('button[type="submit"]');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Message';
        }
      });

      // Load contact information from settings
      async function loadContactInfo() {
        try {
          const response = await API.get('/settings');
          if (response.success) {
            const settings = response.data;

            // Update address
            const addressElem = document.getElementById('contact-address');
            if (addressElem && settings.address) {
              addressElem.innerHTML = settings.address.replace(/\\n/g, '<br>');
            }

            // Update email
            const emailLink = document.getElementById('contact-email-link');
            if (emailLink && settings.email) {
              emailLink.href = \`mailto:\${settings.email}\`;
              emailLink.textContent = settings.email;
            }

            // Update phone
            const phoneInfo = document.getElementById('contact-phone-info');
            if (phoneInfo && settings.phone) {
              phoneInfo.textContent = settings.phone;
            }
          }
        } catch (error) {
          console.error('Error loading contact information:', error);
        }
      }

      // Load contact info on page load
      loadContactInfo();

      // Add responsive styles
      // 之前用 section > div > div[style*=...] 选不中：这个 grid 容器其实是 section 的直接子元素，
      // 结果 375px 下仍旧两列并排，整页横向溢出 63px。改成挂 class，别再靠内联样式字符串匹配。
      const contactStyle = document.createElement('style');
      contactStyle.textContent = \`
        @media (max-width: 820px) {
          .contact-grid {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 2rem !important;
          }
        }
        #contact-email-info a, #contact-address, #contact-phone-info { overflow-wrap: anywhere; }
      \`;
      document.head.appendChild(contactStyle);
    </script>
  `;

  const html = createLayout(
    `Contact Us - ${siteName}`,
    content,
    scripts,
    `Get in touch with us - we'd love to hear from you! Contact ${siteName} for inquiries, support, and partnership opportunities.`,
    false,
    { env, request, lang, settings }
  );

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
    },
  });
}
