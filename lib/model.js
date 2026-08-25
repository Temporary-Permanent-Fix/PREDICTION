// Predikčný model – port zo Streamlit verzie.
// Predikcia = úroveň s trendom × faktor dňa v týždni × faktor dňa v mesiaci × koeficient udalostí.

export const TYPY_VYNIMIEK = [
  "Nábeh skladu / rozbeh prevádzky",
  "Výpadok systému (WMS/AS)",
  "Výpadok technológie (conveyor/porty)",
  "Nedostatok personálu",
  "Sviatok / skrátená prevádzka",
  "Iné",
];

export const TYPY_UDALOSTI = [
  "Výplatný termín", "Alza dni", "AlzaPlus+ zľavy", "Black Friday",
  "Mega zľavy", "Akcia / kampaň", "Sviatok", "Iné",
];

// --- dátumové utility (UTC, deň = 'YYYY-MM-DD') -----------------------------
const toDate = (s) => new Date(s + "T00:00:00Z");
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * 86400000));
const dayDiff = (a, b) => Math.round((toDate(a) - toDate(b)) / 86400000);
export const dow = (s) => (toDate(s).getUTCDay() + 6) % 7; // 0 = pondelok
const dom = (s) => toDate(s).getUTCDate();
export const DNI = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];

// Prevádzkový deň: 06:00 – 05:59 nasledujúceho dňa (zmeny 6-6).
// Hodiny 0–5 patria do PREDCHÁDZAJÚCEHO prevádzkového dňa.
export const OP_START = 6;
export const opShift = (rows) => rows.map((r) =>
  (+r.hodina >= OP_START ? r : { ...r, datum: addDays(r.datum, -1) }));
export const OP_HOURS = Array.from({ length: 24 }, (_, i) => (OP_START + i) % 24);
export const opIdx = (h) => (h - OP_START + 24) % 24;
// posledný prevádzkový deň je úplný, len ak má aj nočné hodiny (0–5 z ďalšieho kalendárneho dňa)
export function dropIncompleteLastOpDay(shiftedRows) {
  if (!shiftedRows.length) return shiftedRows;
  const maxD = shiftedRows.reduce((a, r) => (r.datum > a ? r.datum : a), "");
  const hasNight = shiftedRows.some((r) => r.datum === maxD && +r.hodina < OP_START);
  return hasNight ? shiftedRows : shiftedRows.filter((r) => r.datum !== maxD);
}
export const opIdxEnd = (H) => (H === OP_START ? 24 : opIdx(H));
export const fmtD = (s) => { const d = toDate(s); return `${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.`; };

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// --- agregácie --------------------------------------------------------------
// hourly: [{datum, hodina, joblines}], zaznamy filtrované na zdroj
export function buildDaily(hourlyRows, zaznamy) {
  const perDay = new Map();
  const userDays = new Set(zaznamy.map((z) => z.datum));
  for (const r of hourlyRows) {
    if (userDays.has(r.datum)) continue; // záznam používateľa prepíše deň
    perDay.set(r.datum, (perDay.get(r.datum) || 0) + (+r.joblines || 0));
  }
  const perUser = new Map();
  for (const z of zaznamy) perUser.set(z.datum, (perUser.get(z.datum) || 0) + (+z.joblines || 0));
  for (const [d, v] of perUser) perDay.set(d, v);
  return [...perDay.entries()]
    .map(([datum, jbl]) => ({ datum, jbl }))
    .filter((r) => r.jbl > 0)
    .sort((a, b) => (a.datum < b.datum ? -1 : 1));
}

export function mergedHourly(hourlyRows, zaznamy) {
  const userDays = new Set(zaznamy.filter((z) => z.hodina !== "" && z.hodina != null).map((z) => z.datum));
  const base = hourlyRows.filter((r) => !userDays.has(r.datum));
  const extra = zaznamy
    .filter((z) => z.hodina !== "" && z.hodina != null)
    .map((z) => ({ datum: z.datum, hodina: +z.hodina, joblines: +z.joblines || 0 }));
  return [...base.map((r) => ({ datum: r.datum, hodina: +r.hodina, joblines: +r.joblines || 0 })), ...extra];
}

