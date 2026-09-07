# 남은 수정·검증 사항

기준 일자: `2026-09-07 KST`

## 결론

기존 정확성·사용성 재검토의 수정과 에디토리얼 스튜디오 디자인 적용을 완료했다. 별도 검증 항목은 실제 Threads 계정, Meta 개발자 앱, HTTPS callback 또는 사람·설치 환경이 있어야 수행할 수 있는 외부 검증이다. 상세 근거는 [필수 기능 정확성·사용성 전문가 재검토](correctness-usability-audit.md)에 있다.

Codex 생성 경로의 코드 작업도 완료했다. 전용 Proxy caller와 격리 Live Smoke는 통과했지만, 이 Mac의 공용 `4348` Proxy는 연결되지 않은 장치 watchdog이 약 30초마다 모든 Proxy를 재시작한다. 이 운영 설정을 분리하기 전에는 긴 실제 생성이 중간에 `PROVIDER_UNAVAILABLE`로 종료될 수 있다.

## 리디자인 후 확인한 주의점

- 실제 생성에서 구조화 출력 검증 실패 1회를 관측했고 재시도는 성공했다. 실패 시 입력 보존·오류 표시를 검증했다. 원인과 재현율은 확정하지 않았으며 성공률 개선은 이번 디자인 적용 범위가 아니다.
- 기존 숫자 근거 검사는 `글 1개`, `5개 항목` 같은 체크리스트에도 경고한다. 사실 확인 완료나 글 품질 보장으로 표시하지 않으며 검사 정책을 이번 작업에서 완화하지 않았다.
- 웹 1440/1024/390/340px와 Extension 번들 340/520px 렌더 QA를 완료했다. Extension은 Chrome API 모의 환경의 레이아웃 검증이지 네이티브 설치/Threads 로그인 검증이 아니다.

## 편의성 개선 — 구현 완료

다크 테마, 화면 내 수정 요청·비교, 고정 작업 바, 새 작업·임시 초안, 보관함 검색/필터를 구현했다. [검증 결과](convenience-theme-review.md)와 [개발 계획](../dev-plan/implement_20260906_225905.md)을 따른다. 실제 모바일 키보드·브라우저 자체 확대·네이티브 Extension 설치 검증은 남아 있다. 프리셋·오류별 복구 버튼·단축키는 이번 구현 범위 밖의 후속 후보다.

## 이번 점검에서 완료한 수정

| 우선순위 | 수정                                                                  | 상태 |
| -------- | --------------------------------------------------------------------- | ---- |
| P0       | 저장된 승인 Draft ID·버전·본문 hash·account ID와 예약 요청 결합       | 완료 |
| P0       | 승인 후 바뀐 본문 및 Draft 경로/account 불일치 차단                   | 완료 |
| P0       | Threads OAuth의 non-local HTTPS callback 및 정확한 callback 경로 검증 | 완료 |
| P0       | 동일 계정 재연결 시 account ID·암호화 AAD 재사용                      | 완료 |
| P1       | long-lived token `expires_in` 누락 시 연결 실패 처리                  | 완료 |
| P1       | 인증 오류 Pause 상태를 정상 OAuth 재연결 후 복구                      | 완료 |
| P1       | token 비노출 계정 조회, 예약 작업 목록·개별 취소 API                  | 완료 |
| P1       | 사용자 삭제 시 account control 잔여 데이터 제거                       | 완료 |
| P1       | Codex OAuth token과 Threads User Access Token 저장 정책 문서 분리     | 완료 |
| P1       | placeholder·짧은 Scheduler Access Key 시작 차단                       | 완료 |
| P0       | 우클릭 없이 현재 게시물 캡처·안전한 작성창 열기                       | 완료 |
| P0       | Side Panel 미승인 편집본·입력값 자동 저장·복구                        | 완료 |
| P0       | 후보 ID·Critic 순위·제휴 고지의 최종 결과 결합 오류 수정              | 완료 |
| P0       | Codex Turn timeout·Provider 오류 오분류·terminal SSE 종료             | 완료 |
| P0       | 계정 연결 해제 시 대기 Job 취소·Workspace Pause Tenant 격리           | 완료 |
| P1       | API 성공 응답 필수 필드·Pause boolean·Companion key 내용 검증         | 완료 |
| P0       | localhost 자체 웹과 Extension 공통 Client UI·Runtime 경계             | 완료 |
| P0       | exact loopback 웹 Origin CORS와 웹·Gateway 한 명령 실행               | 완료 |
| P1       | 웹 OAuth 팝업 차단 fallback, 캡처 제한 안내, 안전한 클립보드 전달     | 완료 |
| P0       | hijacked SSE 응답의 웹 CORS 헤더 누락과 실브라우저 `Failed to fetch`  | 완료 |

## 실제 사용 전 필수 외부 Gate

### Codex OAuth Provider Proxy

