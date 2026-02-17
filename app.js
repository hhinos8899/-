/* =========================================================
   整合版 app.js（保持原页面结构不变）
   - 缩放：有 zoomSlider/zoomValue 就启用
   - 趋势图：canvas id = trendChart
   - 预测UI：resultLabel / resultPct / predictionText
   - 记录UI：recordDisplay
   - 信息条：algoBar（有就更新，没有就忽略）
   - 弹窗：instModal / instText（有就支持 toggleInstructions）
   - 按钮：player-btn banker-btn back-btn reset-btn instruction-btn（有就禁用）
   - 算法：A/B/C/D/E/F 全真规则
   - 调度：实时胜率最高；当前算法连错>=3 强制换到其它最高胜率
   - 撤销：从头重算（最稳，不会算错）
   - ✅ 新增：到第25局显示“已达到25局，本轮强制停止”，并禁止继续输入
========================================================= */

/* =========================
   工具：解析 “BBPPBB→P，...” 成 Map
========================= */
function buildRuleMapFromText(raw) {
  const m = new Map();
  if (!raw) return m;
  const normalized = raw
    .replace(/\r/g, "\n")
    .replace(/，/g, ",")
    .replace(/。/g, ",")
    .replace(/\s+/g, " ")
    .trim();
  const parts = normalized.split(",").map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const p = part.replace(/\s/g, "");
    const seg = p.split(/→|->|=>/);
    if (seg.length !== 2) continue;
    const key = seg[0].trim();
    let val = seg[1].trim();
    if (val === "p") val = "P";
    if (!key || (val !== "B" && val !== "P")) continue;
    m.set(key, val);
  }
  return m;
}

function suffix(arr, n) {
  if (arr.length < n) return null;
  return arr.slice(arr.length - n).join("");
}

/* =========================
   百分比循环（你用的那套）
========================= */
const PCT_LOOP = [92, 95, 97, 97, 95, 92];
let pctIdx = 0;
function nextFixedPercent() {
  const v = PCT_LOOP[pctIdx];
  pctIdx = (pctIdx + 1) % PCT_LOOP.length;
  return v;
}
function fmtPct(v) { return `+${Number(v).toFixed(2)}%`; }

/* =========================
   ✅ 本轮最大局数：25
========================= */
const MAX_HANDS = 25;

/* =========================
   A：你最早那套（递增窗口 4→5→6，最短3位）
========================= */
const RULES_A = new Map([
  ["BBPP","P"],
  ["BBPB","P"],
  ["BPPPBB","P"],
  ["BPPPBP","B"],
  ["BPPPP","B"],
  ["BBBB","B"],
  ["BBBPB","P"],
  ["BBBPPP","P"],
  ["BPPBB","B"],
  ["BPPBP","B"],
  ["BBBPPB","P"],
  ["BPBP","B"],
  ["BPBB","B"],
  ["BPB","P"],
  ["PPBB","B"],
  ["PPBPB","B"],
  ["PPBPP","P"],
  ["PBBBP","P"],
  ["PBBBB","P"],
  ["PPPBB","P"],
  ["PPPP","P"],
  ["PBPB","P"],
  ["PPPBP","B"],
  ["PBBP","P"],
  ["PBPP","P"],
]);
let aWindowN = 4;
function predictA(history) {
  if (history.length < 4) { aWindowN = 4; return null; }
  const maxLen = Math.min(aWindowN, history.length);
  for (let len = maxLen; len >= 3; len--) {
    const s = suffix(history, len);
    if (s && RULES_A.has(s)) {
      aWindowN = 4; // 命中回到4
      return RULES_A.get(s);
    }
  }
  if (aWindowN < 6) aWindowN += 1;
  return null;
}

/* =========================
   B：固定窗口=4（你定的 16 条）
========================= */
const RULES_B = new Map([
  ["PBPB","B"],
  ["PPBP","P"],
  ["PBBB","B"],
  ["PPPB","B"],
  ["PPPP","P"],
  ["PPBB","P"],
  ["PBBP","P"],
  ["PBPP","P"],
  ["BBPP","P"],
  ["BBPB","B"],
  ["BPPP","P"],
  ["BPBP","P"],
  ["BBBB","B"],
  ["BBBP","P"],
  ["BPPB","P"],
  ["BPBB","B"],
]);
function predictB(history) {
  if (history.length < 4) return null;
  const s = suffix(history, 4);
  return RULES_B.get(s) || null;
}

