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
- **Particles:** they are reused and capped at 220 in the game and 600 in the shop, so phones don't stutter.
- **Cockpit:** no particles are created within 6 m of the cockpit camera, so the view is never blocked.
- **Crashes:** parts a skin hides stay hidden after a crash, and a skin's extra parts on the side that was hit break off.
- **Pilot's skin:** both players see it in co-op.
- **Collisions:** they always use the standard plane's shape, so even big Ultra models get a fair hitbox.

## Adding or changing a skin

1. Add its looks in `js/skinpack.js` with `def('rarity', 'id', …)`, or `U('id', …)` for Ultra.
2. Add it to the catalog in `js/skins.js` with the same `id`, an English name, price and level. Keep the list sorted by level.
3. Run `node tools/gen-sql.mjs`, which updates `supabase/schema.sql`.
4. Run the new `supabase/schema.sql` in Supabase (SQL Editor → Run).
   - It updates the shop and keeps all player progress.
   - Skins that were removed from the game are refunded to players who bought them.
5. Run `npm test`. The tests check that the catalog and `skinpack.js` contain exactly the same skins, and that the database file is up to date.
