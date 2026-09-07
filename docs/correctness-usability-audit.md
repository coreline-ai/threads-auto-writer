# 필수 기능 정확성·사용성 전문가 재검토

> 최신 UI 검증은 [에디토리얼 스튜디오](editorial-studio-design.md)를 따른다. 아래 감사는 당시 85개 테스트 기준 기록이다. 현재 전체 테스트는 94개이며 최신 설치물 hash는 [출시 준비 상태](release-readiness.md)에 있다.

기준 일시: `2026-09-06 KST`

## 결론

이번 검토는 기능 확장이 아니라 **현재 약속한 작성·검수·승인·전달·예약 경로가 틀리지 않고, 사용자가 실수해도 복구 가능한지**만 확인했다. 코드 수준에서 확인된 P0/P1 결함은 수정했고 TypeScript, ESLint, Vitest `85/85`, 자체 웹과 Chrome MV3 Production build를 통과했다.

실제 Threads DOM과 Meta 실계정 API는 자격 증명·로그인 환경이 있어야 확인할 수 있으므로 완료로 과장하지 않는다. 이 항목들은 코드 누락이 아니라 마지막 실환경 Gate다.

## 검토·수정 결과

| 영역             | 발견된 정확성·사용성 문제                                                                                             | 조치                                                                                                                      | 상태 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| 게시물 캡처      | Side Panel의 **현재 게시물 가져오기**가 사전 우클릭 대상에 의존해 바로 누르면 실패                                    | 현재 permalink, 포커스된 게시물, 화면 중앙의 보이는 게시물 순으로 한 게시물을 결정하도록 수정                             | 완료 |
| Threads 전달     | 작성창이 아직 닫힌 상태면 textbox를 찾지 못하고 종료하며 검색·답글 입력란을 오인할 가능성                             | 게시가 아닌 **새 스레드 작성창 열기** 컨트롤만 안전하게 누르고, 검색·답글 입력란을 제외한 뒤 작성창을 채우도록 수정       | 완료 |
| Draft 유실 방지  | Side Panel을 닫으면 미승인 편집본·입력값·진행 상태가 메모리에서 사라짐                                                | IndexedDB v3 작업공간 자동 저장, 재개 시 복원, 진행 작업 SSE 재연결, Gateway 작업 소실 시 입력 보존 후 명시적 재시도 안내 | 완료 |
| 입력 검증        | 잘못된 URL, 빈 목적/Persona, 과다 근거, 빈 최종 글, 같은 승인본 중복 저장을 UI에서 늦게 발견                          | 공통 Zod 계약을 제출 전에 적용하고 빈 글·중복 승인·잘못된 Companion key를 선제 차단                                       | 완료 |
| 보관함 복원      | 보관함 Draft를 열 때 당시 Source·Persona·근거가 복원되지 않아 다른 기준으로 재검수될 수 있음                          | 신규 저장 버전에 Generation Request를 함께 저장하고 Draft 로드 시 작성·검수 기준 전체를 복원                              | 완료 |
| 후보 정확성      | 유사도 자동 교정 후에도 교정 전 후보 ID가 최종 Draft에 남을 수 있고 Critic 중복 순위가 허용됨                         | 마지막 교정 결과의 후보 ID를 다시 결합하고 모든 후보가 정확히 한 번 평가됐는지 검증                                       | 완료 |
| 제휴 고지        | 고지 문구가 요청에 존재하기만 하면 실제 결과 본문에 없어도 검사 통과                                                  | Prompt에 정확한 고지문 포함을 요구하고 결과 본문 포함 여부를 결정적으로 재검사                                            | 완료 |
| Codex Provider   | 전송 실패가 타임아웃까지 남고, 완료 알림이 없는 Turn이 무기한 대기하며, Rate Limit도 Schema 오류처럼 재시도될 수 있음 | 즉시 전송 실패 처리, 초기화 single-flight, Turn timeout·interrupt, 출력 오류에만 Schema repair 적용                       | 완료 |
| Gateway 복구     | 완료된 SSE를 재연결하면 terminal event를 보낸 뒤 연결이 닫히지 않고, 수정 Provider 오류가 409로 오분류됨              | terminal replay 즉시 종료, 생성·수정 오류를 원인별 상태 코드로 정규화                                                     | 완료 |
| Scheduler 안전성 | 계정 연결 해제 후 대기 Job이 영구 잔류하고, 문자열 `"false"`가 Pause로 처리되며, Timer tick이 겹칠 수 있음            | 대기 Job 원자적 취소, boolean 엄격 검증, Worker tick 직렬화, 잘못된 refresh token 차단·계정 Pause                         | 완료 |
| Tenant 격리      | 한 Workspace의 전체 Pause가 다른 Tenant까지 멈출 수 있고 Account ID 충돌 시 타 Tenant Token 갱신 가능성               | Workspace 범위 Pause와 Account ID 소유권 조건을 적용                                                                      | 완료 |
| Threads API 응답 | 성공 HTTP에 필수 `id`/`access_token`이 없어도 성공으로 취급                                                           | Token, Profile, Container, Publish 응답을 런타임 검증하고 불명확한 게시 결과는 재시도 금지                                | 완료 |
| 연결 안내        | UI placeholder와 문서가 `session-secret` 파일 경로를 붙여넣는 것으로 오해될 수 있음                                   | **경로가 아니라 파일 내용**을 입력하도록 UI·Gateway 출력·설치 문서 수정                                                   | 완료 |
| 웹 우선 실행     | Extension 설치 전에는 핵심 작성 기능을 실행할 독립 Surface가 없음                                                     | 공통 Client UI와 Runtime Adapter를 분리하고 localhost 웹·명시적 loopback CORS·팝업 차단 fallback 구현                     | 완료 |
| 웹 SSE 수신      | Fastify raw SSE 응답에 CORS 헤더가 없어 실제 Chromium 1턴이 `Failed to fetch`로 종료                                  | 검증된 요청 Origin과 `Vary: Origin`을 raw 응답에 복원하고 응답 헤더 회귀 테스트 추가                                      | 완료 |

