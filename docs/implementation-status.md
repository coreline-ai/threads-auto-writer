# Phase 0~9 구현 상태

기준 일시: `2026-09-06 KST`

## 결론

Phase 0~9의 저장소 내 구현 범위는 완료했다. 개인용 MVP, Codex 품질 파이프라인, localhost 자체 웹, Chrome Extension, 공식 Threads API Scheduler, Insights, Tenant 격리까지 코드와 자동 테스트를 구성했다. **개인 사용은 `pnpm start:web`으로 먼저 실행하고, 필요한 경우 Chrome 개발자 모드로 확장할 수 있다.**

Chrome Web Store와 Apple 서명·공증은 공개 배포를 선택할 때만 필요한 Gate다. Meta 실계정 자동 게시, 공개 SaaS, 신규 사용자 장기 사용은 별도 자격 증명과 운영 검증이 필요하므로 개인 개발자 모드 완료 상태와 분리한다. 현재 웹의 **복사하고 Threads 열기**와 Side Panel의 **Threads 작성 화면으로**는 사용자 최종 확인 흐름이며, Phase 8 자동 게시는 별도 Scheduler REST API 경로다.

필수 기능 정확성·사용성 재검토와 수정 내역은 [전문가 재검토 보고서](correctness-usability-audit.md)를 따른다.

## Phase별 상태

| Phase | 저장소 구현                                                                                        | 검증                                                                                                        | 외부 잔여 Gate                                                        |
| ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 0     | Codex App Server·Threads GUI·HTTP+SSE Spike                                                        | 실제 ChatGPT OAuth 구조화 생성 성공                                                                         | 실로그아웃은 전역 Codex 세션 보호를 위해 미실행                       |
| 1     | pnpm Monorepo, 공통 계약·상태·오류 DTO                                                             | TypeScript·Schema 테스트 통과                                                                               | 없음                                                                  |
| 2     | loopback Gateway, OAuth Adapter, SSE, 취소, Turn timeout, 세션·Origin·Host 방어                    | Mock 계약·보안 테스트와 Live 생성 통과                                                                      | 설치 환경별 Codex 버전 호환 확인                                      |
| 3     | 5단계 Prompt·Critic·Final·결정적 위험 검사                                                         | Golden Set 30/30, Live 전체 파이프라인 통과                                                                 | 사람 평가 Rubric 수행                                                 |
| 4     | 공통 Client UI, localhost 자체 웹, WXT MV3 Side Panel, Capture, Dexie 자동 저장·복원               | 웹 실브라우저 렌더·CORS Smoke, Adapter·저장소·Manifest 자동 검사 통과                                       | 실제 Threads DOM 장기 호환                                            |
| 5     | 한 번 입력→최종 초안, 선택형 후보 비교·수정·승인·클립보드·웹/Extension 안전 전달                   | 정적·실브라우저 UI QA와 계약 테스트 통과                                                                    | 실제 Threads 작성·예약 화면 반복 Smoke                                |
| 6     | Extension ZIP, macOS Companion tar.gz, 정책·복구·Store 문서                                        | Production build·패키지·구간별 성능 예산 검사 통과                                                          | Developer ID 서명·공증, Store 심사, 신규 사용자 Smoke                 |
| 7     | Draft 버전·캘린더·편집 Diff·이미지/Alt·게시 결과 연결·Prompt Rollback                              | IndexedDB·DB 버전 충돌·Rollback 테스트 통과                                                                 | 운영 데이터 기반 Prompt 실험                                          |
| 8     | OAuth·Token Vault·승인 snapshot 검증·예약 목록/취소·Lease·Retry·Dead Letter·Media polling·Insights | HTTPS callback·long-lived expiry·재연결·계정 해제 Job 취소·응답 유실·Pause·미디어·Insights Mock 테스트 통과 | Meta App 값, 본인 테스터 OAuth, 실계정 게시·조회와 Side Panel 운영 UI |
| 9     | Tenant/Workspace/Role 경계, 사용자별 Codex Home, Workspace·계정별 Pause·삭제                       | Tenant·암호화 AAD·Account ID 소유권·Workspace Pause 격리 테스트 통과                                        | 외부 IdP, 운영 지표, 결제 정책, 심사 승인                             |

## 산출물

- 자체 웹: `apps/web` (`pnpm start:web`)
- Chrome Extension: `apps/extension/.output/threadflow-osextension-0.1.0-chrome.zip`
- macOS Companion: `release/threadflow-companion-macos.tar.gz`
- Golden Set: `evals/fixtures/golden-ko.json`
- 사람 평가표: `evals/rubrics/human-evaluation.md`
- 개발 계획·체크리스트: `dev-plan/implement_20260904_183303.md`
- 웹 우선 개발 계획: `dev-plan/implement_20260906_200105.md`

## 운영 승인 전 금지 사항

- Meta 실계정 자격 증명 없이 자동 게시 완료로 표시하지 않는다.
- Chrome Web Store·Meta·Apple 심사를 통과하기 전 공개 출시로 표시하지 않는다.
- 운영자 ChatGPT OAuth 세션을 일반 사용자에게 공유하지 않는다.
- 결제·요금제는 승인된 제품 정책이 생기기 전 활성화하지 않는다.

## 에디토리얼 스튜디오 리디자인 — 2026-09-06

- 기능 확장 없이 웹 홍보 영역 제거, 요청/편집 2열, 공통 UI 토큰과 좁은 화면 재정리.
- 실제 저장 성공/실패 상태, 추정 퍼센트 없는 생성 단계, 접힘 후보·변경점·이미지 준비 적용.
- 기존 편집 이력·검수·승인/전달 경계 유지. `apps/web/test/editorial-ui.test.ts`에 9개 회귀 테스트 추가.
- 전체 94/94 테스트, Golden 30/30, 타입·린트·웹/Extension build·ZIP PASS.
- [디자인 명세](editorial-studio-design.md), [개발 계획](../dev-plan/implement_20260906_214210.md), [레이아웃 실측](gui-layout-audit.md).
- 실제 Codex 생성은 최초 출력 검증 실패 후 재시도 성공. 검수에서 체크리스트 숫자에도 경고하는 기존 보수적 규칙은 유지한다.

## 편의성·Forest Night — 2026-09-07

- 시스템/라이트/다크, 현재 본문 기반 AI 수정 preview, 단일 작업 바, 작업별 임시 저장, 전체 보관함 검색/상태 필터 구현.
- DB v4 migration·rollback·여러 탭 충돌·미저장 복구 내보내기·늦은 승인 응답의 편집 보존 확인.
- 전체 **125/125**, Golden **30/30**, 타입·린트·포맷·두 앱 빌드·설치물 갱신 PASS.
- 실제 웹 Codex 생성·수정안 버리기/적용·승인·새 작업·검색·복원 PASS. 첫 Provider 오류와 재시도 성공을 구분해 기록했다.
- 상세: [구현 검토](convenience-theme-review.md). 모바일 키보드·네이티브 Extension/Threads 전달은 여전히 수동 검증 항목이다.
