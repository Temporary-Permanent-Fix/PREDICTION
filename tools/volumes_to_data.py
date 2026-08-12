# -*- coding: utf-8 -*-
"""
Konvertor VOLUMES exportu na dátové súbory appky JBL Predikcia.

Vstup:  VOLUMES.xlsx – hodinové objemy procesov (stĺpce: Proces_, Den (datum), Hodina, Celkem, Směna 06-06)
Výstup: public/data/prijem_hodinove.csv    – príjem (Výtlak | 1. Received)
        public/data/baseline_hodinove.csv  – triedenie (Výtlak | 6. Sorted)

CSV je v kalendárnych dňoch a hodinách – appka si posun na prevádzkový deň
(06:00–06:00) robí sama; konzistenciu so stĺpcom "Směna 06-06" skript overí.

Použitie:  python tools/volumes_to_data.py VOLUMES.xlsx [cielovy_priecinok]
"""
import sys
from pathlib import Path

import pandas as pd

PROCESY = {
    "Výtlak | 1. Received": "prijem_hodinove.csv",
    "Výtlak | 6. Sorted": "baseline_hodinove.csv",
}
POMERY_DNI = 60  # pomery objemov procesov voči Sorted z posledných N prevádzkových dní


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "VOLUMES.xlsx"
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "public/data")
    out.mkdir(parents=True, exist_ok=True)

    df = pd.read_excel(src)
    df["Den (datum)"] = pd.to_datetime(df["Den (datum)"])
    df["Směna 06-06"] = pd.to_datetime(df["Směna 06-06"])

    # kontrola konzistencie prevádzkového dňa so vzorcom appky (h<6 -> deň-1)
    op = df["Den (datum)"] - pd.to_timedelta((df["Hodina"] < 6).astype(int), unit="D")
    nesulad = (op != df["Směna 06-06"]).sum()
    if nesulad:
        print(f"⚠️ {nesulad} riadkov má Směnu 06-06 inak než vzorec h<6->deň-1")

    for proces, fname in PROCESY.items():
        g = df[df["Proces_"] == proces]
        agg = g.groupby(["Den (datum)", "Hodina"])["Celkem"].sum().reset_index()
        v = pd.DataFrame({
            "datum": agg["Den (datum)"].dt.strftime("%Y-%m-%d"),
            "hodina": agg["Hodina"].astype(int),
            "joblines": agg["Celkem"].astype(int),
        }).sort_values(["datum", "hodina"])
        v.to_csv(out / fname, index=False)
        print(f"{fname}: {v['datum'].nunique()} dní, {v['joblines'].sum():,} JBL "
              f"({v['datum'].min()} – {v['datum'].max()})")


def pomery(df, out):
    """Medián pomeru denného objemu procesu voči Sorted (prevádzkové dni)."""
    import json
    cut = df["Směna 06-06"].max() - pd.Timedelta(days=POMERY_DNI)
    g = df[df["Směna 06-06"] > cut]
    d = g.groupby([g["Směna 06-06"], "Proces_"])["Celkem"].sum().unstack()
    ref = d.get("Výtlak | 6. Sorted")
    vys = {"Sort": 1.0}
    for proc, key in [("Výtlak | 4. Picked", "Pick"), ("Výtlak | 5. Packed", "Pack"),
                      ("Výtlak | 1. Received", "Príjem")]:
        if proc in d:
            r = (d[proc] / ref).median()
            vys[key] = round(float(r), 4)
    json.dump({"dni": POMERY_DNI, "pomery_vs_sorted": vys},
              open(out / "procesy_pomery.json", "w"), ensure_ascii=False)
    print("procesy_pomery.json:", vys)


if __name__ == "__main__":
    import pandas as _pd
    _df = _pd.read_excel(sys.argv[1] if len(sys.argv) > 1 else "VOLUMES.xlsx")
    _df["Směna 06-06"] = _pd.to_datetime(_df["Směna 06-06"])
    main()
    pomery(_df, Path(sys.argv[2] if len(sys.argv) > 2 else "public/data"))