export function eventMult(datum, udalosti) {
  let m = 1;
  for (const u of udalosti) if (u.od <= datum && datum <= u.do) m *= +u.koeficient || 1;
  return m;
}

// --- model ------------------------------------------------------------------
export function fitModel(daily, vynimkyDates, udalosti) {
  const excl = new Set(vynimkyDates);
  let df = daily.filter((r) => !excl.has(r.datum))
    .map((r) => ({ ...r, adj: r.jbl / eventMult(r.datum, udalosti) }));

  // 1) DOW faktory – medián posledných 56 dní
  const recent = df.slice(-56);
  const overall = median(recent.map((r) => r.adj));
  const dowF = [];
  for (let i = 0; i < 7; i++) {
    const v = recent.filter((r) => dow(r.datum) === i).map((r) => r.adj);
    dowF[i] = v.length ? clip(median(v) / overall, 0.6, 1.4) : 1;
  }

  // 2) faktor dňa v mesiaci – reziduál po DOW, normalizovaný v rámci mesiaca, vyhladený
  const byMonth = new Map();
  for (const r of df) {
    const mes = r.datum.slice(0, 7);
    if (!byMonth.has(mes)) byMonth.set(mes, []);
    byMonth.get(mes).push(r.adj / dowF[dow(r.datum)]);
  }
  const monthMed = new Map([...byMonth].map(([m, v]) => [m, median(v)]));
  const domVals = Array.from({ length: 32 }, () => []);
  for (const r of df) {
    const resN = r.adj / dowF[dow(r.datum)] / monthMed.get(r.datum.slice(0, 7));
    domVals[dom(r.datum)].push(resN);
  }
  let domRaw = [];
  for (let d = 1; d <= 31; d++) domRaw[d] = domVals[d].length ? median(domVals[d]) : NaN;
  // interpolácia dier + rolling(3) + clip
  for (let d = 1; d <= 31; d++) if (isNaN(domRaw[d])) {
    let lo = d - 1, hi = d + 1;
    while (lo > 1 && isNaN(domRaw[lo])) lo--;
    while (hi < 31 && isNaN(domRaw[hi])) hi++;
    domRaw[d] = !isNaN(domRaw[lo]) && !isNaN(domRaw[hi]) ? (domRaw[lo] + domRaw[hi]) / 2 : (domRaw[lo] || domRaw[hi] || 1);
  }
  const domF = [];
  for (let d = 1; d <= 31; d++) {
    const w = [domRaw[d - 1], domRaw[d], domRaw[d + 1]].filter((x) => x != null && !isNaN(x));
    domF[d] = clip(w.reduce((a, b) => a + b, 0) / w.length, 0.8, 1.25);
  }

  // 3) úroveň + tlmený trend – vážená lineárna regresia na posledných 42 dňoch
  const tail = df.slice(-42).map((r) => ({ ...r, level: r.adj / (dowF[dow(r.datum)] * domF[dom(r.datum)]) }));
  const x0 = tail.length ? tail[0].datum : iso(new Date());
  const xs = tail.map((r) => dayDiff(r.datum, x0));
  const ys = tail.map((r) => r.level);
  const ws = tail.map((_, i) => 0.3 + (0.7 * i) / Math.max(tail.length - 1, 1));
  let slope = 0, intercept = ys.length ? ys[ys.length - 1] : 0;
  if (tail.length >= 10) {
    const sw = ws.reduce((a, b) => a + b, 0);
    const mx = xs.reduce((a, x, i) => a + x * ws[i], 0) / sw;
    const my = ys.reduce((a, y, i) => a + y * ws[i], 0) / sw;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += ws[i] * (xs[i] - mx) * (ys[i] - my); den += ws[i] * (xs[i] - mx) ** 2; }
    slope = den ? num / den : 0;
    intercept = my - slope * mx;
  }
  const lastDate = tail.length ? tail[tail.length - 1].datum : iso(new Date());
  const levelNow = slope * dayDiff(lastDate, x0) + intercept;

  // 4) retrospektívne očakávania – kĺzavý medián úrovne (28, center, min 7)
  const all = daily.map((r) => {
    const ev = eventMult(r.datum, udalosti);
    const fac = dowF[dow(r.datum)] * domF[dom(r.datum)];
    return { datum: r.datum, jbl: r.jbl, ev, fac, level: excl.has(r.datum) ? NaN : r.jbl / ev / fac };
  });
  const expectedHist = {};
  for (let i = 0; i < all.length; i++) {
    const win = all.slice(Math.max(0, i - 14), i + 14).map((r) => r.level).filter((v) => !isNaN(v));
    if (win.length >= 7) expectedHist[all[i].datum] = median(win) * all[i].fac * all[i].ev;
  }

  // 5) variabilita rezíduí (80 % interval) + defaulty koeficientov
  const devs = all.filter((r) => expectedHist[r.datum] && !excl.has(r.datum))
    .map((r) => r.jbl / expectedHist[r.datum] - 1);
  const residStd = devs.length ? Math.sqrt(devs.reduce((a, d) => a + d * d, 0) / devs.length) : 0.15;
  const downs = devs.filter((d) => d <= -0.15);
  const paydayVals = []; for (let d = 10; d <= 16; d++) paydayVals.push(domF[d]);

  // 6) krátkodobá korekcia odchýlky – medián pomeru skutočnosť/model za posledných
  //    5 platných dní. Kotví predikciu na aktuálny režim (promo, posun úrovne),
  //    kým ho pomalšie zložky modelu dobehnú. Do budúcnosti sa vytráca.
  const rawPredict = (datum) => {
    const ahead = Math.max(dayDiff(datum, lastDate), 0);
    const trend = slope * Math.pow(0.977, ahead) * ahead;
    return Math.max(levelNow + trend, 0) * dowF[dow(datum)] * domF[dom(datum)] * eventMult(datum, udalosti);
  };
  const last5 = df.slice(-5);
  const ratios = last5.map((r) => r.jbl / rawPredict(r.datum)).filter((x) => isFinite(x) && x > 0);
  const corr = ratios.length >= 4 ? clip(median(ratios), 0.85, 1.2) : 1;

  const defaultKoef = {
    // z log-lineárnej regresie na reálnom promo kalendári feb–jún 2026
    "Alza dni": 1.05,
    "Mega zľavy": 1.0,
    "AlzaPlus+ zľavy": 1.0,
    "Black Friday": 1.36, // z vznikov: BF víkend 2025 vs. okolité týždne
    "Akcia / kampaň": 1.1,
    "Výplatný termín": +(paydayVals.reduce((a, b) => a + b, 0) / paydayVals.length).toFixed(2),
    "Sviatok": downs.length >= 3 ? +(1 + median(downs)).toFixed(2) : 0.78,
    "Iné": 1.0,
  };

  return { dowF, domF, levelNow, slope, damp: 0.977, corr, lastDate, trainDays: df.length, residStd, expectedHist, defaultKoef };
}

