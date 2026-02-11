const CONFIG = { WINDOW_N:12, LV2_THRESHOLD:4, FLIP_THRESHOLD:-2 };

class Road{
  constructor(name,initDir,style){
    this.name=name; this.dir=initDir; this.style=style;
    this.wl=[]; this.win=0; this.loss=0;
    this.missStreak=0; this.maxMissStreak=0;
    this.lastPred=null;
  }
  confidence(){return this.wl.reduce((a,b)=>a+b,0);}
  level(){return this.confidence()>=CONFIG.LV2_THRESHOLD?2:1;}
  pushWL(hit){this.wl.push(hit?1:-1); if(this.wl.length>CONFIG.WINDOW_N)this.wl.shift();}
  settle(actual){
    if(this.lastPred===null)return;
    const hit=(actual===this.lastPred);
    this.pushWL(hit);
    if(hit){this.win++;this.missStreak=0;}
    else{this.loss++;this.missStreak++;if(this.missStreak>this.maxMissStreak)this.maxMissStreak=this.missStreak;}
    if(this.confidence()<=CONFIG.FLIP_THRESHOLD)this.dir=this.dir==='B'?'P':'B';
  }
  nextPrediction(history){
    const last=history.at(-1), prev=history.at(-2), conf=this.confidence();
    if(this.style==='trend'){ if(prev&&last===prev)return last; return this.dir; }
    if(this.style==='rhythm'){ if(conf>=0)return this.dir; return last==='B'?'P':'B'; }
    if(this.style==='repair'){
      if(conf<-4)return last==='B'?'P':'B';
      if(prev&&last===prev)return last==='B'?'P':'B';
      return this.dir;
    }
    if(this.style==='stable'){
      if(!last)return this.dir;
      if(this.missStreak>=2||conf<0)return last==='B'?'P':'B';
      if(prev&&last===prev)return last;
      return this.dir;
    }
    return this.dir;
  }
  feed(a,h){ this.settle(a); this.dir=this.nextPrediction(h); this.lastPred=this.dir; }
}

let history=[];
const roadA=new Road("A","P","trend");
const roadB=new Road("B","P","rhythm");
const roadC=new Road("C","B","repair");
const roadD=new Road("D","P","stable");

/* ===== 输入 ===== */
function inputOne(a){
  history.push(a);
  roadA.feed(a,history); roadB.feed(a,history);
  roadC.feed(a,history); roadD.feed(a,history);
  render(); saveAll();
}

/* ===== 重置：唯一能清空历史 ===== */
function resetAll(){
  localStorage.removeItem("bjl_history_v1");
  history.length=0;
  resetRoad(roadA,"P"); resetRoad(roadB,"P");
  resetRoad(roadC,"B"); resetRoad(roadD,"P");
  render();
}

/* ===== 后退 ===== */
function undoLast(){
  if(history.length===0)return;
  history.pop();
  recomputeFrom(history);
  render(); saveAll();
}

/* ===== 计算恢复 ===== */
function resetRoad(r,d){ r.dir=d; r.wl=[]; r.win=0; r.loss=0; r.missStreak=0; r.maxMissStreak=0; r.lastPred=null; }
function recomputeFrom(arr){
  resetRoad(roadA,"P"); resetRoad(roadB,"P");
  resetRoad(roadC,"B"); resetRoad(roadD,"P");
  const copy=[...arr]; history.length=0;
  for(const x of copy){
    history.push(x);
    roadA.feed(x,history); roadB.feed(x,history);
    roadC.feed(x,history); roadD.feed(x,history);
  }
}

/* ===== 显示 ===== */
function render(){
  drawRoadmap();

  drawWL("wlA",roadA); drawWL("wlB",roadB);
  drawWL("wlC",roadC); drawWL("wlD",roadD);
  showCard("A",roadA); showCard("B",roadB);
  showCard("C",roadC); showCard("D",roadD);

  chooseBest();
  updateRatio();

  // 放最后：就算出错也不影响统计/推荐/档位
  try { fitBeadsToWidth(); } catch(e) { console.error(e); }
}



/* 珠盘：显示顺序修复（显示用 reverse，算法 history 不反转） */
function drawRoadmap(){
  const el = document.getElementById("roadmap");
  if(!el) return;

  const ROWS = 6;

  let html = "";

  for(let i=0;i<history.length;i++){
    const r = history[i];

    const row = (i % ROWS) + 1;           // 第几行
    const col = Math.floor(i / ROWS) + 1; // 第几列

    html += `<div class="dot ${r==='B'?'red':'blue'}"
              style="grid-row:${row};grid-column:${col};">
              ${r==='B'?'庄':'闲'}
            </div>`;
  }

  el.innerHTML = html;
  el.scrollLeft = el.scrollWidth;

  // 自动滚到最右边
  el.scrollLeft = el.scrollWidth;
}

