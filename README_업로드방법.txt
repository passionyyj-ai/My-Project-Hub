MY PROJECT HUB 클라우드 버전

1. config.js를 메모장으로 엽니다.
2. PASTE_YOUR_SB_PUBLISHABLE_KEY_HERE 부분만 복사해 둔 sb_publishable_ 키로 바꿉니다.
3. index.html, styles.css, app.js, workspace.js, config.js, manifest.webmanifest, README_업로드방법.txt를 GitHub My-Project-Hub 저장소에 업로드합니다. workspace.js를 빠뜨리면 앱이 시작되지 않습니다.
4. Settings > Pages에서 Deploy from a branch, main, /(root)를 선택합니다.
5. https://passionyyj-ai.github.io/My-Project-Hub/ 에 접속합니다.

주의: sb_secret_ 키는 어떤 파일에도 넣지 마세요.

개선 버전 안내
- 변경한 프로젝트별로 저장하며, 실패한 변경은 계정별로 기기에 보관하고 재시도합니다.
- 다른 기기의 변경과 충돌하면 저장 상태 버튼에서 백업 후 덮어쓰기를 선택할 수 있습니다.
- 항목 수정, 모바일 전체 메뉴, 작업 기한·우선순위, 검색·필터·정렬을 지원합니다.
- 백업은 모든 프로젝트와 첨부 파일을 포함합니다. 첨부 다운로드에 실패하면 백업을 중단합니다.
- 복원은 기존 프로젝트를 유지하고 새 복사본을 생성합니다. 중간 실패 시 생성된 복사본은 유지됩니다.
- 문서 삭제는 목록에서 제거하며, 저장 실패 때 파일이 손실되지 않도록 저장소 원본 파일은 유지합니다.
- 새로운 프로젝트 생성, 파일 업로드와 복원은 인터넷 연결이 필요합니다.
- 서버의 mph_projects 테이블에 updated_at 열과 owner_id 기반 접근 권한이 있어야 합니다. 저장소 접근 권한은 기존 설정을 사용합니다.
- 검사: node tests/workspace.test.mjs
