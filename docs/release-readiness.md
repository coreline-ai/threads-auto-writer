# 출시 준비 상태

기준 일시: `2026-09-07 KST`

## 개발자 모드 상태

**개인용 localhost 웹과 Chrome 개발자 모드 실행 준비 완료.** 먼저 `pnpm start:web`으로 자체 웹을 실행할 수 있다. 브라우저 문맥 기능이 필요하면 Web Store 제출과 Apple 서명·공증 없이 `apps/extension/.output/chrome-mv3`를 압축 해제 확장으로 로드하고 `pnpm start:developer -- <extension-id>`를 실행한다.

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
- 총 125개 Vitest 자동 테스트
- localhost 웹 production build와 1280px·390px 실브라우저 시각 QA
- 웹 Origin의 Gateway CORS, Companion session bootstrap, Codex OAuth 상태 실제 HTTP Smoke
- 웹 Origin의 1턴 생성·SSE 전체 8단계·최종 결과 Live Smoke
- Side Panel 최신 Production build 데스크톱 시각 QA
- 공식 Threads API Media 상태 polling·Insights 저장 Mock 검증
- 승인 Draft snapshot 무결성·계정 재연결·예약 목록/취소 Mock 검증
- macOS Companion tar.gz와 Chrome Extension ZIP 생성
- `pnpm start:developer -- <extension-id>` 개발자 모드 Gateway Health·연결 키 권한 Smoke

최신 테마·편의 기능의 실제 검증 범위와 미검증 항목은 [구현 검토](convenience-theme-review.md)를 따른다.

## 생성된 설치물

| 설치물                                                           | SHA-256                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/dist`                                                  | `pnpm build:web`로 재현                                            |
| `apps/extension/.output/threadflow-osextension-0.1.0-chrome.zip` | `3147f14befdce28c10fa60af375264a5d16ffbc826f0feeb51bf4ac21471f75e` |
| `release/threadflow-companion-macos.tar.gz`                      | `b4bc852cb8d7bd18b3aa83dfd37f3364c8d7fc90ecd143c2891e4679d5b377c1` |

## 공개 배포·실계정 자동 게시 Gate

- [ ] Meta App 생성·권한 검수
- [ ] 실제 Threads 계정 OAuth·Text 게시·Insights 조회
- [ ] Chrome Web Store 제출·심사
- [ ] macOS Developer ID 서명·공증
- [ ] 새 사용자 환경 설치 Smoke
- [ ] 3회 연속 실제 Threads 작성·예약 UI 사용에서 Draft 유실 없음
- [ ] 사람 평가 Rubric 합격

이 Gate들은 개인 개발자 모드 사용을 막지 않는다. 공개 배포 또는 Meta 실계정 자동 게시를 활성화할 때만 완료해야 한다.

항목별 입력값·수행 순서와 선택적 확장 범위는 [남은 수정·검증 사항](remaining-work.md)을 따른다.
