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
- `smbcheck` — SMB-herkenning (varianten) + diagnose-blokje in de Insuline-sectie
- `logcheck` / `exportcheck` — logboek, voor/na, back-up round-trip
- `awcheck` / `hypodef` — hypo-gevoel; episode/dip/sensordruk-classificatie
- `pcheck` / `insulincheck` / `iobcheck` / `dscheck` — profiel, insulinetype, IOB/COB, devicestatus
- `reportcheck` / `watchcheck` / `daycheck` / `foldcheck` / `tabcheck` / `themecheck` — rapport, signalen, dag-detail, lay-out, thema
- `navshot` / `shot_redesign` — screenshots licht/donker · `perf` — rekentijd-meting
