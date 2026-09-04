# Threads 자동화 크롬 익스텐션 상세 기능 정의 및 구현 제안서

- **프로젝트 가칭:** ThreadFlow OS
- **문서 버전:** v1.4
- **작성일:** 2026-09-04
- **목표:** Threads 콘텐츠의 수집, 분석, AI 작성, 검수, 예약 발행, 성과 분석을 하나의 Chrome Extension과 서버 시스템으로 통합

---

## 0. 전문가 검토 반영 요약(2026-09-04)

- **목표 보강:** MVP 경로는 유효하나, 운영 안정성·보안·정책 리스크 관리를 우선 통합해 단계별 책임을 더 명확히 분리.
- **핵심 보완점 6가지**
  1. Companion 모드는 자동 발행 대신 **사용자 확인형 Threads 작성 화면 전달**로 제한.
  2. App Secret/토큰은 반드시 서버 측만 보관, 확장에는 세션 토큰/최소 권한 정보만 유지.
  3. 자동 수집/자동 상호작용 기능은 정책 리스크 항목으로 별도 차단.
  4. 발행 중복 방지를 위해 `idempotency_key` + `content_hash` + Lease 기반 상태전이를 강제.
  5. 토큰 만료, API 한도 초과, 미디어 URL 만료 대응 시나리오를 스펙에 포함.
  6. Chrome Web Store 심사를 고려한 권한 최소화·설명 문구를 문서 수준에서 명시.
- **적용 상태:** 섹션 8, 10, 11, 15, 24에서 보완 내용 반영.

## 0.1 원본 영상 GUI 확인 결과(2026-09-04)

원본 영상의 실제 화면을 구간별로 확인했다. 영상에 등장하는 제품은 이 문서의 가칭인 `ThreadFlow OS`가 아니라 **`바이럴훅 라이트`**다. 이 문서의 UI와 서버 구조는 영상 제품의 소스코드를 복원한 것이 아니라, 확인된 사용자 흐름을 바탕으로 운영 기능을 확장한 신규 설계안이다.

| 영상 구간   | 화면에서 확인된 내용                                | 설계 반영 범위                                                             |
| ----------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| 02:39~02:54 | Threads 화면 오른쪽에 고정된 보라색 보조 패널       | Side Panel 형태의 보조 UI                                                  |
| 02:54~03:32 | Gemini API 키 연결 상태                             | 영상의 Gemini 흐름을 Codex OAuth Provider Proxy로 대체                     |
| 03:32~05:18 | 원본 글 선택, 글 유형 선택, AI 재작성, 결과 편집    | Capture → Transform → Review 흐름                                          |
| 05:18~06:20 | 쿠팡 파트너스용 쇼핑 글 생성                        | 쇼핑·제휴 템플릿은 선택 기능으로 분리                                      |
| 06:20~07:40 | Google Flow 이미지 배경 재생성 및 Magic Eraser 사용 | 영상에서는 외부 도구를 수동 사용하며 확장 내부 통합은 확인되지 않음        |
| 07:40~08:14 | 링크·이미지 적용 후 `바로 게시`                     | 게시 전 미리보기와 사용자 확인                                             |
| 08:14~08:28 | Threads 작성 창의 즉시 게시 및 날짜·시간 예약 UI    | 영상은 Threads 웹의 예약 UI를 사용하며 자체 Scheduler 동작은 확인되지 않음 |
| 08:28 이후  | 반자동 다계정 패키지 안내 화면                      | 홍보 내용만 확인되며 다계정 관리 GUI·구현 방식은 영상에서 검증되지 않음    |

> 화면만으로 보조 패널이 Chrome `sidePanel` API인지 Threads DOM에 삽입된 패널인지는 확정할 수 없다. 본 제안서는 유지보수성과 권한 분리를 위해 `sidePanel` API를 우선안으로 채택한다.

> 자체 예약 Worker, Meta API 자동 발행, 다계정 Workspace, Insights 대시보드는 영상에서 직접 확인된 기능이 아니라 제품화를 위해 추가한 확장 설계다.

---

## 1. 프로젝트 개요

이 프로젝트는 단순히 Threads 웹페이지를 자동으로 클릭하는 확장 프로그램이 아니라, 다음 전체 운영 흐름을 통합하는 **Threads 콘텐츠 운영 OS**를 목표로 한다.

```text
참고 게시물 선택
    ↓
콘텐츠 구조 분석
    ↓
계정 Persona 기반 신규 글 생성
    ↓
유사도·사실성·금지 표현 검수
    ↓
사용자 승인
    ↓
즉시 게시 또는 예약 발행
    ↓
성과 수집
    ↓
다음 글 생성 전략에 반영
```

가장 안정적인 구조는 Chrome Extension이 모든 자동화를 직접 수행하는 방식이 아니라 다음처럼 역할을 분리하는 것이다.

> **Chrome Extension = 콘텐츠 수집·분석·작성·승인 화면**  
> **Codex OAuth Provider Proxy = 구독 기반 다단계 글 생성과 품질 검수**  
> **Ubuntu 서버 = Threads OAuth·토큰·예약 발행·통계 수집**  
> **Threads 공식 API = 실제 게시와 성과 조회**

---

## 2. 운영 모드

| 모드                     | 구성                          | 게시 방식                                     | 용도                       |
| ------------------------ | ----------------------------- | --------------------------------------------- | -------------------------- |
| Companion 모드           | 확장 프로그램만               | Threads 작성 화면에서 사용자가 최종 게시·예약 | 가장 안전한 1차 MVP        |
| Personal Automation 모드 | 확장 프로그램 + 개인 서버     | 공식 API 예약 게시                            | 개인 계정 자동화           |
| SaaS 모드                | 확장 프로그램 + 클라우드 서버 | 공식 API 다계정 게시                          | 일반 사용자 배포 및 유료화 |

### 권장 개발 순서

1. Companion 모드
2. Personal Automation 모드
3. 콘텐츠 운영 OS 확장
4. SaaS 및 Chrome Web Store 배포

---

## 3. 전체 아키텍처

```text
┌──────────────────────────────────────────────────────┐
│                  Chrome Extension                    │
├──────────────────────────────────────────────────────┤
│ Threads 페이지 Content Script                        │
│ - 사용자가 선택한 게시물 읽기                        │
│ - 현재 게시물 URL·작성자·텍스트 추출                 │
│                                                      │
│ Side Panel                                            │
│ - 게시물 분석                                         │
│ - AI 글 생성                                          │
│ - 편집·승인                                           │
│ - 예약 대기열                                         │
│ - 성과 대시보드                                       │
│                                                      │
│ Background Service Worker                             │
│ - 계정 인증 시작                                      │
│ - Codex Gateway 및 서버 통신                          │
│ - 알림·단축키·Context Menu                           │
└───────────────────────┬──────────────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
┌──────────────────┐       ┌──────────────────────────┐
│ Codex AI Gateway │       │ Ubuntu Automation Server │
├──────────────────┤       ├──────────────────────────┤
│ Codex App Server │       │ Threads OAuth            │
│ ChatGPT OAuth    │       │ 암호화 토큰 저장         │
│ 다중 후보 생성   │       │ 예약 Queue               │
│ 비평·개선·검수   │       │ Publishing Worker        │
└──────────────────┘       │ Insights Collector       │
                           │ Webhook Receiver          │
                           │ PostgreSQL / SQLite       │
                           └─────────────┬────────────┘
                                         ▼
                               ┌──────────────────┐
                               │ Threads API      │
                               │ 게시·Reply·통계  │
                               └──────────────────┘
```

