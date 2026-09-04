# 남은 수정·검증 사항

기준 일자: `2026-09-05 KST`

## 결론

필수 기능 정확성·사용성 재검토에서 발견된 코드 결함은 수정했다. 남은 필수 항목은 실제 Threads 계정, Meta 개발자 앱, HTTPS callback 또는 사람·설치 환경이 있어야 수행할 수 있는 외부 검증이다. 상세 근거는 [필수 기능 정확성·사용성 전문가 재검토](correctness-usability-audit.md)에 있다.

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

## 실제 사용 전 필수 외부 Gate

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
- Vitest: `79/79` PASS
- WXT Chrome MV3 production build: PASS
- Extension ZIP SHA-256: `97613edd445b569e84ac6ed9e228b5b495e7b6f183f33bdcd4e3c16fd2271c63`
