// Planets skins. Platshållare tills de riktiga designerna är klara (se docs/SKINS.md för formatet).
//
// Varje skin: id, namn, sällsynthet, pris (mynt), level-krav och färger per del av planet.
// Delar: body (kropp), wings (vingar), tail (stjärt och fena), engines (motorer), trim (vingspetsar,
// fenspets, motorringar), props (propellerblad), spinner (propellernav), door (dörr).
// Varje del: { c: färg, m: metallighet 0–1, r: råhet 0–1, e: glödfärg, ei: glödstyrka }.
// Delar som saknas får standardplanets färger.
// Priset 0 = gratis när man nått leveln. Måste stämma med supabase/schema.sql (tools/gen-sql.mjs skapar den).

export const RARITY = {
  common: { name: 'Common', color: '#9fb3c8' },
  rare: { name: 'Rare', color: '#4dd0ff' },
  epic: { name: 'Epic', color: '#c77dff' },
  legendary: { name: 'Legendary', color: '#ffb52e' },
};

export const DEFAULT_PARTS = {
  body: { c: '#f4f3f0', r: 0.4 },
  wings: { c: '#f4f3f0', r: 0.4 },
  tail: { c: '#f4f3f0', r: 0.4 },
  engines: { c: '#f4f3f0', r: 0.4 },
  trim: { c: '#b68235', r: 0.4 },
  props: { c: '#2a2b2e', r: 0.6 },
  spinner: { c: '#c6c9ce', r: 0.35, m: 0.2 },
  door: { c: '#c6c9ce', r: 0.35, m: 0.2 },
};