## 핵심 사용자 흐름 재확인

1. 사용자가 웹에 주제·메모를 직접 입력하거나 Extension에서 Threads 게시물을 캡처한다.
2. 제출 전에 URL·Source·Persona·목적·근거 개수와 길이를 검사한다.
3. Codex 작업은 read-only·tool-free Thread에서 실행하고 단계별 결과를 SSE로 전달한다.
4. 후보·최종안은 결정적 유사도, 근거, 금지 표현, 제휴 고지, 500-unit 한도를 다시 검사한다.
5. 사용자가 직접 승인 저장한 동일 Snapshot만 Threads 작성창 전달 또는 Scheduler 입력으로 사용할 수 있다.
6. 웹 전달은 클립보드를 먼저 보존하고 작성창까지만 연다. **게시·예약 확정 버튼은 누르지 않는다.**
7. Side Panel을 닫아도 현재 입력과 편집본은 복원되며, 서버 작업을 복구할 수 없으면 내용은 보존하고 재실행을 안내한다.

## 자동 검증

- TypeScript project reference: PASS
- ESLint: PASS
- Vitest: `16 files / 85 tests` PASS
- localhost 웹 production build, 1280px·390px 실브라우저 렌더: PASS
- 웹 Origin CORS·Companion bootstrap·Codex OAuth(`chatgpt`, Pro) 실제 연결: PASS
- 실제 Chromium 1턴 생성·후보 4개·261/500 최종 Draft·위험 검사: PASS
- 최종 승인 저장·보관함 v1·페이지 새로고침 복구: PASS
- WXT Chrome MV3 Production build·ZIP: PASS
- Developer-mode Gateway bind·`/v1/health` Smoke: PASS
- Golden Set `30/30`, 성능 예산 Smoke: PASS
- Extension ZIP SHA-256: `bcf987ee5ce1ef0f47bfaff95dfedb32c6773b0d3c7b3e320b2284285385ebb6`
- Companion tar.gz SHA-256: `7366f1f3c5620da8c65cd8f1819def83f51766e64d7e5e0bd1929e62acd77f45`

## 남은 실환경 Gate

- 로그인된 실제 Threads 피드·permalink·작성 dialog에서 캡처와 입력을 각각 3회 반복
- Threads 로그아웃 상태에서 `login-required`와 클립보드 보존 확인
- Side Panel 닫기·Chrome 재시작·Gateway 재시작 조합에서 Draft 복원 확인
- 실제 ChatGPT OAuth 계정에서 로그인 취소·만료·Rate Limit 메시지 확인
- 공식 자동 게시 사용 시 Meta tester OAuth, Text 게시 1건, 중복 방지, Token refresh, Insights 확인

이 Gate가 끝나기 전에는 “실계정 E2E 완료” 또는 “공개 출시 준비 완료”로 표시하지 않는다.

## 의도적으로 추가하지 않은 기능

- 게시·예약 확정 버튼 자동 클릭
- Side Panel 안의 공식 API Scheduler 운영 UI
- 이미지 Object Storage 업로드
- 결제·외부 IdP·알림 대시보드

위 항목은 현재 필수 정확성 수정이 아니라 별도 제품 확장이다.

## 2026-09-07 후속 적용

Forest Night와 편의 기능을 구현했다. 앞선 수치는 이전 리디자인의 기준선이며, 최신 결과는 **125개 테스트 PASS**와 [편의성·테마 검토](convenience-theme-review.md)를 기준으로 한다. 확장 번들 렌더 QA와 실제 네이티브 설치 QA는 구분한다.
