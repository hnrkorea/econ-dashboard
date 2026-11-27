#!/usr/bin/env python3
"""경제지표 수집 스크립트.

config/indicators.json 의 지표를 순서대로 가져와 data/<id>.json 과 data/index.json 을 씁니다.
한 지표가 실패해도 나머지는 계속 진행하고, 실패한 지표는 이전 데이터를 그대로 둡니다.

환경변수:
  ECOS_API_KEY  한국은행 ECOS 인증키
  FRED_API_KEY  미국 FRED 인증키
"""
import csv
import datetime as dt
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "indicators.json"
DATA = ROOT / "data"
YEARS = 30  # 화면 최장 기간(30년). 바꾸면 assets/app.js PERIOD_DAYS도 확인
UA = {"User-Agent": "Mozilla/5.0 (econ-dashboard; +https://github.com)"}
TIMEOUT = 20


def start_date() -> dt.date:
    return dt.date.today() - dt.timedelta(days=365 * YEARS + 30)


# ---------- 소스별 수집기: [(YYYY-MM-DD, float), ...] 를 반환 ----------

def fetch_yahoo(ind):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(ind['symbol'])}"
    # range=30y 같은 값은 Yahoo가 지원하지 않아 period1/period2(유닉스 초)로 기간을 지정
    p1 = int(dt.datetime.combine(start_date(), dt.time(), dt.timezone.utc).timestamp())
    p2 = int(time.time()) + 86400
    r = requests.get(url, params={"period1": p1, "period2": p2, "interval": "1d"}, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    meta = res["meta"]
    offset = meta.get("gmtoffset", 0)
    closes = res["indicators"]["quote"][0]["close"]
    points = {}
    for ts, v in zip(res.get("timestamp", []), closes):
        if v is None:
            continue
        d = dt.datetime.fromtimestamp(ts + offset, dt.timezone.utc).date().isoformat()
        points[d] = float(v)
    # 장중 최신가로 오늘 값을 덮어씀 (매시간 갱신의 핵심)
    price, mtime = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
    if price is not None and mtime:
        d = dt.datetime.fromtimestamp(mtime + offset, dt.timezone.utc).date().isoformat()
        points[d] = float(price)
    return sorted(points.items())


def fetch_fred(ind):
    key = os.environ.get("FRED_API_KEY")
    if not key:
        raise RuntimeError("FRED_API_KEY 없음")
    r = requests.get(
        "https://api.stlouisfed.org/fred/series/observations",
        params={"series_id": ind["series"], "api_key": key, "file_type": "json",
                "observation_start": start_date().isoformat()},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    out = []
    for o in r.json()["observations"]:
        if o["value"] not in (".", ""):
            out.append((o["date"], float(o["value"])))
    return out


def _ecos_period(cycle: str, d: dt.date) -> str:
    if cycle == "D":
        return d.strftime("%Y%m%d")
    if cycle == "M":
        return d.strftime("%Y%m")
    if cycle == "Q":
        return f"{d.year}Q{(d.month - 1) // 3 + 1}"
    return str(d.year)


def _ecos_time_to_date(cycle: str, t: str) -> str:
    if cycle == "D":
        return f"{t[:4]}-{t[4:6]}-{t[6:8]}"
    if cycle == "M":
        return f"{t[:4]}-{t[4:6]}-01"
    if cycle == "Q":
        q = int(t[-1])
        return f"{t[:4]}-{(q - 1) * 3 + 1:02d}-01"
    return f"{t[:4]}-01-01"


def fetch_ecos(ind):
    key = os.environ.get("ECOS_API_KEY")
    if not key:
        raise RuntimeError("ECOS_API_KEY 없음")
    cyc = ind["cycle"]
    s, e = _ecos_period(cyc, start_date()), _ecos_period(cyc, dt.date.today())
    # ECOS는 한 번에 최대 10000건. 30년 일별(예: 기준금리 약 1만 건)은 나눠서 받는다
    out, first, page, total = [], 1, 10000, None
    while total is None or first <= total:
        url = (f"https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/{first}/{first + page - 1}/"
               f"{ind['stat']}/{cyc}/{s}/{e}/{ind['item']}")
        r = requests.get(url, timeout=TIMEOUT)
        r.raise_for_status()
        j = r.json()
        if "StatisticSearch" not in j:
            raise RuntimeError(f"ECOS 응답 오류: {j.get('RESULT', j)}")
        total = int(j["StatisticSearch"].get("list_total_count", 0))
        for row in j["StatisticSearch"]["row"]:
            v = row.get("DATA_VALUE")
            if v in (None, "", "-"):
                continue
            out.append((_ecos_time_to_date(cyc, row["TIME"]), float(v)))
        first += page
    return sorted(out)


_KFB_COFIX_ROW = re.compile(
    r"<td>\d{4}/\d{2}/\d{2}</td>\s*<td>(\d{4})/(\d{2})</td>\s*<td>([\d.]+)</td>"
)


def fetch_kfb_cofix(ind):
    """전국은행연합회 소비자포털의 신규취급액기준 COFIX 공시 표를 긁어온다.
    ECOS에는 코픽스 통계표가 없어(2026-11 확인) 월 1회 공시되는 이 페이지를 대신 수집.
    정적 HTML 표이며 ?BasicYear=연도 로 과거 연도를 조회한다."""
    url = "https://portal.kfb.or.kr/fingoods/cofix.php"
    points = {}
    # 코픽스는 2010년 도입이라 그 이전 연도는 조회하지 않음
    for year in range(max(2010, start_date().year), dt.date.today().year + 1):
        r = requests.get(url, params={"BasicYear": year}, headers=UA, timeout=TIMEOUT)
        r.raise_for_status()
        # 같은 페이지 아래쪽에 "단기 COFIX" 표가 또 있어 신규취급액기준 표만 잘라서 본다
        table = r.text.split("단기 COFIX 통계", 1)[0]
        for y, m, v in _KFB_COFIX_ROW.findall(table):
            points[f"{y}-{m}-01"] = float(v)
        time.sleep(0.3)
    if not points:
        raise RuntimeError("코픽스 공시 표 파싱 결과 0건")
    return sorted(points.items())


def fetch_manual(ind):
    path = ROOT / ind["file"]
    out = []
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("date") and row.get("value"):
                out.append((row["date"].strip(), float(row["value"])))
    if not out:
        raise RuntimeError(f"{ind['file']} 에 데이터가 없음 (수동 입력 필요)")
    return sorted(out)


FETCHERS = {"yahoo": fetch_yahoo, "fred": fetch_fred, "ecos": fetch_ecos, "manual": fetch_manual,
            "kfb_cofix": fetch_kfb_cofix}


def fetch_one(ind):
    """ind['source']로 시도하고 실패하면 ind['fallback'](있다면)으로 재시도한다.
    반환: (points, used_fallback: bool). 기본·폴백 모두 실패하면 두 에러를 묶어 올린다."""
    try:
        return FETCHERS[ind["source"]](ind), False
    except Exception as primary_err:
        fb = ind.get("fallback")
        if not fb:
            raise
        try:
            return FETCHERS[fb["source"]](fb), True
        except Exception as fb_err:
            raise RuntimeError(
                f"{ind['source']} 실패({primary_err}); fallback {fb['source']} 도 실패({fb_err})"
            ) from fb_err


def with_history(ind, pts):
    """새로 받은 pts 앞쪽(더 오래된 구간)을 채운다.
    1) 기존 data/<id>.json 에 이미 있는 더 오래된 점을 그대로 이어 붙임(매시간 재수집 방지,
       폴백 소스가 10년치만 줄 때도 과거가 지워지지 않음)
    2) 그런 점이 없고 config에 "backfill" 소스가 있으면 그 소스에서 pts 시작일 이전 구간을 받아 붙임
    그리고 YEARS 범위 밖은 잘라낸다."""
    cut = start_date().isoformat()
    first = pts[0][0]
    earlier = []
    path = DATA / f"{ind['id']}.json"
    if path.exists():
        try:
            earlier = [tuple(p) for p in json.loads(path.read_text(encoding="utf-8"))["points"] if p[0] < first]
        except Exception as ex:  # noqa: BLE001
            print(f"  경고 {ind['id']}: 기존 파일 읽기 실패({ex})", file=sys.stderr)
    bf = ind.get("backfill")
    if bf and not any(d >= cut for d, _ in earlier):
        try:
            earlier = [p for p in FETCHERS[bf["source"]](bf) if p[0] < first]
            print(f"  백필 {ind['id']}: {bf['source']} {len(earlier)}건 ({earlier[0][0] if earlier else '-'} ~)")
        except Exception as ex:  # noqa: BLE001 - 백필 실패는 본 데이터에 영향 없음, 다음 회차에 재시도
            print(f"  경고 {ind['id']}: 백필 실패({ex})", file=sys.stderr)
    return [p for p in earlier + list(pts) if p[0] >= cut]


def main() -> int:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    DATA.mkdir(exist_ok=True)
    index_path = DATA / "index.json"
    old_index = {}
    if index_path.exists():
        old_index = {i["id"]: i for i in json.loads(index_path.read_text(encoding="utf-8")).get("indicators", [])}

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    entries, failures = [], 0
    for ind in cfg["indicators"]:
        meta = {k: ind.get(k) for k in ("id", "name", "group", "unit", "decimals", "style", "visible", "source", "note",
                                        "history_note")}
        try:
            pts, used_fallback = fetch_one(ind)
            if not pts:
                raise RuntimeError("데이터 0건")
            pts = with_history(ind, pts)
            nd = (ind.get("decimals") or 2) + 2  # 파일 크기 절약(표시 자릿수 + 2자리)
            pts = [(d, round(v, nd)) for d, v in pts]
            (DATA / f"{ind['id']}.json").write_text(
                json.dumps({"id": ind["id"], "points": pts}, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8")
            meta.update(ok=True, error=None, fetched_at=now, last_date=pts[-1][0], last_value=pts[-1][1],
                        prev_value=pts[-2][1] if len(pts) > 1 else None, count=len(pts),
                        fallback_used=used_fallback, first_date=pts[0][0])
            tag = "OK(F)" if used_fallback else "OK   "
            print(f"{tag} {ind['id']:14s} {len(pts):5d}건  최신 {pts[-1][0]} = {pts[-1][1]}")
        except Exception as ex:  # noqa: BLE001 - 지표 하나 실패가 전체를 멈추지 않게
            failures += 1
            prev = old_index.get(ind["id"], {})
            meta.update({k: prev.get(k) for k in ("fetched_at", "last_date", "last_value", "prev_value", "count", "first_date")})
            meta.update(ok=False, error=str(ex)[:300])
            print(f"FAIL {ind['id']:14s} {ex}", file=sys.stderr)
        entries.append(meta)
        time.sleep(0.3)

    index_path.write_text(json.dumps({"generated_at": now, "indicators": entries}, ensure_ascii=False, indent=1),
                          encoding="utf-8")
    print(f"완료: {len(entries) - failures} 성공 / {failures} 실패")
    # 일부 실패는 정상 종료(0). 전부 실패했을 때만 워크플로를 실패로 표시
    return 1 if failures == len(entries) else 0


if __name__ == "__main__":
    sys.exit(main())