### 역할 분리

| 구성 요소                  | 책임                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| Content Script             | Threads 페이지에서 사용자가 선택한 콘텐츠 추출                    |
| Side Panel                 | 분석, 작성, 편집, 예약, 성과 UI 제공                              |
| Background Service Worker  | 확장 내부 메시지 중계, Codex Gateway 및 서버 호출                 |
| Codex OAuth Provider Proxy | ChatGPT 구독 인증, 구조 분석, 다중 후보 생성, 비평·개선·품질 검수 |
| Ubuntu 서버                | OAuth, 토큰, 예약 작업, 게시, 통계, Webhook                       |
| Threads 공식 API           | 게시물 발행, 계정·게시물·Insights 조회                            |

---

## 4. 핵심 사용자 흐름

### 4.1 잘된 게시물을 참고해 새 글 만들기

```text
Threads 게시물 발견
        ↓
게시물 우클릭 또는 확장 아이콘 클릭
        ↓
“ThreadFlow로 분석”
        ↓
Hook·본문 구조·CTA·톤 분석
        ↓
내 계정 Persona 선택
        ↓
완전히 새롭게 작성한 글 후보 3~5개 생성
        ↓
유사도·중복 표현·사실 주장 검수
        ↓
사용자가 수정 및 승인
        ↓
즉시 게시 또는 예약
```

### 4.2 하루치 콘텐츠 일괄 생성

```text
계정 선택
   ↓
콘텐츠 카테고리 선택
   ├─ AI·개발
   ├─ 애드센스·블로그
   ├─ Threads 자동화
   ├─ 여행·USJ
   └─ 생산성
   ↓
게시 슬롯 선택
   ├─ 09:00 정보형
   ├─ 12:30 경험형
   ├─ 17:00 질문형
   └─ 21:00 전환형
   ↓
AI가 슬롯별 글 생성
   ↓
일괄 검토
   ↓
승인된 글만 예약 Queue 등록
```

### 4.3 게시 후 성과 학습

```text
게시 완료
   ↓
1시간·24시간·72시간 성과 저장
   ↓
조회·좋아요·댓글·재게시·인용·클릭 분석
   ↓
Hook·주제·길이·게시 시간별 성과 비교
   ↓
다음 콘텐츠 생성 규칙으로 추천
```

AI가 전략을 임의로 자동 변경하기보다는 다음처럼 사용자가 승인하도록 한다.

```text
AI 추천:
“숫자형 Hook의 24시간 평균 조회수가
질문형 Hook보다 높았습니다.”

[전략 적용] [이번에는 무시]
```

---

# 5. 상세 기능 정의

## 5.1 계정 연결 및 워크스페이스

| ID     | 기능              | 우선순위 | 설명                                   |
| ------ | ----------------- | -------: | -------------------------------------- |
| ACC-01 | 운영 모드 선택    |       P0 | Companion 또는 공식 API 자동 게시 선택 |
| ACC-02 | Threads 계정 연결 |       P1 | 공식 OAuth로 계정 연결                 |
| ACC-03 | 계정 전환         |       P1 | 여러 Threads 계정 선택                 |
| ACC-04 | 계정별 Persona    |       P0 | 말투·주제·독자·금지 표현 설정          |
| ACC-05 | 권한 상태 확인    |       P1 | 현재 승인된 API 권한 표시              |
| ACC-06 | 토큰 만료 상태    |       P1 | 정상·갱신 예정·재연결 필요 표시        |
| ACC-07 | 전체 자동화 중지  |       P0 | 모든 예약 게시 즉시 Pause              |
| ACC-08 | 계정 연결 해제    |       P0 | 토큰 폐기 및 로컬 정보 삭제            |

---

## 5.2 Persona 설정

계정마다 다음 정보를 별도로 저장한다.

```json
{
  "name": "AI 자동화 실전 계정",
  "targetAudience": [
    "AI를 업무에 활용하고 싶은 직장인",
    "자동화에 관심 있는 1인 개발자"
  ],
  "contentPillars": ["AI 도구", "업무 자동화", "개발 기록", "수익화 실험"],
  "tone": ["직설적", "쉽게 설명", "과장하지 않음", "짧은 문단"],
  "bannedExpressions": [
    "무조건 돈 법니다",
    "클릭만 하면 자동 수익",
    "100% 보장"
  ],
  "ctaFrequency": 0.25,
  "emojiLevel": "low",
  "preferredLength": {
    "min": 180,
    "max": 430
  }
}
```

### Persona 주요 항목

| 분류        | 설정 내용                          |
| ----------- | ---------------------------------- |
| 콘텐츠 주제 | 계정이 다루는 3~7개 핵심 영역      |
| 타깃 독자   | 직장인, 개발자, 블로거 등          |
| 말투        | 전문적, 친근함, 단호함 등          |
| 문단 형태   | 한 줄 문단, 짧은 문장, 서술형      |
| Hook 성향   | 숫자형, 질문형, 반전형 등          |
| CTA 성향    | 댓글 질문, 저장 요청, 링크 유도    |
| 금지 표현   | 과장, 투자 보장, 반복 광고 문구    |
| 민감 주제   | 정치, 의료, 금융 등 자동 생성 차단 |
| 사실성 기준 | 숫자·날짜·가격은 출처 확인 필요    |

---

## 5.3 콘텐츠 수집

| ID     | 기능                 | 우선순위 | 설명                                 |
| ------ | -------------------- | -------: | ------------------------------------ |
| CAP-01 | 선택 텍스트 가져오기 |       P0 | 사용자가 드래그한 문장만 가져오기    |
| CAP-02 | 현재 게시물 분석     |       P0 | 현재 열린 게시물의 텍스트·URL 저장   |
| CAP-03 | URL 직접 입력        |       P0 | 게시물 주소를 붙여넣어 분석          |
| CAP-04 | 클립보드 입력        |       P0 | 외부에서 복사한 문장 분석            |
| CAP-05 | 참고 자료 보관함     |       P0 | 분석한 게시물을 태그별 저장          |
| CAP-06 | 중복 자료 검사       |       P1 | 이미 저장한 URL·내용인지 확인        |
| CAP-07 | 공식 키워드 검색     |       P2 | 허용된 공식 API 범위에서 키워드 검색 |
| CAP-08 | 출처 삭제            |       P0 | 원문과 분석 데이터를 즉시 삭제       |

### 저장 데이터 예시

```json
{
  "sourceUrl": "https://www.threads.com/...",
  "sourceAuthor": "username",
  "capturedAt": "2026-09-04T11:30:00+09:00",
  "text": "원문",
  "captureMethod": "explicit-user-action",
  "tags": ["AI", "자동화"],
  "analysisStatus": "pending"
}
```

### 수집 원칙

- 사용자가 명시적으로 선택한 게시물만 가져온다.
- 무한 스크롤 전체 수집 기능을 만들지 않는다.
- 로그인 Cookie를 읽지 않는다.
- 비공개 GraphQL 엔드포인트를 호출하지 않는다.
- 원문은 그대로 재작성하는 재료가 아니라 구조 분석 참고 자료로만 사용한다.

