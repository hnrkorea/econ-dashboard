# CLAUDE.md — 경제지표 대시보드

## 프로젝트 요약
정적 페이지(GitHub Pages) + GitHub Actions 매시간 수집. 서버 없음.
- 수집: `scripts/fetch_data.py` (Python 3.12, requests만 사용) → `data/<id>.json`, `data/index.json`
- 화면: `index.html` + `assets/app.js` (Vanilla JS, Chart.js 4 로컬 포함). 빌드 도구 없음
- 지표 정의: `config/indicators.json` (source: yahoo | fred | ecos | manual | kfb_cofix)

## 작업 규칙
- 사용자는 작업 시작 전과 파일 삭제·커밋·푸시 같은 되돌리기 어려운 작업 전에 반드시 먼저 묻고 승인받기를 원함
- 한 지표 실패가 전체 수집을 멈추면 안 됨 (현재 구조 유지)
- 데이터 파일 형식: `{"id": "...", "points": [["YYYY-MM-DD", 값], ...]}` — 바꾸면 app.js도 함께 수정
- 화면 설정은 localStorage(`econ-dash-v1`)에 저장, 접근은 try/catch로 감쌈

## 남은 작업 (우선순위 순)
이 뼈대는 외부 API에 접속할 수 없는 환경에서 작성되어 실데이터로 검증되지 않았음.

1. ~~**실데이터 검증**~~ — 2026-11-21 완료. 16개 지표 전부 OK (FAIL 0).
2. ~~**ECOS 통계코드 확인**~~ — 2026-11-21 완료. 3개 코드 모두 정확함, 수정 불필요.
   - 한국 기준금리: 722Y001("한국은행 기준금리 및 여수신금리") / D / 0101000("한국은행 기준금리") ✅ (2026-11-24 월별→일별 전환: 금통위 결정이 1~3일 안에 반영)
   - 예금은행 대출금리: 121Y006("예금은행 대출금리(신규취급액 기준)") / M / BECBLA01("대출평균", 전체 가중평균) ✅
   - 경제성장률: 200Y102("주요지표(분기지표)") / Q / 10111("GDP(실질, 계절조정, 전기비)") ✅
3. ~~**코픽스 자동 수집**~~ — 2026-11-21 완료. ECOS에 코픽스 통계표 없음(검색 0건) 확인 → 은행연합회 소비자포털(`portal.kfb.or.kr/fingoods/cofix.php`) 공시 표를 `fetch_kfb_cofix()`(정적 HTML, `?BasicYear=` 파라미터)로 직접 수집하도록 구현. source를 `manual` → `kfb_cofix`로 변경, 테스트 결과 71건 정상 수집(최신 2026-10 = 3.62%, 기존 수동 CSV와 일치). `manual/cofix.csv`는 더는 참조되지 않음(그대로 둠, 필요 시 삭제 여부는 별도 확인)
4. ~~**Yahoo 차단 대비**~~ — 2026-11-21 완료. Stooq는 모든 요청에 JS proof-of-work 안티봇이 걸려 있어(`requests`로 불가) 제외. 대신 `indicators.json`에 `"fallback": {...}` 필드를 추가해 Yahoo 실패 시 이미 연동된 FRED/ECOS로 자동 전환하도록 `fetch_data.py`에 `fetch_one()` 구현. 단위·스케일이 일치하는 지표만 적용:
   - dji→FRED DJIA, spx→FRED SP500, ixic→FRED NASDAQCOM, us10y→FRED DGS10, wti→FRED DCOILWTICO (모두 동일 단위, 값 거의 일치 확인)
   - usdkrw→ECOS 731Y001/D/0000001(매매기준율) — Yahoo 실시간가보다 보통 1% 안팎 낮게 나올 수 있음(note 추가)
   - kospi·kosdaq·gold·dxy는 폴백 없음: ECOS/FRED에 있는 후보가 전부 스케일이 달라(지수 기준연도 다름 등) 그대로 꽂으면 차트에 불연속이 생겨 제외. 장애 시 이전 값 유지로 동작(기존 구조)
   - `data/index.json`에 `fallback_used` 필드 추가(평소 false, 폴백 전환 시 true) — app.js는 알 수 없는 필드를 무시하므로 수정 불필요
5. ~~**배포**~~ — 2026-11-21 완료. `hnrkorea/econ-dashboard` (Public) 생성·push, Secrets(ECOS_API_KEY/FRED_API_KEY) 등록, Actions 쓰기권한, Pages 활성화, 수동 실행까지 16/16 성공 확인. https://hnrkorea.github.io/econ-dashboard/

6. ~~**30년 기간**~~ — 2026-11-27. 화면에 30년 버튼 추가, 수집 기간 `YEARS = 30`.
   - Yahoo는 `range=30y`를 지원하지 않아 `period1/period2`로 요청. ECOS는 1회 1만 건 제한이라 페이지 나눠 받음(기준금리 일별 30년 ≈ 1만 66건)
   - `with_history()`: 기존 data 파일의 과거 점을 유지하고, 없으면 config `"backfill"` 소스로 한 번만 채움(매시간 재수집 안 함)
   - 백필: us_fed_rate←FRED DFEDTAR(2008-12 이전), usdkrw←ECOS 731Y001(2003-12 이전), wti←FRED DCOILWTICO(2000-08 이전)
   - 30년보다 짧은 지표(config `history_note`): 코스닥 2000-10, 비트코인 2014-09, 금 선물 2000-08, 한국 기준금리 1999-05, 코픽스 2010, 서울 아파트 실거래지수 2006-01
   - index.json에 `first_date` 추가 → 기간보다 1년 넘게 짧으면 카드에 "데이터 YYYY-MM부터" 표시
   - 화면은 1,500점 넘으면 솎아서 그림(계단형은 값 변화점 유지)

## 완료 상태
1~5번 전부 완료(2026-11-21). 매시 7분 GitHub Actions가 자동 수집·커밋, GitHub Pages가 서빙. 추가로 필요한 조치가 보이면 이 섹션 위에 새 작업으로 추가.

## 미리보기
`python tools/make_sample_data.py` 후 `python -m http.server` → `/?sample=1`
