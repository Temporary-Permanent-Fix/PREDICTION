// Prevod Excel exportov (OLAP_PREDICTION, VOLUMES, QUALITY) na dátové súbory appky.
// Rovnaká logika ako skripty v tools/, len beží v prehliadači cez SheetJS.

const RX_DH = /^\d{2}\.\d{2}\.\d{4} \d{1,2}$/;
const ZRELE_OD = "2025-10-01";
const ZVOZ_DOBEH_DNI = 6;
const PROFIL_DNI = 60;
const POMERY_DNI = 60;
const KVALITA_HODINY_DNI = 30;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// "19.08.2025 10" -> Date (UTC)
function parseDH(s) {
  const [dat, h] = s.split(" ");
  const [dd, mm, yyyy] = dat.split(".");
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +h));
}
// prevádzkový deň 06:00–06:00
const opDay = (dt) => iso(new Date(dt.getTime() - 6 * 3600000));
const excelDate = (v) => (v instanceof Date ? v : new Date(Math.round((v - 25569) * 86400000)));

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  if (!s.length) return 0;
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const csv = (hlavicka, riadky) => [hlavicka.join(","), ...riadky.map((r) => r.join(","))].join("\n") + "\n";

// ---------------------------------------------------------------- rozpoznanie
export function detekuj(ws, XLSX) {
  const head = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }).slice(0, 40);
  // DFS: distribučné toky medzi pobočkami (rozlíšenie podľa filtra v prvej bunke)
  const prvaBunka = String((head[0] || [])[0] ?? "");
  const maDfsStlpce = head.some((r) => r.some((c) => String(c ?? "").trim() === "JL Count"));
  if (maDfsStlpce) {
    if (prvaBunka.includes("Zdroj POB")) return "dfs_out";
    if (prvaBunka.includes("Cíl POB") || prvaBunka.includes("Cil POB")) return "dfs_in";
    return "dfs_out";
  }
  // avíza dodávok: hlavička obsahuje "Palet plán"
  if (head.some((r) => r.some((c) => String(c ?? "").trim() === "Palet plán"))) return "avizo";
  // výkaz odpracovaných hodín: hlavička obsahuje SJL/ManHours
  if (head.some((r) => r.some((c) => String(c ?? "").includes("SJL/ManHours")))) return "manhours";
  // kalendár zmien: obsahuje riadky "Ranná zmena" / "Nočná zmena"
  if (head.some((r) => r.some((c) => String(c ?? "").trim() === "Ranná zmena"))) return "kalendar";
  // OLAP: prvý stĺpec sú dátumy s hodinou ("19.08.2025 10")
  if (head.some((r) => RX_DH.test(String(r[0] ?? "").trim()))) return "olap";
  // VOLUMES aj QUALITY majú rovnaké hlavičky – rozlišuje ich obsah stĺpca Proces_
  // prehľadá celý stĺpec Proces_ – zmiešaný hárok (VOLUMES aj QUALITY) sa inak nerozpozná
  const vsetky = XLSX.utils.sheet_to_json(ws, { raw: true });
  const vzorka = vsetky.map((r) => String(r["Proces_"] ?? ""));
  const maKvalitu = vzorka.some((x) => x.startsWith("Kvalita |"));
  const maVytlak = vzorka.some((x) => x.startsWith("Výtlak |"));
  if (maKvalitu && maVytlak) return "volumes+quality";   // oba exporty v jednom hárku
  if (maKvalitu) return "quality";
  if (maVytlak) return "volumes";
  return null;
}