/* =========================
   C：你“规则C”那一整段（固定末6）
========================= */
const RULES_C_TEXT = `
BBPPBB→P，BBPPBP→P，BBPPPB→P，BBBPPP→P，BBBBPP→P，BBBBBP→B，BBPPPP→P，
BPBPBP→B，BPBPBB→B，BPBPPB→P，BPBPPP→P，BBBPPB→P，BBBPBB→B，BBBPBP→B，
BBPPBP→P，BPPBBP→B，BPPBBB→B，BPPPBB→P，BPPPPP→P，BBBBPB→B，BBPBPB→P，
BBPPPB→P，BBBPPB→P，BPPBPP→P，BPBBPB→B，BBPBBP→B，BPPPBB→P，BBPPPB→P，
BPPPBP→P，BPPPPB→P，BPPBPB→P，BPBBBP→B，BBPBPP→B
PPBBPP→P，PPBBPB→B，PPBBBP→B，PPPBBB→B，PPPPBB→P，PPPPPB→P，PPBBBB→B，
PBBBBB→B，PBPBPB→B，PBPBBP→B，PBPBBB→B，PPPBBP→P，PPPBPP→P，PPPBPB→P，
PPBBPB→B，PBBPPB→B，PBBPPP→P，PBBBPP→B，PBBBPB→B，PBBBBP→B，PPPPBP→P，
PPBPBP→P，PPBBBP→B，PPPBBP→P，PBBPBB→B，PBPPBP→P，PPBPPB→P，PBBPBP→B，
PBBBPP→B，PPBBBP→B，PBPBPP→P，PPBPPP→P，PBPPPB→P，PPBPBB→B，
BPBBBP→B，BBPBPP→B，BBPBPP→P
`;
const RULES_C = buildRuleMapFromText(RULES_C_TEXT);
function predictC(history) {
  if (history.length < 6) return null;
  const s = suffix(history, 6);
  return RULES_C.get(s) || null;
}

/* =========================
   D：你“规则D”那一整段（固定末6）
========================= */
const RULES_D_TEXT = `
BBPPBB→B，BBPPBP→B，BBPPPB→B，BBBPPP→P，BBBBPP→B，BBBBBP→B，BBPPPP→B，
BPBPBP→P，BPBPPB→B，BBBPPB→P，BBBPBB→P，BBBPBP→P，BPPBBP→B，BPPBBB→B，
BPPPBB→P，BPPPBP→B，BPPPPB→P，BBBBPB→P，BBPBPB→B，BBPPPB→B，BBBPPB→P，
BPPBPP→P，BPBBPB→P，BBPBBP→P，BPPBPB→B。BPPPBB→P，BBPPPB→B，
BPBPBB→B，BBPBBB→P，BPBBBP→P，BBPBPP→P，BPBBPP→P
PPBBPP→P，PPBBPB→P，PPBBBP→P，PPPBBB→B，PPPPBB→P，PPPPPB→P，PPBBBB→P，
PBPBPB→B，PBPBBP→B，PPPBBP→B，PPPBPP→B，PPPBPB→B，PBBPPB→P，PBBPPP→P，
PBBBPP→B，PBBBPB→P，PPPPBP→P，PPBPBP→P，PPBBBP→B，PPPBBP→B，PBBPBB→B，
PBPPBP→B，PPBPPB→B，PBBPBP→P，PBBBPP→B，PPBBBP→P，PBPBPP→P，PPBPPP→P，
PBPPPB→B，PPBPBB→B，PBPPBB→B，PBBBBP→P
`;
const RULES_D = buildRuleMapFromText(RULES_D_TEXT);
function predictD(history) {
  if (history.length < 6) return null;
  const s = suffix(history, 6);
  return RULES_D.get(s) || null;
}

