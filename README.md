# AI WIKI 논문 집필

연구 프로젝트를 만들고 → 자료를 모아 → AI가 관련도와 토픽을 분류하고 → 저자의 관점과 분량에 맞춰 논문을 쓰고 → 학교·학회지 양식(한글·워드·PDF)으로 내보내는 웹앱입니다.

- 배포 주소: https://ai-wiki-two.vercel.app
- 관리자: 장용철 · 문의 long98@hufs.ac.kr

## 파일 구성
| 파일 | 역할 |
| --- | --- |
| `index.html` | 앱 본체(화면·기능 전체가 이 파일 하나에 들어 있음) |
| `config.json` | 구글 로그인 클라이언트 ID |
| `privacy.html` | 개인정보처리방침(구글 로그인 심사용) |
| `vercel.json` | `/api/kci/*` 주소를 KCI 서버 함수로 연결 |
| `api/kci.js` | KCI 논문 검색을 대신 호출하는 Vercel 서버 함수 |

## 수정·배포 방법
1. 바뀐 `index.html`을 GitHub 저장소의 **Add file → Upload files**로 올리고 **Commit changes**를 누릅니다.
2. Vercel이 1~2분 안에 자동으로 다시 배포합니다. 브라우저에서 **Cmd + Shift + R**(Windows는 Ctrl + Shift + R)로 새로 고칩니다.
3. `config.json`, `privacy.html`은 덮어쓰지 않습니다.

## 서버 설정(Vercel → Settings → Environment Variables)
- `KCI_KEY`: KCI Open API 인증키
- `GOOGLE_CLIENT_ID`: 구글 로그인 클라이언트 ID
- `ALLOWED_EMAILS`(선택): 사용을 허용할 구글 계정(쉼표로 구분)

## 데이터와 보안
- 연구 자료는 사용자의 브라우저와 사용자가 연결한 구글 드라이브에만 저장됩니다.
- KCI 인증키는 Vercel 서버에만 있고, Claude API 키는 사용자 브라우저에만 저장됩니다. 이 저장소에는 API 키, 개인정보, 하드코딩된 예시 데이터가 들어 있지 않습니다.
