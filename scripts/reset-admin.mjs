/**
 * 生成 PBKDF2 管理员口令哈希（Node 18+ 自带 Web Crypto，与 Workers 端算法完全一致）
 * 用法：node scripts/reset-admin.mjs '你的强密码'
 * 输出：可直接执行的 UPDATE / INSERT SQL 与 wrangler 命令
 */
const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('用法: node scripts/reset-admin.mjs "<至少12位的强密码>"');
  process.exit(1);
}

const enc = new TextEncoder();
const ITER = 150000;
const b64url = (input) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return Buffer.from(s, 'binary').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256
);
const hash = `pbkdf2$${ITER}$${b64url(salt)}$${b64url(bits)}`;

console.log('\n1) 先删除默认账号（原版默认 admin123/admin123 是公开信息）：');
console.log("   wrangler d1 execute b2b_database --remote --command=\"DELETE FROM admins WHERE username IN ('admin123','staff');\"");
console.log('\n2) 再创建你自己的超级管理员（把用户名/邮箱换成你的）：');
console.log(`   wrangler d1 execute b2b_database --remote --command="INSERT INTO admins (username,password_hash,email,role) VALUES ('YOUR_USERNAME','${hash}','you@yourdomain.com','super_admin');"`);
console.log('\n3) 别忘了配置 JWT 密钥：wrangler secret put JWT_SECRET\n');