/* =========================
   E：你“第5套（E）正宗版”（固定末6：B段+P段）
========================= */
const RULES_E_B = buildRuleMapFromText(`
BBPPBB→B，BBPPBP→P。BBPPPB→B，BBBPPP→B。BBBBPP→P，BBBBBP→P。BBPPPP→B，BPBPBP→p。
BPBPPB→B，BBBPPB→P。BBBPBB→P，BBBPBP→B。BPPBBP→B，BPPBBB→P。BPPPBB→B，BPPPBP→P。
BPPPPB→B，BBBBPB→B。BBPBPB→P，BBPPPB→P。BBBPPB→P，BPPBPP→P。BPBBPB→B，BBPBBP→P，
BPPBPB→B，BBPPPB→B。BPBPBB→B。BBPBBB→P。BPBBBP→P，BBPBPP→B，BPBBPP→P，BPBPPP→B。BPPPPP→P。
`);
const RULES_E_P = buildRuleMapFromText(`
PPBBPP→P，PPBBPB→B，PPBBBP→P，PPPBBB→P，PPPPBB→B，PPPPPB→B，PPBBBB→P，
PBPBPB→B，PBPBBP→P，PPPBBP→B，PPPBPP→B，PPPBPB→P，PBBPPB→P，PBBPPP→B，PBBBPP→P，
PBBBPB→B，PPPPBP→P，PPBPBP→B，PPBBBP→P，PPPBBP→B，PBBPBB→B，PBPPBP→P，PPBPPB→P，
PBBPBP→P，PBBBPP→P，PPBBBP→P，PBPBPP→P，PPBPPP→B，PBPPPB→B，PPBPBB→P，PBPPBB→B，PBBBBP→P
`);
function predictE(history) {
  if (history.length < 6) return null;
  const s = suffix(history, 6);
  if (s[0] === "B") return RULES_E_B.get(s) || null;
  if (s[0] === "P") return RULES_E_P.get(s) || null;
  return null;
}

/* =========================
   F：规则六（固定末6：B段+P段）
========================= */
const RULES_F_P = buildRuleMapFromText(`
PPBBPP→B ，PPBBPB→P，PPPBBB→B。PPPPBB→P。PPPPPB→B，PPBBBB→B。
PBPBPB→P，PBPBBP→P。PPPBBP→P，PPPBPP→B。PPPBPB→P，PBBPPP→P。
PBBBPP→B，PBBBPB→P。PBBBBP→P，PPPPBP→B。PPBPBP→B，PPBBBP→P。
PPPBBP→P，PBBPBB→P。PBPPBP→B，PPBPPB→B，PBBPBP→B，PPBBBP→P。
PBBBPP→B，PBPBPP→B。PPBPPP→P，PBPPBB→B。PBPPPP→P，PBPPPB→B。
PPBPBB→P，PBPPBB→P
`);
const RULES_F_B = buildRuleMapFromText(`
BBPPBB→P，BBPPBP→B。BBPPPB→B，BBBPPP→P。BBBBPP→B，BBBBBP→P。BBPPPP→P，BPBPBP→B。
BPBPPB→B，BBBPPB→B。BBBPBB→P，BBBPBP→B。BPPBBP→P，BPPBBB→B。BPPPBB→P，BPPPBP→B。
BPPPPB→B，BBBBPB→P。BBPBPB→P，BBPPPB→B。BPPBPP→B，BPBBPB→P。BBPBBP→P，BPPBPB→P。
BBPPPB→B，BPBPBB→P。BBPBBB→B，BPBBBP→P。BBPBPP→B，BPBBPP→B。BPBPPP→P，BPPPPP→P。
`);
function predictF(history) {
  if (history.length < 6) return null;
  const s = suffix(history, 6);
  if (s[0] === "B") return RULES_F_B.get(s) || null;
  if (s[0] === "P") return RULES_F_P.get(s) || null;
  return null;
}

/* =========================
   引擎：实时胜率 + 连错3切换
========================= */
function makeAlgo(name, predictor) {
  return { name, predictor, total: 0, hit: 0, loseStreak: 0 };
}
const ALGOS = [
  makeAlgo("A", predictA),
  makeAlgo("B", predictB),
  makeAlgo("C", predictC),
  makeAlgo("D", predictD),
  makeAlgo("E", predictE),
  makeAlgo("F", predictF),
];
function algoByName(name) { return ALGOS.find(a => a.name === name); }
function rateOf(a) { return a.total === 0 ? 0 : (a.hit / a.total); }

