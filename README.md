# ThreadFlow OS

Codex App Server의 ChatGPT OAuth 구독 인증을 사용하는 품질 중심 Threads 글쓰기 Companion입니다.

Phase 0~9 저장소 구현 상태와 외부 출시 Gate는 [`docs/implementation-status.md`](docs/implementation-status.md), 최신 잔여 작업은 [`docs/remaining-work.md`](docs/remaining-work.md)에서 확인할 수 있습니다.

작성 화면 시안과 실제 Side Panel 코드의 레이아웃 비교는 [`docs/gui-layout-audit.md`](docs/gui-layout-audit.md)에 정리되어 있습니다.

현재 필수 기능의 정확성·사용성 재검토 결과는 [`docs/correctness-usability-audit.md`](docs/correctness-usability-audit.md)에 정리되어 있습니다.

## 구성

| 경로                       | 역할                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `apps/extension`           | WXT Manifest V3 Side Panel, 명시적 게시물 캡처, 편집·승인·Threads 전달 |
| `apps/codex-gateway`       | loopback 전용 Codex App Server Gateway, OAuth 상태, SSE 생성 작업      |
| `apps/scheduler-server`    | 승인 Draft의 공식 Threads API 예약 발행, Insights, 다중 Tenant 격리    |
| `packages/contracts`       | Extension·Gateway·Scheduler 공통 Zod 계약                              |
| `packages/prompt-kit`      | 버전형 Prompt·JSON Schema                                              |
| `packages/quality-engine`  | 다단계 생성과 결정적 위험 검사                                         |
| `packages/codex-provider`  | Codex App Server JSONL Adapter                                         |
| `packages/threads-adapter` | Threads DOM 추출·작성창 전달 Adapter                                   |
| `packages/database`        | SQLite Migration, Lease, Idempotency, Tenant 경계                      |
| `packages/threads-client`  | 공식 Threads OAuth·게시·Insights API Client                            |

## 개발 실행

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Gateway는 외부 네트워크가 아니라 `127.0.0.1`에만 바인딩되며 설치된 Extension Origin을 명시해야 합니다.

```bash
cp .env.example .env
export THREADFLOW_EXTENSION_ORIGINS="chrome-extension://<설치된-extension-id>"
pnpm dev:gateway
```

`cat .threadflow/session-secret`로 확인한 파일 **내용**을 Extension 설정에 한 번 입력하면 짧은 수명의 세션으로 교환됩니다. 파일 경로를 입력하면 안 됩니다. OAuth Access/Refresh Token은 Codex App Server가 소유하며 Extension, IndexedDB, Export, 애플리케이션 로그에 저장하지 않습니다.

개인 개발자 모드에는 LLM API Key·Meta App 값·Apple 서명이 필요하지 않습니다. 단, ChatGPT OAuth와 동일 Chrome 프로필의 Threads 웹 로그인은 필요합니다. 웹 작성창 전달과 공식 API 자동 게시의 인증 차이는 [`docs/threads-auth-setup.md`](docs/threads-auth-setup.md), 전체 값 구분은 [`docs/external-values.md`](docs/external-values.md)를 참고하세요.

## 품질 회귀

```bash
pnpm eval
```

Golden Set 자동 검사는 결정적 위험 탐지의 누락을 막는 용도입니다. 글 품질의 최종 판단은 `evals/rubrics/human-evaluation.md` 사람 평가와 함께 수행합니다.

## 게시 안전 경계

- MVP는 초안을 클립보드에 보존하고 Threads 작성 화면까지만 엽니다.
- Extension은 게시·예약 확정 버튼을 클릭하지 않습니다.
- 서버 자동 예약은 `APPROVED` Draft만 받고 Idempotency·Lease·Workspace 범위 Pause를 적용합니다.
- 게시 응답 유실처럼 성공 여부가 불명확한 경우 자동 재시도하지 않고 Dead Letter로 격리합니다.

## 외부 검증이 필요한 기능

- Chrome Web Store 제출·심사
- Meta App 생성, 권한 검수, 실계정 OAuth·게시·Insights Smoke Test
- macOS 서명·공증

이 항목은 코드·Mock 통합 테스트와 분리되며 실제 계정 및 배포 자격 증명 없이는 완료로 표시하지 않습니다.
