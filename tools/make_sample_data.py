#!/usr/bin/env python3
"""화면 미리보기용 가짜 데이터 생성 (sample-data/). 실제 값이 아닙니다.
사용: python tools/make_sample_data.py  →  index.html?sample=1 로 확인
"""
import datetime as dt
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sample-data"
OUT.mkdir(exist_ok=True)
random.seed(7)
cfg = json.loads((ROOT / "config" / "indicators.json").read_text(encoding="utf-8"))
start = {"dji": 30000, "spx": 3800, "ixic": 11000, "kospi": 2400, "kosdaq": 750, "usdkrw": 1250,
         "kr_base_rate": 3.0, "us_fed_rate": 4.5, "us10y": 3.8, "kr_loan_rate": 4.8, "cofix": 3.6,
         "kr_gdp": 0.5, "wti": 75, "gold": 1900, "us_gdp": 2.0, "dxy": 102}
today = dt.date.today()
now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
entries = []
for ind in cfg["indicators"]:
    v, pts = start.get(ind["id"], 100), []
    style = ind.get("style")
    if style == "bar":  # 분기
        for q in range(40):
            d = dt.date(today.year - 10 + (q // 4), (q % 4) * 3 + 1, 1)
            pts.append((d.isoformat(), round(random.gauss(v, 0.6), 1)))
    elif style == "step":  # 월
        for m in range(120):
            y, mm = divmod(today.month - 120 + m - 1, 12)
            d = dt.date(today.year + y, mm + 1, 1)
            if random.random() < 0.08:
                v += random.choice([-0.25, 0.25])
            pts.append((d.isoformat(), round(v, 2)))
    else:  # 일
        d = today - dt.timedelta(days=365 * 10)
        while d <= today:
            if d.weekday() < 5:
                v *= 1 + random.gauss(0.0003, 0.011)
                pts.append((d.isoformat(), round(v, 2)))
            d += dt.timedelta(days=1)
    (OUT / f"{ind['id']}.json").write_text(json.dumps({"id": ind["id"], "points": pts}), encoding="utf-8")
    meta = {k: ind.get(k) for k in ("id", "name", "group", "unit", "decimals", "style", "visible", "source", "note")}
    meta.update(ok=ind["id"] != "cofix", error=None if ind["id"] != "cofix" else "샘플: 수집 실패 표시 예시",
                fetched_at=now, last_date=pts[-1][0], last_value=pts[-1][1], prev_value=pts[-2][1], count=len(pts))
    entries.append(meta)
(OUT / "index.json").write_text(json.dumps({"generated_at": now, "indicators": entries}, ensure_ascii=False, indent=1),
                                encoding="utf-8")
print(f"{len(entries)}개 샘플 생성 → {OUT}")
