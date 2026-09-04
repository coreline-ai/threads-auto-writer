# Threads 웹 로그인·Meta OAuth 설정 가이드

기준 일자: `2026-09-04`

## 1. 먼저 구분해야 할 두 인증

| 구분                | Threads 웹 로그인 세션                                    | Meta 개발자 OAuth                                      |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| 목적                | 사람이 확인하는 `threads.com` 작성창에 초안을 넣기        | 서버가 Threads 공식 API로 게시·예약·Insights 수행      |
| 획득 위치           | 사용자가 같은 Chrome 프로필에서 Threads에 정상 로그인     | Meta 개발자 앱 생성 후 사용자 동의 OAuth 수행          |
| 앱 값               | 없음                                                      | Threads App ID, Threads App Secret, HTTPS Redirect URI |
| 보관 주체           | Chrome/Threads가 웹 세션 쿠키를 관리                      | Scheduler가 Threads User Access Token을 암호화해 저장  |
| 미로그인·미연결 시  | 작성창 입력 불가, 클립보드 초안만 보존                    | API 게시 불가                                          |
| 현재 Extension 권한 | `threads.com` host permission만 사용, `cookies` 권한 없음 | Extension이 아니라 `apps/scheduler-server`가 처리      |

**개발자 모드는 인증 우회 기능이 아니다.** Chrome 개발자 모드는 압축 해제 확장을 설치할 수 있게 할 뿐이며, Threads 계정 로그인이나 Meta API 권한을 대신 만들지 않는다.

또한 웹 로그인 세션을 얻었다고 공식 API token이 생기는 것도 아니고, Meta App ID/Secret을 얻었다고 Threads 웹 로그인 세션이 생기는 것도 아니다. 두 인증은 서로 교환하거나 대체할 수 없다.

## 2. 웹 작성창 전달용 로그인

### 필요한 것

- 게시할 수 있는 Threads 계정
- ThreadFlow Extension을 설치한 것과 동일한 Chrome 프로필
- 해당 프로필의 유효한 `threads.com` 로그인 세션

### 획득·사용 순서

1. Extension을 설치한 Chrome 프로필에서 `https://www.threads.com/`을 연다.
2. Threads가 제공하는 현재 로그인 방식으로 로그인한다. 로그인 방식과 계정 연결 화면은 Meta Account/Accounts Center 상태에 따라 달라질 수 있다.
3. 피드와 우측 하단 `+` 작성 버튼이 보이고 작성 팝업을 열 수 있는지 확인한다.
4. ThreadFlow Side Panel에서 승인한 글의 **Threads로 전달**을 누른다.
5. Extension은 먼저 완성 글을 클립보드에 복사한 뒤 Threads 탭을 열고 작성창을 찾는다.
6. 작성창을 찾은 경우에만 본문을 입력한다. **게시 또는 예약 확정 버튼은 누르지 않는다.**

### 로그인하지 않은 경우

- Threads 페이지 자체는 열 수 있지만 작성창에 글을 넣을 수 없다.
- Extension은 이를 성공으로 표시하지 않고 `login-required`로 처리한다.
- 초안은 클립보드에 남으므로 로그인 후 직접 붙여넣거나 다시 **Threads로 전달**을 누른다.
- Session cookie, CSRF 값, 브라우저 저장소 값을 복사해 앱에 넣는 방식은 사용하지 않는다.

## 3. 공식 API 자동 게시용 Meta 값

### 값의 정확한 의미

