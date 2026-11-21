# 경제지표 대시보드

미국 3대 지수, 코스피·코스닥, 원/달러 환율, 한·미 기준금리, 미국 10년물 국채금리, 대출금리, 코픽스, 경제성장률, WTI 유가, 금 시세를 매시간 수집해 그래프로 보여주는 정적 웹페이지입니다.

- 호스팅: GitHub Pages (무료)
- 데이터 수집: GitHub Actions가 매시 7분에 `scripts/fetch_data.py` 실행 → `data/` 폴더에 JSON 커밋
- 서버·DB 없음. 노트북이 꺼져 있어도 동작

## 폴더 구성

```
index.html                  페이지
assets/app.js, style.css    화면 로직·스타일 (Chart.js는 assets/vendor에 포함)
config/indicators.json      수집할 지표 목록 ← 지표 추가·삭제는 여기서
scripts/fetch_data.py       데이터 수집 스크립트
manual/cofix.csv            (더 이상 사용 안 함) 코픽스는 은행연합회 공시 페이지에서 자동 수집
tools/ecos_find.py          한국은행 통계코드 찾기 도우미
tools/make_sample_data.py   화면 미리보기용 가짜 데이터 생성
.github/workflows/update.yml  매시간 실행 일정
```

## 처음 설정 (약 20분)

1. **API 키 발급 (무료)**
   - 한국은행 ECOS: https://ecos.bok.or.kr/api/ → 인증키 신청
   - FRED: https://fred.stlouisfed.org/docs/api/api_key.html → 회원가입 후 API Key 발급
2. **GitHub 저장소 만들기**: 새 저장소(Public 권장, Pages 무료 조건)를 만들고 이 폴더 내용을 올립니다.
3. **키 등록**: 저장소 Settings → Secrets and variables → Actions → New repository secret
   - `ECOS_API_KEY`, `FRED_API_KEY`
4. **Actions 쓰기 권한**: Settings → Actions → General → Workflow permissions → *Read and write permissions* 선택
5. **첫 수집 실행**: Actions 탭 → "경제지표 매시간 갱신" → Run workflow
6. **Pages 켜기**: Settings → Pages → Source: *Deploy from a branch*, Branch: `main` / `(root)`
7. 몇 분 뒤 `https://<아이디>.github.io/<저장소이름>/` 에서 확인

## 로컬에서 확인

```bash
pip install -r requirements.txt
export ECOS_API_KEY=... FRED_API_KEY=...
python scripts/fetch_data.py          # 실제 데이터 수집
python -m http.server 8000            # http://localhost:8000 접속

python tools/make_sample_data.py      # 키 없이 화면만 볼 때
# → http://localhost:8000/?sample=1
```

## 그래프 항목 추가·삭제

- **화면에서 숨기기·순서 바꾸기·삭제**: 페이지 하단 '그래프 항목 관리'. 설정은 각 브라우저에 저장됩니다.
- **새 지표 추가**: 하단 '새 항목 추가' 폼에 입력하면 설정 코드가 만들어집니다. 그 코드를 `config/indicators.json`에 붙여넣고 커밋하면 다음 정시 수집부터 그래프가 채워집니다.
- **수집 자체를 중단**: `config/indicators.json`에서 해당 항목을 지웁니다.

## 코픽스

은행연합회 소비자포털(`portal.kfb.or.kr/fingoods/cofix.php`) 공시 표를 매시간 자동으로 긁어옵니다. 실제 값은 매월 15일경 한 번만 바뀝니다. 수동 입력은 더 필요 없습니다.

## 알아둘 점

- Yahoo Finance는 공식 API가 아니어서 가끔 막히거나 형식이 바뀔 수 있습니다. 실패한 지표는 이전 값을 유지하고 카드에 '최근 수집 실패'가 표시됩니다.
- 다우존스·S&P500·나스닥·미국10년물·WTI·원달러환율은 Yahoo가 막히면 FRED/ECOS로 자동 전환됩니다(단, 원달러는 ECOS 매매기준율이라 실시간가보다 1% 안팎 낮을 수 있음). 코스피·코스닥·금 시세·달러인덱스는 대체 소스의 단위가 달라 전환 없이 이전 값을 유지합니다.
- GitHub Actions 예약 실행은 수 분~수십 분 늦을 수 있습니다.
- 공개 저장소에 60일간 활동이 없으면 예약 워크플로가 자동 중지될 수 있습니다. Actions 탭에서 가끔 상태를 확인하세요.
- 기준금리·성장률·대출금리·코픽스는 매시간 확인해도 발표일에만 바뀝니다. 카드의 '기준일'을 확인하세요.
