// Denný report o 06:00 – spúšťa Vercel Cron (viď vercel.json).
// Číta dáta z GitHubu, prepočíta predchádzajúci prevádzkový deň a pošle kartu do Teams.
//
// Odosiela do MS Teams cez webhook kanála (env TEAMS_WEBHOOK).
// Preposielanie na e-mail rieši Power Automate nad kanálom, appka maily neposiela.
// Ďalšie env: GH_TOKEN, GH_REPO, APP_URL (odkaz v správe), REPORT_POBOCKA,
//   CRON_SECRET (voliteľné – Vercel ho posiela v hlavičke Authorization)

import { parseCSV } from "../../../../lib/csv";
import {
  buildDaily, fitModel, expectedFor, predictDay, opShift, dropIncompleteLastOpDay,
  addDays, dow, DNI, fmtD, iso,
} from "../../../../lib/model";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cfg() {
  return {
    token: process.env.GH_TOKEN,
    repo: process.env.GH_REPO,
    branch: process.env.GH_BRANCH || "main",
    dir: process.env.GH_DIR || "public/data",
  };
}

async function ghText(file, pob) {
  const { token, repo, branch, dir } = cfg();
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${dir}/${pob}/${file}?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!r.ok) return "";
  return Buffer.from((await r.json()).content, "base64").toString("utf-8");
}

const nf = (x) => (x == null ? "–" : new Intl.NumberFormat("sk-SK").format(Math.round(x)));
const pct = (x) => (x >= 0 ? "▲ +" : "▼ ") + Math.abs(x).toFixed(1) + " %";

