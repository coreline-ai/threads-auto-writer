# 출시 준비 상태

기준 일시: `2026-09-08 KST`

## 개발자 모드 상태

**코드와 설치물은 개인용 localhost 웹·Chrome 개발자 모드 실행 준비 완료다.** 먼저 Proxy caller 환경 변수를 설정하고 `pnpm start:web`으로 자체 웹을 실행할 수 있다. 브라우저 문맥 기능이 필요하면 Web Store 제출과 Apple 서명·공증 없이 `apps/extension/.output/chrome-mv3`를 압축 해제 확장으로 로드하고 `pnpm start:developer -- <extension-id>`를 실행한다.

현재 Mac의 전용 `threadflow` caller, 실 Proxy 격리 스모크, 공용 `4348` daemon의 5단계 생성 스모크를 완료했다. audio Proxy 모델 checksum 누락으로 발생하던 Manager readiness 503과 watchdog 반복 재시작도 복구했으며, 전체 Proxy readiness 200과 생성 중 PID 유지까지 확인했다.

## 자동 검증 완료

- TypeScript project reference typecheck
- ESLint
- Vitest 계약·보안·품질·DB·Worker 테스트
- WXT Chrome MV3 production build
- 30개 한국어 Golden Set 결정적 위험 회귀
- ChatGPT OAuth Codex App Server 구조화 출력 Live Spike
- 5단계 품질 파이프라인 Live Smoke
- Capture·첫 모델 Delta·전체 생성·Draft 복원 성능 예산 Smoke
- 최소 Manifest 권한 정적 확인
- 총 141개 Vitest 자동 테스트
- localhost 웹 production build와 1280px·390px 실브라우저 시각 QA
- 웹 Origin의 Gateway CORS, Companion session bootstrap, Codex OAuth 상태 실제 HTTP Smoke
- 웹 Origin의 1턴 생성·SSE 전체 8단계·최종 결과 Live Smoke
- Side Panel 최신 Production build 데스크톱 시각 QA
- 공식 Threads API Media 상태 polling·Insights 저장 Mock 검증
- 승인 Draft snapshot 무결성·계정 재연결·예약 목록/취소 Mock 검증
- macOS Companion tar.gz와 Chrome Extension ZIP 생성
- `pnpm start:developer -- <extension-id>` 개발자 모드 Gateway Health·연결 키 권한 Smoke
- Codex OAuth Proxy caller 헤더·권한·4,000자 chunk·`gpt-5.6-sol`/`xhigh`·오류 마스킹·DLP Mock 검증
- 격리된 실 Codex OAuth Proxy의 전용 caller 5단계 생성, 후보 3개, 최종 173자, 요청 지문 일치 Live Smoke
- 공용 `4348` Proxy의 5단계 생성, 후보 3개, 최종 194자, 요청 지문 일치 및 watchdog 무재시작 Live Smoke

최신 테마·편의 기능의 실제 검증 범위와 미검증 항목은 [구현 검토](convenience-theme-review.md)를 따른다.

## 생성된 설치물

| 설치물                                                           | SHA-256                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/dist`                                                  | `pnpm build:web`로 재현                                            |
| `apps/extension/.output/threadflow-osextension-0.1.0-chrome.zip` | `11fd04d74dda4711eb74f58466f54c29ba50d35d223816307ec0c580f732091b` |
| `release/threadflow-companion-macos.tar.gz`                      | `6aed32f3ef9ad3831fc514261f0e0f8fa7e40911bc23b66199dbe39280c15f7c` |

## 공개 배포·실계정 자동 게시 Gate

- [x] 공용 `4348` Proxy Manager readiness 200 및 watchdog 무재시작 확인

- [ ] Meta App 생성·권한 검수
- [ ] 실제 Threads 계정 OAuth·Text 게시·Insights 조회
- [ ] Chrome Web Store 제출·심사
- [ ] macOS Developer ID 서명·공증
- [ ] 새 사용자 환경 설치 Smoke
- [ ] 3회 연속 실제 Threads 작성·예약 UI 사용에서 Draft 유실 없음
- [ ] 사람 평가 Rubric 합격

이 Gate들은 개인 개발자 모드 사용을 막지 않는다. 공개 배포 또는 Meta 실계정 자동 게시를 활성화할 때만 완료해야 한다.

항목별 입력값·수행 순서와 선택적 확장 범위는 [남은 수정·검증 사항](remaining-work.md)을 따른다.