| ID           | 필요한 입력·환경            | 수행 내용                                                           | 현재 상태        |
| ------------ | --------------------------- | ------------------------------------------------------------------- | ---------------- |
| EXT-PROXY-01 | 전용 caller ID/secret       | `threadflow` ACL 등록, `0600` secret 파일                           | 이 Mac 완료      |
| EXT-PROXY-02 | Proxy 입력·출력 상한        | 요청 524288 bytes, 출력 16000 chars 설정                            | 이 Mac 완료      |
| EXT-PROXY-03 | 안정적인 Proxy daemon       | 관련 없는 PD20 장애가 Codex Proxy를 재시작하지 않도록 watchdog 분리 | 사용자 승인 대기 |
| EXT-PROXY-04 | 실 ChatGPT OAuth/Codex 구독 | 격리 Proxy에서 5단계 글 생성·후보 3개·최종 결과 확인                | 완료             |

`EXT-PROXY-03`은 ThreadFlow 소스 결함이 아니라 외부 Proxy 운영 Gate다. POST 자동 재전송은 응답 유실 시 중복 LLM turn을 만들 수 있어 우회책으로 적용하지 않았다.

### Threads 공식 API

| ID     | 필요한 입력·환경      | 수행 내용                                     | 현재 상태 |
| ------ | --------------------- | --------------------------------------------- | --------- |
| EXT-01 | Meta 개발자 계정      | Threads use case 앱 생성                      | 대기      |
| EXT-02 | Threads App ID/Secret | Scheduler `.env` 주입                         | 대기      |
| EXT-03 | HTTPS 도메인/터널     | `/v1/threads/oauth/callback` 등록·도달 확인   | 대기      |
| EXT-04 | 본인 Threads 계정     | 앱 역할/Threads tester 추가·초대 수락         | 대기      |
| EXT-05 | 본인 계정 OAuth 동의  | short-lived→long-lived token 교환 확인        | 대기      |
| EXT-06 | 실제 게시 허용        | Text 게시 1건, 중복 방지, 결과 ID 확인        | 대기      |
| EXT-07 | Insights 권한         | metric 조회와 현재 계정 publishing limit 확인 | 대기      |

이 Gate는 [Threads 웹 로그인·Meta OAuth 설정 가이드](threads-auth-setup.md)의 순서로 진행한다. 실제 App Secret이나 User Access Token은 문서, 채팅, Git, Extension 저장소에 기록하지 않는다.

## 수동 QA Gate

- 실브라우저 전체 삭제 버튼: 데이터 삭제 위험으로 보안 승인 차단, 승인 대기. DB/테마 초기화 자동 테스트는 통과.
- 실제 모바일 소프트 키보드·브라우저 자체 확대 (CSS 200% 모사는 통과).

- 완료: localhost 웹 1280px·390px 렌더, 설정 전환, Origin CORS, Companion bootstrap
- 완료: 실제 Chromium에서 ChatGPT Pro 연결, 1턴 생성, 후보 4개, 261/500 최종 Draft 확인
- 완료: 최종 승인 저장, 보관함 v1, 페이지 새로고침 후 Draft 복구 확인
- 동일 Chrome 프로필에서 Threads 로그인 후 작성창 자동 입력
- 로그아웃 상태에서 `login-required` 표시와 클립보드 보존
- Threads DOM이 바뀐 경우 직접 붙여넣기 fallback
- Side Panel 열기·닫기, 탭 이동, 브라우저 재시작 후 자동 저장 Draft 복원
- 신규 Mac 환경에서 설치부터 첫 글 전달까지 Smoke
- 3회 연속 실제 작성·예약 UI 사용에서 Draft 유실 없음
- 사람 평가 Rubric으로 글 품질 수용 여부 확인

## 공개 배포를 선택할 때만 필요한 작업

- Meta App Review와 Live 전환
- Meta deauthorization/data deletion callback의 최신 계약 확인·구현·실검증
- 개인정보처리방침 및 데이터 삭제 안내 URL 공개
- Chrome Web Store 제출·심사
- macOS 설치물을 일반 사용자에게 배포할 경우 Developer ID 서명·공증
- 외부 IdP, 결제·요금제, 운영 알림·모니터링

## 선택적 제품 확장

다음 항목은 현재 개인용 Companion과 Scheduler REST API 동작을 막지 않는다.

- Side Panel에서 공식 API 계정 연결·예약·취소를 직접 수행하는 운영 UI
- 공개 HTTPS 이미지 업로드·만료·삭제 Object Storage Adapter
- Threads publishing limit 사전 조회와 계정별 보수적 게시 간격 정책
- 자동 Insights 주기 수집 대시보드

## 검증 기준선

- TypeScript project reference typecheck: PASS
- ESLint: PASS
- Vitest: `141/141` PASS
- localhost 웹 production build·실브라우저 QA: PASS
- 웹 Origin Codex OAuth 상태·실제 Chromium 1턴 생성·승인·복구: PASS
- WXT Chrome MV3 production build: PASS
- Codex OAuth Proxy 전용 caller 격리 5단계 Live Smoke: PASS
- Extension ZIP SHA-256: `11fd04d74dda4711eb74f58466f54c29ba50d35d223816307ec0c580f732091b`
- Companion tar.gz SHA-256: `6aed32f3ef9ad3831fc514261f0e0f8fa7e40911bc23b66199dbe39280c15f7c`
