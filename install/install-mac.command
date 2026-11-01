#!/bin/bash
# AI WIKI 설치 도우미 (Mac) — git, Claude Code, GitHub 로그인, AI WIKI 내려받기, 자동 커밋까지 한 번에
# 미리 보기: ./install-mac.command --dry-run
REPO_URL="${AIWIKI_REPO:-https://github.com/계정이름/ai-wiki.git}"
TARGET="$HOME/Desktop/ai-wiki"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1
run(){ echo "▶ $*"; [ $DRY -eq 1 ] || eval "$@"; }
say(){ echo; echo "=== $* ==="; }
say "1/5 git 확인"
if command -v git >/dev/null 2>&1; then echo "git 있음: $(git --version)"; else
  echo "git이 없어 Apple 개발자 도구 설치 창을 엽니다. 설치를 마친 뒤 이 파일을 다시 실행하세요."; run "xcode-select --install"; exit 0; fi
say "2/5 Claude Code 확인"
if command -v claude >/dev/null 2>&1; then echo "Claude Code 있음: $(claude --version 2>/dev/null)"; else
  run "curl -fsSL https://claude.ai/install.sh | bash"; export PATH="$HOME/.local/bin:$PATH"; fi
say "3/5 깃허브 로그인(GitHub CLI)"
if command -v gh >/dev/null 2>&1; then gh auth status >/dev/null 2>&1 && echo "깃허브 로그인 되어 있음" || run "gh auth login --web --git-protocol https"
elif command -v brew >/dev/null 2>&1; then run "brew install gh"; run "gh auth login --web --git-protocol https"
else echo "GitHub CLI가 없어 건너뜁니다. 처음 push할 때 깃허브 아이디와 토큰을 물어보면 입력하세요(또는 GitHub Desktop 사용)."; fi
say "4/5 AI WIKI 내려받기"
if [ -d "$TARGET/.git" ]; then run "git -C \"$TARGET\" pull --ff-only"; else
  case "$REPO_URL" in *계정이름*) read -p "AI WIKI 저장소 주소(https://github.com/…/ai-wiki.git): " REPO_URL;; esac
  [ -z "$REPO_URL" ] && { echo "저장소 주소가 없어 중단합니다. 다시 실행해 주소를 입력하세요."; exit 1; }
  run "git clone \"$REPO_URL\" \"$TARGET\""; fi
say "5/5 자동 커밋 준비·실행"
run "chmod +x \"$TARGET/.claude/hooks/auto-commit.sh\" \"$TARGET/start-mac.command\""
echo "자동 커밋: $TARGET 에서 Claude Code를 쓰면 답변이 끝날 때마다 바뀐 파일이 깃허브에 커밋·푸시됩니다."
echo "끄려면: touch \"$TARGET/.no-auto-commit\""
read -p "지금 AI WIKI를 열까요? (y/n) " A
if [ "$A" = "y" ]; then run "open \"$TARGET/start-mac.command\""; fi
echo; echo "Claude Code로 앱을 고치려면: cd \"$TARGET\" && claude"