---

## 5.4 게시물 구조 분석

AI 분석 결과를 구조화된 JSON으로 저장한다.

```json
{
  "hook": {
    "type": "숫자형",
    "summary": "비용 절감 효과를 첫 문장에서 제시"
  },
  "body": {
    "structure": ["문제 제기", "기존 방식의 단점", "대안 제시", "행동 유도"],
    "paragraphCount": 6
  },
  "tone": ["단호함", "실용적", "경험 공유형"],
  "cta": {
    "type": "댓글 유도",
    "position": "마지막 문장"
  },
  "risk": {
    "copySimilarity": "medium",
    "unsupportedClaims": ["300만 원 절약"]
  }
}
```

### 분석 항목

1. 첫 문장 Hook 유형
2. 문제 제기 방식
3. 문장 길이와 리듬
4. 문단 수
5. 주장과 근거의 위치
6. 감정 요소
7. CTA 유형
8. 광고성 강도
9. 반복 표현
10. 원문과 유사해질 위험
11. 검증이 필요한 숫자·가격·날짜
12. 다른 계정에서도 재사용 가능한 추상 구조

---

## 5.5 AI 글 생성

| ID     | 기능           | 우선순위 | 설명                                  |
| ------ | -------------- | -------: | ------------------------------------- |
| GEN-01 | 다중 후보 생성 |       P0 | 서로 다른 Hook·관점을 가진 3~5개 버전 |
| GEN-02 | 길이 변환      |       P0 | 짧게·표준·길게                        |
| GEN-03 | 톤 변환        |       P0 | 정보형·경험형·공감형·직설형           |
| GEN-04 | Hook만 재생성  |       P0 | 본문을 유지하고 첫 문장만 변경        |
| GEN-05 | CTA만 재생성   |       P0 | 질문·저장·팔로우·링크 형태            |
| GEN-06 | 연속 게시 구성 |       P1 | 여러 게시물로 나누는 초안             |
| GEN-07 | 답글 초안      |       P2 | 받은 Reply에 대한 답글 제안           |
| GEN-08 | 인용 게시 초안 |       P2 | 원문에 의견을 덧붙이는 초안           |
| GEN-09 | 사실 주장 표시 |       P0 | 검증이 필요한 문장을 경고             |
| GEN-10 | 유사도 검사    |       P0 | 참고 게시물과 표현 중복 방지          |

### 생성 파이프라인

```text
1단계: 구조 분석
- 원문의 표현을 복사하지 않음
- Hook·전개·CTA 구조만 추출

2단계: 신규 작성
- 계정 Persona 적용
- 사용자가 입력한 실제 경험과 정보 사용
- 서로 다른 3~5개 버전 생성

3단계: 검수
- 글자 수 제한 초과
- 원문 유사 표현
- 근거 없는 수치
- 반복 광고 문구
- 금지 표현
- 기존 예약 글과 중복
```

### 출력 형식 예시

```json
{
  "variants": [
    {
      "id": "v1",
      "hookType": "숫자형",
      "text": "생성된 게시물",
      "topicTag": "업무자동화",
      "riskFlags": [],
      "sourceNotes": []
    },
    {
      "id": "v2",
      "hookType": "질문형",
      "text": "생성된 게시물",
      "topicTag": "AI활용",
      "riskFlags": ["가격 정보 확인 필요"],
      "sourceNotes": ["300만 원이라는 수치의 근거 확인"]
    }
  ]
}
```

---

# 6. Codex OAuth Provider Proxy 구현 제안

Gemini API 키 또는 로컬 모델 대신 ChatGPT 구독 인증을 사용하는 `Codex OAuth Provider Proxy`를 기본 생성 엔진으로 채택한다. 구현은 Codex App Server의 인증·Thread·Turn·스트리밍 인터페이스를 로컬 Gateway가 감싸는 구조를 권장한다.

```text
Chrome Extension
      ↓ chrome.runtime message
Background Service Worker
      ↓ localhost session
Codex Provider Gateway (127.0.0.1)
      ↓ JSON-RPC / local transport
Codex App Server
      ↓ ChatGPT OAuth
Codex subscription access
```

OpenAI 공식 문서에 따르면 Codex는 ChatGPT 로그인 기반 구독 접근을 지원하며, App Server는 자체 제품에 인증·대화 이력·승인·스트리밍 이벤트를 통합하는 인터페이스를 제공한다.

- 인증: https://learn.chatgpt.com/docs/auth
- Codex App Server: https://learn.chatgpt.com/docs/app-server

### 연결 설정 예시

```json
{
  "provider": "codex-oauth-proxy",
  "baseUrl": "http://127.0.0.1:8787",
  "model": "auto",
  "qualityMode": "deep",
  "candidateCount": 5,
  "timeoutMs": 180000
}
```

`model: auto`는 Proxy에서 승인한 기본 모델을 사용한다는 애플리케이션 설정이며 특정 모델 ID에 제품 로직을 결합하지 않는다.

### 인증·자격 증명 원칙

1. Gateway가 App Server의 ChatGPT 브라우저 로그인 또는 Device Code 흐름을 시작한다.
2. Codex OAuth Access/Refresh Token은 Extension, IndexedDB, Threads DOM, Ubuntu Scheduler에 복사하지 않는다. 공식 API용 Threads User Access Token은 별도 Scheduler Vault에만 암호화 저장한다.
3. App Server 자격 증명 저장은 OS Keyring을 우선한다.
4. Gateway는 localhost에만 바인딩하고 설치별 랜덤 세션 시크릿과 Extension Origin 검증을 사용한다.
5. Ubuntu 서버에는 AI 인증 정보가 아니라 사용자가 승인한 최종 초안만 전달한다.

### 품질 중심 생성 파이프라인

토큰을 절약하기 위한 단일 호출 대신 다음 다단계 흐름을 기본으로 한다.

```text
Source Analyst
  → Strategy Writer
  → Candidate Generator(3~5개)
  → Critic & Ranker
  → Final Rewriter
  → Evidence·Similarity·Policy Checker
  → 사용자 검수
```

| 단계                | 결과                                               |
| ------------------- | -------------------------------------------------- |
| Source Analyst      | Hook, 전개, 독자, 감정, CTA 구조 JSON              |
| Strategy Writer     | Persona와 게시 목적에 맞는 신규 접근               |
| Candidate Generator | 서로 다른 관점의 후보 3~5개                        |
| Critic & Ranker     | Hook·독창성·가독성·Persona·근거성 점수             |
| Final Rewriter      | 상위 후보의 장점을 결합한 최종안                   |
| Checker             | 유사도, 금지 표현, 숫자·가격·수익 주장 위험 플래그 |

### 사용량·안정성 정책

- 앱 자체에는 일일 토큰 예산이나 글당 토큰 제한을 두지 않는다.
- 무제한 문맥 누적은 품질을 떨어뜨릴 수 있으므로 작업별 새 Thread를 만들고, 수정 작업만 같은 Thread에서 이어간다.
- App Server가 제공하는 인증 상태와 Rate Limit 상태를 읽고 401·429·5xx를 처리한다.
- 일시적 제한이 발생해도 품질 단계를 생략하지 않고 대기 후 재개하거나 사용자에게 재시도 상태를 표시한다.
- 모델 응답은 JSON Schema 검증을 통과해야 하며 실패 시 최대 2회 교정 호출을 수행한다.
- 요청 해시, 프롬프트 버전, 모델, 지연 시간, 품질 점수만 기록하고 원문·생성문·OAuth 토큰은 기본 로그에서 제외한다.

