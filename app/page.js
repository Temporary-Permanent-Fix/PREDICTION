"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseCSV, toCSV, zlucPodlaDna } from "../lib/csv";
import {
  TYPY_VYNIMIEK, TYPY_UDALOSTI, buildDaily, mergedHourly, fitModel, predictDay,
  expectedFor, hourlyProfile, eventMult, intraday,
  addDays, dow, DNI, fmtD, iso, opShift, OP_HOURS, OP_START, dropIncompleteLastOpDay, opIdx, opIdxEnd, backtest, parseVynimky, adjustPartialDays, predictPrijemZAviza, skutocnyVykon, pomerKPrijmu, dfsDenne, dfsRozpad, aplikujZlomy, koefZlomu,
} from "../lib/model";
import { t, setLang, JAZYKY } from "../lib/preklady";

const nf = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("sk-SK", { maximumFractionDigits: 1 });
const today = () => iso(new Date());

// ---------------------------------------------------------------- grafy (SVG)
function Bars({ data, color = "var(--green)", height = 210, hlColor = "var(--amber)", line = null, lineColor = "var(--muted)" }) {
  const W = 720, H = height, padL = 46, padB = 26, padT = 8;
  const max = Math.max(...data.map((d) => d.y), ...(line || []).filter((v) => v != null), 1);
  const bw = (W - padL - 8) / data.length;
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (max / ticks) * i, y = H - padB - ((H - padB - padT) * v) / max;
        return (
          <g key={i}>
            <line x1={padL} x2={W - 4} y1={y} y2={y} stroke="#21262d" />
            <text x={padL - 6} y={y + 4} fill="var(--muted)" fontSize="10" textAnchor="end">{nf.format(v)}</text>
          </g>
        );
      })}
      {line && (() => {
        const bw2 = (W - padL - 8) / data.length;
        const X = (i) => padL + i * bw2 + bw2 / 2;
        const Y = (v) => H - padB - ((H - padB - padT) * v) / max;
        const body = line.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`));
        const d = body.reduce((acc, p, i) => (p ? acc + (acc && body[i - 1] ? " L" : " M") + p : acc), "");
        return <path d={d} fill="none" stroke={lineColor} strokeWidth="2" strokeDasharray="5 4" />;
      })()}
      {data.map((d, i) => {
        const h = ((H - padB - padT) * d.y) / max;
        return (
          <g key={i}>
            <rect x={padL + i * bw + 1} y={H - padB - h} width={Math.max(bw - 2, 1)} height={h}
              fill={d.hl ? hlColor : color} opacity={d.dim ? 0.35 : 0.9} rx="2" />
            {data.length <= 32 && (
              <text x={padL + i * bw + bw / 2} y={H - padB + 14} fill="var(--muted)" fontSize="9.5"
                textAnchor="middle" transform={data.length > 16 ? `rotate(40 ${padL + i * bw + bw / 2} ${H - padB + 14})` : ""}>
                {d.x}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Lines({ series, xLabels, height = 220 }) {
  const W = 720, H = height, padL = 50, padB = 24, padT = 8;
  const all = series.flatMap((s) => s.points.filter((p) => p != null && !isNaN(p)));
  const max = Math.max(...all, 1), min = Math.min(...all, 0);
  const n = Math.max(...series.map((s) => s.points.length));
  const X = (i) => padL + ((W - padL - 10) * i) / Math.max(n - 1, 1);
  const Y = (v) => H - padB - ((H - padB - padT) * (v - min)) / (max - min || 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      {Array.from({ length: 5 }, (_, i) => {
        const v = min + ((max - min) / 4) * i;
        return (
          <g key={i}>
            <line x1={padL} x2={W - 4} y1={Y(v)} y2={Y(v)} stroke="#21262d" />
            <text x={padL - 6} y={Y(v) + 4} fill="var(--muted)" fontSize="10" textAnchor="end">{nf.format(v)}</text>
          </g>
        );
      })}
      {xLabels && xLabels.map((l, i) => (i % Math.ceil(n / 10) === 0 ?
        <text key={i} x={X(i)} y={H - padB + 14} fill="var(--muted)" fontSize="9.5" textAnchor="middle">{l}</text> : null))}
      {series.map((s, si) => {
        const pts = s.points.map((v, i) => (v == null || isNaN(v) ? null : `${X(i)},${Y(v)}`));
        if (s.dots) {
          return s.points.map((v, i) => (v == null || isNaN(v) ? null :
            <circle key={si + "-" + i} cx={X(i)} cy={Y(v)} r="4.5" fill={s.color} />));
        }
        const path = pts.reduce((acc, p, i) => (p ? acc + (acc && pts[i - 1] ? " L" : " M") + p : acc), "");
        return <path key={si} d={path} fill="none" stroke={s.color} strokeWidth="2" />;
      })}
    </svg>
  );
}

const Card = ({ lbl, val, sub, cls = "" }) => (
  <div className="card"><div className="lbl">{lbl}</div><div className={`val ${cls}`}>{val}</div>{sub && <div className="sub">{sub}</div>}</div>
);

// ---------------------------------------------------------- ikony (ako v hube)
const ICO = {
  vzniky: "M3 5h2.2l2.1 9.4a2 2 0 0 0 2 1.6h6.9a2 2 0 0 0 2-1.5L20 8H6.4M9.5 20h.01M16.5 20h.01",
  triedenie: "M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9L12 3ZM3.5 7.5 12 12l8.5-4.5M12 12v9",
  prijem: "M12 3v10m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  distribucia: "M4 9a8 8 0 0 1 13.3-3.3L20 8M20 4v4h-4M20 15a8 8 0 0 1-13.3 3.3L4 16M4 20v-4h4",
  kvalita: "M20 6 9.5 16.5 4 11",
  udal: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  kpi: "M4 20V10m5 10V4m5 16v-7m5 7V8",
  admin: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.15-1.5l2-1.6-2-3.4-2.4 1a8.4 8.4 0 0 0-2.6-1.5L15 2H9l-.35 2.5a8.4 8.4 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.6a8.4 8.4 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a8.4 8.4 0 0 0 2.6 1.5L9 22h6l.35-2.5a8.4 8.4 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.6c.1-.5.15-1 .15-1.5Z",
  model: "M12 4a3 3 0 0 0-3 3M12 4a3 3 0 0 1 3 3M9 7a3 3 0 0 0-3 3m12-3a3 3 0 0 1 3 3M6 10a3 3 0 0 0 1 5.6M18 10a3 3 0 0 1-1 5.6M7 15.6A3 3 0 0 0 12 20a3 3 0 0 0 5-4.4M12 8v12",
  pred: "M4 18 9 11l4 3.2L20 6M20 6h-4.5M20 6v4.5",
  zvoz: "M3 7h10v9H3zM13 10h4l3 3v3h-7zM7.5 19a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Zm9 0a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z",
  prepocet: "M20 11a8 8 0 0 0-13.7-5.3L3 9M3 4v5h5m-4 4a8 8 0 0 0 13.7 5.3L21 15m0 5v-5h-5",
  vstup: "M12 5v14M5 12h14",
  anom: "M12 4 2.5 20h19L12 4Zm0 6v5m0 3h.01",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1 8 6 8-6",
  obrazok: "M12 15V3m0 12 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  zataz: "M3 20h18M6 20V10m4 10V4m4 16v-7m4 7V8",
  upoz: "M12 4 2.5 20h19L12 4Zm0 6v5m0 3h.01",
  zmeny: "M12 8v4l3 2M12 3a9 9 0 1 0 9 9M12 3a9 9 0 0 1 9 9M17 3h4v4",
  pocasie: "M7 17a4 4 0 0 1 .6-8A5.5 5.5 0 0 1 18 10.5a3.5 3.5 0 0 1-.5 6.5H7Zm2 4 1-2m3 2 1-2m3 2 1-2",
  prehlad: "M4 5h7v6H4V5Zm9 0h7v4h-7V5ZM4 13h7v6H4v-6Zm9-2h7v8h-7v-8Z",
  jazyk: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9s1.3-6.6 3.8-9Z",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M6 10h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Zm6 5v2",
  import: "M12 15V3m0 12-4-4m4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM8 3v6h7M8 21v-6h8v6",
  trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7m4 4v7m4-7v7",
  export: "M12 16V4m0 0 4 4m-4-4L8 8M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  play: "M7 4.5v15l12-7.5-12-7.5Z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 12h1v5h1",
};
// Ručné záznamy sú provizórium – platia len pre dni, ktoré import zatiaľ nepokrýva.
// Po rannom importe sa automaticky prestanú používať (import má vždy prednosť).
function rucneDoplnkove(baseline, zaznamy) {
  const kryte = new Set((baseline || []).map((r) => r.datum));
  return (zaznamy || []).filter((z) => !kryte.has(z.datum));
}

function Ico({ n }) {
  const d = ICO[n];
  if (!d) return null;
  return (
    <svg className="ico" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// ------------------------------------------------------------------- stránka
export default function Page() {
  const [tab, setTab] = useState("pred");
  const [src, setSrc] = useState("vzniky");
  const [toast, setToast] = useState(null);
  const [staticData, setStaticData] = useState(null); // {vzniky, triedenie, matica, zvozProfil}
  const [zaznamy, setZaznamy] = useState([]);
  const [vynimky, setVynimky] = useState([]);
  const [udalosti, setUdalosti] = useState([]);
  const [kpi, setKpi] = useState([]);
  const [backlogy, setBacklogy] = useState([]);
  const [emaily, setEmaily] = useState([]);
  const [prahyR, setPrahy] = useState([]);
  const [zmeny, setZmeny] = useState([]);
  const [upoz, setUpoz] = useState([]);
  const [manhours, setManhours] = useState([]);
  const [avizo, setAvizo] = useState([]);
  const [dfsIn, setDfsIn] = useState([]);
  const [dfsOut, setDfsOut] = useState([]);
  const [zlomy, setZlomy] = useState([]);
  const [pobocky, setPobocky] = useState([]);
  const [pobocka, setPobocka] = useState(null);
  const [manazeri, setManazeri] = useState([]);
  const [ghOk, setGhOk] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [heslo, setHeslo] = useState(null);       // odomknuté heslo pre chránené zápisy
  const [chranene, setChranene] = useState(false); // je ochrana vôbec zapnutá?
  const [jazyk, setJazyk] = useState("sk");

  // zoznam pobočiek (spoločný pre celú appku)
  useEffect(() => {
    (async () => {
      let zoz = [];
      try {
        const g = await fetch("/api/gh?file=pobocky.csv", { cache: "no-store" });
        if (g.ok) zoz = parseCSV((await g.json()).content);
      } catch {}
      if (!zoz.length) {
        try { zoz = parseCSV(await (await fetch("/data/pobocky.csv")).text()); } catch {}
      }
      if (!zoz.length) zoz = [{ kod: "SKLC3", nazov: "SKLC3" }];
      setPobocky(zoz);
      let ulozena = null;
      try { ulozena = localStorage.getItem("pobocka"); } catch {}
      setPobocka(zoz.some((p) => p.kod === ulozena) ? ulozena : zoz[0].kod);
    })();
  }, []);

  useEffect(() => {
    if (!pobocka) return;
    setStaticData(null); setLoadErr(null);
    (async () => {
      try {
      // dátové súbory: najprv z GitHubu (aktuálne po importe Excelu), inak z buildu
      const dataText = async (file, povinny = false) => {
        const cesta = `${pobocka}/${file}`;
        try {
          const g = await fetch(`/api/gh?file=${cesta}`, { cache: "no-store" });
          if (g.ok) return (await g.json()).content;
        } catch {}
        const r = await fetch(`/data/${cesta}`);
        if (!r.ok) {
          if (povinny) throw new Error(`Chýba súbor ${pobocka}/${file} (HTTP ${r.status})`);
          return "";
        }
        return r.text();
      };
      const [vz, tr, pr, mtTxt] = await Promise.all([
        dataText("vzniky_hodinove.csv", true),
        dataText("baseline_hodinove.csv", true),
        dataText("prijem_hodinove.csv"),
        dataText("zvoz_matica.json", true),
      ]);
      const mt = JSON.parse(mtTxt);
      const [kvD, kvHod, kvHTxt, pomTxt] = await Promise.all([
        dataText("kvalita_denne.csv"),
        dataText("kvalita_hodinove.csv"),
        dataText("kvalita_hodiny.json"),
        dataText("procesy_pomery.json"),
      ]);
      const kvH = kvHTxt ? JSON.parse(kvHTxt) : null;
      const pom = pomTxt ? JSON.parse(pomTxt) : null;
      setStaticData({
        vzniky: dropIncompleteLastOpDay(opShift(parseCSV(vz))),
        triedenie: dropIncompleteLastOpDay(opShift(parseCSV(tr))),
        prijem: dropIncompleteLastOpDay(opShift(parseCSV(pr))),
        matica: mt.matica, zvozProfil: mt.zvozProfil,
        slotMap: mt.slotMap || {}, harmonogram: mt.harmonogram || {}, planStat: mt.plan || null,
        kvalitaDenne: parseCSV(kvD), kvalitaHodinove: parseCSV(kvHod), kvalitaHodiny: kvH,
        pomery: pom ? pom.pomery_vs_sorted : { Sort: 1, Pick: 1, Pack: 1 },
      });
      const loadMut = async (file, setter) => {
        const cesta = `${pobocka}/${file}`;
        try {
          const r = await fetch(`/api/gh?file=${cesta}`, { cache: "no-store" });
          if (r.ok) { setter(parseCSV((await r.json()).content)); setGhOk(true); return; }
          if (r.status === 501) setGhOk(false);
        } catch {}
        const fb = await fetch(`/data/${cesta}`).then((r) => r.text()).catch(() => "");
        setter(parseCSV(fb));
      };
      loadMut("zaznamy.csv", setZaznamy);
      loadMut("vynimky.csv", setVynimky);
      loadMut("udalosti.csv", setUdalosti);
      loadMut("kpi.csv", setKpi);
      loadMut("backlog.csv", setBacklogy);
      loadMut("emaily.csv", setEmaily);
      loadMut("prahy.csv", setPrahy);
      loadMut("zmeny.csv", setZmeny);
      loadMut("upozornenia.csv", setUpoz);
      loadMut("manhours.csv", setManhours);
      loadMut("avizo.csv", setAvizo);
      loadMut("dfs_in.csv", setDfsIn);
      loadMut("dfs_out.csv", setDfsOut);
      loadMut("zlomy.csv", setZlomy);
      loadMut("manazeri.csv", setManazeri);
      fetch("/api/heslo").then((r) => r.json()).then((j) => setChranene(Boolean(j.chranene))).catch(() => {});
      try { const h = sessionStorage.getItem("vykony-heslo"); if (h) setHeslo(h); } catch {}
      try { const j = localStorage.getItem("jazyk"); if (j) setJazyk(j); } catch {}
      } catch (e) { setLoadErr(String(e.message || e)); }
    })();
  }, [pobocka]);

  const show = (msg, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 3800); };

  const save = async (file, rows, columns, message, setter) => {
    setter(rows);
    try {
      const r = await fetch("/api/gh", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(heslo ? { "x-vykony-heslo": heslo } : {}) },
        body: JSON.stringify({ file: `${pobocka}/${file}`, content: toCSV(rows, columns), message: `[${pobocka}] ${message}` }),
      });
      if (r.ok) show(`Uložené a commitnuté: ${file}`);
      else show((await r.json()).error || t("Uložené len lokálne."), true);
    } catch { show(t("Uložené len lokálne (bez pripojenia)."), true); }
  };

  // existujúci obsah súboru danej pobočky (na zlúčenie pri importe)
  const nacitajRaw = async (pob, file) => {
    try {
      const g = await fetch(`/api/gh?file=${pob}/${file}`, { cache: "no-store" });
      if (g.ok) return (await g.json()).content;
    } catch {}
    try {
      const r = await fetch(`/data/${pob}/${file}`);
      if (r.ok) return await r.text();
    } catch {}
    return "";
  };

  const saveRawDo = async (pob, file, content, message) => {
    const r = await fetch("/api/gh", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(heslo ? { "x-vykony-heslo": heslo } : {}) },
      body: JSON.stringify({ file: `${pob}/${file}`, content, message: `[${pob}] ${message}` }),
    });
    if (!r.ok) throw new Error((await r.json()).error || `Zápis ${pob}/${file} zlyhal.`);
  };

  const saveRaw = async (file, content, message) => {
    const r = await fetch("/api/gh", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(heslo ? { "x-vykony-heslo": heslo } : {}) },
      body: JSON.stringify({ file: `${pobocka}/${file}`, content, message: `[${pobocka}] ${message}` }),
    });
    if (!r.ok) throw new Error((await r.json()).error || `Zápis ${file} zlyhal.`);
  };

  // ---- odvodené dáta pre zvolený zdroj
  const D = useMemo(() => {
    if (!staticData) return null;
    const zazSrc = rucneDoplnkove(staticData[src], zaznamy.filter((z) => (z.zdroj || "triedenie") === src));
    const hourly = mergedHourly(staticData[src], zazSrc);
    const dailyAll = aplikujZlomy(buildDaily(staticData[src], zazSrc), zlomy);
    const { full, part } = parseVynimky(vynimky);
    const allVynD = [...full, ...part.map((p) => p.datum)];
    const prof = hourlyProfile(hourly, allVynD);
    // dni s hodinovou anomáliou: oprav denný objem dopočtom, netreba ich vyhadzovať
    const { daily: dailyAdj, extraExclude } = adjustPartialDays(dailyAll, hourly, part, prof);
    const btExcl = [...full, ...extraExclude];
    const model = fitModel(dailyAdj, btExcl, udalosti);
    return { hourly, daily: dailyAll, dailyAdj, vynD: allVynD, btExcl, part, model, prof };
  }, [staticData, zaznamy, vynimky, udalosti, src, zlomy]);

  // ---- vzniky vždy (pre zvoz), nezávisle od prepínača
  const V = useMemo(() => {
    if (!staticData) return null;
    const zazSrc = rucneDoplnkove(staticData.vzniky, zaznamy.filter((z) => (z.zdroj || "triedenie") === "vzniky"));
    const daily = aplikujZlomy(buildDaily(staticData.vzniky, zazSrc), zlomy);
    const vynD = vynimky.map((v) => v.datum);
    const hourly = mergedHourly(staticData.vzniky, zazSrc);
    return { daily, hourly, model: fitModel(daily, vynD, udalosti), prof: hourlyProfile(hourly, vynD) };
  }, [staticData, zaznamy, vynimky, udalosti, zlomy]);

  const TP = useMemo(() => {
    if (!staticData) return null;
    const mk = (key) => {
      const zazS = rucneDoplnkove(staticData[key], zaznamy.filter((z) => (z.zdroj || "triedenie") === key));
      const daily = aplikujZlomy(buildDaily(staticData[key], zazS), zlomy);
      const vynD = vynimky.map((v) => v.datum);
      const hourly = mergedHourly(staticData[key], zazS);
      return { daily, hourly, model: fitModel(daily, vynD, udalosti), prof: hourlyProfile(hourly, vynD) };
    };
    return { triedenie: mk("triedenie"), prijem: mk("prijem") };
  }, [staticData, zaznamy, vynimky, udalosti, zlomy]);

  const prahy = {
    kvZelena: +(prahyR.find((p) => p.kluc === "kvalita_zelena")?.hodnota) || 99,
    kvZlta: +(prahyR.find((p) => p.kluc === "kvalita_zlta")?.hodnota) || 98,
    hodZelena: +(prahyR.find((p) => p.kluc === "hodiny_zelena")?.hodnota) || 105,
    hodZlta: +(prahyR.find((p) => p.kluc === "hodiny_zlta")?.hodnota) || 115,
    upozRel: +(prahyR.find((p) => p.kluc === "upoz_rel")?.hodnota) || 10,
    upozAbs: +(prahyR.find((p) => p.kluc === "upoz_abs")?.hodnota) || 2000,
  };

  // ---- upozornenia: kumulatívny deficit výtlaku triedenia voči plánu
  // Jednotlivé hodiny kolíšu (dávkové triedenie), preto sa porovnáva kumulatív
  // od začiatku prevádzkového dňa – zachytí len skutočné zaostávanie, nie šum.
  const upozornenia = useMemo(() => {
    if (!TP?.triedenie) return [];
    const { hourly, prof, model } = TP.triedenie;
    const relPrah = (prahy.upozRel ?? 10) / 100, absPrah = prahy.upozAbs ?? 2000;
    const stavy = new Map(upoz.map((u) => [u.id, u]));
    const dni = [...new Set(hourly.map((r) => r.datum))].sort().slice(-14);
    const out = [];
    for (const d of dni) {
      const hod = new Map();
      for (const r of hourly) if (r.datum === d) hod.set(+r.hodina, (hod.get(+r.hodina) || 0) + (+r.joblines || 0));
      if (!hod.size) continue;
      const plan = expectedFor(d, model, udalosti);
      const p = prof[String(dow(d) >= 5)];
      const posledna = Math.max(...[...hod.keys()].map((h) => opIdx(h)));
      let cumS = 0, cumO = 0;
      for (const h of OP_HOURS) { if (opIdx(h) > posledna) continue; cumS += hod.get(h) || 0; cumO += plan * (p[h] || 0); }
      const deficit = cumO - cumS;
      if (!(deficit >= absPrah && cumO > 0 && deficit / cumO >= relPrah)) continue;
      // zostávajúca kapacita do konca prevádzkového dňa nad rámec plánu
      let rezerva = 0;
      for (const h of OP_HOURS) {
        if (opIdx(h) <= posledna) continue;
        const historia = hourly.filter((r) => +r.hodina === h && r.datum !== d).map((r) => +r.joblines || 0).sort((a, b) => a - b);
        const p90 = historia.length ? historia[Math.floor(historia.length * 0.9)] : 0;
        rezerva += Math.max(p90 - plan * (p[h] || 0), 0);
      }
      const dobehne = deficit <= rezerva;
      const id = `${d}|sort`;
      const ulozene = stavy.get(id);
      out.push({
        id, datum: d, hodiny: [...hod.keys()].sort((a, b) => opIdx(a) - opIdx(b)),
        objem: Math.round(deficit), rezerva: Math.round(rezerva), plan: Math.round(cumO), skutocnost: Math.round(cumS),
        podiel: (deficit / cumO) * 100, uroven: dobehne ? "zlta" : "cervena", na_datum: addDays(d, 1),
        stav: ulozene?.stav || "navrh", poznamka: ulozene?.poznamka || "",
      });
    }
    return out.sort((a, b) => (a.datum < b.datum ? 1 : -1));
  }, [TP, prahyR, upoz, udalosti]);

  // pri pobočke bez dát nemá zmysel držať zdrojovú záložku – prepni na Dáta
  useEffect(() => {
    if (!staticData) return;
    const prazdna = !staticData.vzniky?.length && !staticData.triedenie?.length;
    if (prazdna && !["import", "admin"].includes(tab)) setTab("import");
  }, [staticData]);

  if (loadErr) return (
    <div className="shell"><div className="masthead">
      <h1>{t("PREDIKCIA")} {pobocka}</h1>
      <div className="note" style={{ marginTop: 8, color: "var(--red)" }}>Dáta sa nepodarilo načítať: {loadErr}</div>
      <div className="note">{t("Skontroluj, či je súbor v repe a či prebehol Redeploy.")}</div>
    </div></div>
  );
  if (!D || !V || !TP) return <div className="shell"><div className="note">{t("Načítavam dáta…")}</div></div>;
  // pobočka bez dát: záložky zostávajú prístupné (najmä Dáta na import)
  const prazdnaPobocka = !staticData.vzniky?.length && !staticData.triedenie?.length;
  const { model, prof } = D;
  const uda = udalosti;

  const upozAktivne = upozornenia.filter((u) => u.stav === "navrh");

  setLang(jazyk);
  const trendPct = model.slope >= 0 ? "up" : "down";
  const STANDALONE = ["prehlad", "upoz", "zataz", "kvalita", "zmeny", "udal", "model", "import", "admin", "dfs"];
  const NASTROJE = [["model", "Model"], ["import", "Dáta"], ["admin", "Admin"]];
  const naZdroji = !STANDALONE.includes(tab);

  const prepniZdroj = (key) => {
    setSrc(key);
    if (!naZdroji || (key !== "vzniky" && tab === "zvoz")) setTab("pred");
  };
  return (
    <div className="shell">
      <div className="masthead">
        <div className="nastroje">
          {NASTROJE.map(([k, l]) => (
            <button key={k} className={`${tab === k ? "on" : ""}${k === "admin" ? " admin" : ""}`} onClick={() => setTab(k)}>
              <Ico n={k} />{t(l)}
            </button>
          ))}
        </div>
        <div className="eyebrow"><span className="livedot" /> {pobocka} · {t("LOGISTIKA")}</div>
        <h1>{t("PREDIKCIA")} {pobocka}</h1>
        <div className="tagline">{t("Predikcia objemov, kapacít a kvality")}</div>
        <div className="statusline">
          <span>{t("Deň")} <b>06:00–06:00</b></span>
          {naZdroji && (
            <>
              <span>{t("zdroj")}{" "}<b>{t({ vzniky: "vzniky (zákaznícke)", triedenie: "triedenie (expedícia)", prijem: "príjem (received)" }[src])}</b></span>
              <span>{t("tréning")}{" "}<b>{model.trainDays} {t("dní")}</b></span>
              <span>{t("posledné dáta")}{" "}<b>{fmtD(model.lastDate)}{model.lastDate.slice(0, 4)}</b></span>
              <span>{t("úroveň")}{" "}<b>{nf.format(model.levelNow)}</b> {t("JBL/deň")}</span>
              <span className={trendPct}>{t("trend")} {model.slope >= 0 ? "▲" : "▼"} {nf.format(Math.abs(model.slope))}{t("/deň")}</span>
              {Math.abs((model.corr ?? 1) - 1) >= 0.02 && <span className="warn">{t("korekcia")} ×{model.corr.toFixed(2)}</span>}
            </>
          )}
        </div>
        {pobocky.length > 1 && (
          <div className="pobsw" role="group" aria-label="Pobočka">
            {pobocky.map((p) => (
              <button key={p.kod} className={pobocka === p.kod ? "on" : ""}
                onClick={() => { setPobocka(p.kod); try { localStorage.setItem("pobocka", p.kod); } catch {} }}>
                {p.nazov || p.kod}
              </button>
            ))}
          </div>
        )}
        <div className="navrow">
        <div className="srcswitch" role="tablist" aria-label="Sekcia">
          {[["vzniky", "Vzniky"], ["triedenie", "Triedenie"], ["prijem", "Príjem"]].map(([k, l]) =>
            <button key={k} className={naZdroji && src === k ? "on" : ""} onClick={() => prepniZdroj(k)}><Ico n={k} />{t(l)}</button>)}
          <button className={tab === "dfs" ? "on" : ""} onClick={() => setTab("dfs")}><Ico n="distribucia" />{t("Distribúcia")}</button>
          <span style={{ alignSelf: "center", color: "var(--border)", padding: "0 2px", userSelect: "none" }}>│</span>
          {[["prehlad", "Prehľad"], ["upoz", "Upozornenia"], ["zataz", "Perfo"], ["kvalita", "Kvalita"], ["zmeny", "Zmeny"], ["udal", "Udalosti"]].map(([k, l]) =>
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><Ico n={k} />{t(l)}</button>)}
        </div>
        <div className="langsw" role="group" aria-label="Jazyk / Language">
          <Ico n="jazyk" />
          {JAZYKY.map(([k, l]) => (
            <button key={k} className={jazyk === k ? "on" : ""}
              onClick={() => { setJazyk(k); try { localStorage.setItem("jazyk", k); } catch {} }}>{l}</button>
          ))}
        </div>
        </div>
        {naZdroji && src === "distribucia" && <div className="note" style={{ marginTop: 8 }}>Distribúcia = preposielanie medzi skladmi (vrátane nočného batchu ~3:00). Objem riadi doplňovanie, nie zákaznícky dopyt – predikciu ber orientačnejšie než pri zákazníckych vznikoch.</div>}
        {naZdroji && src === "prijem" && <div className="note" style={{ marginTop: 8 }}>Príjem je riadený harmonogramom dodávok, nie zákazníckym dopytom – predikcia je orientačná (typická odchýlka ±20–40 %). Presnejší odhad by dali avíza dodávok.</div>}
        {ghOk === false && <div className="note" style={{ marginTop: 8 }}>{t("GitHub zápis nie je nakonfigurovaný (env GH_TOKEN / GH_REPO) – zmeny platia len do obnovenia stránky.")}</div>}
      </div>

      {naZdroji && (
        <div className="tabs">
          {[["pred", "Predikcia"], ["vstup", "Zadávanie dát"], ["anom", "Anomálie"]]
            .map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><Ico n={k} />{t(l)}</button>)}
        </div>
      )}

      {tab === "pred" && <TabPredikcia avizo={avizo} dfsIn={dfsIn} TP={TP} D={D} uda={uda} src={src} kpi={kpi} pomery={staticData.pomery} backlogy={backlogy} />}
      {tab === "vstup" && <TabVstup D={D} uda={uda} src={src} zaznamy={zaznamy} setZaznamy={setZaznamy} vynimky={vynimky} setVynimky={setVynimky} save={save} />}
      {tab === "anom" && <TabAnomalie D={D} uda={uda} src={src} vynimky={vynimky} setVynimky={setVynimky} save={save} />}
      {tab === "udal" && <TabUdalosti D={V} uda={uda} setUdalosti={setUdalosti} save={save} zlomy={zlomy} setZlomy={setZlomy} rawDaily={V.daily} />}
      {tab === "upoz" && <TabUpoz upozornenia={upozornenia} upoz={upoz} setUpoz={setUpoz} backlogy={backlogy} setBacklogy={setBacklogy} save={save} kpi={kpi} pomery={staticData.pomery} />}
      {prazdnaPobocka && (
        <p className="note" style={{ color: "var(--amber)", marginTop: 4 }}>
          {t("Pre túto pobočku zatiaľ nie sú dáta – nahraj exporty v záložke Dáta.")}
        </p>
      )}
      {tab === "dfs" && <TabDfs dfsIn={dfsIn} dfsOut={dfsOut} uda={uda} vynimky={vynimky} udalosti={udalosti} pobocka={pobocka} />}
      {tab === "prehlad" && <TabPrehlad pobocka={pobocka} dfsIn={dfsIn} V={V} TP={TP} staticData={staticData} uda={uda} vynimky={vynimky} backlogy={backlogy} emaily={emaily} show={show} kpi={kpi} prahy={prahy} upozAktivne={upozAktivne} />}
      {tab === "zataz" && <TabZataz manhours={manhours} V={V} TP={TP} staticData={staticData} uda={uda} kpi={kpi} backlogy={backlogy} prahy={prahy} />}
      {tab === "kvalita" && <TabKvalita staticData={staticData} prahy={prahy} />}
      {tab === "zmeny" && <TabZmeny pobocka={pobocka} staticData={staticData} zmeny={zmeny} setZmeny={setZmeny} manazeri={manazeri} save={save} prahy={prahy} />}
      {tab === "admin" && <TabVykony manhours={manhours} kpi={kpi} setKpi={setKpi} save={save} emaily={emaily} setEmaily={setEmaily} prahyR={prahyR} setPrahy={setPrahy} prahy={prahy} chranene={chranene} heslo={heslo} setHeslo={setHeslo} show={show} />}
      {tab === "import" && <TabImport saveRaw={saveRaw} saveRawDo={saveRawDo} nacitajRaw={nacitajRaw} pobocka={pobocka} show={show} ghOk={ghOk} />}
      {tab === "model" && <TabModel sources={{ vzniky: { ...V, vynD: vynimky.map((v) => v.datum) }, triedenie: TP.triedenie, prijem: TP.prijem }} vynD={vynimky.map((v) => v.datum)} uda={uda} />}

      {toast && <div className={`toast ${toast.err ? "err" : ""}`}>{toast.msg}</div>}
    </div>
  );
}

// ------------------------------------------------------------- 🔮 Predikcia
function TabPredikcia({ D, uda, src, kpi, pomery, backlogy, avizo, TP, dfsIn }) {
  const [datum, setDatum] = useState(today());
  const [horizon, setHorizon] = useState(14);
  const { model, prof, daily } = D;
  const jePast = datum <= model.lastDate;
  const pred = jePast ? expectedFor(datum, model, uda) : predictDay(datum, model, uda);
  const skut = jePast ? daily.find((r) => r.datum === datum)?.jbl : undefined;
  const s = model.residStd;
  const ev = eventMult(datum, uda);
  const p = prof[String(dow(datum) >= 5)];
  const hist = daily.slice(-60);
  // príjem: ak existujú avíza, ponúkni aj odhad z plánu paliet
  const zAviza = src === "prijem" ? predictPrijemZAviza(datum, avizo, daily) : null;
  // distribúcia k nám navyšuje objem príjmu (samostatný zdroj)
  const dfsPrijem = useMemo(() => {
    if (src !== "prijem" || !dfsIn?.length) return null;
    const d = dfsDenne(dfsIn);
    const skut = d.find((r) => r.datum === datum);
    if (skut) return { hodnota: skut.jbl, typ: "skutočnosť" };
    if (d.length < 20) return null;
    const m = fitModel(d, [], uda);
    return { hodnota: predictDay(datum, m, uda), typ: "predikcia" };
  }, [src, dfsIn, datum, uda]);

  // ---- hodiny na spracovanie (výkony z KPI) ----
  const vykonPre = (pr) => {
    const o = (kpi || []).find((k) => k.proces === pr && k.datum === datum);
    if (o && +o.vykon > 0) return +o.vykon;
    const g = (kpi || []).find((k) => k.proces === pr && !k.datum);
    return g && +g.vykon > 0 ? +g.vykon : 0;
  };
  const PROC_MAP = {
    vzniky: [["Pick", pomery?.Pick ?? 1], ["Pack", pomery?.Pack ?? 1], ["Sort", 1]],
    triedenie: [["Pick", pomery?.Pick ?? 1], ["Pack", pomery?.Pack ?? 1], ["Sort", 1]],
    prijem: [["Príjem", 1]],
  };
  const procs = PROC_MAP[src] || [];
  const chybaVykon = procs.filter(([pr]) => !vykonPre(pr)).map(([pr]) => pr);
  const coefHod = procs.reduce((a, [pr, r]) => a + (vykonPre(pr) > 0 ? r / vykonPre(pr) : 0), 0);

  // prenesený backlog na tento deň (v jednotkách práce tohto zdroja)
  const bkVol = (backlogy || []).filter((b) => b.na_datum === datum).reduce((a, b) => {
    const zdr = b.zdroj || "triedenie";
    if (src === "prijem") return a + (zdr === "prijem" ? +b.objem : 0);
    if (src === "distribucia") return a + (zdr === "distribucia" ? +b.objem : 0);
    if (zdr === "prijem" || zdr === "distribucia") return a;
    return a + +b.objem * (zdr === "vzniky" && src === "triedenie" ? 0.884 : 1);
  }, 0);

  // intraday: skutočný výtlak vs. očakávanie (len ak deň má hodinové dáta)
  const hodDna = D.hourly.filter((r) => r.datum === datum);
  const actualByH = new Map(hodDna.map((r) => [+r.hodina, +r.joblines]));
  let surplus = 0, doneShare = 0;
  if (actualByH.size) {
    let done = 0, expShare = 0;
    for (const h of OP_HOURS) {
      if (!actualByH.has(h)) continue;
      done += actualByH.get(h);
      expShare += p[h];
    }
    surplus = done - pred * expShare; // + = beží nad očakávaním, - = zaostáva
    doneShare = expShare;
  }

  const zakladHod = pred * coefHod;
  const bkHod = bkVol * coefHod;
  const intradayHod = -surplus * coefHod; // prebytok výtlaku hodiny uberá
  const spoluHod = Math.max(0, zakladHod + bkHod + intradayHod);
  const deltaHod = bkHod + intradayHod;
  return (
    <>
      <div className="frm" style={{ marginBottom: 12 }}>
        <div className="fld"><label>{t("Dátum predikcie")}</label><input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
        <div className="fld"><label>{t("Horizont")}: {horizon} {t("dní")}</label><input type="range" min="7" max="28" value={horizon} onChange={(e) => setHorizon(+e.target.value)} /></div>
      </div>
      {(zAviza || dfsPrijem) && (
        <div className="card" style={{ marginBottom: 10, borderLeft: "3px solid var(--blue)" }}>
          <div className="lbl">{t("Celkový objem príjmu")}</div>
          <div className="val blue">{nf.format((zAviza ? zAviza.predikcia : pred) + (dfsPrijem ? dfsPrijem.hodnota : 0))}</div>
          <div className="sub">
            {zAviza
              ? `${t("z avíz")} ${nf.format(zAviza.predikcia)} (${nf.format(zAviza.plan)} ${t("paliet")} × ${nf1.format(zAviza.koef)})`
              : `${t("z modelu")} ${nf.format(pred)}`}
            {dfsPrijem ? ` + ${t("distribúcia k nám")} ${nf.format(dfsPrijem.hodnota)} (${dfsPrijem.typ})` : ""}
          </div>
        </div>
      )}
      <div className="grid g4">
        {jePast && skut != null ? (
          <Card lbl={`${t("Skutočnosť")} · ${fmtD(datum)} (${DNI[dow(datum)]})`} val={nf.format(skut)} cls="accent"
            sub={`${t("model očakával")} ${nf.format(pred)} · ${t("odchýlka")} ${((skut / pred - 1) * 100).toFixed(1)} %`} />
        ) : (
          <Card lbl={`${jePast ? t("Očakávané (spätne)") : t("Predikcia")} ${t("na")} ${fmtD(datum)} (${DNI[dow(datum)]})`} val={nf.format(pred)} cls="accent"
            sub={jePast ? "skutočnosť pre tento deň nie je v dátach – doplň ju v Zadávaní dát"
              : `${t("80 % interval")}: ${nf.format(pred * (1 - 1.28 * s))} – ${nf.format(pred * (1 + 1.28 * s))} · ${t("zohľadňuje skutočnosť posledných dní (korekcia)")} ×${(model.corr ?? 1).toFixed(2)}`} />
        )}
        
      </div>

      <div className="section">
        <h3>{t("Hodinová predikcia")} · {fmtD(datum)}</h3>
        {D.prof?.rovnomerny && (
          <p className="note" style={{ color: "var(--amber)" }}>
            {t("Hodinový profil sa nedá spočítať – pre tento zdroj chýbajú hodinové dáta, objem je preto rozdelený rovnomerne. Nahraj príslušný export v záložke Dáta.")}
          </p>
        )}
        <div className="chartbox"><Bars data={OP_HOURS.map((h) => ({ x: String(h).padStart(2, "0"), y: pred * p[h] }))} /></div>
        <p className="note">{t("Prevádzkový deň")} {String(OP_START).padStart(2, "0")}:00 – {String(OP_START).padStart(2, "0")}:00 {t("nasledujúceho dňa.")}</p>
      </div>

      <div className="section">
        <h3>{t("Denná predikcia · najbližších")} {horizon} {t("dní")}</h3>
        <div className="chartbox">
          <Bars data={Array.from({ length: horizon }, (_, i) => {
            const d = addDays(today(), i);
            return { x: fmtD(d), y: predictDay(d, model, uda), hl: eventMult(d, uda) !== 1 };
          })} />
          <div className="legend"><span><i style={{ background: "var(--green)" }} />{t("bežný deň")}</span><span><i style={{ background: "var(--amber)" }} />{t("deň s udalosťou")}</span></div>
        </div>
      </div>

      <div className="section">
        <h3>{t("Skutočnosť vs. model · posledných 60 dní")}</h3>
        <div className="chartbox">
          <div className="legend"><span><i style={{ background: "var(--green)" }} />{t("skutočnosť")}</span><span><i style={{ background: "var(--muted)" }} />{t("model")}</span></div>
          <Lines xLabels={hist.map((r) => fmtD(r.datum))} series={[
            { color: "var(--green)", points: hist.map((r) => r.jbl) },
            { color: "var(--muted)", points: hist.map((r) => expectedFor(r.datum, model, uda)) },
          ]} />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------- ➕ Zadávanie dát
function TabVstup({ src, zaznamy, setZaznamy, vynimky, setVynimky, save, D, uda }) {
  const [datum, setDatum] = useState(addDays(today(), -1));
  const [total, setTotal] = useState(0);
  const [anom, setAnom] = useState("Žiadna");
  const [poHodinach, setPoHodinach] = useState(false);
  const [hodiny, setHodiny] = useState(Array(24).fill(""));
  const [anomHod, setAnomHod] = useState(Array(24).fill(false));
  const zazSrc = zaznamy.filter((z) => (z.zdroj || "triedenie") === src);
  const COLS = ["datum", "hodina", "joblines", "poznamka", "zdroj", "anomalia"];
  const VCOLS = ["datum", "typ", "popis", "hodiny"];
  const sumHodin = hodiny.reduce((a, v) => a + (+v || 0), 0);
  // očakávanie na hodinu = denný plán × hodinový podiel; slúži ako predvyplnená hodnota
  const denPlan = D ? (D.daily.find((r) => r.datum === datum)?.jbl ?? predictDay(datum, D.model, uda)) : 0;
  const p24 = D ? D.prof[String(dow(datum) >= 5)] : Array(24).fill(1 / 24);
  const ocakHod = (h) => Math.round(denPlan * (p24[h] || 0));
  const jeDnes = datum === today();
  const aktIdx = jeDnes ? opIdx(new Date().getHours()) : -1;
  const anomCnt = anomHod.filter(Boolean).length;

  const uloz = () => {
    const rest = zaznamy.filter((z) => !(z.datum === datum && (z.zdroj || "triedenie") === src));
    const pozn = anom !== "Žiadna" ? anom : "";
    let rows;
    if (poHodinach && sumHodin > 0) {
      rows = [...rest, ...OP_HOURS.map((h, i) => ({
        datum, hodina: h, joblines: +hodiny[i] || 0, poznamka: pozn, zdroj: src,
        anomalia: anom !== "Žiadna" && anomHod[i] ? 1 : "",
      })).filter((r) => r.joblines > 0 || r.anomalia === 1)];
    } else {
      rows = [...rest, { datum, hodina: "", joblines: total, poznamka: pozn, zdroj: src, anomalia: "" }];
    }
    save("zaznamy.csv", rows, COLS, `data: záznam JBL ${datum} (${src})`, setZaznamy);
    if (anom !== "Žiadna") {
      const affReal = poHodinach ? OP_HOURS.filter((h, i) => anomHod[i]) : [];
      const vrest = vynimky.filter((v) => v.datum !== datum);
      save("vynimky.csv", [...vrest, { datum, typ: anom, popis: "zadané pri vklade dát", hodiny: affReal.join(",") }],
        VCOLS, `data: výnimka ${datum} – ${anom}${affReal.length ? ` (${affReal.length} h)` : ""}`, setVynimky);
    }
  };
  const zmaz = (d) => {
    const rows = zaznamy.filter((z) => !(z.datum === d && (z.zdroj || "triedenie") === src));
    save("zaznamy.csv", rows, COLS, `data: vymazaný záznam ${d} (${src})`, setZaznamy);
  };

  return (
    <>
      <p className="note" style={{ color: "var(--amber)" }}>{t("Ručne zadané hodnoty sú predbežné – platia len pre dni, ktoré ešte nie sú v importovaných dátach. Ranný import ich automaticky nahradí.")}</p>
      <p className="note">{t("Spätné zadanie skutočných jobline pre zdroj")} <b>{t(src)}</b>. {t("Záznam prepíše baseline pre daný deň.")}
        Anomália obmedzená na konkrétne hodiny deň z modelu nevyhodí – postihnuté hodiny sa dopočítajú z profilu
        a deficit sa vyčísli ako backlog (záložka Anomálie).</p>
      <div className="frm">
        <div className="fld"><label>{t("Dátum (prevádzkový deň)")}</label><input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
        <div className="fld"><label>{t("Joblines spolu (deň)")}</label>
          <input type="number" min="0" step="100" value={poHodinach ? sumHodin : (total || "")} disabled={poHodinach}
            onChange={(e) => setTotal(+e.target.value || 0)} /></div>
        <div className="fld"><label>{t("Anomália (voliteľné)")}</label>
          <select value={anom} onChange={(e) => setAnom(e.target.value)}>
            <option value="Žiadna">{t("Žiadna")}</option>{TYPY_VYNIMIEK.map((v) => <option key={v} value={v}>{t(v)}</option>)}
          </select></div>
        <button className="btn" disabled={poHodinach ? sumHodin === 0 : !total} onClick={uloz}><Ico n="save" />{t("Uložiť záznam")}</button>
        {poHodinach && <button className="btn ghost" style={{ color: "var(--text)" }}
          onClick={() => setHodiny(OP_HOURS.map((h, i) => (aktIdx >= 0 && i > aktIdx ? "" : String(ocakHod(h)))))}>
          {t("Predvyplniť očakávaním")}</button>}
      </div>
      <div className="frm" style={{ marginTop: 10 }}>
        <label style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={poHodinach} onChange={(e) => setPoHodinach(e.target.checked)} />
          {t("Zadať po hodinách (prevádzkový deň 06:00 → 05:00)")}
        </label>
      </div>
      {poHodinach && (
        <>
          {anom !== "Žiadna" && <p className="note" style={{ color: "var(--amber)" }}>Zaškrtni pri hodinách, ktoré boli ovplyvnené anomáliou „{anom}“ ({anomCnt}{" "}{t("označených).")}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 6, marginTop: 8 }}>
            {OP_HOURS.map((h, i) => (
              <div className="fld" key={h} style={{
                padding: 4, borderRadius: 8,
                outline: i === aktIdx ? "2px solid var(--green2)" : (anomHod[i] && anom !== "Žiadna" ? "1px solid var(--amber)" : "none"),
                background: i === aktIdx ? "#00b84a12" : "transparent",
                opacity: aktIdx >= 0 && i > aktIdx ? 0.45 : 1,
              }}>
                <label>{String(h).padStart(2, "0")}:00{h < OP_START ? " (+1)" : ""}{i === aktIdx ? ` · ${t("teraz")}` : ""}</label>
                <input type="number" min="0" style={{ minWidth: 0 }} value={hodiny[i]}
                  placeholder={String(ocakHod(h))} title={`${t("očakávanie")}: ${ocakHod(h)}`}
                  onChange={(e) => setHodiny(hodiny.map((v, j) => (j === i ? e.target.value : v)))} />
                {anom !== "Žiadna" && (
                  <label style={{ fontSize: 10.5, color: anomHod[i] ? "var(--amber)" : "var(--muted)", display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={anomHod[i]} onChange={(e) => setAnomHod(anomHod.map((v, j) => (j === i ? e.target.checked : v)))} />
                    anomália
                  </label>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section">
        <h3>{t("Zadané záznamy")} · {src} ({new Set(zazSrc.map((z) => z.datum)).size}{" "}{t("dní)")}</h3>
        {zazSrc.length ? (
          <table className="t"><thead><tr><th>{t("Dátum")}</th><th>{t("Joblines")}</th><th>{t("Anomália")}</th><th /></tr></thead>
            <tbody>{[...new Set(zazSrc.map((z) => z.datum))].sort().reverse().map((d) => {
              const rs = zazSrc.filter((z) => z.datum === d);
              const suma = rs.reduce((a, z) => a + (+z.joblines || 0), 0);
              const an = rs.find((z) => z.poznamka)?.poznamka;
              const anH = rs.filter((z) => String(z.anomalia) === "1").length;
              return (
                <tr key={d}><td>{fmtD(d)}{d.slice(0, 4)}</td><td>{nf.format(suma)}</td>
                  <td>{an ? <span className="pill amber">{t(an)}{anH ? ` · ${anH} h` : ""}</span> : "–"}</td>
                  <td><button className="btn ghost" onClick={() => zmaz(d)}><Ico n="trash" /></button></td></tr>
              );
            })}</tbody></table>
        ) : <p className="note">{t("Zatiaľ žiadne používateľské záznamy – model beží na baseline dátach.")}</p>}
      </div>
    </>
  );
}

// -------------------------------------------------------- ⚠️ Anomálie
function TabAnomalie({ D, uda, src, vynimky, setVynimky, save }) {
  const [thr, setThr] = useState(25);
  const [datum, setDatum] = useState(addDays(today(), -1));
  const [typ, setTyp] = useState(TYPY_VYNIMIEK[0]);
  const [popis, setPopis] = useState("");
  const [selHod, setSelHod] = useState([]);
  const { daily, model, prof, hourly, part } = D;
  const VCOLS = ["datum", "typ", "popis", "hodiny"];
  const vmap = new Map(vynimky.map((v) => [v.datum, v]));
  const anom = daily
    .map((r) => ({ ...r, ocak: expectedFor(r.datum, model, uda) }))
    .map((r) => ({ ...r, dev: r.jbl / r.ocak - 1 }))
    .filter((r) => Math.abs(r.dev) >= thr / 100)
    .sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const bez = anom.filter((r) => !vmap.has(r.datum)).length;

  const uloz = () => {
    const rest = vynimky.filter((v) => v.datum !== datum);
    save("vynimky.csv", [...rest, { datum, typ, popis, hodiny: [...selHod].sort((a, b) => a - b).join(",") }],
      VCOLS, `data: výnimka ${datum} – ${typ}${selHod.length ? ` (${selHod.length} h)` : ""}`, setVynimky);
  };
  const zmaz = (d) => save("vynimky.csv", vynimky.filter((v) => v.datum !== d), VCOLS, `data: odstránená výnimka ${d}`, setVynimky);
  const togHod = (h) => setSelHod(selHod.includes(h) ? selHod.filter((x) => x !== h) : [...selHod, h]);

  return (
    <>
      <div className="frm" style={{ marginBottom: 10 }}>
        <div className="fld"><label>{t("Prah odchýlky")}: ±{thr} %</label><input type="range" min="10" max="50" value={thr} onChange={(e) => setThr(+e.target.value)} /></div>
      </div>
      <p className="note">{t("Nájdených")} <b>{anom.length}</b> {t("dní mimo")} ±{thr} % {t("od modelu, z toho")} <span className="bad">{bez}{" "}{t("bez priradenej výnimky")}</span>.
        Výnimka na celý deň sa z tréningu vylúči; výnimka obmedzená na hodiny deň opraví dopočtom a zvyšok dňa trénuje ďalej.</p>
      <table className="t"><thead><tr><th>{t("Dátum")}</th><th>{t("Skutočnosť")}</th><th>{t("Očakávané")}</th><th>{t("Odchýlka")}</th><th>{t("Výnimka")}</th></tr></thead>
        <tbody>{anom.slice(0, 40).map((r) => (
          <tr key={r.datum}>
            <td>{fmtD(r.datum)}{r.datum.slice(0, 4)} {DNI[dow(r.datum)]}</td>
            <td>{nf.format(r.jbl)}</td><td>{nf.format(r.ocak)}</td>
            <td className={r.dev < 0 ? "bad" : "accent"}>{(r.dev * 100).toFixed(1)} %</td>
            <td>{vmap.has(r.datum) ? <span className="pill gray">{t(vmap.get(r.datum).typ)}{vmap.get(r.datum).hodiny ? ` · h ${vmap.get(r.datum).hodiny}` : ""}</span> : <span className="pill red">{t("nepriradená")}</span>}</td>
          </tr>
        ))}</tbody></table>

      <div className="section">
        <h3>{t("Priradiť výnimku")}</h3>
        <div className="frm">
          <div className="fld"><label>{t("Dátum")}</label><input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
          <div className="fld"><label>{t("Typ výnimky")}</label>
            <select value={typ} onChange={(e) => setTyp(e.target.value)}>{TYPY_VYNIMIEK.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></div>
          <div className="fld"><label>{t("Popis (voliteľné)")}</label><input value={popis} onChange={(e) => setPopis(e.target.value)} /></div>
          <button className="btn" onClick={uloz}><Ico n="save" />{t("Uložiť výnimku")}</button>
        </div>
        <p className="note" style={{ marginTop: 8 }}>{t("Postihnuté hodiny (voliteľné – nič neoznačené = celý deň):")}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {OP_HOURS.map((h) => (
            <button key={h} onClick={() => togHod(h)}
              style={{ padding: "5px 9px", borderRadius: 7, border: "1px solid var(--border)", cursor: "pointer", fontSize: 12, fontFamily: "var(--mono)",
                background: selHod.includes(h) ? "var(--amber)" : "transparent", color: selHod.includes(h) ? "#1b1400" : "var(--muted)" }}>
              {String(h).padStart(2, "0")}{h < OP_START ? "⁺¹" : ""}
            </button>
          ))}
        </div>
      </div>


      {vynimky.length > 0 && (
        <div className="section">
          <h3>{t("Evidované výnimky (")} {vynimky.length})</h3>
          <table className="t"><thead><tr><th>{t("Dátum")}</th><th>{t("Typ")}</th><th>{t("Hodiny")}</th><th>{t("Popis")}</th><th /></tr></thead>
            <tbody>{[...vynimky].sort((a, b) => (a.datum < b.datum ? 1 : -1)).map((v) => (
              <tr key={v.datum}><td>{fmtD(v.datum)}{v.datum.slice(0, 4)}</td><td>{t(v.typ)}</td>
                <td>{v.hodiny ? <span className="pill amber">{v.hodiny}</span> : <span className="pill gray">{t("celý deň")}</span>}</td>
                <td style={{ fontFamily: "var(--sans)" }}>{v.popis}</td>
                <td><button className="btn ghost" onClick={() => zmaz(v.datum)}><Ico n="trash" /></button></td></tr>
            ))}</tbody></table>
        </div>
      )}
    </>
  );
}

// -------------------------------------------------------- 📅 Udalosti
function TabUdalosti({ D, uda, setUdalosti, save, zlomy, setZlomy, rawDaily }) {
  const dk = D.model.defaultKoef;
  const [nazov, setNazov] = useState("");
  const [typ, setTyp] = useState("Alza dni");
  const [od, setOd] = useState(today());
  const [doD, setDoD] = useState(addDays(today(), 1));
  const [koef, setKoef] = useState(dk["Alza dni"]);
  const [eOd, setEOd] = useState(addDays(today(), -14));
  const [eDo, setEDo] = useState(addDays(today(), -10));
  const [odhad, setOdhad] = useState(null);
  const COLS = ["nazov", "od", "do", "typ", "koeficient"];

  const changeTyp = (t) => { setTyp(t); setKoef(dk[t] ?? 1.1); };
  const uloz = () => {
    if (!nazov.trim() || doD < od) return;
    save("udalosti.csv", [...uda, { nazov: nazov.trim(), od, do: doD, typ, koeficient: koef }], COLS, `data: udalosť ${nazov.trim()}`, setUdalosti);
    setNazov("");
  };
  const zmaz = (n) => save("udalosti.csv", uda.filter((u) => u.nazov !== n), COLS, `data: vymazaná udalosť ${n}`, setUdalosti);
  const spocitaj = () => {
    const rng = D.daily.filter((r) => r.datum >= eOd && r.datum <= eDo);
    if (!rng.length) { setOdhad("V zadanom rozsahu nie sú žiadne dáta."); return; }
    const ratios = rng.map((r) => r.jbl / (expectedFor(r.datum, D.model, uda) / eventMult(r.datum, uda)));
    ratios.sort((a, b) => a - b);
    const k = ratios[ratios.length >> 1];
    setOdhad(`Navrhovaný koeficient: ${k.toFixed(2)} (medián pomeru skutočnosť/model za ${rng.length}{" "}{t("dní)")}`);
  };

  const ZCOLS = ["datum", "popis", "koef"];
  const [zlDatum, setZlDatum] = useState(today());
  const [zlPopis, setZlPopis] = useState("");
  const navrhKoef = useMemo(() => (rawDaily ? koefZlomu(rawDaily, zlDatum) : null), [rawDaily, zlDatum]);
  const ulozZlom = () => {
    const rest = (zlomy || []).filter((z) => z.datum !== zlDatum);
    save("zlomy.csv", [...rest, { datum: zlDatum, popis: zlPopis, koef: "" }], ZCOLS, `data: štrukturálny zlom ${zlDatum}`, setZlomy);
    setZlPopis("");
  };
  const zmazZlom = (d) => save("zlomy.csv", (zlomy || []).filter((z) => z.datum !== d), ZCOLS, `data: odstránený zlom ${d}`, setZlomy);

  return (
    <>
      <p className="note">{t("Koeficient násobí predikciu v danom rozsahu (1.05 = +5 %). Historické udalosti sa zároveň odfiltrujú zo sezónnosti modelu. Koeficient sa predvyplní z historických dát podľa typu – môžeš ho upraviť.")}</p>
      <div className="frm">
        <div className="fld"><label>{t("Názov")}</label><input placeholder={t("napr. Alza dni august")} value={nazov} onChange={(e) => setNazov(e.target.value)} style={{ minWidth: 200 }} /></div>
        <div className="fld"><label>{t("Typ")}</label><select value={typ} onChange={(e) => changeTyp(e.target.value)}>{TYPY_UDALOSTI.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></div>
        <div className="fld"><label>{t("Od")}</label><input type="date" value={od} onChange={(e) => setOd(e.target.value)} /></div>
        <div className="fld"><label>{t("Do")}</label><input type="date" value={doD} onChange={(e) => setDoD(e.target.value)} /></div>
        <div className="fld"><label>{t("Koeficient")}</label><input type="number" step="0.01" min="0.3" max="2.5" value={koef} onChange={(e) => setKoef(+e.target.value)} /></div>
        <button className="btn" disabled={!nazov.trim()} onClick={uloz}><Ico n="save" />{t("Uložiť udalosť")}</button>
      </div>
      {typ === "Black Friday" && <p className="note">{t("Koeficient 1.36 vypočítaný z vznikov počas BF víkendu 2025 (27.11.–1.12.) oproti okolitým týždňom.")}</p>}

      <div className="section">
        <h3>{t("Štrukturálne zlomy")}</h3>
        <p className="note">
          {t("Trvalá zmena úrovne – prevzatie smeru z inej pobočky, nová linka, presun objemu. Staršie dni sa prepočítajú koeficientom, takže sezónnosť zostane použiteľná a úroveň zodpovedá súčasnému stavu. Na rozdiel od udalosti sa neskončí, platí ďalej.")}
        </p>
        <div className="frm">
          <div className="fld"><label>{t("Dátum zmeny")}</label>
            <input type="date" value={zlDatum} onChange={(e) => setZlDatum(e.target.value)} /></div>
          <div className="fld"><label>{t("Popis")}</label>
            <input value={zlPopis} placeholder={t("napr. prevzatý smer z CZLC4")} onChange={(e) => setZlPopis(e.target.value)} /></div>
          <div className="fld"><label>{t("Vypočítaný koeficient")}</label>
            <input value={navrhKoef ? "×" + navrhKoef.toFixed(3) : t("málo dát")} disabled /></div>
          <button className="btn" disabled={!navrhKoef} onClick={ulozZlom}><Ico n="save" />{t("Uložiť zlom")}</button>
        </div>
        {navrhKoef && (
          <p className="note">
            {t("Koeficient sa počíta z porovnania rovnakých dní v týždni pred a po zmene – prepočítava sa priebežne, takže sa spresní s pribúdajúcimi dátami.")}
            {" "}{t("Aktuálne")}: {((navrhKoef - 1) * 100).toFixed(1)} %.
          </p>
        )}
        {(zlomy || []).length > 0 && (
          <table className="t" style={{ maxWidth: 620, marginTop: 10 }}>
            <thead><tr><th>{t("Dátum")}</th><th>{t("Popis")}</th><th style={{ textAlign: "right" }}>{t("Koeficient")}</th><th /></tr></thead>
            <tbody>{[...zlomy].sort((a, b) => (a.datum < b.datum ? 1 : -1)).map((z) => {
              const k = +z.koef > 0 ? +z.koef : (rawDaily ? koefZlomu(rawDaily, z.datum) : null);
              return (
                <tr key={z.datum}>
                  <td>{fmtD(z.datum)}{z.datum.slice(0, 4)}</td>
                  <td style={{ fontFamily: "var(--sans)" }}>{z.popis}</td>
                  <td style={{ textAlign: "right" }} className={k > 1 ? "accent" : k < 1 ? "warn" : ""}>
                    {k ? `×${k.toFixed(3)} (${k >= 1 ? "+" : ""}${((k - 1) * 100).toFixed(1)} %)` : "–"}</td>
                  <td><button className="btn ghost" onClick={() => zmazZlom(z.datum)}><Ico n="trash" /></button></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>

      {uda.length > 0 && (
        <div className="section">
          <table className="t"><thead><tr><th>{t("Názov")}</th><th>{t("Od")}</th><th>{t("Do")}</th><th>{t("Typ")}</th><th>{t("Koef.")}</th><th /></tr></thead>
            <tbody>{[...uda].sort((a, b) => (a.od < b.od ? 1 : -1)).map((u) => (
              <tr key={u.nazov}><td style={{ fontFamily: "var(--sans)" }}>{u.nazov}</td><td>{fmtD(u.od)}{u.od.slice(0, 4)}</td><td>{fmtD(u.do)}{u.do.slice(0, 4)}</td>
                <td><span className="pill green">{t(u.typ)}</span></td><td>×{(+u.koeficient).toFixed(2)}</td>
                <td><button className="btn ghost" onClick={() => zmaz(u.nazov)}><Ico n="trash" /></button></td></tr>
            ))}</tbody></table>
        </div>
      )}

      <div className="section">
        <h3>{t("Predpočítané koeficienty z histórie")}</h3>
        <table className="t"><thead><tr><th>{t("Typ udalosti")}</th><th>{t("Default")}</th></tr></thead>
          <tbody>{Object.entries(dk).map(([t, k]) => <tr key={t}><td style={{ fontFamily: "var(--sans)" }}>{t}</td><td>×{(+k).toFixed(2)}</td></tr>)}</tbody></table>
        <p className="note">{t("Alza dni / Mega zľavy / AlzaPlus+: log-lineárna regresia na reálnom promo kalendári feb–jún 2026. Black Friday: BF víkend 2025 z vznikov. Výplatný termín: priemer faktora dní 10.–16. Sviatok: medián prepadu anomálnych dní.")}</p>
      </div>

      <div className="section">
        <h3>{t("Odhad koeficientu z histórie")}</h3>
        <div className="frm">
          <div className="fld"><label>{t("Od")}</label><input type="date" value={eOd} onChange={(e) => setEOd(e.target.value)} /></div>
          <div className="fld"><label>{t("Do")}</label><input type="date" value={eDo} onChange={(e) => setEDo(e.target.value)} /></div>
          <button className="btn" onClick={spocitaj}><Ico n="search" />{t("Vypočítať koeficient")}</button>
        </div>
        {odhad && <p className="note" style={{ color: "var(--text)" }}>{odhad}</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------ Prehľad (denný report)
function TabPrehlad({ V, TP, staticData, uda, vynimky, backlogy, emaily, show, kpi, prahy, upozAktivne = [], pobocka, dfsIn }) {
  const [vybrane, setVybrane] = useState([]);
  const box = useRef(null);

  const den = V.model.lastDate;                 // posledný úplný prevádzkový deň
  const tyzden = addDays(den, -7);
  const dennaHod = (daily, d) => daily.find((r) => r.datum === d)?.jbl ?? null;
  const nf1p = (x) => (x >= 0 ? "▲ +" : "▼ ") + nf1.format(Math.abs(x)) + " %";

  const vDen = dennaHod(V.daily, den), vTyz = dennaHod(V.daily, tyzden);
  const tDen = dennaHod(TP.triedenie.daily, den);
  // distribúcia sa sleduje cez DFS (toky medzi pobočkami)
  const dDen = useMemo(() => {
    const m = new Map();
    for (const r of dfsIn || []) m.set(r.datum, (m.get(r.datum) || 0) + (+r.joblines || 0));
    return m.get(den) ?? null;
  }, [dfsIn, den]);
  const ocak = expectedFor(den, V.model, uda);
  const presnost = vDen != null ? (vDen / ocak - 1) * 100 : null;

  // kvalita: posledný deň, ktorý má dáta
  const kvR = staticData.kvalitaDenne || [];
  const kvDni = [...new Set(kvR.map((r) => r.datum))].sort();
  const kvDen = kvDni[kvDni.length - 1], kvPred = kvDni[kvDni.length - 2];
  const kvOf = (filtr, d) => {
    const rs = kvR.filter((r) => r.datum === d && filtr(r.proces));
    if (!rs.length) return null;
    const c = rs.reduce((a, r) => a + +r.celkem, 0), z = rs.reduce((a, r) => a + +r.pozde, 0);
    return c > 0 ? (1 - z / c) * 100 : null;
  };
  const kvKarta = (nazov, filtr) => {
    const v = kvOf(filtr, kvDen), p = kvOf(filtr, kvPred);
    return { nazov, v, d: v != null && p != null ? v - p : null };
  };
  const rozpad = (filtr) => [...new Set(kvR.filter((r) => r.datum === kvDen && filtr(r.proces)).map((r) => r.proces))]
    .map((p) => { const v = kvOf((x) => x === p, kvDen); return `${p.replace(/^\d+\.\s*/, "")} ${v != null ? v.toFixed(1) + " %" : "–"}`; })
    .join(" · ");
  const karty = [
    { ...kvKarta(t("Kvalita Sort"), (p) => p.includes("Sort")), det: null },
    { ...kvKarta(t("Kvalita zvozu (EXP)"), (p) => p.includes("EXP")), det: rozpad((p) => p.includes("EXP")) },
    { ...kvKarta(t("Kvalita BJ"), (p) => p.includes("BJ")), det: rozpad((p) => p.includes("BJ")) },
  ];
  const procesy = [...new Set(kvR.filter((r) => r.datum === kvDen).map((r) => r.proces))].sort();
  const qCls = (v) => (v == null ? "" : v >= prahy.kvZelena ? "accent" : v >= prahy.kvZlta ? "warn" : "bad");
  const hCls = (pomer) => (pomer == null ? "" : pomer <= prahy.hodZelena ? "accent" : pomer <= prahy.hodZlta ? "warn" : "bad");

  // ---- hodiny: potrebné (z výkonov a objemov) vs. spálené
  const vykonPre = (p) => {
    const o = (kpi || []).find((k) => k.proces === p && k.datum === den);
    if (o && +o.vykon > 0) return +o.vykon;
    const g = (kpi || []).find((k) => k.proces === p && !k.datum);
    return g && +g.vykon > 0 ? +g.vykon : 0;
  };
  const pom = staticData.pomery || {};
  const objemPre = (p) => {
    if (p === "Príjem") return dennaHod(TP.prijem.daily, den);
    return tDen != null ? tDen * (pom[p] ?? 1) : null;
  };
  const PROC_H = ["Príjem", "Pick", "Pack", "Sort"];
  // spálené hodiny – zatiaľ orientačný odhad, kým nedorazí výkaz odpracovaného času
  const spalenePre = (p) => {
    const need = potrebnePre(p);
    if (need == null) return null;
    const seed = [...(p + den)].reduce((a, c) => a + c.charCodeAt(0), 0);
    return need * (0.95 + ((seed % 25) / 100));
  };
  function potrebnePre(p) {
    const v = vykonPre(p), o = objemPre(p);
    return v > 0 && o != null ? o / v : null;
  }
  const hodiny = PROC_H.map((p) => ({ p, need: potrebnePre(p), burn: spalenePre(p) })).filter((x) => x.need != null);
  const needSum = hodiny.reduce((a, x) => a + x.need, 0);
  const burnSum = hodiny.reduce((a, x) => a + x.burn, 0);
  const pomerSum = needSum > 0 ? (burnSum / needSum) * 100 : null;

  // týždeň dozadu + dopredu
  const rada = Array.from({ length: 15 }, (_, i) => {
    const d = addDays(den, i - 7);
    const sk = dennaHod(V.daily, d);
    return { x: `${fmtD(d)} ${DNI[dow(d)]}`, y: sk ?? predictDay(d, V.model, uda), hl: sk == null };
  });
  const radaModel = Array.from({ length: 15 }, (_, i) => {
    const d = addDays(den, i - 7);
    return d <= den ? expectedFor(d, V.model, uda) : predictDay(d, V.model, uda);
  });

  // anomálie predchádzajúceho dňa (hodinové)
  const p24 = V.prof[String(dow(den) >= 5)];
  const hodMap = new Map();
  for (const r of V.hourly) if (r.datum === den) hodMap.set(+r.hodina, (hodMap.get(+r.hodina) || 0) + (+r.joblines || 0));
  const anomH = [...hodMap.entries()]
    .map(([h, v]) => ({ h, skut: v, ocak: (vDen || 0) * p24[h] }))
    .filter((x) => x.ocak > 30)
    .map((x) => ({ ...x, odch: (x.skut / x.ocak - 1) * 100 }))
    .filter((x) => Math.abs(x.odch) >= 25)
    .sort((a, b) => Math.abs(b.odch) - Math.abs(a.odch));
  const vynDen = vynimky.find((v) => v.datum === den);
  const bkOtvoreny = (backlogy || []).filter((b) => b.na_datum >= today());
  const bkObjem = bkOtvoreny.reduce((a, b) => a + (+b.objem || 0), 0);

  // ---- export a rozposlanie
  const png = async () => {
    const { toPng } = await import("html-to-image");
    return toPng(box.current, { backgroundColor: "#111111", pixelRatio: 2 });
  };
  const stiahni = async () => {
    try { const url = await png(); const a = document.createElement("a"); a.href = url; a.download = `prehlad-${String(pobocka).toLowerCase()}-${den}.png`; a.click(); }
    catch { show(t("Export obrázka zlyhal."), true); }
  };
  const kopiruj = async () => {
    try {
      const blob = await (await fetch(await png())).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      show(t("Obrázok je v schránke – vlož ho do e-mailu (Ctrl+V)."));
    } catch { show(t("Kopírovanie zlyhalo – použi stiahnutie obrázka."), true); }
  };
  const zhrnutie = () => [
    `${t("Prehľad")} ${pobocka} · ${fmtD(den)}${den.slice(0, 4)} (${DNI[dow(den)]})`, "",
    `${t("Objem (vzniky)")}: ${nf.format(vDen)}${vTyz ? ` (${nf1p((vDen / vTyz - 1) * 100)} ${t("vs. minulý týždeň")})` : ""}`,
    `${t("Expedícia (triedenie)")}: ${tDen != null ? nf.format(tDen) : t("dáta zatiaľ nie sú")}${dDen != null ? ` · ${t("distribúcia")} ${nf.format(dDen)}` : ""}`,
    `${t("Presnosť predikcie")}: ${presnost != null ? nf1p(presnost) : "–"}`,
    ...karty.map((k) => `${k.nazov}: ${k.v != null ? k.v.toFixed(1) + " %" : "–"}`),
    `${t("Anomálne hodiny")}: ${anomH.length}${anomH.length ? ` (${anomH.slice(0, 3).map((a) => `${String(a.h).padStart(2, "0")}:00 ${a.odch > 0 ? "+" : ""}${a.odch.toFixed(0)} %`).join(", ")})` : ""}`,
    `${t("Otvorený backlog")}: ${nf.format(bkObjem)} JBL`,
  ].join("\n");
  const outlook = async () => {
    await kopiruj();
    const komu = (vybrane.length ? vybrane : emaily.map((e) => e.email)).join(";");
    window.location.href = `mailto:${komu}?subject=${encodeURIComponent(`${t("Prehľad")} ${pobocka} · ${fmtD(den)}${den.slice(0, 4)}`)}&body=${encodeURIComponent(zhrnutie() + "\n\n" + t("Obrázok prehľadu vlož zo schránky (Ctrl+V)."))}`;
  };

  return (
    <>
      <div className="frm" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{t("Predchádzajúci deň")}</h3>
        <span className="note" style={{ margin: 0 }}>{fmtD(den)}{den.slice(0, 4)} ({DNI[dow(den)]}) · {t("prevádzkový deň 06:00–06:00")}</span>
      </div>

      <div ref={box}>
        <div className="grid g4">
          <Card lbl={t("Objem (vzniky)")} val={nf.format(vDen)} cls="accent"
            sub={vTyz ? `${nf1p((vDen / vTyz - 1) * 100)} ${t("vs. minulý týždeň")}` : t("bez porovnania")} />
          <Card lbl={t("Expedícia (triedenie)")} val={tDen != null ? nf.format(tDen) : "–"}
            sub={tDen != null ? (dDen != null ? `${t("distribúcia k nám")} ${nf.format(dDen)}` : "") : t("dáta za tento deň zatiaľ nie sú")} />
          <Card lbl={t("Presnosť predikcie")} val={presnost != null ? nf1p(presnost) : "–"}
            cls={presnost == null ? "" : Math.abs(presnost) <= 8 ? "accent" : Math.abs(presnost) <= 15 ? "warn" : "bad"}
            sub={`${t("model čakal")} ${nf.format(ocak)}`} />
          <Card lbl={t("Hodiny potrebné / spálené")}
            val={needSum > 0 ? <>{nf.format(needSum)} <span style={{ color: "var(--muted)" }}>/</span> <span className={hCls(pomerSum)}>{nf.format(burnSum)}</span></> : "–"}
            sub={pomerSum != null ? `${nf1.format(pomerSum)} % ${t("normy")}` : t("doplň výkony v záložke Admin")} />
        </div>

        <div className="grid g4" style={{ marginTop: 10 }}>
          {karty.map((k) => (
            <Card key={k.nazov} lbl={k.nazov} val={k.v != null ? k.v.toFixed(1) + " %" : "–"} cls={qCls(k.v)}
              sub={k.det || (k.d != null ? `${(k.d >= 0 ? "▲ +" : "▼ ") + Math.abs(k.d).toFixed(1)} b. ${t("vs. predošlý deň")}` : t("bez porovnania"))} />
          ))}
          <Card lbl={t("Upozornenia")} val={upozAktivne.length} cls={upozAktivne.some((u) => u.uroven === "cervena") ? "bad" : upozAktivne.length ? "warn" : ""}
            sub={upozAktivne.length
              ? `${upozAktivne.filter((u) => u.uroven === "cervena").length}× ${t("presun objemu")} · ${t("otvorený backlog")} ${nf.format(bkObjem)}`
              : `${t("bez upozornení")} · ${t("otvorený backlog")} ${nf.format(bkObjem)}`} />
        </div>

        <div className="section">
          <h3>{t("Objem: týždeň dozadu a dopredu")}</h3>
          <div className="chartbox">
            <div className="legend">
              <span><i style={{ background: "var(--green)" }} />{t("skutočnosť")}</span>
              <span><i style={{ background: "var(--amber)" }} />{t("predikcia")}</span>
              <span><i style={{ background: "var(--muted)", height: 3, borderRadius: 1 }} />{t("model")}</span>
            </div>
            <Bars data={rada} height={215} line={radaModel} />
          </div>
        </div>

        <div className="grid g2 section">
          <div className="card">
            <div className="lbl">{t("Anomálie predchádzajúceho dňa")}</div>
            <div className={`val ${anomH.length ? "warn" : ""}`}>{anomH.length}</div>
            <div className="sub">{anomH.length ? `${t("hodín mimo")} ±25 %` : t("všetky hodiny v tolerancii")}
              {vynDen ? ` · ${t(vynDen.typ)}` : anomH.length ? ` · ${t("bez priradenej výnimky")}` : ""}</div>
            {anomH.slice(0, 4).map((a) => (
              <div key={a.h} className="note" style={{ margin: "6px 0 0" }}>
                {String(a.h).padStart(2, "0")}:00 · <b className={a.odch < 0 ? "bad" : "accent"}>{a.odch > 0 ? "+" : ""}{a.odch.toFixed(0)} %</b>
                <span style={{ color: "var(--muted)" }}> · {nf.format(a.skut)} / {nf.format(a.ocak)}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="lbl">{t("Procesy · kvalita a hodiny")} · {fmtD(kvDen)}</div>
            <table className="t" style={{ marginTop: 6 }}>
              <thead><tr><th>{t("Proces")}</th><th style={{ textAlign: "right" }}>{t("Kvalita")}</th>
                <th style={{ textAlign: "right" }}>{t("Potreb. h")}</th><th style={{ textAlign: "right" }}>{t("Spálené h")}</th></tr></thead>
              <tbody>
                {procesy.map((p) => {
                  const v = kvOf((x) => x === p, kvDen);
                  const kluc = p.includes("Pick") ? "Pick" : p.includes("Pack") ? "Pack" : p.includes("Sort") ? "Sort" : null;
                  const h = kluc ? hodiny.find((x) => x.p === kluc) : null;
                  return (
                    <tr key={p}>
                      <td style={{ fontFamily: "var(--sans)" }}>{p}</td>
                      <td className={qCls(v)} style={{ textAlign: "right" }}>{v != null ? v.toFixed(1) + " %" : "–"}</td>
                      <td style={{ textAlign: "right" }}>{h ? nf.format(h.need) : "–"}</td>
                      <td className={h ? hCls((h.burn / h.need) * 100) : ""} style={{ textAlign: "right" }}>{h ? nf.format(h.burn) : "–"}</td>
                    </tr>
                  );
                })}
                {hodiny.filter((x) => x.p === "Príjem").map((h) => (
                  <tr key="prijem"><td style={{ fontFamily: "var(--sans)" }}>{t("Príjem")}</td><td style={{ textAlign: "right" }}>–</td>
                    <td style={{ textAlign: "right" }}>{nf.format(h.need)}</td>
                    <td className={hCls((h.burn / h.need) * 100)} style={{ textAlign: "right" }}>{nf.format(h.burn)}</td></tr>
                ))}
                <tr><td style={{ fontFamily: "var(--sans)", fontWeight: 650 }}>{t("Spolu")}</td><td />
                  <td style={{ textAlign: "right", fontWeight: 650 }}>{needSum > 0 ? nf.format(needSum) : "–"}</td>
                  <td className={hCls(pomerSum)} style={{ textAlign: "right", fontWeight: 650 }}>{needSum > 0 ? nf.format(burnSum) : "–"}</td></tr>
              </tbody>
            </table>
            <p className="note" style={{ marginBottom: 0 }}>{t("Spálené hodiny sú zatiaľ orientačné – po nahratí výkazu odpracovaného času sa nahradia skutočnými.")}</p>
          </div>
        </div>
      </div>

      <div className="section noprint">
        <h3>{t("Export a rozposlanie")}</h3>
        <div className="frm">
          <button className="btn" onClick={stiahni}><Ico n="obrazok" />{t("Stiahnuť ako obrázok")}</button>
          <button className="btn ghost" style={{ color: "var(--text)" }} onClick={() => window.print()}><Ico n="export" />{t("Tlačiť / uložiť PDF")}</button>
          <button className="btn ghost" style={{ color: "var(--text)" }} onClick={kopiruj}><Ico n="obrazok" />{t("Kopírovať obrázok")}</button>
          <button className="btn" onClick={outlook}><Ico n="mail" />{t("Otvoriť v Outlooku")}</button>
        </div>
        <p className="note">{t("Outlook: appka skopíruje obrázok do schránky a otvorí rozpísaný e-mail s číslami – obrázok doň vlož cez Ctrl+V. Odosiela sa z tvojho konta, takže adresát vidí teba ako odosielateľa.")}</p>
        {emaily.length ? (
          <>
            <p className="note">{t("Vyber príjemcov (spravujú sa v záložke Admin):")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {emaily.map((e) => {
                const on = vybrane.includes(e.email);
                return (
                  <button key={e.email} onClick={() => setVybrane(on ? vybrane.filter((x) => x !== e.email) : [...vybrane, e.email])}
                    style={{ padding: "5px 11px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontFamily: "var(--sans)",
                      border: "1px solid " + (on ? "var(--green2)" : "var(--border)"),
                      background: on ? "#00b84a1f" : "transparent", color: on ? "var(--green2)" : "var(--muted)" }}>
                    {e.meno ? `${e.meno} · ${e.email}` : e.email}
                  </button>
                );
              })}
            </div>
            <p className="note">{t("Označení príjemcovia sa predvyplnia do e-mailu, ktorý otvorí tlačidlo Otvoriť v Outlooku. Bez označenia sa predvyplnia všetci.")}</p>
          </>
        ) : <p className="note">{t("Žiadni príjemcovia – pridaj ich v záložke Admin.")}</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------ Perfo
// Koľko treba dnes odoslať: väčšina objemu vznikla v predchádzajúcich dňoch
// a je teda už známa – neodhaduje sa, počíta sa z matice zvozov.
function TabZataz({ V, TP, staticData, uda, kpi, backlogy, prahy, manhours }) {
  const zvozProfil = staticData.zvozProfil || [];
  const [datum, setDatum] = useState(today());
  const actual = useMemo(() => new Map(V.daily.map((r) => [r.datum, r.jbl])), [V.daily]);
  const matica = staticData.matica, prof = V.prof;

  // rozpad podľa dňa vzniku (D-0 až D-3)
  const zloz = [0, 1, 2, 3].map((k) => {
    const d = addDays(datum, -k);
    const skut = actual.get(d);
    const dayTotal = skut ?? predictDay(d, V.model, uda);
    const p = prof[String(dow(d) >= 5)];
    let objem = 0;
    for (let h = 0; h < 24; h++) {
      const m = matica[String(h)];
      if (m) objem += dayTotal * p[h] * m.expFrac * m[`d${k}`];
    }
    return { k, datum: d, dayTotal, objem, zname: skut != null };
  });
  const zname = zloz.filter((z) => z.zname).reduce((a, z) => a + z.objem, 0);
  const odhad = zloz.filter((z) => !z.zname).reduce((a, z) => a + z.objem, 0);
  const bk = (backlogy || []).filter((b) => b.na_datum === datum && (b.zdroj || "triedenie") !== "prijem")
    .reduce((a, b) => a + +b.objem * ((b.zdroj || "triedenie") === "vzniky" ? 0.884 : 1), 0);
  const spolu = zname + odhad + bk;
  const podielZnamy = spolu > 0 ? (zname / spolu) * 100 : 0;

  // koľko z toho je už spracované (triedenie za daný deň)
  const hotovo = TP.triedenie.daily.find((r) => r.datum === datum)?.jbl ?? null;
  const zostava = hotovo != null ? Math.max(spolu - hotovo, 0) : null;

  // hodiny na zvyšok
  const vykonPre = (p) => {
    const o = (kpi || []).find((k) => k.proces === p && k.datum === datum);
    if (o && +o.vykon > 0) return +o.vykon;
    const g = (kpi || []).find((k) => k.proces === p && !k.datum);
    return g && +g.vykon > 0 ? +g.vykon : 0;
  };
  const pom = staticData.pomery || {};
  const PROC_VSETKY = ["Príjem", "Potvrdenie", "Pick", "Pack", "Sort"];
  // výkon: prednosť má nastavená norma, inak skutočnosť z výkazu (60 dní)
  const vykonEfekt = (proces) => {
    const norma = vykonPre(proces);
    if (norma > 0) return { v: norma, zdroj: "norma" };
    const s = skutocnyVykon(manhours, proces);
    return s ? { v: s.vykon, zdroj: "skutočnosť" } : null;
  };
  const prijemDen = TP.prijem.daily.find((r) => r.datum === datum)?.jbl
    ?? (TP.prijem.model ? predictDay(datum, TP.prijem.model, uda) : null);
  const pomerPotvrd = pomerKPrijmu(manhours, "Potvrdenie") ?? 1.04;
  const objemPre = (proces) => {
    if (proces === "Príjem") return prijemDen;
    if (proces === "Potvrdenie") return prijemDen != null ? prijemDen * pomerPotvrd : null;
    return spolu * (pom[proces] ?? 1);
  };
  const potrebnePre = (proces) => {
    const e = vykonEfekt(proces), o = objemPre(proces);
    return e && o != null ? o / e.v : null;
  };
  const hodinySpolu = PROC_VSETKY.reduce((a, p) => a + (potrebnePre(p) ?? 0), 0) || null;
  // zvyšok sa počíta len z expedičných procesov (príjem nesúvisí s odoslaním)
  const coefExp = ["Pick", "Pack", "Sort"].reduce((a, p) => {
    const e = vykonEfekt(p); return a + (e ? (pom[p] ?? 1) / e.v : 0);
  }, 0);
  const hodinyZvysok = coefExp > 0 && zostava != null ? zostava * coefExp : null;

  return (
    <>
      <p className="note">
        {t("Objem na odoslanie sa neodhaduje – väčšina dnešnej práce vznikla v predchádzajúcich dňoch a je už známa. Dopočítava sa len podiel dnešných vznikov, ktoré odídu ešte dnes (D0).")}
      </p>
      <div className="frm" style={{ marginBottom: 12 }}>
        <div className="fld"><label>{t("Deň odoslania")}</label>
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
      </div>

      <div className="grid g4">
        <Card lbl={t("Na odoslanie dnes")} val={nf.format(spolu)} cls="accent"
          sub={`${t("z toho známe")} ${nf1.format(podielZnamy)} %`} />
        <Card lbl={t("Známe (staršie vzniky)")} val={nf.format(zname)}
          sub={t("už vzniknuté – nemení sa")} />
        <Card lbl={t("Odhad (dnešné vzniky D0)")} val={nf.format(odhad)} cls="warn"
          sub={bk > 0 ? `+ ${nf.format(bk)} ${t("backlog")}` : t("jediná neistá časť")} />
        <Card lbl={t("Zostáva spracovať")} val={zostava != null ? nf.format(zostava) : "–"}
          sub={hotovo != null ? `${t("hotovo")} ${nf.format(hotovo)}` : t("dáta triedenia zatiaľ nie sú")} />
      </div>

      <div className="section">
        <h3>{t("Rozpad podľa dňa vzniku")}</h3>
        <table className="t">
          <thead><tr><th>{t("Deň vzniku")}</th><th>{t("Vzniklo")}</th><th>{t("Odíde v tento deň")}</th><th>{t("Podiel")}</th><th>{t("Stav")}</th></tr></thead>
          <tbody>
            {zloz.map((z) => (
              <tr key={z.k}>
                <td>{fmtD(z.datum)}{z.datum.slice(0, 4)} {DNI[dow(z.datum)]} (D−{z.k})</td>
                <td>{nf.format(z.dayTotal)}</td>
                <td>{nf.format(z.objem)}</td>
                <td>{spolu > 0 ? nf1.format((z.objem / spolu) * 100) + " %" : "–"}</td>
                <td>{z.zname ? <span className="pill green">{t("skutočnosť")}</span> : <span className="pill amber">{t("predikcia")}</span>}</td>
              </tr>
            ))}
            {bk > 0 && (
              <tr><td>{t("Prenesený backlog")}</td><td>–</td><td>{nf.format(bk)}</td>
                <td>{nf1.format((bk / spolu) * 100)} %</td><td><span className="pill amber">{t("prenos")}</span></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section">
        <h3>{t("Odchody zvozov počas dňa")}</h3>
        <div className="chartbox">
          <Bars color="var(--blue)" height={175} data={OP_HOURS.map((h) => ({ x: String(h).padStart(2, "0"), y: spolu * (zvozProfil[h] || 0) }))} />
          <p className="note">{t("Rozdelenie dnešného objemu podľa hodiny odchodu – profil z reálnych zvozov za posledných 60 dní.")}</p>
        </div>
      </div>

      <div className="section">
        <h3>{t("Výhľad na 7 dní")}</h3>
        <div className="chartbox">
          <Bars color="var(--amber)" height={175} data={Array.from({ length: 7 }, (_, i) => {
            const d = addDays(datum, i);
            let s = 0;
            for (let k = 0; k <= 3; k++) {
              const dv = addDays(d, -k);
              const tot = actual.get(dv) ?? predictDay(dv, V.model, uda);
              const p = prof[String(dow(dv) >= 5)];
              for (let h = 0; h < 24; h++) { const m = matica[String(h)]; if (m) s += tot * p[h] * m.expFrac * m[`d${k}`]; }
            }
            return { x: `${fmtD(d)} ${DNI[dow(d)]}`, y: s };
          })} />
          <p className="note">{t("Objem na odoslanie v nasledujúcich dňoch – vychádza z už vzniknutých objednávok a predikcie ďalších dní.")}</p>
        </div>
      </div>

      <div className="section">
        <h3>{t("Odpracované vs. potrebné hodiny")}</h3>
        {(() => {
          const mh = (manhours || []).filter((m) => m.datum === datum);
          if (!mh.length) return <p className="note">{t("Pre tento deň zatiaľ nie sú odpracované hodiny – nahraj výkaz SJL ManHours v záložke Dáta.")}</p>;
          const spalene = mh.reduce((a, m) => a + (+m.hodiny || 0), 0);
          const pomer = hodinySpolu > 0 ? (spalene / hodinySpolu) * 100 : null;
          const hCls = (p) => (p == null ? "" : p <= prahy.hodZelena ? "accent" : p <= prahy.hodZlta ? "warn" : "bad");
          return (
            <>
              <div className="grid g4">
                <Card lbl={t("Potrebné")} val={hodinySpolu ? nf1.format(hodinySpolu) + " h" : "–"} sub={t("z objemu a výkonov")} />
                <Card lbl={t("Odpracované")} val={nf1.format(spalene) + " h"} cls={hCls(pomer)}
                  sub={pomer != null ? `${nf1.format(pomer)} % ${t("normy")}` : t("doplň výkony v záložke Admin")} />
                <Card lbl={t("Rozdiel")} val={hodinySpolu ? (spalene - hodinySpolu >= 0 ? "+" : "") + nf1.format(spalene - hodinySpolu) + " h" : "–"}
                  cls={hCls(pomer)} sub={t("odpracované − potrebné")} />
                <Card lbl={t("Osôb-zmien (11 h)")} val={nf1.format(spalene / 11)} sub={`~${nf1.format(spalene / 11 / 2)} ${t("ľudí na zmenu")}`} />
              </div>
              <table className="t" style={{ marginTop: 10 }}>
                <thead><tr><th>{t("Proces")}</th><th style={{ textAlign: "right" }}>{t("Výkon")}</th>
                  <th style={{ textAlign: "right" }}>{t("Potreb. h")}</th>
                  <th style={{ textAlign: "right" }}>{t("Odpracované h")}</th><th style={{ textAlign: "right" }}>{t("Rozdiel")}</th></tr></thead>
                <tbody>{mh.sort((a, b) => (a.proces < b.proces ? -1 : 1)).map((m) => {
                  const potr = potrebnePre?.(m.proces) ?? null;
                  const p = potr ? ((+m.hodiny) / potr) * 100 : null;
                  return (
                    <tr key={m.proces}>
                      <td style={{ fontFamily: "var(--sans)" }}>{m.proces}</td>
                      <td style={{ textAlign: "right" }}>
                        {(() => { const e = vykonEfekt(m.proces); return e ? <>{nf.format(e.v)}{e.zdroj === "skutočnosť" && <span style={{ color: "var(--muted)" }}> *</span>}</> : "–"; })()}
                      </td>
                      <td style={{ textAlign: "right" }}>{potr ? nf1.format(potr) : "–"}</td>
                      <td className={hCls(p)} style={{ textAlign: "right" }}>{nf1.format(+m.hodiny)}</td>
                      <td className={hCls(p)} style={{ textAlign: "right" }}>{potr ? ((+m.hodiny - potr >= 0 ? "+" : "") + nf1.format(+m.hodiny - potr)) : "–"}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <p className="note" style={{ marginBottom: 0 }}>
                {t("* výkon nie je zadaný ako norma – použitý je skutočný priemer z výkazu za posledných 60 dní. Normy sa nastavujú v Admine.")}
              </p>
            </>
          );
        })()}
      </div>

      <div className="section">
        <h3>{t("Potrebné hodiny")}</h3>
        {hodinySpolu ? (
          <div className="grid g4">
            <Card lbl={t("Na celý deň")} val={nf1.format(hodinySpolu) + " h"}
              sub={`≈ ${nf1.format(hodinySpolu / 11)} ${t("osôb-zmien")}`} />
            <Card lbl={t("Na zostávajúci objem (expedícia)")} val={hodinyZvysok != null ? nf1.format(hodinyZvysok) + " h" : "–"} cls="accent"
              sub={hodinyZvysok != null ? `≈ ${nf1.format(hodinyZvysok / 11)} ${t("osôb-zmien")}` : t("dáta triedenia zatiaľ nie sú")} />
          </div>
        ) : <p className="note">{t("doplň výkony v záložke Admin")}</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------ Počasie
// Overuje, či počasie vysvetľuje odchýlky zákazníckych vznikov od modelu.
const MESTA = [
  { nazov: "Praha", lat: 50.08, lon: 14.44, vaha: 0.45 },
  { nazov: "Brno", lat: 49.20, lon: 16.61, vaha: 0.30 },
  { nazov: "Bratislava", lat: 48.15, lon: 17.11, vaha: 0.25 },
];

// ------------------------------------------------------------ ✅ Kvalita
function TabKvalita({ staticData, prahy }) {
  const rows = staticData.kvalitaDenne || [];
  const hod = staticData.kvalitaHodiny;
  const procesy = [...new Set(rows.map((r) => r.proces))].sort();
  const [open, setOpen] = useState(() => new Set());
  const [selProc, setSelProc] = useState("");
  if (!rows.length) return <p className="note">{t("Chýba súbor `kvalita_denne.csv` – vygeneruj ho cez `tools/quality_to_data.py`.")}</p>;

  const kv = (r) => (1 - (+r.pozde || 0) / (+r.celkem || 1)) * 100;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const qClass = (v) => (v >= prahy.kvZelena ? "accent" : v >= prahy.kvZlta ? "warn" : "bad");
  const MES = ["jan", "feb", "mar", "apr", "máj", "jún", "júl", "aug", "sep", "okt", "nov", "dec"];
  const monday = (ds) => { const d = new Date(ds + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const stvrtrok = (ds) => `${ds.slice(0, 4)} · Q${Math.floor((+ds.slice(5, 7) - 1) / 3) + 1}`;
  const mesiac = (ds) => `${MES[+ds.slice(5, 7) - 1]} ${ds.slice(0, 4)}`;

  const tog = (k) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const agg = (days) => ({
    kvA: avg(days.map(kv)),
    jbl: days.reduce((a, r) => a + +r.celkem, 0),
    pozde: days.reduce((a, r) => a + +r.pozde, 0),
    n: days.length,
  });
  const group = (days, keyFn) => {
    const m = new Map();
    for (const r of days) { const k = keyFn(r.datum); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m.entries()];
  };

  const Radek = ({ k, label, days, lvl, leaf }) => {
    const a = agg(days);
    const isOpen = open.has(k);
    return (
      <>
        <tr onClick={() => !leaf && tog(k)} style={{ cursor: leaf ? "default" : "pointer" }}>
          <td style={{ paddingLeft: 10 + lvl * 22, fontFamily: "var(--sans)", whiteSpace: "nowrap" }}>
            {!leaf && <span style={{ display: "inline-block", width: 16, color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</span>}
            {leaf && <span style={{ display: "inline-block", width: 16 }} />}
            {label}
          </td>
          <td className={qClass(a.kvA)} style={{ fontWeight: lvl === 0 ? 700 : 600 }}>{a.kvA.toFixed(1)} %</td>
          <td>{nf.format(a.jbl)}</td>
          <td>{nf.format(a.pozde)}</td>
          <td>{leaf ? DNI[dow(days[0].datum)] : `${a.n} d`}</td>
        </tr>
        {isOpen && !leaf && childRows(k, days, lvl + 1)}
      </>
    );
  };

  const childRows = (parentKey, days, lvl) => {
    if (lvl === 1) return group(days, stvrtrok).map(([q, d]) =>
      <Radek key={parentKey + q} k={parentKey + "|" + q} label={q} days={d} lvl={lvl} />);
    if (lvl === 2) return group(days, mesiac).map(([m, d]) =>
      <Radek key={parentKey + m} k={parentKey + "|" + m} label={m} days={d} lvl={lvl} />);
    if (lvl === 3) return group(days, monday).map(([w, d]) =>
      <Radek key={parentKey + w} k={parentKey + "|" + w} label={`${t("týždeň od")} ${fmtD(w)}`} days={d} lvl={lvl} />);
    return [...days].sort((a, b) => (a.datum < b.datum ? -1 : 1)).map((r) =>
      <Radek key={parentKey + r.datum} k={parentKey + r.datum} label={fmtD(r.datum) + r.datum.slice(0, 4)} days={[r]} lvl={lvl} leaf />);
  };

  const lastDay = [...new Set(rows.map((r) => r.datum))].sort().pop();

  return (
    <>
      <p className="note">{t("Kvalita = podiel jobline dokončených v limite, prevádzkové dni 06:00–06:00. Agregáty sú priemerom denných kvalít (každý deň rovnaká váha). Klikaním rozbaľuješ proces → štvrťrok → mesiac → týždeň → deň.")}</p>
      <table className="t">
        <thead><tr><th>{t("Obdobie")}</th><th>{t("Kvalita (Ø denných)")}</th><th>{t("Jobline")}</th><th>{t("Po limite")}</th><th>{t("Dní")}</th></tr></thead>
        <tbody>
          {procesy.map((p) => {
            const days = rows.filter((r) => r.proces === p);
            const last = days.find((r) => r.datum === lastDay);
            return <Radek key={p} k={p} days={days} lvl={0}
              label={<>{p} {last && <span className={`pill ${kv(last) >= prahy.kvZelena ? "green" : kv(last) >= prahy.kvZlta ? "amber" : "red"}`} style={{ marginLeft: 8 }}>{fmtD(lastDay)}: {kv(last).toFixed(1)} %</span>}</>} />;
          })}
        </tbody>
      </table>

      {hod && (
        <div className="section">
          <div className="frm" style={{ marginBottom: 8 }}>
            <div className="fld"><label>{t("Proces")}</label>
              <select value={selProc || procesy[0]} onChange={(e) => setSelProc(e.target.value)}>{procesy.map((p) => <option key={p}>{p}</option>)}</select></div>
          </div>
          <h3>{t("Kvalita podľa hodiny dňa · posledných")} {hod.dni} {t("dní · priemer denných hodinových kvalít")}</h3>
          <div className="chartbox">
            <Bars color="var(--amber)" height={200} data={OP_HOURS.map((h) => ({ x: String(h).padStart(2, "0"), y: (hod.profil[selProc || procesy[0]] || [])[h] ?? 0 }))} />
          </div>
          <p className="note">{t("Nízke stĺpce = hodiny, kde sa koncentrujú oneskorené dokončenia.")}</p>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------ ⚙️ Výkony
function TabVykony({ kpi, setKpi, save, emaily, setEmaily, prahyR, setPrahy, prahy, chranene, heslo, setHeslo, show, manhours }) {
  const PROCESY = ["Príjem", "Potvrdenie", "Pick", "Pack", "Sort"];
  const COLS = ["proces", "vykon", "datum"];
  const [glob, setGlob] = useState(null);
  const globVal = glob ?? Object.fromEntries(PROCESY.map((p) => {
    const r = kpi.find((k) => k.proces === p && !k.datum);
    return [p, r ? String(r.vykon) : ""];
  }));
  const ulozene = (p) => { const r = kpi.find((k) => k.proces === p && !k.datum); return r ? +r.vykon : null; };
  const zmenene = PROCESY.some((p) => String(ulozene(p) ?? "") !== globVal[p]);
  const uloz = () => {
    const rows = [
      ...PROCESY.filter((p) => globVal[p] !== "").map((p) => ({ proces: p, vykon: globVal[p], datum: "" })),
      ...kpi.filter((k) => k.datum), // denné úpravy zachovaj
    ];
    save("kpi.csv", rows, COLS, "data: plošné výkony procesov", setKpi);
  };
  const ECOLS = ["email", "meno"];
  const KCOLS = ["proces", "vykon", "datum"];
  const [denDatum, setDenDatum] = useState(today());
  const [denne, setDenne] = useState(null);
  const denVal = denne ?? Object.fromEntries(PROCESY.map((p) => {
    const r = kpi.find((k) => k.proces === p && k.datum === denDatum);
    return [p, r ? String(r.vykon) : ""];
  }));
  const denneZoznam = kpi.filter((k) => k.datum && +k.vykon > 0).sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const ulozDen = () => {
    const rows = [
      ...kpi.filter((k) => !k.datum || k.datum !== denDatum),
      ...PROCESY.filter((p) => denVal[p] !== "").map((p) => ({ proces: p, vykon: denVal[p], datum: denDatum })),
    ];
    save("kpi.csv", rows, KCOLS, `data: výkon pre ${denDatum}`, setKpi);
    setDenne(null);
  };
  const PCOLS = ["kluc", "hodnota"];
  const [prahyEdit, setPrahyEdit] = useState(null);
  const pv = prahyEdit ?? { kvZelena: String(prahy.kvZelena), kvZlta: String(prahy.kvZlta), hodZelena: String(prahy.hodZelena), hodZlta: String(prahy.hodZlta), upozRel: String(prahy.upozRel), upozAbs: String(prahy.upozAbs) };
  const setPV = (k, v) => setPrahyEdit({ ...pv, [k]: v });
  const prahyZmenene = ["kvZelena", "kvZlta", "hodZelena", "hodZlta", "upozRel", "upozAbs"].some((k) => +pv[k] !== prahy[k]);
  const ulozPrahy = () => {
    const rows = [
      { kluc: "kvalita_zelena", hodnota: pv.kvZelena }, { kluc: "kvalita_zlta", hodnota: pv.kvZlta },
      { kluc: "hodiny_zelena", hodnota: pv.hodZelena }, { kluc: "hodiny_zlta", hodnota: pv.hodZlta },
      { kluc: "upoz_rel", hodnota: pv.upozRel }, { kluc: "upoz_abs", hodnota: pv.upozAbs },
    ];
    save("prahy.csv", rows, PCOLS, "data: prahy zobrazenia", setPrahy);
    setPrahyEdit(null);
  };
  const [novyMail, setNovyMail] = useState("");
  const [noveMeno, setNoveMeno] = useState("");
  const pridajMail = () => {
    const e = novyMail.trim().toLowerCase();
    if (!e.includes("@") || emaily.some((x) => x.email === e)) return;
    save("emaily.csv", [...emaily, { email: e, meno: noveMeno.trim() }], ECOLS, `data: príjemca ${e}`, setEmaily);
    setNovyMail(""); setNoveMeno("");
  };
  const zmazMail = (e) => save("emaily.csv", emaily.filter((x) => x.email !== e), ECOLS, `data: odstránený príjemca ${e}`, setEmaily);
  const odomknute = !chranene || Boolean(heslo);
  const [pokus, setPokus] = useState("");
  const [overujem, setOverujem] = useState(false);
  const odomkni = async () => {
    setOverujem(true);
    try {
      const r = await fetch("/api/heslo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heslo: pokus }),
      });
      if (r.ok) {
        setHeslo(pokus);
        try { sessionStorage.setItem("vykony-heslo", pokus); } catch {}
        setPokus("");
        show(t("Odomknuté – zmeny výkonov sú povolené."));
      } else show((await r.json()).error || "Nesprávne heslo.", true);
    } catch { show(t("Overenie zlyhalo."), true); }
    setOverujem(false);
  };
  const zamkni = () => {
    setHeslo(null);
    try { sessionStorage.removeItem("vykony-heslo"); } catch {}
    show(t("Zamknuté."));
  };
  const inp = { width: 110, background: "var(--field)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 9px", fontFamily: "var(--mono)" };

  // Admin je celý za heslom – obsah sa zobrazí až po odomknutí
  if (chranene && !odomknute) {
    return (
      <div className="card" style={{ maxWidth: 460, margin: "24px auto", borderColor: "var(--amber)", borderLeft: "3px solid var(--amber)" }}>
        <div className="lbl" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--amber)" }}>
          <Ico n="lock" /> {t("Chránená sekcia")}
        </div>
        <p className="note">{t("Nastavenia appky – výkony, prahy, príjemcovia reportu. Zadaj heslo, platí do zatvorenia karty prehliadača.")}</p>
        <div className="frm">
          <div className="fld"><label>{t("Heslo")}</label>
            <input type="password" value={pokus} autoComplete="off" autoFocus
              onChange={(e) => setPokus(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && pokus) odomkni(); }} /></div>
          <button className="btn" disabled={!pokus || overujem} onClick={odomkni}>
            <Ico n="lock" />{overujem ? t("Overujem…") : t("Odomknúť")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {chranene && (
        <div className="frm" style={{ marginBottom: 14, alignItems: "center" }}>
          <span className="pill green"><Ico n="lock" /> {t("odomknuté")}</span>
          <span className="note" style={{ margin: 0 }}>{t("Zmeny sú povolené v tejto relácii.")}</span>
          <button className="btn ghost" onClick={zamkni}><Ico n="lock" />{t("Zamknúť")}</button>
        </div>
      )}
      <p className="note">{t("Plošné výkony (JBL na osobu a hodinu) platia pre všetky dni – používa ich Predikcia, Perfo aj prepočet backlogu. Úpravu pre konkrétny deň zadáš nižšie a má pred plošnou prednosť.")}</p>
      <table className="t" style={{ maxWidth: 560 }}>
        <thead><tr><th>{t("Proces")}</th><th>{t("Aktuálne uložené")}</th><th>{t("Skutočnosť (60 dní)")}</th><th>{t("Nová hodnota")}</th></tr></thead>
        <tbody>
          {PROCESY.map((p) => (
            <tr key={p}>
              <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>{p}</td>
              <td className={ulozene(p) ? "accent" : ""} style={{ fontWeight: 650 }}>{ulozene(p) ?? <span className="pill red">{t("nenastavené")}</span>}</td>
              <td>{(() => {
                const s = skutocnyVykon(manhours, p);
                if (!s) return <span style={{ color: "var(--muted)" }}>–</span>;
                const norma = ulozene(p);
                const odch = norma ? (s.vykon / norma - 1) * 100 : null;
                return (
                  <>
                    <b>{nf.format(s.vykon)}</b>
                    {odch != null && <span className={Math.abs(odch) <= 10 ? "accent" : Math.abs(odch) <= 25 ? "warn" : "bad"} style={{ marginLeft: 6, fontSize: 12 }}>
                      {odch >= 0 ? "+" : ""}{nf.format(odch)} %
                    </span>}
                  </>
                );
              })()}</td>
              <td><input type="number" min="0" placeholder={odomknute ? t("zadaj") : t("zamknuté")} style={{ ...inp, opacity: odomknute ? 1 : 0.5 }}
                disabled={!odomknute} value={globVal[p]}
                onChange={(e) => setGlob({ ...globVal, [p]: e.target.value })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="frm" style={{ marginTop: 10 }}>
        <button className="btn" disabled={!zmenene || !odomknute} onClick={uloz}><Ico n="save" />{t("Uložiť plošné výkony")}</button>
        {zmenene && <span className="note" style={{ alignSelf: "center" }}>{t("neuložené zmeny")}</span>}
      </div>

      <div className="section">
        <h3>{t("Úprava výkonu pre konkrétny deň")}</h3>
        <p className="note">{t("Prepíše plošný výkon len pre vybraný deň (zaučanie, oslabená zmena). Používa ju Perfo aj Prehľad.")}</p>
        <div className="frm">
          <div className="fld"><label>{t("Deň")}</label>
            <input type="date" disabled={!odomknute} value={denDatum} onChange={(e) => { setDenDatum(e.target.value); setDenne(null); }} /></div>
          {PROCESY.map((p) => (
            <div className="fld" key={p}><label>{p}</label>
              <input type="number" min="0" placeholder="–" disabled={!odomknute} style={{ width: 92, borderColor: denVal[p] !== "" ? "var(--amber)" : "var(--border)" }}
                value={denVal[p]} onChange={(e) => setDenne({ ...denVal, [p]: e.target.value })} /></div>
          ))}
          <button className="btn" disabled={!odomknute} onClick={ulozDen}><Ico n="save" />{t("Uložiť úpravu dňa")}</button>
        </div>
        {denneZoznam.length > 0 && (
          <table className="t" style={{ maxWidth: 470, marginTop: 10 }}>
            <thead><tr><th>{t("Deň")}</th><th>{t("Proces")}</th><th>{t("Výkon")}</th></tr></thead>
            <tbody>{denneZoznam.map((k, i) => (
              <tr key={i}><td>{fmtD(k.datum)}{k.datum.slice(0, 4)}</td><td style={{ fontFamily: "var(--sans)" }}>{k.proces}</td>
                <td className="warn">{k.vykon}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="section">
        <h3>{t("Prahy zobrazenia")}</h3>
        <p className="note">{t("Určujú, kedy sa hodnota zobrazí zelenou, jantárovou alebo červenou – v Prehľade, Kvalite aj v dennom reporte.")}</p>
        <div className="grid g2">
          <div className="card">
            <div className="lbl">{t("Kvalita procesov")}</div>
            <div className="frm" style={{ marginTop: 8 }}>
              <div className="fld"><label>{t("Zelená od (%)")}</label>
                <input type="number" step="0.1" min="0" max="100" disabled={!odomknute} value={pv.kvZelena} onChange={(e) => setPV("kvZelena", e.target.value)} /></div>
              <div className="fld"><label>{t("Jantárová od (%)")}</label>
                <input type="number" step="0.1" min="0" max="100" disabled={!odomknute} value={pv.kvZlta} onChange={(e) => setPV("kvZlta", e.target.value)} /></div>
            </div>
            <p className="note" style={{ marginBottom: 0 }}>
              <span className="pill green">≥ {pv.kvZelena} %</span> <span className="pill amber">{pv.kvZlta}–{pv.kvZelena} %</span> <span className="pill red">&lt; {pv.kvZlta} %</span>
            </p>
          </div>
          <div className="card">
            <div className="lbl">{t("Spálené hodiny voči potrebným")}</div>
            <div className="frm" style={{ marginTop: 8 }}>
              <div className="fld"><label>{t("Zelená do (% normy)")}</label>
                <input type="number" step="1" min="0" disabled={!odomknute} value={pv.hodZelena} onChange={(e) => setPV("hodZelena", e.target.value)} /></div>
              <div className="fld"><label>{t("Jantárová do (% normy)")}</label>
                <input type="number" step="1" min="0" disabled={!odomknute} value={pv.hodZlta} onChange={(e) => setPV("hodZlta", e.target.value)} /></div>
            </div>
            <p className="note" style={{ marginBottom: 0 }}>
              <span className="pill green">≤ {pv.hodZelena} %</span> <span className="pill amber">{pv.hodZelena}–{pv.hodZlta} %</span> <span className="pill red">&gt; {pv.hodZlta} %</span>
            </p>
          </div>
        </div>
        <div className="card" style={{ marginTop: 10 }}>
          <div className="lbl">{t("Citlivosť upozornení")}</div>
          <p className="note" style={{ marginTop: 4 }}>{t("Upozornenie vznikne, keď kumulatívny výtlak triedenia zaostane za plánom o obe hodnoty naraz.")}</p>
          <div className="frm">
            <div className="fld"><label>{t("Minimálne zaostanie (%)")}</label>
              <input type="number" step="1" min="1" disabled={!odomknute} value={pv.upozRel} onChange={(e) => setPV("upozRel", e.target.value)} /></div>
            <div className="fld"><label>{t("Minimálne zaostanie (JBL)")}</label>
              <input type="number" step="100" min="0" disabled={!odomknute} value={pv.upozAbs} onChange={(e) => setPV("upozAbs", e.target.value)} /></div>
          </div>
        </div>
        <div className="frm" style={{ marginTop: 10 }}>
          <button className="btn" disabled={!odomknute || !prahyZmenene} onClick={ulozPrahy}><Ico n="save" />{t("Uložiť prahy")}</button>
          {prahyZmenene && <span className="note" style={{ alignSelf: "center" }}>{t("neuložené zmeny")}</span>}
        </div>
      </div>

      <div className="section">
        <h3>{t("Príjemcovia reportu")}</h3>
        <p className="note">{t("Na tieto adresy sa dá poslať Prehľad zo záložky Prehľad. Iné adresy systém odmietne.")}</p>
        {odomknute ? (
          <div className="frm" style={{ marginBottom: 10 }}>
            <div className="fld"><label>{t("E-mail")}</label>
              <input type="email" value={novyMail} placeholder="meno@alza.sk" onChange={(e) => setNovyMail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") pridajMail(); }} /></div>
            <div className="fld"><label>{t("Meno (voliteľné)")}</label>
              <input value={noveMeno} onChange={(e) => setNoveMeno(e.target.value)} /></div>
            <button className="btn" disabled={!novyMail.includes("@")} onClick={pridajMail}><Ico n="save" />{t("Pridať príjemcu")}</button>
          </div>
        ) : <p className="note" style={{ color: "var(--amber)" }}>{t("Zoznam sa dá meniť až po odomknutí.")}</p>}
        {emaily.length ? (
          <table className="t" style={{ maxWidth: 560 }}>
            <thead><tr><th>{t("E-mail")}</th><th>{t("Meno")}</th><th /></tr></thead>
            <tbody>{emaily.map((e) => (
              <tr key={e.email}><td>{e.email}</td><td style={{ fontFamily: "var(--sans)" }}>{e.meno}</td>
                <td>{odomknute && <button className="btn ghost" onClick={() => zmazMail(e.email)}><Ico n="trash" /></button>}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="note">{t("Zatiaľ žiadni príjemcovia.")}</p>}
      </div>
    </>
  );
}

// ------------------------------------------------------------ Distribúcia (DFS)
// Toky medzi pobočkami. IN = k nám (navyšuje objem príjmu), OUT = od nás
// (súčasť expedičnej práce – len rozpad, nič nenavyšuje).
function TabDfs({ dfsIn, dfsOut, uda, vynimky, udalosti, pobocka }) {
  const [smer, setSmer] = useState("in");
  const [obdobie, setObdobie] = useState(30);
  const [kluc, setKluc] = useState("protistrana");
  const rows = smer === "in" ? dfsIn : dfsOut;

  const daily = useMemo(() => dfsDenne(rows), [rows]);
  const model = useMemo(() => {
    if (daily.length < 20) return null;
    return fitModel(daily, vynimky.map((v) => v.datum), udalosti);
  }, [daily, vynimky, udalosti]);

  if (!rows.length) {
    return (
      <>
        <Prepinac smer={smer} setSmer={setSmer} />
        <p className="note">{t("Chýbajú dáta – nahraj export DFS FROM LC a DFS TO LC v záložke Dáta.")}</p>
      </>
    );
  }

  const doD = daily[daily.length - 1].datum;
  const od = addDays(doD, -(obdobie - 1));
  const vObd = daily.filter((r) => r.datum >= od);
  const spolu = vObd.reduce((a, r) => a + r.jbl, 0);
  const priemer = vObd.length ? spolu / vObd.length : 0;
  const rozpad = dfsRozpad(rows, od, doD, kluc);
  const zajtra = model ? predictDay(addDays(doD, 1), model, uda) : null;
  const posledny = daily[daily.length - 1].jbl;

  return (
    <>
      <Prepinac smer={smer} setSmer={setSmer} />
      <p className="note">
        {smer === "in"
          ? t("Distribúcia k nám – tovar prichádzajúci z iných pobočiek. Objem sa pripočítava k predikcii príjmu ako druhý zdroj. Tu ide o rozpad, predikciu expedície nenavyšuje.")
          : t("Distribúcia od nás – tovar odosielaný na iné pobočky. Je už súčasťou expedičnej práce, takže nič nenavyšuje – ide len o rozpad, kam objem smeruje.")}
      </p>

      <div className="frm" style={{ marginBottom: 12 }}>
        <div className="seg">
          {[[7, "7"], [30, "30"], [90, "90"]].map(([nn, l]) =>
            <button key={nn} className={obdobie === nn ? "on" : ""} onClick={() => setObdobie(nn)}>{l} {t("dní")}</button>)}
        </div>
        <span className="note" style={{ alignSelf: "center", margin: 0 }}>
          {fmtD(od)}{od.slice(0, 4)} – {fmtD(doD)}{doD.slice(0, 4)} · {pobocka}
        </span>
      </div>

      <div className="grid g4">
        <Card lbl={t("Objem za obdobie")} val={nf.format(spolu)} cls="accent" sub={`${nf.format(priemer)} ${t("JBL/deň priemer")}`} />
        <Card lbl={t("Posledný deň")} val={nf.format(posledny)} sub={`${fmtD(doD)}${doD.slice(0, 4)}`} />
        <Card lbl={t("Predikcia na zajtra")} val={zajtra != null ? nf.format(zajtra) : "–"}
          cls="blue" sub={model ? `${t("model z")} ${daily.length} ${t("dní")}` : t("málo dát na model")} />
        <Card lbl={smer === "in" ? t("Vplyv na príjem") : t("Vplyv na expedíciu")}
          val={smer === "in" ? "+" + nf.format(priemer) : "0"}
          sub={smer === "in" ? t("pripočíta sa k predikcii príjmu") : t("už je v objeme expedície")} />
      </div>

      <div className="section">
        <h3>{t("Vývoj v čase")}</h3>
        <div className="chartbox">
          <Bars color={smer === "in" ? "var(--blue)" : "var(--green)"} height={200}
            data={vObd.map((r) => ({ x: `${fmtD(r.datum)}`, y: r.jbl }))} />
        </div>
      </div>

      <div className="section">
        <div className="frm" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{t("Rozpad objemu")}</h3>
          <div className="seg">
            <button className={kluc === "protistrana" ? "on" : ""} onClick={() => setKluc("protistrana")}>
              {smer === "in" ? t("Odkiaľ") : t("Kam")}
            </button>
            <button className={kluc === "geosize" ? "on" : ""} onClick={() => setKluc("geosize")}>{t("Veľkosť (geosize)")}</button>
          </div>
        </div>
        <table className="t">
          <thead><tr>
            <th>{kluc === "geosize" ? t("Veľkosť") : (smer === "in" ? t("Zdrojová pobočka") : t("Cieľová pobočka"))}</th>
            <th style={{ textAlign: "right" }}>{t("Objem")}</th>
            <th style={{ textAlign: "right" }}>{t("Podiel")}</th>
            <th style={{ textAlign: "right" }}>{t("Priemer na deň")}</th>
          </tr></thead>
          <tbody>{rozpad.slice(0, 20).map((r) => (
            <tr key={r.nazov}>
              <td style={{ fontFamily: "var(--sans)" }}>{r.nazov}</td>
              <td style={{ textAlign: "right" }}>{nf.format(r.jbl)}</td>
              <td style={{ textAlign: "right" }} className={r.podiel >= 20 ? "accent" : ""}>{nf1.format(r.podiel)} %</td>
              <td style={{ textAlign: "right" }}>{nf.format(r.jbl / (vObd.length || 1))}</td>
            </tr>
          ))}</tbody>
        </table>
        {rozpad.length > 20 && <p className="note">{t("Zobrazených 20 najväčších z")} {rozpad.length}.</p>}
      </div>
    </>
  );
}

function Prepinac({ smer, setSmer }) {
  return (
    <div className="seg" style={{ marginBottom: 12 }}>
      <button className={smer === "in" ? "on" : ""} onClick={() => setSmer("in")}>{t("In – k nám")}</button>
      <button className={smer === "out" ? "on" : ""} onClick={() => setSmer("out")}>{t("Out – od nás")}</button>
    </div>
  );
}

// ------------------------------------------------------------ Upozornenia
// Deficit hodinového výtlaku triedenia. Žlté = riziko kvality (dobehne sa),
// červené = objem sa nestihne a presúva sa na ďalší deň (návrh na potvrdenie).
function TabUpoz({ upozornenia, upoz, setUpoz, backlogy, setBacklogy, save, kpi, pomery }) {
  const UCOLS = ["id", "z_datum", "hodiny", "objem", "na_datum", "stav", "poznamka"];
  const BCOLS = ["z_datum", "na_datum", "objem", "zdroj", "poznamka"];
  const [filter, setFilter] = useState("navrh");

  const vykonPre = (p) => {
    const g = (kpi || []).find((k) => k.proces === p && !k.datum);
    return g && +g.vykon > 0 ? +g.vykon : 0;
  };
  const coef = ["Pick", "Pack", "Sort"].reduce((a, p) => a + (vykonPre(p) > 0 ? (pomery?.[p] ?? 1) / vykonPre(p) : 0), 0);

  const zapis = (u, stav, poznamka = "") => {
    const rows = [...upoz.filter((x) => x.id !== u.id),
      { id: u.id, z_datum: u.datum, hodiny: u.hodiny.join(","), objem: u.objem, na_datum: u.na_datum, stav, poznamka }];
    save("upozornenia.csv", rows, UCOLS, `data: upozornenie ${u.id} – ${stav}`, setUpoz);
    if (stav === "potvrdene") {
      const rest = backlogy.filter((b) => !(b.z_datum === u.datum && b.poznamka === "nestihnuté triedenie"));
      save("backlog.csv", [...rest, { z_datum: u.datum, na_datum: u.na_datum, objem: u.objem, zdroj: "triedenie", poznamka: "nestihnuté triedenie" }],
        BCOLS, `data: backlog z upozornenia ${u.id}`, setBacklogy);
    } else {
      const rest = backlogy.filter((b) => !(b.z_datum === u.datum && b.poznamka === "nestihnuté triedenie"));
      if (rest.length !== backlogy.length) save("backlog.csv", rest, BCOLS, `data: zrušený backlog ${u.id}`, setBacklogy);
    }
  };

  const zobraz = upozornenia.filter((u) => (filter === "vsetky" ? true : u.stav === filter));
  const pocty = {
    navrh: upozornenia.filter((u) => u.stav === "navrh").length,
    potvrdene: upozornenia.filter((u) => u.stav === "potvrdene").length,
    zamietnute: upozornenia.filter((u) => u.stav === "zamietnute").length,
  };

  return (
    <>
      <p className="note">
        {t("Appka porovnáva skutočný hodinový výtlak triedenia s očakávaním. Žlté upozornenie znamená riziko nekvality – objem sa dá dobehnúť do konca dňa. Červené znamená, že sa nestihne a presunie sa na ďalší deň; po potvrdení sa pripočíta k záťaži a hodinám cieľového dňa.")}
      </p>

      <div className="frm" style={{ marginBottom: 12 }}>
        <div className="seg">
          {[["navrh", `${t("Nové")} (${pocty.navrh})`], ["potvrdene", `${t("Potvrdené")} (${pocty.potvrdene})`],
            ["zamietnute", `${t("Zamietnuté")} (${pocty.zamietnute})`], ["vsetky", t("Všetky")]].map(([k, l]) =>
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>

      {!zobraz.length ? (
        <p className="note">{filter === "navrh" ? t("Žiadne nové upozornenia – triedenie beží v očakávaných hodnotách.") : t("Nič v tomto stave.")}</p>
      ) : zobraz.map((u) => (
        <div key={u.id} className="card" style={{ marginBottom: 10, borderLeft: `3px solid var(--${u.uroven === "cervena" ? "red" : "amber"})` }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div className="lbl">
                {u.uroven === "cervena"
                  ? <span className="pill red">{t("presun objemu")}</span>
                  : <span className="pill amber">{t("riziko kvality")}</span>}
                {u.stav !== "navrh" && <span className={`pill ${u.stav === "potvrdene" ? "green" : "gray"}`} style={{ marginLeft: 6 }}>
                  {u.stav === "potvrdene" ? t("potvrdené") : t("zamietnuté")}</span>}
              </div>
              <div className="val" style={{ fontSize: 21 }}>{nf.format(u.objem)} <span style={{ fontSize: 13, color: "var(--muted)" }}>JBL</span></div>
              <div className="sub">
                {fmtD(u.datum)}{u.datum.slice(0, 4)} · {t("plán")} {nf.format(u.plan)} · {t("skutočnosť")} {nf.format(u.skutocnost)} ({nf1.format(u.podiel)} % {t("pod plánom")})
                {u.uroven === "cervena"
                  ? ` · ${t("presúva sa na")} ${fmtD(u.na_datum)}${u.na_datum.slice(0, 4)}`
                  : ` · ${t("voľná kapacita do konca dňa")} ${nf.format(u.rezerva)}`}
                {coef > 0 && ` · ≈ ${nf1.format(u.objem * coef)} ${t("človekohodín")}`}
              </div>
            </div>
            {u.uroven === "cervena" && (
              <div className="frm" style={{ alignItems: "center" }}>
                {u.stav !== "potvrdene" && <button className="btn" onClick={() => zapis(u, "potvrdene")}><Ico n="save" />{t("Potvrdiť")}</button>}
                {u.stav !== "zamietnute" && <button className="btn ghost" style={{ color: "var(--text)" }} onClick={() => zapis(u, "zamietnute")}>{t("Zamietnuť")}</button>}
                {u.stav !== "navrh" && <button className="btn ghost" style={{ color: "var(--muted)" }} onClick={() => zapis(u, "navrh")}>{t("Vrátiť")}</button>}
              </div>
            )}
          </div>
        </div>
      ))}

      <p className="note" style={{ marginTop: 14 }}>
        {t("Upozornenia sa odvodzujú zo súčasných dát – ak ranný import prepíše ručne zadané hodiny, neplatné upozornenia zmiznú samy. Potvrdené zostávajú, kým ich nezrušíš.")}
      </p>
    </>
  );
}

// ------------------------------------------------------------ Zmeny
// Rozpad kvality procesov podľa zmeny (A–D) a operation managera.
// Denná zmena = prevádzkové hodiny 06:00–17:59, nočná 18:00–05:59.


function TabZmeny({ staticData, zmeny, setZmeny, manazeri, save, prahy, pobocka }) {
  const kvH = staticData.kvalitaHodinove || [];
  const ZCOLS = ["datum", "denna", "nocna"];
  const ZMENY = useMemo(() => [...new Set(zmeny.flatMap((z) => [z.denna, z.nocna]).filter(Boolean))].sort(), [zmeny]);
  const [genOd, setGenOd] = useState(addDays(today(), -90));
  const [genDo, setGenDo] = useState(addDays(today(), 30));
  const [startDenna, setStartDenna] = useState("A");
  const [startNocna, setStartNocna] = useState("B");
  const [cyklus, setCyklus] = useState(2);
  const [obdobie, setObdobie] = useState(90);

  const menoPre = (z) => manazeri.find((m) => m.zmena === z)?.manazer || z;
  const mapa = useMemo(() => new Map(zmeny.map((z) => [z.datum, z])), [zmeny]);


  // agregácia kvality podľa zmeny
  const doD = kvH.length ? kvH[kvH.length - 1].datum : null;
  const odD = doD ? addDays(doD, -(obdobie - 1)) : null;
  const jeDenna = (h) => h >= 6 && h < 18;

  const { poManazerovi, procesy, bezKalendara } = useMemo(() => {
    const acc = new Map(); // `${zmena}|${proces}` -> {c,z,dni:Set}
    const procS = new Set();
    let bez = 0;
    for (const r of kvH) {
      if (!odD || r.datum < odD || r.datum > doD) continue;
      const kal = mapa.get(r.datum);
      if (!kal) { bez++; continue; }
      const z = jeDenna(+r.hodina) ? kal.denna : kal.nocna;
      if (!z) continue;
      procS.add(r.proces);
      const k = `${z}|${r.proces}`;
      const o = acc.get(k) || { c: 0, z: 0, dni: new Set() };
      o.c += +r.celkem || 0; o.z += +r.pozde || 0; o.dni.add(r.datum);
      acc.set(k, o);
    }
    const out = new Map();
    for (const [k, o] of acc) {
      const [zm, proc] = k.split("|");
      if (!out.has(zm)) out.set(zm, new Map());
      out.get(zm).set(proc, { kv: o.c > 0 ? (1 - o.z / o.c) * 100 : null, objem: o.c, pozde: o.z, dni: o.dni.size });
    }
    return { poManazerovi: out, procesy: [...procS].sort(), bezKalendara: bez };
  }, [kvH, mapa, odD, doD, obdobie]);

  const qCls = (v) => (v == null ? "" : v >= prahy.kvZelena ? "accent" : v >= prahy.kvZlta ? "warn" : "bad");
  const celkomPre = (zm) => {
    const m = poManazerovi.get(zm);
    if (!m) return null;
    let c = 0, z = 0;
    for (const v of m.values()) { c += v.objem; z += v.pozde; }
    return c > 0 ? (1 - z / c) * 100 : null;
  };
  const priemerProcesu = (proc) => {
    let c = 0, z = 0;
    for (const m of poManazerovi.values()) { const v = m.get(proc); if (v) { c += v.objem; z += v.pozde; } }
    return c > 0 ? (1 - z / c) * 100 : null;
  };

  if (!kvH.length) return (
    <p className="note" style={{ color: "var(--amber)" }}>
      {t("Chýba hodinová kvalita pre pobočku")} <b>{pobocka}</b> ({t("súbor")} <code>public/data/{pobocka}/kvalita_hodinove.csv</code>).
      {" "}{t("Nahraj QUALITY export v záložke Dáta a potvrď uloženie.")}
    </p>
  );

  return (
    <>
      <p className="note">
        {t("Kvalita procesov podľa zmeny a operation managera. Denná zmena = prevádzkové hodiny 06:00–17:59, nočná 18:00–05:59.")}
        <br />{t("ČS = čas zvozu · LT = limit triedenia · DLT = limit odoslania")}
      </p>

      <div className="frm" style={{ marginBottom: 12 }}>
        <div className="seg">
          {[[30, "30"], [90, "90"], [365, "365"]].map(([nn, l]) =>
            <button key={nn} className={obdobie === nn ? "on" : ""} onClick={() => setObdobie(nn)}>{l} {t("dní")}</button>)}
        </div>
        {odD && <span className="note" style={{ alignSelf: "center", margin: 0 }}>{fmtD(odD)}{odD.slice(0, 4)} – {fmtD(doD)}{doD.slice(0, 4)}</span>}
      </div>

      {zmeny.length === 0 ? (
        <p className="note" style={{ color: "var(--amber)" }}>
          {t("Kalendár zmien nie je nahratý – nahraj rozpis v záložke Dáta, inak sa kvalita nedá priradiť k manažérom.")}
        </p>
      ) : poManazerovi.size === 0 ? (
        <p className="note" style={{ color: "var(--amber)" }}>
          {t("Kalendár a dáta kvality sa neprekrývajú – kalendár pokrýva iné obdobie než dostupné dáta. Nahraj rozpis za obdobie, ktoré zodpovedá dátam kvality.")}
        </p>
      ) : (
        <>
          <div className="grid g4">
            {ZMENY.filter((z) => celkomPre(z) != null).map((z) => {
              const v = celkomPre(z);
              return <Card key={z} lbl={`${t("Zmena")} ${z} · ${menoPre(z)}`} val={v != null ? v.toFixed(1) + " %" : "–"} cls={qCls(v)}
                sub={poManazerovi.get(z) ? `${[...poManazerovi.get(z).values()][0]?.dni ?? 0} ${t("dní v období")}` : t("bez dát")} />;
            })}
          </div>

          <div className="section">
            <h3>{t("Kvalita procesov podľa manažéra")}</h3>
            <table className="t">
              <thead><tr><th>{t("Proces")}</th>
                {ZMENY.filter((z) => celkomPre(z) != null).map((z) => <th key={z} style={{ textAlign: "right" }}>{z} · {menoPre(z).split(" ")[0]}</th>)}
                <th style={{ textAlign: "right" }}>{t("Priemer")}</th><th style={{ textAlign: "right" }}>{t("Rozptyl")}</th></tr></thead>
              <tbody>{procesy.map((p) => {
                const hodnoty = ZMENY.filter((z) => celkomPre(z) != null).map((z) => poManazerovi.get(z)?.get(p)?.kv ?? null);
                const platne = hodnoty.filter((x) => x != null);
                const rozptyl = platne.length > 1 ? Math.max(...platne) - Math.min(...platne) : null;
                return (
                  <tr key={p}>
                    <td style={{ fontFamily: "var(--sans)" }}>{p}</td>
                    {hodnoty.map((v, i) => <td key={i} className={qCls(v)} style={{ textAlign: "right" }}>{v != null ? v.toFixed(1) + " %" : "–"}</td>)}
                    <td style={{ textAlign: "right" }}>{priemerProcesu(p)?.toFixed(1) ?? "–"} %</td>
                    <td className={rozptyl == null ? "" : rozptyl >= 3 ? "bad" : rozptyl >= 1.5 ? "warn" : ""} style={{ textAlign: "right" }}>
                      {rozptyl != null ? rozptyl.toFixed(1) + " b." : "–"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            <p className="note">{t("Rozptyl = rozdiel medzi najlepšou a najhoršou zmenou. Vysoký rozptyl znamená, že proces závisí od toho, kto slúži – tam sa oplatí hľadať príčinu.")}</p>
          </div>
          {bezKalendara > 0 && <p className="note" style={{ color: "var(--amber)" }}>
            {t("Riadkov bez priradenej zmeny")}: {nf.format(bezKalendara)} – {t("doplň chýbajúce dni v kalendári.")}</p>}
        </>
      )}

      <div className="section">
        <h3>{t("Kalendár zmien")}</h3>
        {zmeny.length === 0
          ? <p className="note">{t("Kalendár nie je nahratý – nahraj Excel s rozpisom zmien v záložke Dáta.")}</p>
          : <>
              <p className="note">{t("Nahratých")} {zmeny.length} {t("dní")} ({fmtD(zmeny[0].datum)}{zmeny[0].datum.slice(0,4)} – {fmtD(zmeny[zmeny.length-1].datum)}{zmeny[zmeny.length-1].datum.slice(0,4)}). {t("Nový rozpis nahráš v záložke Dáta.")}</p>
              <table className="t" style={{ maxWidth: 460 }}>
                <thead><tr><th>{t("Deň")}</th><th>{t("Denná")}</th><th>{t("Nočná")}</th></tr></thead>
                <tbody>{[...zmeny].sort((a, b) => (a.datum < b.datum ? 1 : -1)).slice(0, 14).map((z) => (
                  <tr key={z.datum}><td>{fmtD(z.datum)}{z.datum.slice(0, 4)} {DNI[dow(z.datum)]}</td>
                    <td>{z.denna} · {menoPre(z.denna)}</td><td>{z.nocna} · {menoPre(z.nocna)}</td></tr>
                ))}</tbody>
              </table>
            </>}
      </div>
    </>
  );
}

const POVOLENE_POBOCKY = ["SKLC3", "CZLC4", "LCU"];

function TabImport({ saveRaw, saveRawDo, nacitajRaw, pobocka, show, ghOk }) {
  const [vysledky, setVysledky] = useState([]);
  const [zmazat, setZmazat] = useState(false);
  const [prepisat, setPrepisat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ukladam, setUkladam] = useState(false);

  const spracuj = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    const nove = [];
    try {
      const XLSX = await import("xlsx");
      const { detekuj, prevod, POPIS_TYPU } = await import("../lib/importuj");
      for (const f of files) {
        try {
          const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
          // zošit môže obsahovať viac hárkov (napr. VOLUMES a QUALITY vedľa seba)
          const subory = {}; const typy = []; const suhrny = [];
          for (const meno of wb.SheetNames) {
            const ws = wb.Sheets[meno];
            let typ = null;
            try { typ = detekuj(ws, XLSX); } catch {}
            if (!typ) continue;
            const v = prevod(typ, ws, XLSX, POVOLENE_POBOCKY);
            Object.assign(subory, v.subory);
            typy.push(typ); suhrny.push(wb.SheetNames.length > 1 ? `${meno}: ${v.suhrn}` : v.suhrn);
          }
          if (!typy.length) throw new Error("Formát sa nepodarilo rozpoznať – čakám OLAP, VOLUMES, QUALITY, kalendár zmien, ManHours alebo avíza.");
          const typ = [...new Set(typy)].join(" + ");
          nove.push({ nazov: f.name, typ, popisTypu: typy.map((x) => POPIS_TYPU[x]).filter(Boolean).join(" · "), suhrn: suhrny.join(" | "), subory });
        } catch (e) {
          nove.push({ nazov: f.name, chyba: String(e.message || e) });
        }
      }
    } catch (e) {
      nove.push({ nazov: "—", chyba: "Načítanie knižnice zlyhalo: " + String(e.message || e) });
    }
    setVysledky((v) => [...v.filter((x) => !nove.some((n) => n.nazov === x.nazov)), ...nove]);
    setBusy(false);
  };

  const ok = vysledky.filter((v) => v.subory);
  const spolu = ok.reduce((a, v) => a + Object.keys(v.subory).length, 0);

  const ulozVsetko = async () => {
    setUkladam(true);
    try {
      if (zmazat) {
        // vyprázdni ručne zadané dáta, nastavenia (výkony, prahy, príjemcovia, zmeny) zostávajú
        await saveRaw("zaznamy.csv", "datum,hodina,joblines,poznamka,zdroj,anomalia\n", "data: vyčistenie záznamov pred importom");
        await saveRaw("vynimky.csv", "datum,typ,popis,hodiny\n", "data: vyčistenie výnimiek pred importom");
        await saveRaw("backlog.csv", "z_datum,na_datum,objem,zdroj,poznamka\n", "data: vyčistenie backlogu pred importom");
      }
      for (const v of ok) {
        for (const [nazov, obsah] of Object.entries(v.subory)) {
          // kľúč "POBOCKA::subor.csv" zapíše do inej pobočky (avíza a DFS sú spoločné exporty)
          const [pob, file] = nazov.includes("::") ? nazov.split("::") : [pobocka, nazov];
          // predvolene sa dáta zlučujú: nové dni prepíšu staré, zvyšok histórie zostáva
          let vysledny = obsah;
          if (!prepisat && file.endsWith(".csv")) {
            const stary = await nacitajRaw(pob, file);
            vysledny = zlucPodlaDna(stary, obsah);
          }
          const sprava = `data: import ${v.typ} (${v.nazov})${prepisat ? " – prepis" : ""}`;
          if (nazov.includes("::")) await saveRawDo(pob, file, vysledny, sprava);
          else await saveRaw(file, vysledny, sprava);
        }
      }
      show(`Uložených ${spolu} súborov – načítavam nové dáta…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      show(String(e.message || e), true);
      setUkladam(false);
    }
  };

  return (
    <>
      <p className="note">{t("Nahraj Excel exporty a appka si z nich sama pripraví dátové súbory. Typ rozpozná podľa obsahu, nie podľa názvu – môžeš ich vybrať aj všetky naraz. Zošit s viacerými hárkami spracuje celý.")}</p>
      <p className="note" style={{ color: "var(--green2)" }}>
        {t("Na názve súboru nezáleží – appka rozpoznáva typ podľa obsahu (stĺpcov a filtrov v hlavičke). Súbor si teda môžeš pomenovať ľubovoľne.")}
      </p>
      <table className="t" style={{ marginBottom: 8 }}>
        <thead><tr><th>{t("Export")}</th><th>{t("Odkiaľ")}</th><th>{t("Čo z neho vznikne")}</th></tr></thead>
        <tbody>
          {[
            ["QUALITY", "BRFIL161699", t("kvalita denne a po hodinách"), t("exportovať samostatne")],
            ["VOLUMES", "BRFIL161699", t("príjem, triedenie, pomery procesov"), t("exportovať samostatne")],
            ["ManHours", "Power BI · LOGPerformance", t("odpracované hodiny a výkon po procesoch"), t("filter Branch = pobočka, Směr aj SJL Process bez obmedzenia")],
            ["GateBooking", "Power BI · GateBooking", t("avíza dodávok – rozdelia sa podľa pobočiek"), t("obsahuje všetky pobočky naraz")],
            ["DFR / DFS", "Power BI · DistributionStoreJobLines", t("distribúcia medzi pobočkami"), t("musí obsahovať týždeň a deň, inak sa nedá predikovať")],
            ["OLAP_PREDICTION", t("kontingenčná tabuľka"), t("vzniky, matica zvozov"), t("filter na pobočku – nahrávaj pri zvolenej rovnakej pobočke")],
            [t("Kalendár zmien"), t("Excel rozpis"), t("rozpis operation managerov"), ""],
          ].map(([nazov, odkial, vysledok, pozn]) => (
            <tr key={nazov}>
              <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>{nazov}</td>
              <td style={{ fontFamily: "var(--sans)", color: "var(--muted)" }}>{odkial}</td>
              <td style={{ fontFamily: "var(--sans)" }}>{vysledok}
                {pozn ? <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 2 }}>{pozn}</div> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note" style={{ marginBottom: 14 }}>
        {t("Power BI: Explore → export do Excelu. Pred exportom skontroluj rozsah dátumu – appka spracuje len to, čo je v súbore.")}
      </p>

      <div style={{ border: "1px dashed var(--border2)", borderRadius: "var(--r)", padding: "22px 18px", textAlign: "center", background: "var(--card)" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); spracuj([...e.dataTransfer.files]); }}>
        <input id="xlsin" type="file" accept=".xlsx,.xls" multiple style={{ display: "none" }}
          onChange={(e) => spracuj([...e.target.files])} />
        <label htmlFor="xlsin" className="btn" style={{ cursor: "pointer" }}>
          <Ico n="import" />{busy ? t("Spracúvam…") : t("Vybrať Excel súbory")}
        </label>
        <p className="note" style={{ margin: "10px 0 0" }}>{t("alebo súbory sem pretiahni · spracovanie beží v prehliadači, nič sa nikam neposiela")}</p>
      </div>

      {vysledky.length > 0 && (
        <div className="section">
          <h3>{t("Rozpoznané súbory")}</h3>
          <table className="t">
            <thead><tr><th>{t("Súbor")}</th><th>{t("Typ")}</th><th>{t("Obsah")}</th><th>{t("Pripravené dáta")}</th></tr></thead>
            <tbody>{vysledky.map((v) => (
              <tr key={v.nazov}>
                <td style={{ fontFamily: "var(--sans)" }}>{v.nazov}</td>
                <td>{v.chyba ? <span className="pill red">{t("chyba")}</span> : <span className="pill green">{v.typ}</span>}</td>
                <td style={{ fontFamily: "var(--sans)" }} className={v.chyba ? "bad" : ""}>{v.chyba || v.suhrn}</td>
                <td style={{ fontFamily: "var(--sans)" }}>{v.subory ? Object.keys(v.subory).map((n) => {
                  const [pob, file] = n.includes("::") ? n.split("::") : [null, n];
                  return (
                    <div key={n}>
                      {pob && <span className="pill green" style={{ marginRight: 5 }}>{pob}</span>}
                      {file}
                    </div>
                  );
                }) : "–"}</td>
              </tr>
            ))}</tbody>
          </table>

          {ok.length > 0 && (
            <>
              <p className="note" style={{ marginTop: 12, marginBottom: 4 }}>
                {t("Dáta sa zlučujú s doterajšími: dni, ktoré sú v novom exporte, sa prepíšu, staršia história zostáva. Nemusíš teda exportovať celé obdobie.")}
              </p>
              <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 13, color: prepisat ? "var(--amber)" : "var(--muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={prepisat} onChange={(e) => setPrepisat(e.target.checked)} />
                {t("Nahradiť celé súbory namiesto zlúčenia (zahodí staršiu históriu)")}
              </label>
              <label style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 6, fontSize: 13, color: zmazat ? "var(--amber)" : "var(--muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={zmazat} onChange={(e) => setZmazat(e.target.checked)} />
                {t("Pred nahratím zmazať ručne zadané dáta (záznamy, výnimky, backlog)")}
              </label>
              {zmazat && <p className="note" style={{ color: "var(--amber)" }}>
                {t("Nastavenia (výkony, prahy, príjemcovia, kalendár zmien, udalosti) zostanú zachované. Zmazané dáta sa nedajú vrátiť.")}
              </p>}
              <div className="frm" style={{ marginTop: 12 }}>
                <button className="btn" disabled={ukladam || ghOk === false} onClick={ulozVsetko}>
                  <Ico n="save" />{ukladam ? "Ukladám…" : `Uložiť ${spolu} súborov a načítať`}
                </button>
                <button className="btn ghost" disabled={ukladam} onClick={() => setVysledky([])}>
                  <Ico n="trash" />{t("Zahodiť")}</button>
              </div>
              <p className="note">
                {ghOk === false
                  ? t("GitHub zápis nie je nakonfigurovaný (env GH_TOKEN / GH_REPO) – bez neho sa dáta uložiť nedajú.")
                  : t("Uloží dátové súbory do repozitára a hneď ich načíta. Redeploy netreba – appka číta tieto súbory priamo z GitHubu.")}
              </p>
            </>
          )}
        </div>
      )}

      <div className="section">
        <h3>{t("Ako často importovať")}</h3>
        <p className="note">{t("Model kotví predikciu na posledné dni skutočnosti, takže čerstvý OLAP export raz týždenne drží presnosť na úrovni „deň vopred“. VOLUMES a QUALITY stačí podľa potreby – ovplyvňujú triedenie, príjem a kvalitu. Medzi importmi vieš jednotlivé dni dopĺňať ručne v Zadávaní dát.")}</p>
      </div>
    </>
  );
}

// ------------------------------------------------------------ 🧠 Model
function TabModel({ sources, vynD, uda }) {
  const [msrc, setMsrc] = useState("vzniky");
  const D = sources[msrc];
  const { model, prof } = D;
  const [bt, setBt] = useState(null);
  const [btBusy, setBtBusy] = useState(false);
  useEffect(() => { setBt(null); }, [msrc]);
  const runBt = () => {
    setBtBusy(true);
    // výpočet mimo klik-handlera, nech UI stihne prekresliť
    setTimeout(() => {
      setBt(backtest(D.daily, vynD, uda, 30));
      setBtBusy(false);
    }, 30);
  };
  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }}>
        {[["vzniky", "Vzniky"], ["triedenie", "Triedenie"], ["prijem", "Príjem"], ["distribucia", "Distribúcia"]].map(([k, l]) =>
          <button key={k} className={msrc === k ? "on" : ""} onClick={() => setMsrc(k)}><Ico n={k} />{t(l)}</button>)}
      </div>
      <p className="note">{t("Predikcia")} = <b>{t("úroveň s trendom")}</b> × <b>{t("faktor dňa v týždni")}</b> × <b>{t("faktor dňa v mesiaci")}</b> × <b>{t("koeficient udalostí")}</b>.
        Dni s výnimkou sú z tréningu vylúčené, historické udalosti odfiltrované.</p>
      <div className="grid g2">
        <div className="chartbox">
          <h3 style={{ margin: "2px 0 6px", fontSize: 14 }}>{t("Faktor dňa v týždni (8 týždňov)")}</h3>
          <Bars height={190} data={model.dowF.map((v, i) => ({ x: DNI[i], y: v }))} />
        </div>
        <div className="chartbox">
          <h3 style={{ margin: "2px 0 6px", fontSize: 14 }}>{t("Faktor dňa v mesiaci (výplatné výkyvy)")}</h3>
          <Lines height={190} xLabels={Array.from({ length: 31 }, (_, i) => String(i + 1))} series={[
            { color: "var(--green)", points: Array.from({ length: 31 }, (_, i) => model.domF[i + 1]) },
          ]} />
        </div>
      </div>
      <div className="section chartbox">
        <h3 style={{ margin: "2px 0 6px", fontSize: 14 }}>{t("Hodinový profil (podiel dňa, 6 týždňov)")}</h3>
        <div className="legend"><span><i style={{ background: "var(--green)" }} />{t("pracovný deň")}</span><span><i style={{ background: "var(--muted)" }} />{t("víkend")}</span></div>
        <Lines height={200} xLabels={OP_HOURS.map((h) => String(h).padStart(2, "0"))} series={[
          { color: "var(--green)", points: OP_HOURS.map((h) => prof["false"][h] * 100) },
          { color: "var(--muted)", points: OP_HOURS.map((h) => prof["true"][h] * 100) },
        ]} />
      </div>
      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Card lbl={t("Denná úroveň modelu")} val={nf.format(model.levelNow)}
          sub={`${t("trend")} ${model.slope >= 0 ? "+" : ""}${nf.format(model.slope)}${t("/deň, tlmený")}`} />
        <Card lbl={t("Krátkodobá korekcia")} val={"×" + (model.corr ?? 1).toFixed(2)}
          sub={t("kotva na skutočnosť posledných dní")} />
        <Card lbl={t("Variabilita rezíduí")} val={(model.residStd * 100).toFixed(1) + " %"} sub={t("šírka intervalu predikcie")} />
        <Card lbl={t("Tréningové dni")} val={model.trainDays} sub={`${t("posledné dáta")} ${fmtD(model.lastDate)}${model.lastDate.slice(0, 4)}`} />
      </div>

      <div className="section">
        <h3>{t("Backtest · presnosť predikcie „deň vopred“ (posledných 30 dní)")}</h3>
        <p className="note">{t("Pre každý deň sa model natrénuje len na dátach do predchádzajúceho dňa a predikcia sa porovná so skutočnosťou – presne ako v reálnom použití. Dni s výnimkou sa preskakujú.")}</p>
        {!bt && <button className="btn" disabled={btBusy} onClick={runBt}>{btBusy ? t("Počítam…") : <><Ico n="play" />{t("Spustiť backtest")}</>}</button>}
        {bt && (
          <>
            <div className="grid g4">
              <Card lbl={t("MAPE (priem. % chyba)")} val={(bt.mape * 100).toFixed(1) + " %"} cls={bt.mape <= 0.08 ? "accent" : bt.mape <= 0.12 ? "warn" : "bad"} sub={`${bt.n} ${t("testovaných dní")}`} />
              <Card lbl={t("MAE (priem. abs. chyba)")} val={nf.format(bt.mae)} sub={t("jobline na deň")} />
              <Card lbl={t("Dní s chybou do ±5 000")} val={`${bt.do5k}/${bt.n}`} />
              <Card lbl={t("Bias (systematický posun)")} val={(bt.bias >= 0 ? "+" : "") + nf.format(bt.bias)} cls={Math.abs(bt.bias) <= 2000 ? "" : "warn"} sub={bt.bias > 2000 ? t("model podstreľuje – over promo/udalosti") : bt.bias < -2000 ? t("model prestreľuje – over výnimky") : t("v norme")} />
            </div>
            <div className="chartbox" style={{ marginTop: 10 }}>
              <div className="legend"><span><i style={{ background: "var(--green)" }} />{t("skutočnosť")}</span><span><i style={{ background: "var(--muted)" }} />{t("predikcia deň vopred")}</span></div>
              <Lines height={230} xLabels={bt.dni.map((r) => fmtD(r.datum))} series={[
                { color: "var(--green)", points: bt.dni.map((r) => r.skut) },
                { color: "var(--muted)", points: bt.dni.map((r) => r.pred) },
              ]} />
            </div>
            <table className="t" style={{ marginTop: 10 }}><thead><tr><th>{t("Deň")}</th><th>{t("Skutočnosť")}</th><th>{t("Predikcia")}</th><th>{t("Odchýlka")}</th></tr></thead>
              <tbody>{[...bt.dni].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 6).map((r) => (
                <tr key={r.datum}><td>{fmtD(r.datum)} {DNI[dow(r.datum)]}</td><td>{nf.format(r.skut)}</td><td>{nf.format(r.pred)}</td>
                  <td className={Math.abs(r.pct) >= 0.1 ? "bad" : "warn"}>{(r.pct * 100).toFixed(1)} %</td></tr>
              ))}</tbody></table>
            <p className="note">{t("Tabuľka: 6 najhorších dní – kandidáti na chýbajúcu udalosť (promo) alebo výnimku (výpadok).")}</p>
          </>
        )}
      </div>

      <p className="note">
        Denná úroveň (deseasonalizovaná): <b>{nf.format(model.levelNow)} JBL</b> ·
        trend <b>{model.slope >= 0 ? "+" : ""}{nf.format(model.slope)}/deň</b> (tlmený, ~50 % po 30 dňoch) ·
        krátkodobá korekcia <b>×{(model.corr ?? 1).toFixed(2)}</b> (medián posledných 5 dní vs. model, do budúcnosti sa vytráca) ·
        variabilita rezíduí <b>±{(model.residStd * 100).toFixed(0)} %</b> (základ 80 % intervalu) ·
        {t("tréningové dni")} <b>{model.trainDays}</b>
      </p>
    </>
  );
}