export function predictDay(datum, model, udalosti) {
  const ahead = Math.max(dayDiff(datum, model.lastDate), 0);
  const trend = model.slope * Math.pow(model.damp, ahead) * ahead;
  const level = Math.max(model.levelNow + trend, 0);
  // krátkodobá korekcia sa do budúcnosti vytráca (~50 % po 10 dňoch)
  const k = 1 + ((model.corr ?? 1) - 1) * Math.pow(0.93, ahead);
  return level * model.dowF[dow(datum)] * model.domF[dom(datum)] * eventMult(datum, udalosti) * k;
}

export function expectedFor(datum, model, udalosti) {
  return model.expectedHist[datum] ?? predictDay(datum, model, udalosti);
}

// hodinový profil (podiel dňa) – pracovný deň / víkend, posledných 42 dní
export function hourlyProfile(hourlyRows, vynimkyDates) {
  const uniform = { false: Array(24).fill(1 / 24), true: Array(24).fill(1 / 24) };
  const excl = new Set(vynimkyDates);
  const rows = hourlyRows.filter((r) => !excl.has(r.datum));
  if (!rows.length) return { ...uniform, rovnomerny: true };
  const maxD = rows.reduce((a, r) => (r.datum > a ? r.datum : a), "0000-00-00");
  // súčty za okno; hodiny mimo 0–23 (prázdne, textové) sa ignorujú
  const sucty = (odDatumu) => {
    const acc = { false: Array(24).fill(0), true: Array(24).fill(0) };
    for (const r of rows) {
      if (odDatumu && r.datum < odDatumu) continue;
      if (r.hodina === "" || r.hodina == null) continue;
      const h = +r.hodina;
      if (!Number.isInteger(h) || h < 0 || h > 23) continue;
      acc[dow(r.datum) >= 5][h] += +r.joblines || 0;
    }
    return acc;
  };
  let acc = sucty(addDays(maxD, -42));
  const prazdne = (a) => a.false.reduce((x, y) => x + y, 0) <= 0 && a.true.reduce((x, y) => x + y, 0) <= 0;
  // ak v poslednom okne nie sú použiteľné hodinové dáta, vezmi celú históriu
  if (prazdne(acc)) acc = sucty(null);
  const prof = {};
  for (const k of ["false", "true"]) {
    const s = acc[k].reduce((a, b) => a + b, 0);
    // víkendový profil bez dát doplní pracovný a naopak – rovnomerný je až posledná možnosť
    prof[k] = s > 0 ? acc[k].map((v) => v / s) : null;
  }
  const nahrada = prof.false || prof.true || Array(24).fill(1 / 24);
  const vysledok = { false: prof.false || nahrada, true: prof.true || nahrada };
  // rovnomerný profil = nenašli sa použiteľné hodinové dáta (príznak pre appku)
  if (!prof.false && !prof.true) vysledok.rovnomerny = true;
  return vysledok;
}

