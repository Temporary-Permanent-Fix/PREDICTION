# Predikcia — Alza LOG

Predikcia objemov, kapacít a kvality pre sklady SKLC3, CZLC4 a LCU.
Next.js 14, nasadené na Vercel, dáta v tomto repozitári (`public/data/<POBOČKA>/`).

**Príručka a dokumentácia modelu:** `public/dokumentacia.html` — po nasadení dostupná na
`https://<adresa-appky>/dokumentacia.html`

## Denná rutina

1. Ráno nahrať exporty v záložke **Dáta** (OLAP, VOLUMES, QUALITY; podľa potreby ManHours, avíza, DFS).
2. O 6:00 príde do Teams automatický report za predchádzajúci deň.
3. Podľa potreby skontrolovať **Upozornenia** a potvrdiť presuny objemu.

## Nastavenie prostredia (Vercel → Settings → Environment Variables)

| Premenná | Účel |
|---|---|
| `GH_TOKEN` | fine-grained PAT, Resource owner = organizácia, Contents: Read and write |
| `GH_REPO` | `organizácia/repozitár` |
| `GH_BRANCH` | `main` |
| `GH_DIR` | `public/data` |
| `VYKONY_HESLO` | heslo do sekcie Admin |
| `TEAMS_WEBHOOK` | webhook kanála pre denný report |
| `APP_URL` | adresa appky (odkaz v reporte) |
| `REPORT_POBOCKA` | pobočka pre denný report (predvolene SKLC3) |
| `CRON_SECRET` | ochrana cron endpointu |

Premenné sa načítajú až pri builde — po ich zmene je potrebný **Redeploy**.

## Pridanie pobočky

1. Doplniť riadok do `public/data/pobocky.csv`.
2. Vytvoriť priečinok `public/data/<KÓD>/` s prázdnymi súbormi (hlavičky podľa existujúcej pobočky).
3. V appke prepnúť na novú pobočku a nahrať exporty.

## Štruktúra

```
app/            stránka a API (gh, heslo, cron/report)
lib/            model.js (predikcia), importuj.js (konvertory), preklady.js, csv.js
public/data/    dáta po pobočkách
public/dokumentacia.html
vercel.json     plán cronu
```

## Jazyky

SK, CS, EN, UA — prepínač v hlavičke. Nové texty sa pridávajú do `lib/preklady.js`.
