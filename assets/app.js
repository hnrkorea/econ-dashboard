/* 경제지표 대시보드 - 정적 페이지. data/index.json 과 data/<id>.json 을 읽어 그립니다. */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const DATA_DIR = params.has("sample") ? "sample-data" : "data";
  const STORE_KEY = "econ-dash-v1";
  const PERIOD_DAYS = { "1m": 31, "1y": 366, "5y": 366 * 5 + 2, "10y": 366 * 10 + 3 };
  const MIN_POINTS = 6; // 월·분기 지표는 기간이 짧아도 최소 이만큼 보여줌
  const SOURCE_LABEL = { yahoo: "Yahoo", fred: "FRED", ecos: "ECOS", manual: "수동" };

  // ---------- 저장 (브라우저마다 따로) ----------
  const defaults = () => ({ order: [], hidden: {}, removed: {}, period: "1y", cols: "auto", custom: [], theme: "" });
  let state = defaults();
  try { state = Object.assign(defaults(), JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) { /* 저장소 사용 불가 */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* 무시 */ } };

  // ---------- 데이터 ----------
  let catalog = [];          // index.json 지표 + 수집 대기 중인 사용자 추가 항목
  const series = {};         // id -> [[date, value], ...]
  const charts = {};         // id -> Chart

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function getJSON(path) {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r.json();
  }

  async function init() {
    applyTheme();
    let index;
    try {
      index = await getJSON(`${DATA_DIR}/index.json`);
    } catch (e) {
      index = { generated_at: null, indicators: [] };
      showBanner("아직 수집된 데이터가 없습니다. GitHub Actions에서 '경제지표 매시간 갱신'을 한 번 실행해 주세요. (로컬 미리보기는 주소 끝에 ?sample=1)");
    }
    if (DATA_DIR === "sample-data") showBanner("샘플(가짜) 데이터로 화면만 미리 보는 중입니다. 실제 값이 아닙니다.");

    const known = new Set(index.indicators.map((i) => i.id));
    state.custom = state.custom.filter((c) => !known.has(c.id)); // 서버에 반영된 항목은 대기 목록에서 제거
    catalog = [...index.indicators, ...state.custom.map((c) => ({ ...c, pending: true }))];

    // 순서: 저장된 순서 + 새 항목은 뒤에
    const ids = catalog.map((i) => i.id);
    state.order = [...state.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !state.order.includes(id))];
    for (const ind of catalog) if (!(ind.id in state.hidden)) state.hidden[ind.id] = ind.visible === false;
    save();

    $("#updated").textContent = index.generated_at
      ? `마지막 수집: ${fmtKST(index.generated_at)} (매시간 자동 갱신)`
      : "마지막 수집: 없음";

    bindControls();
    renderManage();
    await renderGrid();
  }

  // ---------- 표시 형식 ----------
  function fmtKST(iso) {
    return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  const fmtNum = (v, d = 2) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }));

  function changeHTML(ind) {
    const { last_value: a, prev_value: b, unit } = ind;
    if (a == null || b == null) return "";
    const diff = a - b;
    const cls = Math.abs(diff) < 1e-12 ? "flat" : diff > 0 ? "up" : "down";
    if (cls === "flat") return `<span class="chg flat" title="직전 관측치 대비">변동 없음</span>`;
    const arrow = cls === "up" ? "▲" : "▼";
    const txt = unit === "%"
      ? `${diff >= 0 ? "+" : ""}${fmtNum(diff, 2)}%p`
      : `${diff >= 0 ? "+" : ""}${fmtNum(diff, ind.decimals ?? 2)} (${diff >= 0 ? "+" : ""}${fmtNum((diff / b) * 100, 2)}%)`;
    return `<span class="chg ${cls}" title="직전 관측치 대비">${arrow} ${txt}</span>`;
  }

  // ---------- 그리드 ----------
  const visibleList = () => state.order.map((id) => catalog.find((c) => c.id === id)).filter((c) => c && !state.hidden[c.id] && !state.removed[c.id]);

  async function renderGrid() {
    const grid = $("#grid");
    Object.values(charts).forEach((c) => c.destroy());
    for (const k in charts) delete charts[k];
    grid.dataset.cols = state.cols;
    if (state.cols === "auto") delete grid.dataset.cols;

    const list = visibleList();
    grid.innerHTML = list.length ? list.map(cardHTML).join("") : `<p class="hint">표시할 항목이 없습니다. 아래 '그래프 항목 관리'에서 켜 주세요.</p>`;

    await Promise.all(list.map(async (ind) => {
      if (ind.pending || series[ind.id]) return;
      try { series[ind.id] = (await getJSON(`${DATA_DIR}/${ind.id}.json`)).points; } catch (_) { series[ind.id] = []; }
    }));
    list.forEach(drawChart);
  }

  function cardHTML(ind) {
    const status = ind.pending
      ? `<span class="err">수집 대기: config 반영 필요</span>`
      : ind.ok === false ? `<span class="err" title="${esc(ind.error)}">최근 수집 실패 · 이전 값 표시</span>` : "";
    return `
      <article class="card" id="card-${esc(ind.id)}">
        <div class="card-head"><h3>${esc(ind.name)}</h3><span class="tag">${esc(ind.group || "")}</span></div>
        <div class="value-row">
          <span class="value">${fmtNum(ind.last_value, ind.decimals ?? 2)}<span class="unit">${esc(ind.unit || "")}</span></span>
          ${changeHTML(ind)}
        </div>
        <div class="meta">
          <span>${ind.last_date ? `기준일 ${esc(ind.last_date)}` : "데이터 없음"}</span>
          <span>${SOURCE_LABEL[ind.source] || esc(ind.source)}</span>
          ${status}
        </div>
        <div class="chart-box"><canvas aria-label="${esc(ind.name)} 추이 그래프" role="img"></canvas></div>
        <div class="card-foot"><button class="link" data-table="${esc(ind.id)}">표로 보기</button></div>
        <div class="table-slot"></div>
      </article>`;
  }

  function sliceForPeriod(pts) {
    if (!pts || !pts.length) return [];
    const cut = new Date(Date.now() - PERIOD_DAYS[state.period] * 864e5).toISOString().slice(0, 10);
    let i = pts.findIndex((p) => p[0] >= cut);
    if (i === -1) i = pts.length;
    i = Math.min(i, Math.max(0, pts.length - MIN_POINTS));
    return pts.slice(i);
  }

  function cssVar(name) { return getComputedStyle($(".viz-root")).getPropertyValue(name).trim(); }

  function drawChart(ind) {
    const card = document.getElementById(`card-${ind.id}`);
    const box = $(".chart-box", card);
    const pts = sliceForPeriod(series[ind.id]);
    if (pts.length < 2) {
      box.innerHTML = `<div class="empty">${ind.pending ? "config/indicators.json에 추가하고 커밋하면<br>다음 수집부터 표시됩니다" : "표시할 데이터가 없습니다"}</div>`;
      return;
    }
    const c1 = cssVar("--series-1"), fill = cssVar("--series-1-fill"), grid = cssVar("--grid"), ink2 = cssVar("--text-secondary"), surf = cssVar("--surface-1");
    const isBar = ind.style === "bar";
    const d = ind.decimals ?? 2;
    const spanDays = (new Date(pts[pts.length - 1][0]) - new Date(pts[0][0])) / 864e5;
    const shortLabel = spanDays <= 62; // 짧은 구간은 월-일, 긴 구간은 연-월
    charts[ind.id] = new Chart($("canvas", box), {
      type: isBar ? "bar" : "line",
      data: {
        labels: pts.map((p) => p[0]),
        datasets: [{
          data: pts.map((p) => p[1]),
          borderColor: c1,
          backgroundColor: isBar ? c1 : fill,
          fill: !isBar && ind.style !== "step" ? "start" : false,
          stepped: ind.style === "step" ? "before" : false,
          borderWidth: isBar ? 0 : 2,
          borderRadius: isBar ? 4 : 0,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: surf,
          pointHoverBackgroundColor: c1,
          tension: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: { label: (ctx) => `${fmtNum(ctx.parsed.y, d)} ${ind.unit || ""}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: grid }, ticks: { color: ink2, maxTicksLimit: 5, maxRotation: 0, font: { size: 10 },
               callback: function (v) { const s = this.getLabelForValue(v); return shortLabel ? s.slice(5) : s.slice(0, 7); } } },
          y: { grid: { color: grid }, border: { display: false }, beginAtZero: isBar, ticks: { color: ink2, maxTicksLimit: 5, font: { size: 10 } } },
        },
      },
    });
  }

  function toggleTable(id) {
    const card = document.getElementById(`card-${id}`);
    const slot = $(".table-slot", card), btn = $("[data-table]", card);
    if (slot.innerHTML) { slot.innerHTML = ""; btn.textContent = "표로 보기"; return; }
    const ind = catalog.find((c) => c.id === id);
    const rows = (series[id] || []).slice(-10).reverse();
    slot.innerHTML = rows.length
      ? `<table class="mini-table"><tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${fmtNum(r[1], ind.decimals ?? 2)} ${esc(ind.unit || "")}</td></tr>`).join("")}</tbody></table>`
      : `<p class="hint">데이터 없음</p>`;
    btn.textContent = "표 닫기";
  }

  // ---------- 항목 관리 ----------
  function renderManage() {
    const body = $("#manage-body");
    body.innerHTML = state.order.map((id, idx) => {
      const ind = catalog.find((c) => c.id === id);
      if (!ind) return "";
      const removed = !!state.removed[id];
      const st = ind.pending ? `<span class="status-err">수집 대기</span>` : ind.ok === false ? `<span class="status-err" title="${esc(ind.error)}">수집 실패</span>` : `<span class="status-ok">정상</span>`;
      return `<tr class="${removed ? "removed" : ""}">
        <td><input type="checkbox" data-vis="${esc(id)}" ${!state.hidden[id] && !removed ? "checked" : ""} ${removed ? "disabled" : ""} aria-label="${esc(ind.name)} 표시"></td>
        <td>${esc(ind.name)}</td><td>${esc(ind.group || "")}</td><td>${SOURCE_LABEL[ind.source] || esc(ind.source)}</td><td>${st}</td>
        <td class="ord"><button data-up="${idx}" aria-label="위로" ${idx === 0 ? "disabled" : ""}>▲</button> <button data-down="${idx}" aria-label="아래로" ${idx === state.order.length - 1 ? "disabled" : ""}>▼</button></td>
        <td>${removed ? `<button data-restore="${esc(id)}">복원</button>` : `<button data-remove="${esc(id)}" title="이 브라우저 화면에서 삭제(서버 수집은 계속)">삭제</button>`}</td>
      </tr>`;
    }).join("");
  }

  function move(idx, delta) {
    const j = idx + delta;
    if (j < 0 || j >= state.order.length) return;
    [state.order[idx], state.order[j]] = [state.order[j], state.order[idx]];
    save(); renderManage(); renderGrid();
  }

  function slugify(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return (base || "custom") + "_" + Date.now().toString(36).slice(-4);
  }

  function onAdd(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const src = f.get("source");
    const ind = {
      id: slugify(f.get("name")), name: f.get("name").trim(), group: (f.get("group") || "").trim() || "기타",
      source: src, unit: (f.get("unit") || "").trim(), decimals: Number(f.get("decimals") || 2), style: f.get("style"), visible: true,
    };
    const need = { yahoo: ["symbol"], fred: ["series"], ecos: ["stat", "cycle", "item"], manual: ["file"] }[src];
    for (const k of need) {
      const v = (f.get(k) || "").trim();
      if (!v) { alertField(k); return; }
      ind[k] = v;
    }
    state.custom.push(ind);
    catalog.push({ ...ind, pending: true });
    state.order.push(ind.id);
    state.hidden[ind.id] = false;
    save(); renderManage(); renderGrid();
    $("#snippet").textContent = JSON.stringify(ind, null, 0).replace(/,"/g, ', "') + ",";
    $("#snippet-wrap").hidden = false;
    e.target.reset();
    syncFormFields();
  }

  function alertField(k) {
    const el = $(`#add-form [name="${k}"]`);
    el.setCustomValidity("이 출처에는 이 값이 필요합니다");
    el.reportValidity();
    el.addEventListener("input", () => el.setCustomValidity(""), { once: true });
  }

  function syncFormFields() {
    const src = $('#add-form [name="source"]').value;
    document.querySelectorAll("#add-form [data-for]").forEach((l) => { l.hidden = l.dataset.for !== src; });
  }

  // ---------- 테마 ----------
  function applyTheme() {
    if (state.theme) document.documentElement.dataset.theme = state.theme;
    else delete document.documentElement.dataset.theme;
  }

  function showBanner(msg) { const b = $("#banner"); b.textContent = msg; b.hidden = false; }

  function bindControls() {
    document.querySelectorAll("#period button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.p === state.period));
      b.onclick = () => {
        state.period = b.dataset.p; save();
        document.querySelectorAll("#period button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderGrid();
      };
    });
    $("#cols").value = state.cols;
    $("#cols").onchange = (e) => { state.cols = e.target.value; save(); renderGrid(); };
    $("#theme").onclick = () => {
      const dark = state.theme ? state.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      state.theme = dark ? "light" : "dark"; save(); applyTheme(); renderGrid();
    };
    $("#grid").addEventListener("click", (e) => { const t = e.target.closest("[data-table]"); if (t) toggleTable(t.dataset.table); });
    $("#manage-body").addEventListener("change", (e) => {
      const id = e.target.dataset.vis; if (!id) return;
      state.hidden[id] = !e.target.checked; save(); renderGrid();
    });
    $("#manage-body").addEventListener("click", (e) => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.dataset.up) move(+t.dataset.up, -1);
      else if (t.dataset.down) move(+t.dataset.down, +1);
      else if (t.dataset.remove) {
        const id = t.dataset.remove;
        state.removed[id] = true;
        const ci = state.custom.findIndex((c) => c.id === id);
        if (ci > -1) { state.custom.splice(ci, 1); catalog = catalog.filter((c) => c.id !== id); state.order = state.order.filter((x) => x !== id); delete state.removed[id]; }
        save(); renderManage(); renderGrid();
      } else if (t.dataset.restore) { delete state.removed[t.dataset.restore]; save(); renderManage(); renderGrid(); }
    });
    $("#reset").onclick = () => {
      const custom = state.custom; state = defaults(); state.custom = custom;
      for (const ind of catalog) state.hidden[ind.id] = ind.visible === false;
      state.order = catalog.map((c) => c.id); save(); applyTheme();
      bindControls(); renderManage(); renderGrid();
    };
    $("#add-form").onsubmit = onAdd;
    $('#add-form [name="source"]').onchange = syncFormFields;
    syncFormFields();
    $("#copy").onclick = async () => {
      try { await navigator.clipboard.writeText($("#snippet").textContent); $("#copy").textContent = "복사됨"; setTimeout(() => ($("#copy").textContent = "복사"), 1500); }
      catch (_) { $("#copy").textContent = "직접 선택해 복사하세요"; }
    };
    let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => Object.values(charts).forEach((c) => c.resize()), 150); });
  }

  init();
})();
