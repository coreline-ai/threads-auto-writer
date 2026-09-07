# ThreadFlow OS

Codex App Server의 ChatGPT OAuth 구독 인증을 사용하는 품질 중심 Threads 글쓰기 앱입니다. **localhost 자체 웹으로 먼저 실행**하고, 현재 게시물 캡처와 작성창 자동 입력이 필요할 때 같은 UI의 Chrome Extension을 설치할 수 있습니다.

기본 작성 화면은 **1턴 모드**입니다. 주제·메모·참고 글을 한 번 입력하고 **1턴으로 완성하기**를 누르면 `분석 → 다중 후보 작성 → 편집장 평가 → 개선 → 위험 검수 → 최종 후보 선택`을 한 요청 안에서 완료합니다. 후보 비교와 Persona·근거 같은 세부 설정은 필요할 때만 펼칠 수 있으며, 실제 게시 전 사용자 승인은 안전 경계로 유지합니다.

Phase 0~9 저장소 구현 상태와 외부 출시 Gate는 [`docs/implementation-status.md`](docs/implementation-status.md), 최신 잔여 작업은 [`docs/remaining-work.md`](docs/remaining-work.md)에서 확인할 수 있습니다.

최신 **에디토리얼 스튜디오**는 184px 탐색 영역과 작성 요청·편집 결과의 2열 웹 작업공간을 사용합니다. 모바일·Extension은 한 열을 유지합니다. [디자인 명세](docs/editorial-studio-design.md)와 [적용 개발 계획](dev-plan/implement_20260906_214210.md)을 참고하세요.

**다크/라이트/시스템 테마, AI 수정안 비교·적용, 고정 작업 바, 여러 임시 초안, 보관함 검색·필터를 구현했습니다.** 기존 작업은 DB v4로 이관하며 저장 충돌 시 덮어쓰지 않습니다. [구현 검토·검증 결과](docs/convenience-theme-review.md)와 [개발 계획](dev-plan/implement_20260906_225905.md)을 참고하세요.

작성 화면의 최신 측정값과 과거 Side Panel 시안 비교는 [`docs/gui-layout-audit.md`](docs/gui-layout-audit.md)에 정리되어 있습니다.

현재 필수 기능의 정확성·사용성 재검토 결과는 [`docs/correctness-usability-audit.md`](docs/correctness-usability-audit.md)에 정리되어 있습니다.

웹 우선 구조와 Extension 전환 기준은 [`docs/web-first-architecture.md`](docs/web-first-architecture.md)를 참고하세요.

## 구성

| 경로                       | 역할                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `apps/web`                 | localhost 자체 웹, 1턴 생성·편집·승인·보관·클립보드 전달            |
| `packages/client-ui`       | 웹·Extension 공통 React UI, Workflow Store, Dexie, Gateway Client   |
| `apps/extension`           | WXT MV3 Side Panel, 현재 게시물 캡처, Threads 작성창 자동 입력      |
| `apps/codex-gateway`       | loopback 전용 Codex App Server Gateway, OAuth 상태, SSE 생성 작업   |
| `apps/scheduler-server`    | 승인 Draft의 공식 Threads API 예약 발행, Insights, 다중 Tenant 격리 |
| `packages/contracts`       | Extension·Gateway·Scheduler 공통 Zod 계약                           |
| `packages/prompt-kit`      | 버전형 Prompt·JSON Schema                                           |
| `packages/quality-engine`  | 다단계 생성과 결정적 위험 검사                                      |
| `packages/codex-provider`  | Codex App Server JSONL Adapter                                      |
| `packages/threads-adapter` | Threads DOM 추출·작성창 전달 Adapter                                |
| `packages/database`        | SQLite Migration, Lease, Idempotency, Tenant 경계                   |
| `packages/threads-client`  | 공식 Threads OAuth·게시·Insights API Client                         |

## 가장 빠른 실행: 자체 웹

```bash
pnpm install
pnpm start:web
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다. 웹과 Gateway가 함께 실행되며 Gateway는 `127.0.0.1:8787`에만 바인딩됩니다.

1. `cat .threadflow/session-secret`로 파일 **내용**을 확인합니다.
2. 웹 앱의 **설정 → Companion 연결 키**에 붙여넣습니다. 파일 경로를 입력하면 안 됩니다.
3. **ChatGPT 구독으로 로그인**을 눌러 Codex OAuth를 완료합니다.
4. 작성 화면에 주제·메모·참고 글을 입력하고 **1턴으로 완성하기**를 실행합니다.

OAuth Access/Refresh Token은 Codex App Server가 소유하며 웹, Extension, IndexedDB, Export, 애플리케이션 로그에 저장하지 않습니다.

## Chrome Extension 설치

현재 Threads 게시물을 자동 캡처하거나 로그인된 작성창에 초안을 자동 입력하려면 다음 단계로 확장합니다.

```bash
pnpm build
```

Chrome `chrome://extensions`에서 개발자 모드를 켜고 `apps/extension/.output/chrome-mv3`를 압축 해제 확장으로 로드합니다. 표시된 Extension ID로 Gateway를 시작합니다.

```bash
pnpm start:developer -- <chrome-extension-id>
```

동일한 `.threadflow/session-secret` 파일 내용을 Side Panel 설정에 입력합니다. 웹 작성 데이터와 Extension 작성 데이터는 브라우저 Origin별 IndexedDB에 저장되므로 자동으로 합쳐지지는 않습니다.

개인 웹/Extension 개발자 모드에는 LLM API Key·Meta App 값·Apple 서명이 필요하지 않습니다. AI 생성에는 ChatGPT OAuth가 필요하고, Extension의 작성창 자동 입력에는 같은 Chrome 프로필의 Threads 웹 로그인이 필요합니다. 인증 차이는 [`docs/threads-auth-setup.md`](docs/threads-auth-setup.md), 전체 값 구분은 [`docs/external-values.md`](docs/external-values.md)를 참고하세요.

## 개발 검증

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## 품질 회귀

```bash
pnpm eval
```

Golden Set 자동 검사는 결정적 위험 탐지의 누락을 막는 용도입니다. 글 품질의 최종 판단은 `evals/rubrics/human-evaluation.md` 사람 평가와 함께 수행합니다.

## 게시 안전 경계

- 웹은 초안을 클립보드에 보존하고 Threads를 엽니다.
- Extension은 로그인 상태와 작성창 DOM을 확인한 경우에만 초안을 입력합니다.
- 웹과 Extension 모두 게시·예약 확정 버튼을 클릭하지 않습니다.
- 서버 자동 예약은 `APPROVED` Draft만 받고 Idempotency·Lease·Workspace 범위 Pause를 적용합니다.
- 게시 응답 유실처럼 성공 여부가 불명확한 경우 자동 재시도하지 않고 Dead Letter로 격리합니다.

## 외부 검증이 필요한 기능

- Chrome Web Store 제출·심사
- Meta App 생성, 권한 검수, 실계정 OAuth·게시·Insights Smoke Test
- macOS 서명·공증

이 항목은 코드·Mock 통합 테스트와 분리되며 실제 계정 및 배포 자격 증명 없이는 완료로 표시하지 않습니다.
