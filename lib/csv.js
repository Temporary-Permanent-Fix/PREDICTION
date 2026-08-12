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