/* =========================
   全局状态
========================= */
let gameHistory = [];
let waiting = false;
let timer = null;
let trendChart = null;

// ✅ 本轮是否已强制停止
let roundStopped = false;

// 上一手预测快照（用来结算本手胜率）
let pending = {
  byAlgo: new Map(),
  activeAlgoName: null,
  activePred: null,
};

/* =========================
   DOM 工具
========================= */
function byId(id) { return document.getElementById(id); }
function q(sel) { return document.querySelector(sel); }

function setButtonsDisabled(disabled) {
  const p = q(".player-btn");
  const b = q(".banker-btn");
  const back = q(".back-btn");
  const reset = q(".reset-btn");
  const inst = q(".instruction-btn");
  if (p) p.disabled = disabled;
  if (b) b.disabled = disabled;
  if (back) back.disabled = disabled;
  if (reset) reset.disabled = disabled;
  if (inst) inst.disabled = disabled;
}

/* =========================
   ✅ 第25局停止提示
========================= */
function showStopMessage() {
  const label = byId("resultLabel");
  const pctEl = byId("resultPct");
  const text = byId("predictionText");

  if (label) {
    label.textContent = "AI";
    label.classList.remove("player", "banker");
  }
  if (pctEl) pctEl.textContent = "";
  if (text) text.textContent = "已达到25局，本轮强制停止";
}

function applyStoppedStateIfNeeded() {
  roundStopped = (gameHistory.length >= MAX_HANDS);
  if (roundStopped) {
    if (timer) { clearTimeout(timer); timer = null; }
    waiting = false;
    showStopMessage();
    // ✅ 到25局后：禁止继续输入（但 reset/back 仍可用？你要求“强制停止”，这里禁用全部按钮更符合）
    // 如果你想“Back/Reset 仍可点”，我也可以给你改成只禁用 P/B 两个按钮。
    setButtonsDisabled(true);
  }
}

/* =========================
   UI：记录
========================= */
function renderHistory() {
  const el = byId("recordDisplay");
  if (!el) return;
  el.innerHTML = "";
  gameHistory.forEach(t => {
    const d = document.createElement("div");
    d.className = `record-item ${t.toLowerCase()}`;
    d.textContent = t;
    el.appendChild(d);
  });
}

/* =========================
   UI：趋势图（累计B/P）
========================= */
function updateTrendChart() {
  const canvas = byId("trendChart");
  if (!canvas) return;
  if (typeof Chart === "undefined") return;
  const ctx = canvas.getContext("2d");
  if (trendChart) trendChart.destroy();

  let b = 0, p = 0;
  const banker = [];
  const player = [];
  gameHistory.forEach(x => {
    if (x === "B") b++;
    if (x === "P") p++;
    banker.push(b);
    player.push(p);
  });

  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: banker.map((_, i) => `Hand ${i + 1}`),
      datasets: [
        { label: "Banker", data: banker, borderColor: "#ff4d4d", tension: 0.25, fill: false },
        { label: "Player", data: player, borderColor: "#28a745", tension: 0.25, fill: false },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#e6edf3" } } },
      scales: {
        x: { ticks: { color: "#9aa4ad" }, grid: { color: "rgba(255,255,255,.1)" } },
        y: { beginAtZero: true, ticks: { color: "#9aa4ad" }, grid: { color: "rgba(255,255,255,.1)" } },
      },
    },
  });
}

/* =========================
   UI：预测显示
========================= */
function showPending() {
  const label = byId("resultLabel");
  const pctEl = byId("resultPct");
  const text = byId("predictionText");
  if (label) {
    label.textContent = "AI建议";
    label.classList.remove("player", "banker");
  }
  if (pctEl) pctEl.textContent = "...%";
  if (text) text.textContent = "人工智能正在预测，请稍后...";
}
function showResult(side, pct) {
  const label = byId("resultLabel");
  const pctEl = byId("resultPct");
  const text = byId("predictionText");
  if (label) {
    label.textContent = side;
    label.classList.remove("player", "banker");
    label.classList.add(side === "B" ? "banker" : "player");
  }
  if (pctEl) pctEl.textContent = fmtPct(pct);
  if (text) text.textContent = side;
}
function showIdle(msg) {
  const label = byId("resultLabel");
  const pctEl = byId("resultPct");
  const text = byId("predictionText");
  if (label) {
    label.textContent = "AI";
    label.classList.remove("player", "banker");
  }
  if (pctEl) pctEl.textContent = "";
  if (text) text.textContent = msg || "请稍候...";
}

