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

**Cutscene vid starten:** varje gång man startar en bana spelas en kort filmisk intro på cirka 8 sekunder, med svarta filmremsor upptill och nedtill och en Skip-knapp. Varje värld har sin egen händelse som planet flyger igenom:

| Värld | Händelse |
| --- | --- |
| Träning | Planet gör en barrel roll |
| Skog | En fågelflock flyger i formation bredvid planet |
| Öken | En sandstorm sluter sig runt planet |
| Djungel | Blixtnedslag och åska i monsunen |
| Röda klippor | Stenblock rasar ner bredvid planet, med dammoln och skakningar |
| Arktis | En snöstorm blir till en vit vägg som planet flyger in i |
| Lava | Ett vulkanutbrott med glödande lavabomber, rött sken och skakningar |

Det finns två kameravinklar:
1. En kamera följer planet snett bakifrån medan händelsen pågår och kartans namn, värld, svårighet och väder visas.
2. En dashcam från instrumentbrädan visar besättningen. Navigatören och piloten säger varsin filmisk replik om just den världen, till exempel *"Whiteout ahead. The only way through is that pass — and it is closing fast."* – *"Then we don't slow down. Hold on!"*

Sedan klipper bilden tillbaka till följekameran, som mjukt glider bakom planet och in i cockpit under nedräkningen. Planet flyger hela tiden in mot startlinjen och når den precis på GO. Med en vän spelar båda cutscenen samtidigt. Efter en krasch, eller med Restart, börjar man om utan cutscene, men planet flyger fortfarande in under nedräkningen.

**Utan hack:** när banan laddas förbereds allt som annars kompileras eller laddas upp första gången det syns, till exempel cockpit, skinet, glöden, krascheffekterna och cutscenens händelse. Därför hackar det inte i cutscenen eller vid en krasch.

**Interiören följer skinet:** säten, paneler, väggar, knappar, lampor och skärmar får skinets färger, och mitt på instrumentbrädan sitter skinets märke. Spakar och rattar beror på sällsyntheten:

| Sällsynthet | Spakarnas knoppar | Rattar |
| --- | --- | --- |
| Common | Vanliga, i skinets färger | Vanliga |
| Epic | Räfflad krom | Krom |
| Legendary | Glödande kristaller | Guld |
| Ultra | Lysande klot med ring | Neonlister |

**Styrning för piloten:** W/S eller ↑/↓ för upp/ner, A/D eller ←/→ för att banka och svänga, Mellanslag för gas, Shift för broms och Q/E för att titta runt. På mobil finns en styrspak till vänster och knappar till höger, och man drar på högra delen av skärmen för att titta runt.

## Konto, level och shop

Level och shop finns bara för den som har loggat in. Inloggningen sker med en länk som skickas till ens e-post, så det behövs inget lösenord. Den som inte har loggat in ser kontoraden och shopen med ett lås, och spelet fungerar annars som vanligt.

**XP och mynt** delas ut när man klarar en bana:

| Del | XP |
| --- | --- |
| Klarad bana | 60 / 90 / 130 / 180 / 250 efter svårighet (1–5 pluppar), plus poäng ÷ 50 och 5 per stjärna |
| Första gången | +150 % av grundbelöningen |
| Nytt bättre betyg | B +20, A +50, S +100 (bara skillnaden mot tidigare bästa) |
| Omspel | 1:a gången 100 %, sedan 60 %, 40 %, 30 % och 25 % |
| Co-op | +10 % för båda spelarna, om båda är inloggade |

Man får mynt motsvarande halva XP:n. XP minskar aldrig, men mynt används i shopen.

**Level:** för att gå från level L till L+1 krävs 100 + 40·(L−1) XP, alltså 100, 140, 180 och så vidare. Högsta level är 50 (51 940 XP). En bra första runda på alla banor ger ungefär 12 500 XP (level 24) och 6 300 mynt.

