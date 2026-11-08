-- 阶段一C：产品扩展字段 + 询盘附件与来源归因
--
-- ⚠️ D1 的 ALTER TABLE 不支持 ADD COLUMN IF NOT EXISTS，本文件只能执行一次。
--    全新安装请直接用 schema/bootstrap.sql（已包含这些列），不要跑本文件。
--    重复执行会报 "duplicate column name"，属预期，可忽略。

-- 产品：视频、应用场景、定制、样品政策、交期、资料下载、关联产品
ALTER TABLE products ADD COLUMN video_url TEXT;
ALTER TABLE products ADD COLUMN applications TEXT;        -- 应用场景，逗号或换行分隔
ALTER TABLE products ADD COLUMN customization TEXT;       -- 可定制项
ALTER TABLE products ADD COLUMN sample_policy TEXT;       -- 样品政策
ALTER TABLE products ADD COLUMN lead_time TEXT;           -- 交货周期
ALTER TABLE products ADD COLUMN datasheet_url TEXT;       -- 规格书 / 图纸下载
ALTER TABLE products ADD COLUMN related_ids TEXT;         -- JSON 数组，手工指定相关产品

-- 询盘：附件 + 来源归因（UTM / landing page / referrer）
ALTER TABLE inquiries ADD COLUMN attachment_url TEXT;
ALTER TABLE inquiries ADD COLUMN attachment_name TEXT;
ALTER TABLE inquiries ADD COLUMN utm_source TEXT;
ALTER TABLE inquiries ADD COLUMN utm_medium TEXT;
ALTER TABLE inquiries ADD COLUMN utm_campaign TEXT;
ALTER TABLE inquiries ADD COLUMN utm_term TEXT;
ALTER TABLE inquiries ADD COLUMN utm_content TEXT;
ALTER TABLE inquiries ADD COLUMN landing_page TEXT;
ALTER TABLE inquiries ADD COLUMN referrer TEXT;

CREATE INDEX IF NOT EXISTS idx_inquiries_utm_source ON inquiries(utm_source);
CREATE INDEX IF NOT EXISTS idx_inquiries_created_status ON inquiries(created_at DESC, status);
