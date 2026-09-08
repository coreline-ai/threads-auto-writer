# Codex OAuth Provider Proxy 설정

기준 일시: `2026-09-07 KST`

## 결론

ThreadFlow Gateway의 기본 Provider는 `proxy`다. Proxy가 ChatGPT OAuth 세션, Codex upstream, queue를 소유하고 ThreadFlow에는 OAuth token을 전달하지 않는다. ThreadFlow에 필요한 외부 값은 **loopback Proxy 주소, caller ID, caller secret 파일** 세 가지다.

## 소유 경계

```text
Web / Extension
  → ThreadFlow Gateway (127.0.0.1:8787, Companion session)
  → Codex OAuth Provider Proxy (127.0.0.1:4348, caller credential)
  → Proxy가 소유한 ChatGPT OAuth / Codex
```

- `.threadflow/session-secret`: Gateway가 자동 생성하는 브라우저↔Gateway 연결 키. 앱 설정에 **파일 내용**을 입력한다.
- `THREADFLOW_CODEX_PROXY_SECRET_FILE`: Proxy 운영자가 발급하는 Gateway↔Proxy caller credential 파일. 앱 UI에 입력하지 않는다.
- ChatGPT OAuth Access/Refresh Token: Proxy만 소유한다.

## 필수 환경 변수

```bash
export THREADFLOW_CODEX_PROVIDER=proxy
export THREADFLOW_CODEX_PROXY_BASE_URL=http://127.0.0.1:4348
export THREADFLOW_CODEX_PROXY_CALLER_ID=threadflow
export THREADFLOW_CODEX_PROXY_SECRET_FILE=/absolute/path/to/threadflow-codex-proxy.secret
```

| 값                                   | 조건                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `THREADFLOW_CODEX_PROXY_BASE_URL`    | `http` + `127.0.0.1`, `localhost`, `::1` 중 하나. path/query/fragment/사용자정보 금지 |
| `THREADFLOW_CODEX_PROXY_CALLER_ID`   | 기본 `threadflow`, 소문자·숫자·`-`, 32자 이하. Proxy ACL의 ID와 일치                  |
| `THREADFLOW_CODEX_PROXY_SECRET_FILE` | 절대경로, 일반 파일, 24~512자 secret, group/other 권한 없음(`0600`)                   |

선택 조정값은 `THREADFLOW_CODEX_PROXY_TIMEOUT_MS`(5,000~~300,000ms), `THREADFLOW_CODEX_PROXY_MAX_OUTPUT_CHARS`(256~~64,000)다.

ThreadFlow는 글 품질을 위해 Proxy가 허용하는 `gpt-5.6-sol` + `xhigh` 실행 프로필을 명시한다. 긴 한국어 참고 글은 Proxy의 메시지당 4,000자 계약에 맞춰 최대 31개 payload chunk로 나누며, Proxy 운영값은 다음 이상을 권장한다.

```bash
CODEX_PROXY_REQUEST_MAX_BYTES=524288
CODEX_TEXT_MAX_OUTPUT_CHARS=16000
```

이 값은 ThreadFlow 비밀값이 아니라 **Proxy 프로세스의 입력·출력 상한**이다. Proxy가 기본 32KiB 요청 상한을 유지하면 계약상 허용되는 긴 참고 글이 `BODY_TOO_LARGE`로 거절될 수 있다.

## caller secret 획득

caller secret은 ThreadFlow가 자체 생성해 Proxy에 일방적으로 쓰는 API key가 아니다. **Proxy 운영자가 `threadflow` caller를 ACL에 등록하고 같은 secret을 발급**해야 한다. 발급받은 값을 파일에 저장한 뒤 권한을 제한한다.

```bash
chmod 600 /absolute/path/to/threadflow-codex-proxy.secret
```

secret 값이나 파일 경로는 Git, 문서, 채팅, 브라우저 IndexedDB, ThreadFlow Export에 남기지 않는다.

## Proxy HTTP 계약

### readiness

`GET /ready`는 LLM turn을 소비하지 않아야 하며 `{ "ready": true }`를 반환한다. readiness는 Proxy 프로세스 준비를 뜻하며 OAuth 생성 성공 자체를 보장하지 않는다.

### 구조화 생성

`POST /internal/v1/codex/conversation`은 다음 경계를 지원해야 한다.

- `Authorization: Bearer <caller-secret>`
- `X-Heybot-Service-Id: threadflow`
- `capability: conversation.respond.v1`
- 응답: `{ "requestId": "...", "text": "<JSON string>" }`

ThreadFlow와 Proxy 사이 통신은 loopback으로 제한한다. 401/403은 인증 오류, 429는 일시 제한, 5xx/timeout은 Provider unavailable로 변환하며 upstream 응답 본문을 UI에 노출하지 않는다.

## 실행

Proxy와 환경 변수를 준비한 후:

```bash
pnpm start:web
```

ThreadFlow 설정에서 Companion 연결 키를 저장하고 **Codex 상태 확인**을 누른다. `Proxy readiness 확인됨`이 표시되면 생성 요청을 실행할 수 있다. OAuth 로그인·로그아웃은 ThreadFlow 설정이 아니라 Proxy 운영 절차를 따른다.

## direct 개발 fallback

Proxy가 없는 로컬 개발/회귀 테스트에서만 다음을 사용한다.

```bash
THREADFLOW_CODEX_PROVIDER=direct pnpm start:web
```

이 모드에서는 Node.js 22+, Codex CLI, `codex login` 또는 설정 화면의 ChatGPT 구독 로그인이 필요하다. direct fallback을 운영 기본값으로 자동 전환하지 않는다.

## 검증 경계

- 저장소 자동 테스트는 URL·권한·caller 헤더·capability·timeout·취소·오류 마스킹·DLP를 mock Proxy로 검증한다.
- 실 Proxy의 실행 주소·caller secret·OAuth 세션이 없으면 실제 구독 생성 테스트는 완료로 표시하지 않는다.
- watchdog 같은 외부 운영 프로세스가 생성 중 Proxy를 재시작하면 안전하게 `PROVIDER_UNAVAILABLE`로 실패한다. POST를 자동 재전송하면 중복 turn 위험이 있으므로 ThreadFlow는 자동 재시도하지 않는다. Proxy Manager가 여러 enabled Proxy의 readiness를 집계한다면 Codex 외 서비스의 필수 모델·checksum 누락도 전체 재시작을 일으킬 수 있으므로, Manager `/ready`의 개별 실패 이유를 먼저 복구해야 한다.