// ------------------------------------------------------------------ OLAP
export function prevodOlap(ws, XLSX) {
  const vsetky = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false });
  // hlavička "Označenia riadkov" – dáta začínajú hneď za ňou (počet filtrov sa líši podľa exportu)
  const hlavicka = vsetky.findIndex((r) => String((r || [])[0] ?? "").trim().startsWith("Označen"));
  const rows = hlavicka >= 0 ? vsetky.slice(hlavicka + 1) : vsetky;
  const zaznamy = [];
  let kat = null, vznik = null, plan = null;
  for (let i = 0; i < rows.length; i++) {
    const s = String(rows[i][0] ?? "").trim();
    const c = rows[i][1];
    if (!RX_DH.test(s)) {
      if (s === "Expedice" || s === "Distribuce") kat = s;
      continue;
    }
    if (c === undefined || c === null || c === "") {
      const nx = rows[i + 1];
      const nxNan = nx && RX_DH.test(String(nx[0] ?? "").trim()) && (nx[1] === undefined || nx[1] === null || nx[1] === "");
      if (nxNan) vznik = s; else plan = s;
    } else {
      zaznamy.push({ kat, vznik, plan, real: s, pocet: Math.round(+c) });
    }
  }
  if (!zaznamy.length) throw new Error("OLAP: nenašli sa žiadne dátové riadky.");
  // novšie exporty majú smer jobu ako filter (len Expedice) – kategória v tele chýba
  const maKategorie = zaznamy.some((z) => z.kat);
  if (!maKategorie) for (const z of zaznamy) z.kat = "Expedice";

  const cache = new Map();
  const dt = (s) => { if (!cache.has(s)) cache.set(s, parseDH(s)); return cache.get(s); };
  for (const z of zaznamy) {
    z.vznikDt = dt(z.vznik); z.planDt = z.plan ? dt(z.plan) : null; z.realDt = dt(z.real);
    z.planNan = !z.plan || z.plan.startsWith("01.01.1900");
    z.realNan = z.real.startsWith("01.01.1900");
  }

  const subory = {};
  const maxVznik = zaznamy.reduce((a, z) => (z.vznikDt > a ? z.vznikDt : a), zaznamy[0].vznikDt);

  // vzniky (Expedice) + distribúcia (Distribuce), kalendárne dni a hodiny
  // distribúciu sledujeme cez DFS exporty – z OLAP sa generuje len ak ju obsahuje
  const kategorie = maKategorie
    ? [["Expedice", "vzniky_hodinove.csv"], ["Distribuce", "distribucia_hodinove.csv"]]
    : [["Expedice", "vzniky_hodinove.csv"]];
  for (const [kategoria, nazov] of kategorie) {
    const m = new Map();
    for (const z of zaznamy) {
      if (z.kat !== kategoria) continue;
      const k = `${iso(z.vznikDt)}|${z.vznikDt.getUTCHours()}`;
      m.set(k, (m.get(k) || 0) + z.pocet);
    }
    const dni = new Map();
    for (const k of m.keys()) { const d = k.split("|")[0]; dni.set(d, (dni.get(d) || 0) + 1); }
    const posl = [...dni.keys()].sort().pop();
    const neuplny = posl && dni.get(posl) < 20 ? posl : null;
    const riadky = [...m.entries()]
      .map(([k, v]) => { const [d, h] = k.split("|"); return [d, +h, v]; })
      .filter((r) => r[0] !== neuplny)
      .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1));
    subory[nazov] = csv(["datum", "hodina", "joblines"], riadky);
  }

  // matica zvozov – len expedícia, zrelé obdobie
  const koniec = addDays(maxVznik, -ZVOZ_DOBEH_DNI);
  const zrele = zaznamy.filter((z) => z.kat === "Expedice" && iso(z.vznikDt) >= ZRELE_OD && z.vznikDt < koniec);
  const matica = {};
  for (let h = 0; h < 24; h++) {
    const g = zrele.filter((z) => z.vznikDt.getUTCHours() === h);
    const tot = g.reduce((a, z) => a + z.pocet, 0);
    const disp = g.filter((z) => !z.realNan &&
      Date.parse(opDay(z.realDt)) >= Date.parse(opDay(z.vznikDt)));
    const dtot = disp.reduce((a, z) => a + z.pocet, 0);
    const podla = [0, 1, 2].map((k) => disp.filter((z) => {
      const dd = Math.round((Date.parse(opDay(z.realDt)) - Date.parse(opDay(z.vznikDt))) / 86400000);
      return dd === k;
    }).reduce((a, z) => a + z.pocet, 0));
    const r3 = Math.max(dtot - podla[0] - podla[1] - podla[2], 0);
    matica[h] = {
      expFrac: tot ? +(dtot / tot).toFixed(4) : 0.9,
      d0: dtot ? +(podla[0] / dtot).toFixed(4) : 0,
      d1: dtot ? +(podla[1] / dtot).toFixed(4) : 0,
      d2: dtot ? +(podla[2] / dtot).toFixed(4) : 0,
      d3: dtot ? +(r3 / dtot).toFixed(4) : 0,
    };
  }

  const dispAll = zrele.filter((z) => !z.realNan);
  const maxReal = dispAll.reduce((a, z) => (z.realDt > a ? z.realDt : a), dispAll[0].realDt);
  const poslX = dispAll.filter((z) => z.realDt >= addDays(maxReal, -PROFIL_DNI));
  const prof = Array(24).fill(0);
  for (const z of poslX) prof[z.realDt.getUTCHours()] += z.pocet;
  const psum = prof.reduce((a, b) => a + b, 0) || 1;
  const zvozProfil = prof.map((v) => +(v / psum).toFixed(4));

  // harmonogram zvozov podľa dňa v týždni
  const harmonogram = {};
  for (let dw = 0; dw < 7; dw++) {
    const g = poslX.filter((z) => { const d = new Date(Date.parse(opDay(z.realDt))); return (d.getUTCDay() + 6) % 7 === dw; });
    const s = new Map();
    for (const z of g) s.set(z.realDt.getUTCHours(), (s.get(z.realDt.getUTCHours()) || 0) + z.pocet);
    const tot = [...s.values()].reduce((a, b) => a + b, 0) || 1;
    harmonogram[dw] = [...s.entries()]
      .map(([h, c]) => ({ h, podiel: +(c / tot).toFixed(4) }))
      .filter((x) => x.podiel >= 0.005)
      .sort((a, b) => b.podiel - a.podiel);
  }

  // mapa vznik hodina -> cieľové sloty (hodina + posun prevádzkových dní)
  const slotMap = {};
  for (let h = 0; h < 24; h++) {
    const g = zrele.filter((z) => !z.realNan && z.vznikDt.getUTCHours() === h);
    const s = new Map();
    for (const z of g) {
      const off = Math.round((Date.parse(opDay(z.realDt)) - Date.parse(opDay(z.vznikDt))) / 86400000);
      if (off < 0 || off > 3) continue;
      const k = `${z.realDt.getUTCHours()}|${off}`;
      s.set(k, (s.get(k) || 0) + z.pocet);
    }
    const tot = [...s.values()].reduce((a, b) => a + b, 0) || 1;
    const zoradene = [...s.entries()].sort((a, b) => b[1] - a[1]);
    const top = []; let cum = 0;
    for (const [k, c] of zoradene) {
      const [zh, off] = k.split("|");
      const podiel = c / tot;
      top.push({ zh: +zh, off: +off, podiel: +podiel.toFixed(4) });
      cum += podiel;
      if (cum >= 0.9 || top.length >= 8) break;
    }
    slotMap[h] = top;
  }

  // plnenie plánu
  const pm = zrele.filter((z) => !z.planNan && !z.realNan);
  const ptot = pm.reduce((a, z) => a + z.pocet, 0) || 1;
  const slip = (z) => (z.realDt - z.planDt) / 3600000;
  const planStat = {
    onTime: +(pm.filter((z) => Math.abs(slip(z)) <= 0.5).reduce((a, z) => a + z.pocet, 0) / ptot).toFixed(3),
    sklz24h: +(pm.filter((z) => slip(z) > 20 && slip(z) <= 28).reduce((a, z) => a + z.pocet, 0) / ptot).toFixed(3),
    rovnakaHodina: +(pm.filter((z) => z.realDt.getUTCHours() === z.planDt.getUTCHours()).reduce((a, z) => a + z.pocet, 0) / ptot).toFixed(3),
  };

  subory["zvoz_matica.json"] = JSON.stringify({
    zdroj: `import v appke, vzniky ${ZRELE_OD} – ${iso(koniec)}`,
    matica, zvozProfil, harmonogram, slotMap, plan: planStat,
  });

  const spolu = zaznamy.reduce((a, z) => a + z.pocet, 0);
  return {
    subory,
    suhrn: `${zaznamy.length.toLocaleString("sk")} kombinácií · ${spolu.toLocaleString("sk")} jobline · vzniky do ${iso(maxVznik)} · plnenie plánu ${(planStat.onTime * 100).toFixed(0)} %`,
  };
}

