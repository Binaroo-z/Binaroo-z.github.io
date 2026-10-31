# binaroo-z.github.io

## 커뮤 검색 (auto/search)
- 검색 코드는 `auto/search/code.js` 하나. 즐겨찾기 버전은 이 파일을 열 때마다 받아오고, PC 크롬 확장은 이 파일로 만든다.
- 버전을 올릴 때는 항상 둘 다 같이 올린다 (사용자 요청):
  1. `code.js`의 `const VER = 'x.y'` 올리기
  2. `python3 _tools/build-ext.py` 실행 → `auto/search/community-search-ext.zip` 다시 만들기 (manifest 버전 = VER)
  3. 설치 페이지(`auto/search/index.html`, 잠금 암호화됨)의 검색 코드 칸·확장 카드 버전·업데이트 기록 갱신
  4. code.js, zip, index.html을 한 커밋으로 올리기
- 확장은 검색 화면에서 홈페이지 code.js의 VER와 비교해 새 버전이 있으면 "새 버전 설치"를 띄운다.

## 개인 자동화 잠금
- 잠긴 페이지(/auto/ 아래)는 내용을 파일로 만든 뒤 `python3 _tools/lock-page.py <내용 파일> <페이지.html>`로 잠근다. 공개키 방식이라 잠글 때는 비밀번호가 필요 없다 (여는 건 비밀번호 필요).

## 가계부 (auto/ledger)
- 분석과 최근 기록 고치기(예전 빠른 수정)가 한 페이지다 (v4부터). 따로 있던 빠른 수정·분석 페이지와 /auto/analysis/는 없앴다.
- 고칠 때마다 버전을 올리고, 페이지 맨 아래 버전 표시(.gb-foot)와 업데이트 기록을 같이 갱신한다 (사용자 요청).
