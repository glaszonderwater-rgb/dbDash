# dbdash

Persoonlijk diabetes-dashboard voor eigen analyse van [Nightscout](https://nightscout.github.io/)-data
(AndroidAPS). Eén self-contained HTML-bestand — glucose altijd in **mmol/L**.

## Privacy

- **Geen data in dit bestand.** `index.html` bevat alleen de app-code (incl. een
  ingebakken Plotly). Er staan geen glucosewaarden, geen Nightscout-URL en geen token in.
- Je **Nightscout-adres en token** worden in je browser opgeslagen (`localStorage`),
  je **opgehaalde data** in `IndexedDB`. Beide blijven op jouw apparaat.
- De app doet uitsluitend **read-only** verzoeken aan je eigen Nightscout. Er gaat
  niets naar een andere server.

## Gebruik

Open `index.html` in een browser (dubbelklikken vanaf schijf werkt ook), klik op ⚙,
en vul je Nightscout-adres + een token met alléén de rol `readable` in. Gebruik nooit
je `API_SECRET` — dit dashboard hoeft nooit te schrijven.

## Let op

Dit is een persoonlijk analysehulpmiddel. De bevindingen zijn observaties, geen
insteladviezen. Wat je met een patroon doet, bespreek je met je behandelteam.