// --------------------------------------------------------------- VOLUMES
export function prevodVolumes(ws, XLSX) {
  const vsetky = XLSX.utils.sheet_to_json(ws, { raw: true, cellDates: true });
  // preč súčtové riadky ("Celkový součet") a riadky bez platného dátumu
  const rows = vsetky.filter((r) => String(r["Proces_"] ?? "").startsWith("Výtlak |")
    && r["Den (datum)"] != null && r["Směna 06-06"] != null);
  if (!rows.length) throw new Error("VOLUMES: nenašli sa riadky s procesmi „Výtlak | …“.");
  const den = (r) => iso(excelDate(r["Den (datum)"]));
  const smena = (r) => iso(excelDate(r["Směna 06-06"]));

  const subory = {};
  const info = [];
  for (const [proces, nazov] of [["Výtlak | 1. Received", "prijem_hodinove.csv"], ["Výtlak | 6. Sorted", "baseline_hodinove.csv"]]) {
    const m = new Map();
    for (const r of rows) {
      if (r["Proces_"] !== proces) continue;
      const k = `${den(r)}|${+r["Hodina"]}`;
      m.set(k, (m.get(k) || 0) + (+r["Celkem"] || 0));
    }
    if (!m.size) continue;
    const riadky = [...m.entries()]
      .map(([k, v]) => { const [d, h] = k.split("|"); return [d, +h, Math.round(v)]; })
      .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1));
    subory[nazov] = csv(["datum", "hodina", "joblines"], riadky);
    info.push(`${proces.split("| ")[1]}: ${riadky.length} riadkov`);
  }

  // pomery procesov voči Sorted (medián denných pomerov, posledných N dní)
  const dni = new Map();
  for (const r of rows) {
    const d = smena(r);
    if (!dni.has(d)) dni.set(d, {});
    const o = dni.get(d);
    o[r["Proces_"]] = (o[r["Proces_"]] || 0) + (+r["Celkem"] || 0);
  }
  const zoradene = [...dni.keys()].sort();
  const posl = zoradene.slice(-POMERY_DNI);
  const pomery = { Sort: 1 };
  for (const [proces, key] of [["Výtlak | 4. Picked", "Pick"], ["Výtlak | 5. Packed", "Pack"], ["Výtlak | 1. Received", "Príjem"]]) {
    const r = posl.map((d) => {
      const o = dni.get(d);
      return o[proces] && o["Výtlak | 6. Sorted"] ? o[proces] / o["Výtlak | 6. Sorted"] : null;
    }).filter((x) => x != null);
    if (r.length) pomery[key] = +median(r).toFixed(4);
  }
  subory["procesy_pomery.json"] = JSON.stringify({ dni: POMERY_DNI, pomery_vs_sorted: pomery });

  return { subory, suhrn: `${info.join(" · ")} · pomery Pick ×${pomery.Pick ?? "–"}, Pack ×${pomery.Pack ?? "–"}` };
}

