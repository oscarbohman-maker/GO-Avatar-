# Plain Dodge! ✈️🧭

Ett samarbetsspel för två i webbläsaren, byggt för Safari på iPhone, iPad och Mac. Det fungerar också i alla moderna webbläsare. Spelet är på engelska.

- **Piloten** sitter i cockpiten och flyger i förstaperson genom tät dimma, med bara cirka 44 m sikt.
- **Navigatören** sitter med i planet (helskärm, utan dimma) och ser långt framåt. En liten minikarta visar närmaste hindren. Man kan inte planera hela rutten i förväg, utan måste ropa i tid: "vänster, snabbt!". Sidopanelen har ikonknappar för att visa/dölja kartan, zooma, byta till yttre kamera och visa/dölja vägledningen.

Båda figurerna syns i cockpiten. Pilotens händer följer ratten och gasreglagen, och kompisen pekar och trycker på knappar.

## Spellägen

- **Free Play:** 20 kartor som blir svårare och svårare. Välj en karta och sedan en roll:
  - **Pilot:** flyg blint, och en NPC-navigator pratar (engelsk röst), pekar och guidar dig.
  - **Navigator:** du ser allt och styr en blind AI-pilot. Håll **←/→** (knappar eller tangenter) för att svänga och **Shift** för att bromsa. Den håller höjden själv.
  - **Solo:** flyg själv med en liten karta i hörnet.
- **Play with Friends:** den ena trycker *Create game* och får en **ny kod med 6 tecken för varje party**. Den andra skriver in koden eller öppnar länken från *Share link*. Koden gäller i **24 timmar** och behålls om värden tappar anslutningen en stund. Om nätverken blockerar en direktanslutning (vanligt på olika mobilnät) går speldatan automatiskt via ett offentligt relä (MQTT över wss: broker.emqx.io eller broker.hivemq.com). Röstchatten fungerar då inte, så ring varandra i stället.
- **Settings:** namn, invertera upp/ner, styrkänslighet, pekskärmskontroller (Auto/On/Off), ljudeffekter och NPC-röst.

## Kartorna

Kartorna är ordnade i sju världar, och varje värld har sin egen miljö, sina egna färger och sitt eget väder. *Canyon Loop* och *Training Flight* är handgjorda övningsbanor. Kartorna 3–20 byggs av faser längs en slingrande korridor:

| Kartor | Värld | Miljö och väder |
| --- | --- | --- |
| 1–2 | Training | övningskanjon och öppen äng |
| 3–5 | Forest | granväggar, slalom, upp och ner, väggar med hål; klart väder och bris |
| 6–8 | Desert | sandstensmesor, kaktusar, sanddyner; het vind och sandstorm |
| 9–11 | Jungle | tät lövskog, buskar, tempelväggar; regn och åskstorm |
| 12–14 | Red Rock | röda klippor, stenblock, stenras; vindbyar |
| 15–17 | Arctic | isväggar, snödrivor, isblock; snöfall och snöstorm |
| 18–20 | Lava | basalt, glödande lavasprickor och lavapölar, glödande lavabomber; eldregn och utbrott med blixtar |

Svårigheten visas med 1–5 pluppar: Easy, Normal, Medium, Hard och Extreme.

Ju högre nummer, desto fler portar och hinder, smalare korridor, skarpare svängar, större höjdskillnader, mindre hål, lägre tak, snabbare stenras och starkare vind. Fallande stenar syns som röda ringar på radarn och fylls när stenen är nere vid planets höjd. NPC-navigatören ropar "Rock ahead!" och "Falling rocks!".

**Free Play** visar världarna med rubrik, och varje karta har ett kort med en miniatyrbild, svårighetspluppar, väder och ditt rekord. Väljer man en karta öppnas en detaljvy med stor bild, antal portar och stjärnor, banans längd, hindertyper och ditt rekord, och där väljer man roll. Lobbyn i *Play with Friends* använder samma kort.

Miniatyrbilderna (`img/maps/*.jpg`) renderas med spelets egen 3D-motor. Om banorna ändras skapar man nya bilder så här: starta en webbserver (`python3 -m http.server 8080`) och kör `node tools/render-thumbs.cjs`, vilket kräver Playwright. Sidan `tools/thumbs.html` visar alla bilder.

Kartorna är seedade, så båda spelarna får exakt samma bana. Varje karta har en förvald variant som testerna har flugit igenom, både med en skicklig pilot och med en blind pilot som bara följer NPC:ns röstorder.

## Regler och poäng

- Flyg genom ringarna i ordning. Man kan alltid flyga igenom ringar och stjärnor.
- **Poäng:** ring +100, **Perfect** (inom 40 % av ringens radie) +250, stjärna +50. I mål får man en tidsbonus på 25 poäng per sekund under banans par-tid.
- **Combo:** ringar i rad utan miss eller krasch höjer ringpoängen: 3 i rad ×1,5, 5 i rad ×2 och 8 i rad ×3. Varje ring ger ett färgglatt pop-up-kort (blått för vanlig ring, guld för Perfect, grönt och lila för combo) och en kantblixt, och ringen skjuter ut en ljusvåg i 3D. Tonen stiger för varje ring i rad, och en combo-mätare i HUD:en visar hur nära nästa nivå man är.
- **Kraschar man börjar man om från starten.** Planet tumlar först, sedan nollställs portar, stjärnor, poäng och tid.
- **Kraschen beror på vad man träffar:** mark ger eldklot, brand och brännmärke. En klippa eller kanjonvägg ger en kraftig smäll med stoft och stenskärvor. Ett träd får löv och grenar att yra, och ger lite rök och en liten explosion. En vägg eller tunnel ger betongdamm, gnistor, brand och väggbitar som faller ned. Effekten startar vid kontaktpunkten, och skräpet flyger i fartens riktning. Den del som träffar (vinge, nos, stjärt) lossnar, och vid en hård frontal träff slås hela planet sönder. Storlek, ljusblixt och kameraskak skalas med fart och träffvinkel.
- Missad port: +5 s på tiden.
- Rekordet per karta är högsta poäng, och det sparas lokalt i webbläsaren utan konto.

