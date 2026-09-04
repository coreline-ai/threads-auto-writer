# 오류 복구 Runbook

| 증상                | 확인                                      | 복구                                                                   |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Companion 연결 실패 | `codex --version`, Gateway 프로세스       | Codex CLI 설치 후 Gateway 재시작                                       |
| 로그인 필요         | Side Panel 설정의 상태                    | ChatGPT 로그인 실행 후 상태 새로고침                                   |
| 포트 8787 충돌      | `lsof -i :8787`                           | 충돌 프로세스를 종료한 뒤 Gateway 재시작. 패키지 Extension은 8787 고정 |
| 429                 | Auth 상태의 사용량·reset                  | 품질 단계를 제거하지 말고 reset 뒤 재시도                              |
| App Server 종료     | Gateway 오류 `PROVIDER_UNAVAILABLE`       | Gateway 재시작; 로컬 Draft는 보존됨                                    |
| 잘못된 JSON         | `INVALID_OUTPUT`                          | 자동 Schema 교정 2회 후 새 생성 작업으로 재시도                        |
| Threads 추출 실패   | 현재 탭과 게시물 구조                     | 선택 텍스트 또는 직접 붙여넣기 사용                                    |
| 작성창 입력 실패    | 클립보드 상태                             | Threads 작성창에 직접 붙여넣기                                         |
| 연결 키 오류        | Side Panel의 Companion key                | `.threadflow/session-secret` 경로가 아니라 파일 내용을 붙여넣기        |
| 게시 결과 불명      | Job `DEAD_LETTER/PUBLISH_OUTCOME_UNKNOWN` | Threads 계정에서 실제 게시 여부를 확인하기 전 재실행 금지              |
| Threads 권한 만료   | 계정 Pause/오류                           | 계정 연결 해제 후 사용자별 OAuth 재연결                                |

현재 Workspace의 전체 자동 게시 중지는 `POST /v1/controls/global {"paused":true}`로 수행한다. `GET /v1/controls`에서 `workspacePaused`를 확인할 수 있으며 Pause 중 Worker는 해당 Workspace의 새 Lease를 획득하지 않는다.
