# Prompt till Claude Code – flygplan + cockpit

> Kopiera allt under linjen till Claude Code. Lägg filen `models.js` från detta projekt i ditt repo (t.ex. `reference/models.js`) – den är den exakta källan och prompten hänvisar till den.

---

Jag bygger ett co-op-spel där en spelare flyger ett flygplan blind och den andra guidar. Jag behöver två 3D-modeller i spelet: **flygplanet (exteriör)** och **cockpiten (interiör)**. Det finns en färdig referensimplementation i `reference/models.js` (three.js r184, funktionerna `buildPlane()` och `buildCockpit()`). Återskapa dem **exakt** – samma mått, positioner, rotationer, färger och delnamn – i vår spelmotor/kodbas.

## Regler
- Läs `reference/models.js` först. Den är facit; om något i denna prompt säger emot filen gäller filen.
- Enheter i meter, y uppåt. Flygplanets nos pekar mot **+x**. Cockpitens framriktning är **−z**, golvet ligger på y = 0.
- Behåll alla delnamn (t.ex. `flygkropp`, `vinge_h`, `ratt_pilot`, `radar_pilot`) så att vi kan hitta och animera delar.
- Enkel stiliserad grafik: inga texturer, bara materialfärger. Rundade kanter via hjälpfunktionen `rbox(w,h,d,r)` (rundad låda = extruderad rundad rektangel med bevel r). Om motorn saknar extrude, använd en motsvarande rundad låda/mesh.
- `beam(a, b, w, h)` = rundad låda mellan två punkter, orienterad längs a→b.
- Lägg modellerna som återanvändbara prefabs/komponenter, inte inbakade i en scen.

## Material (färg, roughness, metalness)
Flygplan:
- `vit_lack` #f4f3f0, 0.4, 0 – flygkropp, vingar, fena, motorer
- `ljusgra` #c6c9ce, 0.35, 0.2 – spinners, dörr
- `fonster` #27323f, 0.15, 0 – fönster och vindruta
- `propeller` #2a2b2e, 0.6, 0
- `guld` #b68235, 0.4, 0 – fenspets, motorringar, vingspetsar

Cockpit:
- `vit_insida` #e9e7e2 (väggar, ram), `panel_mork` #3d4046, `panel_ljus` #8d9198, `svart` #1d1e21, `matartavla` #f2f0ea, `sadel_lader` #8a5a24, `sadel_mork` #4a3420, `metall` #b9bcc1 (metalness 0.35)
- `glas` #bfe0f2, transparent, opacity 0.18
- Lysande (emissive = samma färg): `lampa_rod` #e0392b, `lampa_gron` #3bd16f, `lampa_gul` #f2c230 (intensitet 1.2), `radar` #1f9e4e (0.7), `radar_svep` #9dffb8 (1.5), `skarm` #1d3f7a (0.6)
- Horisontinstrument: `horisont_bla` #3b8fd9, `horisont_brun` #8a5a2b

## Flygplan – översikt
- **Flygkropp:** rotationskropp (lathe, 64 segment) längs x från −6.2 till 6.12, radie 1.0 i mitten. Profilen avsmalnar mot nos och stjärt (exakta punkter i filen). Stjärten böjs uppåt: för x < −1.5 gäller y += 0.035·(−1.5 − x)².
- **Vindruta:** två skivor av nosens yta (x 4.25–5.15) i fönstermaterial, ovanpå toppen, med en smal vit mittlist.
- **Kabinfönster:** 9 per sida, rundade 0.24×0.32, x = −1.7 + i·0.5, y = 0.3, lutade ±0.3 rad. Grå dörr vid x = −2.45 på höger sida.
- **Vingar:** lågvinge vid x 0.3, y −0.45, spännvidd 2×6.6 m, rotkorda 2.2 m → spetskorda 0.8 m, 0.06 rad dihedral, guldspetsar.
- **Stjärt:** stabilisatorer 2×2.3 m vid y 0.62; vertikal fena upp till y 2.75 med guldspets.
- **Motorer:** två kapslar (radie 0.42, längd 1.5) vid z = ±2.5 under vingarna, guldring fram, grå spinner (kon), 3-bladig svart propeller vid x 2.12. Propellergruppen `propeller_h/v` ska kunna snurra runt x-axeln.

## Cockpit – översikt
- **Skal:** mörkt golv 2.3×2.7, låga vita sidoväggar (höjd 1.0) med fönsterkarmar, framvägg.
- **Instrumentpanel** (grupp vid y 0.98, z −1.08, lutad −0.32 rad): mörk platta 2.14×0.6, ljust bländskydd ovanpå.
  - Pilot (vänster): grön radar (r 0.13) med ringar, kors och svepstråle + 4 mätare (hastighet, kompass, höjdmätare, varvtal).
  - Andrepilot (höger): konstgjord horisont (blå/brun) + bränsle, oljetryck, temperatur.
  - Mitten: 2 rader med röda/gula/gröna knappar, AUTO-knapp, liten blå skärm. Rad med 6 vippbrytare uppe till höger, röd varningslampa.
  - Mätare = svart ram + vit tavla med 8 streck och röd visare.
- **Rattar:** två (x ±0.6, y 0.86, z −0.62), stång in i panelen, nav, U-båge, två svarta grepp med röda knappar. Grupperna `ratt_pilot`/`ratt_andrepilot` ska kunna roteras (roll) och flyttas i z (pitch).
- **Mittkonsol:** mellan stolarna, tre gasreglage (två svarta kulor, en röd), trimhjul.
- **Pedaler:** 2 par framför stolarna.
- **Sidopanel** vänster vägg: röd/gul/grön lampa + brytare.
- **Stolar:** två (x ±0.6, z 0.35): fot, sits, lutad rygg (0.14 rad), nackstöd, armstöd, bälten i läder.
- **Ram:** A-stolpar och mittstolpe runt vindrutan, toppbalk, sidoskenor till mittstolpar vid z 0.2, takpanel med brytare och två lampor. Två transparenta vindrutor.

## Leverans
1. Två prefabs/moduler: `Airplane` och `Cockpit`, med delnamn bevarade.
2. Propellrarna snurrar när motorn går; rattarna följer spelarens styrinput.
3. Kör spelet, jämför visuellt med referensen och justera tills de matchar.
4. Berätta kort vad som ändrats och om något inte gick att överföra 1:1.
