# Threads 공식 API 운영 가이드

Meta App 생성, Threads App ID/Secret 확인, HTTPS callback 준비, 테스터 연결과 실제 OAuth 실행 순서는 [Threads 웹 로그인·Meta OAuth 설정 가이드](threads-auth-setup.md)를 먼저 따른다.

## 기본 흐름

1. 사용자별 OAuth `state`를 생성하고 10분 뒤 만료한다.
2. Callback에서 state를 원자적으로 한 번만 소비한다.
3. Short-lived Token을 Long-lived Token으로 교환하고 AES-256-GCM으로 암호화한다.
4. `APPROVED` Draft만 UTC 예약 시각과 IANA timezone으로 동기화한다.
5. DB Lease Worker가 due Job을 한 번 획득한다.
6. media container를 만들고 ID를 저장한다. 이미지는 `FINISHED`까지 polling한 뒤 publish한다.
7. Post ID와 최소 감사 메타데이터를 저장한다.
8. 공식 Insights 범위에서 `views, likes, replies, reposts, quotes, shares`를 수집한다.

## 사용 가능한 Scheduler API

모든 callback 이외 요청은 `Authorization: Bearer <Scheduler-Access-Key>`가 필요하다.

| Method   | 경로                                    | 용도                                           |
| -------- | --------------------------------------- | ---------------------------------------------- |
| `POST`   | `/v1/threads/oauth/start`               | 10분 유효 OAuth Authorization URL 생성         |
| `GET`    | `/v1/threads/oauth/callback`            | Meta code 수신·long-lived token 암호화 저장    |
| `GET`    | `/v1/threads/accounts`                  | token을 제외한 연결 계정 상태 조회             |
| `DELETE` | `/v1/threads/accounts/:id`              | 계정 연결 해제·token 폐기                      |
| `POST`   | `/v1/drafts/:id/versions`               | 승인 시각이 있는 Final Draft snapshot 저장     |
| `GET`    | `/v1/drafts/:id/versions`               | Draft 버전 조회                                |
| `POST`   | `/v1/publish-jobs`                      | 저장된 승인 snapshot과 일치하는 예약 작업 생성 |
| `GET`    | `/v1/publish-jobs`                      | Workspace 예약 작업 목록 조회                  |
| `GET`    | `/v1/publish-jobs/:id`                  | 예약 작업 상태 조회                            |
| `POST`   | `/v1/publish-jobs/:id/cancel`           | 대기·재시도 상태의 작업 취소                   |
| `POST`   | `/v1/publish-jobs/:id/insights/refresh` | 게시된 글의 Insights 갱신                      |
| `GET`    | `/v1/publish-jobs/:id/insights`         | 저장된 Insights 조회                           |
| `GET`    | `/v1/controls`                          | 현재 Workspace·시스템 Pause 상태 조회          |
| `POST`   | `/v1/controls/global`                   | 현재 Workspace 전체 게시 Pause/Resume          |
| `POST`   | `/v1/controls/accounts/:id`             | 계정별 Pause/Resume                            |

게시 작업은 Draft ID·버전·본문 hash와 Threads account ID가 저장된 승인 snapshot과 모두 일치할 때만 생성된다. 승인 뒤 본문을 바꾸었거나 경로 ID·계정 ID가 다르면 거부한다. 이미 Lease/PUBLISHING/PUBLISHED 상태인 작업은 중복·경합 방지를 위해 취소할 수 없다.

## 중복 방지

- API Idempotency Key unique constraint
- `tenant + account + content_hash` 활성 Job partial unique index
- `BEGIN IMMEDIATE` Lease와 worker ID 검증
- 게시 응답이 유실되면 `PUBLISH_OUTCOME_UNKNOWN` Dead Letter로 보내고 자동 재시도하지 않음
- 만료된 `PUBLISHING` Lease도 자동 게시하지 않고 Dead Letter로 복구

## 미디어

- Meta가 이미지를 가져갈 수 있도록 공개 HTTPS URL이어야 한다.
- Image Job은 `mediaExpiresAt`을 필수로 받고 예약 시각 뒤 최소 2분 동안 유효한지 검증한다.
- Worker 실행 시 남은 유효 시간이 60초 미만이면 `MEDIA_URL_EXPIRED`로 Dead Letter 처리한다.
- Container 상태는 기본 5초 간격·최대 7회 확인하며 `ERROR`·`EXPIRED`는 자동 게시하지 않는다.
- Media URL은 게시 처리 시간 동안만 유효하게 발급하고 완료·영구 실패 뒤 `mediaLifecycle.revoke`로 삭제한다. 외부 Object Storage Adapter가 없으면 URL 자체 만료가 최종 방어선이다.
- 기본 MVP Extension은 이미지를 서버로 업로드하지 않는다.

## Token 암호화 키 회전

1. Scheduler와 Worker를 중지하고 DB를 백업한다.
2. 새 32-byte base64 키를 생성한다.
3. 이전·신규 키를 셸 기록에 남기지 않는 Secret Manager 환경 변수로 주입한다.
4. `SCHEDULER_OLD_MASTER_KEY=... SCHEDULER_NEW_MASTER_KEY=... pnpm rotate:scheduler-key`를 실행한다.
5. 결과의 `rotated` 개수와 계정 수를 비교한 뒤 `SCHEDULER_MASTER_KEY`를 새 키로 교체한다.
6. Scheduler를 재시작하고 계정 한 건의 읽기·갱신 Smoke를 수행한 뒤 이전 키를 폐기한다.

회전은 하나의 SQLite `BEGIN IMMEDIATE` 트랜잭션에서 수행되며 중간 복호화 실패 시 전체 변경을 Rollback한다.

성공한 OAuth 재연결은 인증 오류로 걸린 계정 Pause를 해제하고 기존 account ID를 유지한다. 명시적 Workspace Pause는 그대로 유지된다. long-lived token에 유효한 `expires_in`이 없으면 연결 완료로 저장하지 않는다.

## 배포 전 확인

- Meta App과 정확히 일치하는 non-local HTTPS Redirect URI
- 필요한 `threads_basic`, `threads_content_publish`, `threads_manage_insights` 권한과 앱 검수
- API 버전 및 Text/Media 제약 재확인
- 실제 계정 Text 게시 1건과 Insights 조회
- Token refresh, 권한 취소, rate limit, 전체 Pause 훈련
- 공개 HTTPS Reverse Proxy 뒤에서 정확한 Callback URI와 TLS 확인
- 개인 개발 모드는 Threads 테스터 계정으로 실계정 Smoke를 수행하고, 일반 사용자 공개 전 App Review·Live 전환·deauthorization/data deletion callback을 별도 검증
