# -*- coding: utf-8 -*-
"""
Konvertor OLAP exportu (3 úrovne: vznik -> plánovaný zvoz -> reálny zvoz).

Výstup: public/data/vzniky_hodinove.csv
        public/data/zvoz_matica.json  (matica D0-D3, profil zvozov, harmonogram slotov,
                                       mapa vznik->slot pre presun backlogu, presnosť plnenia plánu)
Použitie:  python tools/olap_to_data.py OLAP_PREDICTION.xlsx [cielovy_priecinok]
"""
import json, re, sys
from pathlib import Path
import pandas as pd

ZRELE_OD = "2025-10-01"
ZVOZ_DOBEH_DNI = 6
PROFIL_DNI = 60


def parse_olap3(path):
    """4 úrovne: kategória (Expedice/Distribuce) -> vznik -> plánovaný zvoz -> reálny zvoz."""
    raw = pd.read_excel(path, header=None, skiprows=6)
    rx = re.compile(r"^\d{2}\.\d{2}\.\d{4} \d{1,2}$")
    vals = raw[0].astype(str).str.strip().tolist()
    cnts = raw[1].tolist()
    rows, kat, vznik, plan = [], None, None, None
    n = len(vals)
    for i in range(n):
        s, c = vals[i], cnts[i]
        if not rx.match(s):
            if s in ("Expedice", "Distribuce"):
                kat = s
            continue
        if pd.isna(c):
            j = i + 1
            nxt_nan = j < n and rx.match(vals[j]) and pd.isna(cnts[j])
            if nxt_nan:
                vznik = s      # NaN nasledovaný NaN = úroveň vzniku
            else:
                plan = s       # NaN nasledovaný počtom = plánovaný zvoz
        else:
            rows.append((kat, vznik, plan, s, int(c)))
    df = pd.DataFrame(rows, columns=["kat", "vznik", "plan", "real", "pocet"])
    cache = {}
    def pdt(s):
        if s not in cache:
            d, h = s.rsplit(" ", 1)
            cache[s] = pd.to_datetime(d, format="%d.%m.%Y") + pd.to_timedelta(int(h), unit="h")
        return cache[s]
    for c in ["vznik", "plan", "real"]:
        df[c + "_dt"] = df[c].map(pdt)
    df["plan_nan"] = df["plan"].str.startswith("01.01.1900")
    df["real_nan"] = df["real"].str.startswith("01.01.1900")
    return df


