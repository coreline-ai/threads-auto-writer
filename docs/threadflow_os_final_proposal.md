# ThreadFlow OS 최종 개발 제안서

- **버전:** v1.1
- **작성일:** 2026-09-04
- **제품 가칭:** ThreadFlow OS
- **핵심 결정:** Gemini·로컬 LLM 대신 **Codex OAuth Provider Proxy + ChatGPT 구독 인증**을 기본 생성 엔진으로 사용
- **최우선 가치:** 토큰 절감이 아니라 좋은 글의 품질, 독창성, 근거성, Persona 일치

---

## 1. 최종 결론

ThreadFlow OS는 영상 속 `바이럴훅 라이트`의 단순 복제보다 다음 방향으로 개발한다.

> **Threads 우측 보조 패널에서 참고 글을 선택하고, Codex가 여러 단계로 분석·초안·비평·개선한 뒤, 사용자가 최종 승인하여 Threads 기본 작성·예약 UI로 넘기는 품질 중심 글쓰기 도구**

MVP에서는 게시 자동화보다 **좋은 글 작성 경험**에 집중한다. 자체 Scheduler와 Threads 공식 API 자동 발행은 글쓰기 품질과 사용자 흐름이 검증된 이후 2단계로 진행한다.

### 최종 제품 원칙

1. 글 한 번 생성으로 끝내지 않고 `분석 → 후보 생성 → 비평 → 개선 → 검수`를 수행한다.
2. 앱 차원의 토큰 예산과 글당 토큰 제한을 두지 않는다.
3. 긴 입력을 무조건 누적하지 않고 작업별 문맥을 정리해 품질 저하를 방지한다.
4. 참고 글의 문장을 바꿔 쓰는 것이 아니라 성공 구조만 추출하고 내용은 새로 만든다.
5. 숫자·가격·효능·수익 주장은 근거가 없으면 자동으로 경고한다.
6. 최종 게시와 예약은 사용자가 확인한 후 실행한다.
7. Codex OAuth 자격 증명은 확장 프로그램과 Threads DOM에 노출하지 않는다.

---

## 2. 확인된 영상 GUI와 제품 범위

원본 영상에서 다음 사용자 흐름을 직접 확인했다.

```text
Threads 게시물 선택
  → 우측 보조 패널
  → 원본 글 선택
  → 글 유형·변형 강도 선택
  → AI 글 생성
  → 링크·이미지 적용
  → Threads 작성 창으로 전달
  → 즉시 게시 또는 Threads 기본 예약 UI 사용
```

영상과 신규 제품의 경계는 다음과 같다.

| 구분           | 영상에서 확인                      | ThreadFlow OS 최종안            |
| -------------- | ---------------------------------- | ------------------------------- |
| 제품명         | 바이럴훅 라이트                    | ThreadFlow OS(가칭)             |
| LLM            | Gemini API 키                      | Codex OAuth Provider Proxy      |
| UI             | 우측 보라색 보조 패널              | 우측 보조 패널 중심으로 재설계  |
| 생성           | 단일 변형 중심                     | 다중 후보·비평·개선 파이프라인  |
| 이미지         | Google Flow·Magic Eraser 수동 사용 | MVP는 파일 첨부·Alt Text만 제공 |
| 예약           | Threads 기본 날짜·시간 UI          | MVP는 동일 방식 사용            |
| 다계정         | 홍보 내용만 확인                   | MVP 제외, 2단계 설계            |
| 자체 Scheduler | 확인되지 않음                      | 2단계에서 공식 API 기반 구현    |

영상 화면만으로 우측 패널이 Chrome `sidePanel` API인지 Threads DOM에 삽입된 패널인지는 확정할 수 없다. 신규 구현은 유지보수성과 페이지 격리를 위해 `sidePanel` API를 우선하고, Threads 글 선택 버튼만 Content Script로 제공한다.

---

## 3. 최종 시스템 아키텍처