export const SKINS = [
  { id: 'classic', name: 'Classic', rarity: 'common', price: 0, level: 1, desc: 'The trusty white and gold original.', parts: {} },
  { id: 'sky', name: 'Sky Blue', rarity: 'common', price: 150, level: 2, desc: 'Blends into a clear sky.',
    parts: { body: { c: '#3d86f0' }, wings: { c: '#eaf2ff' }, tail: { c: '#3d86f0' }, engines: { c: '#eaf2ff' }, trim: { c: '#ffffff' } } },
  { id: 'sunset', name: 'Sunset', rarity: 'common', price: 200, level: 3, desc: 'Warm colours of the evening sky.',
    parts: { body: { c: '#ff7a45' }, wings: { c: '#ffd23f' }, tail: { c: '#ff4d6d' }, engines: { c: '#ffd23f' }, trim: { c: '#7a1fa2' } } },
  { id: 'ranger', name: 'Forest Ranger', rarity: 'common', price: 250, level: 4, desc: 'Green and khaki for the pine valleys.',
    parts: { body: { c: '#3d6b3a' }, wings: { c: '#c9b27c' }, tail: { c: '#3d6b3a' }, engines: { c: '#c9b27c' }, trim: { c: '#e0a030' } } },
  { id: 'rookie', name: 'Rookie Stripes', rarity: 'common', price: 0, level: 5, desc: 'Free reward for reaching level 5.',
    parts: { tail: { c: '#3ddc84' }, trim: { c: '#3ddc84' }, engines: { c: '#3ddc84' } } },
  { id: 'desert', name: 'Desert Fox', rarity: 'rare', price: 450, level: 6, desc: 'Sand camouflage for the dunes.',
    parts: { body: { c: '#d6b277' }, wings: { c: '#b88a52' }, tail: { c: '#8a5a2c' }, engines: { c: '#b88a52' }, trim: { c: '#3a2a1a' } } },
  { id: 'camo', name: 'Jungle Camo', rarity: 'rare', price: 500, level: 8, desc: 'Hard to spot under the canopy.',
    parts: { body: { c: '#4a5a2c', r: 0.7 }, wings: { c: '#6b7a3a', r: 0.7 }, tail: { c: '#3a4a22', r: 0.7 }, engines: { c: '#2f3a1c', r: 0.7 }, trim: { c: '#c9a24a' } } },
  { id: 'crimson', name: 'Crimson Ace', rarity: 'rare', price: 600, level: 10, desc: 'Bright red with black tail.',
    parts: { body: { c: '#c4161c', r: 0.3 }, wings: { c: '#c4161c', r: 0.3 }, tail: { c: '#1a1a1a' }, engines: { c: '#1a1a1a' }, trim: { c: '#f2f2f2' } } },
  { id: 'veteran', name: 'Veteran', rarity: 'rare', price: 0, level: 12, desc: 'Free reward for reaching level 12.',
    parts: { body: { c: '#5a6470', m: 0.5, r: 0.45 }, wings: { c: '#6b7682', m: 0.5, r: 0.45 }, tail: { c: '#5a6470', m: 0.5 }, engines: { c: '#6b7682', m: 0.5 }, trim: { c: '#ffd23f' } } },
  { id: 'frost', name: 'Arctic Frost', rarity: 'epic', price: 900, level: 13, desc: 'Icy blue with a cold glow.',
    parts: { body: { c: '#e9f6ff', m: 0.3, r: 0.25 }, wings: { c: '#9fd8ff', m: 0.3, r: 0.25 }, tail: { c: '#6ac2f5' }, engines: { c: '#9fd8ff' }, trim: { c: '#ffffff', e: '#6ad8ff', ei: 0.8 } } },
  { id: 'midnight', name: 'Midnight', rarity: 'epic', price: 1100, level: 16, desc: 'Dark as the night, with violet lights.',
    parts: { body: { c: '#12172a', r: 0.35 }, wings: { c: '#1d2540', r: 0.35 }, tail: { c: '#12172a' }, engines: { c: '#1d2540' }, trim: { c: '#7d5cff', e: '#7d5cff', ei: 1.2 }, props: { c: '#0a0a0a' } } },
  { id: 'chrome', name: 'Chrome', rarity: 'epic', price: 1400, level: 20, desc: 'Polished metal from nose to tail.',
    parts: { body: { c: '#d9dde3', m: 0.95, r: 0.15 }, wings: { c: '#d9dde3', m: 0.95, r: 0.15 }, tail: { c: '#d9dde3', m: 0.95, r: 0.15 }, engines: { c: '#c2c7cf', m: 0.95, r: 0.15 }, trim: { c: '#9aa3ad', m: 1, r: 0.1 }, spinner: { c: '#ffffff', m: 1, r: 0.1 } } },
  { id: 'lava', name: 'Lava Core', rarity: 'legendary', price: 2000, level: 25, desc: 'Black basalt with glowing magma.',
    parts: { body: { c: '#1a1210', r: 0.8 }, wings: { c: '#2a1a14', r: 0.8 }, tail: { c: '#1a1210', r: 0.8 }, engines: { c: '#2a1a14', e: '#ff3a00', ei: 0.35 }, trim: { c: '#ff5a10', e: '#ff5a10', ei: 1.4 }, spinner: { c: '#ff8a30', e: '#ff5a10', ei: 1 } } },
  { id: 'golden', name: 'Golden Wings', rarity: 'legendary', price: 3000, level: 30, desc: 'For the true aces.',
    parts: { wings: { c: '#e2b23a', m: 0.85, r: 0.25 }, tail: { c: '#e2b23a', m: 0.85, r: 0.25 }, engines: { c: '#e2b23a', m: 0.85, r: 0.25 }, trim: { c: '#fff3c4', m: 1, r: 0.2 }, spinner: { c: '#e2b23a', m: 1, r: 0.2 } } },
  { id: 'legend', name: 'Legend', rarity: 'legendary', price: 0, level: 40, desc: 'Free reward for reaching level 40.',
    parts: { body: { c: '#0b1a3a', r: 0.3 }, wings: { c: '#ffd23f', m: 0.6, r: 0.3 }, tail: { c: '#0b1a3a' }, engines: { c: '#ffd23f', m: 0.6 }, trim: { c: '#ff4d5e', e: '#ff4d5e', ei: 0.8 } } },
];

export const DEFAULT_SKIN = 'classic';
export function skinById(id) { return SKINS.find((s) => s.id === id) || SKINS[0]; }

// Vilken del av planet en modell-del hör till (namnen kommer från js/models.js)
export function partOf(name) {
  if (name === 'flygkropp') return 'body';
  if (name.startsWith('vinge_')) return 'wings';
  if (name.startsWith('stabilisator_') || name === 'fena') return 'tail';
  if (name.startsWith('motor_')) return 'engines';
  if (name.startsWith('vingspets_') || name === 'fenspets' || name.startsWith('motorring_')) return 'trim';
  if (name.startsWith('blad_')) return 'props';
  if (name.startsWith('spinner_')) return 'spinner';
  if (name === 'dorr') return 'door';
  return null;
}

// Färgen för en del (skinets värde ovanpå standardplanets)
export function partStyle(skin, part) {
  return { ...DEFAULT_PARTS[part], ...((skin && skin.parts && skin.parts[part]) || {}) };
}
