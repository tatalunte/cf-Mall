#!/usr/bin/env node
/**
 * 备用推送通道：当本机网络只放行 api.github.com、git push 到 github.com 被代理拒绝时，
 * 用 GitHub Git Data API 把当前工作区/HEAD 的完整文件树写成一个 commit 并更新 refs/heads/main。
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node scripts/push-via-api.mjs
 *   GITHUB_REPO=owner/repo GITHUB_TOKEN=... node scripts/push-via-api.mjs
 *
 * 前提：
 *   1) 仓库已存在；若是完全空仓库，先用 Contents API 创建任一文件激活它：
 *      PUT /repos/{repo}/contents/.gitignore  {"message":"Initialize repository","content":"<base64>"}
 *      否则 /git/blobs 会返回 409 "Git Repository is empty"。
 *   2) token 有 Contents:Read&Write（classic PAT 的 repo scope 即可）。
 *
 * 注意：经 API 创建的 commit 会触发 push 事件与 Actions；本脚本生成的 commit 与本地 HEAD
 * 的 SHA 不同（parent 链不同），换到可访问 github.com 的网络后用
 *   git fetch origin && git reset --hard origin/main
 * 对齐历史。凭据只从环境变量读，绝不落盘到仓库。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

const ROOT = process.cwd();
const REPO = process.env.GITHUB_REPO || 'tatalunte/cf-Mall';
const R = `/repos/${REPO}`;
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}

function api(method, urlPath, body) {
  const args = ['-sS', '--ssl-no-revoke', '-w', '\n__STATUS__%{http_code}', '-X', method,
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: cf-b2b-pro-deploy'];
  let input;
  if (body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
    input = JSON.stringify(body);
  }
  args.push('https://api.github.com' + urlPath);
  const out = execFileSync('curl', args, {
    input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const m = out.match(/__STATUS__(\d{3})\s*$/);
  const status = Number(m ? m[1] : 0);
  const text = out.replace(/__STATUS__\d{3}\s*$/, '');
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  return { status, json, text };
}

const must = (r, what) => {
  if (r.status < 200 || r.status >= 300 || !r.json) {
    throw new Error(`${what} 失败 HTTP ${r.status}: ${r.text.slice(0, 300)}`);
  }
  return r.json;
};

const ls = execSync('git ls-files -s -z', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const entries = ls.split('\0').filter(Boolean).map(line => {
  const tab = line.indexOf('\t');
  return { mode: line.slice(0, tab).split(' ')[0], path: line.slice(tab + 1) };
});
console.log(`目标 ${REPO} · 待上传 ${entries.length} 个文件`);

const tree = [];
for (let i = 0; i < entries.length; i += 1) {
  const e = entries[i];
  const buf = fs.readFileSync(path.join(ROOT, e.path));
  const blob = must(api('POST', `${R}/git/blobs`, {
    content: buf.toString('base64'), encoding: 'base64',
  }), `blob ${e.path}`);
  tree.push({ path: e.path, mode: e.mode, type: 'blob', sha: blob.sha });
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${entries.length}`);
}

const t = must(api('POST', `${R}/git/trees`, { tree }), 'tree');
const before = api('GET', `${R}/git/ref/heads/main`);
const parents = before.status === 200 && before.json?.object?.sha ? [before.json.object.sha] : [];
const message = execSync('git log -1 --format=%B', { encoding: 'utf8' }).trim();
const c = must(api('POST', `${R}/git/commits`, { message, tree: t.sha, parents }), 'commit');
console.log('commit:', c.sha, '| parent:', parents[0] || '(root)');

const ref = parents.length
  ? api('PATCH', `${R}/git/refs/heads/main`, { sha: c.sha, force: true })
  : api('POST', `${R}/git/refs`, { ref: 'refs/heads/main', sha: c.sha });
must(ref, 'ref');

const head = must(api('GET', `${R}/git/ref/heads/main`), 'read ref');
console.log('远端 main:', head.object.sha);
console.log('完成。push 事件会自动触发仓库里的 Actions。');