```text
┌──────────────────────────────────────────────┐
│ Chrome Extension                             │
│                                              │
│ Content Script          Side Panel           │
│ - 선택 글 추출          - Persona/목적 선택  │
│ - 게시물 URL/본문 전달  - 생성 진행 표시     │
│ - 작성창 전달           - 후보 비교·편집     │
└──────────────┬───────────────────────────────┘
               │ localhost session
               ▼
┌──────────────────────────────────────────────┐
│ Codex Provider Gateway                       │
│ - Origin/세션 검증                           │
│ - Prompt Orchestrator                        │
│ - Quality Pipeline                           │
│ - JSON Schema 검증                           │
│ - 감사 로그 마스킹                          │
└──────────────┬───────────────────────────────┘
               │ JSON-RPC / local transport
               ▼
┌──────────────────────────────────────────────┐
│ Codex App Server                             │
│ - ChatGPT OAuth 로그인                       │
│ - 구독 기반 Codex 사용                       │
│ - Thread/Turn 실행·스트리밍                  │
└──────────────────────────────────────────────┘

사용자 승인 완료 초안
               │
               ├─ MVP: Threads 웹 작성·예약 UI
               └─ 2단계: Ubuntu Scheduler → Threads 공식 API
```

### 권장 배치

- `Codex Provider Gateway`와 `Codex App Server`는 사용자 PC의 `127.0.0.1`에서 실행한다.
- 확장 프로그램은 OAuth 토큰을 직접 읽거나 저장하지 않는다.
- Ubuntu 서버에는 AI 자격 증명이 아니라 **승인 완료된 게시 초안**만 전송한다.
- 원격 Provider Proxy가 필요하면 TLS, 사용자별 세션, 접근 제어를 적용하며 운영자 구독 계정을 여러 사용자에게 공유하지 않는다.

