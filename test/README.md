# Tests (alleen voor ontwikkeling)

Playwright-tests tegen een **gemockte Nightscout** (route-interceptie) — er is geen
echte site of echt token nodig, en er gaat niets naar buiten. De app zelf blijft
één bestand (`../index.html`); deze map doet niet mee in de uitlevering.

## Draaien
```bash
npm i playwright-core          # eenmalig (of zet NODE_PATH naar een bestaande installatie)
mkdir -p /tmp/diametric-tests  # screenshots/uitvoer
node test/verify_v21.mjs       # kernregressie
```
Het Chromium-pad staat bovenin elk script (`EXE`) — pas aan naar je eigen
Playwright-browserinstallatie.

## Overzicht
- `verify_v21` — kernregressie · `synthcheck` — tijdlijn, bevindingen, consultlijst-triage
- `propcheck` — bespreekwaarden per dagdeel (behoudend + gemeten, effect, hypo-risicovlag, celtoestanden ✓/—/→, ISF+basaal)
- `smbcheck` — SMB-herkenning via type:"SMB" (AAPS/Omnipod)
- `mealrescuecheck` — koolhydraten zónder bolus (hypo-redding) tellen niet als maaltijd
- `weekcheck` — "Deze week" valt nooit leeg terug (fallback bij een closed loop zonder patronen)
- `prebocheck` — prebolus-timing telt alleen je handmatige bolus, geen SMB vóór de maaltijd
- `peakcheck` — gemeten piektijd (steilste daling) ligt binnen band van het model
- `loopcheck` — loop-basaal: temp-basaal vs. profiel per uur (closed loop)
- `bwloopcheck` — basaal-bespreekwaarde vult zich uit loop-basaal (looper zonder drift)
- `pwacheck` — PWA: manifest geldig (standalone + maskable icoon), service worker bestuurt de pagina, offline herladen werkt (eigen mini-http-server, want SW registreert niet vanaf `file://`)
- `whycheck` — "waarom"-motor: reconstrueert de oorzaak van een nacht-hypo (SMB-stapeling) met bewijs (actieve insuline, daalsnelheid) en telt de oorzaken over de week op
- `carbcheck` — koolhydraat-schatter: zoek eten → portie → gram KH (banaan 25 g, cola-blikje 36 g), bord-totaal en vastleggen als maaltijd in het logboek
- `patterncheck` — circadiane & context-patronen (referentie T1D-methoden §4/§5): dawn-fenomeen (nuchtere ochtendstijging) verschijnt als week-bevinding en vertaalt mee; Somogyi-rebound (nachtelijke laagte → ochtendhyper) en verlate hypo ná een "sport"-markering worden herkend — allemaal observatie, geen dosisadvies
- `spikecheck` — "waarom"-motor voor pieken: herkent een te late bolus (geen prebolus) als oorzaak van hoge maaltijdpieken en telt de oorzaken op
- `fatcheck` — vette/eiwitrijke maaltijden: bij selectie van een vet product (pizza) verschijnt een korte inline bolus-tip (vet-eiwit-eenheden + doorwerkingsduur + verlengen); bij een niet-vet product (banaan) geen tip
- `mecheck` — "Zo reageert jóuw lijf": de Eten-tab toont bovenaan de gemeten maaltijdrespons uit eigen data (piektijd, prebolus-timing, koolhydraat-kalibratie met n= en "geen dosisadvies"); bij te weinig maaltijden (n<8) een nette fallback naar de tabelwaarden
- `homecheck` — Companion-home: begroeting, status-ring (waarde + arc), snelacties (Koolhydraten → Eten-tab), 4 kerncijfer-tegels, Nu-balk verborgen op de home
- `navcheck` — navigatie: onderbalk met 4 tabs (icoon + label, volgorde Overzicht/Eten/Analyses/Consult), Eten-tab opent de werkende schatter, dagcurve is een ingeklapte fold, Analyses staat op gebruiksvolgorde (Maaltijden/Veiligheid bovenaan)
- `logcheck` / `exportcheck` — logboek, voor/na, back-up round-trip
- `awcheck` / `hypodef` — hypo-gevoel; episode/dip/sensordruk-classificatie
- `pcheck` / `insulincheck` / `iobcheck` / `dscheck` — profiel, insulinetype, IOB/COB, devicestatus
- `reportcheck` / `watchcheck` / `daycheck` / `foldcheck` / `tabcheck` / `themecheck` — rapport, signalen, dag-detail, lay-out, thema
- `navshot` / `shot_redesign` — screenshots licht/donker · `perf` — rekentijd-meting
- `langcheck` — talen (nl · en · pt): de taalschakelaar vertaalt de vaste UI én dynamische analyse-tekst, zet `html lang`, wisselt het decimaalteken (Engels punt, NL/PT komma), vertaalt productnamen in de schatter (en matcht Engels/PT zoeken) en keert schoon terug naar Nederlands
- `a11ycheck` — toegankelijkheid: verbindingsstatus en toast zijn aria-live-regio's, instellingen-knop heeft een label, reduced-motion- en summary-focus-regels aanwezig, chip-tap-hoogte ≥ 34px
