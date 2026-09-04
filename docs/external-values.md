# 외부 값과 로컬 생성 값

## 결론

현재 개인용 Chrome 개발자 모드에서 직접 입력하는 외부 값은 **Chrome Extension ID 하나**다. 다만 AI 생성을 위한 ChatGPT OAuth 로그인과 작성창 전달을 위한 Threads 웹 로그인이 각각 필요하다. LLM API Key, Meta App 값, Apple 인증서는 필요하지 않다. 웹 로그인과 Meta 개발자 OAuth의 차이·획득 절차는 [Threads 웹 로그인·Meta OAuth 설정 가이드](threads-auth-setup.md)를 따른다.

## 1. 현재 개인 개발자 모드

| 값                        | 필요         | 출처                                                              | 비고                                          |
| ------------------------- | ------------ | ----------------------------------------------------------------- | --------------------------------------------- |
| Chrome Extension ID       | 필수         | `chrome://extensions`에서 압축 해제 확장을 로드하면 Chrome이 생성 | `pnpm start:developer -- <id>`에 전달         |
| ChatGPT OAuth 로그인 상태 | 필수         | `codex login`                                                     | API Key가 아니라 사용자 구독 로그인           |
| Threads 웹 로그인 상태    | 전달 시 필수 | 동일한 Chrome 프로필에서 `threads.com` 로그인                     | Meta 개발자 앱 OAuth와는 별개                 |
| Companion 연결 키         | 자동 생성    | `.threadflow/session-secret` 파일의 내용                          | 경로가 아닌 키 문자열을 Extension 설정에 입력 |
| LLM API Key               | 불필요       | 해당 없음                                                         | Codex OAuth Provider Proxy 사용               |
| Meta App ID/Secret        | 불필요       | 해당 없음                                                         | Threads 기본 작성·예약 UI를 사용하므로 불필요 |
| Apple 인증서·서명         | 불필요       | 해당 없음                                                         | 로컬 Node/Terminal 실행에는 불필요            |

실행 명령:

```bash
pnpm start:developer -- <chrome-extension-id>
```

Gateway 실행 후 `cat .threadflow/session-secret`로 확인한 **파일 내용**을 Side Panel에 붙여넣는다. `.threadflow/session-secret`라는 경로 자체를 입력하지 않는다.

Threads 웹에 로그인하지 않은 경우 Extension은 로그인 화면을 열고 초안을 클립보드에 보존하지만 작성창 입력 성공으로 표시하지 않는다. 로그인 후 직접 붙여넣거나 다시 전달해야 한다.

## 2. Phase 8 공식 Threads API 자동 게시를 켤 때만 필요한 값

| 환경 변수                    | 분류           | 생성·획득 위치                                                                      |
| ---------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `META_APP_ID`                | 외부 필수      | Meta 개발자 앱                                                                      |
| `META_APP_SECRET`            | 외부 필수·비밀 | Meta 개발자 앱                                                                      |
| `META_REDIRECT_URI`          | 설정 필수      | 직접 준비한 non-local HTTPS callback을 Meta 앱에 등록하고 서버 값과 정확히 일치시킴 |
| `SCHEDULER_MASTER_KEY`       | 로컬 생성 비밀 | 32-byte random key를 Base64로 생성                                                  |
| `SCHEDULER_ACCESS_KEYS_JSON` | 로컬 생성 비밀 | 임의의 긴 접근 키와 Tenant/Workspace/User 매핑                                      |

다음 값은 기본값이 있어 일반적으로 입력하지 않는다.

- `SCHEDULER_HOST`, `SCHEDULER_PORT`, `SCHEDULER_DB_PATH`
- `META_GRAPH_VERSION`
- `META_USE_PKCE`

로컬 비밀 생성 예시:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

첫 번째 결과는 `SCHEDULER_MASTER_KEY`, 두 번째 결과는 `SCHEDULER_ACCESS_KEYS_JSON`의 접근 키로 사용할 수 있다. 실제 비밀은 Git이나 문서에 기록하지 않는다.

중요: Meta 공식 sample 기준으로 Threads OAuth는 `localhost` redirect를 지원하지 않고 HTTPS를 요구한다. 공개 HTTPS 터널/Reverse Proxy 또는 사용자 지정 로컬 호스트+신뢰 인증서를 사용해야 하며 `http://127.0.0.1:8788/...`는 실제 OAuth callback으로 사용할 수 없다.

## 3. Apple 서명이 필요한 경우

Apple Developer ID 서명과 공증은 ThreadFlow OS를 `.app`, `.pkg` 같은 일반 사용자용 macOS 설치물로 외부 배포할 때 Gatekeeper 신뢰 경고를 줄이기 위한 절차다.

현재 제공 방식은 사용자가 자신의 Mac에서 Node.js와 Terminal로 Companion을 직접 실행하는 개발자 모드이므로 Apple 인증서, 서명, 공증이 필요하지 않다.