### 외부 생성형 도구 범위

| 외부 요소         | MVP 판단                                   |
| ----------------- | ------------------------------------------ |
| Gemini API        | 사용하지 않음                              |
| 로컬 llama-server | 사용하지 않음                              |
| Google Flow       | 영상 참고용 선택 도구, 내부 자동화 제외    |
| Magic Eraser      | 사용자 수동 도구, 내부 자동화 제외         |
| 임베딩·Reranker   | 데이터 축적 후 유사도 고도화 단계에서 검토 |

> 게시·예약 자체에는 LLM이 필요하지 않다. MVP 예약은 Threads 웹 작성 창의 날짜·시간 UI를 사용하고, 서버 자동 예약은 별도의 Threads API·OAuth·Scheduler 영역으로 분리한다.

---

# 7. 편집기 기능

## 7.1 작성 화면 예시

```text
┌───────────────────────────────────────┐
│ 계정: AI 자동화 계정          342/500 │
├───────────────────────────────────────┤
│ [숫자형] [질문형] [공감형] [반전형]   │
├───────────────────────────────────────┤
│                                       │
│ 생성된 Threads 게시물                 │
│                                       │
│                                       │
├───────────────────────────────────────┤
│ Topic Tag: 업무자동화                 │
│ 이미지: 대표이미지.png                │
│ Alt Text: AI 자동화 흐름을 나타낸 도식 │
├───────────────────────────────────────┤
│ 품질 검사                             │
│ ✓ 길이 정상                           │
│ ✓ 중복 문장 없음                      │
│ ⚠ 수치 근거 확인 필요                 │
├───────────────────────────────────────┤
│ [다시 생성] [임시 저장] [예약] [게시] │
└───────────────────────────────────────┘
```

## 7.2 필수 편집 기능

| 기능           | 설명                                |
| -------------- | ----------------------------------- |
| 실시간 글자 수 | Threads 글자 제한 초과 방지         |
| Undo/Redo      | AI 재작성 전 상태 복구              |
| 버전 비교      | 생성된 3~5개 버전 비교              |
| 변경 부분 표시 | AI가 바꾼 문장 강조                 |
| Topic Tag 입력 | 게시물 주제 태그 설정               |
| Alt Text 입력  | 이미지 접근성 설명                  |
| 미리보기       | 실제 Threads와 유사한 카드 미리보기 |
| 금지 표현 표시 | Persona 금지어 자동 강조            |
| 중복 경고      | 기존 게시물과 유사한 경우 경고      |
| 사실 확인 표시 | 숫자·날짜·가격 경고 아이콘          |

---

# 8. 게시 방식

## 8.1 Companion 모드: Threads 작성 화면 전달

```text
게시물 작성
   ↓
“Threads에서 작성하기”
   ↓
공식 게시 작성 화면 열기
   ↓
공식 Intent가 지원되면 미리 채우고, 미지원 시 클립보드·명시적 입력 fallback
   ↓
사용자가 최종 게시 버튼 클릭
```

### 장점

- OAuth 구현 전에도 사용 가능
- 앱 시크릿과 장기 토큰이 필요 없음
- 사용자가 최종 내용을 확인
- Chrome Web Store 심사가 상대적으로 단순
- 1차 MVP를 빠르게 완성 가능

### 단점

- 최종 게시 버튼은 사용자가 눌러야 함
- 브라우저가 종료되면 예약 게시 불가
- 완전 자동화는 아님

---

## 8.2 공식 API 자동 게시

```text
예약 시각 도착
     ↓
Publishing Worker가 Job 확보
     ↓
미디어 Container 생성
     ↓
creation_id 저장
     ↓
Publish 호출
     ↓
게시물 ID 저장
     ↓
성과 수집 예약 생성
```

### 예약 요청 예시

```json
{
  "accountId": "account_01",
  "mediaType": "TEXT",
  "text": "게시할 내용",
  "scheduledAt": "2026-09-05T09:00:00+09:00"
}
```

`scheduledAt`은 자체 예약 Queue가 사용하는 값이며, 예약 시각에 서버가 공식 게시 API를 호출한다.

### 모드별 실행 책임(확정)

| 모드                | 예약 발행 책임                                       |
| ------------------- | ---------------------------------------------------- |
| Companion           | Threads 작성 화면 전달과 사용자 최종 확인까지만 수행 |
| Personal Automation | Ubuntu 서버가 Queue를 기반으로 발행 수행             |
| SaaS                | 서버 클러스터에서 Workspace별 분리 발행 수행         |

> `scheduledAt` 값은 API 호출 스키마에 그대로 전달되지 않을 수 있으므로, 서버가 큐 상태를 기준으로 실제 발행 시각을 결정한다.

---

## 8.3 이미지 게시

이미지는 Threads 측 서버가 접근할 수 있는 공개 HTTPS URL이어야 한다.

```text
Chrome Extension에서 이미지 선택
        ↓
Ubuntu Server로 업로드
        ↓
MinIO 또는 S3 호환 Storage 저장
        ↓
https://media.example.com/threads/abc123.webp
        ↓
Threads API가 이미지 가져감
        ↓
게시 완료 후 보관 정책에 따라 삭제
```

### 권장 서버 구성

```text
media.example.com
├─ Caddy HTTPS
├─ MinIO
└─ 게시용 이미지 임시 URL
```

---

# 9. 예약 Queue

## 9.1 게시 상태

```text
DRAFT
  ↓
REVIEW_REQUIRED
  ↓
APPROVED
  ↓
SCHEDULED
  ↓
PUBLISHING
  ├─ PUBLISHED
  ├─ RETRY_WAIT
  └─ FAILED

모든 단계에서
  → CANCELED
```

## 9.2 예약 화면 예시

```text
┌─────────────────────────────────────────────┐
│ 2026년 9월 5일                              │
├────────┬──────────────────────────┬─────────┤
│ 09:00  │ AI 자동화 입문 글        │ 예약됨  │
│ 12:30  │ 실제 사용 경험            │ 승인대기│
│ 17:00  │ 질문형 게시물             │ 초안    │
│ 21:00  │ GitHub 프로젝트 소개      │ 예약됨  │
└────────┴──────────────────────────┴─────────┘
```

## 9.3 Queue 기능

| ID     | 기능              | 설명                       |
| ------ | ----------------- | -------------------------- |
| QUE-01 | 날짜·시간 지정    | Asia/Seoul 기준 입력       |
| QUE-02 | 계정별 게시 간격  | 최소 간격 설정             |
| QUE-03 | 일일 최대 게시 수 | 사용자 설정 한도           |
| QUE-04 | 드래그 순서 변경  | 시간 슬롯 이동             |
| QUE-05 | 일괄 승인         | 선택 게시물 승인           |
| QUE-06 | 중복 예약 검사    | 동일 콘텐츠·동일 시간 차단 |
| QUE-07 | 실패 재시도       | 지수형 재시도              |
| QUE-08 | Dead Letter       | 반복 실패 게시물 격리      |
| QUE-09 | 전체 Pause        | 신규 게시 즉시 중지        |
| QUE-10 | 게시 전 알림      | 선택적으로 최종 승인 요청  |

