# Phase 0~9 구현 상태

기준 일시: `2026-09-05 KST`

## 결론

Phase 0~9의 저장소 내 구현 범위는 완료했다. 개인용 MVP, Codex 품질 파이프라인, Chrome Extension, 공식 Threads API Scheduler, Insights, Tenant 격리까지 코드와 자동 테스트를 구성했다. **개인 사용은 Chrome 개발자 모드로 바로 실행 가능하다.**

Chrome Web Store와 Apple 서명·공증은 공개 배포를 선택할 때만 필요한 Gate다. Meta 실계정 자동 게시, 공개 SaaS, 신규 사용자 장기 사용은 별도 자격 증명과 운영 검증이 필요하므로 개인 개발자 모드 완료 상태와 분리한다. 현재 Side Panel의 **Threads로 전달**은 웹 로그인 기반 수동 확인 흐름이며, Phase 8 자동 게시는 별도 Scheduler REST API 경로다.

필수 기능 정확성·사용성 재검토와 수정 내역은 [전문가 재검토 보고서](correctness-usability-audit.md)를 따른다.

## Phase별 상태

| Phase | 저장소 구현                                                                                        | 검증                                                                                                        | 외부 잔여 Gate                                                        |
| ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 0     | Codex App Server·Threads GUI·HTTP+SSE Spike                                                        | 실제 ChatGPT OAuth 구조화 생성 성공                                                                         | 실로그아웃은 전역 Codex 세션 보호를 위해 미실행                       |
| 1     | pnpm Monorepo, 공통 계약·상태·오류 DTO                                                             | TypeScript·Schema 테스트 통과                                                                               | 없음                                                                  |
| 2     | loopback Gateway, OAuth Adapter, SSE, 취소, Turn timeout, 세션·Origin·Host 방어                    | Mock 계약·보안 테스트와 Live 생성 통과                                                                      | 설치 환경별 Codex 버전 호환 확인                                      |
| 3     | 5단계 Prompt·Critic·Final·결정적 위험 검사                                                         | Golden Set 30/30, Live 전체 파이프라인 통과                                                                 | 사람 평가 Rubric 수행                                                 |
| 4     | WXT MV3 Side Panel, 우클릭 없는 현재 게시물 Capture, Dexie 작업공간 자동 저장·복원                 | Adapter·저장소·Manifest 자동 검사 통과                                                                      | 실제 Threads DOM 장기 호환                                            |
| 5     | 후보 비교·수정·승인·클립보드·안전한 작성창 열기·전달                                               | 정적 UI 시각 QA와 계약 테스트 통과                                                                          | 실제 Threads 작성·예약 화면 반복 Smoke                                |
| 6     | Extension ZIP, macOS Companion tar.gz, 정책·복구·Store 문서                                        | Production build·패키지·구간별 성능 예산 검사 통과                                                          | Developer ID 서명·공증, Store 심사, 신규 사용자 Smoke                 |
| 7     | Draft 버전·캘린더·편집 Diff·이미지/Alt·게시 결과 연결·Prompt Rollback                              | IndexedDB·DB 버전 충돌·Rollback 테스트 통과                                                                 | 운영 데이터 기반 Prompt 실험                                          |
| 8     | OAuth·Token Vault·승인 snapshot 검증·예약 목록/취소·Lease·Retry·Dead Letter·Media polling·Insights | HTTPS callback·long-lived expiry·재연결·계정 해제 Job 취소·응답 유실·Pause·미디어·Insights Mock 테스트 통과 | Meta App 값, 본인 테스터 OAuth, 실계정 게시·조회와 Side Panel 운영 UI |
| 9     | Tenant/Workspace/Role 경계, 사용자별 Codex Home, Workspace·계정별 Pause·삭제                       | Tenant·암호화 AAD·Account ID 소유권·Workspace Pause 격리 테스트 통과                                        | 외부 IdP, 운영 지표, 결제 정책, 심사 승인                             |

## 산출물

- Chrome Extension: `apps/extension/.output/threadflow-osextension-0.1.0-chrome.zip`
- macOS Companion: `release/threadflow-companion-macos.tar.gz`
- Golden Set: `evals/fixtures/golden-ko.json`
- 사람 평가표: `evals/rubrics/human-evaluation.md`
- 개발 계획·체크리스트: `dev-plan/implement_20260904_183303.md`

## 운영 승인 전 금지 사항

- Meta 실계정 자격 증명 없이 자동 게시 완료로 표시하지 않는다.
- Chrome Web Store·Meta·Apple 심사를 통과하기 전 공개 출시로 표시하지 않는다.
- 운영자 ChatGPT OAuth 세션을 일반 사용자에게 공유하지 않는다.
- 결제·요금제는 승인된 제품 정책이 생기기 전 활성화하지 않는다.
