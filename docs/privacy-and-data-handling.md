# 개인정보·데이터 처리 안내 초안

## 처리하는 데이터

- 사용자가 명시적으로 선택하거나 붙여넣은 참고 글
- Persona, 작성 목적, 사용자가 제공한 근거
- 생성 후보, 최종 Draft, 사용자 편집 이력, 콘텐츠 캘린더
- Prompt/Rubric 버전, 지연 시간, 점수, 오류 코드

## 저장 위치

- Extension 데이터와 마지막 미승인 작업공간은 Draft 유실 방지를 위해 사용자의 IndexedDB에 자동 저장된다.
- Codex OAuth Access/Refresh Token은 Extension, IndexedDB, Export, ThreadFlow Scheduler에 저장되지 않는다.
- Codex 인증은 로컬 Codex App Server가 관리한다.
- 공식 Threads API 자동 게시를 켠 경우 Threads Token은 서버에서 AES-256-GCM으로 암호화하며 Tenant와 계정 ID를 Associated Data로 사용한다.

## 외부 전송

- 사용자가 생성을 실행하면 참고 글, Persona, 목적, 근거가 Codex 서비스로 전송된다.
- 사용자가 공식 API 예약 발행을 승인하면 최종 승인 글과 선택한 미디어 URL이 Meta Threads API로 전송된다.
- 자동 수집, Cookie 수집, 비공개 GraphQL 호출은 하지 않는다.

## 로그

- 원문, 생성문, Codex OAuth Token, Threads User Access Token은 애플리케이션 로그에서 제외한다.
- 기본 로그는 요청 ID, 단계, 지연, 버전, 점수, 정규화 오류 코드만 포함한다.
- 운영 로그 기본 보존 기간은 7일이며 배포 환경에서 더 짧게 설정할 수 있다.

## 사용자 제어

- 로컬 데이터 Export와 전체 삭제를 제공한다.
- Threads 연결 해제 시 암호화 Token을 제거하고 계정을 Pause하며 아직 시작하지 않은 예약 Job을 취소한다.
- SaaS 사용자 삭제는 해당 사용자의 Token, Draft, Job, Insights, 편집 파생 데이터, 감사 로그를 삭제한다.
