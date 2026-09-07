# 웹 우선 실행 구조와 Chrome Extension 전환 제안

기준 일시: `2026-09-06 KST`

## 결론

ThreadFlow OS는 **localhost 자체 웹앱을 기본 진입점**으로 사용하고, Chrome Extension은 브라우저 문맥이 필요한 기능만 추가하는 구조가 가장 적합하다. 글 생성 품질, 편집, 검수, 승인, 보관은 두 환경에서 동일한 공통 UI를 사용한다. 따라서 먼저 웹에서 제품을 검증한 뒤 UI를 다시 만들지 않고 Extension을 설치할 수 있다.

## 실행 구조

| 구성              | 패키지명                       | 역할                                                    |
| ----------------- | ------------------------------ | ------------------------------------------------------- |
| 자체 웹           | `@threadflow-os/web`           | 설치 전 사용자 1회 실행·편집·승인·보관·클립보드 전달    |
| 공통 UI           | `@threadflow-os/client-ui`     | React App, Dexie 저장소, Workflow Store, Gateway Client |
| Chrome Extension  | `@threadflow-os/extension`     | 현재 게시물 캡처, 로그인된 Threads 작성창 자동 입력     |
| 로컬 Gateway      | `@threadflow-os/codex-gateway` | Proxy caller, 요청 멱등성, 출력 DLP, 생성 SSE           |
| Codex OAuth Proxy | 별도 loopback 프로세스         | ChatGPT OAuth, Codex upstream, queue 소유               |

공통 UI는 `ClientRuntime`만 주입받는다. 웹 Runtime은 브라우저 탭 간 DOM 접근을 시도하지 않고, 승인된 글을 클립보드에 복사한 뒤 Threads를 연다. Extension Runtime은 Chrome 권한과 content script를 사용해 현재 게시물을 읽고 작성창에 초안을 입력한다.

## 기능 경계

| 기능                                           | 자체 웹                | Chrome Extension |
| ---------------------------------------------- | ---------------------- | ---------------- |
| ChatGPT 구독 기반 Codex 생성                   | 지원                   | 지원             |
| 사용자 1회 실행·내부 다중 turn 품질 파이프라인 | 지원                   | 지원             |
| 직접 입력·참고 URL·Persona·근거                | 지원                   | 지원             |
| 자동 저장·복구·Draft 버전·캘린더               | 지원                   | 지원             |
| 클립보드 복사 후 Threads 열기                  | 지원                   | 지원             |
| 현재 Threads 게시물 자동 캡처                  | 브라우저 보안상 미지원 | 지원             |
| 로그인된 Threads 작성창 자동 입력              | 브라우저 보안상 미지원 | 지원             |
| 게시·예약 확정 버튼 자동 클릭                  | 미지원                 | 미지원           |

## 권장 사용 순서

1. `pnpm install`을 한 번 실행한다.
2. Proxy 운영자가 발급한 caller ID/secret을 설정하고 loopback Codex OAuth Proxy를 실행한다.
3. `pnpm start:web`으로 웹과 Gateway를 동시에 실행한다.
4. `http://127.0.0.1:4173`의 **설정**에서 `.threadflow/session-secret` 파일 내용을 입력하고 Proxy readiness를 확인한다.
5. 웹에서 사용자 1회 실행 작성 품질과 보관 흐름을 먼저 사용한다.
6. 현재 Threads 글 캡처와 작성창 자동 입력이 필요해지면 Extension production build를 설치한다.

## Extension 설치 전환

```bash
pnpm build
```

1. Chrome에서 `chrome://extensions`를 연다.
2. 개발자 모드를 켠다.
3. **압축해제된 확장 프로그램을 로드합니다**에서 `apps/extension/.output/chrome-mv3`를 선택한다.
4. 표시된 32자 Extension ID를 확인한다.
5. 웹 실행을 종료하고 `pnpm start:developer -- <extension-id>`를 실행한다.
6. 동일한 Companion 연결 키를 Extension 설정에 입력한다.

Extension은 웹 버전을 대체하는 별도 제품이 아니라 브라우저 자동화 기능을 더하는 두 번째 실행 Surface다. 공개 배포가 필요해지기 전에는 Chrome Web Store 등록이 필요하지 않다.

## 보안 원칙

- 웹과 Gateway는 `127.0.0.1`에만 바인딩한다.
- Gateway CORS는 `THREADFLOW_WEB_ORIGINS` 또는 `THREADFLOW_EXTENSION_ORIGINS`에 명시된 exact origin만 허용한다.
- 웹 Origin은 `localhost`, `127.0.0.1`, `::1`만 허용하며 외부 도메인·경로·쿼리는 시작 시 거부한다.
- OAuth Access/Refresh Token은 웹·Extension·IndexedDB·Export에 저장하지 않는다.
- Proxy caller secret은 Gateway가 절대경로 `0600` 파일에서만 읽고 응답·로그·승인 snapshot에 남기지 않는다.
- 생성 요청은 client/server 동일 SHA-256 지문과 멱등성 키로 중복 실행을 막는다.
- Provider raw delta와 구조화 출력은 token·JWT·개인 경로 DLP를 통과한 후에만 클라이언트에 emit한다.
- 승인된 현재 편집본만 Threads 전달 버튼을 활성화한다.
- 전달 직전 본문·소스·요청·위험·이미지 해시가 승인 snapshot과 일치해야 한다.
- 실제 게시·예약 확정은 Threads 화면에서 사용자가 직접 수행한다.

## 다음 제안

현재 단계에서는 웹과 Extension의 기능 일관성 및 실제 작성 품질 검증에 집중한다. Firefox/Safari 포팅, 공개 클라우드 배포, Meta API 자동 게시 UI는 현재 필수 흐름을 안정화한 뒤 별도 Phase로 판단한다.
