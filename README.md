# Blindflyg ✈️🧭

Ett samarbetsspel för två i webbläsaren (byggt för Safari på iPhone, iPad och Mac, men funkar i alla moderna webbläsare).

- **Piloten** flyger planet i förstaperson men ser bara en bit framåt. Längre bort är allt mörkt.
- **Navigatören** ser en radar med alla hinder och portar och guidar piloten med rösten.

Flyg genom portarna i rätt ordning, förbi träd, klippor, en kanjon, ett hål i en vägg och en tunnel. En krasch kostar +3 s och en missad port +5 s.

## Spela

1. Öppna sidan. Den ena trycker **Skapa spel** och får en kod med fyra tecken.
2. Den andra skriver in koden och trycker **Gå med**, eller öppnar länken från **Dela länk**.
3. Värden väljer roller (⇄ Byt roller) och trycker **Starta flygning**.
4. Navigatören studerar kartan, kan trycka ut egna ruttpunkter och trycker sedan **Starta flygningen**.
5. Prata med varandra med **🎤 Röst** (beta) eller ring varandra.

Inget konto behövs. Namn, rekord och historik sparas lokalt i webbläsaren.

**Styrning för piloten:** W/S eller ↑/↓ för upp/ner, A/D eller ←/→ för att svänga, Mellanslag för boost och Shift för broms. På mobil och surfplatta finns en styrspak till vänster och knappar till höger.

**Testa solo** startar piloten med en liten radar i hörnet, så att en person kan prova banan.

## Publicera (gratis med GitHub Pages)

Spelet består bara av statiska filer, så ingen server behövs.

1. Gå till repot på GitHub, sedan **Settings → Pages**.
2. Under *Build and deployment* väljer du **Deploy from a branch**, sedan branchen och mappen `/ (root)`.
3. Efter någon minut ligger spelet på `https://<användarnamn>.github.io/<repo>/`.

Röstchatten kräver https, vilket GitHub Pages ger automatiskt.

## Teknik

| Del | Lösning |
|---|---|
| 3D | [three.js](https://threejs.org) r170 (ligger i `js/lib/`) |
| Online | WebRTC peer-to-peer via [PeerJS](https://peerjs.com) 1.5.4. Spelkoden blir ett peer-id på PeerJS gratis signalserver (`0.peerjs.com`), och sedan går all speldata direkt mellan spelarna. |
| Röst | WebRTC-ljud över samma peer-anslutning |
| Sparning | `localStorage` (namn, inställningar, de senaste 50 flygningarna, rekord per bana) |

Piloten kör spelets regler (flygmodell, kollisioner, portar och straff) och skickar planets läge till navigatören 20 gånger per sekund. Banorna genereras deterministiskt från ett frö, så båda spelarna får exakt samma bana utan att geometrin behöver skickas.

### Filer

```
index.html        Alla skärmar (start, lobby, spel)
css/style.css     Utseende, mobil först
js/main.js        Appflöde, lobby, nätverksmeddelanden, HUD, resultat
js/net.js         Anslutning med kod (PeerJS) och hjärtslag för att upptäcka avbrott
js/voice.js       Röstchatt
js/levels.js      Världar och banor (demobanan)
js/physics.js     Flygmodell och kollisioner (ren logik)
js/sim.js         Spelregler: nedräkning, portar, krasch, straff, mål
js/pilot.js       Pilotens 3D-vy (three.js)
js/radar.js       Navigatörens radar, höjdmätare och ruttplanering
js/input.js       Tangentbord och styrspak på pekskärm
js/storage.js     Lokal profil, historik och rekord
js/sfx.js         Ljudeffekter (WebAudio)
tests/            Automatiska test av banan och reglerna
```

### Test

```bash
node tests/sim.test.mjs
```

Testerna kontrollerar bland annat att en autopilot klarar demobanan utan krasch, att inga hinder står i portarna och att banan blir identisk för båda spelarna.

### Lokal utveckling

```bash
python3 -m http.server 8080
```

Öppna sedan `http://localhost:8080`. Vill du använda en egen PeerJS-server kan du lägga till `?peerHost=localhost&peerPort=9000&peerPath=/bf&peerSecure=0` i adressen.