// --------------------------------------------------------------- QUALITY
export function prevodQuality(ws, XLSX) {
  const vsetky = XLSX.utils.sheet_to_json(ws, { raw: true, cellDates: true });
  const rows = vsetky.filter((r) => String(r["Proces_"] ?? "").startsWith("Kvalita |") && r["Směna 06-06"] != null);
  if (!rows.length) throw new Error("QUALITY: nenašli sa riadky s procesmi „Kvalita | …“.");
  const POZDE = "Pozdě dokončené vše";
  const smena = (r) => iso(excelDate(r["Směna 06-06"]));
  const proc = (r) => String(r["Proces_"]).replace("Kvalita | ", "");

  // denná kvalita po procesoch
  const den = new Map();
  for (const r of rows) {
    const k = `${smena(r)}|${proc(r)}`;
    const o = den.get(k) || { c: 0, z: 0 };
    o.c += +r["Celkem"] || 0; o.z += +r[POZDE] || 0;
    den.set(k, o);
  }
  const riadky = [...den.entries()]
    .map(([k, o]) => { const [d, p] = k.split("|"); return [d, p, Math.round(o.c), Math.round(o.z)]; })
    .filter((r) => r[2] > 0)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const subory = { "kvalita_denne.csv": csv(["datum", "proces", "celkem", "pozde"], riadky) };

  // hodinová kvalita po procesoch – na rozpad podľa zmien
  const hod = new Map();
  for (const r of rows) {
    const k = `${smena(r)}|${+r["Hodina"]}|${proc(r)}`;
    const o = hod.get(k) || { c: 0, z: 0 };
    o.c += +r["Celkem"] || 0; o.z += +r[POZDE] || 0;
    hod.set(k, o);
  }
  const hRiadky = [...hod.entries()]
    .map(([k, o]) => { const [d, h, p] = k.split("|"); return [d, +h, p, Math.round(o.c), Math.round(o.z)]; })
    .filter((r) => r[3] > 0)
    .sort((a, b) => (a[0] === b[0] ? (a[1] - b[1] || (a[2] < b[2] ? -1 : 1)) : a[0] < b[0] ? -1 : 1));
  subory["kvalita_hodinove.csv"] = csv(["datum", "hodina", "proces", "celkem", "pozde"], hRiadky);

  // hodinový profil = priemer denných hodinových kvalít
  const dniAll = [...new Set(riadky.map((r) => r[0]))].sort();
  // okno posledných N kalendárnych dní (nie N záznamov), rovnako ako konvertor v tools/
  const cut = iso(addDays(new Date(Date.parse(dniAll[dniAll.length - 1])), -KVALITA_HODINY_DNI));
  const perProc = new Map();
  for (const r of rows) {
    const d = smena(r);
    if (d <= cut) continue;
    const p = proc(r), h = +r["Hodina"];
    const key = `${d}|${h}`;           // názov procesu môže sám obsahovať "|"
    const m = perProc.get(p) || new Map();
    const o = m.get(key) || { c: 0, z: 0 };
    o.c += +r["Celkem"] || 0; o.z += +r[POZDE] || 0;
    m.set(key, o); perProc.set(p, m);
  }
  const profil = {};
  for (const [p, m] of perProc) {
    const poHodine = Array.from({ length: 24 }, () => []);
    for (const [key, o] of m) {
      if (o.c <= 0) continue;
      poHodine[+key.split("|")[1]].push((1 - o.z / o.c) * 100);
    }
    profil[p] = poHodine.map((a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null));
  }
  subory["kvalita_hodiny.json"] = JSON.stringify({ dni: KVALITA_HODINY_DNI, profil });

  const procesy = [...new Set(riadky.map((r) => r[1]))];
  return { subory, suhrn: `${dniAll.length} dní × ${procesy.length} procesov · do ${dniAll[dniAll.length - 1]}` };
}