// --- prepočet predikcie (intradenný) ---------------------------------------
export function intraday(hourlyRows, daily, vynimkyDates, datum, H, vznik, mode, refDay) {
  const excl = new Set(vynimkyDates);
  const valid = daily.filter((r) => !excl.has(r.datum) && r.datum < datum).map((r) => r.datum);
  let compDays;
  if (mode === "dow") compDays = valid.filter((d) => dow(d) === dow(datum)).slice(-4);
  else if (mode === "last14") compDays = valid.slice(-14);
  else compDays = refDay ? [refDay] : [];
  const set = new Set(compDays);
  const per = new Map();
  for (const r of hourlyRows) {
    if (!set.has(r.datum)) continue;
    const p = per.get(r.datum) || { cum: 0, tot: 0 };
    p.tot += +r.joblines || 0;
    if (opIdx(+r.hodina) < opIdxEnd(H)) p.cum += +r.joblines || 0;
    per.set(r.datum, p);
  }
  const comp = [...per.entries()]
    .map(([d, p]) => ({ datum: d, cum: p.cum, tot: p.tot, share: p.tot ? p.cum / p.tot : 0 }))
    .filter((c) => c.tot > 0)
    .sort((a, b) => (a.datum > b.datum ? -1 : 1));
  const shares = comp.map((c) => c.share).filter((s) => s > 0);
  const shareMed = median(shares);
  const eod = vznik > 0 && shareMed > 0 ? vznik / shareMed : null;
  return {
    comp, shareMed,
    eod,
    eodLo: eod && shares.length ? vznik / Math.max(...shares) : null,
    eodHi: eod && shares.length ? vznik / Math.min(...shares) : null,
  };
}

// --- čiastočné (hodinové) výnimky a backlog ---------------------------------
// vynimky.csv môže mať stĺpec `hodiny` (napr. "8,9,10") – anomália platí len pre ne.
export function parseVynimky(vynRows) {
  const full = [], part = [];
  for (const v of vynRows || []) {
    const hs = String(v.hodiny || "").split(",").map((x) => parseInt(x, 10)).filter((x) => x >= 0 && x <= 23);
    if (hs.length) part.push({ datum: v.datum, hodiny: hs, typ: v.typ });
    else full.push(v.datum);
  }
  return { full, part };
}