/* =========================
   UI：算法条（有就更新，没有就忽略）
========================= */
function updateAlgoBar() {
  const bar = byId("algoBar");
  if (!bar) return;
  const name = pending.activeAlgoName || "-";
  const a = name !== "-" ? algoByName(name) : null;
  const r = a ? (rateOf(a) * 100).toFixed(2) + "%" : "-";
  const ls = a ? a.loseStreak : 0;

  if (roundStopped) {
    bar.textContent = "已达到25局，本轮强制停止";
    return;
  }
  bar.textContent = `当前算法：${name}｜胜率：${r}｜连错：${ls}`;
}

/* =========================
   计算下一手：各算法预测
========================= */
function computeAllPredictions() {
  const map = new Map();
  for (const a of ALGOS) {
    const pred = a.predictor(gameHistory);
    if (pred === "B" || pred === "P") map.set(a.name, pred);
  }
  return map;
}

/* =========================
   结算：用上一手 pending 结算本手胜率
========================= */
function scoreWithActual(actual) {
  if (!pending || pending.byAlgo.size === 0) return;

  for (const [name, pred] of pending.byAlgo.entries()) {
    const algo = algoByName(name);
    if (!algo) continue;
    algo.total += 1;
    if (pred === actual) algo.hit += 1;
  }

  if (pending.activeAlgoName && pending.activePred) {
    const active = algoByName(pending.activeAlgoName);
    if (active) {
      if (pending.activePred === actual) active.loseStreak = 0;
      else active.loseStreak += 1;
    }
  }
}

/* =========================
   选择对外算法
========================= */
function pickActive(predMap) {
  if (predMap.size === 0) return null;

  const currentName = pending.activeAlgoName;
  const currentAlgo = currentName ? algoByName(currentName) : null;
  const mustSwitch = currentAlgo ? (currentAlgo.loseStreak >= 3) : false;

  const candidates = ALGOS
    .filter(a => predMap.has(a.name))
    .filter(a => !mustSwitch || a.name !== currentName)
    .slice()
    .sort((x, y) => rateOf(y) - rateOf(x));

  if (candidates.length > 0) return candidates[0].name;

  const fallback = ALGOS
    .filter(a => predMap.has(a.name))
    .slice()
    .sort((x, y) => rateOf(y) - rateOf(x));

  return fallback.length ? fallback[0].name : null;
}

/* =========================
   生成下一手预测（2秒延迟）
========================= */
function updatePrediction() {
  if (roundStopped) {
    showStopMessage();
    updateAlgoBar();
    return;
  }

  if (timer) { clearTimeout(timer); timer = null; }

  const predMap = computeAllPredictions();
  const activeName = pickActive(predMap);
  const activePred = activeName ? predMap.get(activeName) : null;

  pending = { byAlgo: predMap, activeAlgoName: activeName, activePred: activePred };
  updateAlgoBar();

  if (!activePred) {
    showIdle("请稍候...");
    return;
  }

  waiting = true;
  setButtonsDisabled(true);
  showPending();

  const pct = nextFixedPercent();
  timer = setTimeout(() => {
    showResult(activePred, pct);
    waiting = false;
    setButtonsDisabled(false);
    timer = null;
    updateAlgoBar();
    // ✅ 如果刚好到25局，被强制停，这里也兜底一下
    applyStoppedStateIfNeeded();
  }, 2000);
}

