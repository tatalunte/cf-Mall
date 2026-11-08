/**
 * Admin Login Page
 * Admin authentication page
 */

import { createLayout } from './layout';

export async function adminLoginPage(request, env) {
  const content = `
    <div style="min-height: 80vh; display: flex; align-items: center; justify-content: center; background: var(--bg-light);">
      <div class="card" style="width: 100%; max-width: 450px; margin: 2rem;">
        <div class="card-content" style="padding: 2.5rem;">
          <div style="text-align: center; margin-bottom: 2rem;">
            <h1 style="font-size: 2rem; color: var(--primary-color); margin-bottom: 0.5rem;">Admin Portal</h1>
            <p style="color: var(--text-light);">Sign in to manage your B2B website</p>
          </div>

          <form id="login-form">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input
                type="text"
                id="username"
                class="form-input"
                placeholder="Enter your username"
                required
                autocomplete="username"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Password</label>
              <input
                type="password"
                id="password"
                class="form-input"
                placeholder="Enter your password"
                required
                autocomplete="current-password"
              />
            </div>

            <div id="login-error" style="display: none; background: #fee2e2; color: #dc2626; padding: 0.75rem; border-radius: 0.375rem; margin-bottom: 1rem;">
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 1rem; font-size: 1rem;">
              Sign In
            </button>
          </form>

          <!-- 原版这里印着默认账号口令提示，等于把后台入口拱手送给扫描器，已移除。
               如需在测试环境显示，用环境变量控制，不要写死在页面里。 -->
          <div style="margin-top: 1.5rem; text-align: center;">
            <a href="/" style="color: var(--primary-color); text-decoration: none; font-size: 0.9rem;">
              ← Back to Website
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  const scripts = `
    <script>
      // Check if already logged in
      const token = localStorage.getItem('admin_token');
      if (token) {
        // Verify token
        API.post('/admin/verify', { token })
          .then(() => {
            window.location.href = '/admin/dashboard';
          })
          .catch(() => {
            localStorage.removeItem('admin_token');
          });
      }

      // Handle login form submission
      document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('login-error');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        // Clear previous errors
        errorDiv.style.display = 'none';

        // Disable submit button
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        try {
          const response = await API.post('/admin/login', {
            username,
            password,
          });

          if (response.success) {
            // Store token and user role
            localStorage.setItem('admin_token', response.data.token);
            localStorage.setItem('admin_role', response.data.user.role || 'admin');

            // Show success message
            showNotification('Login successful! Redirecting...', 'success');

            // Redirect to dashboard
            setTimeout(() => {
              window.location.href = '/admin/dashboard';
            }, 1000);
          } else {
            throw new Error(response.error || 'Login failed');
          }
        } catch (error) {
          console.error('Login error:', error);
          errorDiv.textContent = error.message || 'Invalid username or password';
          errorDiv.style.display = 'block';

          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In';
        }
      });
    </script>
  `;

  const html = createLayout('Admin Login', content, scripts);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
    },
  });
}
