# IDA meldingenserver live zetten — draaiboek

Voor wie dit uitvoert (mens of assistent met de Chrome-extensie). Volg de stappen op volgorde en vink de controles af.
Duur: ± 20 minuten. Kosten: Supabase gratis; Railway het kleinste plan (de server gebruikt weinig).

**Wat er gebeurt:** de app blijft op GitHub Pages. Railway draait `server/push.mjs`, die elke 5 minuten Nightscout leest en een melding stuurt vóór het moment (bijv. "Avondeten: bolus pas bij de eerste hap"). Supabase bewaart alleen de aanmelding van de telefoon en welke meldingen al verstuurd zijn, geen glucosewaarden.

## Regels voor geheimen
- Geheimen (Nightscout-token, VAPID-geheim, Supabase-sleutel, geheim pad) gaan **alleen** in Railway › Variables.
- Nooit in een chat, in GitHub, in de app of in een notitie. Kopieer ze rechtstreeks van tabblad naar tabblad.
- Inloggen bij Nightscout, Supabase, Railway en GitHub doet de gebruiker zelf.

## Stap 1 · Sleutels maken
1. Open https://glaszonderwater-rgb.github.io/dbDash/tools/vapid.html (werkt volledig in de browser, verstuurt niets).
2. Klik **Maak sleutels**. Laat dit tabblad open: je hebt drie waarden nodig in stap 4.
   - Publieke sleutel → `VAPID_PUBLIC` (en later in IDA)
   - Geheime sleutel → `VAPID_PRIVATE`
   - Geheim pad → `SUBSCRIBE_PATH`

## Stap 2 · Nightscout-token met alleen leesrechten
1. Open Nightscout › menu › **Admin tools** (`<NS_URL>/admin`).
2. Bij *Subjects* › **Add new Subject**: naam `ida-server`, rol `readable`. Opslaan.
3. Kopieer het token dat bij `ida-server` verschijnt (begint met `ida-server-`). Dit wordt `NS_TOKEN`.
4. `NS_URL` is het adres van Nightscout zonder `/` aan het eind.
- [ ] Controle: `<NS_URL>/api/v1/entries.json?count=1&token=<NS_TOKEN>` toont één meting.

## Stap 3 · Supabase
1. https://supabase.com/dashboard › **New project** (naam `ida`, regio Europa, bijv. Frankfurt). Wacht tot het klaar is.
2. **SQL Editor** › New query › plak de inhoud van `server/supabase.sql` uit de repo › **Run**. Verwacht: "Success. No rows returned".
3. **Project Settings › API** (of *API Keys*):
   - *Project URL* → `SUPABASE_URL`
   - *service_role*-sleutel (of nieuwe *secret key*, `sb_secret_…`) → `SUPABASE_SERVICE_ROLE_KEY`. Nooit de publieke/anon-sleutel.
- [ ] Controle: in *Table Editor* staan `ida_push_subscriptions` en `ida_push_sent` (leeg).

## Stap 4 · Railway
1. https://railway.com › **New Project** › **Deploy from GitHub repo** › `glaszonderwater-rgb/dbDash` (GitHub-toegang geven indien gevraagd).
2. Open de service › **Settings**:
   - **Root Directory**: `server`
   - Build/Start worden gelezen uit `server/railway.json` (start: `node push.mjs --serve`).
3. **Variables** › voeg toe (Raw Editor mag):
   ```
   NS_URL=<stap 2>
   NS_TOKEN=<stap 2>
   VAPID_PUBLIC=<stap 1>
   VAPID_PRIVATE=<stap 1>
   VAPID_SUBJECT=mailto:<e-mailadres van de gebruiker>
   SUBSCRIBE_PATH=<stap 1>
   SUPABASE_URL=<stap 3>
   SUPABASE_SERVICE_ROLE_KEY=<stap 3>
   INTERVAL_MIN=5
   ```
4. **Settings › Networking › Generate Domain**. Noteer het adres, bijv. `https://ida-xxxx.up.railway.app`.
5. Wacht tot de deploy groen is (*Deployments*).
- [ ] Controle: `https://<railway-domein>/status` toont JSON met `"ok": true`, `"storage": "supabase"` en een recente `lastGlucose`.
  Staat er `lastError`, lees de melding: meestal een fout `NS_URL`/`NS_TOKEN` of Supabase-sleutel.

## Stap 5 · Telefoon aanmelden (op de telefoon zelf)
iPhone: IDA moet op het beginscherm staan (Safari › Deel › Zet op beginscherm) en van daaruit geopend worden. Android/Chrome: werkt direct.
1. Open IDA › Instellingen › **Meldingen vóór het moment**.
2. Vink **Meldingen aan**.
3. *Meldingenserver*: `https://<railway-domein>/<SUBSCRIBE_PATH>` (zonder `/` aan het eind).
4. *Publieke sleutel*: `VAPID_PUBLIC` uit stap 1.
5. Tik **Bewaren**, sta meldingen toe, tik daarna **Stuur testmelding**.
- [ ] Controle: binnen enkele seconden komt "IDA · Testmelding: meldingen werken." en in Supabase staat één rij in `ida_push_subscriptions`.
- [ ] Controle: `/status` toont `"subscriptions": 1`.

## Klaar
Sluit het tabblad met de sleutels. Vanaf nu controleert de server elke 5 minuten. Meldingen komen alleen bij een nieuw moment en nooit dubbel.

## Problemen
| Wat je ziet | Oorzaak / oplossing |
|---|---|
| `/status` → `Nightscout …: 401` | `NS_TOKEN` onjuist of zonder leesrechten (stap 2). |
| `/status` → `Supabase …: 401/403` | Verkeerde sleutel: gebruik de service_role/secret key, niet de anon key. |
| `/status` → `Supabase …: 404` | SQL uit stap 3 niet uitgevoerd. |
| Testmelding: "Server bereikt, maar geen apparaat" | Aanmelding mislukt: controleer de publieke sleutel in IDA = `VAPID_PUBLIC`, en meldingen toegestaan. |
| "Server: 404" bij testmelding | Pad in IDA klopt niet met `SUBSCRIBE_PATH`. |
| Geen enkele melding op iPhone | IDA niet vanaf het beginscherm geopend, of iOS ouder dan 16.4. |
| GitHub Actions *IDA meldingen* draait ook | Doet niets zonder GitHub-geheimen; mag blijven of uitgezet worden (Actions › workflow › Disable). |
