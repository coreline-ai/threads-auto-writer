# Chrome Web Store 제출 자료 초안

## 단일 목적

사용자가 명시적으로 선택한 Threads 글 또는 붙여넣은 자료를 기반으로 Codex가 여러 작성 후보를 만들고, 사용자가 검수·승인한 초안을 Threads 기본 작성 화면으로 전달한다.

## 권한 설명

| 권한                                                 | 이유                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `sidePanel`                                          | Threads를 보면서 독립된 작성·검수 UI 제공                   |
| `storage`                                            | Persona, Source, Draft, 설정의 로컬 저장                    |
| `contextMenus`                                       | 사용자가 명시적으로 선택한 게시물 한 건 또는 선택 문장 캡처 |
| `https://www.threads.com/*`, `https://threads.com/*` | 선택 게시물 추출과 사용자 요청형 작성창 입력                |
| optional `http://127.0.0.1:8787/*`                   | 로컬 Codex Companion 연결; 사용자가 기능 실행 시 승인       |

## 포함하지 않는 권한·동작

- `identity`, `notifications`, `alarms`
- Cookie 접근과 비공개 GraphQL 호출
- 무한 스크롤·대량 수집
- 게시, 예약, 좋아요, 팔로우, 댓글의 자동 확정
- 원격 코드 실행

## 심사 전 외부 작업

- 개인정보 처리방침 공개 URL
- 아이콘·스크린샷·지원 URL
- 배포 Extension ID를 Gateway Allowlist에 반영
- Store 정책용 실제 계정 시연 영상