### 앱 자체 기본 안전 한도 예시

```text
- 계정당 하루 최대 5개
- 게시물 사이 최소 90분
- 실패 시 최대 3회 재시도
- 같은 Content Hash 24시간 내 재게시 금지
```

이 수치는 앱 자체의 보수적인 기본값이며, 공식 플랫폼 한도와 별도로 운영한다.

---

# 10. 게시 중복 방지

API 요청 도중 네트워크 오류가 발생하면 실제 게시에 성공했지만 서버가 응답을 받지 못해 같은 글을 다시 게시할 수 있다.

```text
실제 게시 성공
     +
서버는 응답을 받지 못함
     ↓
재시도
     ↓
같은 글이 두 번 게시됨
```

## 10.1 Idempotency Key

```text
idempotency_key =
SHA256(account_id + draft_id + scheduled_at)
```

## 10.2 처리 방식

1. Worker가 Job을 가져갈 때 Lease 설정
2. 상태를 `PUBLISHING`으로 변경
3. Container ID를 DB에 먼저 저장
4. 실제 Publish 호출
5. 응답 Post ID 저장
6. 타임아웃 발생 시 최근 게시물과 Content Hash 대조
7. 게시 여부가 확정되지 않으면 자동 재시도하지 않고 `RECONCILE_REQUIRED`로 이동

## 10.3 데이터베이스 제약(권장)

- `publish_jobs.idempotency_key`는 UNIQUE 제약
- 활성 상태(예: `SCHEDULED`, `PUBLISHING`, `RETRY_WAIT`)에서 동일 `draft_id + run_at` 중복 방지 인덱스
- `publish_jobs.lease_owner` + `lease_until` TTL 정책으로 동시 실행 충돌을 방지
- `drafts.content_hash`와 `insight_snapshots`로 반복 콘텐츠/스팸 패턴 탐지
- `attempt_count` 상한 초과 시 Dead Letter 큐 자동 격리

---

# 11. OAuth와 토큰 보안

## 11.1 금지 구조

```text
Chrome Extension
  ├─ Meta App Secret
  ├─ Threads Long-Lived Token
  └─ 모든 계정 토큰 저장
```

확장 프로그램 코드는 사용자가 내려받아 분석할 수 있으므로 App Secret을 안전하게 숨길 수 없다.

## 11.2 권장 OAuth 흐름

```text
1. 확장 프로그램에서 “Threads 연결” 클릭

2. 확장 프로그램
   → Ubuntu 서버 /oauth/threads/start 호출

3. 서버가 state와 일회용 nonce 생성

4. chrome.identity.launchWebAuthFlow 실행

5. 사용자가 로그인 및 권한 승인

6. OAuth 공급자
   → Ubuntu 서버 callback으로 code 전달

7. Ubuntu 서버
   → App Secret으로 token 교환
   → token 암호화 저장

8. 서버
   → 확장 프로그램에 일회용 ticket 전달

9. 확장 프로그램
   → ticket을 ThreadFlow 세션으로 교환

10. 확장 프로그램에는 Threads Token 대신
    ThreadFlow 전용 Session Token만 저장
```

## 11.3 토큰 테이블 예시

```text
threads_accounts
├─ id
├─ workspace_id
├─ threads_user_id
├─ username
├─ access_token_ciphertext
├─ token_expires_at
├─ scopes
├─ connection_status
├─ last_refresh_at
└─ created_at
```

## 11.4 보안 필수 항목

- App Secret은 서버 환경 변수 또는 Secret Manager에 저장
- Access Token은 데이터베이스에 평문 저장 금지
- 토큰 암호화 키와 DB를 분리
- OAuth `state`와 nonce 검증
- Redirect URL 고정
- Workspace별 계정 접근 권한 확인
- 모든 게시·삭제·연결 해제 작업 감사 로그 기록
- 토큰 만료와 재연결 필요 상태를 UI에 표시
- 운영자/개인 사용자 환경 분리(개인 서버: 사전등록 허용 IP, SaaS: 공개 도메인 CORS/도메인 allowlist 강화)
- 감사 로그에는 토큰·비밀번호·민감 본문 미포함(마스킹/해시만 기록)

## 11.5 Meta API 검증 체크리스트(구현 전 필수)

- 발행/조회/리플라이 엔드포인트 권한(scopes) 최신 사양 재확인
- Posting window, rate limit, 에러 코드 분류(속도 제한/권한/정책 위반) 확인
- 미디어 업로드 크기/형식/유효 기간 정책 확인
- Webhook 사용 조건 및 필요한 앱 검수 항목 확인
- 계정 제재 관련 정책 변경 이력 모니터링 주기 수립

---

# 12. 성과 분석

## 12.1 기본 지표

```text
게시 성과
├─ Views
├─ Likes
├─ Replies
├─ Reposts
├─ Quotes
├─ Clicks
└─ Engagement Rate
```

## 12.2 분석 기준

| 기준         | 분석 내용                        |
| ------------ | -------------------------------- |
| Hook 유형    | 숫자형·질문형·반전형별 평균 성과 |
| 콘텐츠 주제  | AI·개발·수익화·여행 등           |
| 글 길이      | 150자·300자·450자 구간           |
| 게시 시간    | 시간대별 평균 조회               |
| CTA 유형     | 질문·저장·링크·팔로우            |
| 미디어       | 텍스트·이미지·Carousel           |
| 계정 Persona | 계정별 잘되는 말투               |
| 작성 방식    | 직접 작성·AI 초안·AI 재작성      |

## 12.3 내부 성과 점수 예시

```text
Performance Score =
Views × 0.15
+ Likes × 1
+ Replies × 3
+ Reposts × 4
+ Quotes × 5
+ Clicks × 2
```

위 가중치는 공식 기준이 아니라 사용자가 조정할 수 있는 내부 평가식이다.

## 12.4 성과 화면 예시

```text
┌────────────────────────────────────────┐
│ 최근 30일 성과                         │
├────────────────────────────────────────┤
│ 게시물        68개                     │
│ 총 조회       154,200                  │
│ 평균 Reply    8.7                      │
│ 최고 Hook     숫자형                   │
│ 최고 시간대   20:00~22:00             │
├────────────────────────────────────────┤
│ AI 추천                                 │
│ “경험형 본문 + 숫자형 첫 문장의         │
│ 24시간 평균 조회가 가장 높습니다.”      │
│                                         │
│ [다음 생성 규칙에 적용]                 │
└────────────────────────────────────────┘
```

---

# 13. 댓글 및 Reply 관리

댓글 자동화는 첫 MVP에 넣지 않고 P2 단계로 둔다.

| ID     | 기능                 | 자동화 수준 |
| ------ | -------------------- | ----------- |
| ENG-01 | 새 Reply 모아보기    | 자동        |
| ENG-02 | 긍정·질문·불만 분류  | 자동        |
| ENG-03 | 답글 초안 3개 생성   | 자동        |
| ENG-04 | 사용자 승인 후 답글  | 반자동      |
| ENG-05 | 위험 댓글 경고       | 자동        |
| ENG-06 | 반복 홍보 계정 표시  | 자동        |
| ENG-07 | 멘션 알림            | 자동        |
| ENG-08 | 특정 키워드 우선순위 | 자동        |

### 원칙

