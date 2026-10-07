MY PROJECT HUB 클라우드 버전

1. config.js를 메모장으로 엽니다.
2. PASTE_YOUR_SB_PUBLISHABLE_KEY_HERE 부분만 복사해 둔 sb_publishable_ 키로 바꿉니다.
3. index.html, styles.css, app.js, workspace.js, self-update.js, config.js, manifest.webmanifest, README_업로드방법.txt를 GitHub My-Project-Hub 저장소에 업로드합니다. workspace.js와 self-update.js도 반드시 함께 업로드하세요. 기존 config.js에 별도 연결 설정을 사용 중이면 해당 설정은 유지하세요.
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

ZIP으로 앱 업데이트
1. 최초 한 번은 위 파일들을 GitHub에 직접 업로드해서 ZIP 업데이트 기능을 설치합니다.
2. 이후 앱의 '개발 결과 / 앱 ZIP 반영' 버튼에서 My-Project-Hub-improved.zip 또는 이후 소스 ZIP을 선택합니다.
3. 파일 목록과 GitHub 소유자·저장소·배포 브랜치를 확인합니다. 기본값은 passionyyj-ai / My-Project-Hub / main입니다.
4. https://github.com/settings/personal-access-tokens/new 에서 Fine-grained personal access token을 만듭니다. 해당 저장소만 선택하고 Contents 권한을 Read and write로 설정합니다. 토큰은 앱의 비밀번호형 입력란에 넣으며, 파일이나 채팅에 적지 않습니다.
5. 확인란을 선택하고 '앱 업데이트 적용'을 누릅니다. 소스가 하나의 커밋으로 반영됩니다. 토큰은 보관하지 않으며 창을 닫거나 작업을 마치면 입력란에서 제거합니다.
6. '배포 상태 확인'에서 GitHub Pages 배포 완료를 확인한 뒤 앱을 새로고침합니다. 저장소 반영 완료와 사이트 배포 완료는 서로 다른 단계입니다.

기존 JSON/.mph 개발 결과 가져오기도 그대로 사용할 수 있습니다.
ZIP은 루트 또는 하나의 상위 폴더에 index.html, app.js, styles.css가 있어야 합니다. app.js가 workspace.js를 사용하면 workspace.js도 필요합니다.
반영 대상은 이 앱의 HTML, JS, CSS, manifest, README 파일입니다. config.js와 그 외 파일은 제외하며 기존 저장소 파일을 자동 삭제하지 않습니다. 이전 ZIP에 self-update.js가 없더라도 설치된 ZIP 업데이트 기능이 유지되도록 index.html에 연결을 보완합니다.
ZIP 최대 20MB, 압축 해제 총 10MB, 개별 파일 2MB 제한입니다. 최신 Chrome/Edge를 사용하세요.
브랜치 보호가 직접 수정을 막는 경우 오류가 표시됩니다. 보호 설정을 자동 변경하지 않습니다.
자동 검사: node tests/self-update.test.mjs