function drawWL(id,r){
  document.getElementById(id).innerHTML=r.wl.map(v=>`<div class="wl-box ${v>0?'plus':'minus'}">${v>0?'+':'-'}</div>`).join("");
}

function showCard(id,r){
  document.getElementById(id).innerHTML=
    `路 ${id}<div class="big">${r.dir==='B'?'庄':'闲'}</div>
     档位:${r.level()}<br>
     赢:${r.win} 输:${r.loss}<br>
     连错:${r.missStreak} 最大:${r.maxMissStreak}<br>
     信心:${r.confidence()}`;
}

/* ===== 人脑选路（你原逻辑）===== */
function getRegime(){
  const h=history.slice(-18); if(h.length<6)return"CHOP";
  let flips=0,repeats=0,run=1,maxRun=1;
  for(let i=1;i<h.length;i++){
    if(h[i]!==h[i-1]){flips++;run=1;}
    else{repeats++;run++;if(run>maxRun)maxRun=run;}
  }
  if(maxRun>=5||repeats/(h.length-1)>=0.62)return"TREND";
  if(flips/(h.length-1)>=0.68)return"ALTERNATE";
  return"CHOP";
}

const PICK={W:7,lastBest:"A"};

function score(r){
  const s=r.wl.slice(-PICK.W); let w=0,l=0; s.forEach(v=>v>0?w++:l++);
  return (w-l*1.1)-(r.missStreak*2)-(r.confidence()<0?1.5:0);
}

function chooseBest(){
  const reg=getRegime(),roads={A:roadA,B:roadB,C:roadC,D:roadD};
  const bias={A:0,B:0,C:0,D:0};
  if(reg==="TREND")bias.A+=2;
  else if(reg==="ALTERNATE"){bias.B+=1.5;bias.C+=1;}
  else bias.D+=1.5;

  let best="A",bestScore=-999;
  for(const k in roads){
    const sc=score(roads[k])+bias[k];
    if(sc>bestScore){bestScore=sc;best=k;}
  }
  if(roads[PICK.lastBest].missStreak>=1||bestScore>score(roads[PICK.lastBest])+0.8)PICK.lastBest=best;

  document.getElementById("bestRoad").innerText=`${PICK.lastBest}（${reg}）`;
  document.getElementById("bestDir").innerText=roads[PICK.lastBest].dir==='B'?'庄':'闲';
  document.getElementById("bestLv").innerText=roads[PICK.lastBest].level();
}

/* 比例：局数/庄/闲/和%（你基本没用和，这里保留） */
function updateRatio(){
  const total = history.length;
  const z = history.filter(x=>x==="B").length;
  const p = history.filter(x=>x==="P").length;
  const t = history.filter(x=>x==="T").length;
  const pct = (n)=> total ? Math.round(n/total*100) + "%" : "0%";

  const $ = (id)=>document.getElementById(id);
  $("totalCount").innerText = String(total);
  $("zPct").innerText = pct(z);
  $("pPct").innerText = pct(p);
  $("tPct").innerText = pct(t);
}

/* ===== 自动恢复 ===== */
function saveAll(){ localStorage.setItem("bjl_history_v1",JSON.stringify(history)); }
function restore(){
  const s=localStorage.getItem("bjl_history_v1");
  if(!s)return;
  const arr=JSON.parse(s);
  if(!Array.isArray(arr)||arr.length===0)return;
  recomputeFrom(arr); render();
}

window.inputOne=inputOne;
window.resetAll=resetAll;
window.undoLast=undoLast;
window.addEventListener("load",()=>{restore();render();});
function fitBeadsToWidth(){
  const beadCol = document.querySelector(".beadCol");
  const beadsEl = document.getElementById("roadmap"); // 你的珠盘容器
  if(!beadCol || !beadsEl) return;

  const ROWS = 6;
  const total = Array.isArray(history) ? history.length : 0;
  const cols = Math.max(1, Math.ceil(total / ROWS));

  const gap = 6;        // 要和CSS的 gap 一致
  const padW = 16;      // 左右预留
  const padH = 10;      // 上下预留（给 label / padding 留空间）

  const usableW = Math.max(0, beadCol.clientWidth - padW);
  const usableH = Math.max(0, beadsEl.clientHeight - padH);

  // 由宽度决定的球大小（要塞下 cols 列）
  let cellW = Math.floor((usableW - (cols - 1) * gap) / cols);

  // 由高度决定的球大小（要塞下 6 行）
  let cellH = Math.floor((usableH - (ROWS - 1) * gap) / ROWS);

  let cell = Math.min(cellW, cellH);
  if(!Number.isFinite(cell)) cell = 46;

  cell = Math.max(12, Math.min(46, cell)); // 模式2：最小到12
  document.documentElement.style.setProperty("--bead", cell + "px");
}

window.addEventListener("resize", ()=>{ try{ fitBeadsToWidth(); }catch(e){} });