- 댓글은 AI가 초안을 만들되 기본값은 사용자 승인 후 게시
- 자동 좋아요, 자동 팔로우, 무작위 자동 댓글 기능은 제공하지 않음
- 민감한 댓글은 AI가 자동 게시하지 않고 검토 Queue로 이동

---

# 14. Chrome Extension 화면 구성

## 14.1 Side Panel

상단 탭은 다음 네 개로 단순화한다.

```text
[분석] [작성] [대기열] [성과]
```

### 분석 탭

```text
현재 게시물
├─ 원문
├─ Hook
├─ 구조
├─ CTA
├─ 위험 표현
└─ “새 글 만들기”
```

### 작성 탭

```text
Persona
Hook 유형
본문 Editor
글자 수
Topic Tag
이미지·Alt Text
품질 검사
저장·예약·게시
```

### 대기열 탭

```text
오늘
내일
이번 주
실패
승인 대기
```

### 성과 탭

```text
계정 요약
상위 게시물
주제별 성과
Hook별 성과
시간대 분석
AI 개선 추천
```

## 14.2 Popup

Popup을 별도의 복잡한 화면으로 만들지 않고 확장 아이콘 클릭 시 Side Panel을 연다.

```ts
chrome.sidePanel.setPanelBehavior({
  openPanelOnActionClick: true,
});
```

## 14.3 Options 페이지

```text
계정 연결
Persona 관리
Codex 연결·로그아웃
Codex Gateway 주소
서버 주소
예약 기본값
콘텐츠 금지어
데이터 보존 기간
내보내기·삭제
개인정보 처리방침
```

---

# 15. Manifest V3 권한 설계

```json
{
  "manifest_version": 3,
  "name": "ThreadFlow OS",
  "version": "0.1.0",
  "description": "Threads 콘텐츠 분석, 작성 및 예약 게시 도우미",
  "permissions": ["sidePanel", "storage", "contextMenus"],
  "host_permissions": ["https://www.threads.com/*"],
  "optional_host_permissions": [
    "http://127.0.0.1:8787/*",
    "https://api.example.com/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "content_scripts": [
    {
      "matches": ["https://www.threads.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_title": "ThreadFlow 열기"
  }
}
```

> `api.example.com`은 공식 API 자동 발행 단계의 실제 배포 도메인으로 치환한다. Companion MVP는 Threads와 localhost Codex Gateway만 사용한다. Threads OAuth에서 `chrome.identity`가 실제로 필요한 경우에만 해당 단계 Manifest에 추가한다.

## 사용하지 않을 권한

```text
cookies
history
bookmarks
webRequest
webRequestBlocking
<all_urls>
downloads
management
```

## Manifest V3 개발 원칙

- 원격 JavaScript 다운로드 및 실행 금지
- `eval` 또는 동적 코드 실행 금지
- AI가 반환한 내용은 데이터로만 처리
- 최소 권한 원칙 적용
- 개인정보 처리방침 제공
- 확장 프로그램의 단일 목적을 명확히 유지

## 15.1 Chrome 심사 대응 체크리스트

- `contextMenus`가 실제 배포 기능에 포함될 때만 사용 이유를 UI 워크플로우와 매핑해 명시
- 백그라운드에서 비동기 수집/자동 게시를 수행하지 않음을 문서와 UX로 분명히 고지
- 네트워크 대상 도메인 목록은 실제 사용 범위만 최소화

---

# 16. 확장 프로그램 저장소 구조

| 저장소                   | 데이터                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `chrome.storage.sync`    | 테마·간단한 사용자 옵션                                          |
| `chrome.storage.local`   | 서버 주소·현재 계정·기능 설정                                    |
| `chrome.storage.session` | 현재 탭 분석 상태·짧은 수명의 Gateway 세션 핸들(OAuth 토큰 제외) |
| IndexedDB                | 오프라인 초안·참고 자료·생성 버전                                |
| 서버 DB                  | 계정·예약 Queue·게시 결과·Insights                               |
| 서버 암호화 저장         | Threads Access Token                                             |

대량의 게시물·참고 자료는 `chrome.storage.local`보다 IndexedDB를 사용한다. 서버 연결 모드에서는 서버 DB를 최종 원본으로 둔다.

---

# 17. 데이터 모델

## 17.1 주요 테이블

```text
workspaces
threads_accounts
personas
source_posts
drafts
draft_versions
media_assets
publish_jobs
published_posts
insight_snapshots
reply_items
prompt_templates
audit_logs
```

## 17.2 drafts

```text
drafts
├─ id
├─ workspace_id
├─ account_id
├─ persona_id
├─ source_post_id
├─ text
├─ topic_tag
├─ reply_control
├─ status
├─ content_hash
├─ scheduled_at_utc
├─ display_timezone
├─ approved_at
├─ approved_by
├─ created_at
└─ updated_at
```

## 17.3 publish_jobs

```text
publish_jobs
├─ id
├─ draft_id
├─ run_at
├─ status
├─ attempt_count
├─ max_attempts
├─ lease_owner
├─ lease_until
├─ idempotency_key
├─ threads_creation_id
├─ threads_post_id
├─ last_error_code
├─ last_error_message
├─ next_retry_at
├─ created_at
└─ updated_at
```

## 17.4 insight_snapshots

```text
insight_snapshots
├─ id
├─ published_post_id
├─ captured_at
├─ views
├─ likes
├─ replies
├─ reposts
├─ quotes
├─ clicks
└─ raw_payload
```

---

# 18. 서버 API 설계

```text
인증
POST /v1/oauth/threads/start
GET  /v1/oauth/threads/callback
POST /v1/oauth/threads/complete
POST /v1/oauth/threads/disconnect

계정
GET  /v1/accounts
GET  /v1/accounts/:id/status
POST /v1/accounts/:id/refresh

Persona
GET    /v1/personas
POST   /v1/personas
PATCH  /v1/personas/:id
DELETE /v1/personas/:id

참고 자료
POST   /v1/sources
GET    /v1/sources
DELETE /v1/sources/:id

초안
POST  /v1/drafts
GET   /v1/drafts
GET   /v1/drafts/:id
PATCH /v1/drafts/:id
POST  /v1/drafts/:id/approve
POST  /v1/drafts/:id/cancel

예약
POST /v1/jobs
GET  /v1/jobs
PATCH /v1/jobs/:id
POST /v1/jobs/:id/publish-now
POST /v1/jobs/:id/retry
POST /v1/jobs/pause-all

성과
GET  /v1/insights/summary
GET  /v1/insights/posts
POST /v1/insights/sync

Webhook
GET  /v1/webhooks/threads
POST /v1/webhooks/threads
```

---

# 19. 추천 기술 스택

## 19.1 Monorepo

```text
pnpm workspace
├─ apps
│  ├─ extension
│  ├─ codex-gateway
│  └─ server
├─ packages
│  ├─ contracts
│  ├─ database
│  ├─ prompt-kit
│  ├─ quality-engine
│  ├─ codex-provider
│  ├─ threads-client
│  └─ shared
└─ infra
   ├─ docker
   └─ caddy
```

## 19.2 Chrome Extension

| 영역        | 추천 기술           |
| ----------- | ------------------- |
| Framework   | WXT                 |
| UI          | React + TypeScript  |
| 상태 관리   | Zustand             |
| 서버 상태   | TanStack Query      |
| 검증        | Zod                 |
| 로컬 DB     | Dexie / IndexedDB   |
| 스타일      | Tailwind CSS        |
| 테스트      | Vitest + Playwright |
| Drag & Drop | dnd-kit             |

