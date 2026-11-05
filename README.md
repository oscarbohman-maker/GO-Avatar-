# Blindflyg ✈️🧭

Ett samarbetsspel för två i webbläsaren (byggt för Safari på iPhone, iPad och Mac, men funkar i alla moderna webbläsare).

- **Piloten** sitter i vänster stol i cockpiten och flyger planet i förstaperson, men ser bara en bit framåt. Längre bort är allt mörkt.
- **Navigatören** sitter i höger stol, ser en radar med alla hinder och portar och guidar piloten med rösten och med gester.

Båda ser sina egna armar, ben och kropp och kompisens kropp i cockpiten. Pilotens händer följer ratten och gasreglagen. Kompisen pekar när navigatören ger en gest och trycker på knappar i taket när navigatören ritar ut rutten.

Flyg genom portarna i rätt ordning, förbi träd, klippor, en kanjon, ett hål i en vägg och en tunnel. En krasch kostar +3 s och en missad port +5 s.

## Spela

1. Öppna sidan. Den ena trycker **Skapa spel** och får en kod med fyra tecken.
2. Den andra skriver in koden och trycker **Gå med**, eller öppnar länken från **Dela länk**.
3. Värden väljer roller (⇄ Byt roller) och trycker **Starta flygning**.
4. Navigatören studerar kartan, kan trycka ut egna ruttpunkter och trycker sedan **Starta flygningen**.
5. Prata med varandra med **🎤 Röst** (beta) eller ring varandra.

Inget konto behövs. Namn, rekord och historik sparas lokalt i webbläsaren.

**Styrning för piloten:** W/S eller ↑/↓ för upp/ner, A/D eller ←/→ för att banka och svänga, Mellanslag för gas och Shift för broms. Håll Q/E för att titta åt vänster/höger (R för att titta upp). På mobil och surfplatta finns en styrspak till vänster, knappar till höger, och man drar på högra delen av skärmen för att titta runt.

**Navigatören** har pilknapparna ← ↑ ↓ →. Då pekar kompisen i cockpiten och piloten ser en pil. Rutten som navigatören ritar syns för piloten som svaga lysande prickar när den är nära. Navigatören har också ett litet cockpitfönster (🎥) som kan visa planet utifrån.

## Fysik

- Planet svänger genom att banka, som ett riktigt plan (koordinerad sväng). Högre fart ger större svängradie, så det lönar sig att bromsa före skarpa svängar.
- Rollen och tippningen har tröghet, och nosen planar ut av sig själv.
- Stigning kostar fart och dykning ger fart. I branta svängar tappar planet höjd om man inte drar upp.
- Lätt turbulens skakar planet.
- Hela planet kan krocka: kroppen, nosen, stjärten och vingspetsarna (13 m vingbredd).
- Efter en krasch studsar och tumlar planet, och kameran visar det utifrån innan man startar om vid senaste porten.
- Figurernas överkroppar och huvuden hänger i fjädrar som reagerar på G-krafter, gaspådrag, svängar och skakningar. Armar och ben styrs med invers kinematik (IK).

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
| 3D | [three.js](https://threejs.org) r170 (ligger i `js/lib/`). Flygplan och cockpit är överförda exakt från `reference/models.js`. |
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
js/sim.js         Spelregler: nedräkning, portar, krasch/tumling, straff, mål
js/models.js      Flygplan och cockpit (från reference/models.js)
js/avatar.js      Figurerna: IK för armar och ben, fjädrar för kropp och huvud
js/rig.js         Planet i världen: cockpit, figurer, rattar, gasreglage, instrument
js/world3d.js     Banans 3D-värld och ruttprickarna
js/view3d.js      Kameror: cockpit, bakifrån (nedräkning/krasch), runtom (väntan)
js/pilot.js       Pilotens vy (fysik + 3D)
js/nav3d.js       Navigatörens cockpitfönster med mjuk interpolation
js/radar.js       Navigatörens radar, höjdmätare och ruttplanering
js/input.js       Tangentbord och styrspak på pekskärm
js/storage.js     Lokal profil, historik och rekord
js/sfx.js         Ljudeffekter (WebAudio)
tests/            Automatiska test av banan och reglerna
```

### Test

```bash
npm test
```

Testerna kontrollerar bland annat att en autopilot klarar demobanan utan krasch med den nya fysiken, att inga hinder står i portarna, att banan blir identisk för båda spelarna, att modellerna har alla namngivna delar, att IK håller benlängderna och att pilotens händer sitter kvar på ratten när den rör sig.

### Lokal utveckling

```bash
python3 -m http.server 8080
```

Öppna sedan `http://localhost:8080`. Vill du använda en egen PeerJS-server kan du lägga till `?peerHost=localhost&peerPort=9000&peerPath=/bf&peerSecure=0` i adressen.
