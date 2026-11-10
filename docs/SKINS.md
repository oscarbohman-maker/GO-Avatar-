# Plane skins

The game has 40 skins plus the standard plane, designed by Claude Design. There are 10 skins in each rarity:

| Rarity | Level | Price (coins) | What it has |
| --- | --- | --- | --- |
| Common | 1–4 | 60–220 | Colors and patterns |
| Epic | 5–14 | 300–700 | Metal, glow and light trails |
| Legendary | 15–28 | 700–1,400 | Animated textures, dragon and feather wings, fire, lightning |
| Ultra | 30–48 | 1,500–3,000 | A completely rebuilt model (spaceship, dragon, UFO, black hole …) and the most effects |

A good first run on every map gives about 12,500 XP (level 24) and 6,300 coins. The whole shop costs about 39,000 coins, so buying the Ultra skins takes replays.

## Files

| File | What it holds |
| --- | --- |
| `js/skins.js` | **Catalog:** id, English name and description, rarity, price, level and color swatch (shown on the card while the picture loads) |
| `js/skinpack.js` | **Looks:** textures, colors per part, extra parts, animations and particle effects, from the Claude Design package |
| `supabase/schema.sql` | Prices and levels in the database (generated, see below) |

## How a skin looks (`js/skinpack.js`)

These are the same fields as in the design package:

- `paint`: material per part of the plane (`body`, `wing`, `tail`, `engine`, `tip`, `ring`, `spinner`, `blade`, `glass`, `door`).
  - Each part takes a color `c`, metalness `m`, roughness `r`, glow `e`/`ei`, opacity `op` and a texture `map`.
  - With `emap`, the texture also glows.
- `hide` / `hideAll`: hides parts of the original plane, for example the wings under dragon wings, or the whole plane for Ultra models.
- `build(c)`: adds extra parts to the plane.
- `anim(c, dt, t, fly)`: animates them every frame.
- `fx`: particle emitters at points on the plane.
  - In the game the plane really moves, so trails are left behind on their own.
  - In the shop the plane stands still, so the trails are pushed backwards.

### What was adapted for the game

- **Updates:** the effects are updated by the game's own frame loop, not a separate loop.
- **Particles:** they are reused and capped so phones don't stutter: 220 in the game (400 for Legendary and Ultra on computers, 280 on phones) and 600 in the shop.
- **Cockpit:** no particles are created within 6 m of the cockpit camera, so the view is never blocked.
- **Crashes:** parts a skin hides stay hidden after a crash, and a skin's extra parts on the side that was hit break off.
- **Pilot's skin:** both players see it in co-op.
- **Same size:** every skin is scaled so that, seen from above, it reaches no further from the center than the standard plane, even while its parts spin, orbit or flap. What you see matches what you collide with (the standard plane's hitbox) for every skin.
- **Sharper textures:** they are drawn at 2× resolution on computers and 1.5× on phones and tablets, with stronger texture filtering. The shop cards are rendered at 2×.
- **Legendary and Ultra:** they get soft, continuous light trails from the wingtips (and the tail on Ultra) in the skin's own colors, about 35–50 % more particles, slightly bigger effects, and their own burst when the plane flies through a ring.
- **Glow (bloom):** anything that really glows gets a halo. It is on in the shop, in the intro cutscene and in the game on computers, and off in the game on phones to save power.

### Interior

The cockpit follows the skin (`applyInterior` in `js/rig.js`):

- **Colors:** seats, panels, walls, buttons, lamps and screens take the skin's colors. The most vivid swatch color is the accent, and dark skins get a dark cabin.
- **Badge:** a round badge with the skin's colors sits in the middle of the dashboard, with a ring in the rarity's color.
- **Throttle knobs:** Common has the standard knobs in the skin's colors, Epic has knurled chrome, Legendary has glowing crystals, and Ultra has glowing orbs with a ring.
- **Yokes:** Epic has chrome, Legendary has gold with leather grips in the accent color, and Ultra has dark grips with neon strips and a glowing hub.
- **Standard plane:** keeps the original cockpit.

## Adding or changing a skin

1. Add its looks in `js/skinpack.js` with `def('rarity', 'id', …)`, or `U('id', …)` for Ultra.
2. Add it to the catalog in `js/skins.js` with the same `id`, an English name, price and level. Keep the list sorted by level.
3. Run `node tools/gen-sql.mjs`, which updates `supabase/schema.sql`.
4. Run the new `supabase/schema.sql` in Supabase (SQL Editor → Run).
   - It updates the shop and keeps all player progress.
   - Skins that were removed from the game are refunded to players who bought them.
5. Run `npm test`. The tests check that the catalog and `skinpack.js` contain exactly the same skins, and that the database file is up to date.
