# DiaMetric

Persoonlijk diabetes-dashboard voor eigen analyse van [Nightscout](https://nightscout.github.io/)-data
(AndroidAPS). Self-contained HTML zonder build — glucose altijd in **mmol/L**.

## Installeren (PWA)

De app is een **Progressive Web App**: open hem in de browser en kies
*"Toevoegen aan startscherm"* (of *Installeren*). Je krijgt dan een eigen icoon,
opent fullscreen zonder browserbalk en de app blijft **offline** werken (de
service worker cachet de app-schil). Installeren kan alleen via een `https`-adres
zoals GitHub Pages — vanaf een los bestand op schijf werkt de app wél, maar zonder
installatie/offline-cache.

## Privacy

- **Geen data in dit bestand.** `index.html` bevat alleen de app-code. Er staan
  geen glucosewaarden, geen Nightscout-URL en geen token in.
- **De service worker (`sw.js`) bewaart alleen de app-schil** (`index.html`,
  `manifest.json`, `icon.svg`) voor offline gebruik. Verzoeken naar je Nightscout
  worden nooit onderschept of gecachet — die gaan altijd live.
- Je **Nightscout-adres en token** worden in je browser opgeslagen (`localStorage`),
  je **opgehaalde data** in `IndexedDB`. Beide blijven op jouw apparaat.
- De app doet uitsluitend **read-only** verzoeken aan je eigen Nightscout. Er gaat
  niets naar een andere server.

## Gebruik

Open de app, klik op ⚙, en vul je Nightscout-adres + een token met alléén de rol
`readable` in. Gebruik nooit je `API_SECRET` — dit dashboard hoeft nooit te schrijven.

## Hosting

De app is één statisch bestand zonder build en draait op **GitHub Pages**
(Settings → Pages → Deploy from a branch → `main` / `/root`). Omdat het geen
Jekyll-verwerking nodig heeft, staat er een leeg `.nojekyll`-bestand in de
hoofdmap. Je kunt `index.html` ook lokaal openen of op elke andere statische
host zetten.

## Let op

Dit is een persoonlijk analysehulpmiddel. De bevindingen zijn observaties, geen
insteladviezen. Wat je met een patroon doet, bespreek je met je behandelteam.
