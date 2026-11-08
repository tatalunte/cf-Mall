-- cf-b2b-pro 增量迁移脚本（只需执行一次，D1 的 ADD COLUMN 不支持 IF NOT EXISTS）
-- wrangler d1 execute b2b_database --remote --file=./schema/migrate.sql

-- 1) 修复原版致命 Bug：schema.sql 把两个默认管理员都写成 role='admin'，
--    但 requireSuperAdmin() 要求 'super_admin'，导致按官方脚本初始化后所有写操作全部 403。
UPDATE admins SET role = 'super_admin' WHERE username = 'admin123';
UPDATE admins SET role = 'admin'       WHERE username = 'staff';

-- 2) 询盘：轻 CRM + 邮件状态 + 合规
ALTER TABLE inquiries ADD COLUMN notes TEXT;          -- 销售跟进备注
ALTER TABLE inquiries ADD COLUMN assignee TEXT;       -- 指派业务员
ALTER TABLE inquiries ADD COLUMN lang TEXT DEFAULT 'en';
ALTER TABLE inquiries ADD COLUMN source TEXT;         -- 来源页面 / 语种 / UTM
ALTER TABLE inquiries ADD COLUMN consent INTEGER DEFAULT 0;  -- GDPR 同意勾选
ALTER TABLE inquiries ADD COLUMN mail_status TEXT DEFAULT 'pending'; -- pending/sent/failed
ALTER TABLE inquiries ADD COLUMN mail_error TEXT;
ALTER TABLE inquiries ADD COLUMN quoted_at DATETIME;

-- 3) 产品：SEO slug + 多语言翻译 + B2B 字段
ALTER TABLE products ADD COLUMN slug TEXT;            -- /products/slug 替代 /products/12
ALTER TABLE products ADD COLUMN translations TEXT;    -- JSON: {"es":{"name":"...","description":"..."}}
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN moq TEXT;
ALTER TABLE products ADD COLUMN seo_title TEXT;
ALTER TABLE products ADD COLUMN seo_description TEXT;

CREATE INDEX IF NOT EXISTS idx_inquiries_created ON inquiries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_mail ON inquiries(mail_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug) WHERE slug IS NOT NULL;

-- 4) 给已有产品补一个可用的 slug（示例：id + 名称简写，正式上线前建议后台逐个改成语义化 slug）
-- UPDATE products SET slug = lower(replace(name, ' ', '-')) || '-' || id WHERE slug IS NULL;

-- 5) 安全：务必删除/停用默认账号，改用 reset-admin.mjs 生成 PBKDF2 哈希
--    生成后执行：
--    UPDATE admins SET password_hash = '<pbkdf2$...>' WHERE username = '<你的新用户名>';
--    或：
--    DELETE FROM admins WHERE username IN ('admin123','staff');
--    INSERT INTO admins (username,password_hash,email,role) VALUES ('<新用户名>','<pbkdf2$...>','you@domain.com','super_admin');