// Deň s hodinovou anomáliou sa nevyhadzuje: postihnuté hodiny sa dopočítajú
// z nepostihnutých cez hodinový profil (clean = nepostihnuté / (1 - podiel postihnutých)).
// Ak deň nemá hodinové dáta alebo je postihnutých >85 % objemu, vylúči sa celý.
export function adjustPartialDays(daily, hourlyRows, part, prof) {
  if (!part.length) return { daily, extraExclude: [] };
  const byDay = new Map();
  for (const r of hourlyRows) {
    if (!byDay.has(r.datum)) byDay.set(r.datum, new Map());
    const m = byDay.get(r.datum);
    m.set(+r.hodina, (m.get(+r.hodina) || 0) + (+r.joblines || 0));
  }
  const extraExclude = [];
  const adj = daily.map((d) => ({ ...d }));
  for (const p of part) {
    const i = adj.findIndex((r) => r.datum === p.datum);
    if (i < 0) continue;
    const hrs = byDay.get(p.datum);
    const pr = prof[String(dow(p.datum) >= 5)];
    const affShare = p.hodiny.reduce((a, h) => a + (pr[h] || 0), 0);
    if (!hrs || affShare >= 0.85 || affShare <= 0) { extraExclude.push(p.datum); continue; }
    let unaff = 0;
    for (const [h, v] of hrs) if (!p.hodiny.includes(h)) unaff += v;
    const clean = unaff / (1 - affShare);
    adj[i].jbl = Math.max(adj[i].jbl, clean);
  }
  return { daily: adj, extraExclude };
}

// --- skutočný výkon z odpracovaných hodín ---------------------------------
// Výkon (JBL na osobu a hodinu) počítaný priamo z výkazu, nie z normy.
// Slúži na porovnanie s nastavenou normou a ako podklad pre potrebné hodiny.
export function skutocnyVykon(manhours, proces, dni = 60) {
  const rs = (manhours || []).filter((r) => r.proces === proces && +r.hodiny > 0 && +r.joblines > 0);
  if (!rs.length) return null;
  const posledne = rs.slice(-dni);
  const h = posledne.reduce((a, r) => a + +r.hodiny, 0);
  const j = posledne.reduce((a, r) => a + +r.joblines, 0);
  if (!(h > 0)) return null;
  return { vykon: j / h, hodiny: h / posledne.length, objem: j / posledne.length, dni: posledne.length };
}

// Pomer objemu procesu k objemu príjmu (potvrdzovanie ide z príjmu).
export function pomerKPrijmu(manhours, proces, dni = 90) {
  const mapa = new Map();
  for (const r of manhours || []) {
    if (!mapa.has(r.datum)) mapa.set(r.datum, {});
    mapa.get(r.datum)[r.proces] = +r.joblines || 0;
  }
  const pomery = [];
  for (const [, v] of [...mapa].slice(-dni)) {
    if (v[proces] > 0 && v["Príjem"] > 0) pomery.push(v[proces] / v["Príjem"]);
  }
  return pomery.length >= 10 ? median(pomery) : null;
}

// --- štrukturálne zlomy -----------------------------------------------------
// Trvalá zmena úrovne (prevzatie smeru, nová pobočka, presun objemu).
// Staršie dni sa prepočítajú koeficientom, takže sezónnosť a profily zostanú
// použiteľné, ale úroveň zodpovedá súčasnému stavu. Bez toho by model vnímal
// skokovú zmenu ako trend a extrapoloval rast, ktorý sa nekoná.
export function koefZlomu(daily, datum, oknoPo = 21, oknoPred = 28) {
  const po = daily.filter((r) => r.datum >= datum).slice(0, oknoPo);
  const pred = daily.filter((r) => r.datum < datum).slice(-oknoPred);
  if (po.length < 3 || pred.length < 7) return null;
  // porovnanie rovnakých dní v týždni, aby posun nezastrel týždenný cyklus
  const pomery = [];
  for (let dw = 0; dw < 7; dw++) {
    const a = median(pred.filter((r) => dow(r.datum) === dw).map((r) => r.jbl));
    const b = median(po.filter((r) => dow(r.datum) === dw).map((r) => r.jbl));
    if (a > 0 && b > 0) pomery.push(b / a);
  }
  if (pomery.length < 3) return null;
  return clip(median(pomery), 0.3, 3);
}

