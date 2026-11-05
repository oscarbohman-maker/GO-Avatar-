# Plain Dodge! ✈️🧭

Ett samarbetsspel för två i webbläsaren, byggt för Safari på iPhone, iPad och Mac. Det fungerar också i alla moderna webbläsare. Spelet är på engelska.

- **Piloten** sitter i cockpiten och flyger i förstaperson genom tät dimma, med bara cirka 44 m sikt.
- **Navigatören** sitter med i planet (helskärm, utan dimma) och ser långt framåt. En liten minikarta visar närmaste hindren. Man kan inte planera hela rutten i förväg, utan måste ropa i tid: "vänster, snabbt!". Sidopanelen har ikonknappar för att visa/dölja kartan, zooma, byta till yttre kamera och visa/dölja vägledningen.

Båda figurerna syns i cockpiten. Pilotens händer följer ratten och gasreglagen, och kompisen pekar och trycker på knappar.

## Spellägen

- **Free Play:** 20 kartplatser. Just nu är 2 spelbara (*Canyon Loop* och *Training Flight*), och resten visas skuggade som "Coming soon". Välj en karta och sedan en roll:
  - **Pilot:** flyg blint, och en NPC-navigator pratar (engelsk röst), pekar och guidar dig.
  - **Navigator:** du ser allt och styr en blind AI-pilot. Håll **←/→** (knappar eller tangenter) för att svänga och **Shift** för att bromsa. Den håller höjden själv.
  - **Solo:** flyg själv med en liten karta i hörnet.
- **Play with Friends:** den ena trycker *Create game* och får en **kod med 6 tecken**, och den andra skriver in koden eller öppnar länken från *Share link*. Koden gäller i **24 timmar**, även om man laddar om sidan, och går sedan ut.
- **Settings:** namn, invertera upp/ner, styrkänslighet, pekskärmskontroller (Auto/On/Off), ljudeffekter och NPC-röst.

## Regler och poäng

- Flyg genom ringarna i ordning. Man kan alltid flyga igenom ringar och stjärnor.
- **Poäng:** ring +100, **Perfect** (inom 40 % av ringens radie) +250, stjärna +50. I mål får man en tidsbonus på 25 poäng per sekund under banans par-tid.
- **Kraschar man börjar man om från starten.** Planet tumlar först, sedan nollställs portar, stjärnor, poäng och tid.
- Missad port: +5 s på tiden.
- Rekordet per karta är högsta poäng, och det sparas lokalt i webbläsaren utan konto.

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
| Röst | WebRTC-ljud över samma anslutning |
| Sparning | `localStorage` (profil, inställningar, historik, rekord, värdens kod i 24 h) |

### Filer

```
index.html        Alla skärmar (start, free play, vänner, inställningar, lobby, spel)
css/style.css     Blått tema, knappar, animationer
js/main.js        Menyer, lägen, lobby, nätverksmeddelanden, HUD, resultat
js/net.js         Anslutning med 6-teckenskod som går ut efter 24 h
js/voice.js       Röstchatt
js/levels.js      Kartlistan (20 platser) och banorna
js/physics.js     Flygmodell och kollisioner
js/sim.js         Spelregler: poäng, perfect, stjärnor, krasch → omstart, mål
js/npc.js         NPC-navigatören (hinderkoll, kommandon, gester, röst)
js/aipilot.js     AI-piloten som lyder navigatörens pilknappar
js/models.js      Flygplan och cockpit (från reference/models.js)
js/avatar.js      Figurerna: ansikte, kläder, IK och fjädrar
js/rig.js         Planet i världen: cockpit, kabinskal, figurer, instrument
js/world3d.js     3D-världen, dimma och stjärnor
js/view3d.js      Kameror (cockpit, bakifrån, runtom)
js/pilot.js       Pilotens vy
js/nav3d.js       Navigatörens cockpitfönster
js/radar.js       Navigatörens radar
js/input.js       Tangentbord och pekskärm
js/storage.js     Profil, inställningar och rekord
js/sfx.js         Ljudeffekter
tests/            Automatiska test
```

### Test

```bash
npm test
```

Testerna kontrollerar bland annat följande:

- **Banorna:** autopiloten klarar dem utan krasch, och NPC-navigatören guidar en blind pilot igenom.
- **Navigatörsläget:** en navigatör kan styra AI-piloten genom kanjonen med bara ←/→.
- **Regler och poäng:** krasch ger omstart, och ringar ger poäng (mest för Perfect).
- **Modellerna och figurerna:** de har alla namngivna delar, och händerna sitter kvar på ratten.
