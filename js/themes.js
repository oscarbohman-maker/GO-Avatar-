// Världarnas teman: färger, ljus, dimma, väggar, dekor och väder.
// Används av banorna (levels.js), 3D-världen (world3d.js) och menyerna (main.js).
// Bara data här – inget three.js – så att filen också går att använda i testerna.

export const THEMES = {
  canyon: {
    name: 'Canyon', tagline: 'Practice canyon', icon: 'mountain',
    accent: '#e0a060', card: ['#7a4a2c', '#2b1a10'],
    ground: ['#4f7d3a', '#5a8a42'], speck: ['rgba(30,60,20,0.25)', 'rgba(140,180,90,0.18)'],
    sky: 0xaec3d3, hemi: [0xdfeeff, 0x3a5a2c, 1.9], sun: [0xfff2d6, 2.1],
    pilotFog: 0xc6ced6, walls: 'tree', decor: 'pine',
    pillar: 0x8a7f72, wall: 0xa04a3a, roof: 0x45484e, mover: 0x7a6e62,
  },
  forest: {
    name: 'Forest', tagline: 'Pine walls, gates and windows', icon: 'tree',
    accent: '#5fd38a', card: ['#2f6b3c', '#0f2a1a'],
    ground: ['#4f7d3a', '#5a8a42'], speck: ['rgba(30,60,20,0.25)', 'rgba(140,180,90,0.18)'],
    sky: 0xaec3d3, hemi: [0xdfeeff, 0x3a5a2c, 1.9], sun: [0xfff2d6, 2.1],
    pilotFog: 0xc6ced6, walls: 'tree', decor: 'pine',
    pillar: 0x8a7f72, wall: 0x8a5a3a, roof: 0x5a4a3a, mover: 0x7a6e62,
  },
  desert: {
    name: 'Desert', tagline: 'Sandstone mesas, heat haze and sandstorms', icon: 'sun',
    accent: '#f2b45a', card: ['#c98a45', '#4a2a12'],
    ground: ['#d6b277', '#ddbb80'], speck: ['rgba(150,100,50,0.22)', 'rgba(255,240,200,0.25)'],
    sky: 0xe8d6b0, hemi: [0xfff3dc, 0x9a7a4a, 2.0], sun: [0xffe2b0, 2.6],
    pilotFog: 0xdcc69c, walls: 'rock', decor: 'mesa', cacti: true,
    spire: [0.075, 0.45, 0.55, 0.12],                   // [kulör, mättnad, ljushet, variation]
    pillar: 0xc4935c, wall: 0xc98a55, roof: 0xa8784a, mover: 0xb98a58,
  },
  jungle: {
    name: 'Jungle', tagline: 'Dense canopy, temple ruins and monsoon rain', icon: 'leaf',
    accent: '#3fd07a', card: ['#1f6a3a', '#08241a'],
    ground: ['#2f5a2a', '#36662f'], speck: ['rgba(10,40,10,0.3)', 'rgba(120,170,60,0.18)'],
    sky: 0x9fb8a4, hemi: [0xd8f0d8, 0x2a4a22, 1.7], sun: [0xf2f6d0, 1.7],
    pilotFog: 0xa9bcaa, walls: 'tree', decor: 'jungle',
    pillar: 0x6f7658, wall: 0x7d7c62, roof: 0x5d5e48, mover: 0x6a6650,
  },
  redrock: {
    name: 'Red Rock', tagline: 'Red cliffs, boulders and rockfalls', icon: 'mountain',
    accent: '#ff7a4d', card: ['#a8432a', '#3a120a'],
    ground: ['#a85d3c', '#b2683f'], speck: ['rgba(90,30,10,0.25)', 'rgba(240,170,120,0.2)'],
    sky: 0xe6b494, hemi: [0xffe4d0, 0x7a3a22, 1.9], sun: [0xffd0a0, 2.4],
    pilotFog: 0xd8a888, walls: 'rock', decor: 'spire',
    spire: [0.025, 0.55, 0.4, 0.1],
    pillar: 0x9c4a2e, wall: 0x8c4028, roof: 0x7a3a24, mover: 0x8a4a30,
  },
  arctic: {
    name: 'Arctic', tagline: 'Ice walls, snow and blizzards', icon: 'snowflake',
    accent: '#8fd8ff', card: ['#5a8fb8', '#13283e'],
    ground: ['#e6edf3', '#dbe5ee'], speck: ['rgba(120,150,180,0.18)', 'rgba(255,255,255,0.5)'],
    sky: 0xd4e0ec, hemi: [0xf0f6ff, 0x8aa0b8, 1.8], sun: [0xf4f8ff, 2.0],
    pilotFog: 0xe2eaf2, walls: 'rock', decor: 'ice',
    spire: [0.57, 0.25, 0.82, 0.08],
    pillar: 0x9cc6de, wall: 0xa9d2ea, roof: 0x8bb4cc, mover: 0xc8dcea,
  },
  lava: {
    name: 'Lava', tagline: 'Basalt, glowing lava and fire rain', icon: 'flame',
    accent: '#ff5a2a', card: ['#8a1e0a', '#1a0604'],
    ground: ['#2a2220', '#302624'], speck: ['rgba(0,0,0,0.35)', 'rgba(120,60,40,0.2)'],
    sky: 0x4a2a24, hemi: [0xffb08a, 0x2a1008, 1.2], sun: [0xff9a60, 1.4],
    pilotFog: 0x4c2a22, walls: 'rock', decor: 'basalt', lavaGlow: true,
    spire: [0.02, 0.12, 0.13, 0.05],
    pillar: 0x2e2624, wall: 0x2a2220, roof: 0x241c1a, mover: 0x3a1a10, moverGlow: 0xff5a10,
    glow: 0x3a0e04,                                     // svag glöd i klippor och hinder
  },
};

// Väder: vindstyrka (oskalad) och vilka partiklar som syns
export const WEATHER = {
  calm: { name: 'Clear', wind: 0, icon: 'sun' },
  breeze: { name: 'Breezy', wind: 1.2, icon: 'wind' },
  heat: { name: 'Hot wind', wind: 1.0, icon: 'sun' },
  sandstorm: { name: 'Sandstorm', wind: 2.4, particles: 'sand', icon: 'wind', dense: true },
  rain: { name: 'Rain', wind: 1.2, particles: 'rain', icon: 'rain' },
  storm: { name: 'Thunderstorm', wind: 2.0, particles: 'rain', lightning: true, icon: 'bolt', dense: true },
  snow: { name: 'Snow', wind: 1.6, particles: 'snow', icon: 'snow' },
  blizzard: { name: 'Blizzard', wind: 2.6, particles: 'snow', icon: 'snow', dense: true },
  embers: { name: 'Fire rain', wind: 1.4, particles: 'embers', icon: 'flame' },
  eruption: { name: 'Eruption', wind: 2.2, particles: 'embers', lightning: true, icon: 'flame', dense: true },
};

// Svårighet: 1–5 pluppar
export const TIERS = ['', 'Easy', 'Normal', 'Medium', 'Hard', 'Extreme'];
export function tierOf(n) {
  return n <= 3 ? 1 : n <= 7 ? 2 : n <= 11 ? 3 : n <= 15 ? 4 : 5;
}
