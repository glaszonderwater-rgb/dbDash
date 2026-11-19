# IDA — overdracht voor een nieuwe sessie

Lees dit eerst. Het beschrijft hoe de app werkt, welke afspraken gelden en wat er nog openstaat.
Laatste stand: v35 (19 nov 2026), branch `main`, GitHub Pages: https://glaszonderwater-rgb.github.io/dbDash/

## Wat IDA is
Persoonlijke offline PWA voor één gebruiker (Focko) met AAPS closed loop + Omnipod Dash, Libre via xDrip+, data uit Nightscout.
IDA leest Nightscout, analyseert en stelt concrete AAPS-profielwaarden voor (basaal, ISF, KH-ratio) in AAPS-blokvorm.

## Harde afspraken
- Antwoorden in het Nederlands, direct, weinig uitleg. Geen "bespreek met je team" toevoegen.
- Concrete profielcijfers geven, klaar om over te nemen in AAPS (Lokaal profiel).
- IDA schrijft nooit naar pomp, loop of instellingen. Nightscout-schrijven alleen opt-in, alleen notities, met apart schrijf-token.
- Nooit vragen om tokens of API-sleutels in de chat te plakken.
- Geen vaste/verzonnen getallen die berekend lijken: alles uit eigen data, of duidelijk als vuistregel benoemd.
- App is in NL, EN en PT (functie `TL(nl,en,pt)` en `I18N`-tabel in index.html).

## Bestanden
- `index.html` — UI, CSS, instellingen, inline scripts (sync, render, navigatie `showTab`, `goTo`).
- `js/core.js` — rekenkern: sync, metrics, maaltijdanalyse (`mealResults`, `mealCR`), profielvoorstel `aapsProfile()`, tijdzones (`setTzTimeline`, `todMin`).
- `js/ida.js` — schermen Vandaag/Patronen/Eten/Team/Profiel, snel loggen, AI-assistent, weekoverzicht, `unloggedRise` + `riseCarbEstimate`.
- `js/ida2.js` — extra's: GRI, hypo-analyse, `mealBolusRisk`, loop-limieten, max IOB, experiment (`expPre` = bolusmoment uit t50), reizen, voorraad, rijcheck, Nightscout-notities, CSV, autoSync.
- `js/ida3.js` — geen uitklapblokken: rijen + detailpagina's (`openDetail`, `closeDetail`), Vandaag max 3 kaarten.
- `js/moments.js` — pure regels voor "advies vóór het moment" (gedeeld met server).
- `js/push.js` — moment bovenaan Vandaag, lokale meldingen, Web Push-aanmelding.
- `sw.js` — service worker; **VERSION ophogen bij elke release** (nu `v35`) en nieuwe js-bestanden aan `SHELL` toevoegen.
- `server/` — meldingenserver (`push.mjs`, README). `.github/workflows/ida-push.yml` doet niets zonder geheimen.

Klassieke scripts (geen modules), zodat `file://` werkt. Globale staat: `_ctx`, `_dsAll`, `_dsRecent`, `_P` (profielvoorstel), `_idaAnns`, `cfg`.

## Testen
```
CHROME_PATH=/pad/naar/chrome node test/run-all.mjs   # alle *check.mjs + unit.mjs, moet "alles OK" geven
node test/momentcheck.mjs                            # zonder browser
```
Playwright-core wordt gebruikt; `CHROME_PATH` naar een Chromium. Nightly data-archief: repo `glaszonderwater-rgb/Nightscout-data` (`data/entries`, `data/treatments`, `data/devicestatus`, `profiles.json`) — handig om op echte data te controleren.

## Rekenregels profiel (`aapsProfile` in core.js)
- Basaal per uur: 0,8 × nuchter geleverde insuline (temp + SMB), begrensd 0,7–1,5× huidig; bij >4% laag ≤0,85×; 1 uur vooruitgeschoven; blokken via `_segment` (max 8).
- ISF: mediaan van (profiel/autosens) en 100/TDD, grens −20%/+15%.
- KH-ratio: uit maaltijden (`mealCR`), 1–3 blokken, max ±20% **per huidig blok**. Vangrails: niet sterker bij >4% laag na eten, niet zwakker bij >30% hoog na eten.
  Niet sterker als na het eten >115% van de ingevoerde koolhydraten terugkomt — **tenzij** instelling "Ik tel nauwkeurig" (`cfg.carbsAccurate`) aan staat.

## Open punten / besluiten bij de gebruiker
1. **KH-ratio:** data (123% terug na eten) wijst op een sterkere ratio (4,5→3,6 en 5,0→4,0 met het vinkje aan). De gebruiker wilde na een hypo bij het avondeten juist een zwakkere. Die hypo past bij "bolus terwijl je al daalt" (22% vs 9% hypo). Niet zelf beslissen.
2. **Nieuw ontwerp nog niet gebouwd.** Definitief ontwerp (ronde 3): zwart op gebroken wit (#F6F5F2 / #141518), alleen glucose krijgt kleur (laag #C2361B, hoog #A86A12, bereik #2D7A4D), lettertype Geist met tabulaire cijfers, Geist Mono alleen voor tijden/tabellen. Geen kaart-in-kaart, haarlijnen, platte tabbalk op haarlijn.
   Tabs: Vandaag · Dag · (+) · Profiel · Team.
   - Vandaag: groot glucosegetal + 1 zin + IOB/COB-regel, grafiek 24 u, 3 kerncijfers (in bereik, laag, variatie), "Let op" met max 2 punten (moment-advies + vraag).
   - Dag: weekstaafjes (tijd in bereik), oordeel t.o.v. eigen gemiddelde, curve met genummerde momenten → detail met "volgende keer".
   - Profiel: 24-uursliniaal (waar het misgaat / basaal / ISF / KH), lijst wijzigingen, lopende meting, "Overnemen in AAPS" stap voor stap met afvinken en totaalcontrole.
   - Vastleggen: lijst (sport, alcohol met aantal, ziek, stress, pen), wanneer, opslaan als Nightscout-notitie.
   - Melding op vergrendelscherm vóór het moment.
   Het ontwerp-canvas staat als privé artefact op het oorspronkelijke account.
3. **Meldingenserver LIVE (19 nov 2026):** Railway-project `empathetic-clarity`, service `dbDash` (root `/server`), https://dbdash-production.up.railway.app (`/status`). Supabase-project `ida` (avvznjndzfzrsopizcgl, eu-west-1, gratis), tabellen aangemaakt. Nightscout-onderwerp `ida-server` (readable). Telefoon nog aanmelden via IDA › Instellingen › Meldingen. Eerder plan: Plan: Railway (root `server/`, `railway.json`) + Supabase (`server/supabase.sql`). **Draaiboek: `DEPLOY.md`** (stap voor stap, ook voor de Chrome-extensie). Sleutels maken: `tools/vapid.html`. Controle: `GET /status`, testmelding via IDA › Instellingen. `server/moments.cjs` is een kopie van `js/moments.js` en moet gelijk blijven (momentcheck bewaakt dat).
4. Bekende beperking: `riseCarbEstimate` telt tijdelijke basaalverhogingen niet mee.

## Werkwijze
- Commit-berichten in het Nederlands; release = `sw.js` VERSION ophogen, tests draaien, pushen naar `main`.
- Na wijzigingen controleren op echte data uit het archief.