export function aplikujZlomy(daily, zlomy) {
  if (!zlomy?.length) return daily;
  const platne = zlomy
    .map((z) => ({ datum: z.datum, koef: +z.koef > 0 ? +z.koef : koefZlomu(daily, z.datum) }))
    .filter((z) => z.datum && z.koef)
    .sort((a, b) => (a.datum < b.datum ? -1 : 1));
  if (!platne.length) return daily;
  return daily.map((r) => {
    // deň sa prenásobí koeficientmi všetkých zlomov, ktoré nastali po ňom
    let k = 1;
    for (const z of platne) if (r.datum < z.datum) k *= z.koef;
    return k === 1 ? r : { ...r, jbl: r.jbl * k, povodne: r.jbl };
  });
}

// --- DFS toky ----------------------------------------------------------------
// Denné súčty z rozpadu (dátum, protistrana, geosize) pre model.
export function dfsDenne(rows) {
  const m = new Map();
  for (const r of rows || []) m.set(r.datum, (m.get(r.datum) || 0) + (+r.joblines || 0));
  return [...m.entries()].map(([datum, jbl]) => ({ datum, jbl })).sort((a, b) => (a.datum < b.datum ? -1 : 1));
}

// Rozpad za deň (alebo obdobie) podľa zvoleného kľúča.
export function dfsRozpad(rows, od, doD, kluc = "protistrana") {
  const m = new Map();
  for (const r of rows || []) {
    if (r.datum < od || r.datum > doD) continue;
    m.set(r[kluc], (m.get(r[kluc]) || 0) + (+r.joblines || 0));
  }
  const spolu = [...m.values()].reduce((a, b) => a + b, 0) || 1;
  return [...m.entries()].map(([nazov, jbl]) => ({ nazov, jbl, podiel: (jbl / spolu) * 100 }))
    .sort((a, b) => b.jbl - a.jbl);
}

// --- avíza dodávok -----------------------------------------------------------
// Predikcia príjmu z plánu vyložených paliet. Koeficient JBL/paleta sa priebežne
// prepočítava z posledných dní, takže sa prispôsobuje skladbe tovaru.
export function predictPrijemZAviza(datum, avizoRows, dailyPrijem, oknoDni = 30) {
  if (!avizoRows?.length) return null;
  const a = avizoRows.find((r) => r.datum === datum);
  const plan = a ? (+a.plan || 0) + (+a.plan_virt || 0) * 0 : 0; // virtuálne palety korelujú slabo
  if (!(plan > 0)) return null;
  const mapaP = new Map(dailyPrijem.map((r) => [r.datum, r.jbl]));
  const pomery = [];
  for (const r of avizoRows) {
    if (r.datum >= datum) continue;
    const skut = mapaP.get(r.datum), pl = +r.plan || 0;
    if (skut > 0 && pl > 0) pomery.push(skut / pl);
  }
  const posledne = pomery.slice(-oknoDni);
  if (posledne.length < 5) return null;
  const s = [...posledne].sort((x, y) => x - y);
  const med = s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { predikcia: plan * med, plan, koef: med, dni: posledne.length };
}

// --- backtest ---------------------------------------------------------------
// Walk-forward: pre každý z posledných N dní model natrénovaný len po D-1.
export function backtest(daily, vynimkyDates, udalosti, N = 30) {
  const excl = new Set(vynimkyDates);
  const usable = daily.length - 60; // model potrebuje rozumnú históriu
  const M = Math.max(Math.min(N, usable), 0);
  const dni = [];
  for (let i = daily.length - M; i < daily.length; i++) {
    const t = daily[i];
    if (excl.has(t.datum)) continue;
    const m = fitModel(daily.slice(0, i), vynimkyDates, udalosti);
    const p = predictDay(t.datum, m, udalosti);
    if (!(p > 0)) continue;
    dni.push({ datum: t.datum, skut: t.jbl, pred: p, err: t.jbl - p, pct: t.jbl / p - 1 });
  }
  const n = dni.length || 1;
  const mae = dni.reduce((a, r) => a + Math.abs(r.err), 0) / n;
  const mape = dni.reduce((a, r) => a + Math.abs(r.pct), 0) / n;
  const bias = dni.reduce((a, r) => a + r.err, 0) / n;
  const do5k = dni.filter((r) => Math.abs(r.err) <= 5000).length;
  return { dni, mae, mape, bias, do5k, n: dni.length };
}
