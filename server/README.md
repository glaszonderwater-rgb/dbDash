# IDA meldingenserver

Stuurt een melding vóór het moment, ook als IDA dicht is. Bijvoorbeeld:

- **Avondeten: bolus pas bij de eerste hap.** Je zit in jouw vaste eettijd, er is nog niets gegeten en je daalt al onder 7.
- **Gestegen naar 13,8 zonder eten. Wat at je?** Een stijging van minstens 3 mmol/L tot boven 10, zonder gelogde koolhydraten.

De server gebruikt dezelfde regels als de app (`js/moments.js`), leest Nightscout alleen en geeft nooit een dosis.
De inhoud van een melding is versleuteld tussen server en telefoon (Web Push).

## Stap 1 · Sleutels maken (eenmalig)

```
npx web-push generate-vapid-keys
```

Je krijgt een publieke en een geheime sleutel. De publieke sleutel vul je in IDA in (Instellingen › Meldingen). De geheime sleutel deel je met niemand.

## Stap 2 · Kies hoe hij draait

### A · Gratis met GitHub Actions (geen eigen server)

1. Zet in deze repo onder *Settings › Secrets and variables › Actions* deze geheimen:
   `NS_URL`, `NS_TOKEN` (alleen leesrechten), `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT` (`mailto:jouw@adres`).
2. Zet in IDA *Meldingen aan*, vul de publieke sleutel in en tik **Aanmelden en aanmelding kopiëren**.
3. Plak wat gekopieerd is als geheim `PUSH_SUBSCRIPTIONS` (meerdere telefoons: zet ze in een lijst `[ {...}, {...} ]`).
4. De workflow *IDA meldingen* draait elke 10 minuten. Test hem met *Run workflow*.

Let op: GitHub start geplande taken soms 5–20 minuten later, en zet ze stil na 60 dagen zonder activiteit in de repo.

### B · Railway + Supabase (aanrader: elke 5 minuten, blijft bewaard)

1. **Supabase:** maak een project, open *SQL Editor* en voer `server/supabase.sql` uit. Noteer onder *Project Settings › API* de *Project URL* en de *service_role*-sleutel (geheim; nooit in de app of in een chat).
2. **Railway:** *New Project › Deploy from GitHub repo* › `dbDash`. Zet bij de service *Settings › Root Directory* op `server`. Railway leest `server/railway.json` en start `node push.mjs --serve`.
3. Zet bij *Variables*: `NS_URL`, `NS_TOKEN` (alleen lezen), `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT`, `SUBSCRIBE_PATH` (lang willekeurig woord), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Maak onder *Settings › Networking* een publiek domein aan.
5. In IDA › Instellingen › Meldingen: server `https://<jouw-railway-domein>/<SUBSCRIBE_PATH>`, publieke sleutel = `VAPID_PUBLIC`, vink *Meldingen aan* en tik **Aanmelden**.

Supabase bewaart alleen de aanmelding van je telefoon en welke meldingen al verstuurd zijn, geen glucosewaarden.

### C · Eigen server zonder Supabase

Op een kleine server met Node 20 (bijvoorbeeld een gratis Fly.io-, Render- of Raspberry Pi-machine):

```
cd server && npm install
NS_URL=… NS_TOKEN=… VAPID_PUBLIC=… VAPID_PRIVATE=… VAPID_SUBJECT=mailto:… \
SUBSCRIBE_PATH=<lang-willekeurig-woord> PORT=8787 node push.mjs --serve
```

Vul in IDA als meldingenserver `https://jouw-server/<SUBSCRIBE_PATH>` in. Tik dan **Aanmelden**: de telefoon meldt zich zelf aan.
Zonder het juiste `SUBSCRIBE_PATH` kan niemand anders zich aanmelden voor jouw meldingen.

## Op de telefoon

- Android (Chrome): werkt met IDA vanaf het startscherm of in de browser.
- iPhone: alleen als IDA op het beginscherm staat (iOS 16.4 of nieuwer).
