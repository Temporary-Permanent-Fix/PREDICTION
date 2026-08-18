// Jednoduchý CSV parser/serializér (bez úvodzoviek v dátach appky si vystačíme,
// ale popisy môžu obsahovať čiarky, preto podpora "..." polí).
export function parseCSV(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length);
  if (!lines.length) return [];
  const head = splitLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitLine(l);
    const row = {};
    head.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function splitLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

// Zlúčenie starého a nového CSV podľa dňa.
// Dni, ktoré sú v novom súbore, sa nahradia celé (aj s opravami hodín);
// dni, ktoré nový súbor neobsahuje, zostanú z pôvodných dát.
// Súbory bez stĺpca "datum" sa nahrádzajú celé.
export function zlucPodlaDna(stary, novy) {
  const s = String(stary || "").trim(), n = String(novy || "").trim();
  if (!s) return novy;
  if (!n) return stary;
  const rS = s.split(/\r?\n/), rN = n.split(/\r?\n/);
  const hlS = rS[0], hlN = rN[0];
  if (hlS !== hlN) return novy;                    // iná štruktúra – nahradiť
  const idx = hlN.split(",").indexOf("datum");
  if (idx < 0) return novy;                        // bez dátumu sa nedá zlúčiť
  const den = (riadok) => (riadok.split(",")[idx] || "").trim();
  const noveDni = new Set(rN.slice(1).filter(Boolean).map(den));
  const ponechane = rS.slice(1).filter((r) => r && !noveDni.has(den(r)));
  const spolu = [...ponechane, ...rN.slice(1).filter(Boolean)]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [hlN, ...spolu].join("\n") + "\n";
}
