const { useState, useEffect, useRef, useCallback } = React;
const K_TASKS = "cp:tasks";
const K_ROUTINE = "cp:routine";
const K_GYM = "cp:gym";
const K_GOALS = "cp:goals";
const K_CAL = "cp:cal";
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d = /* @__PURE__ */ new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uid = () => Math.random().toString(36).slice(2, 9);
const unhealthy = /* @__PURE__ */ new Set();
function idbOpen() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open("cp-store", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch (e) {
      res(null);
    }
  });
}
function idbGet(key) {
  return new Promise(async (res) => {
    const db = await idbOpen();
    if (!db) return res(null);
    try {
      const rq = db.transaction("kv", "readonly").objectStore("kv").get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    } catch (e) {
      res(null);
    }
  });
}
function idbSet(key, str) {
  return new Promise(async (res) => {
    const db = await idbOpen();
    if (!db) return res(false);
    try {
      const rq = db.transaction("kv", "readwrite").objectStore("kv").put(str, key);
      rq.onsuccess = () => res(true);
      rq.onerror = () => res(false);
    } catch (e) {
      res(false);
    }
  });
}
async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {
  }
  return false;
}
async function loadKey(key, fallback) {
  let primary = null;
  try {
    primary = localStorage.getItem(key);
  } catch (e) {
  }
  if (primary) {
    try {
      return { ...fallback, ...JSON.parse(primary) };
    } catch (e) {
    }
  }
  const mirrored = await idbGet(key);
  if (mirrored) {
    try {
      const parsed = JSON.parse(mirrored);
      try {
        localStorage.setItem(key, mirrored);
      } catch (e) {
      }
      return { ...fallback, ...parsed };
    } catch (e) {
    }
  }
  if (primary || mirrored) unhealthy.add(key);
  return fallback;
}
async function saveKey(key, value) {
  if (unhealthy.has(key)) {
    console.warn("refusing to write over unreadable data for", key);
    return;
  }
  const str = JSON.stringify(value);
  try {
    localStorage.setItem(key, str);
  } catch (e) {
    console.error("localStorage write failed", key, e);
  }
  idbSet(key, str);
  if (typeof Sync !== "undefined") Sync.schedule();
}
async function gatherAll() {
  const [tasks, routine, gym, goals, cal] = await Promise.all([
    loadKey(K_TASKS, DEFAULT_TASKS),
    loadKey(K_ROUTINE, DEFAULT_ROUTINE),
    loadKey(K_GYM, DEFAULT_GYM),
    loadKey(K_GOALS, DEFAULT_GOALS),
    loadKey(K_CAL, DEFAULT_CAL)
  ]);
  return {
    version: 2,
    exported: (/* @__PURE__ */ new Date()).toISOString(),
    tasks,
    routine,
    gym,
    goals,
    cal
  };
}
async function writeAll(bundle) {
  if (!bundle || !bundle.version) throw new Error("bad file");
  await Promise.all([
    saveKey(K_TASKS, bundle.tasks || DEFAULT_TASKS),
    saveKey(K_ROUTINE, bundle.routine || DEFAULT_ROUTINE),
    saveKey(K_GYM, bundle.gym || DEFAULT_GYM),
    saveKey(K_GOALS, bundle.goals || DEFAULT_GOALS),
    saveKey(K_CAL, bundle.cal || DEFAULT_CAL)
  ]);
}
function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2e3);
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 660;
    o.type = "sine";
    g.gain.setValueAtTime(1e-4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + 1.1);
    o.start();
    o.stop(ctx.currentTime + 1.2);
  } catch (e) {
  }
}
const SUGGESTED = [
  "Brush teeth (morning)",
  "Brush teeth (night)",
  "Floss",
  "Shower",
  "Skincare",
  "Make bed",
  "Water bottle filled",
  "Stretch",
  "Tidy desk",
  "Laundry in",
  "Dishes",
  "Step outside"
];
const DEFAULT_GOALS = { long: [], short: [] };
const DEFAULT_CAL = { events: [], imported: null };
function parseICS(input) {
  const text = String(input).replace(/\r?\n[ \t]/g, "");
  const out = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  for (const b of blocks) {
    const body = b.split("END:VEVENT")[0];
    const sum = /SUMMARY[^:\n]*:(.*)/.exec(body);
    const dt = /DTSTART[^:\n]*:([0-9TZ]+)/.exec(body);
    if (!sum || !dt) continue;
    const r = dt[1];
    const y = +r.slice(0, 4), mo = +r.slice(4, 6) - 1, da = +r.slice(6, 8);
    const allDay = r.length === 8;
    const d = allDay ? new Date(y, mo, da) : new Date(y, mo, da, +r.slice(9, 11) || 0, +r.slice(11, 13) || 0);
    if (isNaN(d.getTime())) continue;
    out.push({
      id: uid(),
      title: sum[1].trim().replace(/\\,/g, ",").replace(/\\n/g, " "),
      ts: d.getTime(),
      allDay
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}
function parseLines(input) {
  const out = [];
  for (const raw of String(input).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?\s*[|\u2013\u2014-]\s*(.+)$/.exec(
      line
    );
    if (!m) continue;
    const allDay = !m[4];
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    if (isNaN(d.getTime())) continue;
    out.push({ id: uid(), title: m[6].trim(), ts: d.getTime(), allDay });
  }
  return out.sort((a, b) => a.ts - b.ts);
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function longDate(d) {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function midnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function daysUntil(s) {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return Math.round((midnight(d) - midnight(/* @__PURE__ */ new Date())) / 864e5);
}
function targetLabel(s) {
  const n = daysUntil(s);
  if (n === null) return s ? `by ${s}` : "";
  if (n < 0) return `${Math.abs(n)} days overdue`;
  if (n === 0) return "due today";
  if (n === 1) return "1 day left";
  return `${n} days left`;
}
const DEFAULT_TASKS = { items: [] };
const DEFAULT_ROUTINE = {
  items: [
    { id: uid(), label: "Morning meds" },
    { id: uid(), label: "Breakfast" },
    { id: uid(), label: "Evening meds" },
    { id: uid(), label: "Wind down" }
  ],
  log: {},
  dayStart: 7,
  dayEnd: 23
};
const DEFAULT_GYM = {
  exercises: [
    "Leg press",
    "Hip thrust",
    "Romanian deadlift",
    "Leg extension",
    "Leg curl",
    "Lat pulldown",
    "Seated row",
    "Chest press",
    "Lateral raise",
    "Face pull",
    "Barbell shrug",
    "Bicep curl",
    "Triceps pushdown"
  ],
  sets: []
};
const CSS = `
.cp {
  --ground:#161D24; --panel:#1E2831; --panel2:#26313B; --line:#33414C;
  --ink:#E6EDF3; --dim:#8496A3; --signal:#F2A93B; --live:#45C7B8; --warn:#E0697F;
  --onsignal:#161D24;
  --veil1:#232E39; --veil2:#1A222B; --veil3:#141A21;
  --veilink:#E4EBF2; --goalink:#D2DAE2; --soft:#8A99A6;
  --dot1:#E0A354; --dot2:#54A79B;
  --softb:#4E6259; --softt:#96C8C0; --softbh:#74A79E; --softth:#B2DBD4;
  --quietb:#33414C; --quiett:#8496A3;
  --overdue:#D98599;
  --shadow:none;
  --r:12px; --rs:10px;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;
  --body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--ground); color: var(--ink); font-family: var(--body);
  min-height: 100vh; width: 100%; display:flex; justify-content:center;
  -webkit-font-smoothing: antialiased;
  transition: background .5s ease, color .5s ease;
}

.cp.light {
  --ground:#F4F1EA; --panel:#FFFDF8; --panel2:#EDE8DE; --line:#E2DBCD;
  --ink:#2B2823; --dim:#8B8275; --signal:#C2661C; --live:#1B8C7D; --warn:#C2475E;
  --onsignal:#FFFFFF;
  --veil1:#FFFAF1; --veil2:#F7F2E8; --veil3:#F1EADD;
  --veilink:#2B2823; --goalink:#3B372F; --soft:#8B8275;
  --dot1:#D99340; --dot2:#3AA294;
  --softb:#BAD5CE; --softt:#1B7A6D; --softbh:#8FBDB4; --softth:#146257;
  --quietb:#E2DBCD; --quiett:#8B8275;
  --overdue:#C2475E;
  --shadow: 0 1px 2px rgba(70,58,40,.05), 0 6px 18px rgba(70,58,40,.06);
}
.cp * { box-sizing: border-box; }
.cp-shell { width:100%; max-width:460px; display:flex; flex-direction:column;
  min-height:100vh; border-left:1px solid var(--line); border-right:1px solid var(--line); }

.cp-top { display:flex; align-items:center; justify-content:space-between;
  padding:14px 18px 13px; border-bottom:1px solid var(--line); }
.cp-mark { font-family:var(--mono); font-size:10px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--signal); display:block; }
.cp-date { font-family:var(--mono); font-size:12px; color:var(--dim);
  margin-top:5px; }
.cp-clock { font-family:var(--mono); font-size:21px; color:var(--ink);
  font-variant-numeric: tabular-nums; letter-spacing:-.01em; }

.cp-body { flex:1; padding:18px; padding-bottom:44px; }

.cp-label { font-family:var(--mono); font-size:10px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--dim); margin:0 0 10px; display:block; }

.cp-card { background:var(--panel); border:1px solid var(--line);
  border-radius:var(--r); padding:15px; margin-bottom:16px; box-shadow:var(--shadow); }

/* day depletion bar */
.cp-daywrap { margin-bottom:18px; }
.cp-dayfig { display:flex; align-items:baseline; gap:8px; margin-bottom:10px; }
.cp-dayfig b { font-family:var(--mono); font-size:30px; font-weight:500;
  letter-spacing:-.01em; font-variant-numeric:tabular-nums; }
.cp-dayfig span { font-size:12px; color:var(--dim); }
.cp-track { position:relative; height:32px; background:var(--panel);
  border:1px solid var(--line); border-radius:var(--rs); overflow:hidden;
  box-shadow:var(--shadow); }
.cp-fill { position:absolute; top:0; left:0; bottom:0; background:var(--signal);
  opacity:.16; }
.cp-head { position:absolute; top:0; bottom:0; width:2px; background:var(--signal); }
.cp-tick { position:absolute; top:0; width:1px; height:6px; background:var(--line); }
.cp-ticklabel { position:absolute; bottom:4px; font-family:var(--mono);
  font-size:9px; color:var(--dim); transform:translateX(-50%); }

/* rows */
.cp-row { display:flex; align-items:center; gap:12px; padding:11px 0;
  border-bottom:1px solid var(--line); }
.cp-row:last-child { border-bottom:none; }
.cp-box { width:20px; height:20px; flex:none; border:1px solid var(--line);
  border-radius:3px; background:transparent; cursor:pointer; position:relative;
  transition:.14s; }
.cp-box:hover { border-color:var(--dim); }
.cp-box.on { background:var(--live); border-color:var(--live); }
.cp-box.on::after { content:""; position:absolute; left:6px; top:2px; width:5px;
  height:10px; border:solid var(--ground); border-width:0 2px 2px 0;
  transform:rotate(42deg); }
.cp-rowtext { flex:1; font-size:15px; line-height:1.35; }
.cp-rowtext.done { color:var(--dim); text-decoration:line-through; }

.cp-x { background:none; border:none; color:var(--line); font-size:18px;
  cursor:pointer; padding:0 2px; line-height:1; }
.cp-x:hover { color:var(--warn); }

/* inputs */
.cp-input, .cp-select {
  width:100%; background:var(--panel2); border:1px solid var(--line);
  color:var(--ink); border-radius:var(--rs); padding:12px; font-size:16px;
  font-family:var(--body); outline:none; }
.cp-input:focus, .cp-select:focus { border-color:var(--signal); }
.cp-input::placeholder { color:var(--dim); }
.cp-inline { display:flex; gap:8px; }

.cp-btn { background:var(--panel2); border:1px solid var(--line); color:var(--ink);
  border-radius:var(--rs); padding:11px 14px; font-size:13px; font-family:var(--mono);
  letter-spacing:.06em; text-transform:uppercase; cursor:pointer; transition:.14s; }
.cp-btn:hover { border-color:var(--dim); }
.cp-btn.primary { background:var(--signal); border-color:var(--signal);
  color:var(--onsignal); font-weight:600; }
.cp-btn.primary:hover { opacity:.88; }
.cp-btn.ghost { background:transparent; }
.cp-btn:disabled { opacity:.4; cursor:default; }

/* focus ring */
.cp-ringwrap { display:flex; flex-direction:column; align-items:center;
  padding:14px 0 22px; }
.cp-ringnum { font-family:var(--mono); font-size:44px; font-weight:500;
  font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
.cp-ringsub { font-family:var(--mono); font-size:10px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--dim); margin-top:6px; }
.cp-presets { display:flex; gap:8px; margin-bottom:10px; }
.cp-presets .cp-btn { flex:1; }
.cp-presets .cp-btn.sel { border-color:var(--signal); color:var(--signal); }

/* goal sections */
.cp-secthead { display:flex; align-items:flex-start; justify-content:space-between;
  margin-bottom:10px; gap:12px; }
.cp-secttitle { font-size:18px; font-weight:600; letter-spacing:-.01em; }
.cp-prog { height:3px; background:var(--line); border-radius:2px;
  overflow:hidden; margin-bottom:13px; }
.cp-progfill { height:100%; background:var(--live); transition:width .2s; }

/* chart */
.cp-chart { width:100%; height:auto; display:block; }
@media (min-width: 900px) { .cp-chart { max-height:260px; } }
.cp-netrow { display:flex; gap:26px; margin:4px 0 16px; }
.cp-net { font-family:var(--mono); font-size:24px; font-variant-numeric:tabular-nums;
  letter-spacing:-.01em; display:block; }
.cp-up { color:var(--live); }
.cp-down { color:var(--warn); }

/* task */
.cp-task { border:1px solid var(--line); border-radius:var(--r); margin-bottom:10px;
  background:var(--panel); overflow:hidden; }
.cp-taskhead { display:flex; align-items:center; gap:12px; padding:13px 14px; }
.cp-sub { padding:0 14px 12px 46px; }
.cp-subrow { display:flex; align-items:center; gap:10px; padding:8px 0;
  border-top:1px solid var(--line); }
.cp-subtext { flex:1; font-size:14px; color:var(--ink); }
.cp-subtext.done { color:var(--dim); text-decoration:line-through; }
.cp-min { font-family:var(--mono); font-size:11px; color:var(--signal);
  background:none; border:1px solid var(--line); border-radius:3px;
  padding:3px 7px; cursor:pointer; }
.cp-min:hover { border-color:var(--signal); }

.cp-empty { text-align:center; color:var(--dim); font-size:14px; padding:28px 16px;
  line-height:1.5; }

/* gym */
.cp-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.cp-last { font-family:var(--mono); font-size:11px; color:var(--live);
  margin-top:10px; }
.cp-setrow { display:flex; justify-content:space-between; align-items:center;
  padding:9px 0; border-bottom:1px solid var(--line); font-size:14px; }
.cp-setrow:last-child { border-bottom:none; }
.cp-setnum { font-family:var(--mono); color:var(--dim); font-variant-numeric:tabular-nums; }

/* top strip */
.cp-strip { display:flex; gap:8px; overflow-x:auto; padding:11px 18px 12px;
  border-bottom:1px solid var(--line); scrollbar-width:none;
  -webkit-overflow-scrolling:touch; }
.cp-strip::-webkit-scrollbar { display:none; }
.cp-pill { flex:none; background:var(--panel); border:1px solid var(--line);
  color:var(--dim); border-radius:999px; padding:8px 15px; font-family:var(--mono);
  font-size:11px; letter-spacing:.1em; text-transform:uppercase; cursor:pointer;
  transition:.14s; white-space:nowrap; }
.cp-pill:hover { border-color:var(--dim); color:var(--ink); }
.cp-pill.on { background:var(--signal); border-color:var(--signal);
  color:var(--onsignal); font-weight:600; }

/* launch overlay */
.cp-veil { position:fixed; inset:0; z-index:50;
  display:flex; justify-content:center; overflow-y:auto;
  background: radial-gradient(125% 85% at 50% 0%, var(--veil1) 0%, var(--veil2) 48%, var(--veil3) 100%);
  animation: cpfade .55s ease both; }
@keyframes cpfade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
.cp-veilin { width:100%; max-width:430px; padding:58px 27px 44px; }
.cp-veildate { font-size:12.5px; color:var(--soft); letter-spacing:.02em; margin:0 0 11px; }
.cp-veilh { font-size:29px; font-weight:400; letter-spacing:-.022em; margin:0 0 9px;
  color:var(--veilink); }
.cp-veilsub { font-size:14px; color:var(--soft); margin:0 0 38px; line-height:1.65;
  max-width:33ch; }

.cp-goal { border:none; padding:0 0 0 17px; margin-bottom:23px; position:relative; }
.cp-goal::before { content:""; position:absolute; left:0; top:9px; width:5px; height:5px;
  border-radius:50%; background:var(--dot1); }
.cp-goal.short::before { background:var(--dot2); }
.cp-goaltext { font-size:17px; line-height:1.52; color:var(--goalink); font-weight:400; }
.cp-qmeta { font-size:12.5px; color:var(--soft); margin-top:6px; letter-spacing:.01em; }
.cp-qhead { font-size:12.5px; color:var(--soft); margin:34px 0 13px; letter-spacing:.02em; }
.cp-qev { display:flex; gap:14px; padding:7px 0; }
.cp-qevd { font-size:13px; color:var(--dot1); width:72px; flex:none;
  font-variant-numeric:tabular-nums; }
.cp-qevt { flex:1; font-size:14.5px; color:var(--goalink); line-height:1.45; }

.cp-btn.soft { background:transparent; border-color:var(--softb); color:var(--softt);
  letter-spacing:.08em; padding:13px 14px; }
.cp-btn.soft:hover { border-color:var(--softbh); color:var(--softth); }
.cp-btn.quiet { background:transparent; border-color:var(--quietb); color:var(--quiett); }
.cp-btn.quiet:hover { border-color:var(--dim); color:var(--ink); }

.cp-goalmeta { font-family:var(--mono); font-size:10px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--dim); margin-top:5px; }

/* events */
.cp-ev { display:flex; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
.cp-ev:last-child { border-bottom:none; }
.cp-evd { font-family:var(--mono); font-size:11px; color:var(--signal); width:66px;
  flex:none; font-variant-numeric:tabular-nums; padding-top:2px; }
.cp-evt { flex:1; font-size:14px; line-height:1.35; }

.cp-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:11px; }
.cp-chip { background:transparent; border:1px dashed var(--line); color:var(--dim);
  border-radius:999px; padding:6px 11px; font-size:12.5px; cursor:pointer;
  transition:.14s; font-family:var(--body); }
.cp-chip:hover { border-color:var(--live); color:var(--live); border-style:solid; }

.cp-note { font-size:12px; color:var(--dim); line-height:1.5; margin-top:6px; }

/* desktop shell */
.cp-side { display:none; }
.cp-d { display:none; }

@media (min-width: 900px) {
  .cp { justify-content:flex-start; align-items:stretch; }
  .cp-side { display:flex; flex-direction:column; width:236px; flex:none;
    border-right:1px solid var(--line); padding:26px 14px 22px; gap:2px;
    position:sticky; top:0; height:100vh; background:var(--panel);
    overflow-y:auto; }
  .cp-brand { font-family:var(--mono); font-size:10px; letter-spacing:.18em;
    text-transform:uppercase; color:var(--signal); padding:0 12px 22px; }
  .cp-nav { background:none; border:none; text-align:left; width:100%;
    padding:10px 12px; border-radius:var(--rs); color:var(--dim); cursor:pointer;
    font-family:var(--body); font-size:14.5px; transition:.14s; display:flex;
    justify-content:space-between; align-items:center; }
  .cp-nav:hover { background:var(--panel2); color:var(--ink); }
  .cp-nav.on { background:var(--panel2); color:var(--ink); font-weight:600; }
  .cp-navcount { font-family:var(--mono); font-size:11px; color:var(--dim); }
  .cp-sidefoot { margin-top:auto; padding:16px 12px 0; border-top:1px solid var(--line); }

  .cp-shell { max-width:none; border:none; flex:1; min-width:0; }
  .cp-strip { display:none; }
  .cp-m { display:none; }
  .cp-d { display:block; }
  .cp-top { padding:22px 38px 20px; }
  .cp-body { padding:30px 38px 70px; max-width:1120px; }
  .cp-two { display:grid; grid-template-columns:1fr 1fr; gap:26px;
    align-items:start; }
  .cp-narrow { max-width:440px; }
  .cp-veilin { max-width:600px; padding:13vh 30px 40px; }
  .cp-veilh { font-size:36px; }
  .cp-goaltext { font-size:18px; }
}

@media (min-width: 1180px) {
  .cp-body { padding-left:52px; padding-right:52px; }
}
.cp-streak { font-family:var(--mono); font-size:11px; color:var(--live); }

.cp *:focus-visible { outline:2px solid var(--signal); outline-offset:2px; }
@media (prefers-reduced-motion: reduce) {
  .cp * { transition:none !important; }
  .cp-veil { animation:none !important; }
}
`;
const SYNC_CFG = "cp:sync";
const SYNC_STAMP = "cp:stamp";
const Sync = {
  client: null,
  status: "off",
  // off | signedout | idle | syncing | error | offline
  detail: "",
  suspended: false,
  timer: null,
  listeners: /* @__PURE__ */ new Set(),
  config() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_CFG) || "null");
    } catch (e) {
      return null;
    }
  },
  setConfig(url, key) {
    if (url && key) {
      localStorage.setItem(SYNC_CFG, JSON.stringify({ url: url.trim(), key: key.trim() }));
    } else {
      localStorage.removeItem(SYNC_CFG);
    }
    this.client = null;
  },
  stamp() {
    return Number(localStorage.getItem(SYNC_STAMP) || 0);
  },
  touch() {
    localStorage.setItem(SYNC_STAMP, String(Date.now()));
  },
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  emit(status, detail) {
    this.status = status;
    this.detail = detail || "";
    this.listeners.forEach((f) => f(status, this.detail));
  },
  init() {
    const cfg = this.config();
    if (!cfg || !window.supabase) {
      this.emit("off");
      return null;
    }
    if (!this.client) {
      try {
        this.client = window.supabase.createClient(cfg.url, cfg.key);
      } catch (e) {
        this.emit("error", "Bad project URL or key");
        return null;
      }
    }
    return this.client;
  },
  async user() {
    const c = this.init();
    if (!c) return null;
    try {
      const { data } = await c.auth.getUser();
      return data && data.user ? data.user : null;
    } catch (e) {
      return null;
    }
  },
  async signIn(email, password, mode) {
    const c = this.init();
    if (!c) throw new Error("Add your project URL and key first");
    const fn = mode === "signup" ? "signUp" : "signInWithPassword";
    const { data, error } = await c.auth[fn]({ email, password });
    if (error) throw error;
    if (mode === "signup" && data.user && !data.session) {
      throw new Error("Check your email to confirm the account, then sign in.");
    }
    return data.user;
  },
  async signOut() {
    const c = this.init();
    if (c) await c.auth.signOut();
    this.emit("signedout");
  },
  /* Pull remote, adopt it only if it is newer than local. */
  async pull(onAdopt) {
    const c = this.init();
    if (!c) return;
    const u = await this.user();
    if (!u) return this.emit("signedout");
    this.emit("syncing");
    try {
      const { data, error } = await c.from("cp_state").select("data, updated_at").eq("user_id", u.id).maybeSingle();
      if (error) throw error;
      if (data && data.data) {
        const remoteAt = new Date(data.updated_at).getTime();
        if (remoteAt > this.stamp()) {
          this.suspended = true;
          await writeAll(data.data);
          this.suspended = false;
          localStorage.setItem(SYNC_STAMP, String(remoteAt));
          if (onAdopt) await onAdopt();
          return this.emit("idle", "Pulled from cloud");
        }
      }
      await this.push(true);
    } catch (e) {
      this.suspended = false;
      this.emit(navigator.onLine ? "error" : "offline", e.message || "Sync failed");
    }
  },
  schedule() {
    if (this.suspended) return;
    this.touch();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 1800);
  },
  async push(quiet) {
    const c = this.init();
    if (!c) return;
    const u = await this.user();
    if (!u) return this.emit("signedout");
    if (!quiet) this.emit("syncing");
    try {
      const bundle = await gatherAll();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const { error } = await c.from("cp_state").upsert(
        { user_id: u.id, data: bundle, updated_at: now },
        { onConflict: "user_id" }
      );
      if (error) throw error;
      localStorage.setItem(SYNC_STAMP, String(Date.parse(now)));
      this.emit("idle", "Saved to cloud");
    } catch (e) {
      this.emit(navigator.onLine ? "error" : "offline", e.message || "Push failed");
    }
  }
};
window.addEventListener("online", () => {
  if (Sync.config()) Sync.push();
});
function ControlPanel() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("now");
  const [tasks, setTasks] = useState(DEFAULT_TASKS);
  const [routine, setRoutine] = useState(DEFAULT_ROUTINE);
  const [gym, setGym] = useState(DEFAULT_GYM);
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [cal, setCal] = useState(DEFAULT_CAL);
  const [veil, setVeil] = useState(true);
  const [now, setNow] = useState(/* @__PURE__ */ new Date());
  const [focusTarget, setFocusTarget] = useState(null);
  const [pendingMin, setPendingMin] = useState(null);
  const loadAll = useCallback(async () => {
    const [t, r, g, go, c] = await Promise.all([
      loadKey(K_TASKS, DEFAULT_TASKS),
      loadKey(K_ROUTINE, DEFAULT_ROUTINE),
      loadKey(K_GYM, DEFAULT_GYM),
      loadKey(K_GOALS, DEFAULT_GOALS),
      loadKey(K_CAL, DEFAULT_CAL)
    ]);
    setTasks(t);
    setRoutine(r);
    setGym(g);
    setGoals(go);
    setCal(c);
    setReady(true);
  }, []);
  useEffect(() => {
    loadAll().then(() => {
      if (Sync.config()) Sync.pull(loadAll);
    });
  }, [loadAll]);
  useEffect(() => {
    const i = setInterval(() => setNow(/* @__PURE__ */ new Date()), 1e3);
    return () => clearInterval(i);
  }, []);
  const putTasks = useCallback((next) => {
    setTasks(next);
    saveKey(K_TASKS, next);
  }, []);
  const putRoutine = useCallback((next) => {
    setRoutine(next);
    saveKey(K_ROUTINE, next);
  }, []);
  const putGym = useCallback((next) => {
    setGym(next);
    saveKey(K_GYM, next);
  }, []);
  const putGoals = useCallback((next) => {
    setGoals(next);
    saveKey(K_GOALS, next);
  }, []);
  const putCal = useCallback((next) => {
    setCal(next);
    saveKey(K_CAL, next);
  }, []);
  const goFocus = (label, minutes) => {
    setFocusTarget(label);
    setPendingMin(minutes || null);
    setTab("focus");
  };
  const themePref = routine.theme || "auto";
  const autoLight = (() => {
    const m = now.getHours() * 60 + now.getMinutes();
    return m >= 7 * 60 && m < 17 * 60 + 30;
  })();
  const light = themePref === "auto" ? autoLight : themePref === "light";
  const TABS = [
    ["now", "Now"],
    ["tasks", "Tasks"],
    ["focus", "Focus"],
    ["gym", "Gym"],
    ["goals", "Goals"],
    ["cal", "Upcoming"]
  ];
  const openTasks = tasks.items.filter((t) => !t.done).length;
  const openGoals = goals.long.filter((g) => !g.done).length + goals.short.filter((g) => !g.done).length;
  const counts = { tasks: openTasks, goals: openGoals };
  return /* @__PURE__ */ React.createElement("div", { className: "cp" + (light ? " light" : "") }, /* @__PURE__ */ React.createElement("style", null, CSS), /* @__PURE__ */ React.createElement("aside", { className: "cp-side" }, /* @__PURE__ */ React.createElement("div", { className: "cp-brand" }, "Control Panel"), TABS.map(([id, label]) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: id,
      className: "cp-nav" + (tab === id ? " on" : ""),
      onClick: () => setTab(id)
    },
    /* @__PURE__ */ React.createElement("span", null, label),
    counts[id] > 0 && /* @__PURE__ */ React.createElement("span", { className: "cp-navcount" }, counts[id])
  )), /* @__PURE__ */ React.createElement("div", { className: "cp-sidefoot" }, /* @__PURE__ */ React.createElement("div", { className: "cp-goalmeta" }, "Signed in locally"), /* @__PURE__ */ React.createElement("div", { className: "cp-date", style: { marginTop: 6 } }, routine.lastBackup ? `Backed up ${routine.lastBackup}` : "No backup yet"))), /* @__PURE__ */ React.createElement("div", { className: "cp-shell" }, /* @__PURE__ */ React.createElement("div", { className: "cp-top" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "cp-mark cp-m" }, "Control Panel"), /* @__PURE__ */ React.createElement("span", { className: "cp-secttitle cp-d" }, (TABS.find(([i]) => i === tab) || ["", ""])[1]), /* @__PURE__ */ React.createElement("span", { className: "cp-date" }, longDate(now))), /* @__PURE__ */ React.createElement("span", { className: "cp-clock" }, pad(now.getHours()), ":", pad(now.getMinutes()), ":", pad(now.getSeconds()))), /* @__PURE__ */ React.createElement("div", { className: "cp-strip" }, TABS.map(([id, label]) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: id,
      className: "cp-pill" + (tab === id ? " on" : ""),
      onClick: () => setTab(id)
    },
    label
  ))), /* @__PURE__ */ React.createElement("div", { className: "cp-body" }, !ready && /* @__PURE__ */ React.createElement("div", { className: "cp-empty" }, "Loading your data\u2026"), ready && tab === "now" && /* @__PURE__ */ React.createElement(
    NowTab,
    {
      now,
      routine,
      putRoutine,
      tasks,
      goFocus,
      reload: loadAll
    }
  ), ready && tab === "tasks" && /* @__PURE__ */ React.createElement(TasksTab, { tasks, putTasks, goFocus }), ready && tab === "focus" && /* @__PURE__ */ React.createElement(
    FocusTab,
    {
      target: focusTarget,
      setTarget: setFocusTarget,
      pendingMin,
      clearPending: () => setPendingMin(null)
    }
  ), ready && tab === "gym" && /* @__PURE__ */ React.createElement(GymTab, { gym, putGym }), ready && tab === "goals" && /* @__PURE__ */ React.createElement(GoalsTab, { goals, putGoals }), ready && tab === "cal" && /* @__PURE__ */ React.createElement(CalTab, { cal, putCal }))), ready && veil && /* @__PURE__ */ React.createElement(
    Launch,
    {
      goals,
      cal,
      now,
      onEnter: () => setVeil(false),
      onGoals: () => {
        setVeil(false);
        setTab("goals");
      }
    }
  ));
}
function evLabel(ts, allDay) {
  const d = new Date(ts);
  const today = /* @__PURE__ */ new Date();
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5
  );
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  return allDay ? day : `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function Launch({ goals, cal, now, onEnter, onGoals }) {
  const soon = cal.events.filter((e) => e.ts > now.getTime() - 36e5).sort((a, b) => a.ts - b.ts).slice(0, 3);
  const longOpen = goals.long.filter((g) => !g.done);
  const shortOpen = goals.short.filter((g) => !g.done);
  const empty = !longOpen.length && !shortOpen.length;
  return /* @__PURE__ */ React.createElement("div", { className: "cp-veil" }, /* @__PURE__ */ React.createElement("div", { className: "cp-veilin" }, /* @__PURE__ */ React.createElement("p", { className: "cp-veildate" }, longDate(now)), /* @__PURE__ */ React.createElement("h1", { className: "cp-veilh" }, now.getHours() < 12 ? "Morning." : now.getHours() < 18 ? "Afternoon." : "Evening."), /* @__PURE__ */ React.createElement("p", { className: "cp-veilsub" }, empty ? "No goals set yet. This screen greets you every time you open the app \u2014 that's the whole point of it." : "This is what you said mattered."), longOpen.map((g) => /* @__PURE__ */ React.createElement("div", { className: "cp-goal", key: g.id }, /* @__PURE__ */ React.createElement("div", { className: "cp-goaltext" }, g.text), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "cp-qmeta",
      style: daysUntil(g.target) < 0 ? { color: "var(--overdue)" } : void 0
    },
    "Long term",
    g.target ? ` \xB7 ${targetLabel(g.target)}` : ""
  ))), shortOpen.map((g) => /* @__PURE__ */ React.createElement("div", { className: "cp-goal short", key: g.id }, /* @__PURE__ */ React.createElement("div", { className: "cp-goaltext" }, g.text), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "cp-qmeta",
      style: daysUntil(g.target) < 0 ? { color: "var(--overdue)" } : void 0
    },
    "This month",
    g.target ? ` \xB7 ${targetLabel(g.target)}` : ""
  ))), soon.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "cp-qhead" }, "Coming up"), soon.map((e) => /* @__PURE__ */ React.createElement("div", { className: "cp-qev", key: e.id }, /* @__PURE__ */ React.createElement("span", { className: "cp-qevd" }, evLabel(e.ts, e.allDay)), /* @__PURE__ */ React.createElement("span", { className: "cp-qevt" }, e.title)))), /* @__PURE__ */ React.createElement("div", { className: "cp-inline", style: { marginTop: 40 } }, /* @__PURE__ */ React.createElement("button", { className: "cp-btn soft", style: { flex: 2 }, onClick: onEnter }, "Start"), /* @__PURE__ */ React.createElement("button", { className: "cp-btn quiet", style: { flex: 1 }, onClick: onGoals }, "Edit"))));
}
function GoalsTab({ goals, putGoals }) {
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cp-two" }, /* @__PURE__ */ React.createElement(
    GoalSection,
    {
      k: "short",
      title: "This month",
      blurb: "Things with an end in sight.",
      goals,
      putGoals
    }
  ), /* @__PURE__ */ React.createElement(
    GoalSection,
    {
      k: "long",
      title: "Long term",
      blurb: "The direction, not the next step.",
      goals,
      putGoals
    }
  )), /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, "Keep both lists short \u2014 two or three long-term, three or four for the month. A list you scroll past is a list you stop reading."));
}
function GoalSection({ k, title, blurb, goals, putGoals }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [open, setOpen] = useState(false);
  const list = goals[k];
  const done = list.filter((g) => g.done).length;
  const add = () => {
    const t = text.trim();
    if (!t) return;
    putGoals({
      ...goals,
      [k]: [...list, { id: uid(), text: t, target, done: false }]
    });
    setText("");
    setTarget("");
    setOpen(false);
  };
  const patch = (id, fn) => putGoals({ ...goals, [k]: list.map((g) => g.id === id ? fn(g) : g) });
  const drop = (id) => putGoals({ ...goals, [k]: list.filter((g) => g.id !== id) });
  return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 30 } }, /* @__PURE__ */ React.createElement("div", { className: "cp-secthead" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "cp-secttitle" }, title), /* @__PURE__ */ React.createElement("div", { className: "cp-goalmeta", style: { marginTop: 3 } }, blurb)), /* @__PURE__ */ React.createElement("span", { className: "cp-setnum" }, done, "/", list.length)), /* @__PURE__ */ React.createElement("div", { className: "cp-prog" }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "cp-progfill",
      style: { width: list.length ? `${done / list.length * 100}%` : "0%" }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, list.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "cp-empty" }, "Nothing here yet."), list.map((g) => /* @__PURE__ */ React.createElement("div", { className: "cp-row", key: g.id }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-box" + (g.done ? " on" : ""),
      onClick: () => patch(g.id, (x) => ({ ...x, done: !x.done })),
      "aria-label": g.text
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { className: "cp-rowtext" + (g.done ? " done" : "") }, g.text), g.target && !g.done && /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "cp-goalmeta",
      style: daysUntil(g.target) < 0 ? { color: "var(--warn)" } : void 0
    },
    targetLabel(g.target)
  )), /* @__PURE__ */ React.createElement("button", { className: "cp-x", onClick: () => drop(g.id), "aria-label": "Remove" }, "\xD7"))), !open ? /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn ghost",
      style: { width: "100%", marginTop: 12 },
      onClick: () => setOpen(true)
    },
    "+ Add to ",
    title.toLowerCase()
  ) : /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      autoFocus: true,
      placeholder: "What are you aiming at?",
      value: text,
      onChange: (e) => setText(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && add(),
      style: { marginBottom: 8 }
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      type: "date",
      value: target,
      onChange: (e) => setTarget(e.target.value),
      style: { marginBottom: 10 }
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "cp-inline" }, /* @__PURE__ */ React.createElement("button", { className: "cp-btn primary", style: { flex: 2 }, onClick: add }, "Save"), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn",
      style: { flex: 1 },
      onClick: () => setOpen(false)
    },
    "Cancel"
  )))));
}
function CalTab({ cal, putCal }) {
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState("");
  const [manual, setManual] = useState("");
  const [when, setWhen] = useState("");
  const future = cal.events.filter((e) => e.ts > Date.now() - 36e5).sort((a, b) => a.ts - b.ts);
  const importICS = () => {
    const parsed = paste.includes("BEGIN:VEVENT") ? parseICS(paste) : parseLines(paste);
    if (!parsed.length) {
      setMsg(
        "Nothing recognised. Use either a full .ics file, or one line per event: 2026-08-12 14:30 | Title"
      );
      return;
    }
    putCal({ events: parsed, imported: dayKey() });
    setPaste("");
    setMsg(`Imported ${parsed.length} events.`);
  };
  const addManual = () => {
    const t = manual.trim();
    const d = new Date(when);
    if (!t || isNaN(d.getTime())) return;
    putCal({
      ...cal,
      events: [
        ...cal.events,
        { id: uid(), title: t, ts: d.getTime(), allDay: false }
      ]
    });
    setManual("");
    setWhen("");
  };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cp-two" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Upcoming \xB7 ", future.length), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, future.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "cp-empty" }, "Nothing scheduled. Add something below, or import your calendar."), future.slice(0, 25).map((e) => /* @__PURE__ */ React.createElement("div", { className: "cp-ev", key: e.id }, /* @__PURE__ */ React.createElement("span", { className: "cp-evd" }, evLabel(e.ts, e.allDay)), /* @__PURE__ */ React.createElement("span", { className: "cp-evt" }, e.title), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-x",
      onClick: () => putCal({
        ...cal,
        events: cal.events.filter((x) => x.id !== e.id)
      }),
      "aria-label": "Remove"
    },
    "\xD7"
  ))))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Add one"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      placeholder: "Event",
      value: manual,
      onChange: (e) => setManual(e.target.value),
      style: { marginBottom: 8 }
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      type: "datetime-local",
      value: when,
      onChange: (e) => setWhen(e.target.value),
      style: { marginBottom: 10 }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn primary",
      style: { width: "100%" },
      onClick: addManual
    },
    "Add event"
  )), /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Import calendar"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      className: "cp-input",
      rows: 4,
      placeholder: "Paste an .ics export, or lines like:\n2026-08-12 14:30 | Lab meeting",
      value: paste,
      onChange: (e) => setPaste(e.target.value),
      style: { marginBottom: 10, fontFamily: "var(--mono)", fontSize: 12 }
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "cp-btn", style: { width: "100%" }, onClick: importICS }, "Import (replaces list)"), msg && /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, msg), /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, "Takes a full .ics export, or one event per line as", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--mono)" } }, " YYYY-MM-DD HH:MM | Title"), ". Build an iOS Shortcut that copies your next two weeks in that format, then paste it here. Snapshot, not sync \u2014 re-run it when it drifts.")))));
}
function NowTab({ now, routine, putRoutine, tasks, goFocus, reload }) {
  const [newItem, setNewItem] = useState("");
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);
  const today = dayKey(now);
  const done = routine.log[today] || [];
  const { dayStart, dayEnd } = routine;
  const mins = now.getHours() * 60 + now.getMinutes();
  const startM = dayStart * 60;
  const endM = dayEnd * 60;
  const total = Math.max(endM - startM, 1);
  const elapsed = Math.min(Math.max(mins - startM, 0), total);
  const left = total - elapsed;
  const pct = elapsed / total * 100;
  const toggle = (id) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    putRoutine({ ...routine, log: { ...routine.log, [today]: next } });
  };
  const addItem = () => {
    const label = newItem.trim();
    if (!label) return;
    putRoutine({ ...routine, items: [...routine.items, { id: uid(), label }] });
    setNewItem("");
  };
  const removeItem = (id) => putRoutine({ ...routine, items: routine.items.filter((i) => i.id !== id) });
  const streak = (() => {
    if (!routine.items.length) return 0;
    let n = 0;
    const d = new Date(now);
    for (let i = 0; i < 400; i++) {
      const k = dayKey(d);
      const l = routine.log[k] || [];
      const all = routine.items.every((it) => l.includes(it.id));
      if (all) n++;
      else if (i > 0) break;
      d.setDate(d.getDate() - 1);
    }
    return n;
  })();
  const ticks = [];
  for (let h = dayStart; h <= dayEnd; h++) {
    const p = (h * 60 - startM) / total * 100;
    ticks.push({ h, p });
  }
  const open = tasks.items.filter((t) => !t.done).slice(0, 3);
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cp-daywrap" }, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Day remaining"), /* @__PURE__ */ React.createElement("div", { className: "cp-dayfig" }, /* @__PURE__ */ React.createElement("b", null, Math.floor(left / 60), "h ", pad(left % 60), "m"), /* @__PURE__ */ React.createElement("span", null, "of your ", dayStart, ":00\u2013", dayEnd, ":00 window")), /* @__PURE__ */ React.createElement("div", { className: "cp-track" }, /* @__PURE__ */ React.createElement("div", { className: "cp-fill", style: { width: `${pct}%` } }), /* @__PURE__ */ React.createElement("div", { className: "cp-head", style: { left: `${pct}%` } }), ticks.map(
    (t) => t.h % 2 === 0 ? /* @__PURE__ */ React.createElement(React.Fragment, { key: t.h }, /* @__PURE__ */ React.createElement("div", { className: "cp-tick", style: { left: `${t.p}%` } }), /* @__PURE__ */ React.createElement("div", { className: "cp-ticklabel", style: { left: `${t.p}%` } }, t.h)) : null
  )), /* @__PURE__ */ React.createElement("div", { className: "cp-inline", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement(
    "select",
    {
      className: "cp-select",
      value: dayStart,
      onChange: (e) => putRoutine({ ...routine, dayStart: Number(e.target.value) })
    },
    Array.from({ length: 12 }, (_, i) => i + 4).map((h) => /* @__PURE__ */ React.createElement("option", { key: h, value: h }, "Start ", h, ":00"))
  ), /* @__PURE__ */ React.createElement(
    "select",
    {
      className: "cp-select",
      value: dayEnd,
      onChange: (e) => putRoutine({ ...routine, dayEnd: Number(e.target.value) })
    },
    Array.from({ length: 8 }, (_, i) => i + 18).map((h) => /* @__PURE__ */ React.createElement("option", { key: h, value: h }, "End ", h, ":00"))
  ))), /* @__PURE__ */ React.createElement("div", { className: "cp-two" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Routine \xB7 ", done.length, "/", routine.items.length, streak > 1 && /* @__PURE__ */ React.createElement("span", { className: "cp-streak" }, "  ", streak, " day run")), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, routine.items.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "cp-empty" }, "Nothing here yet. Add your first daily item below."), routine.items.map((it) => /* @__PURE__ */ React.createElement("div", { className: "cp-row", key: it.id }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-box" + (done.includes(it.id) ? " on" : ""),
      onClick: () => toggle(it.id),
      "aria-label": it.label
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "cp-rowtext" + (done.includes(it.id) ? " done" : "") }, it.label), /* @__PURE__ */ React.createElement("button", { className: "cp-x", onClick: () => removeItem(it.id), "aria-label": "Remove" }, "\xD7"))), /* @__PURE__ */ React.createElement("div", { className: "cp-inline", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      placeholder: "Add a daily item",
      value: newItem,
      onChange: (e) => setNewItem(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && addItem()
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "cp-btn", onClick: addItem }, "Add")), (() => {
    const have = routine.items.map((i) => i.label.toLowerCase());
    const spare = SUGGESTED.filter((s) => !have.includes(s.toLowerCase()));
    if (!spare.length) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "cp-chips" }, spare.map((s) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: s,
        className: "cp-chip",
        onClick: () => putRoutine({
          ...routine,
          items: [...routine.items, { id: uid(), label: s }]
        })
      },
      "+ ",
      s
    )));
  })())), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Up next"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, open.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "cp-empty" }, "No open tasks. Capture one on the Tasks screen."), open.map((t) => /* @__PURE__ */ React.createElement("div", { className: "cp-row", key: t.id }, /* @__PURE__ */ React.createElement("span", { className: "cp-rowtext" }, t.text), /* @__PURE__ */ React.createElement("button", { className: "cp-min", onClick: () => goFocus(t.text, 25) }, "Start")))), /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Appearance"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement("div", { className: "cp-inline" }, [
    ["auto", "Auto"],
    ["light", "Light"],
    ["dark", "Dark"]
  ].map(([v, l]) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: v,
      className: "cp-btn" + ((routine.theme || "auto") === v ? " primary" : ""),
      style: { flex: 1 },
      onClick: () => putRoutine({ ...routine, theme: v })
    },
    l
  ))), /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, "Auto goes light at 07:00 and dark at 17:30.")), /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Task breakdown"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      type: "password",
      placeholder: "Anthropic API key (optional)",
      defaultValue: localStorage.getItem("cp:apikey") || "",
      onChange: (e) => {
        const v = e.target.value.trim();
        if (v) localStorage.setItem("cp:apikey", v);
        else localStorage.removeItem("cp:apikey");
      }
    }
  ), /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, 'Only needed for "Break into steps" on the Tasks screen. Stored in this browser and sent straight to Anthropic. Everything else works without it.')), /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Cloud sync"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement(SyncPanel, { reload })), /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Storage"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement(StorageHealth, null)), /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Backup"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement("div", { className: "cp-inline" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn",
      style: { flex: 1 },
      onClick: async () => {
        const b = await gatherAll();
        downloadJSON(b, `control-panel-${today}.json`);
        putRoutine({ ...routine, lastBackup: today });
        setMsg("Exported. Keep that file in iCloud or Drive.");
      }
    },
    "Export file"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn",
      style: { flex: 1 },
      onClick: () => fileRef.current && fileRef.current.click()
    },
    "Import"
  )), /* @__PURE__ */ React.createElement(
    "input",
    {
      ref: fileRef,
      type: "file",
      accept: "application/json,.json",
      style: { display: "none" },
      onChange: async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
          const text = await f.text();
          await writeAll(JSON.parse(text));
          await reload();
          setMsg("Restored from file.");
        } catch (err) {
          setMsg("That file didn't parse. It needs to be an export from here.");
        }
        e.target.value = "";
      }
    }
  ), msg && /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, msg), (() => {
    if (!routine.lastBackup)
      return /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, "No backup yet. Export once so nothing here is the only copy.");
    const days = Math.round(
      (new Date(today) - new Date(routine.lastBackup)) / 864e5
    );
    return /* @__PURE__ */ React.createElement("p", { className: "cp-note", style: days > 14 ? { color: "var(--warn)" } : void 0 }, "Last export ", routine.lastBackup, days > 14 ? ` \u2014 ${days} days ago, worth doing again.` : ".");
  })()))));
}
function TasksTab({ tasks, putTasks, goFocus }) {
  const [draft, setDraft] = useState("");
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    putTasks({
      items: [{ id: uid(), text, done: false, subs: [] }, ...tasks.items]
    });
    setDraft("");
  };
  const patch = (id, fn) => putTasks({ items: tasks.items.map((t) => t.id === id ? fn(t) : t) });
  const remove = (id) => putTasks({ items: tasks.items.filter((t) => t.id !== id) });
  const breakDown = async (task) => {
    setBusyId(task.id);
    setErr("");
    try {
      const apiKey = localStorage.getItem("cp:apikey");
      if (!apiKey) throw new Error("nokey");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1e3,
          messages: [
            {
              role: "user",
              content: `Break this task into 3-6 concrete first steps for someone who struggles to start. Each step must be a single physical action that takes under 25 minutes. The first step should be almost trivially small.

