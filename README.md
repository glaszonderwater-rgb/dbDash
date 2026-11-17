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
- De app doet **read-only** verzoeken aan je eigen Nightscout. Er gaat niets naar een
  andere server. **Enige uitzondering:** het tabblad **Import** (NEVO → Nightscout)
  schrijft naar je voedseldatabase. Dat gebruikt een eigen token met schrijfrechten
  dat je daar invult, nooit wordt opgeslagen en bij sluiten verdwijnt. Het
  Excel-leesprogramma voor .xlsx wordt alleen op dat moment van cdnjs geladen (CSV werkt offline).

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

## Tabbladen

- **Import** — NEVO-voedingsmiddelen naar de voedseldatabase van Nightscout (voor AAPS).
- **Eten → Laad NEVO-producten** — leest die database (alleen lezen) en voegt de producten toe aan de koolhydraat-schatter.
- **Analyses → Lunchtijd** — verdeling van lunchtijd, dagen zonder lunch en glucose na late lunch.

## Gegevenskwaliteit

- **Meetinterval:** bronnen die elke minuut leveren (xDrip+ met Libre) worden per 5 minuten gemiddeld, zodat alle analyses dezelfde 288 slots per dag gebruiken.
- **Loop-gaten:** voor closed loop slaat de app dagen over waarop de loop minder dan 30% van de gewone activiteit had (telefoon of AAPS uit). Ze staan als "loop uit" in de periodebalk; uitschakelen kan in het tandwiel.
- **Strak bereik:** naast tijd in bereik (3,9–10) toont de app 3,9–7,8 als tweede maat.

## Voorstellen, vangrails en effectmeting
- **Analyses**: maandtrend, uurtabel (spreiding, % <3,9 / >10, hypo-starts per uur), KH-schatting per dagdeel en maaltijdgeheugen (jouw eigen uitkomst per product).
- **Vangrails** op de bespreekwaarden: laagtes eerst (geen insuline-verhogend voorstel in een dagdeel met >4% <3,9 of ≥1% <3,0), min. 14 dekkende dagen, één wijziging per dagdeel, waarschuwing bij stappen >10%.
- **Besluiten**: accepteren / aanpassen / afwijzen. Accepteren legt een "wijziging" vast; 14 dagen later staat de meting onder *Effect van doorgevoerde wijzigingen* (verbeterd · gelijk · verslechterd · onduidelijk, met aparte veiligheidscheck <3,0).
- De app schrijft nooit naar AAPS of je pomp. Een periodevergelijking is geen herhaling van het oref1-algoritme en bewijst geen oorzaak.
- **Koppellink**: Instellingen → "Kopieer koppellink" zet adres+token in één keer op een ander apparaat.
