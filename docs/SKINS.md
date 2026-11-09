# Plane skins – format for designers

The shop reads its skins from `js/skins.js`. The skins there now are **placeholders** until the real designs are ready.
A skin colours the parts of the existing plane model, so it needs no new 3D model or texture.

## One skin

```js
{
  id: 'desert',               // unique, lowercase, no spaces (stored in the database – never change it once live)
  name: 'Desert Fox',         // shown in the shop (max ~16 characters fits on the cards)
  rarity: 'rare',             // common | rare | epic | legendary (sets the colour of the card and label)
  price: 450,                 // coins; 0 = free, unlocked automatically at the level below
  level: 6,                   // lowest player level that can buy/unlock it (1–50)
  desc: 'Sand camouflage for the dunes.',
  parts: {                    // only list the parts you change; the rest keep the classic look
    body:    { c: '#d6b277' },
    wings:   { c: '#b88a52' },
    tail:    { c: '#8a5a2c' },
    engines: { c: '#b88a52' },
    trim:    { c: '#3a2a1a' },
  },
}
```

## Parts of the plane

| Part | What it is | Classic colour |
| --- | --- | --- |
| `body` | Fuselage | `#f4f3f0` |
| `wings` | Both wings | `#f4f3f0` |
| `tail` | Horizontal stabilisers and the fin | `#f4f3f0` |
| `engines` | The two engine nacelles | `#f4f3f0` |
| `trim` | Wing tips, fin tip and engine rings | `#b68235` |
| `props` | Propeller blades | `#2a2b2e` |
| `spinner` | Propeller hubs | `#c6c9ce` |
| `door` | Cabin door | `#c6c9ce` |

Windows and the cockpit glass always stay dark blue.

## Per part

| Key | Meaning | Range |
| --- | --- | --- |
| `c` | Colour | `#rrggbb` |
| `m` | Metalness (0 = paint, 1 = chrome) | 0–1, default 0 |
| `r` | Roughness (0 = glossy, 1 = matte) | 0–1, default 0.5 |
| `e` | Glow colour (optional) | `#rrggbb` |
| `ei` | Glow strength | 0–2, default 1 |

## Price and level guide

| Rarity | Level | Price (coins) |
| --- | --- | --- |
| Common | 1–5 | 0–250 |
| Rare | 6–12 | 450–600 (or 0 as a level reward) |
| Epic | 13–20 | 900–1400 |
| Legendary | 25–40 | 2000–3000 (or 0 as a level reward) |

A good first run on every map gives about 12,500 XP (level 24) and 6,300 coins. The whole shop costs more than that, so players have to replay maps to buy everything.

## After changing skins

1. Edit `js/skins.js` (keep the list sorted by level).
2. Run `node tools/gen-sql.mjs`, which updates `supabase/schema.sql` with the new prices and levels.
3. Run the new `supabase/schema.sql` in Supabase (SQL Editor → Run). It only updates the shop data and keeps every player's progress.
4. Run `npm test`.
