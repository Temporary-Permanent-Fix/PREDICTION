# -*- coding: utf-8 -*-
"""Konvertor výkazu odpracovaných hodín (SJL ManHours) na manhours.csv."""
import sys
from pathlib import Path
import pandas as pd

MES = {"January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
       "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12}
# názvy procesov zjednotené s KPI v appke
MAP = {"Příjem": "Príjem", "Prijem": "Príjem", "Pick": "Pick", "Pack": "Pack",
       "Sorting": "Sort", "Sort": "Sort", "Potvrzení": "Potvrdenie"}


def main():
    src = sys.argv[1]
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "public/data")
    out.mkdir(parents=True, exist_ok=True)
    df = pd.read_excel(src, skiprows=2)
    df.columns = ["rok", "kvartal", "mesiac", "tyzden", "den", "proces", "hodiny"]
    df = df.dropna(subset=["proces", "hodiny"])
    df["datum"] = pd.to_datetime(dict(year=df.rok.astype(int),
                                      month=df.mesiac.map(MES), day=df.den.astype(int)))
    df["proces"] = df["proces"].map(lambda x: MAP.get(str(x).strip(), str(x).strip()))
    v = df.groupby([df.datum.dt.strftime("%Y-%m-%d"), "proces"])["hodiny"].sum().round(2).reset_index()
    v.columns = ["datum", "proces", "hodiny"]
    v.sort_values(["datum", "proces"]).to_csv(out / "manhours.csv", index=False)
    print(f"manhours.csv: {v.datum.nunique()} dní, {v.proces.nunique()} procesov "
          f"({v.datum.min()} – {v.datum.max()})")


if __name__ == "__main__":
    main()
