#!/usr/bin/env bash
# AI WIKI 자동 커밋 훅 — Claude Code가 한 번의 답변을 마칠 때(Stop) 바뀐 파일을 커밋하고 깃허브에 올린다.
# 끄기: 저장소 루트에 .no-auto-commit 파일을 만들거나 AIWIKI_AUTO_COMMIT=0
# 커밋만 하고 올리지 않기: AIWIKI_AUTO_PUSH=0
set -u
INPUT="$(cat 2>/dev/null || true)"
# Stop 훅 반복 실행 방지
if printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"; cd "$ROOT" 2>/dev/null || exit 0
[ "${AIWIKI_AUTO_COMMIT:-1}" = "0" ] && exit 0
[ -f .no-auto-commit ] && exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[ -z "$(git status --porcelain)" ] && exit 0
git add -A
# 비밀값이 섞였는지 검사 — 발견되면 커밋하지 않고 알림
if git diff --cached -U0 | grep -E '^\+' | grep -Eiq 'sk-ant-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|"kci_key"[[:space:]]*:[[:space:]]*"[^"]{6,}'; then
  git reset -q
  echo "자동 커밋 중단: 바뀐 내용에 API 키·토큰으로 보이는 값이 있습니다. 파일에서 지운 뒤 다시 시도하세요." >&2
  exit 0
fi
FILES="$(git diff --cached --name-only | head -5 | tr '\n' ' ')"
N="$(git diff --cached --name-only | wc -l | tr -d ' ')"
MSG="auto: Claude Code 작업 반영 $(date '+%Y-%m-%d %H:%M') — ${N}개 파일 (${FILES% })"
git commit -q -m "$MSG" || exit 0
if [ "${AIWIKI_AUTO_PUSH:-1}" != "0" ] && git remote get-url origin >/dev/null 2>&1; then
  BR="$(git rev-parse --abbrev-ref HEAD)"
  if git push -q origin "$BR" 2>/tmp/aiwiki_push_err; then echo "깃허브에 자동 커밋·푸시: $MSG"
  else echo "커밋은 했지만 깃허브에 올리지 못했습니다(로그인·네트워크 확인): $(head -1 /tmp/aiwiki_push_err)" >&2; fi
else echo "자동 커밋(로컬): $MSG"; fi
exit 0