OpenAI 공식 문서상 Codex는 ChatGPT 로그인 기반 구독 접근을 지원하고, App Server는 인증·대화·스트리밍 이벤트를 제품에 통합하는 공식 인터페이스다. [인증 문서](https://learn.chatgpt.com/docs/auth), [Codex App Server 문서](https://learn.chatgpt.com/docs/app-server)

---

## 4. Codex OAuth Provider Proxy 설계

### 인증 흐름

```text
사용자: Codex 연결
  → Gateway가 App Server 로그인 시작
  → ChatGPT OAuth 브라우저 인증
  → App Server가 인증 상태와 갱신 관리
  → Gateway는 연결 상태만 Extension에 반환
```

### 보안 규칙

1. Codex OAuth Access/Refresh Token을 Extension, IndexedDB, ThreadFlow 서버 DB에 복사하지 않는다. 공식 API용 Threads User Access Token은 별도 Scheduler Vault에만 암호화 저장한다.
2. App Server 자격 증명 저장은 OS Keyring 우선으로 구성한다.
3. Gateway는 `127.0.0.1`에만 바인딩하고 설치별 랜덤 세션 시크릿을 사용한다.
4. 허용된 Extension Origin만 요청할 수 있도록 Origin 검증을 적용한다.
5. 프롬프트 원문과 생성 글은 기본적으로 로그에 남기지 않고 메타데이터만 기록한다.
6. 로그에는 모델, 프롬프트 버전, 지연 시간, 결과 상태, 품질 점수만 저장한다.
7. 로그아웃·세션 만료·401 발생 시 생성 요청을 중단하고 재연결 UI를 표시한다.

### 사용량 정책

- 제품 내부의 `maxTokensPerDay`, 글당 토큰 예산, 비용 절약 모드는 두지 않는다.
- 다만 서비스 상태와 일시적인 호출 제한은 별개이므로 `account/rateLimits/read`, Rate Limit 이벤트, 401·429·5xx를 처리한다.
- Rate Limit 발생 시 품질 단계를 생략하지 않고 대기 후 재개하거나 사용자에게 재시도 시점을 안내한다.
- 인증·사용량 상태를 정확히 알 수 없을 때 무제한으로 가정하지 않고 상태를 `UNKNOWN`으로 표시한다.

---

## 5. 좋은 글을 위한 Quality Pipeline

토큰 제한이 없다는 장점은 한 번에 긴 프롬프트를 보내는 데 쓰기보다 **역할이 분리된 반복 개선**에 사용한다.

### 5.1 단계별 생성

```text
1. Source Analyst
   참고 글의 주제·독자·Hook·전개·감정·CTA 구조 분석

2. Strategy Writer
   Persona와 게시 목적에 맞는 신규 글 전략 수립

3. Candidate Generator
   서로 다른 접근의 후보 3~5개 생성

4. Critic & Ranker
   후보별 품질 점수·약점·표절성·근거 위험 평가

5. Final Rewriter
   상위 후보의 장점을 결합해 최종 초안 작성

6. Compliance Checker
   숫자·가격·수익·제휴·금지 표현·과장 문구 검사

7. Human Review
   변경 부분과 경고를 표시하고 사용자 승인
```

### 5.2 품질 점수

| 평가 항목      | 배점 | 핵심 기준                                       |
| -------------- | ---: | ----------------------------------------------- |
| 첫 문장·Hook   |   20 | 즉시 이해되고 다음 문장을 읽게 하는가           |
| 독창성         |   20 | 원문 표현을 모방하지 않고 새로운 관점인가       |
| 명확성·가독성  |   15 | 짧고 자연스러우며 모바일에서 읽기 쉬운가        |
| Persona 일치   |   15 | 계정의 어조·독자·금지 표현과 일치하는가         |
| 근거성         |   15 | 숫자·사실·주장에 근거 또는 경고가 있는가        |
| 전개·CTA       |   10 | 흐름이 자연스럽고 반응 유도가 억지스럽지 않은가 |
| 정책·광고 표시 |    5 | 제휴·광고·과장 위험이 처리됐는가                |

- 기본 통과점수: `80/100`
- 근거 없는 숫자·가격·수익 주장이 있으면 점수와 관계없이 `REVIEW_REQUIRED`
- 원문과 핵심 구절 중복이 기준치를 넘으면 자동 재작성
- 점수와 판정 근거는 사용자에게 표시하되 모델의 내부 추론 원문은 노출하지 않는다.

### 5.3 생성 모드

| 모드         | 동작                                                        |
| ------------ | ----------------------------------------------------------- |
| 새 글 만들기 | 참고 글의 구조만 활용해 새로운 주제·사례로 작성             |
| 내 글 다듬기 | 사용자의 핵심 내용은 유지하고 Hook·전개·문장 개선           |
| 쇼핑·제휴 글 | 제품 정보와 사용자 근거를 바탕으로 광고 표시 포함 초안 작성 |
| 짧게 재작성  | 의미를 유지하며 압축                                        |
| 다른 관점    | 반론·경험·체크리스트·질문형 등 새로운 프레임으로 작성       |

---

## 6. 최종 GUI 제안

영상처럼 Threads를 보면서 작업할 수 있는 우측 패널을 유지하되, 기능을 과도하게 노출하지 않는다.

```text
┌──────────────────────────────┐
│ ThreadFlow OS     Codex 연결됨 │
├──────────────────────────────┤
│ 1. 참고 글                    │
│ [현재 글 가져오기] [붙여넣기] │
├──────────────────────────────┤
│ 2. 작성 목적                  │
│ [새 글] [다듬기] [쇼핑/제휴]  │
│ Persona: 직장인 AI 계정       │
│ 변형: [새롭게] [일부 유지]    │
├──────────────────────────────┤
│ 3. 품질 생성                  │
│ 분석 ✓ 후보 5개 ✓ 비평 중…   │
├──────────────────────────────┤
│ 4. 후보 비교                  │
│ A 88점  B 84점  C 79점       │
│ [최종안 만들기]               │
├──────────────────────────────┤
│ 5. 최종 검수                  │
│ 독창성 ✓ Persona ✓            │
│ 수익 주장 ⚠ 확인 필요         │
├──────────────────────────────┤
│ [임시 저장] [Threads로 보내기]│
└──────────────────────────────┘
```

### 핵심 화면

1. **Codex 연결:** 연결 상태, 로그인, 로그아웃만 제공
2. **참고 글:** 현재 게시물 선택, URL 입력, 직접 붙여넣기
3. **작성 설정:** Persona, 목적, 관점, 길이, CTA
4. **생성 진행:** 현재 품질 단계와 재시도 상태
5. **후보 비교:** 후보별 점수와 차이점
6. **편집기:** 수정, Undo/Redo, AI 변경 부분 표시
7. **최종 검수:** 근거·유사도·금지 표현·광고 표시
8. **게시 전달:** Threads 작성 창에 내용·이미지를 채우고 사용자가 즉시/예약 선택

---

## 7. 데이터 모델

```text
Persona
├─ id
├─ audience
├─ voiceRules
├─ bannedPhrases
├─ evidencePolicy
└─ ctaRules

GenerationJob
├─ id
├─ sourceSnapshot
├─ personaId
├─ intent
├─ promptVersion
├─ status
├─ qualityMode
└─ createdAt

DraftCandidate
├─ id
├─ generationJobId
├─ content
├─ scores
├─ riskFlags
├─ similarity
└─ rank

FinalDraft
├─ id
├─ generationJobId
├─ content
├─ userEdits
├─ approvalStatus
└─ publishIntent
```

OAuth 토큰은 이 데이터 모델에 포함하지 않는다.

---

## 8. 추천 Monorepo 구조

```text
threadflow-os/
├─ apps/
│  ├─ extension/
│  ├─ codex-gateway/
│  └─ scheduler-server/       # 2단계
├─ packages/
│  ├─ contracts/
│  ├─ prompt-kit/
│  ├─ quality-engine/
│  ├─ codex-provider/
│  ├─ threads-adapter/
│  └─ shared/
├─ evals/
│  ├─ fixtures/
│  ├─ rubrics/
│  └─ regression/
└─ docs/
```

### 핵심 로컬 API

```text
GET  /v1/auth/status
POST /v1/auth/login
POST /v1/auth/logout

POST /v1/generations
GET  /v1/generations/:id
GET  /v1/generations/:id/events
POST /v1/generations/:id/revise
POST /v1/generations/:id/finalize

GET  /v1/personas
POST /v1/personas
PATCH /v1/personas/:id
```

생성 결과는 JSON Schema로 검증하고 진행 상태는 SSE 또는 Port 메시지로 스트리밍한다.

---

## 9. 개발 단계

### Phase 1 — 품질 중심 MVP

- Chrome Side Panel과 Threads 게시물 선택
- Codex App Server OAuth 로그인
- Codex Provider Gateway
- Persona 관리
- 후보 3~5개 생성
- Critic·Ranker·최종 개선
- 유사도·근거·금지 표현 검사
- Threads 작성 창 전달
- Threads 기본 즉시 게시·예약 UI 사용
- Golden Set 기반 품질 회귀 테스트

### Phase 2 — 운영 기능

- Draft 라이브러리와 버전 비교
- 캘린더·주제 슬롯
- 사용자 수정 이력 기반 Prompt 개선
- 이미지 첨부·Alt Text 보조
- 승인 완료 초안의 Ubuntu 서버 동기화

### Phase 3 — 공식 자동화

- Threads OAuth와 공식 Publishing API
- 서버 Scheduler와 재시도·중복 방지
- Insights 수집
- 계정별 Workspace
- 다계정 기능은 정책·권한 검증 후 제공

---

## 10. MVP 완료 기준

1. Codex ChatGPT OAuth 로그인과 자동 세션 갱신이 동작한다.
2. OAuth 토큰이 Extension 저장소와 로그에 남지 않는다.
3. Threads 게시물에서 본문과 URL을 안정적으로 가져온다.
4. 서로 다른 후보를 최소 3개 생성한다.
5. 각 후보에 품질 점수와 위험 플래그를 제공한다.
6. 최종안은 JSON Schema 검증을 통과한다.
7. 원문 핵심 문구를 과도하게 재사용하면 자동 재작성한다.
8. 숫자·가격·수익 주장에 근거가 없으면 게시 전 경고한다.
9. 사용자가 편집한 뒤 Threads 작성 창으로 전달할 수 있다.
10. Threads 기본 예약 UI까지 사용자가 완료할 수 있다.
11. 인증 만료·일시적 호출 제한·생성 실패 상태를 복구할 수 있다.
12. 대표 테스트 세트에서 Prompt 변경 전후 품질 회귀를 비교할 수 있다.

---

## 11. 최종 권고

가장 먼저 만들 제품은 다음 조합이다.

> **Threads Side Panel + Codex OAuth Provider Proxy + 다중 후보 Quality Pipeline + 사용자 승인형 게시·예약**

초기에는 Ubuntu Scheduler, 자동 다계정 발행, Insights까지 동시에 만들지 않는다. 먼저 사용자가 “이 도구가 실제로 더 좋은 글을 만들어준다”고 느끼는지를 검증한다.

이 프로젝트의 차별점은 무료 LLM이나 무제한 토큰이 아니라 다음이어야 한다.

> **참고 글을 베끼지 않으면서도, 계정의 목소리와 게시 목적에 맞는 좋은 글을 반복적으로 만들어내는 품질 시스템**

전체 구현 순서와 Phase별 테스트·출시 Gate는 [개발 계획](../dev-plan/implement_20260904_183303.md)을 기준으로 관리한다.
