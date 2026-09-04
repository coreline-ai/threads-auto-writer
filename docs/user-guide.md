# ThreadFlow OS 사용자 가이드

## 개인 개발자 모드 결론

개인 PC에서 직접 사용하는 현재 목표에는 Chrome Web Store 제출과 macOS 서명·공증이 필요하지 않다. Chrome의 **개발자 모드 → 압축해제된 확장 프로그램을 로드합니다**로 Production build 폴더를 불러오고 로컬 Gateway를 실행하면 된다.

직접 입력하는 외부 값은 Chrome이 표시하는 Extension ID뿐이다. 단, AI 생성을 위한 ChatGPT OAuth 로그인과 작성창 전달을 위한 Threads 웹 로그인이 모두 필요하다. Codex는 ChatGPT OAuth 구독 로그인을 사용하므로 LLM API Key가 필요하지 않다. 전체 값 구분은 [외부 값과 로컬 생성 값](external-values.md)을 따른다.

## 설치

### 권장: Chrome 개발자 모드

1. Node.js 22 이상과 Codex CLI를 설치한다.
2. `codex login`에서 ChatGPT 구독 계정으로 로그인한다.
3. 같은 Chrome 프로필에서 `https://www.threads.com/`에 로그인한다.
4. 프로젝트에서 `pnpm install && pnpm build`를 실행한다.
5. Chrome `chrome://extensions`에서 개발자 모드를 켠다.
6. **압축해제된 확장 프로그램을 로드합니다**를 눌러 `apps/extension/.output/chrome-mv3`를 선택한다.
7. 확장 카드에 표시된 32자 Extension ID를 복사한다.
8. `pnpm start:developer -- <extension-id>`를 실행한다.
9. `cat .threadflow/session-secret`로 파일 **내용**을 확인하고 Side Panel 설정의 Companion 연결 키에 입력한다. 파일 경로를 붙여넣으면 안 된다.

코드 변경 후에는 `pnpm build`를 다시 실행하고 `chrome://extensions`의 ThreadFlow OS 카드에서 새로고침하면 된다.

### 별도 Companion 패키지로 실행

1. `apps/extension/.output/threadflow-osextension-0.1.0-chrome.zip`을 풀고 Chrome 개발자 모드에서 로드한다.
2. `release/threadflow-companion-macos.tar.gz`를 풀고 Extension ID를 확인한다.
3. Terminal에서 `export THREADFLOW_EXTENSION_ORIGINS="chrome-extension://<id>"`를 설정한다.
4. Companion 폴더의 `./threadflow-companion`을 실행한다.
5. Companion 폴더에서 `cat .threadflow/session-secret`를 실행하고 파일 **내용**을 Side Panel 설정에 저장한다.

이 방식도 개인 개발자 모드에서는 Apple Developer ID 서명이나 공증 없이 Terminal에서 직접 실행할 수 있다.

## 첫 글 만들기

1. Threads 게시물에서 우클릭하고 **ThreadFlow OS로 이 게시물 가져오기**를 선택하거나 참고 글을 직접 붙여넣는다.
2. 목적, 모드, 후보 수, Persona, 확인된 근거를 입력한다.
3. **품질 파이프라인 시작**을 누른다.
4. 분석·전략·후보·비평·개선·검수 상태를 확인한다.
5. 후보를 비교하고 편집하거나 Hook/CTA/사용자 지시 수정을 요청한다.
6. 차단 위험을 해소한 후 **최종 승인 저장**을 누른다.
7. **Threads 작성 화면으로**를 누른다. 초안은 먼저 클립보드에 저장된다.
8. Threads 웹 로그인이 확인되고 작성창을 찾았을 때만 자동 입력된다. 로그아웃 상태이거나 DOM 입력에 실패하면 클립보드 초안을 직접 붙여넣는다.
9. Threads 기본 UI에서 이미지, 날짜·시간을 확인하고 게시 또는 예약을 직접 확정한다.
10. 게시 후 보관함의 **게시 결과 연결**에 실제 Threads URL을 기록할 수 있다.

## 자동 저장과 복구

- 참고 글, 작성 전략, 후보, 미승인 편집본은 IndexedDB에 자동 저장된다.
- Side Panel을 닫았다 다시 열면 마지막 작업공간을 복원한다.
- 진행 중 생성은 같은 Gateway 작업이 남아 있으면 SSE를 다시 연결한다.
- Gateway가 재시작되어 작업이 사라졌다면 입력·편집 내용은 보존하고 새 파이프라인 실행을 안내한다.
- 보관함 Draft는 저장 당시 Source·Persona·근거와 함께 복원된다. 구버전 Draft에 검수 기준이 없으면 변경본 승인을 차단하고 재생성을 안내한다.

## 주의

- ThreadFlow OS는 MVP에서 게시·예약 확정 버튼을 자동으로 클릭하지 않는다.
- 숫자·가격·날짜·효능·수익 표현은 확인된 근거를 입력하지 않으면 검토 필요로 차단된다.
- DOM 입력에 실패해도 클립보드에 보존된 초안을 직접 붙여넣을 수 있다.