export async function GET(req) {
  const POB = process.env.REPORT_POBOCKA || "SKLC3";

  // Vercel Cron beží v UTC a nepozná letný čas. Endpoint je preto naplánovaný
  // dvakrát (04:00 a 05:00 UTC) a odošle len vtedy, keď je v Prahe práve 6:00.
  const hodinaPraha = +new Intl.DateTimeFormat("sk-SK", {
    timeZone: "Europe/Prague", hour: "numeric", hour12: false,
  }).format(new Date());
  // report sa pokúša odoslať od 6:00 do 9:00 miestneho času, kým nie sú dáta
  const jeCron = Boolean(req.headers.get("authorization")) || req.headers.get("user-agent")?.includes("vercel-cron");
  const odHodiny = +(process.env.REPORT_HODINA || 6);
  if (jeCron && (hodinaPraha < odHodiny || hodinaPraha > odHodiny + 3))
    return Response.json({ preskocene: true, dovod: "mimo okna odosielania", hodinaPraha });
  const tajne = process.env.CRON_SECRET;
  if (tajne && req.headers.get("authorization") !== `Bearer ${tajne}`)
    return Response.json({ error: "Neautorizované." }, { status: 401 });

  const teamsUrl = process.env.TEAMS_WEBHOOK;
  if (!teamsUrl)
    return Response.json({ error: "Nie je nastavený TEAMS_WEBHOOK." }, { status: 501 });

  const [vzT, trT, diT, kvT, vynT, udaT, bkT] = await Promise.all([
    ghText("vzniky_hodinove.csv", POB), ghText("baseline_hodinove.csv", POB), ghText("distribucia_hodinove.csv", POB),
    ghText("kvalita_denne.csv", POB), ghText("vynimky.csv", POB), ghText("udalosti.csv", POB),
    ghText("backlog.csv", POB),
  ]);


  const load = (txt) => dropIncompleteLastOpDay(opShift(parseCSV(txt)));
  const uda = parseCSV(udaT), vyn = parseCSV(vynT), vynD = vyn.map((v) => v.datum);
  const vD = buildDaily(load(vzT), []), tD = buildDaily(load(trT), []), dD = buildDaily(load(diT), []);
  const M = fitModel(vD, vynD, uda);
  const den = M.lastDate, tyzden = addDays(den, -7);
  const val = (daily, d) => daily.find((r) => r.datum === d)?.jbl ?? null;
  const vDen = val(vD, den), vTyz = val(vD, tyzden), tDen = val(tD, den), dDen = val(dD, den);
  const ocak = expectedFor(den, M, uda);

  // report má zmysel len s dátami za predchádzajúci deň – inak počká na ďalší pokus
  const vcera = iso(new Date(Date.now() - 86400000));
  if (den < vcera && !process.env.REPORT_VZDY) {
    return Response.json({ preskocene: true, dovod: "chýbajú dáta za predchádzajúci deň", posledne: den, ocakavane: vcera });
  }

  const kvR = parseCSV(kvT);
  const kvDen = [...new Set(kvR.map((r) => r.datum))].sort().pop();
  const kvOf = (filtr) => {
    const rs = kvR.filter((r) => r.datum === kvDen && filtr(r.proces));
    const c = rs.reduce((a, r) => a + +r.celkem, 0), z = rs.reduce((a, r) => a + +r.pozde, 0);
    return c > 0 ? (1 - z / c) * 100 : null;
  };
  const kvality = [
    ["Sort", kvOf((p) => p.includes("Sort"))],
    ["Zvoz (EXP)", kvOf((p) => p.includes("EXP"))],
    ["BJ (LT)", kvOf((p) => p.includes("BJ (LT)"))],
    ["BJ (ČS)", kvOf((p) => p.includes("BJ (ČS)"))],
  ];
  const bk = parseCSV(bkT).filter((b) => b.na_datum >= den);
  const bkObjem = bk.reduce((a, b) => a + (+b.objem || 0), 0);
  const vyhlad = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(den, i + 1);
    return `${fmtD(d)} ${DNI[dow(d)]}: ${nf(predictDay(d, M, uda))}`;
  });

  // stĺpec s popisom, veľkou hodnotou a poznámkou
  const stlpec = (nazov, hodnota, poznamka, farba = "Default") => ({
    type: "Column", width: "stretch", items: [
      { type: "TextBlock", text: nazov, size: "Small", isSubtle: true, wrap: true, spacing: "None" },
      { type: "TextBlock", text: hodnota, size: "ExtraLarge", weight: "Bolder", spacing: "None", color: farba },
      ...(poznamka ? [{ type: "TextBlock", text: poznamka, size: "Small", isSubtle: true, wrap: true, spacing: "None" }] : []),
    ],
  });

  const riadok = (a, b) => `<tr><td style="padding:6px 12px 6px 0;color:#555">${a}</td><td style="padding:6px 0;font-weight:600">${b}</td></tr>`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:640px">
    <h2 style="margin:0 0 4px">Prehľad ${POB}</h2>
    <p style="margin:0 0 16px;color:#666">${fmtD(den)}${den.slice(0, 4)} (${DNI[dow(den)]}) · prevádzkový deň 06:00–06:00</p>
    <table style="border-collapse:collapse;margin-bottom:18px">
      ${riadok("Objem (vzniky)", `${nf(vDen)} ${vTyz ? `<span style="font-weight:400;color:#666">(${pct((vDen / vTyz - 1) * 100)} vs. minulý týždeň)</span>` : ""}`)}
      ${riadok("Expedícia (triedenie)", tDen != null ? nf(tDen) : "dáta zatiaľ nie sú")}
      ${riadok("Distribúcia", nf(dDen))}
      ${riadok("Presnosť predikcie", vDen != null ? `${pct((vDen / ocak - 1) * 100)} <span style="font-weight:400;color:#666">(model čakal ${nf(ocak)})</span>` : "–")}
      ${riadok("Otvorený backlog", `${nf(bkObjem)} JBL`)}
    </table>
    <h3 style="margin:0 0 6px;font-size:15px">Kvalita · ${fmtD(kvDen)}</h3>
    <table style="border-collapse:collapse;margin-bottom:18px">
      ${kvality.map(([n, v]) => riadok(n, v != null ? v.toFixed(1) + " %" : "–")).join("")}
    </table>
    <h3 style="margin:0 0 6px;font-size:15px">Výhľad na 7 dní</h3>
    <p style="margin:0 0 18px;color:#333;line-height:1.7">${vyhlad.join("<br>")}</p>
    ${process.env.APP_URL ? `<p><a href="${process.env.APP_URL}" style="color:#0a7a33">Otvoriť celý prehľad v appke</a></p>` : ""}
  </div>`;

  const nadpis = `Prehľad ${POB} · ${fmtD(den)}${den.slice(0, 4)} (${DNI[dow(den)]})`;
  const vysledok = { den, teams: null };

  // --- Microsoft Teams (Adaptive Card cez webhook) ---
  if (teamsUrl) {
    const fakt = (n, v) => ({ title: n, value: v });
    const karta = {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard", version: "1.4",
          body: [
            // hlavička
            { type: "Container", style: "emphasis", bleed: true, items: [
              { type: "TextBlock", text: `PREDIKCIA ${POB}`, weight: "Bolder", size: "Large", wrap: true, spacing: "None" },
              { type: "TextBlock", text: `${fmtD(den)}${den.slice(0, 4)} (${DNI[dow(den)]}) · prevádzkový deň 06:00–06:00`,
                isSubtle: true, spacing: "None", wrap: true },
            ] },

            // hlavné čísla v dvoch stĺpcoch
            { type: "ColumnSet", spacing: "Medium", columns: [
              stlpec("Objem (vzniky)", nf(vDen), vTyz ? `${pct((vDen / vTyz - 1) * 100)} vs. minulý týždeň` : null,
                vTyz ? (vDen >= vTyz ? "Good" : "Warning") : "Default"),
              stlpec("Expedícia (triedenie)", tDen != null ? nf(tDen) : "–",
                tDen != null ? (dDen != null ? `distribúcia ${nf(dDen)}` : null) : "dáta zatiaľ nie sú"),
            ] },
            { type: "ColumnSet", columns: [
              stlpec("Presnosť predikcie", vDen != null ? pct((vDen / ocak - 1) * 100) : "–",
                `model čakal ${nf(ocak)}`,
                vDen != null && Math.abs(vDen / ocak - 1) <= 0.08 ? "Good" : "Warning"),
              stlpec("Otvorený backlog", `${nf(bkObjem)}`, "JBL na prenos", bkObjem > 0 ? "Warning" : "Default"),
            ] },

            // kvalita
            { type: "TextBlock", text: `KVALITA · ${fmtD(kvDen)}`, weight: "Bolder", size: "Small",
              spacing: "Medium", separator: true, color: "Accent" },
            { type: "ColumnSet", columns: kvality.map(([nz, v]) => ({
              type: "Column", width: "stretch", items: [
                { type: "TextBlock", text: nz, size: "Small", isSubtle: true, wrap: true, spacing: "None" },
                { type: "TextBlock", text: v != null ? v.toFixed(1) + " %" : "–", weight: "Bolder", spacing: "None",
                  color: v == null ? "Default" : v >= 99 ? "Good" : v >= 98 ? "Warning" : "Attention" },
              ],
            })) },

            // výhľad
            { type: "TextBlock", text: "VÝHĽAD NA 7 DNÍ", weight: "Bolder", size: "Small",
              spacing: "Medium", separator: true, color: "Accent" },
            { type: "FactSet", spacing: "Small", facts: vyhlad.map((v) => {
              const [den7, hodnota] = v.split(": ");
              return { title: den7, value: hodnota };
            }) },
          ],
          actions: process.env.APP_URL
            ? [{ type: "Action.OpenUrl", title: "Otvoriť prehľad v appke", url: process.env.APP_URL }]
            : [],
        },
      }],
    };
    const rt = await fetch(teamsUrl, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(karta),
    });
    vysledok.teams = rt.ok ? "ok" : `chyba ${rt.status}`;
  }

  const zlyhalo = Boolean(vysledok.teams && vysledok.teams.startsWith("chyba"));
  return Response.json(vysledok, { status: zlyhalo ? 502 : 200 });
}
