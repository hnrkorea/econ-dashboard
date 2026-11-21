#!/usr/bin/env python3
"""ECOS 통계코드 찾기 도우미.

사용법:
  ECOS_API_KEY=키 python tools/ecos_find.py table 코픽스        # 통계표 이름으로 검색
  ECOS_API_KEY=키 python tools/ecos_find.py items 722Y001       # 통계표의 항목코드·주기 목록
  ECOS_API_KEY=키 python tools/ecos_find.py test 722Y001 M 0101000   # 최근 값 시험 조회
"""
import datetime as dt
import os
import sys

import requests

KEY = os.environ.get("ECOS_API_KEY") or sys.exit("ECOS_API_KEY 환경변수를 설정하세요")
BASE = "https://ecos.bok.or.kr/api"


def get(path):
    r = requests.get(f"{BASE}/{path}", timeout=20)
    r.raise_for_status()
    return r.json()


def table(word):
    rows = get(f"StatisticTableList/{KEY}/json/kr/1/10000")["StatisticTableList"]["row"]
    for r in rows:
        if word in (r.get("STAT_NAME") or ""):
            print(r["STAT_CODE"], r.get("CYCLE"), r["STAT_NAME"])


def items(stat):
    rows = get(f"StatisticItemList/{KEY}/json/kr/1/10000/{stat}")["StatisticItemList"]["row"]
    for r in rows:
        print(r["ITEM_CODE"], r.get("CYCLE"), r.get("START_TIME"), "~", r.get("END_TIME"), r["ITEM_NAME"])


def test(stat, cycle, item):
    y = dt.date.today().year
    s, e = {"D": (f"{y}0101", f"{y}1231"), "M": (f"{y-1}01", f"{y}12"),
            "Q": (f"{y-2}Q1", f"{y}Q4"), "A": (str(y - 5), str(y))}[cycle]
    j = get(f"StatisticSearch/{KEY}/json/kr/1/100/{stat}/{cycle}/{s}/{e}/{item}")
    for r in j.get("StatisticSearch", {}).get("row", [])[-8:]:
        print(r["TIME"], r["DATA_VALUE"], r.get("UNIT_NAME"), r["ITEM_NAME1"])
    if "StatisticSearch" not in j:
        print(j)


if __name__ == "__main__":
    cmd, *args = sys.argv[1:] or ["help"]
    {"table": table, "items": items, "test": test}.get(cmd, lambda *a: print(__doc__))(*args)