// --------------------------------------------------------------- KALENDÁR ZMIEN
export function prevodKalendar(ws, XLSX) {
  const m = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: true, cellDates: true });
  const riadky = [];
  for (let i = 0; i < m.length; i++) {
    const r = m[i] || [];
    const dt = r.map((c, j) => [j, c]).filter(([, c]) => c instanceof Date);
    if (dt.length < 5) continue;
    // pod riadkom s dátumami hľadaj rannú a nočnú zmenu (názov býva v prvých stĺpcoch)
    let ranna = null, nocna = null;
    for (let k = i + 1; k < Math.min(i + 5, m.length); k++) {
      const lbl = (m[k] || []).map((c) => String(c ?? "").trim());
      if (lbl.some((x) => x.startsWith("Ranná"))) ranna = m[k];
      if (lbl.some((x) => x.startsWith("Nočná"))) nocna = m[k];
    }
    if (!ranna || !nocna) continue;
    for (const [j, d] of dt) {
      const a = String(ranna[j] ?? "").trim(), b = String(nocna[j] ?? "").trim();
      if (a && b && a.length <= 4 && b.length <= 4) riadky.push([iso(d), a, b]);
    }
  }
  if (!riadky.length) throw new Error("Kalendár: nenašli sa dvojice dátum + ranná/nočná zmena.");
  const unik = [...new Map(riadky.map((r) => [r[0], r])).values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const skratky = [...new Set(unik.flatMap((r) => [r[1], r[2]]))].sort();
  return {
    subory: { "zmeny.csv": csv(["datum", "denna", "nocna"], unik) },
    suhrn: `${unik.length} dní (${unik[0][0]} – ${unik[unik.length - 1][0]}) · zmeny: ${skratky.join(", ")}`,
  };
}