| 값                        | 어디서 얻는가                                                  | 주의                                                                                         |
| ------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `META_APP_ID`             | Meta App Dashboard의 **Threads App ID**                        | 일반 App ID와 별도 표시되면 반드시 Threads용 값을 사용                                       |
| `META_APP_SECRET`         | 같은 화면의 **Threads App Secret**                             | 서버 비밀이다. Extension·문서·Git에 넣지 않음                                                |
| `META_REDIRECT_URI`       | 직접 운영하는 OAuth callback URL을 Meta 앱에 등록              | 발급값이 아니다. HTTPS 필수, `localhost`/loopback URL 불가, 요청값과 문자 단위로 동일해야 함 |
| Threads User Access Token | 사용자가 Authorization Window에서 동의한 뒤 서버가 code를 교환 | App Access Token과 다르며, 실제 게시에는 사용자 토큰이 필요                                  |
| `SCHEDULER_MASTER_KEY`    | 로컬에서 32-byte random 생성                                   | Meta 값이 아니라 저장 토큰 암호화 키                                                         |
| Scheduler Access Key      | 로컬에서 긴 random 생성                                        | ThreadFlow REST API 인증용이며 Meta 토큰과 무관                                              |

### 최소 권한

| 기능                            | 권한                      |
| ------------------------------- | ------------------------- |
| 기본 사용자 식별·토큰 교환/갱신 | `threads_basic`           |
| 글 자동 게시                    | `threads_content_publish` |
| 게시물 Insights                 | `threads_manage_insights` |
| 답글 읽기·관리                  | 현재 구현에서는 불필요    |

자동 게시만 필요하면 `threads_basic`, `threads_content_publish`가 핵심이다. 현재 ThreadFlow의 기본 OAuth 요청은 Insights 기능까지 포함하므로 `threads_manage_insights`도 요청한다. 사용하지 않는 reply 권한은 추가하지 않는다.

## 4. Meta 개발자 앱에서 값 획득

Meta Dashboard의 메뉴 이름은 개편될 수 있지만 설정 대상은 동일하다.

