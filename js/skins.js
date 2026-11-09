// Planets skins: katalog med namn, sällsynthet, pris (mynt) och level-krav.
// Utseendet (texturer, delar, effekter) finns i js/skinpack.js, från skin-paketet av Claude Design.
// Måste stämma med supabase/schema.sql (tools/gen-sql.mjs skapar den). Formatet beskrivs i docs/SKINS.md.

export const RARITY = {
  common: { name: 'Common', color: '#7d7979' },
  epic: { name: 'Epic', color: '#8e44d9' },
  legendary: { name: 'Legendary', color: '#d4900f' },
  ultra: { name: 'Ultra', color: '#d81b60' },
};
export const RARITY_ORDER = ['common', 'epic', 'legendary', 'ultra'];

export const SKINS = [
  { id: 'classic', name: 'Standard', rarity: 'common', price: 0, level: 1, desc: 'The original plane in white and gold.', swatch: ['#f4f3f0', '#b68235'] },
  { id: "klassisk-rod", name: "Classic Red", rarity: 'common', price: 60, level: 1, desc: "Red body with white wings.", swatch: ["#c62828", "#f4f3f0"] },
  { id: "himmelsbla", name: "Sky Blue", rarity: 'common', price: 80, level: 1, desc: "Light blue with a white stripe along the back.", swatch: ["#5aa9e6", "#ffffff"] },
  { id: "kamouflage", name: "Camouflage", rarity: 'common', price: 100, level: 2, desc: "Military green camouflage.", swatch: ["#4b5d3a", "#6b7b46", "#2f3a26"] },
  { id: "rutig-racer", name: "Checkered Racer", rarity: 'common', price: 120, level: 2, desc: "Yellow racer with chequered-flag wings.", swatch: ["#f2c230", "#111111", "#ffffff"] },
  { id: "solnedgang", name: "Sunset", rarity: 'common', price: 140, level: 3, desc: "Fades from red to yellow.", swatch: ["#ff4e50", "#fc913a", "#f9d423"] },
  { id: "polis", name: "Police", rarity: 'common', price: 150, level: 3, desc: "White with a blue and yellow chequered stripe.", swatch: ["#f7f8fa", "#1c3f9e", "#ffd400"] },
  { id: "mintglass", name: "Mint Ice Cream", rarity: 'common', price: 160, level: 3, desc: "Pastel green with pink details.", swatch: ["#9fe3c9", "#f6fffb", "#ff8fab"] },
  { id: "svart-matt", name: "Matte Black", rarity: 'common', price: 180, level: 4, desc: "Matte black with orange accents.", swatch: ["#1f2023", "#ff7a1a"] },
  { id: "zebra", name: "Zebra", rarity: 'common', price: 200, level: 4, desc: "Black and white zebra stripes.", swatch: ["#ffffff", "#111111"] },
  { id: "retropost", name: "Retro Mail", rarity: 'common', price: 220, level: 4, desc: "Mail-van yellow with a blue window line.", swatch: ["#f5c400", "#1b4fa0"] },
  { id: "neon-natt", name: "Neon Night", rarity: 'epic', price: 300, level: 5, desc: "Dark body with a glowing cyan grid and neon trails.", swatch: ["#14161f", "#36f1ff", "#1a4cff"] },
  { id: "krom", name: "Chrome", rarity: 'epic', price: 340, level: 6, desc: "Mirror-bright chrome that sparkles.", swatch: ["#e7ebf0", "#9fb4c8", "#ffffff"] },
  { id: "guldrush", name: "Gold Rush", rarity: 'epic', price: 380, level: 7, desc: "Shiny gold with a glitter trail.", swatch: ["#e2b13c", "#fff1b8"] },
  { id: "hajtand", name: "Shark Bite", rarity: 'epic', price: 420, level: 8, desc: "A shark's mouth with teeth on the nose.", swatch: ["#8a96a2", "#ffffff", "#4a0c10"] },
  { id: "tiger", name: "Tiger", rarity: 'epic', price: 460, level: 9, desc: "Tiger stripes and glowing trails.", swatch: ["#ff9a1f", "#1b120c"] },
  { id: "iskristall", name: "Ice Crystal", rarity: 'epic', price: 500, level: 10, desc: "Ice-blue crystal with snow glitter.", swatch: ["#bfe8ff", "#6fb4e6", "#ffffff"] },
  { id: "lavasten", name: "Lava Rock", rarity: 'epic', price: 560, level: 11, desc: "Black rock with glowing cracks.", swatch: ["#1c0f0a", "#ff4a0a", "#ffc04a"] },
  { id: "synthwave", name: "Synthwave", rarity: 'epic', price: 600, level: 12, desc: "An 80s grid in purple and pink.", swatch: ["#2b0b4a", "#ff3fa4", "#36f1ff"] },
  { id: "kolfiber", name: "Carbon Fiber", rarity: 'epic', price: 650, level: 13, desc: "Woven carbon fiber with red glowing rings.", swatch: ["#2a2c31", "#16171a", "#ff2a2a"] },
  { id: "regnbage", name: "Rainbow", rarity: 'epic', price: 700, level: 14, desc: "Every color and a rainbow trail.", swatch: ["#ff4e50", "#f9d423", "#3bd16f", "#36a3ff", "#a24bff"] },
  { id: "galax", name: "Galaxy", rarity: 'legendary', price: 700, level: 15, desc: "A living space wallpaper with stars, nebula trails and two moons.", swatch: ["#0c0620", "#7a4dff", "#ff4fd8", "#7fd4ff"] },
  { id: "drakeld", name: "Dragonfire", rarity: 'legendary', price: 780, level: 16, desc: "Dragon scales, flapping dragon wings, horns and fire breath.", swatch: ["#8e1b12", "#ff6a2a", "#2a0907", "#ffd21a"] },
  { id: "fenix", name: "Phoenix", rarity: 'legendary', price: 860, level: 18, desc: "Flaming feather wings and a tail of fire.", swatch: ["#ff8a1a", "#ffd23a", "#c2410c"] },
  { id: "isdrake", name: "Ice Dragon", rarity: 'legendary', price: 940, level: 19, desc: "Ice scales, frosty dragon wings and freezing breath.", swatch: ["#2b6f9e", "#bff4ff", "#e9fbff"] },
  { id: "askstorm", name: "Thunderstorm", rarity: 'legendary', price: 1020, level: 21, desc: "Lightning strikes between the wingtips and the fin.", swatch: ["#0b1030", "#6fb6ff", "#ffffff"] },
  { id: "nordljus", name: "Northern Lights", rarity: 'legendary', price: 1100, level: 22, desc: "Moving auroras on the body and a band of light behind the plane.", swatch: ["#031018", "#3bffa0", "#aa50ff"] },
  { id: "spektral", name: "Spectral", rarity: 'legendary', price: 1180, level: 24, desc: "A see-through ghost plane that pulses and leaves veils behind.", swatch: ["#bfe9ff", "#8fd8ff", "#ffffff"] },
  { id: "tomrum", name: "Void", rarity: 'legendary', price: 1260, level: 25, desc: "A void with swirling rings that pull in light.", swatch: ["#02000a", "#a64bff", "#ffd2ff"] },
  { id: "diamant", name: "Diamond", rarity: 'legendary', price: 1340, level: 27, desc: "Shimmering mother-of-pearl and crystals that change color.", swatch: ["#bfe7ff", "#ffc4f2", "#c8ffd6", "#fff3b0"] },
  { id: "solflamma", name: "Solar Flare", rarity: 'legendary', price: 1400, level: 28, desc: "The surface boils with plasma, with a corona and solar flares.", swatch: ["#ffb347", "#ff5a00", "#fff3b0"] },
  { id: "stjarnjagare", name: "Star Hunter", rarity: 'ultra', price: 1500, level: 30, desc: "A spaceship with delta wings, laser cannons and warp rings.", swatch: ["#1b2233", "#36f1ff", "#ff3a4a"] },
  { id: "urdrake", name: "Ancient Dragon", rarity: 'ultra', price: 1650, level: 32, desc: "A whole dragon with a swaying tail, huge wings and fire breath.", swatch: ["#3b0d0a", "#ff4a1a", "#ffd21a"] },
  { id: "robotfalk", name: "Robo Falcon", rarity: 'ultra', price: 1800, level: 34, desc: "A mechanical falcon with segmented wings and a pulsing core.", swatch: ["#9aa3b0", "#38e8ff", "#ff2a3a"] },
  { id: "tefat", name: "Flying Saucer", rarity: 'ultra', price: 1950, level: 36, desc: "A spinning UFO with a ring of lights, a tiny pilot and a tractor beam.", swatch: ["#c9d1db", "#7dffb0", "#a24bff"] },
  { id: "kvantkristall", name: "Quantum Crystal", rarity: 'ultra', price: 2100, level: 38, desc: "Floating crystal shards around a glowing core, in every color.", swatch: ["#e9fbff", "#ff9ff0", "#9ffcff", "#fff3b0"] },
  { id: "eldfagel", name: "Firebird", rarity: 'ultra', price: 2300, level: 40, desc: "A bird of fire with giant flaming wings, reborn in a nova.", swatch: ["#ffd23a", "#ff8a1a", "#c2410c", "#fff3b0"] },
  { id: "stormvakt", name: "Storm Warden", rarity: 'ultra', price: 2500, level: 42, desc: "A lightning ship with storm clouds that circle and strike.", swatch: ["#141a33", "#6fb6ff", "#4a5061", "#ffffff"] },
  { id: "singularitet", name: "Singularity", rarity: 'ultra', price: 2700, level: 44, desc: "A black hole with a spinning accretion disk, jets and light being pulled in.", swatch: ["#000000", "#ffb347", "#e04e1e", "#8fb4ff"] },
  { id: "gyllene-kolossen", name: "Golden Colossus", rarity: 'ultra', price: 2850, level: 46, desc: "A golden ship with three pairs of angel wings, a halo and rays of light.", swatch: ["#c9952d", "#ffe08a", "#ffffff"] },
  { id: "leviatan", name: "Leviathan", rarity: 'ultra', price: 3000, level: 48, desc: "A space whale with glowing spots, swimming fins and a trail of stardust.", swatch: ["#0b1d3a", "#5ff4ff", "#c49bff", "#2b5c8a"] },
];

export const DEFAULT_SKIN = 'classic';
export function skinById(id) { return SKINS.find((s) => s.id === id) || SKINS[0]; }