Task: "${task.text}"

Respond with ONLY a JSON array, no markdown, no preamble:
[{"text":"step","minutes":10}]`
            }
          ]
        })
      });
      const data = await res.json();
      const raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("").replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(raw);
      const subs = parsed.map((s) => ({
        id: uid(),
        text: String(s.text),
        minutes: Number(s.minutes) || 15,
        done: false
      }));
      patch(task.id, (t) => ({ ...t, subs: [...t.subs, ...subs] }));
      setOpenId(task.id);
    } catch (e) {
      setErr(
        e && e.message === "nokey" ? "No API key set. Add one under Now \u2192 Task breakdown, or write the steps yourself." : "Couldn't split that one. Try again, or add steps by hand."
      );
    } finally {
      setBusyId(null);
    }
  };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Capture"), /* @__PURE__ */ React.createElement("div", { className: "cp-inline", style: { marginBottom: 20 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      placeholder: "What's on your mind?",
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && add()
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "cp-btn primary", onClick: add }, "Add")), /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Open \xB7 ", tasks.items.filter((t) => !t.done).length), err && /* @__PURE__ */ React.createElement("div", { className: "cp-note", style: { color: "#E0697F" } }, err), tasks.items.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "cp-empty" }, "Empty. Type anything above \u2014 a half-thought counts."), tasks.items.map((t) => /* @__PURE__ */ React.createElement("div", { className: "cp-task", key: t.id }, /* @__PURE__ */ React.createElement("div", { className: "cp-taskhead" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-box" + (t.done ? " on" : ""),
      onClick: () => patch(t.id, (x) => ({ ...x, done: !x.done })),
      "aria-label": t.text
    }
  ), /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "cp-rowtext" + (t.done ? " done" : ""),
      onClick: () => setOpenId(openId === t.id ? null : t.id),
      style: { cursor: "pointer" }
    },
    t.text
  ), /* @__PURE__ */ React.createElement("button", { className: "cp-x", onClick: () => remove(t.id), "aria-label": "Delete" }, "\xD7")), (openId === t.id || t.subs.length > 0) && /* @__PURE__ */ React.createElement("div", { className: "cp-sub" }, t.subs.map((s) => /* @__PURE__ */ React.createElement("div", { className: "cp-subrow", key: s.id }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-box" + (s.done ? " on" : ""),
      style: { width: 16, height: 16 },
      onClick: () => patch(t.id, (x) => ({
        ...x,
        subs: x.subs.map(
          (y) => y.id === s.id ? { ...y, done: !y.done } : y
        )
      })),
      "aria-label": s.text
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "cp-subtext" + (s.done ? " done" : "") }, s.text), /* @__PURE__ */ React.createElement("button", { className: "cp-min", onClick: () => goFocus(s.text, s.minutes) }, s.minutes, "m"))), openId === t.id && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn ghost",
      disabled: busyId === t.id,
      onClick: () => breakDown(t)
    },
    busyId === t.id ? "Splitting\u2026" : "Break into steps"
  ))))));
}
const PRESETS = [10, 25, 45];
function FocusTab({ target, setTarget, pendingMin, clearPending }) {
  const [minutes, setMinutes] = useState(pendingMin || 25);
  const [left, setLeft] = useState((pendingMin || 25) * 60);
  const [running, setRunning] = useState(false);
  const endRef = useRef(null);
  useEffect(() => {
    if (pendingMin) {
      setMinutes(pendingMin);
      setLeft(pendingMin * 60);
      setRunning(false);
      clearPending();
    }
  }, [pendingMin, clearPending]);
  useEffect(() => {
    if (!running) return;
    endRef.current = Date.now() + left * 1e3;
    const i = setInterval(() => {
      const rem = Math.round((endRef.current - Date.now()) / 1e3);
      if (rem <= 0) {
        setLeft(0);
        setRunning(false);
        beep();
        clearInterval(i);
      } else setLeft(rem);
    }, 250);
    return () => clearInterval(i);
  }, [running]);
  const pick = (m) => {
    setMinutes(m);
    setLeft(m * 60);
    setRunning(false);
  };
  const total = minutes * 60;
  const frac = total ? left / total : 0;
  const R = 88;
  const C = 2 * Math.PI * R;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cp-narrow" }, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Focus"), /* @__PURE__ */ React.createElement("div", { className: "cp-presets" }, PRESETS.map((m) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: m,
      className: "cp-btn" + (minutes === m ? " sel" : ""),
      onClick: () => pick(m)
    },
    m,
    "m"
  ))), /* @__PURE__ */ React.createElement("div", { className: "cp-inline", style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn",
      style: { flex: 1 },
      disabled: running,
      onClick: () => pick(Math.max(1, minutes - 5))
    },
    "\u22125"
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      type: "number",
      inputMode: "numeric",
      min: 1,
      max: 240,
      value: minutes,
      disabled: running,
      onChange: (e) => {
        const v = parseInt(e.target.value, 10);
        if (!isNaN(v)) pick(Math.min(240, Math.max(1, v)));
      },
      style: { flex: 2, textAlign: "center", fontFamily: "var(--mono)" }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn",
      style: { flex: 1 },
      disabled: running,
      onClick: () => pick(Math.min(240, minutes + 5))
    },
    "+5"
  )), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      placeholder: "What are you working on?",
      value: target || "",
      onChange: (e) => setTarget(e.target.value),
      style: { marginBottom: 4 }
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "cp-ringwrap" }, /* @__PURE__ */ React.createElement("svg", { width: "210", height: "210", viewBox: "0 0 210 210", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement(
    "circle",
    {
      cx: "105",
      cy: "105",
      r: R,
      fill: "none",
      stroke: "var(--line)",
      strokeWidth: "10"
    }
  ), /* @__PURE__ */ React.createElement(
    "circle",
    {
      cx: "105",
      cy: "105",
      r: R,
      fill: "none",
      stroke: running ? "var(--signal)" : "var(--live)",
      strokeWidth: "10",
      strokeLinecap: "round",
      strokeDasharray: C,
      strokeDashoffset: C * (1 - frac),
      transform: "rotate(-90 105 105)"
    }
  ), /* @__PURE__ */ React.createElement(
    "text",
    {
      x: "105",
      y: "112",
      textAnchor: "middle",
      fill: "var(--ink)",
      style: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 38,
        fontVariantNumeric: "tabular-nums"
      }
    },
    pad(Math.floor(left / 60)),
    ":",
    pad(left % 60)
  )), /* @__PURE__ */ React.createElement("div", { className: "cp-ringsub" }, left === 0 ? "Done" : running ? "Running" : "Ready")), /* @__PURE__ */ React.createElement("div", { className: "cp-inline" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn primary",
      style: { flex: 2 },
      onClick: () => left === 0 ? pick(minutes) : setRunning(!running)
    },
    left === 0 ? "Reset" : running ? "Pause" : "Start"
  ), /* @__PURE__ */ React.createElement("button", { className: "cp-btn", style: { flex: 1 }, onClick: () => pick(minutes) }, "Reset")), /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, "The ring drains anticlockwise so you can see time going, not just read it. Keep this screen open \u2014 a backgrounded browser tab may run the countdown slow.")));
}
function GymTab({ gym, putGym }) {
  const [exercise, setExercise] = useState(gym.exercises[0] || "");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [custom, setCustom] = useState("");
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState("log");
  const today = dayKey();
  const todaySets = gym.sets.filter((s) => s.date === today);
  const last = (() => {
    const prior = gym.sets.filter((s) => s.exercise === exercise && s.date !== today).sort((a, b) => a.date < b.date ? 1 : -1);
    if (!prior.length) return null;
    const d = prior[0].date;
    return prior.filter((s) => s.date === d);
  })();
  const logSet = () => {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (!exercise || isNaN(w) || isNaN(r)) return;
    putGym({
      ...gym,
      sets: [
        ...gym.sets,
        { id: uid(), date: today, exercise, weight: w, reps: r, t: Date.now() }
      ]
    });
    setReps("");
  };
  const addExercise = () => {
    const name = custom.trim();
    if (!name || gym.exercises.includes(name)) return;
    putGym({ ...gym, exercises: [...gym.exercises, name].sort() });
    setExercise(name);
    setCustom("");
    setAdding(false);
  };
  const removeSet = (id) => putGym({ ...gym, sets: gym.sets.filter((s) => s.id !== id) });
  if (view === "progress")
    return /* @__PURE__ */ React.createElement(GymProgress, { gym, view, setView });
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cp-presets" }, /* @__PURE__ */ React.createElement("button", { className: "cp-btn sel", onClick: () => setView("log") }, "Log"), /* @__PURE__ */ React.createElement("button", { className: "cp-btn", onClick: () => setView("progress") }, "Progress")), /* @__PURE__ */ React.createElement("div", { className: "cp-two" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Log a set"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement(
    "select",
    {
      className: "cp-select",
      value: exercise,
      onChange: (e) => setExercise(e.target.value),
      style: { marginBottom: 8 }
    },
    gym.exercises.map((e) => /* @__PURE__ */ React.createElement("option", { key: e, value: e }, e))
  ), !adding ? /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn ghost",
      style: { width: "100%", marginBottom: 12 },
      onClick: () => setAdding(true)
    },
    "+ New exercise"
  ) : /* @__PURE__ */ React.createElement("div", { className: "cp-inline", style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      placeholder: "Exercise name",
      value: custom,
      onChange: (e) => setCustom(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && addExercise()
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "cp-btn", onClick: addExercise }, "Save")), /* @__PURE__ */ React.createElement("div", { className: "cp-grid2", style: { marginBottom: 10 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      type: "number",
      inputMode: "decimal",
      placeholder: "kg",
      value: weight,
      onChange: (e) => setWeight(e.target.value)
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      type: "number",
      inputMode: "numeric",
      placeholder: "reps",
      value: reps,
      onChange: (e) => setReps(e.target.value),
      onKeyDown: (e) => e.key === "Enter" && logSet()
    }
  )), /* @__PURE__ */ React.createElement("button", { className: "cp-btn primary", style: { width: "100%" }, onClick: logSet }, "Log set"), last && /* @__PURE__ */ React.createElement("div", { className: "cp-last" }, "Last ", last[0].date, " \xB7 ", last.map((s) => `${s.weight}\xD7${s.reps}`).join("  ")))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Today \xB7 ", todaySets.length, " sets"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, todaySets.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "cp-empty" }, "Nothing logged today."), todaySets.map((s, i) => /* @__PURE__ */ React.createElement("div", { className: "cp-setrow", key: s.id }, /* @__PURE__ */ React.createElement("span", { className: "cp-setnum" }, pad(i + 1)), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, marginLeft: 12 } }, s.exercise), /* @__PURE__ */ React.createElement("span", { className: "cp-setnum", style: { marginRight: 10 } }, s.weight, " \xD7 ", s.reps), /* @__PURE__ */ React.createElement("button", { className: "cp-x", onClick: () => removeSet(s.id), "aria-label": "Remove" }, "\xD7")))))));
}
function GymProgress({ gym, setView }) {
  const [pick, setPick] = useState("__all__");
  const rows = pick === "__all__" ? gym.sets : gym.sets.filter((s) => s.exercise === pick);
  const byDay = {};
  for (const s of rows) {
    byDay[s.date] = (byDay[s.date] || 0) + s.weight * s.reps;
  }
  const days = Object.keys(byDay).sort().map((d) => ({ date: d, vol: Math.round(byDay[d]) }));
  const win = days.slice(-12);
  const latest = win.length ? win[win.length - 1] : null;
  const prev = win.length > 1 ? win[win.length - 2] : null;
  const stepDelta = latest && prev ? latest.vol - prev.vol : null;
  const spanDelta = win.length > 1 ? latest.vol - win[0].vol : null;
  const W = 320;
  const H = 130;
  const PAD = 22;
  const max = Math.max(...win.map((d) => d.vol), 1);
  const bw = win.length ? (W - PAD * 2) / win.length : 0;
  const fmt = (n) => n > 0 ? `+${n}` : `${n}`;
  const cls = (n) => n > 0 ? "cp-net cp-up" : n < 0 ? "cp-net cp-down" : "cp-net";
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cp-presets" }, /* @__PURE__ */ React.createElement("button", { className: "cp-btn", onClick: () => setView("log") }, "Log"), /* @__PURE__ */ React.createElement("button", { className: "cp-btn sel", onClick: () => setView("progress") }, "Progress")), /* @__PURE__ */ React.createElement(
    "select",
    {
      className: "cp-select",
      value: pick,
      onChange: (e) => setPick(e.target.value),
      style: { marginBottom: 16 }
    },
    /* @__PURE__ */ React.createElement("option", { value: "__all__" }, "All exercises \u2014 total volume"),
    gym.exercises.map((e) => /* @__PURE__ */ React.createElement("option", { key: e, value: e }, e))
  ), win.length < 2 ? /* @__PURE__ */ React.createElement("div", { className: "cp-empty" }, "Not enough logged yet. Two separate sessions and the trend appears here.") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cp-netrow" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: cls(stepDelta) }, fmt(stepDelta)), /* @__PURE__ */ React.createElement("span", { className: "cp-goalmeta" }, "kg vs last session")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: cls(spanDelta) }, fmt(spanDelta)), /* @__PURE__ */ React.createElement("span", { className: "cp-goalmeta" }, "kg over ", win.length, " sessions"))), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, /* @__PURE__ */ React.createElement("svg", { className: "cp-chart", viewBox: `0 0 ${W} ${H}`, role: "img" }, /* @__PURE__ */ React.createElement(
    "line",
    {
      x1: PAD,
      y1: H - PAD,
      x2: W - PAD,
      y2: H - PAD,
      stroke: "var(--line)",
      strokeWidth: "1"
    }
  ), win.map((d, i) => {
    const h = d.vol / max * (H - PAD * 2);
    const x = PAD + i * bw + bw * 0.18;
    const up = i === 0 || d.vol >= win[i - 1].vol;
    return /* @__PURE__ */ React.createElement(
      "rect",
      {
        key: d.date,
        x,
        y: H - PAD - h,
        width: bw * 0.64,
        height: Math.max(h, 1),
        rx: "1.5",
        fill: up ? "var(--live)" : "var(--warn)",
        opacity: i === win.length - 1 ? 1 : 0.55
      }
    );
  }), /* @__PURE__ */ React.createElement(
    "text",
    {
      x: PAD,
      y: 13,
      fill: "var(--dim)",
      style: { fontFamily: "var(--mono)", fontSize: 9 }
    },
    max,
    " kg"
  ), /* @__PURE__ */ React.createElement(
    "text",
    {
      x: PAD,
      y: H - 6,
      fill: "var(--dim)",
      style: { fontFamily: "var(--mono)", fontSize: 9 }
    },
    win[0].date.slice(5)
  ), /* @__PURE__ */ React.createElement(
    "text",
    {
      x: W - PAD,
      y: H - 6,
      textAnchor: "end",
      fill: "var(--dim)",
      style: { fontFamily: "var(--mono)", fontSize: 9 }
    },
    latest.date.slice(5)
  ))), /* @__PURE__ */ React.createElement("span", { className: "cp-label" }, "Sessions"), /* @__PURE__ */ React.createElement("div", { className: "cp-card" }, [...win].reverse().map((d, i, arr) => {
    const before = arr[i + 1];
    const delta = before ? d.vol - before.vol : null;
    return /* @__PURE__ */ React.createElement("div", { className: "cp-setrow", key: d.date }, /* @__PURE__ */ React.createElement("span", { className: "cp-setnum" }, d.date.slice(5)), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, marginLeft: 14 } }, d.vol, " kg"), delta !== null && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "cp-setnum",
        style: { color: delta >= 0 ? "var(--live)" : "var(--warn)" }
      },
      fmt(delta)
    ));
  }))), /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, "Volume is weight \xD7 reps, summed per session. It's a blunt measure \u2014 it rises if you add a set of anything \u2014 so read it alongside what you actually lifted rather than as a verdict on its own."));
}
function StorageHealth() {
  const [state, setState] = useState({ checked: false });
  useEffect(() => {
    (async () => {
      const persisted = await requestPersistence();
      let quota = null;
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          quota = est.usage != null ? Math.round(est.usage / 1024) : null;
        }
      } catch (e) {
      }
      const mirror = await idbGet("cp:tasks") !== null;
      const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
      setState({ checked: true, persisted, quota, mirror, standalone });
    })();
  }, []);
  if (!state.checked) return /* @__PURE__ */ React.createElement("div", { className: "cp-note" }, "Checking\u2026");
  const Row = ({ ok, children }) => /* @__PURE__ */ React.createElement("div", { className: "cp-row" }, /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "cp-box",
      style: {
        background: ok ? "var(--live)" : "var(--line)",
        borderColor: ok ? "var(--live)" : "var(--line)",
        cursor: "default"
      }
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "cp-rowtext", style: { fontSize: 14 } }, children));
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Row, { ok: state.persisted }, state.persisted ? "Browser marked this data as persistent" : "Not marked persistent \u2014 the browser may evict it"), /* @__PURE__ */ React.createElement(Row, { ok: state.mirror }, state.mirror ? "Second copy in IndexedDB" : "No mirror copy yet"), /* @__PURE__ */ React.createElement(Row, { ok: state.standalone }, state.standalone ? "Running as an installed app" : "Running in a browser tab \u2014 install to the home screen"), /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, state.quota != null ? `About ${state.quota} KB stored. ` : "", "None of this is a guarantee. The exported file is the only copy that survives a lost phone."));
}
function SyncPanel({ reload }) {
  const [status, setStatus] = useState(Sync.status);
  const [detail, setDetail] = useState("");
  const [user, setUser] = useState(null);
  const cfg = Sync.config();
  const [url, setUrl] = useState(cfg ? cfg.url : "");
  const [key, setKey] = useState(cfg ? cfg.key : "");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => Sync.on((s, d) => {
    setStatus(s);
    setDetail(d);
  }), []);
  useEffect(() => {
    Sync.user().then(setUser);
  }, []);
  const label = {
    off: "Not set up",
    signedout: "Signed out",
    idle: "Up to date",
    syncing: "Syncing\u2026",
    error: "Problem",
    offline: "Offline \u2014 will retry"
  }[status] || status;
  const dot = {
    idle: "var(--live)",
    syncing: "var(--signal)",
    error: "var(--warn)",
    offline: "var(--signal)"
  }[status] || "var(--line)";
  const save = () => {
    Sync.setConfig(url, key);
    setErr("");
    Sync.init();
    Sync.user().then(setUser);
  };
  const auth = async (mode) => {
    setBusy(true);
    setErr("");
    try {
      const u = await Sync.signIn(email.trim(), pw, mode);
      setUser(u);
      setPw("");
      await Sync.pull(reload);
    } catch (e) {
      setErr(e.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cp-row" }, /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "cp-box",
      style: { background: dot, borderColor: dot, cursor: "default" }
    }
  ), /* @__PURE__ */ React.createElement("span", { className: "cp-rowtext", style: { fontSize: 14 } }, label, detail ? ` \xB7 ${detail}` : "")), !user && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      placeholder: "Project URL (https://xxxx.supabase.co)",
      value: url,
      onChange: (e) => setUrl(e.target.value),
      style: { marginTop: 10, marginBottom: 8 }
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      placeholder: "Anon public key",
      value: key,
      onChange: (e) => setKey(e.target.value),
      style: { marginBottom: 8 }
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "cp-btn", style: { width: "100%" }, onClick: save }, "Save project"), /* @__PURE__ */ React.createElement("div", { style: { height: 14 } }), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      type: "email",
      autoComplete: "email",
      placeholder: "Email",
      value: email,
      onChange: (e) => setEmail(e.target.value),
      style: { marginBottom: 8 }
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "cp-input",
      type: "password",
      autoComplete: "current-password",
      placeholder: "Password",
      value: pw,
      onChange: (e) => setPw(e.target.value),
      style: { marginBottom: 10 }
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "cp-inline" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn primary",
      style: { flex: 1 },
      disabled: busy,
      onClick: () => auth("signin")
    },
    "Sign in"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn",
      style: { flex: 1 },
      disabled: busy,
      onClick: () => auth("signup")
    },
    "Create"
  ))), user && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, "Signed in as ", user.email), /* @__PURE__ */ React.createElement("div", { className: "cp-inline", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn",
      style: { flex: 1 },
      onClick: () => Sync.pull(reload)
    },
    "Sync now"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "cp-btn quiet",
      style: { flex: 1 },
      onClick: async () => {
        await Sync.signOut();
        setUser(null);
      }
    },
    "Sign out"
  ))), err && /* @__PURE__ */ React.createElement("p", { className: "cp-note", style: { color: "var(--warn)" } }, err), /* @__PURE__ */ React.createElement("p", { className: "cp-note" }, "Last device to save wins. Editing the same day on two devices at once can lose one side's changes \u2014 there is no merge."));
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(ControlPanel));