## 19.3 Ubuntu 서버

| 영역          | 추천 기술            |
| ------------- | -------------------- |
| Runtime       | Node.js + TypeScript |
| API           | Fastify              |
| ORM           | Drizzle ORM          |
| 개인용 DB     | SQLite               |
| 확장형 DB     | PostgreSQL           |
| 예약 Worker   | DB Lease 기반 Worker |
| 파일 저장     | MinIO                |
| Reverse Proxy | Caddy                |
| 로그          | Pino                 |
| 배포          | Docker Compose       |

## 초기 단계에서 불필요한 기술

```text
Kubernetes
Kafka
Redis Cluster
Microservices
복잡한 Event Bus
```

개인 사용 단계에서는 Fastify + SQLite + Worker 하나로 충분하다. 다계정 SaaS 전환 시 PostgreSQL을 사용하고 Publisher Worker와 Insight Worker를 분리한다.

---

# 20. 프로젝트 디렉터리 구조

```text
threadflow-os/
├─ apps/
│  ├─ extension/
│  │  ├─ entrypoints/
│  │  │  ├─ background.ts
│  │  │  ├─ threads.content.ts
│  │  │  ├─ sidepanel/
│  │  │  │  ├─ index.html
│  │  │  │  ├─ App.tsx
│  │  │  │  └─ routes/
│  │  │  └─ options/
│  │  ├─ features/
│  │  │  ├─ account/
│  │  │  ├─ capture/
│  │  │  ├─ analyzer/
│  │  │  ├─ composer/
│  │  │  ├─ queue/
│  │  │  └─ insights/
│  │  ├─ lib/
│  │  │  ├─ codex-gateway.ts
│  │  │  ├─ api-client.ts
│  │  │  └─ messaging.ts
│  │  └─ storage/
│  │
│  ├─ codex-gateway/
│  │  ├─ src/
│  │  │  ├─ auth/
│  │  │  ├─ orchestrator/
│  │  │  ├─ quality/
│  │  │  └─ app.ts
│  │  └─ package.json
│  │
│  └─ server/
│     ├─ src/
│     │  ├─ modules/
│     │  │  ├─ auth/
│     │  │  ├─ accounts/
│     │  │  ├─ drafts/
│     │  │  ├─ publisher/
│     │  │  ├─ scheduler/
│     │  │  ├─ insights/
│     │  │  └─ webhooks/
│     │  ├─ workers/
│     │  └─ app.ts
│     └─ Dockerfile
│
├─ packages/
│  ├─ contracts/
│  ├─ database/
│  ├─ prompt-kit/
│  ├─ quality-engine/
│  ├─ codex-provider/
│  ├─ threads-client/
│  └─ shared/
│
├─ infra/
│  ├─ docker-compose.yml
│  └─ Caddyfile
│
├─ .env.example
├─ pnpm-workspace.yaml
└─ README.md
```

---

# 21. DOM 변경 대응

Threads 웹페이지의 HTML 구조는 바뀔 수 있으므로 특정 CSS 클래스 이름에 강하게 의존하지 않는다.

## 권장 방식

```text
1. 사용자가 게시물 메뉴 또는 텍스트를 직접 선택
2. 선택된 요소에서 가장 가까운 article 탐색
3. role·aria-label·semantic element 우선 사용
4. URL과 사용자 선택 텍스트를 핵심 데이터로 사용
5. DOM 파싱 실패 시 “텍스트 직접 붙여넣기” 제공
```

### Adapter 인터페이스

```ts
interface ThreadsPageAdapter {
  getCurrentPost(): Promise<CapturedPost | null>;
  getSelectedText(): string | null;
  getCurrentPostUrl(): string | null;
  isSupportedPage(): boolean;
}
```

### 디렉터리 예시

```text
threads-adapter/
├─ selectors-v1.ts
├─ extract-post.ts
├─ extract-author.ts
├─ extract-url.ts
└─ fixtures/
```

DOM 추출 코드는 전체 기능과 분리해, Threads 화면이 바뀌어도 Adapter만 수정하도록 한다.

---

# 22. 제외해야 할 기능

| 제외 기능                     | 이유                       |
| ----------------------------- | -------------------------- |
| 자동 팔로우                   | 스팸·부정 활동 위험        |
| 자동 좋아요                   | 비정상 참여 조작 위험      |
| 무작위 자동 댓글              | 계정 품질 하락과 스팸 위험 |
| 로그인 Cookie 추출            | 보안·정책 위험             |
| 비공개 GraphQL 직접 호출      | 변경·차단·약관 위험        |
| Captcha 우회                  | 명백한 위험 기능           |
| Threads 전체 피드 크롤링      | 자동 수집 제한 위험        |
| 수백 계정 프록시 운영         | 계정 무결성 위험           |
| 사람처럼 보이게 랜덤 클릭     | 탐지 회피 목적             |
| 게시 결과 조작                | 서비스 무결성 훼손         |
| 외부 AI 웹화면 무단 자동 조작 | 불안정하고 계정 정책 위험  |

## 허용할 핵심 자동화

```text
사용자가 선택한 자료 분석
원본과 다른 신규 글 작성
예약 Queue
공식 API 게시
공식 Insights 수집
Reply 초안 생성
사용자 승인 및 감사 로그
```

---

# 23. 구현 단계

## 23.1 1단계: Companion MVP

```text
P0 기능
├─ WXT 기반 Chrome Extension
├─ Threads Side Panel
├─ 현재 게시물 또는 선택 텍스트 가져오기
├─ Persona 설정
├─ Codex OAuth Provider Proxy 연결
├─ 구조 분석·전략 수립
├─ 서로 다른 글 후보 3~5개 생성
├─ Critic·Ranker·최종 개선
├─ 글자 수 제한 편집기
├─ 유사도·근거·금지 표현 검사
├─ IndexedDB 초안 저장
└─ Threads 작성·기본 예약 UI를 통한 사용자 확인 게시
```

### 1단계 목표

Threads API 백엔드 없이 다음 흐름을 완성한다. 단, AI 생성에는 Codex ChatGPT OAuth 로그인이 필요하다.

```text
선택 → 분석 → 후보 생성 → 비평 → 개선 → 검수 → 편집 → 사용자 확인 게시·예약
```

---

## 23.2 2단계: 개인용 자동 게시

```text
P1 기능
├─ Ubuntu Fastify 서버
├─ Threads OAuth
├─ 암호화 토큰 저장
├─ 텍스트 자동 게시
├─ DB 기반 Scheduler
├─ 예약 실패 재시도
├─ Idempotency
├─ 게시 로그
├─ 토큰 갱신
├─ 게시 한도 확인
└─ 전체 Pause
```

브라우저와 Mac이 꺼져 있어도 Ubuntu 서버가 예약 시각에 작업을 실행하도록 한다.

---

## 23.3 3단계: 콘텐츠 운영 OS

```text
P2 기능
├─ 여러 Threads 계정
├─ 이미지·동영상·Carousel
├─ 공식 키워드 검색
├─ Insights 자동 수집
├─ Hook·주제·시간대 성과 분석
├─ Reply 관리
├─ Mention Webhook
├─ 성과 기반 AI 추천
├─ 콘텐츠 캘린더
└─ JSON·CSV 내보내기
```

