# AI WIKI — 프로젝트 기반 연구·논문 작성 도구

연구 프로젝트를 만들고 → 자료를 모아 → AI가 관련도를 분류하고 → 토픽을 나눠 방향을 정한 뒤 → 연구자의 관점으로 논문을 쓰고 → 학교·학회지 스타일 서식으로 내보내는 단일 HTML 앱입니다.

## 주요 기능
- **프로젝트 기반**: 글 형태(학위논문·학술지·보고서) → 주제·키워드 → 나의 관점으로 시작, 프로젝트 히스토리 표
- **자료 수집**: KCI 검색(인증키 필요), Obsidian 노트, Google Drive 파일, 엑셀·CSV 목록, 직접 입력 — 들어오는 즉시 관련도 1~5등급·토픽·근거 자동 분석
- **연구자 판단**: 채택·보류·제외, 키워드 사전
- **토픽 분류·방향**: TF-IDF + k-평균 토픽 모델링, 집필 방향 후보, 관점 대조
- **집필**: 장별 작성, `[@문헌ID]` 인용, 근거·인용 검토, AI 원고는 Drive 연구 폴더 `AI원고/`에 자동 저장
- **출력**: DOCX·PDF·Markdown, 학교 HWPX 스타일 서식 채우기(시험), 출력 전 검증
- **작동 방법**: 화면을 비추며 단계별로 안내하는 가이드(자료는 바꾸지 않음)

## Claude Code 자동 커밋 · 설치 도우미
- 이 저장소에서 Claude Code로 앱을 고치면, 답변이 끝날 때마다 바뀐 파일이 **자동으로 커밋·푸시**됩니다(`.claude/settings.json`의 Stop 훅). API 키처럼 보이는 값이 있으면 커밋을 막습니다.
- `install/` 폴더의 설치 도우미가 git, Claude Code, GitHub 로그인, AI WIKI 내려받기를 한 번에 합니다. 자세한 내용: `docs/자동커밋_설치.md`

## 실행
| 방법 | 되는 기능 |
| --- | --- |
| `index.html`을 Chrome으로 열기 | KCI 검색·Drive 로그인을 뺀 모든 기능(Obsidian 볼트 연결 포함) |
| `start-mac.command` / `start-windows.bat` 실행 → `http://localhost:8765` | 전체 기능(KCI 검색, Google Drive API 포함) |
| GitHub Pages | KCI 검색을 뺀 기능. Drive 로그인은 OAuth "승인된 JavaScript 원본"에 Pages 주소 추가 필요 |

Obsidian 볼트 연결(폴더 읽기·쓰기)은 Chrome·Edge에서만 됩니다. Safari는 지원하지 않습니다.

## 배포 앱(Vercel)에서 KCI 검색
- `api/kci.js`(Vercel 서버 함수)가 KCI Open API를 대신 호출합니다. `vercel.json`이 `/api/health`, `/api/kci/*` 주소를 이 함수로 연결합니다.
- Vercel → 프로젝트 Settings → Environment Variables에 `KCI_KEY`(인증키), `GOOGLE_CLIENT_ID`(로그인 클라이언트 ID)를 넣고 Redeploy 합니다. 특정 계정만 쓰게 하려면 `ALLOWED_EMAILS`(쉼표 구분).
- 인증키는 Vercel 서버에만 있고 웹페이지에 나타나지 않습니다. 구글 로그인한 사용자만 호출할 수 있습니다.
- KCI는 등록한 IP에서 온 요청만 받을 수 있습니다. Vercel의 요청 IP는 고정되지 않아 거절될 수 있으며, 이때 화면에 원인이 표시됩니다.

## 데이터와 보안
- 연구 자료는 브라우저(IndexedDB)와, 볼트를 연결하면 Drive 연구 폴더의 `AI-WIKI/AI-WIKI-data.json`에 자동 저장됩니다. 다른 브라우저·컴퓨터에서는 대문의 **구글 드라이브에서 불러오기**로 복원합니다.
- KCI 인증키는 로컬 서버가 `~/.aiwiki/config.json`(본인만 읽기)에만 저장합니다. Claude API 키는 브라우저에만 저장되며 자동 저장 파일에 들어가지 않습니다.
- 이 저장소에는 **하드코딩된 예시 데이터나 개인정보, API 키가 들어 있지 않습니다.** 모든 연구 자료는 사용자가 직접 넣습니다.

## 폴더 구조
```
index.html              앱 본체(HTML·CSS·JS 단일 파일)
aiwiki_server.py        로컬 연동 서버(KCI 프록시, 앱 제공) — Python 3 표준 라이브러리만 사용
start-mac.command       Mac 실행
start-windows.bat       Windows 실행
skills/hwpx-thesis/     학교 HWPX 스타일 서식에 원고를 채우는 Claude 스킬
.claude/                Claude Code 자동 커밋 훅(settings.json, hooks/auto-commit.sh)
install/                설치 도우미(Mac, Windows)
docs/                   연동 설명, 개발 보고
```

## 한계
- KCI·Google Drive API·Claude는 각각 인증키·OAuth 클라이언트 ID·API 키가 있어야 실제로 동작합니다.
- HWPX 출력은 시험 기능입니다. 한글 프로그램에서 열어 확인해야 합니다.
- 원문 PDF 내용 분석은 아직 지원하지 않습니다(제목·초록·키워드 기반).