def opday(dt):
    return (dt - pd.Timedelta(hours=6)).dt.normalize()


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "OLAP_PREDICTION.xlsx"
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "public/data")
    out.mkdir(parents=True, exist_ok=True)
    df = parse_olap3(src)
    print(f"Načítané: {len(df):,} kombinácií, {df['pocet'].sum():,} jobline, "
          f"vzniky {df['vznik_dt'].min()} – {df['vznik_dt'].max()}")

    # --- vzniky_hodinove.csv (Expedícia = zákaznícke) + distribucia_hodinove.csv ---
    for kat, fname in [("Expedice", "vzniky_hodinove.csv"), ("Distribuce", "distribucia_hodinove.csv")]:
        sub = df[df["kat"] == kat]
        tmp = pd.DataFrame({"datum": sub["vznik_dt"].dt.normalize(), "hodina": sub["vznik_dt"].dt.hour, "pocet": sub["pocet"]})
        v = tmp.groupby(["datum", "hodina"])["pocet"].sum().reset_index()
        v.columns = ["datum", "hodina", "joblines"]
        posl = v["datum"].max()
        if v[v["datum"] == posl]["hodina"].nunique() < 20:
            v = v[v["datum"] < posl]
        v["datum"] = v["datum"].dt.strftime("%Y-%m-%d")
        v.sort_values(["datum", "hodina"]).to_csv(out / fname, index=False)
        print(f"{fname}: {v['datum'].nunique()} dní, {v['joblines'].sum():,} JBL")

    # --- zrelé obdobie pre maticu: len EXPEDÍCIA (zákaznícke zvozy) ---
    koniec = df["vznik_dt"].max() - pd.Timedelta(days=ZVOZ_DOBEH_DNI)
    m = df[(df["kat"] == "Expedice") & (df["vznik_dt"] >= ZRELE_OD) & (df["vznik_dt"] < koniec)].copy()
    m["vh"] = m["vznik_dt"].dt.hour
    m["dni"] = (opday(m["real_dt"]) - opday(m["vznik_dt"])).dt.days

    mat = {}
    for h in range(24):
        g = m[m["vh"] == h]; tot = g["pocet"].sum()
        disp = g[~g["real_nan"] & (g["dni"] >= 0)]; dtot = disp["pocet"].sum()
        d = disp.groupby("dni")["pocet"].sum()
        mat[str(h)] = {"expFrac": round(float(dtot / tot), 4) if tot else 0.9,
                       "d0": round(float(d.get(0, 0) / dtot), 4) if dtot else 0,
                       "d1": round(float(d.get(1, 0) / dtot), 4) if dtot else 0,
                       "d2": round(float(d.get(2, 0) / dtot), 4) if dtot else 0,
                       "d3": round(float(max(dtot - d.get(0, 0) - d.get(1, 0) - d.get(2, 0), 0) / dtot), 4) if dtot else 0}

    disp_all = m[~m["real_nan"]]
    posledne = disp_all[disp_all["real_dt"] >= disp_all["real_dt"].max() - pd.Timedelta(days=PROFIL_DNI)]
    zp = posledne.groupby(posledne["real_dt"].dt.hour)["pocet"].sum().reindex(range(24)).fillna(0)
    zp = (zp / zp.sum()).round(4)

    # --- harmonogram zvozov: sloty (hodiny) podľa dňa v týždni, z reálnych zvozov ---
    posledne = posledne.copy()
    posledne["op"] = opday(posledne["real_dt"])
    posledne["rdow"] = posledne["op"].dt.dayofweek
    posledne["rh"] = posledne["real_dt"].dt.hour
    harmonogram = {}
    for dw in range(7):
        g = posledne[posledne["rdow"] == dw]
        s = g.groupby("rh")["pocet"].sum(); tot = s.sum() or 1
        sloty = [{"h": int(h), "podiel": round(float(c / tot), 4)} for h, c in s.items() if c / tot >= 0.005]
        harmonogram[str(dw)] = sorted(sloty, key=lambda x: -x["podiel"])

    # --- mapa vznik hodina -> cieľové sloty zvozu (hodina + offset prevádzk. dní) ---
    dd = m[~m["real_nan"] & (m["dni"] >= 0) & (m["dni"] <= 3)].copy()
    dd["rh"] = dd["real_dt"].dt.hour
    slot_map = {}
    for h in range(24):
        g = dd[dd["vh"] == h]
        s = g.groupby(["rh", "dni"])["pocet"].sum().sort_values(ascending=False)
        tot = s.sum() or 1
        top, cum = [], 0.0
        for (rh, off), c in s.items():
            podiel = float(c / tot)
            top.append({"zh": int(rh), "off": int(off), "podiel": round(podiel, 4)})
            cum += podiel
            if cum >= 0.9 or len(top) >= 8:
                break
        slot_map[str(h)] = top

    # --- presnosť plnenia plánu ---
    pm = m[~m["plan_nan"] & ~m["real_nan"]].copy()
    pm["slip"] = (pm["real_dt"] - pm["plan_dt"]).dt.total_seconds() / 3600
    tot = pm["pocet"].sum() or 1
    on_time = float(pm.loc[pm["slip"].abs() <= 0.5, "pocet"].sum() / tot)
    d24 = float(pm.loc[(pm["slip"] > 20) & (pm["slip"] <= 28), "pocet"].sum() / tot)
    same_hour = float(pm.loc[pm["real_dt"].dt.hour == pm["plan_dt"].dt.hour, "pocet"].sum() / tot)

    json.dump({"zdroj": f"{Path(src).name}, vzniky {ZRELE_OD} – {koniec.date()}",
               "matica": mat, "zvozProfil": [float(x) for x in zp],
               "harmonogram": harmonogram, "slotMap": slot_map,
               "plan": {"onTime": round(on_time, 3), "sklz24h": round(d24, 3), "rovnakaHodina": round(same_hour, 3)}},
              open(out / "zvoz_matica.json", "w"), ensure_ascii=False)
    print(f"zvoz_matica.json: harmonogram {sum(len(v) for v in harmonogram.values())} slotov, "
          f"onTime {on_time:.1%}, sklz ~24h {d24:.1%}, rovnaká hodina {same_hour:.1%}")


if __name__ == "__main__":
    main()