1. [Meta for Developers 앱 대시보드](https://developers.facebook.com/apps/)에서 개발자 등록을 완료한다.
2. **앱 만들기**에서 Threads 사용 사례(use case)를 선택해 앱을 만든다.
3. 앱의 Threads 사용 사례 설정에서 필요한 권한을 추가한다.
4. App settings/Basic 또는 Threads 설정 화면에서 **Threads App ID**와 **Threads App Secret**을 확인한다.
5. Threads OAuth 설정의 Valid OAuth Redirect URIs에 아래 callback을 등록한다.

```text
https://<실제-HTTPS-호스트>/v1/threads/oauth/callback
```

6. 앱이 개발 모드이면 실제 연결할 본인 Threads 계정을 앱 역할/Threads 테스터로 추가하고 계정 쪽에서 초대를 수락한다. 초대 메뉴 라벨은 현재 Dashboard와 Threads의 Website permissions 화면을 기준으로 확인한다.
7. 본인 외 일반 사용자에게 제공하려면 필요한 권한에 대한 App Review, 개인정보처리방침·데이터 삭제·연결 해제 경로, 앱 Live 전환을 별도 완료한다.

> 개발 모드의 본인/테스터 연결과 불특정 사용자의 공개 연결은 같은 출시 단계가 아니다. 개인 실계정 Smoke에는 테스터 연결을 사용하고, 공개 서비스 전에는 현재 Meta Dashboard의 검수 요구를 다시 확인한다.

## 5. HTTPS Redirect URI 준비

Meta 공식 sample은 Threads OAuth가 `localhost` redirect를 지원하지 않고 HTTPS만 지원한다고 명시한다. 따라서 기존의 `http://127.0.0.1:8788/...` 값은 실제 OAuth에 사용할 수 없다.

### 방법 A — 공개 HTTPS 터널/Reverse Proxy

1. Scheduler는 기존처럼 `127.0.0.1:8788`에서 실행한다.
2. 신뢰 가능한 HTTPS 터널 또는 본인 도메인의 Reverse Proxy가 외부 callback 요청을 `http://127.0.0.1:8788`로 전달하게 한다.
3. 외부 URL을 Meta 앱과 `.env`의 `META_REDIRECT_URI`에 동일하게 입력한다.

```text
https://threads-oauth.example.com/v1/threads/oauth/callback
```

### 방법 B — 로컬 전용 사용자 지정 호스트

Meta 공식 sample 방식처럼 `threads-sample.meta` 같은 사용자 지정 호스트를 `127.0.0.1`에 매핑하고 `mkcert` 인증서를 만든다. ThreadFlow Scheduler 자체 listener는 HTTP이므로 인증서를 처리하는 로컬 HTTPS Reverse Proxy를 앞에 두어야 한다.

중요한 검증 조건:

- `https:` 사용
- 호스트가 `localhost`, `127.0.0.1`, `::1`이 아님
- Meta 등록값, Authorization 요청값, code 교환값이 정확히 같음
- Query string, trailing slash, port 차이도 만들지 않음

## 6. ThreadFlow 환경 설정

```bash
cp .env.example .env
openssl rand -base64 32
openssl rand -hex 32
```

생성 결과를 다음 형태로 `.env`에 넣는다. 실제 값은 아래 예시를 그대로 쓰지 않는다.

```dotenv
SCHEDULER_MASTER_KEY=<첫-번째-명령-결과>
SCHEDULER_ACCESS_KEYS_JSON={"<두-번째-명령-결과>":{"tenantId":"tenant-local","workspaceId":"workspace-local","userId":"user-local","role":"owner"}}

META_APP_ID=<Threads-App-ID>
META_APP_SECRET=<Threads-App-Secret>
META_REDIRECT_URI=https://<실제-HTTPS-호스트>/v1/threads/oauth/callback
META_GRAPH_VERSION=v1.0
META_USE_PKCE=false
```

- `.env`는 Git에 커밋하지 않는다.
- `META_USE_PKCE`는 Meta Threads 앱에서 명시적으로 지원이 확인된 경우에만 켠다. 현재 기본은 `false`다.
- Scheduler 시작 시 access-key context의 로컬 workspace가 자동 초기화된다.

## 7. OAuth 연결 실행

### 7.1 Scheduler 시작

```bash
docker compose up -d --build
curl -sS http://127.0.0.1:8788/v1/health
```

또는 로컬 Node 개발 실행:

```bash
pnpm dev:scheduler
```

### 7.2 Authorization URL 발급

```bash
curl -sS -X POST \
  http://127.0.0.1:8788/v1/threads/oauth/start \
  -H 'Authorization: Bearer <Scheduler-Access-Key>'
```

응답의 `authUrl`을 브라우저로 연다. URL은 10분간 유효한 일회성 `state`를 포함한다.

### 7.3 사용자 동의와 토큰 저장

1. 게시 주체가 될 Threads 계정으로 Authorization Window에 로그인한다.
2. 요청 권한을 확인하고 동의한다.
3. Meta가 `META_REDIRECT_URI`로 `code`와 `state`를 전달한다.
4. Scheduler가 code를 short-lived **Threads User Access Token**으로 교환한다.
5. 다시 long-lived token으로 교환한 뒤 AES-256-GCM으로 암호화해 SQLite에 저장한다.
6. 토큰 만료가 가까워지면 Worker가 게시 전에 refresh한다.

long-lived 응답에 유효한 `expires_in`이 없으면 Scheduler는 계정 연결을 실패 처리한다. 인증 만료 때문에 Pause된 계정은 정상 재연결에 성공하면 Resume되며 기존 account ID를 유지한다.

사용자는 access token을 직접 복사해 `.env`에 넣지 않는다. App ID/Secret만으로도 게시할 수 없으며, 반드시 게시 계정의 사용자 동의가 한 번은 필요하다.

공식 OAuth authorization endpoint가 아직 `threads.net` 호스트를 사용하고 웹 제품이 `threads.com`을 사용하는 것은 정상적인 구분이다. 웹 작성창 URL을 OAuth endpoint로 바꾸거나 그 반대로 바꾸지 않는다.

### 7.4 연결 결과 확인

```bash
curl -sS \
  http://127.0.0.1:8788/v1/threads/accounts \
  -H 'Authorization: Bearer <Scheduler-Access-Key>'
```

응답에는 account ID, Threads 사용자 ID/username, token 만료·pause 상태만 포함되고 token ciphertext는 노출되지 않는다. 이후 승인 Draft 저장과 `POST /v1/publish-jobs` 요청에 이 account ID를 사용한다.

예약 목록과 개별 취소:

```bash
curl -sS \
  http://127.0.0.1:8788/v1/publish-jobs \
  -H 'Authorization: Bearer <Scheduler-Access-Key>'

curl -sS -X POST \
  http://127.0.0.1:8788/v1/publish-jobs/<job-id>/cancel \
  -H 'Authorization: Bearer <Scheduler-Access-Key>'
```

취소는 아직 게시 실행을 시작하지 않은 `SCHEDULED`·`RETRY_WAIT` 작업에만 허용된다.

### 7.5 Postman으로 일회성 진단

Meta 공식 Postman collection에서도 Authorization Code 방식으로 사용자 token을 발급하고 권한·만료를 확인할 수 있다. 이 방법은 Meta 앱 설정과 endpoint를 독립적으로 검증할 때 유용하다.

1. 공식 Threads API collection을 fork한다.
2. Threads App ID/Secret, Auth URL, Access Token URL, Redirect URI, scope를 설정한다.
3. Grant type은 Authorization Code를 사용한다.
4. Get New Access Token으로 사용자 동의를 수행한다.
5. Access Token Debugger에서 token 종류, 권한, 만료를 확인한다.

Postman token은 진단용으로 취급한다. 현재 ThreadFlow 운영 경로는 `/v1/threads/oauth/start`에서 시작해 Scheduler vault에 암호화 저장하는 방식이며, token을 Extension이나 `.env`에 직접 붙여 넣는 경로는 제공하지 않는다. Client Credentials로 얻는 App Access Token도 사용자 대신 게시하는 token이 아니다.

## 8. 자동 게시에서 실제로 일어나는 일

1. `APPROVED` 상태의 Final Draft를 Scheduler에 저장한다.
2. UTC instant, IANA timezone, idempotency key와 함께 publish job을 만든다.
3. 예약 시각에 Worker가 사용자 access token을 복호화한다.
4. Threads API에 media container를 만든다.
5. 이미지라면 공개 HTTPS image URL을 Meta가 가져가고 container 준비 상태를 확인한다.
6. `/threads_publish`로 게시하고 post ID를 저장한다.
7. 성공 여부가 불명확하면 중복 게시 방지를 위해 자동 재시도하지 않고 Dead Letter로 보낸다.

현재 저장소에서 이 경로는 **Scheduler REST API로 사용 가능**하지만 Side Panel의 기본 **Threads로 전달** 버튼과는 아직 별도다. Side Panel 버튼은 웹 작성창 수동 확인 흐름이고, 공식 API 자동 게시 연결은 Scheduler API를 호출하는 운영 UI/CLI를 추가해야 완전한 일반 사용자 흐름이 된다.

## 9. 출시 전 남은 외부 확인

- Meta 앱 개발 모드에서 본인 Threads 계정 OAuth 1회
- 실제 text 게시 1건과 중복 방지 확인
- long-lived token refresh 확인
- 현재 계정의 publishing limit endpoint 확인
- Insights 권한을 사용할 경우 실제 metric 응답 확인
- 공개 사용자 대상 App Review와 앱 Live 전환
- Meta deauthorization/data deletion callback 요구사항 최종 구현·검증

LLM 사용량과 Threads 게시 한도는 서로 무관하다. Codex 생성 한도가 없더라도 Threads API에는 계정별 publishing limit가 적용될 수 있으므로 운영 시 공식 limit endpoint의 실제 응답을 기준으로 제어해야 한다.

## 공식 근거

- [Meta 공식 Threads API Postman 문서](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
- [Meta 공식 Threads API Postman workspace](https://www.postman.com/meta/threads/overview)
- [Meta 공식 Threads Publishing API sample](https://github.com/fbsamples/threads_api)
- [Meta: Threads 웹 작성 경험](https://about.fb.com/news/2025/04/new-features-threads-web-experience/)