/* =========================
   撤销：从头重算（最稳）
========================= */
function rebuildAllFromScratch() {
  if (timer) { clearTimeout(timer); timer = null; }
  waiting = false;

  const saved = [...gameHistory];

  // 清空统计
  gameHistory = [];
  pctIdx = 0;
  aWindowN = 4;
  roundStopped = false;

  for (const a of ALGOS) {
    a.total = 0;
    a.hit = 0;
    a.loseStreak = 0;
  }

  pending = { byAlgo: new Map(), activeAlgoName: null, activePred: null };

  // 先算第一手预测（通常无）
  updatePrediction();

  // 重放：先结算再推进（重放不走2秒动画）
  for (const outcome of saved) {
    scoreWithActual(outcome);
    gameHistory.push(outcome);

    const predMap = computeAllPredictions();
    const activeName = pickActive(predMap);
    const activePred = activeName ? predMap.get(activeName) : null;
    pending = { byAlgo: predMap, activeAlgoName: activeName, activePred };
  }

  renderHistory();
  updateTrendChart();

  // ✅ 重放完后判断是否到25局
  applyStoppedStateIfNeeded();
  updateAlgoBar();

  if (!roundStopped) updatePrediction();
}

/* =========================
   弹窗：胜率/说明（有就启用）
========================= */
window.toggleInstructions = function () {
  const modal = byId("instModal");
  const text = byId("instText");
  if (!modal || !text) return;

  const lines = [];
  lines.push("算法：A/B/C/D/E/F（后台同时统计胜率）");
  lines.push("调度：实时胜率最高出预测；当前算法连错3把→强制切到其它最高胜率");
  lines.push("");
  const sorted = [...ALGOS].sort((x, y) => rateOf(y) - rateOf(x));
  for (const a of sorted) {
    const r = (rateOf(a) * 100).toFixed(2) + "%";
    lines.push(`- ${a.name}: ${a.hit}/${a.total} = ${r}（连错：${a.loseStreak}）`);
  }

  text.textContent = lines.join("\n");
  modal.classList.remove("hidden");
};
window.closeInstructions = function () {
  const modal = byId("instModal");
  if (modal) modal.classList.add("hidden");
};

/* =========================
   缩放（有滑块就启用）
========================= */
function initZoom() {
  const wrapper = byId("content-wrapper");
  const slider = byId("zoomSlider");
  const label = byId("zoomValue");
  if (!wrapper || !slider) return;

  const apply = (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return;
    wrapper.style.transform = `scale(${n / 100})`;
    wrapper.style.transformOrigin = "top center";
    if (label) label.textContent = `${n}%`;
  };

  apply(slider.value || 70);
  slider.addEventListener("input", (e) => apply(e.target.value));
}

/* =========================
   按钮
========================= */
window.recordResult = function (type) {
  if (waiting) return;
  if (type !== "B" && type !== "P") return;

  // ✅ 已到25局：强制停止（不允许继续录入）
  if (roundStopped || gameHistory.length >= MAX_HANDS) {
    applyStoppedStateIfNeeded();
    updateAlgoBar();
    return;
  }

  // 先结算本手（用上一手预测）
  scoreWithActual(type);

  // 再写入历史
  gameHistory.push(type);

  renderHistory();
  updateTrendChart();

  // ✅ 如果录入后刚好到25局：立刻提示并停止，不再生成下一手预测
  if (gameHistory.length >= MAX_HANDS) {
    applyStoppedStateIfNeeded();
    updateAlgoBar();
    return;
  }

  updatePrediction();
};

window.undoLastMove = function () {
  if (waiting) return;
  gameHistory.pop();
  rebuildAllFromScratch();
};

window.resetGame = function () {
  if (waiting) return;

  gameHistory = [];
  pctIdx = 0;
  aWindowN = 4;
  roundStopped = false;

  if (timer) { clearTimeout(timer); timer = null; }

  for (const a of ALGOS) {
    a.total = 0;
    a.hit = 0;
    a.loseStreak = 0;
  }

  pending = { byAlgo: new Map(), activeAlgoName: null, activePred: null };

  setButtonsDisabled(false);
  renderHistory();
  updateTrendChart();
  showIdle("请稍候...");
  updateAlgoBar();
  updatePrediction();
};

/* =========================
   初始化
========================= */
document.addEventListener("DOMContentLoaded", function () {
  initZoom();
  renderHistory();
  updateTrendChart();
  showIdle("请稍候...");
  updateAlgoBar();
  updatePrediction();
});