---

## 23.4 4단계: 일반 사용자 배포

```text
P3 기능
├─ Meta 앱 검수
├─ Chrome Web Store 등록
├─ 사용자별 Workspace
├─ Tenant 데이터 분리
├─ 팀 역할과 권한
├─ 사용자별 암호화 키
├─ 토큰 예산 없는 품질 우선 정책
├─ 개인정보 삭제 요청
├─ 감사 로그
├─ 장애 모니터링
└─ 구독·결제
```

---

# 24. MVP 완료 기준

## 24.1 Companion MVP 완료 기준

1. Threads.com에서 확장 아이콘을 누르면 Side Panel이 열린다.
2. 사용자가 선택한 게시물만 가져올 수 있다.
3. 원문·작성자·URL을 참고 자료로 저장할 수 있다.
4. Codex ChatGPT OAuth 연결 상태를 확인하고 안전하게 로그아웃할 수 있다.
5. Codex로 Hook·구조·독자·CTA를 분석할 수 있다.
6. Persona에 맞는 서로 다른 글 후보를 3~5개 생성할 수 있다.
7. 후보별 품질 점수와 Critic 평가 후 최종 개선안을 생성한다.
8. 글자 수 초과와 금지 표현을 표시한다.
9. 원문과 지나치게 유사한 문장을 경고한다.
10. 숫자·가격·수익 주장에 근거가 없으면 검토를 요구한다.
11. 브라우저를 재시작해도 승인 전 초안이 남아 있다.
12. Threads 작성 화면으로 전달하고 기본 예약 UI를 사용할 수 있다.
13. 사용자의 최종 확인 없이 댓글·좋아요·팔로우를 수행하지 않는다.
14. 데이터 전체 내보내기와 삭제가 가능하다.

## 24.2 API 자동 게시 버전 완료 기준

1. App Secret이 확장 프로그램에 포함되지 않는다.
2. Threads 장기 토큰이 서버에서 암호화된다.
3. 브라우저를 닫아도 Ubuntu 서버에서 예약이 실행된다.
4. 동일 Job이 중복 게시되지 않는다.
5. 토큰 만료와 게시 한도가 화면에 표시된다.
6. 실패한 게시물은 자동 재시도 후 격리된다.
7. 계정별 자동 게시를 즉시 중지할 수 있다.
8. 게시 결과와 Post ID가 감사 로그에 남는다.
9. 토큰 갱신 실패 및 API 정책 위반 에러를 사용자에게 알리고, 발행이 자동 중단된다.
10. 미디어 URL 만료/만료 임박 경고 시 재생성 및 교체가 가능하다.

---

# 25. 권장 테스트 항목

## 25.1 Extension 테스트

- Threads 게시물 텍스트 추출 성공 여부
- DOM 구조 변경 시 fallback 동작
- 선택 텍스트만 가져오는지 확인
- Side Panel 상태 유지
- Codex OAuth 로그인·로그아웃·만료 처리
- Codex Gateway 연결 실패 처리
- App Server Rate Limit·401·429·5xx 처리
- 모델 응답 JSON 검증
- 후보 생성·Critic·최종 개선 단계 회귀 테스트
- Prompt 버전별 Golden Set 품질 비교
- 500자 초과 표시
- IndexedDB 저장 및 복원
- Threads 작성 화면 전달과 클립보드 fallback
- 권한 거부 시 안내 처리

## 25.2 서버 테스트

- OAuth state 검증
- 토큰 암호화 및 복호화
- 예약 시간대 UTC 변환
- Worker Lease 충돌 방지
- 같은 Job 중복 실행 방지
- API Timeout 발생 후 상태 조정
- 토큰 만료 및 갱신 실패 처리
- 게시 실패 재시도
- 전체 Pause 처리
- 사용자 간 Workspace 데이터 분리

## 25.3 운영 테스트

- Mac 종료 상태에서 Ubuntu 예약 게시
- 네트워크 단절 후 복구
- 이미지 URL 만료 전 게시 완료
- 일일 자체 한도 적용
- 동일 문장 반복 차단
- 민감 콘텐츠 검토 Queue 이동
- 데이터 내보내기와 전체 삭제

---

# 26. 최종 추천 구성

```text
Mac mini M4
├─ Chrome Extension 개발
├─ Codex Provider Gateway
├─ Codex App Server
├─ ChatGPT OAuth 구독 인증
└─ 다중 후보 생성·비평·개선

기존 Ubuntu 서버
├─ Fastify API
├─ SQLite → 이후 PostgreSQL
├─ Threads OAuth
├─ 암호화 Token Vault
├─ Scheduler Worker
├─ MinIO
├─ Caddy HTTPS
└─ Insights Collector

Threads
├─ 1차: Threads 작성 화면 기반 사용자 확인 게시·예약
└─ 2차: 공식 API 자동 게시
```

## 최종 개발 우선순위

```text
1. Side Panel UI
2. 사용자가 선택한 게시물 가져오기
3. Codex OAuth Provider Proxy 연결
4. Persona와 Prompt Contract
5. 분석 → 후보 3~5개 → Critic → 최종 개선
6. 편집·유사도·근거·정책 검사
7. Threads 작성·기본 예약 UI 연결
8. Ubuntu 예약 Queue
9. Threads OAuth와 공식 API 게시
10. 성과 수집
11. 다계정과 Reply 관리
```

---

# 27. 결론

이 프로젝트의 핵심은 **Threads 화면을 자동으로 클릭하는 프로그램**이 아니라 다음 전체 과정을 하나로 묶는 것이다.

```text
콘텐츠 조사
→ 구조 분석
→ Persona 기반 신규 작성
→ 사용자 검수
→ 예약 Queue
→ 공식 방식 게시
→ 성과 수집
→ 다음 콘텐츠 개선
```

첫 배포 버전은 다음 구성이 가장 현실적이다.

> **Codex OAuth Provider Proxy + 품질 파이프라인 + 사용자 승인형 Chrome Extension**

완성형은 다음 구조로 확장한다.

> **Codex OAuth Provider Proxy + Ubuntu Scheduler + Threads 공식 API + Insights 분석**

이 방식은 단순 게시 자동화보다 안정적이고, 향후 X, 네이버 블로그, 워드프레스 등 다른 채널까지 확장하기에도 적합하다.

---

# 28. 참고 문서

- Chrome Extensions 공식 문서: https://developer.chrome.com/docs/extensions/
- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome Identity API: https://developer.chrome.com/docs/extensions/reference/api/identity
- Chrome Storage API: https://developer.chrome.com/docs/extensions/reference/api/storage
- Chrome Web Store 정책: https://developer.chrome.com/docs/webstore/program-policies
- Meta Threads 개발 문서: https://developers.facebook.com/documentation/threads
- OpenAI Codex 인증 문서: https://learn.chatgpt.com/docs/auth
- OpenAI Codex App Server 문서: https://learn.chatgpt.com/docs/app-server
- 최종 개발 제안서: docs/threadflow_os_final_proposal.md
- 전체 개발 계획: dev-plan/implement_20260904_183303.md
- WXT: https://github.com/wxt-dev/wxt
- 전문가 검토 노트: docs/threads_automation_expert_review_notes.md