**På mobil och små skärmar** blir spelvyn kompakt, så att man ser så mycket som möjligt av banan. Tid, port, poäng och stjärnor visas i en smal rad med ikoner, och fart och höjd i en liten rad längst ned. Röst, omstart och avsluta ligger bakom ⋯-knappen. Styrspaken och BOOST/BRAKE är mindre och genomskinliga. Navigatörens order visas på en rad längst ned och bleknar bort. Belöningar och combo visas som små, korta popups högt upp, så att de inte skymmer vägen.

**Styrning för piloten:** W/S eller ↑/↓ för upp/ner, A/D eller ←/→ för att banka och svänga, Mellanslag för gas, Shift för broms och Q/E för att titta runt. På mobil finns en styrspak till vänster och knappar till höger, och man drar på högra delen av skärmen för att titta runt.

## Fysik

- Planet svänger genom att banka (koordinerad sväng). Högre fart ger större svängradie, så det lönar sig att bromsa före skarpa svängar.
- Styrningen är lugn och förlåtande, och höjden ändras långsamt. Spelet handlar mest om höger och vänster.
- Hela planet kan krocka: kroppen, nosen, stjärten och vingspetsarna (13 m vingbredd).
- Figurernas kroppar hänger i dämpade fjädrar och reagerar på G-krafter. Armar och ben styrs med invers kinematik (IK).

## Publicera (GitHub Pages)

Spelet består bara av statiska filer. Gå till **Settings → Pages → Deploy from a branch**, välj branchen och `/ (root)`. Röstchatten kräver https, vilket GitHub Pages ger automatiskt.

## Teknik

| Del | Lösning |
|---|---|
| 3D | [three.js](https://threejs.org) r170 (`js/lib/`). Flygplan och cockpit är överförda exakt från `reference/models.js`. En sluten kabin är tillagd i `rig.js`. |
| Online | WebRTC peer-to-peer via [PeerJS](https://peerjs.com) 1.5.4. Spelkoden blir ett peer-id på PeerJS gratis signalserver. |
| Relä | Reservväg när WebRTC blockeras: [MQTT.js](https://github.com/mqttjs/MQTT.js) 5.10.1 (`js/lib/`) mot offentliga MQTT-servrar |
| Röst | WebRTC-ljud över samma anslutning |
| Sparning | `localStorage` (profil, inställningar, historik, rekord, värdens kod i 24 h) |

### Filer

```
index.html        Alla skärmar (start, free play, vänner, inställningar, lobby, spel)
css/style.css     Blått tema, knappar, kartkort, animationer
js/main.js        Menyer, lägen, lobby, nätverksmeddelanden, HUD, resultat
js/net.js         Anslutning med 6-teckenskod som går ut efter 24 h
js/relay.js       Reservväg via MQTT-relä när direktanslutningen blockeras
js/voice.js       Röstchatt
js/levels.js      Kartlistan (20 platser) och banorna
js/themes.js      Världarnas teman (färger, ljus, dekor) och väder
js/physics.js     Flygmodell och kollisioner
js/sim.js         Spelregler: poäng, perfect, stjärnor, krasch → omstart, mål
js/crashfx.js     Kraschens effekter per hindertyp (partikelpool, skrot, brännmärke, blixt)
js/npc.js         NPC-navigatören (hinderkoll, kommandon, gester, röst)
js/aipilot.js     AI-piloten som lyder navigatörens pilknappar
js/models.js      Flygplan och cockpit (från reference/models.js)
js/avatar.js      Figurerna: ansikte, kläder, IK och fjädrar
js/rig.js         Planet i världen: cockpit, kabinskal, figurer, instrument
js/world3d.js     3D-världen per tema: mark, väggar, dekor, väder, dimma och stjärnor
js/view3d.js      Kameror (cockpit, bakifrån, runtom)
js/pilot.js       Pilotens vy
js/nav3d.js       Navigatörens cockpitfönster
js/radar.js       Navigatörens radar
js/input.js       Tangentbord och pekskärm
js/storage.js     Profil, inställningar och rekord
js/sfx.js         Ljudeffekter
tests/            Automatiska test
img/maps/         Kartornas miniatyrbilder
tools/            Verktyg för att rendera miniatyrbilderna
```

### Test

```bash
npm test
```

Testerna kontrollerar bland annat följande:

- **Banorna:** autopiloten klarar dem utan krasch, och NPC-navigatören guidar en blind pilot igenom. Det gäller alla 20 kartor, och kartorna 3–20 kontrolleras också för att vara deterministiska och bli svårare.
- **Navigatörsläget:** en navigatör kan styra AI-piloten genom kanjonen med bara ←/→.
- **Regler och poäng:** krasch ger omstart, och ringar ger poäng (mest för Perfect).
- **Modellerna och figurerna:** de har alla namngivna delar, och händerna sitter kvar på ratten.
