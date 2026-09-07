# 외부 값과 로컬 생성 값

## 결론

기본 `proxy` 모드에서는 LLM API Key는 필요 없지만 **Codex OAuth Provider Proxy 운영자가 발급한 caller ID/secret과 loopback Proxy 실행 주소**가 필요하다. ChatGPT OAuth 로그인은 ThreadFlow가 아니라 Proxy가 소유한다. `.threadflow/session-secret`은 ThreadFlow가 자동 생성하는 별도의 브라우저↔Gateway 연결 키다. Chrome Extension에는 Extension ID와 Threads 웹 로그인이 추가로 필요하다. Meta App 값과 Apple 인증서는 수동 작성창 전달에 필요하지 않다.

## 1. 자체 웹 모드

| 값                     | 필요         | 출처                                     | 비고                                        |
| ---------------------- | ------------ | ---------------------------------------- | ------------------------------------------- |
| Proxy loopback URL     | 필수         | Proxy 운영 환경                          | 기본 `http://127.0.0.1:4348`                |
| Proxy caller ID/secret | 필수·비밀    | Proxy 운영자가 발급                      | secret은 절대경로 `0600` 파일, UI 입력 금지 |
| ChatGPT OAuth 세션     | Proxy에 필수 | Proxy 운영 절차                          | ThreadFlow에 token을 복사하지 않음          |
| Companion 연결 키      | 자동 생성    | `.threadflow/session-secret` 파일의 내용 | 경로가 아닌 키 문자열을 웹 설정에 입력      |
| LLM API Key            | 불필요       | 해당 없음                                | Codex OAuth Provider Proxy 사용             |
| Meta App ID/Secret     | 불필요       | 해당 없음                                | Threads 자동 게시 API를 사용하지 않음       |
| Threads 웹 로그인      | 전달 시 선택 | `threads.com`                            | 웹은 Threads를 열고 사용자가 직접 붙여넣음  |
| Apple 인증서·서명      | 불필요       | 해당 없음                                | 로컬 Node/Terminal 실행에는 불필요          |

실행 명령:

```bash
export THREADFLOW_CODEX_PROVIDER=proxy
export THREADFLOW_CODEX_PROXY_BASE_URL=http://127.0.0.1:4348
export THREADFLOW_CODEX_PROXY_CALLER_ID=threadflow
export THREADFLOW_CODEX_PROXY_SECRET_FILE=/absolute/path/to/threadflow-codex-proxy.secret
pnpm start:web
```

Gateway 실행 후 `cat .threadflow/session-secret`로 확인한 **파일 내용**을 웹 설정에 붙여넣는다. Proxy secret 파일 경로나 그 내용을 UI에 입력하지 않는다. 획득·계약은 [Codex OAuth Proxy 설정](codex-oauth-proxy-setup.md)을 따른다.

Proxy 운영자는 긴 한국어 입력을 위해 `CODEX_PROXY_REQUEST_MAX_BYTES=524288`, `CODEX_TEXT_MAX_OUTPUT_CHARS=16000`을 권장값으로 설정한다. 또한 관련 없는 장치 상태를 감시하는 watchdog이 생성 중 Codex Proxy를 재시작하지 않도록 운영 범위를 분리해야 한다. 이 두 값은 API Key가 아닌 Proxy 런타임 한도다.

## 2. Chrome Extension 개발자 모드

| 값                     | 필요         | 출처                                                              | 비고                                          |
| ---------------------- | ------------ | ----------------------------------------------------------------- | --------------------------------------------- |
| Chrome Extension ID    | 필수         | `chrome://extensions`에서 압축 해제 확장을 로드하면 Chrome이 생성 | `pnpm start:developer -- <id>`에 전달         |
| Codex OAuth Proxy      | 필수         | 자체 웹과 동일한 Proxy 설정                                       | OAuth은 Proxy가 관리                          |
| Threads 웹 로그인 상태 | 전달 시 필수 | 동일한 Chrome 프로필에서 `threads.com` 로그인                     | Meta 개발자 앱 OAuth와는 별개                 |
| Companion 연결 키      | 자동 생성    | `.threadflow/session-secret` 파일의 내용                          | 경로가 아닌 키 문자열을 Extension 설정에 입력 |
| LLM API Key            | 불필요       | 해당 없음                                                         | Codex OAuth Provider Proxy 사용               |
| Meta App ID/Secret     | 불필요       | 해당 없음                                                         | Threads 기본 작성·예약 UI를 사용하므로 불필요 |
| Apple 인증서·서명      | 불필요       | 해당 없음                                                         | 로컬 Node/Terminal 실행에는 불필요            |

Extension 실행 명령:

```bash
export THREADFLOW_CODEX_PROVIDER=proxy
export THREADFLOW_CODEX_PROXY_BASE_URL=http://127.0.0.1:4348
export THREADFLOW_CODEX_PROXY_CALLER_ID=threadflow
export THREADFLOW_CODEX_PROXY_SECRET_FILE=/absolute/path/to/threadflow-codex-proxy.secret
pnpm start:developer -- <chrome-extension-id>
```

Gateway 실행 후 `cat .threadflow/session-secret`로 확인한 **파일 내용**을 Side Panel에 붙여넣는다. `.threadflow/session-secret`라는 경로 자체를 입력하지 않는다.

Threads 웹에 로그인하지 않은 경우 Extension은 로그인 화면을 열고 초안을 클립보드에 보존하지만 작성창 입력 성공으로 표시하지 않는다. 로그인 후 직접 붙여넣거나 다시 전달해야 한다.

## 3. Phase 8 공식 Threads API 자동 게시를 켤 때만 필요한 값

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

## 4. Apple 서명이 필요한 경우

Apple Developer ID 서명과 공증은 ThreadFlow OS를 `.app`, `.pkg` 같은 일반 사용자용 macOS 설치물로 외부 배포할 때 Gatekeeper 신뢰 경고를 줄이기 위한 절차다.

현재 제공 방식은 사용자가 자신의 Mac에서 Node.js와 Terminal로 Companion을 직접 실행하는 개발자 모드이므로 Apple 인증서, 서명, 공증이 필요하지 않다.
