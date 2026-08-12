// Odoslanie reportu e-mailom cez Resend.
// Env premenné (Vercel → Settings → Environment Variables):
//   RESEND_API_KEY – API kľúč z resend.com
//   MAIL_FROM      – odosielateľ, napr. "Predikcia SKLC3 <predikcia@tvoja-domena.sk>"
// Príjemcov nemožno zadať ľubovoľne – musia byť v public/data/emaily.csv,
// ktorý sa spravuje v appke (záložka Výkony, chránená heslom).

function cfg() {
  return {
    token: process.env.GH_TOKEN,
    repo: process.env.GH_REPO,
    branch: process.env.GH_BRANCH || "main",
    dir: process.env.GH_DIR || "public/data",
  };
}

async function povoleniPrijemcovia() {
  const { token, repo, branch, dir } = cfg();
  if (!token || !repo) return [];
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${dir}/${process.env.REPORT_POBOCKA || "SKLC3"}/emaily.csv?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!r.ok) return [];
  const text = Buffer.from((await r.json()).content, "base64").toString("utf-8");
  return text
    .split("\n")
    .slice(1)
    .map((l) => (l.split(",")[0] || "").trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

export async function POST(req) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from)
    return Response.json({ error: "E-mail nie je nakonfigurovaný (RESEND_API_KEY / MAIL_FROM)." }, { status: 501 });

  const { prijemcovia, predmet, text, priloha, nazovPrilohy } = await req.json();
  const povolene = await povoleniPrijemcovia();
  const komu = (prijemcovia || []).map((e) => String(e).toLowerCase()).filter((e) => povolene.includes(e));
  if (!komu.length)
    return Response.json({ error: "Žiadny platný príjemca – adresy pridaj v záložke Výkony." }, { status: 400 });

  const body = {
    from,
    to: komu,
    subject: predmet || "Prehľad SKLC3",
    text: text || "Report z appky Predikcia SKLC3.",
  };
  if (priloha) {
    body.attachments = [{ filename: nazovPrilohy || "prehlad-sklc3.png", content: priloha }];
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text();
    return Response.json({ error: `Odoslanie zlyhalo (${r.status}). ${detail.slice(0, 200)}` }, { status: 502 });
  }
  return Response.json({ ok: true, odoslane: komu.length });
}
