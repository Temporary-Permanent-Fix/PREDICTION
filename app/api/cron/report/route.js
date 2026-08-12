// Denný report o 06:00 – spúšťa Vercel Cron (viď vercel.json).
// Číta dáta z GitHubu, prepočíta predchádzajúci prevádzkový deň a rozpošle
// e-mail všetkým adresám z emaily.csv cez Resend.
//
// Kanály (stačí ktorýkoľvek, dajú sa aj oba naraz):
//   TEAMS_WEBHOOK  – URL webhooku kanála v MS Teams
//   RESEND_API_KEY + MAIL_FROM – odosielanie e-mailom cez Resend
// Ďalšie env: GH_TOKEN, GH_REPO, APP_URL (odkaz v správe),
//   CRON_SECRET (voliteľné – Vercel ho posiela v hlavičke Authorization)

import { parseCSV } from "../../../../lib/csv";
import {
  buildDaily, fitModel, expectedFor, predictDay, opShift, dropIncompleteLastOpDay,
  addDays, dow, DNI, fmtD,
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
  const jeCron = Boolean(req.headers.get("authorization")) || req.headers.get("user-agent")?.includes("vercel-cron");
  if (jeCron && hodinaPraha !== +(process.env.REPORT_HODINA || 6))
    return Response.json({ preskocene: true, hodinaPraha });
  const tajne = process.env.CRON_SECRET;
  if (tajne && req.headers.get("authorization") !== `Bearer ${tajne}`)
    return Response.json({ error: "Neautorizované." }, { status: 401 });

  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  const teamsUrl = process.env.TEAMS_WEBHOOK;
  const mailOk = Boolean(key && from);
  if (!mailOk && !teamsUrl)
    return Response.json({ error: "Nie je nastavený žiadny kanál (TEAMS_WEBHOOK alebo RESEND_API_KEY + MAIL_FROM)." }, { status: 501 });

  const [vzT, trT, diT, kvT, vynT, udaT, bkT, emT] = await Promise.all([
    ghText("vzniky_hodinove.csv", POB), ghText("baseline_hodinove.csv", POB), ghText("distribucia_hodinove.csv", POB),
    ghText("kvalita_denne.csv", POB), ghText("vynimky.csv", POB), ghText("udalosti.csv", POB),
    ghText("backlog.csv", POB), ghText("emaily.csv", POB),
  ]);
  const prijemcovia = parseCSV(emT).map((r) => r.email).filter((e) => e && e.includes("@"));
  if (mailOk && !prijemcovia.length && !teamsUrl)
    return Response.json({ error: "Žiadni príjemcovia." }, { status: 400 });

  const load = (txt) => dropIncompleteLastOpDay(opShift(parseCSV(txt)));
  const uda = parseCSV(udaT), vyn = parseCSV(vynT), vynD = vyn.map((v) => v.datum);
  const vD = buildDaily(load(vzT), []), tD = buildDaily(load(trT), []), dD = buildDaily(load(diT), []);
  const M = fitModel(vD, vynD, uda);
  const den = M.lastDate, tyzden = addDays(den, -7);
  const val = (daily, d) => daily.find((r) => r.datum === d)?.jbl ?? null;
  const vDen = val(vD, den), vTyz = val(vD, tyzden), tDen = val(tD, den), dDen = val(dD, den);
  const ocak = expectedFor(den, M, uda);

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
  const vysledok = { den, teams: null, mail: null };

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
            { type: "TextBlock", text: nadpis, weight: "Bolder", size: "Medium", wrap: true },
            { type: "TextBlock", text: "prevádzkový deň 06:00–06:00", isSubtle: true, spacing: "None", wrap: true },
            { type: "FactSet", facts: [
              fakt("Objem (vzniky)", `${nf(vDen)}${vTyz ? ` (${pct((vDen / vTyz - 1) * 100)} vs. minulý týždeň)` : ""}`),
              fakt("Expedícia (triedenie)", tDen != null ? nf(tDen) : "dáta zatiaľ nie sú"),
              fakt("Distribúcia", nf(dDen)),
              fakt("Presnosť predikcie", vDen != null ? `${pct((vDen / ocak - 1) * 100)} (model čakal ${nf(ocak)})` : "–"),
              fakt("Otvorený backlog", `${nf(bkObjem)} JBL`),
            ] },
            { type: "TextBlock", text: `**Kvalita · ${fmtD(kvDen)}**`, wrap: true, spacing: "Medium" },
            { type: "FactSet", facts: kvality.map(([nz, v]) => fakt(nz, v != null ? v.toFixed(1) + " %" : "–")) },
            { type: "TextBlock", text: "**Výhľad na 7 dní**", wrap: true, spacing: "Medium" },
            { type: "TextBlock", text: vyhlad.join("\n\n"), wrap: true, isSubtle: true },
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

  // --- e-mail (Resend) ---
  if (mailOk && prijemcovia.length) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: prijemcovia, subject: nadpis, html }),
    });
    vysledok.mail = r.ok ? `ok (${prijemcovia.length})` : `chyba ${r.status}`;
  }

  const zlyhalo = [vysledok.teams, vysledok.mail].some((x) => x && x.startsWith("chyba"));
  return Response.json(vysledok, { status: zlyhalo ? 502 : 200 });
}
