# ThreadFlow OS 기술 Spike 결과

검증 일시: `2026-09-04 KST`  
대상 패키지: `threadflow-os` / 내부 scope `@threadflow-os/*`

## 결론

Phase 0의 핵심 불확실성인 Codex App Server 구조화 생성, 로컬 Gateway 보안, Threads 단일 게시물 추출, 작성 화면 전달 방식은 구현 가능한 것으로 확인했다. 기본 연결은 `HTTP + SSE`, 게시 전달은 `클립보드 보존 + 사용자가 요청한 경우에만 작성창 DOM 입력`, 최종 게시·예약 확정은 사용자가 수행한다.

## Codex App Server 실검증

| 항목        | 결과                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Node        | `v24.13.1`                                                                                        |
| pnpm        | `11.13.1`                                                                                         |
| Codex       | `0.145.0`                                                                                         |
| 인증        | ChatGPT OAuth, `pro` 구독 상태 확인                                                               |
| 전송        | `codex app-server --listen stdio://` JSONL                                                        |
| 초기화      | `initialize` 성공                                                                                 |
| 계정        | `account/read` 성공, Token 값은 읽거나 기록하지 않음                                              |
| 사용 상태   | `account/rateLimits/read` 성공                                                                    |
| 구조화 출력 | `turn/start.outputSchema` 한국어 JSON 성공                                                        |
| 스트리밍    | `item/agentMessage/delta` 수신 성공                                                               |
| Thread      | 새 ephemeral Thread 생성, `read-only`, `approvalPolicy=never`, environments/dynamicTools 비활성화 |

최소 Spike는 `/scripts/codex-app-server-spike.mjs`로 재현할 수 있다. 실제 실행에서 구조화 결과 1건, 7개 Delta, `turn/completed`를 확인했다.

전체 품질 파이프라인 Live Smoke는 `/scripts/live-quality-smoke.mjs`로 실행했다.

- 첫 모델 Delta: `9,440ms`
- 전체 소요: `37,303ms`
- 단계: `ANALYZING → STRATEGIZING → GENERATING → CRITIQUING → REFINING → CHECKING → COMPLETED`
- 후보: `3개`
- 후보 총점: `68 / 71 / 67`
- 최종 글: `180자`, 위험 플래그 없음, `DRAFT`
- Prompt/Rubric: `2.0.0 / 1.0.0`
- 원문·생성문·OAuth Token은 Smoke 리포트에 기록하지 않았다.

## 성능 Smoke

로컬 개발 환경에서 성능 예산을 구성요소별로 분리해 측정했다. 아래 값은 공개 SLA가 아니라 회귀 탐지 기준이다.

| 구간                            |     측정값 |        예산 | 결과 |
| ------------------------------- | ---------: | ----------: | ---- |
| Threads 단일 게시물 Capture p95 |  `0.039ms` |      `25ms` | 통과 |
| 실제 Codex 첫 모델 Delta        |  `9,440ms` |  `30,000ms` | 통과 |
| 실제 5단계 전체 생성            | `37,303ms` | `180,000ms` | 통과 |
| IndexedDB 편집 Draft 복원       |  `0.579ms` |     `250ms` | 통과 |

재현 명령은 `pnpm smoke:quality`와 `pnpm smoke:performance`이며 결과는 `artifacts/smoke/live-quality-smoke.json`, `artifacts/smoke/performance-smoke.json`에 저장한다.

## 인증 흐름 결정

- 개인용 Companion은 Codex App Server가 소유한 ChatGPT OAuth를 사용한다.
- Extension은 `account/read`로 정규화된 상태만 받고 Access/Refresh Token을 받지 않는다.
- 로그인은 `account/login/start {type:"chatgpt"}`를 기본으로 하고, Device Code는 대체 경로로 남겼다.
- 로그인 취소·로그아웃은 Gateway API와 Mock 계약 테스트로 검증했다.
- 실로그아웃은 현재 사용자의 전역 Codex 세션을 끊기 때문에 자동 Smoke에서 실행하지 않는다.
- SaaS 확장 시 `TenantCodexProviderRegistry`가 사용자마다 별도 `CODEX_HOME`을 사용하며 운영자 세션 공유 경로를 만들지 않는다.

## Extension → Gateway

| 후보         | 평가                                               | 결정             |
| ------------ | -------------------------------------------------- | ---------------- |
| HTTP polling | 단순하지만 단계 표시 지연                          | 상태 조회·복구용 |
| WebSocket    | 양방향에는 유리하지만 생성 이벤트만으로는 과함     | 제외             |
| HTTP + SSE   | 생성 요청·취소는 HTTP, 진행 이벤트는 단방향 스트림 | **기본안**       |