**Shop:** 40 skins från Claude Design i fyra sällsyntheter: Common (färg och mönster), Epic (metall, glöd och spår), Legendary (animerade texturer, drakvingar, eld och blixtar) och Ultra (helt ombyggda modeller som rymdskepp, drake, UFO och svart hål). Varje skin har ett level-krav och ett pris: Common level 1–4, Epic 5–14, Legendary 15–28 och Ultra 30–48. Man måste nå leveln och sedan köpa skinet, och köpet bekräftas med ett andra tryck. Shopen visar planet i 3D med alla effekter, och trycker man på planet kommer skinets effektsmäll. Det valda skinet syns på planet när du flyger, i co-op för båda spelarna (pilotens skin). Från cockpit skyms sikten aldrig av effekterna. Mer om skinsen finns i [docs/SKINS.md](docs/SKINS.md).

**Säkerhet:** databasen räknar själv ut XP och mynt och kontrollerar köp. Spelaren kan bara läsa sin egen profil. Orimliga poäng och för täta resultat (under 20 sekunder isär) avvisas.

### Sätta upp Supabase (en gång)

1. Skapa ett gratis projekt på [supabase.com](https://supabase.com), till exempel med regionen *Stockholm (eu-north-1)*.
2. Öppna **SQL Editor → New query**, klistra in hela `supabase/schema.sql` och tryck **Run**.
3. Under **Authentication → URL Configuration** sätter du *Site URL* och lägger till samma adress under *Redirect URLs*, alltså spelets adress (t.ex. `https://oscarbohman-maker.github.io/GO-Avatar-/`).
4. Under **Project Settings → API** kopierar du *Project URL* och den publika nyckeln (*anon* / *publishable*) till `js/config.js`. Båda är publika och får ligga i koden. Använd aldrig *service_role*/*secret*-nyckeln.

Supabases gratisplan skickar bara ett fåtal inloggningsmejl i timmen. Fler kräver egen e-postserver (SMTP) under **Authentication → Emails**.

Om man ändrar banor eller skins kör man `node tools/gen-sql.mjs` och sedan den nya `supabase/schema.sql` i Supabase. Spelarnas data behålls.

## Fysik

- Planet svänger genom att banka (koordinerad sväng). Högre fart ger större svängradie, så det lönar sig att bromsa före skarpa svängar.
- Styrningen svarar direkt: planet börjar svänga efter cirka 0,05 s och når halv sväng efter cirka 0,3 s. Det beror på en styv bankning, snabba tangenter och ett litet roder som vrider nosen direkt. Högsta svänghastigheten är densamma som förut, och höjden ändras lugnt. Spelet handlar mest om höger och vänster.
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
js/progress.js    Level, XP, mynt och betyg (samma regler som databasen)
js/skins.js       Skin-katalogen (namn, sällsynthet, pris, level-krav)
js/skinpack.js    Skinens utseende och effekter (från Claude Design)
js/envmap.js      Omgivningsljus för reflexer på planet
js/cutscene.js    Intro-cutscenen vid starten av varje bana
js/cinefx.js      Cutscenens händelse per värld (snöstorm, utbrott, stenras …)
js/lib/post/      Glöd (bloom) från three.js r170 (MIT)
js/account.js     Konto via Supabase: inloggning, profil, belöningar, köp
js/config.js      Supabase-adress och publik nyckel
js/shopview.js    Shopens roterande 3D-plan och skinbilder
supabase/         Databasen: tabeller, regler och funktioner (schema.sql)
docs/SKINS.md     Skinsen: filer, format och hur man lägger till ett skin
img/maps/         Kartornas miniatyrbilder
tools/            Rendera miniatyrbilder, skapa schema.sql
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
- **Level och shop:** level-kurvan, belöningar, omspel, ekonomin och skin-katalogen fungerar, och `supabase/schema.sql` är i takt med spelet.

Databasen testas mot en lokal Postgres, med en förenklad kopia av Supabases inloggning:

```bash
PD_PG="-h localhost -p 5432 -U postgres" npm run test:db
```

Testet kontrollerar att databasen räknar exakt som spelet, att spelaren inte kan ändra XP, mynt eller skins själv, att man bara ser sin egen profil, och att fuskskyddet, köp, level-krav och gratis skins fungerar.

**Låtsaskonto för utveckling:** på `localhost` med `?devAccount=1` används ett konto som bara sparas i webbläsaren. Det följer samma regler men använder ingen server, så menyerna går att testa utan Supabase. Med `?devAccount=0` stängs det av.