// ------------------------------------------------------- ODPRACOVANÉ HODINY
const MESIACE = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
const PROC_MAP = { "Příjem": "Príjem", Prijem: "Príjem", Pick: "Pick", Pack: "Pack",
  Sorting: "Sort", Sort: "Sort", "Potvrzení": "Potvrdenie", "Potvrzeni": "Potvrdenie" };

export function prevodManhours(ws, XLSX) {
  const rows = XLSX.utils.sheet_to_json(ws, { range: 2, raw: true });
  // Novší export je hodinový: joblines sú za hodinu, ManHours je denný súčet
  // zopakovaný v každom riadku dňa – preto sa berie prvá hodnota, nie súčet.
  const acc = new Map();
  for (const r of rows) {
    const proc = String(r["SJL Process"] ?? "").trim();
    if (!proc) continue;
    const nazov = PROC_MAP[proc] || proc;
    let d = null;
    if (r["Date"] instanceof Date) d = iso(r["Date"]);
    else {
      const rok = +r["Date – Year"], mes = MESIACE[String(r["Date – Month"] ?? "").trim()], den = +r["DayOfMonth"];
      if (rok && mes && den) d = `${rok}-${pad(mes)}-${pad(den)}`;
    }
    if (!d) continue;
    const mh = +r["ManHours"] ?? +r["SJL/ManHours"];
    const jbl = +r["Joblines"] || 0;
    const k = `${d}|${nazov}`;
    const o = acc.get(k) || { mh: 0, jbl: 0 };
    if (isFinite(mh) && mh > 0) o.mh = Math.max(o.mh, mh);   // denná hodnota, nie súčet
    o.jbl += jbl;
    acc.set(k, o);
  }
  if (!acc.size) throw new Error("ManHours: nenašli sa riadky s hodinami.");
  const riadky = [...acc.entries()]
    .map(([k, v]) => { const [d, p] = k.split("|"); return [d, p, Math.round(v.mh * 100) / 100, Math.round(v.jbl)]; })
    .filter((r) => r[2] > 0)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const dni = [...new Set(riadky.map((r) => r[0]))];
  const procesy = [...new Set(riadky.map((r) => r[1]))];
  return {
    subory: { "manhours.csv": csv(["datum", "proces", "hodiny", "joblines"], riadky) },
    suhrn: `${dni.length} dní · ${procesy.join(", ")} · ${dni[0]} – ${dni[dni.length - 1]}`,
  };
}

