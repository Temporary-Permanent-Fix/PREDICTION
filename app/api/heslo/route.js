// Overenie hesla pre chránené nastavenia (plošné výkony procesov).
// Env premenná vo Verceli: VYKONY_HESLO
// Ak nie je nastavená, ochrana je vypnutá a appka sa správa ako predtým.

export async function GET() {
  return Response.json({ chranene: Boolean(process.env.VYKONY_HESLO) });
}

export async function POST(req) {
  const ocakavane = process.env.VYKONY_HESLO;
  if (!ocakavane) return Response.json({ ok: true, chranene: false });

  let heslo = "";
  try {
    heslo = (await req.json()).heslo || "";
  } catch {}

  // porovnanie v konštantnom čase (nech dĺžka odpovede nič neprezrádza)
  const a = Buffer.from(String(heslo));
  const b = Buffer.from(ocakavane);
  let zhoda = a.length === b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) zhoda = false;
  }

  if (!zhoda) {
    await new Promise((r) => setTimeout(r, 600)); // brzda proti skúšaniu hesiel
    return Response.json({ ok: false, error: "Nesprávne heslo." }, { status: 401 });
  }
  return Response.json({ ok: true, chranene: true });
}