보안 Control은 다음과 같다.

- `127.0.0.1` 또는 `::1`에만 bind
- 정확한 `chrome-extension://<id>` Origin Allowlist
- Host 헤더 검증으로 DNS Rebinding 차단
- 설치별 bootstrap secret과 15분 세션 Token
- 256KB 요청 제한
- Fastify 요청 로그 비활성화와 metadata allowlist
- 악성 Origin, Host, 누락 세션, 대형 Payload 자동 테스트

## Threads GUI·DOM

- 원본 영상에서 우측 생성 패널, 참고 자료 선택, 후보 생성, 링크·이미지 처리, Threads 기본 작성창과 날짜·시간 예약 UI를 직접 확인했다.
- `Semantic Adapter`는 사용자가 우클릭한 요소에서 가장 가까운 `article` 한 건만 추출한다.
- 작성자·본문·정규화 URL이 없으면 안전하게 `null` 또는 직접 붙여넣기 fallback을 사용한다.
- 작성 전달은 동일한 Chrome 프로필에서 Threads 웹 로그인이 완료된 경우에만 동작한다. Meta App ID/Secret 없이 브라우저의 기존 Threads 로그인 세션을 사용한다.
- 작성 전달은 다음 순서로 구현했다.
  1. 최종안을 클립보드에 먼저 보존
  2. Threads 기본 화면 열기
  3. 사용자가 명시적으로 전달을 눌렀을 때만 contenteditable/textarea 입력 시도
  4. 실패하면 클립보드 붙여넣기 안내
- 로그아웃 페이지 또는 작성창 부재는 성공으로 처리하지 않고 `login-required` 또는 `composer-not-found`로 Side Panel에 반환한다.
- 게시·예약 확정 버튼을 찾거나 클릭하는 코드는 구현하지 않았다.
- 최신 Side Panel Production build를 실제 Chromium 화면에서 다시 열어 참고 URL, Persona, 변형 강도 필드와 520px 패널 레이아웃을 시각 검수했다. 텍스트 겹침이나 가로 오버플로는 발견되지 않았다.

## 공식 Threads API 확인

Meta 공식 문서 기준으로 Text/Image 게시가 `POST /{threads-user-id}/threads` 컨테이너 생성과 `POST /{threads-user-id}/threads_publish` 게시의 2단계임을 확인했다. Text 한도는 500단위이며 Emoji는 UTF-8 byte 수로 계산되는 조건을 결정적 검사와 API Client에 반영했다.

OAuth 공식 문서에는 `state`가 안내되지만 PKCE 매개변수는 명시돼 있지 않다. 따라서:

- `state`는 필수·일회성·10분 만료로 구현
- PKCE 코드는 구현하되 `META_USE_PKCE=false`가 기본
- Meta 앱에서 지원이 확인된 경우에만 PKCE 매개변수를 전송

장기 Token 교환과 갱신은 버전 없는 `https://graph.threads.net/access_token`, `/refresh_access_token`을 사용하고 게시·Insights는 버전형 `https://graph.threads.net/v1.0`을 기본으로 한다.

## Companion 패키징 결정

| 방식                 | 장점                             | 단점                           | 결정               |
| -------------------- | -------------------------------- | ------------------------------ | ------------------ |
| 개발용 pnpm 실행     | 디버깅 쉬움                      | 사용자 설치 부담               | 개발 기본          |
| pnpm deploy + tar.gz | workspace 의존성 포함, 재현 가능 | Node/Codex CLI 필요            | **Phase 6 산출물** |
| 단일 바이너리        | 설치 단순                        | Codex CLI·OAuth·서명 결합 복잡 | 후속 후보          |
| Native Messaging     | Extension 연동 강함              | 설치·Store 심사 복잡           | MVP 이후 후보      |

`pnpm package:companion`은 macOS용 실행 디렉터리와 tar.gz를 생성한다. 서명·공증은 Apple 자격 증명이 필요하므로 외부 출시 Gate로 남긴다.

실제 생성된 설치물은 `release/threadflow-companion-macos.tar.gz`이며, Extension ZIP은 `apps/extension/.output/threadflow-osextension-0.1.0-chrome.zip`이다.

## 미검증 외부 Gate

- Meta App ID/Secret을 사용한 실계정 OAuth·게시·Insights
- Chrome Web Store 업로드·심사
- macOS Developer ID 서명·공증
- 실제 Threads DOM 변경에 대한 장기 운영 검증

이 항목은 코드 미구현이 아니라 외부 계정·심사·운영 기간이 필요한 검증 항목이며 Mock·계약 테스트와 분리한다.
