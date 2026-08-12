# JBL Predikcia · SKLC3 (Next.js / Vercel)

Webová appka na dennú a hodinovú predikciu jobline (vzniky aj triedenie),
predikciu zvozov, intradenný prepočet, evidenciu anomálií a udalostí.

## Nasadenie na Vercel
1. Nahraj celý obsah do GitHub repa (napr. `kabatovaada/JBL_PREDIKCIA_WEB`).
2. Na vercel.com → **Add New → Project** → importuj repo. Framework: Next.js (auto). Deploy.
3. **Settings → Environment Variables** (pre ukladanie dát do GitHubu):
   - `GH_TOKEN` – personal access token s právom *contents: read & write* na repo
   - `GH_REPO` – `kabatovaada/JBL_PREDIKCIA_WEB`
   - `GH_BRANCH` – `main` (voliteľné)
   - `GH_DIR` – `public/data` (voliteľné)
   Po pridaní premenných sprav **Redeploy**.

Bez env premenných appka beží tiež – zápisy platia len do obnovenia stránky.

## Poznámka k redeployom
Každé uloženie záznamu commitne CSV do repa, čo štandardne spustí nový Vercel build.
Ak tomu chceš zabrániť, nastav v **Settings → Git → Ignored Build Step**:
```
git diff --quiet HEAD^ HEAD -- ':!public/data'
```
(build sa preskočí, keď sa zmenili len dátové súbory; appka číta dáta cez GitHub API,
takže čerstvé dáta vidí aj bez rebuildu).

## Dáta – hlavný zdroj je OLAP export
Oba kľúčové súbory (`vzniky_hodinove.csv` aj `zvoz_matica.json`) sa generujú z jedného
OLAP exportu skriptom `tools/olap_to_data.py`:
```
python tools/olap_to_data.py OLAP_PREDICTION.xlsx public/data
```
Skript sám vynechá neúplný posledný deň exportu a pri matici zvozov počíta len so
vznikmi staršími ako 6 dní (aby zvozy stihli dobehnúť). Po vygenerovaní commitni
oba súbory do repa.

- `public/data/vzniky_hodinove.csv` – vzniky jobline po hodinách (z OLAP)
- `public/data/baseline_hodinove.csv` – triedenie po hodinách (2–6/2026)
- `public/data/zvoz_matica.json` – konverzná matica vznik→zvoz z OLAP (expFrac, D0–D3+, hodinový profil zvozov)
- `zaznamy.csv`, `vynimky.csv`, `udalosti.csv`, `priebeh.csv` – editované appkou (commity cez GitHub API)

## Model
Predikcia = úroveň s tlmeným trendom (42 dní, vážená regresia) × faktor dňa v týždni (medián 8 týždňov)
× faktor dňa v mesiaci (výplatné výkyvy) × koeficient udalostí. Dni s výnimkou sú vylúčené z tréningu.
Zvozy: zvoz(D) = Σ vzniky(D−k, hodina) × expedičný podiel hodiny × podiel D+k, k = 0…3.
