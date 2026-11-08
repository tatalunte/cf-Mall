#!/usr/bin/env bash
# 生成当前 HEAD 的离线备份：源码 zip 快照 + git bundle（含全部历史与 tag）
# 用法： bash scripts/backup.sh v0.2.0-phase1a
set -euo pipefail

LABEL="${1:?用法: bash scripts/backup.sh <标签>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  工作区有未提交改动，先提交再备份：" >&2
  git status --short >&2
  exit 1
fi

mkdir -p backups
TS="$(date +%Y%m%d-%H%M%S)"
BASE="backups/${TS}-${LABEL}"

git archive --format=zip --prefix="cf-b2b-pro-${LABEL}/" -o "${BASE}.zip" HEAD
git bundle create "${BASE}.bundle" --all >/dev/null 2>&1

echo "✅ 备份完成（源码快照 + 完整历史）："
ls -lh "${BASE}.zip" "${BASE}.bundle" | sed 's/^/   /'
echo
echo "   恢复单个文件: unzip -o '${BASE}.zip' 'cf-b2b-pro-${LABEL}/src/xxx.js'"
echo "   克隆到新目录: git clone '${BASE}.bundle' restore-${LABEL}"