// --------------------------------------------------------------- AVÍZA DODÁVOK
// Plán a skutočnosť vyložených paliet po pobočkách. Dátum sa skladá z ISO týždňa
// a názvu dňa (export neobsahuje presný dátum).
const DNI_CZ = { "pondělí": 1, "úterý": 2, "středa": 3, "čtvrtek": 4, "pátek": 5, "sobota": 6, "neděle": 7 };
const MES_CZ = { leden: 1, únor: 2, březen: 3, duben: 4, květen: 5, červen: 6,
  červenec: 7, srpen: 8, září: 9, říjen: 10, listopad: 11, prosinec: 12 };

// ISO týždeň + deň -> dátum
function zIsoTydna(rok, tyzden, den) {
  const stvrtok = new Date(Date.UTC(rok, 0, 4));
  const posun = (stvrtok.getUTCDay() + 6) % 7;
  const pondelokW1 = new Date(stvrtok.getTime() - posun * 86400000);
  return new Date(pondelokW1.getTime() + ((tyzden - 1) * 7 + (den - 1)) * 86400000);
}

export function prevodAvizo(ws, XLSX, pobocky) {
  const rows = XLSX.utils.sheet_to_json(ws, { range: 2, raw: true });
  const podlaPobocky = new Map();
  let rok = new Date().getUTCFullYear();
  for (const r of rows) {
    const pob = String(r["Branch"] ?? "").trim();
    if (!pob || (pobocky && !pobocky.includes(pob))) continue;
    const w = parseInt(String(r["IsoWeek"] ?? "").replace(/\D/g, ""), 10);
    const den = DNI_CZ[String(r["WeekDayName"] ?? "").trim()];
    const mes = MES_CZ[String(r["MonthName"] ?? "").trim()];
    if (!w || !den) continue;
    let d = zIsoTydna(rok, w, den);
    // ak sa mesiac nezhoduje (prelom roka), skús susedný rok
    if (mes && d.getUTCMonth() + 1 !== mes) {
      const alt = zIsoTydna(rok - 1, w, den);
      if (alt.getUTCMonth() + 1 === mes) d = alt;
    }
    const zaznam = {
      datum: iso(d),
      plan: Math.round(+r["Palet plán"] || 0),
      vylozene: Math.round(+r["Palet vylož."] || 0),
      plan_virt: Math.round(+r["Palet plán virt"] || 0),
      vylozene_virt: Math.round(+r["Palet vylož. virt."] || 0),
    };
    if (!podlaPobocky.has(pob)) podlaPobocky.set(pob, new Map());
    podlaPobocky.get(pob).set(zaznam.datum, zaznam);
  }
  if (!podlaPobocky.size) throw new Error("Avíza: nenašli sa riadky pre povolené pobočky.");
  const subory = {}; const info = [];
  for (const [pob, m] of podlaPobocky) {
    const riadky = [...m.values()].sort((a, b) => (a.datum < b.datum ? -1 : 1))
      .map((z) => [z.datum, z.plan, z.vylozene, z.plan_virt, z.vylozene_virt]);
    subory[`${pob}::avizo.csv`] = csv(["datum", "plan", "vylozene", "plan_virt", "vylozene_virt"], riadky);
    info.push(`${pob} ${riadky.length} dní`);
  }
  return { subory, suhrn: `${info.join(" · ")}` };
}

