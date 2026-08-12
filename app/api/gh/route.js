// Čítanie a zápis dátových súborov cez GitHub Contents API.
// Env premenné (Vercel → Settings → Environment Variables):
//   GH_TOKEN  – personal access token s právom contents:write (POVINNÉ pre zápis)
//   GH_REPO   – "majitel/repo", napr. "kabatovaada/JBL_PREDIKCIA_WEB"
//   GH_BRANCH – vetva, default "main"
//   GH_DIR    – priečinok s dátami v repe, default "public/data"

function ghHint(status) {
  if (status === 401) return "GitHub 401 – token je neplatný alebo expirovaný.";
  if (status === 403) return "GitHub 403 – token nemá právo Contents: write, alebo čaká na schválenie organizáciou.";
  if (status === 404) return "GitHub 404 – skontroluj GH_REPO (org/repo) a GH_DIR; token možno repo nevidí (zlý Resource owner).";
  return `GitHub ${status}`;
}

// zapisovateľné: prevádzkové záznamy + baseline dáta z importu Excelu
const ALLOWED = new Set([
  "pobocky.csv", "manhours.csv",
  "zaznamy.csv", "vynimky.csv", "udalosti.csv", "priebeh.csv", "kpi.csv", "backlog.csv",
  "vzniky_hodinove.csv", "distribucia_hodinove.csv", "baseline_hodinove.csv", "prijem_hodinove.csv",
  "kvalita_denne.csv", "zvoz_matica.json", "procesy_pomery.json", "kvalita_hodiny.json", "kvalita_hodinove.csv", "emaily.csv", "prahy.csv", "zmeny.csv", "manazeri.csv", "upozornenia.csv",
]);

// súbory, ktorých zápis vyžaduje heslo (env VYKONY_HESLO); bez env je ochrana vypnutá
const CHRANENE = new Set(["kpi.csv", "emaily.csv", "prahy.csv"]);

// súbor môže byť buď v koreni (pobocky.csv), alebo v priečinku pobočky (SKLC3/kpi.csv)
function povoleny(file) {
  const casti = String(file).split("/");
  if (casti.length > 2) return false;
  const zaklad = casti[casti.length - 1];
  if (casti.length === 2 && !/^[A-Za-z0-9_-]+$/.test(casti[0])) return false;
  return ALLOWED.has(zaklad);
}

function hesloOk(req, file) {
  const ocakavane = process.env.VYKONY_HESLO;
  if (!ocakavane || !CHRANENE.has(String(file).split("/").pop())) return true;
  const dane = req.headers.get("x-vykony-heslo") || "";
  return dane === ocakavane;
}

function cfg() {
  return {
    token: process.env.GH_TOKEN,
    repo: process.env.GH_REPO,
    branch: process.env.GH_BRANCH || "main",
    dir: process.env.GH_DIR || "public/data",
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const file = searchParams.get("file");
  if (!povoleny(file)) return Response.json({ error: "Neznámy súbor." }, { status: 400 });
  const { token, repo, branch, dir } = cfg();
  if (!token || !repo) return Response.json({ error: "GitHub nie je nakonfigurovaný." }, { status: 501 });
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/${dir}/${file}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, cache: "no-store" }
  );
  if (!r.ok) return Response.json({ error: ghHint(r.status) }, { status: 502 });
  const j = await r.json();
  const content = Buffer.from(j.content, "base64").toString("utf-8");
  return Response.json({ content });
}

export async function POST(req) {
  const { file, content, message } = await req.json();
  if (!povoleny(file)) return Response.json({ error: "Neznámy súbor." }, { status: 400 });
  if (!hesloOk(req, file))
    return Response.json({ error: "Zmena výkonov je chránená heslom – odomkni ju v záložke Výkony." }, { status: 401 });
  const { token, repo, branch, dir } = cfg();
  if (!token || !repo)
    return Response.json({ error: "GitHub nie je nakonfigurovaný – zmeny platia len do obnovenia stránky." }, { status: 501 });

  const api = `https://api.github.com/repos/${repo}/contents/${dir}/${file}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  let sha;
  const cur = await fetch(`${api}?ref=${branch}`, { headers, cache: "no-store" });
  if (cur.ok) sha = (await cur.json()).sha;

  const r = await fetch(api, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: message || `data: ${file}`,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!r.ok) return Response.json({ error: "Zápis zlyhal: " + ghHint(r.status) }, { status: 502 });
  return Response.json({ ok: true });
}
