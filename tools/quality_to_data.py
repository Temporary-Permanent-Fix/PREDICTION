# -*- coding: utf-8 -*-
"""
Konvertor QUALITY exportu na dátové súbory appky JBL Predikcia.

Vstup:  QUALITY.xlsx – hodinová kvalita procesov
        (Proces_, Směna 06-06, Hodina, Celkem, Pozdě dokončené vše)
Výstup: public/data/kvalita_denne.csv  – denná kvalita po procesoch (prevádzkové dni)
        public/data/kvalita_hodiny.json – hodinový profil kvality (posledných 30 dní)

Použitie:  python tools/quality_to_data.py QUALITY.xlsx [cielovy_priecinok]
"""
import json
import sys
from pathlib import Path

import pandas as pd

HODINY_DNI = 30  # hodinový profil z posledných N prevádzkových dní


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "QUALITY.xlsx"
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "public/data")
    out.mkdir(parents=True, exist_ok=True)

    df = pd.read_excel(src)
    df["Směna 06-06"] = pd.to_datetime(df["Směna 06-06"])
    df["proces"] = df["Proces_"].str.replace("Kvalita | ", "", regex=False)

    # denná kvalita po procesoch (prevádzkový deň = Směna 06-06)
    d = df.groupby([df["Směna 06-06"].dt.strftime("%Y-%m-%d"), "proces"]).agg(
        celkem=("Celkem", "sum"), pozde=("Pozdě dokončené vše", "sum")
    ).reset_index().rename(columns={"Směna 06-06": "datum"})
    d = d[d["celkem"] > 0].sort_values(["datum", "proces"])
    d.to_csv(out / "kvalita_denne.csv", index=False)
    print(f"kvalita_denne.csv: {d['datum'].nunique()} dní × {d['proces'].nunique()} procesov "
          f"({d['datum'].min()} – {d['datum'].max()})")

    # hodinová kvalita po procesoch (na rozpad podľa zmien)
    h = df.groupby([df["Směna 06-06"].dt.strftime("%Y-%m-%d"), "Hodina", "proces"]).agg(
        celkem=("Celkem", "sum"), pozde=("Pozdě dokončené vše", "sum")
    ).reset_index().rename(columns={"Směna 06-06": "datum", "Hodina": "hodina"})
    h["hodina"] = h["hodina"].astype(int)
    h = h[h["celkem"] > 0].sort_values(["datum", "hodina", "proces"])
    h.to_csv(out / "kvalita_hodinove.csv", index=False)
    print(f"kvalita_hodinove.csv: {len(h):,} riadkov")

    # hodinový profil kvality – posledných N prevádzkových dní
    cut = df["Směna 06-06"].max() - pd.Timedelta(days=HODINY_DNI)
    h = df[df["Směna 06-06"] > cut]
    prof = {}
    for p, g in h.groupby("proces"):
        # denná báza: kvalita každej hodiny v každom dni zvlášť, potom priemer cez dni
        gg = g.groupby(["Směna 06-06", "Hodina"]).agg(c=("Celkem", "sum"), z=("Pozdě dokončené vše", "sum")).reset_index()
        gg = gg[gg["c"] > 0]
        gg["kv"] = (1 - gg["z"] / gg["c"]) * 100
        agg = gg.groupby("Hodina")["kv"].mean().reindex(range(24))
        prof[p] = [round(float(x), 2) if pd.notna(x) else None for x in agg]
    json.dump({"dni": HODINY_DNI, "profil": prof}, open(out / "kvalita_hodiny.json", "w"), ensure_ascii=False)
    print(f"kvalita_hodiny.json: {len(prof)} procesov, posledných {HODINY_DNI} dní")


if __name__ == "__main__":
    main()