// ------------------------------------------------------------------ DFS toky
// Distribúcia medzi pobočkami. FROM_LC = od nás (expedičná práca, len rozpad),
// TO_LC = k nám (navyšuje objem príjmu). Dátum sa skladá z ISO týždňa a dňa.
export function prevodDfs(ws, XLSX, smer, pobocky) {
  const rows = XLSX.utils.sheet_to_json(ws, { range: 2, raw: true });
  const acc = new Map();
  const rokFallback = new Date().getUTCFullYear();
  for (const r of rows) {
    const rok = +r["Week Hierarchie – Year"] || rokFallback;
    const w = +r["Week Hierarchie – Week"];
    const den = +r["Week Hierarchie – WeekDay"];
    const jbl = +r["JL Count"] || 0;
    const zdroj = String(r["SourceBranch"] ?? "").trim();
    const ciel = String(r["TargetBranch"] ?? "").trim();
    const geo = String(r["Geosize"] ?? "").trim() || "–";
    if (!w || !den || !jbl) continue;
    // pobočka = tá naša strana toku; protistrana je druhá
    const pob = smer === "out" ? zdroj : ciel;
    const proti = smer === "out" ? ciel : zdroj;
    if (!pob || (pobocky && !pobocky.includes(pob))) continue;
    const d = iso(zIsoTydna(rok, w, den));
    const k = `${pob}|${d}|${proti}|${geo}`;
    acc.set(k, (acc.get(k) || 0) + jbl);
  }
  if (!acc.size) throw new Error("DFS: nenašli sa riadky pre povolené pobočky.");
  const podla = new Map();
  for (const [k, v] of acc) {
    const [pob, datum, proti, geo] = k.split("|");
    if (!podla.has(pob)) podla.set(pob, []);
    podla.get(pob).push([datum, proti, geo, Math.round(v)]);
  }
  const subory = {}; const info = [];
  const nazov = smer === "out" ? "dfs_out.csv" : "dfs_in.csv";
  for (const [pob, riadky] of podla) {
    riadky.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
    subory[`${pob}::${nazov}`] = csv(["datum", "protistrana", "geosize", "joblines"], riadky);
    const dni = new Set(riadky.map((r) => r[0])).size;
    const spolu = riadky.reduce((a, r) => a + r[3], 0);
    info.push(`${pob} ${dni} dní / ${spolu.toLocaleString("sk")} JBL`);
  }
  return { subory, suhrn: info.join(" · ") };
}

export function prevod(typ, ws, XLSX, pobocky) {
  if (typ === "dfs_out") return prevodDfs(ws, XLSX, "out", pobocky);
  if (typ === "dfs_in") return prevodDfs(ws, XLSX, "in", pobocky);
  if (typ === "volumes+quality") {
    const a = prevodVolumes(ws, XLSX), b = prevodQuality(ws, XLSX);
    return { subory: { ...a.subory, ...b.subory }, suhrn: `${a.suhrn} · ${b.suhrn}` };
  }
  if (typ === "avizo") return prevodAvizo(ws, XLSX, pobocky);
  if (typ === "manhours") return prevodManhours(ws, XLSX);
  if (typ === "kalendar") return prevodKalendar(ws, XLSX);
  if (typ === "olap") return prevodOlap(ws, XLSX);
  if (typ === "volumes") return prevodVolumes(ws, XLSX);
  if (typ === "quality") return prevodQuality(ws, XLSX);
  throw new Error("Neznámy formát súboru.");
}

export const POPIS_TYPU = {
  dfs_in: "DFS TO LC – distribúcia k nám (navyšuje príjem)",
  dfs_out: "DFS FROM LC – distribúcia od nás (rozpad expedície)",
  "volumes+quality": "VOLUMES + QUALITY v jednom hárku",
  avizo: "Avíza dodávok – plán vyložených paliet",
  manhours: "Odpracované hodiny – SJL ManHours",
  kalendar: "Kalendár zmien – rozpis operation managerov",
  olap: "OLAP – vzniky, distribúcia, matica zvozov",
  volumes: "VOLUMES – príjem, triedenie, pomery procesov",
  quality: "QUALITY – kvalita denne a po hodinách",
};
