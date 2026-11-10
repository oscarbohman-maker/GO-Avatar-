// Appens styrning: menyer (start, free play, vänner, inställningar), lobby,
// spelstart i olika lägen, nätverksmeddelanden, HUD och resultat.
import { Net, PROTOCOL_VERSION, normalizeCode, CODE_LENGTH } from './net.js';
import { Voice } from './voice.js';
import { Store } from './storage.js';
import { MAPS, LEVEL_INFO, buildLevel } from './levels.js';
import { sfx, unlockAudio, setSfxEnabled } from './sfx.js';
import { NpcNavigator, NpcVoice } from './npc.js';
import { icon, applyIcons, setIconLabel } from './icons.js';
import { POINTS } from './sim.js';
import { THEMES, WEATHER } from './themes.js';
import { Account } from './account.js';
import { SKINS, RARITY, RARITY_ORDER, skinById } from './skins.js';
import { levelInfo, maxScoreOf, rankOf } from './progress.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const ROLE = {
  pilot: { name: 'Pilot', icon: 'plane', desc: 'Flies blind through the fog' },
  navigator: { name: 'Navigator', icon: 'compass', desc: 'Rides along, sees far ahead and guides' },
};
const other = (r) => (r === 'pilot' ? 'navigator' : 'pilot');

const app = {
  net: null,
  voice: null,
  isHost: false,
  hostRole: 'pilot',
  friendName: null,
  levelId: 'test',
  // 'online' | 'npc' (pilot + NPC-navigatör) | 'navai' (navigatör + AI-pilot) | 'solo' (pilot + karta)
  mode: 'online',
  npcVoice: null,
  aiPilot: null,
  game: null,
  inGame: false,
};
const isSolo = () => app.mode !== 'online';
const myRole = () => {
  if (app.mode === 'navai') return 'navigator';
  if (isSolo()) return 'pilot';
  return app.isHost ? app.hostRole : other(app.hostRole);
};
// Skicka till den andra spelaren (vän över nätet, eller den lokala AI-piloten)
function toPeer(msg) {
  if (app.net) app.net.send(msg);
  else if (app.aiPilot) app.aiPilot.handle(msg);
}

// ---------------------------------------------------------------- hjälp
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function myName() { return Store.profile.name || 'Player'; }

let current = 'screen-home';
function show(id) {
  current = id;
  closeGameMenu();
  if (id !== 'screen-shop' && shopPreview) shopPreview.stop();
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  const sc = $('#' + id);
  if (sc && sc.classList.contains('menu-screen')) sc.scrollTop = 0;
}

function message(title, text, onOk) {
  const ov = $('#overlay-msg');
  $('.ov-title', ov).textContent = title;
  $('.ov-text', ov).textContent = text;
  ov.classList.remove('hidden');
  $('#btn-ov').onclick = () => { ov.classList.add('hidden'); onOk && onOk(); };
}

function setStatus(el, text, cls = '') {
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status ' + cls;
}

// Pekskärm? (kan tvingas på/av i inställningarna)
function applyTouchSetting() {
  const pref = Store.profile.touchControls;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const auto = coarse || 'ontouchstart' in window || app._touched;
  document.body.classList.toggle('touch', pref === 'on' || (pref === 'auto' && !!auto));
  applyCompact();
}

// Kompakt spelvy på mobil och små skärmar: smal HUD, meny-knapp, mindre kontroller och popups
function applyCompact() {
  const small = window.matchMedia && window.matchMedia('(max-width: 900px), (max-height: 540px)').matches;
  document.body.classList.toggle('compact-ui', !!small || document.body.classList.contains('touch'));
}
window.addEventListener('resize', applyCompact);
window.addEventListener('touchstart', () => { app._touched = true; applyTouchSetting(); }, { once: true, passive: true });
// Safari: hindra nyp-zoom i spelet
document.addEventListener('gesturestart', (e) => e.preventDefault());

// Mjuk "ripple" när man trycker på en knapp
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('.btn, .mode-opt, .map-card:not(.locked)');
  if (!b) return;
  const r = b.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.width = s.style.height = d + 'px';
  s.style.left = (e.clientX - r.left - d / 2) + 'px';
  s.style.top = (e.clientY - r.top - d / 2) + 'px';
  b.appendChild(s);
  setTimeout(() => s.remove(), 600);
}, { passive: true });
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('[data-sfx]')) { unlockAudio(); sfx.click(); }
});

// ---------------------------------------------------------------- start
function renderRecords() {
  const p = Store.profile;
  const el = $('#records');
  const chips = [];
  for (const m of MAPS) {
    const b = m.available && p.best[m.id];
    if (b) chips.push(`<span class="chip">${esc(m.name)}: <b>${b.score != null ? b.score + ' pts' : b.time.toFixed(1) + ' s'}</b></span>`);
  }
  if (p.history.length) chips.push(`<span class="chip">${p.history.length} flights</span>`);
  el.innerHTML = chips.join('');
}

function initMenus() {
  $('#btn-freeplay').onclick = () => { renderMapGrid(); show('screen-freeplay'); };
  $('#btn-friends').onclick = () => { $('#name-input').value = Store.profile.name; show('screen-friends'); };
  $('#btn-settings').onclick = () => { renderSettings(); show('screen-settings'); };
  $$('[data-back]').forEach((b) => { b.onclick = () => { sfx.click(); show(b.dataset.back); if (b.dataset.back === 'screen-home') renderRecords(); }; });

  // vänner
  const nameIn = $('#name-input');
  nameIn.addEventListener('input', () => Store.setName(nameIn.value.trim()));
  const codeIn = $('#code-input');
  codeIn.addEventListener('input', () => { codeIn.value = normalizeCode(codeIn.value); });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
  $('#btn-create').onclick = () => { unlockAudio(); hostGame(); };
  $('#btn-join').onclick = () => {
    unlockAudio();
    const code = normalizeCode(codeIn.value);
    if (code.length !== CODE_LENGTH) { setStatus($('#friends-status'), `The code must be ${CODE_LENGTH} characters.`, 'error'); return; }
    joinGame(code);
  };

  // val av roll i free play
  const sheet = $('#mode-sheet');
  $('.sheet-cancel', sheet).onclick = () => sheet.classList.add('hidden');
  $('.ms-close', sheet).onclick = () => { sfx.click(); sheet.classList.add('hidden'); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.classList.contains('hidden')) sheet.classList.add('hidden'); });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.classList.add('hidden'); });
  $$('.mode-opt', sheet).forEach((b) => {
    b.onclick = () => {
      unlockAudio();
      sheet.classList.add('hidden');
      const mode = b.dataset.mode;
      if (mode === 'npc') {
        // talet måste "låsas upp" direkt i knapptrycket (Safari)
        if (!app.npcVoice) app.npcVoice = new NpcVoice();
        app.npcVoice.unlock();
      }
      startSolo(mode, sheet.dataset.level);
    };
  });

  renderRecords();

  // Inbjudningslänk: ?join=KOD
  const q = new URLSearchParams(location.search);
  const j = q.get('join');
  if (j) {
    codeIn.value = normalizeCode(j);
    q.delete('join');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
    if (codeIn.value.length === CODE_LENGTH) { show('screen-friends'); joinGame(codeIn.value); }
  }
}

// ---------------------------------------------------------------- free play
// Världarna i Free Play: först träningsbanorna, sedan ett tema i taget
const WORLDS = [
  { key: 'training', name: 'Training', tagline: 'Learn to fly blind and to guide', icon: 'target', accent: '#4dd0ff', maps: [1, 2] },
  ...['forest', 'desert', 'jungle', 'redrock', 'arctic', 'lava'].map((k) => ({
    key: k, name: THEMES[k].name, tagline: THEMES[k].tagline, icon: THEMES[k].icon, accent: THEMES[k].accent,
    maps: MAPS.filter((m) => m.n > 2 && m.theme === k).map((m) => m.n),
  })),
];
const fmt = (n) => Math.round(n || 0).toLocaleString('en-US');
const thumbUrl = (m) => `img/maps/${m.id}.jpg`;

// Svårighet som 1–5 pluppar
function pips(tier) {
  let h = '';
  for (let i = 1; i <= 5; i++) h += `<i class="${i <= tier ? 'on' : ''}"></i>`;
  return `<span class="pips t${tier}" role="img" aria-label="Difficulty ${tier} of 5">${h}</span>`;
}

// Fakta om en karta (byggs första gången den behövs)
const statsCache = {};
function mapStats(id) {
  if (statsCache[id]) return statsCache[id];
  const L = buildLevel(id);
  let len = 0;
  const P = L.path || [];
  for (let i = 0; i < P.length - 1; i++) len += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][2] - P[i][2]);
  const hazards = [...new Set((L.zones || []).map((z) => z.type))];
  return (statsCache[id] = { gates: L.gates.length, stars: (L.stars || []).length, len, par: L.par, hazards });
}

function mapCard(m, opts = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'map-card' + (m.available ? '' : ' locked') + (opts.selected ? ' selected' : '') + (opts.compact ? ' compact' : '');
  const T = THEMES[m.theme] || THEMES.forest;
  const WX = WEATHER[m.weather] || WEATHER.calm;
  el.style.setProperty('--acc', T.accent);
  el.style.setProperty('--c1', T.card[0]);
  el.style.setProperty('--c2', T.card[1]);
  const best = m.available && Store.profile.best[m.id];
  el.setAttribute('aria-label', `Map ${m.n}: ${m.name}. ${m.difficulty}, difficulty ${m.tier} of 5. ${best ? 'Best ' + fmt(best.score) + ' points.' : 'Not flown yet.'}`);
  el.innerHTML = `<span class="mc-thumb">${m.available ? '<img alt="" loading="lazy" decoding="async">' : ''}`
    + `<span class="mc-num">${String(m.n).padStart(2, '0')}</span>`
    + (best ? `<span class="mc-done" title="Completed">${icon('check')}</span>` : '')
    + (opts.compact ? '' : `<span class="mc-wx">${icon(WX.icon)}<span>${esc(WX.name)}</span></span>`)
    + (m.available ? '' : `<span class="mc-lock">${icon('lock')}</span>`)
    + `</span><span class="mc-body"><span class="mc-name">${esc(m.available ? m.name : 'Coming soon')}</span>`
    + `<span class="mc-meta">${pips(m.tier)}<span class="mc-diff">${esc(m.difficulty)}</span></span>`
    + (opts.compact ? '' : `<span class="mc-best">${best
      ? `${icon('award')}<b>${fmt(best.score)}</b><span>pts</span><span class="dot"></span>${icon('star')}<b>${best.stars || 0}</b>`
      : '<span class="muted">Not flown yet</span>'}</span>`)
    + '</span>';
  const img = el.querySelector('img');
  if (img) {
    img.addEventListener('load', () => el.classList.add('loaded'));
    img.addEventListener('error', () => img.remove());
    img.src = thumbUrl(m);
  }
  if (!m.available) el.disabled = true;
  return el;
}

function renderMapGrid() {
  const root = $('#map-grid');
  root.innerHTML = '';
  const best = Store.profile.best;
  const flown = MAPS.filter((m) => m.available && best[m.id]);
  $('#fp-progress').innerHTML = `<span><b>${flown.length}</b>/${MAPS.length} flown</span><span class="dot"></span>`
    + `<span>${icon('star')}<b>${flown.reduce((a, m) => a + (best[m.id].stars || 0), 0)}</b></span><span class="dot"></span>`
    + `<span>${icon('award')}<b>${fmt(flown.reduce((a, m) => a + (best[m.id].score || 0), 0))}</b> pts</span>`;
  let k = 0;
  WORLDS.forEach((w) => {
    const sec = document.createElement('section');
    sec.className = 'world';
    sec.style.setProperty('--acc', w.accent);
    const done = w.maps.filter((n) => best[MAPS[n - 1].id]).length;
    sec.innerHTML = `<header class="world-head"><span class="world-ico">${icon(w.icon)}</span>`
      + `<div class="world-title"><h3>${esc(w.name)}</h3><p>${esc(w.tagline)}</p></div>`
      + `<span class="world-count">Maps ${w.maps[0]}–${w.maps[w.maps.length - 1]}<small>${done}/${w.maps.length} flown</small></span></header>`
      + '<div class="map-grid"></div>';
    const grid = sec.querySelector('.map-grid');
    w.maps.forEach((n) => {
      const m = MAPS[n - 1];
      const el = mapCard(m);
      el.style.animationDelay = (k++ * 0.03) + 's';
      if (m.available) el.onclick = () => { sfx.click(); openModeSheet(m); };
      grid.appendChild(el);
    });
    root.appendChild(sec);
  });
}

function openModeSheet(m) {
  const sheet = $('#mode-sheet');
  sheet.dataset.level = m.id;
  const T = THEMES[m.theme] || THEMES.forest;
  const WX = WEATHER[m.weather] || WEATHER.calm;
  const st = mapStats(m.id);
  const best = Store.profile.best[m.id];
  const panel = $('.sheet-panel', sheet);
  panel.style.setProperty('--acc', T.accent);
  panel.style.setProperty('--c1', T.card[0]);
  panel.style.setProperty('--c2', T.card[1]);
  const img = $('.ms-img', sheet);
  img.classList.remove('loaded');
  img.onload = () => img.classList.add('loaded');
  img.src = thumbUrl(m);
  $('.ms-world', sheet).innerHTML = `${icon(T.icon)}<span>${esc(m.n <= 2 ? 'Training' : T.name)} · Map ${m.n}</span>`;
  $('.sheet-title', sheet).textContent = m.name;
  $('.ms-tags', sheet).innerHTML = `<span class="ms-tag">${pips(m.tier)}<b>${esc(m.difficulty)}</b></span>`
    + `<span class="ms-tag">${icon(WX.icon)}<b>${esc(WX.name)}</b></span>`;
  const tile = (ic, v, label) => `<div class="ms-stat">${icon(ic)}<b>${v}</b><small>${label}</small></div>`;
  $('.ms-stats', sheet).innerHTML = tile('target', st.gates, 'Gates')
    + tile('star', st.stars, 'Stars')
    + tile('ruler', (st.len / 1000).toFixed(1) + ' km', 'Length')
    + tile('award', best ? fmt(best.score) : '—', 'Your best');
  $('.ms-hazards', sheet).innerHTML = st.hazards.map((h) => `<span class="chip">${esc(h)}</span>`).join('');
  sheet.classList.remove('hidden');
  panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
}

// ---------------------------------------------------------------- inställningar
function renderSettings() {
  const p = Store.profile;
  $('#set-name').value = p.name;
  $('#set-invert').checked = p.invertY;
  $('#set-sens').value = p.sensitivity;
  $('#set-sens-val').textContent = Math.round(p.sensitivity * 100) + '%';
  $('#set-sfx').checked = p.sfx;
  $('#set-voice').checked = p.npcVoice;
  $$('#set-touch button').forEach((b) => b.classList.toggle('on', b.dataset.v === p.touchControls));
}

function initSettings() {
  $('#set-name').addEventListener('input', (e) => Store.setName(e.target.value.trim()));
  $('#set-invert').addEventListener('change', (e) => Store.setSetting('invertY', e.target.checked));
  $('#set-sens').addEventListener('input', (e) => {
    Store.setSetting('sensitivity', e.target.value);
    $('#set-sens-val').textContent = Math.round(Store.profile.sensitivity * 100) + '%';
  });
  $('#set-sfx').addEventListener('change', (e) => { Store.setSetting('sfx', e.target.checked); setSfxEnabled(Store.profile.sfx); if (Store.profile.sfx) { unlockAudio(); sfx.click(); } });
  $('#set-voice').addEventListener('change', (e) => Store.setSetting('npcVoice', e.target.checked));
  $$('#set-touch button').forEach((b) => {
    b.onclick = () => { Store.setSetting('touchControls', b.dataset.v); applyTouchSetting(); renderSettings(); sfx.click(); };
  });
  $('#btn-reset-settings').onclick = () => { Store.resetSettings(); setSfxEnabled(Store.profile.sfx); applyTouchSetting(); renderSettings(); };
}

// ---------------------------------------------------------------- nätverk
function cleanupNet() {
  if (app.net && app.net.connected) app.net.send({ t: 'bye' });
  if (app.voice) { app.voice.destroy(); app.voice = null; }
  if (app.net) { app.net.close(); app.net = null; }
  clearInterval(app._expiryTimer);
  app.friendName = null;
  $$('.voice-btn').forEach((b) => { b.classList.add('hidden'); b.classList.remove('on', 'muted'); setIconLabel(b, 'mic', 'Voice off'); });
  $('#btn-audio-tap').classList.add('hidden');
}

function goHome(statusText, cls, screen = 'screen-home') {
  endGame();
  cleanupNet();
  app.mode = 'online';
  document.body.classList.remove('is-host');
  if (screen === 'screen-freeplay') renderMapGrid();
  show(screen);
  renderRecords();
  setStatus($('#home-status'), statusText || '', cls);
  setStatus($('#friends-status'), statusText || '', cls);
}

function wireNet(net) {
  net.on('message', onMessage);
  net.on('close', () => friendLost(net, false));
  net.on('error', (text) => {
    if (app.net !== net) return;
    if (net.connected) { console.warn(text); return; }
    if (app.isHost) setStatus($('#lobby-status'), text, 'error');
    else goHome(text, 'error', 'screen-friends');
  });
  net.on('status', (st) => {
    if (app.net !== net) return;
    if (net.isHost) {
      if (st === 'reconnecting' && !net.connected) setStatus($('#lobby-status'), 'Reconnecting to the server... keep this screen open.');
      if (st === 'online' && !app.friendName) setStatus($('#lobby-status'), 'Ready! Give the code to your friend. Keep this screen open until they have joined.', 'ok');
    } else {
      const T = {
        server: 'Contacting the server...',
        finding: `Looking for game ${net.code}...`,
        retry: `Game ${net.code} not found yet – trying again...`,
        linking: 'Found your friend! Connecting...',
        relay: 'Direct connection blocked by the network – connecting through the relay...',
      };
      if (T[st]) setStatus($('#friends-status'), T[st]);
    }
  });
  net.on('open', () => {
    if (app.net !== net) return;
    // Via reläet fungerar inte röstchatten (den kräver en direktanslutning)
    if (net.relay) {
      app._relayNote = 'Connected through the relay – in-game voice chat is not available, call each other instead.';
    } else { app._relayNote = ''; setupVoice(); }
    if (!app.isHost) net.send({ t: 'hello', name: myName(), ver: PROTOCOL_VERSION, skin: mySkin() });
  });
}

// Vännen lämnade eller tappade anslutningen
function friendLost(net, left) {
  if (app.net !== net) return;
  const who = app.friendName || 'Your friend';
  if (app.isHost) {
    // Värden stannar kvar i lobbyn – en vän kan gå med igen med samma kod
    if (!app.friendName && !app.inGame) return; // redan hanterat
    try { net.conn && net.conn.close(); } catch (_) {}
    endGame();
    if (app.voice) { app.voice.destroy(); app.voice = null; }
    $$('.voice-btn').forEach((b) => { b.classList.add('hidden'); b.classList.remove('on', 'muted'); });
    $('#btn-audio-tap').classList.add('hidden');
    app.friendName = null;
    renderLobby();
    show('screen-lobby');
    setStatus($('#lobby-status'), (left ? who + ' left the game.' : 'The connection to ' + who + ' was lost.') + ' The same code still works – your friend can join again.', 'error');
  } else {
    goHome('', '', 'screen-friends');
    message(left ? 'The host left' : 'Connection lost',
      left ? who + ' ended the game.' : 'Lost contact with ' + who + '. Join again with the code if the game is still open.');
  }
}

function formatLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
}

function updateExpiry() {
  const net = app.net;
  if (!net || !net.isHost) return;
  const left = net.expiresIn;
  if (left <= 0) {
    net.expire();
    $('#code-expiry').textContent = 'Code expired';
    if (!app.friendName) setStatus($('#lobby-status'), 'This code has expired. Leave and create a new game.', 'error');
    clearInterval(app._expiryTimer);
    return;
  }
  $('#code-expiry').textContent = `Valid for ${formatLeft(left)}`;
}

function hostGame() {
  cleanupNet();
  app.isHost = true;
  app.mode = 'online';
  if (!LEVEL_INFO[app.levelId]) app.levelId = 'test';
  document.body.classList.add('is-host');
  app.net = new Net();
  wireNet(app.net);
  app.net.on('code', (code) => {
    $('#lobby-code').textContent = code;
    setStatus($('#lobby-status'), 'Ready! Give the code to your friend. Keep this screen open until they have joined.', 'ok');
    updateExpiry();
    clearInterval(app._expiryTimer);
    app._expiryTimer = setInterval(updateExpiry, 30000);
  });
  $('#lobby-code').textContent = '·'.repeat(CODE_LENGTH);
  $('#code-expiry').textContent = '';
  setStatus($('#lobby-status'), 'Creating game...');
  renderLobby();
  show('screen-lobby');
  try { app.net.host(); } catch (e) { setStatus($('#lobby-status'), e.message, 'error'); }
}

function joinGame(code) {
  cleanupNet();
  app.isHost = false;
  app.mode = 'online';
  document.body.classList.remove('is-host');
  setStatus($('#friends-status'), 'Connecting to ' + code + '...');
  app.net = new Net();
  wireNet(app.net);
  try { app.net.join(code); } catch (e) { goHome(e.message, 'error', 'screen-friends'); }
}

function onMessage(m) {
  switch (m.t) {
    // ---- lobby
    case 'hello':
      if (!app.isHost) return;
      app.friendName = String(m.name || 'Friend').slice(0, 16);
      app.friendSkin = skinById(m.skin).id;
      if (m.ver !== PROTOCOL_VERSION) setStatus($('#lobby-status'), 'Warning: your friend has a different version of the game. Reload the page.', 'error');
      else setStatus($('#lobby-status'), app.friendName + ' joined!' + (app._relayNote ? ' ' + app._relayNote : ''), 'ok');
      app.net.send({ t: 'welcome', name: myName(), hostRole: app.hostRole, level: app.levelId, ver: PROTOCOL_VERSION, skin: mySkin() });
      renderLobby();
      break;
    case 'welcome':
      app.friendName = String(m.name || 'Friend').slice(0, 16);
      app.friendSkin = skinById(m.skin).id;
      app.hostRole = m.hostRole === 'navigator' ? 'navigator' : 'pilot';
      app.levelId = LEVEL_INFO[m.level] ? m.level : 'test';
      $('#lobby-code').textContent = app.net.code;
      $('#code-expiry').textContent = '';
      setStatus($('#lobby-status'), m.ver !== PROTOCOL_VERSION ? 'Warning: different game versions. Reload the page.' : 'Connected to ' + app.friendName + '!' + (app._relayNote ? ' ' + app._relayNote : ''), m.ver !== PROTOCOL_VERSION ? 'error' : 'ok');
      renderLobby();
      show('screen-lobby');
      break;
    case 'bye':
      friendLost(app.net, true);
      break;
    case 'full':
      if (app.isHost) break;
      goHome('The game is already full (two players).', 'error', 'screen-friends');
      break;
    case 'expired':
      if (app.isHost) break;
      goHome('That code has expired. Ask your friend to create a new game.', 'error', 'screen-friends');
      break;
    case 'roles':
      app.hostRole = m.hostRole === 'navigator' ? 'navigator' : 'pilot';
      renderLobby();
      break;
    case 'level':
      if (LEVEL_INFO[m.level]) { app.levelId = m.level; renderLobby(); }
      break;
    case 'start':
      app.hostRole = m.hostRole === 'navigator' ? 'navigator' : 'pilot';
      if (LEVEL_INFO[m.level]) app.levelId = m.level;
      startGame();
      break;
    case 'lobby':
      backToLobby(false);
      break;
    // ---- spel
    case 'st':
      if (app.game && app.game.role === 'navigator') app.game.onState(m);
      break;
    case 'ev':
      if (app.game && app.game.role === 'navigator') handleEvent(m.e);
      break;
    case 'go':
      if (app.game && app.game.role === 'pilot') app.game.begin();
      break;
    case 'restart':
      if (app.game) app.game.restart(false);
      break;
    case 'gest':
      if (app.game && app.game.role === 'pilot' && GESTURES.includes(m.g)) app.game.gesture(m.g);
      break;
    case 'route':
      if (app.game && app.game.role === 'pilot' && Array.isArray(m.pts)) {
        const pts = m.pts.slice(0, 60).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        app.game.setRoute(pts);
      }
      break;
  }
}

const GESTURES = ['left', 'right', 'up', 'down', 'press'];
const GESTURE_ICON = { left: '←', right: '→', up: '↑', down: '↓' };

// ---------------------------------------------------------------- röst
function setupVoice() {
  if (app.voice || !app.net || !app.net.peer) return;
  const btns = $$('.voice-btn');
  const tap = $('#btn-audio-tap');
  app.voice = new Voice(app.net, $('#remote-audio'), (state) => {
    btns.forEach((btn) => {
      btn.classList.toggle('on', state === 'on');
      btn.classList.toggle('muted', state === 'muted');
      setIconLabel(btn, state === 'muted' ? 'micOff' : 'mic', state === 'on' ? 'Voice on' : state === 'muted' ? 'Muted' : 'Voice off');
    });
    tap.classList.toggle('hidden', !(app.voice && app.voice.needsTap));
  });
  btns.forEach((btn) => {
    btn.classList.remove('hidden');
    setIconLabel(btn, 'mic', 'Voice off');
    btn.onclick = async () => {
      const v = app.voice;
      if (!v) return;
      if (v.state === 'off') {
        try { await v.enable(); }
        catch (e) {
          const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
          message('Could not start the microphone', denied ? 'Allow the microphone for this page in Safari and try again. You can also call each other instead.' : ((e && e.message) || 'Unknown error.'));
        }
      } else v.toggleMute();
    };
  });
  tap.onclick = () => app.voice && app.voice.resumePlayback();
}

// ---------------------------------------------------------------- lobby
function renderLobby() {
  const mine = myRole();
  const fill = (slot, name, role, empty) => {
    const el = $(slot);
    el.classList.toggle('empty', !!empty);
    $('.role-icon', el).innerHTML = icon(empty ? 'user' : ROLE[role].icon);
    $('.pname', el).textContent = empty ? 'Waiting for a friend...' : name;
    $('.prole', el).textContent = empty ? 'Share the code above' : ROLE[role].name + ' – ' + ROLE[role].desc;
  };
  fill('#slot-me', myName() + ' (you)', mine, false);
  fill('#slot-friend', app.friendName, other(mine), !app.friendName);

  const list = $('#lobby-maps');
  list.innerHTML = '';
  for (const m of MAPS.filter((x) => x.available)) {
    const el = mapCard(m, { selected: m.id === app.levelId, compact: true });
    if (app.isHost) el.onclick = () => { sfx.click(); app.levelId = m.id; app.net && app.net.send({ t: 'level', level: m.id }); renderLobby(); };
    else el.style.cursor = 'default';
    list.appendChild(el);
  }
  // den valda kartan syns mitt i raden
  const sel = $('.map-card.selected', list);
  if (sel) list.scrollLeft = sel.offsetLeft - list.offsetLeft - (list.clientWidth - sel.offsetWidth) / 2;
  $('#btn-start').disabled = !(app.isHost && app.friendName && app.net && app.net.connected);
}

function initLobby() {
  $('#btn-swap').onclick = () => {
    app.hostRole = other(app.hostRole);
    app.net && app.net.send({ t: 'roles', hostRole: app.hostRole });
    renderLobby();
  };
  $('#btn-start').onclick = () => {
    if (!app.net || !app.net.connected) return;
    unlockAudio();
    app.net.send({ t: 'start', level: app.levelId, hostRole: app.hostRole });
    startGame();
  };
  $('#btn-leave').onclick = () => { sfx.click(); goHome('', '', 'screen-friends'); };
  $('#btn-share').onclick = async () => {
    const code = app.net && app.net.code;
    if (!code) return;
    const q = new URLSearchParams(location.search);
    q.set('join', code);
    const url = location.origin + location.pathname + '?' + q.toString();
    const text = `Fly with me in Plain Dodge! Code: ${code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Plain Dodge!', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(url);
      setStatus($('#lobby-status'), 'Link copied!', 'ok');
    } catch (_) {
      window.prompt('Copy the link:', url);
    }
  };
}

function backToLobby(notify) {
  if (notify && app.net) app.net.send({ t: 'lobby' });
  endGame();
  if (isSolo() || !app.net) { goHome('', '', 'screen-freeplay'); return; }
  renderLobby();
  show('screen-lobby');
}

// ---------------------------------------------------------------- spel
let flashTimer = null;
function flash(text, cls = '', ms = 1100, html = false) {
  const el = app.game && app.game.msgEl;
  if (!el) return;
  if (html) el.innerHTML = text; else el.textContent = text;
  el.className = 'center-msg ' + cls;
  void el.offsetWidth;   // starta om animationen
  el.className = 'center-msg show ' + cls;
  clearTimeout(flashTimer);
  if (ms) flashTimer = setTimeout(() => { el.className = 'center-msg'; }, ms);
}

// HUD:ens poäng studsar och ett flytande "+poäng" stiger upp
function bumpScore(pts, gold) {
  $$('.hud-item.score').forEach((el) => {
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    if (!pts || !el.offsetParent) return;
    const f = document.createElement('span');
    f.className = 'score-float' + (gold ? ' gold' : '');
    f.textContent = '+' + pts;
    el.appendChild(f);
    setTimeout(() => f.remove(), 1100);
  });
}

function handleEvent(e) {
  const g = app.game;
  if (!g) return;
  switch (e.kind) {
    case 'go': flash('GO!', 'good big', 700); sfx.go(); break;
    case 'pass':
      if (g.gateBurst) g.gateBurst(e);
      if (!e.finished) {
        rewardPopup(e);
        if (e.perfect) sfx.perfect(); else sfx.gate(e.combo || 1);
        if (e.mult > 1 && comboMultPrev(e) < e.mult) sfx.combo();
        bumpScore(e.bonus, e.perfect);
      }
      break;
    case 'miss': flash(`Missed gate ${e.gate + 1}! <small>+${g.level.penalties.miss} s</small>`, 'bad', 1300, true); sfx.miss(); break;
    case 'crash':
      flash(`CRASH! <small>into ${esc(e.what)} · back to the start</small>`, 'bad', 1800, true); sfx.crash();
      if (g.onCrash) g.onCrash(e);
      break;
    case 'respawn': if (g.onRespawn) g.onRespawn(); break;
    case 'star':
      flash(`⭐ ${e.count}/${e.total} <small>+${e.points} points</small>`, 'gold', 700, true);
      sfx.star();
      bumpScore(e.points, false);
      if (g.onStar) g.onStar(e.idx);
      break;
    case 'finish': sfx.finish(); showResults(e); break;
  }
}

// ---- belöningar --------------------------------------------------------
const COMBO_STEPS = [[8, 3], [5, 2], [3, 1.5]];
const multOf = (c) => { for (const [n, m] of COMBO_STEPS) if (c >= n) return m; return 1; };
const comboMultPrev = (e) => multOf((e.combo || 1) - 1);
const PRAISE = ['Nice!', 'Great!', 'Sweet!', 'Clean!', 'Smooth!'];
const COMBO_WORDS = { 1.5: 'COMBO', 2: 'SUPER COMBO', 3: 'MEGA COMBO' };

// Stort färgglatt kort mitt på skärmen + blixt i skärmkanterna
function rewardPopup(e) {
  const g = app.game;
  if (!g) return;
  const root = g.role === 'pilot' ? $('#pilot-ui') : $('#nav-ui');
  const pop = $('.reward', root), edge = $('.edge-flash', root);
  const tier = e.perfect ? 'perfect' : e.mult >= 2 ? 'combo' : e.mult > 1 ? 'streak' : 'gate';
  const levelUp = e.mult > 1 && comboMultPrev(e) < e.mult;
  const title = e.perfect ? 'PERFECT!' : levelUp ? COMBO_WORDS[e.mult] + '!' : PRAISE[(e.gate || 0) % PRAISE.length];
  $('.rw-title', pop).textContent = title;
  $('.rw-pts', pop).textContent = '+' + e.bonus;
  const chip = $('.rw-mult', pop);
  chip.textContent = '×' + e.mult;
  chip.classList.toggle('hidden', !(e.mult > 1));
  $('.rw-streak', pop).textContent = (e.combo || 1) >= 2 ? `${e.combo} in a row` : `Gate ${e.gate + 1}`;
  pop.className = 'reward show tier-' + tier + (levelUp ? ' level-up' : '');
  void pop.offsetWidth;
  pop.classList.add('anim');
  edge.className = 'edge-flash tier-' + tier;
  void edge.offsetWidth;
  edge.classList.add('anim');
  clearTimeout(g._rwT);
  g._rwT = setTimeout(() => { pop.className = 'reward'; }, levelUp ? 1500 : 1100);
}

function updateCombo(root, snap) {
  const el = $('.combo-meter', root);
  if (!el) return;
  const c = snap.ph === 'fly' || snap.ph === 'finished' ? (snap.cb || 0) : 0;
  const m = multOf(c);
  el.classList.toggle('on', c >= 2);
  el.dataset.m = String(m);
  $('.cm-mult', el).textContent = '×' + m;
  $('.cm-count', el).textContent = c + ' in a row';
  // framsteg mot nästa nivå
  const next = c >= 8 ? null : c >= 5 ? 8 : c >= 3 ? 5 : 3;
  const prev = c >= 8 ? 8 : c >= 5 ? 5 : c >= 3 ? 3 : 0;
  $('.cm-fill', el).style.width = (next ? ((c - prev) / (next - prev)) * 100 : 100) + '%';
}

function updateHud(root, snap, level) {
  updateCombo(root, snap);
  const total = level.gates.length;
  $$('.hud-time', root).forEach((el) => { el.textContent = snap.tm.toFixed(1); });
  $$('.hud-gate', root).forEach((el) => { el.textContent = Math.min(snap.ng + 1, total) + '/' + total; });
  $$('.hud-score', root).forEach((el) => { el.textContent = String(snap.pts || 0); });
  $$('.hud-speed', root).forEach((el) => { el.textContent = String(Math.round(snap.sp * 3.6)); });
  $$('.hud-alt', root).forEach((el) => { el.textContent = Math.round(snap.y) + ' m'; });
  $$('.hud-star', root).forEach((el) => { el.textContent = (snap.sc || 0) + '/' + ((level.stars && level.stars.length) || 0); });
}

function countdownDisplay(g, snap) {
  if (snap.ph === 'countdown') {
    const n = Math.max(1, Math.ceil(snap.cd));
    if (g._cd !== n) { g._cd = n; flash(String(n), 'big', 0); sfx.tick(); }
  } else if (g._cd) {
    g._cd = 0;
  }
}

// ---- cutscene vid början av banan
// Repliker: navigatören kommenterar världen, piloten svarar. Samma för båda spelarna (väljs efter kartan).
// Två repliker per värld (navigatören, sedan piloten), som passar världens händelse i cutscenen.
const SCENE_LINES = {
  canyon: [
    ['Training run. Just you, me and a whole lot of rock walls.', 'Rule one: listen to the navigator. Rule two: never touch the walls.'],
    ["Warm-up lap. Show me what you've got.", "I can't even see the walls… so let's make this look good."],
  ],
  forest: [
    ['Fog is rolling in over the pines. From here on, you fly on my voice.', "Then keep talking. I'm not losing you in there."],
    ["We've got company — a whole flock flying with us.", "Let's show them how it's done. Lead the way."],
  ],
  desert: [
    ["Sandstorm dead ahead. In ten seconds, neither of us will see a thing.", "Then it's a fair fight. Take me through it."],
    ['That wall of sand is swallowing the canyon. Stay low, stay with me.', "Low and steady. Let's ride it out."],
  ],
  jungle: [
    ['Lightning over the canopy. Somewhere in that storm is a temple — and our way through.', 'Thunder, rain and ancient ruins. Take us in.'],
    ['The monsoon is breaking. Every turn I call, you take — no hesitation.', "No hesitation. I'm with you."],
  ],
  redrock: [
    ["The cliffs are coming down! I'll call every rock before it hits.", 'You call it, I dodge it. Nobody gets crushed today.'],
    ['Rocks are raining down the canyon walls. Stay sharp.', "Sharp, fast and blind. Let's go."],
  ],
  arctic: [
    ['Whiteout ahead. The only way through is that pass — and it is closing fast.', "Then we don't slow down. Hold on!"],
    ['Blizzard is swallowing the mountains. I have one gap, and we are taking it.', 'Brace yourself. Punching through!'],
  ],
  lava: [
    ['The volcano just woke up. Fire in the sky, lava below — no turning back now.', "Then we fly fast. Tell me where the ground isn't burning."],
    ['Lava bombs incoming! The only way out is straight through.', 'Straight through the fire. Hang on!'],
  ],
};
function hashStr(t) { let h = 7; for (const ch of String(t)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

function introOpts(level, role) {
  const m = MAPS.find((x) => x.id === level.id) || {};
  const T = THEMES[m.theme] || THEMES.forest;
  const WX = WEATHER[m.weather] || WEATHER.calm;
  const me = (Account.signedIn && Account.profile.display_name) || myName(), friend = app.friendName || 'Friend';
  const names = app.mode === 'npc' ? { pilot: me, navigator: 'Navigator' }
    : app.mode === 'solo' ? { pilot: me, navigator: 'Co-pilot' }
      : app.mode === 'navai' ? { pilot: 'AI pilot', navigator: me }
        : role === 'pilot' ? { pilot: me, navigator: friend } : { pilot: friend, navigator: me };
  const h = hashStr(level.id);
  const pair = (SCENE_LINES[m.theme] || SCENE_LINES.forest)[h % 2];
  const world = m.n <= 2 ? 'Training' : T.name;
  const titleHtml = `<div class="ct-kicker">${icon(m.n <= 2 ? 'target' : T.icon)}<span>${esc(world)} · Map ${m.n || ''}</span></div>`
    + `<h2 class="ct-name">${esc(m.name || level.name)}</h2>`
    + `<div class="ct-meta">${pips(m.tier || 1)}<b>${esc(m.difficulty || '')}</b><span class="dot"></span>${icon(WX.icon)}<b>${esc(WX.name)}</b></div>`;
  return {
    titleHtml,
    names,
    lines: [[names.navigator, pair[0]], [names.pilot, pair[1]]],
  };
}

// Spelar cutscenen i en 3D-vy; HUD och knappar göms under tiden. onEnd körs när den är klar eller hoppas över.
function playIntro(view, root, level, role, onEnd) {
  document.body.classList.add('cine-on');
  view.playIntro(root, {
    ...introOpts(level, role),
    onEnd: () => {
      document.body.classList.remove('cine-on');
      if (app.inGame && onEnd) onEnd();
    },
  });
}

async function requestWakeLock() {
  try { if (navigator.wakeLock) app.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}

async function startGame() {
  endGame();
  const role = myRole();
  const level = buildLevel(app.levelId);
  app.inGame = true;
  show('screen-game');
  applyTouchSetting();
  requestWakeLock();
  $('#results').classList.add('hidden');
  const pilotUI = $('#pilot-ui'), navUI = $('#nav-ui');
  pilotUI.classList.toggle('hidden', role !== 'pilot');
  navUI.classList.toggle('hidden', role !== 'navigator');
  const P = Store.profile;

  if (role === 'pilot') {
    const { PilotView } = await import('./pilot.js');
    if (!app.inGame) return;
    let sendT = 0;
    const g = {
      role, level,
      msgEl: $('.center-msg', pilotUI),
      begin: () => {
        $('.wait-msg', pilotUI).classList.add('hidden');
        if (g.introPlaying) return;                 // navigatören skickar "go" igen medan cutscenen spelas
        if (!g.introDone) {
          g.introPlaying = true;
          playIntro(pv.view, pilotUI, level, 'pilot', () => {
            g.introPlaying = false; g.introDone = true;
            pv.begin();
            if (npc) npcSay("Here we go! I'll call every turn.");
          });
          return;
        }
        pv.begin();
      },
      gesture: (k) => {
        pv.gesture(k);
        const icon = GESTURE_ICON[k];
        if (!icon) return;
        const el = $('.gesture-hint', pilotUI);
        el.textContent = icon;
        el.classList.add('show');
        clearTimeout(g._gt);
        g._gt = setTimeout(() => el.classList.remove('show'), 1600);
      },
      setRoute: (pts) => pv.setRoute(pts),
      onStar: (idx) => { pv.view.world.setStarCollected(idx); if (minimap) minimap.collected.add(idx); },
      onCrash: (e) => pv.view.onCrash(e),
      gateBurst: (e) => pv.view.gateBurst(e),
      onRespawn: () => {
        // ny runda från starten: stjärnorna kommer tillbaka, planet blir helt igen
        pv.view.world.resetStars();
        pv.view.onRespawn();
        if (minimap) { minimap.resetTrail(); }
        if (npc) npc = new NpcNavigator(level);
      },
      restart: (notify) => {
        pv.restart();
        pv.view.world.resetStars();
        pv.view.onRespawn();
        if (npc) { npc = new NpcNavigator(level); setSub(''); }
        $('#results').classList.add('hidden');
        if (minimap) minimap.resetTrail();
        if (notify) toPeer({ t: 'restart' });
        if (isSolo()) g.begin();
        else showWait();
      },
    };
    const showWait = () => {
      const w = $('.wait-msg', pilotUI);
      w.textContent = 'Waiting for the navigator to start... Get ready!';
      w.classList.remove('hidden');
    };
    let minimap = null;
    // NPC-navigatör
    let npc = app.mode === 'npc' ? new NpcNavigator(level) : null;
    const voice = npc ? (app.npcVoice || (app.npcVoice = new NpcVoice())) : null;
    if (voice) voice.enabled = P.npcVoice;
    const sub = $('.npc-sub', pilotUI);
    sub.classList.toggle('hidden', !npc);
    const voiceBtn = $('#btn-npc-voice');
    voiceBtn.classList.toggle('hidden', !npc);
    if (voice) {
      const syncVoice = () => setIconLabel(voiceBtn, voice.enabled ? 'volume' : 'volumeOff', 'Voice');
      syncVoice();
      voiceBtn.onclick = () => { voice.enabled = !voice.enabled; Store.setSetting('npcVoice', voice.enabled); if (!voice.enabled) voice.stop(); syncVoice(); };
    }
    let subT = null;
    const setSub = (text) => {
      $('.npc-text', sub).textContent = text;
      sub.classList.remove('fade');
      clearTimeout(subT);
      subT = setTimeout(() => sub.classList.add('fade'), 2500);
    };
    const npcSay = (text, gesture) => {
      if (!text) return;
      setSub(text);
      if (voice) voice.say(text);
      if (gesture) g.gesture(gesture);
    };
    const pv = new PilotView(pilotUI, level, {
      skin: planeSkin(),
      invertY: P.invertY,
      sensitivity: P.sensitivity,
      onEvent: (e) => {
        handleEvent(e);
        if (app.net) app.net.send({ t: 'ev', e });
        if (npc) npcSay(npc.onEvent(e, level));
      },
      onFrame: (S, dt) => {
        const snap = S.snapshot();
        updateHud(pilotUI, snap, level);
        countdownDisplay(g, snap);
        pilotUI.classList.toggle('outside', snap.ph !== 'fly');
        if (minimap) minimap.setState(snap);
        if (npc) {
          const out = npc.update(dt, S);
          if (out && out.say) npcSay(out.say, out.gesture);
        }
        sendT += dt;
        if (app.net && sendT >= 0.05) { sendT = 0; app.net.send(snap); }
      },
    });
    g.view = pv;
    app.game = g;
    if (app.mode === 'solo') {
      const mm = $('.minimap', pilotUI);
      mm.classList.remove('hidden');
      const { RadarView } = await import('./radar.js');
      minimap = new RadarView(mm, level, { compact: true, mode: 'heading', zoomIdx: 1 });
      minimap.start();
      g.minimap = minimap;
    } else {
      $('.minimap', pilotUI).classList.add('hidden');
    }
    pv.view.warmUp();                               // kompilera allt i förväg: inga hack i cutscenen eller vid krasch
    pv.start();
    if (isSolo()) g.begin(); else showWait();
  } else {
    // Navigatören sitter med i planet (helskärm 3D utan dimma) och har en liten minikarta.
    const [{ RadarView }, { NavCockpit }] = await Promise.all([import('./radar.js'), import('./nav3d.js')]);
    if (!app.inGame) return;
    const view = new NavCockpit($('.view3d-holder', navUI), level);
    view.view.rig.setSkin(planeSkin());
    view.view.warmUp();
    view.start();
    const mini = new RadarView($('.nav-mini', navUI), level, { compact: true, mode: 'heading', zoomIdx: 1 });
    mini.start();
    const startPill = $('.start-pill', navUI);
    const aiMode = app.mode === 'navai';
    $('.ai-hint', navUI).classList.toggle('hidden', !aiMode);
    $('.start-text', navUI).textContent = aiMode
      ? 'The AI pilot flies blind and only does what you say. You see far ahead – steer early!'
      : 'Your pilot is ready. You can see far ahead – call the turns early!';
    const g = {
      role, level, view, minimap: mini,
      msgEl: $('.center-msg', navUI),
      onState: (snap) => {
        view.push(snap);
        mini.setState(snap);
        updateHud(navUI, snap, level);
        countdownDisplay(g, snap);
        updateGuide(navUI, mini);
        // Om "go" kom bort (t.ex. om pilotens vy inte hunnit laddas) – skicka igen
        if (g.goSentAt && snap.ph === 'waiting' && performance.now() - g.goSentAt > 1500) {
          g.goSentAt = performance.now();
          toPeer({ t: 'go' });
        } else if (snap.ph !== 'waiting') g.goSentAt = 0;
      },
      onStar: (idx) => {
        mini.collected.add(idx);
        view.view.world.setStarCollected(idx);
      },
      onCrash: (e) => view.view.onCrash(e),
      gateBurst: (e) => view.view.gateBurst(e),
      onRespawn: () => {
        mini.resetTrail();
        view.view.world.resetStars();
        view.view.onRespawn();
      },
      waitForStart: () => {
        g.goSentAt = 0;
        view.view.world.resetStars();
        view.view.onRespawn();
        mini.resetTrail();
        startPill.classList.remove('hidden');
      },
      restart: (notify) => {
        $('#results').classList.add('hidden');
        if (notify) toPeer({ t: 'restart' });
        g.waitForStart();
      },
    };
    // sidopanelens ikonknappar och startknappen
    $$('[data-act]', navUI).forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'map') { const off = $('.nav-mini', navUI).classList.toggle('off'); b.classList.toggle('on', !off); }
        if (a === 'zoom-in') mini.zoom(-1);
        if (a === 'zoom-out') mini.zoom(1);
        if (a === 'view') {
          const out = view.view.mode !== 'outside';
          view.setMode(out ? 'outside' : 'auto');
          b.classList.toggle('on', out);
        }
        if (a === 'guide') { const off = $('.guide', navUI).classList.toggle('off'); b.classList.toggle('on', !off); }
        if (a === 'go') {
          unlockAudio();
          startPill.classList.add('hidden');
          const sendGo = () => { g.goSentAt = performance.now(); toPeer({ t: 'go' }); };
          if (!g.introDone) {
            g.introDone = true;
            // med en vän startar båda cutscenen samtidigt; med AI-piloten startar flygningen när cutscenen är klar
            if (aiMode) playIntro(view.view, navUI, level, 'navigator', sendGo);
            else { sendGo(); playIntro(view.view, navUI, level, 'navigator', null); }
          } else sendGo();
        }
      };
    });
    // återställ knapparnas lägen
    $('.nav-mini', navUI).classList.remove('off');
    $('.guide', navUI).classList.remove('off');
    $$('.side-btn', navUI).forEach((b) => b.classList.toggle('on', ['map', 'guide'].includes(b.dataset.act)));
    // gester till piloten (med AI-pilot: håll inne för att styra)
    $$('[data-gest]', navUI).forEach((b) => {
      const k = b.dataset.gest;
      b.onclick = null;
      b.onpointerdown = (e) => {
        e.preventDefault();
        b.classList.add('down');
        toPeer({ t: 'gest', g: k });
        view.gesture(k);
        if (app.aiPilot) app.aiPilot.press(k);
      };
      const up = () => { b.classList.remove('down'); if (app.aiPilot) app.aiPilot.releaseDir(k); };
      b.onpointerup = up; b.onpointercancel = up; b.onpointerleave = up;
    });
    app.game = g;

    // Navigatör solo: en lokal AI-pilot som lyder pilknapparna
    if (aiMode) {
      const { LocalAIPilot } = await import('./aipilot.js');
      if (!app.inGame) return;
      app.aiPilot = new LocalAIPilot(level, { onState: (st) => g.onState(st), onEvent: (e) => handleEvent(e) });
      app.aiPilot.start();
      const keyMap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
      app._navKeys = (e) => {
        if (!app.aiPilot) return;
        const down = e.type === 'keydown';
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { app.aiPilot.setBrake(down); return; }
        const k = keyMap[e.code];
        if (!k) return;
        e.preventDefault();
        if (down && !e.repeat) { app.aiPilot.press(k); view.gesture(k); }
        if (!down) app.aiPilot.releaseDir(k);
        const btn = $(`[data-gest="${k}"]`, navUI);
        if (btn) btn.classList.toggle('down', down);
      };
      window.addEventListener('keydown', app._navKeys);
      window.addEventListener('keyup', app._navKeys);
    }
    g.waitForStart();
  }
}

function updateGuide(root, rv) {
  const gd = rv.guidance();
  if (!gd) return;
  const t = Math.round(gd.turn);
  const turnEl = $('.guide-turn', root), altEl = $('.guide-alt', root), distEl = $('.guide-dist', root);
  const name = gd.gate.finish ? 'the finish' : 'gate ' + (gd.gate.idx + 1);
  if (Math.abs(t) > 150) turnEl.textContent = '↩ Turn around';
  else if (t > 6) turnEl.textContent = `↱ Right ${t}°`;
  else if (t < -6) turnEl.textContent = `↰ Left ${-t}°`;
  else turnEl.textContent = '↑ Straight ahead';
  const dy = Math.round(gd.dy);
  altEl.textContent = dy > 1 ? `Climb ${dy} m` : dy < -1 ? `Descend ${-dy} m` : 'Altitude OK';
  distEl.textContent = `${Math.round(gd.dist)} m to ${name}`;
}

// Poängen räknas upp med en mjuk animation
function countUp(el, to, ms = 900, delay = 0, prefix = '') {
  const t0 = performance.now() + delay;
  el.textContent = prefix + '0';
  const tick = (now) => {
    const k = Math.max(0, Math.min(1, (now - t0) / ms));
    el.textContent = prefix + String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Betyg utifrån hur stor del av maxpoängen man tog
function rating(level, score) {
  // max: alla ringar perfekt med full combo, alla stjärnor och halva möjliga tidsbonusen (samma som databasen)
  const max = maxScoreOf(level);
  const r = score / max;
  const stars = r >= 0.85 ? 3 : r >= 0.65 ? 2 : r >= 0.4 ? 1 : 0;
  return { letter: rankOf(score, max), stars };
}

// Konfetti vid nytt rekord (enkla DOM-bitar med CSS-animation)
function confetti(box) {
  box.innerHTML = '';
  const cols = ['#ffd23f', '#4a93f5', '#3ddc84', '#ff7b7b', '#ffffff'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = cols[i % cols.length];
    c.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
    c.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    c.style.animationDelay = (0.6 + Math.random() * 0.6) + 's';
    c.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
    box.appendChild(c);
  }
}

function showResults(e) {
  const g = app.game;
  if (!g) return;
  const role = g.role, L = g.level;
  const score = e.score || 0;
  const partner = app.mode === 'npc' ? 'NPC' : app.mode === 'navai' ? 'AI pilot' : app.mode === 'solo' ? null : app.friendName;
  const prevBest = Store.profile.best[L.id];
  const prevScore = prevBest && prevBest.score != null ? prevBest.score : 0;
  const isRecord = Store.addResult({
    level: L.id, time: Math.round(e.time * 10) / 10, score, crashes: e.crashes, misses: e.misses, stars: e.stars || 0,
    role, partner, solo: isSolo(),
  });
  const res = $('#results');
  const rt = rating(L, score);
  const map = MAPS.find((m) => m.id === L.id);
  $('.res-title', res).textContent = e.crashes ? 'Finished!' : 'Flawless run!';
  $('.res-map', res).textContent = map ? `Map ${map.n} · ${map.name}` : L.name;
  $('.rank-letter', res).textContent = rt.letter;
  $('.rank', res).className = 'rank rank-' + rt.letter;
  $$('.rstar', res).forEach((el, i) => { el.classList.toggle('on', i < rt.stars); el.style.animationDelay = (0.45 + i * 0.18) + 's'; });
  countUp($('.res-score', res), score, 1200, 250);
  $('.res-record-badge', res).classList.toggle('hidden', !isRecord);

  // jämförelse med tidigare rekord
  const top = Math.max(score, prevScore, 1);
  $('.best-fill', res).style.setProperty('--w', (score / top * 100) + '%');
  $('.best-mark', res).style.left = (prevScore / top * 100) + '%';
  $('.best-mark', res).classList.toggle('hidden', !prevScore);
  $('.best-text', res).textContent = !prevScore ? 'First result on this map!'
    : isRecord ? `Beat your best by ${score - prevScore} points` : `Best: ${prevScore} points · ${prevScore - score} to go`;

  // poänguppdelning
  const passed = L.gates.length - (e.misses || 0);
  const perf = e.perfects || 0;
  const rows = [
    { ic: 'target', name: 'Gates', count: `${passed - perf}×`, pts: (passed - perf) * POINTS.gate },
    { ic: 'award', name: 'Perfect', count: `${perf}×`, pts: perf * POINTS.perfect, gold: true },
    { ic: 'zap', name: 'Combo bonus', count: `best ${e.bestCombo || 0}`, pts: e.comboBonus || 0, hot: true },
    { ic: 'star', name: 'Stars', count: `${e.stars || 0}/${e.totalStars || 0}`, pts: (e.stars || 0) * POINTS.star },
    { ic: 'clock', name: 'Time bonus', count: e.time.toFixed(1) + ' s', pts: e.timeBonus || 0 },
  ];
  const ul = $('.res-breakdown', res);
  ul.innerHTML = rows.map((r, i) => `<li style="animation-delay:${0.35 + i * 0.1}s" class="${r.gold ? 'gold' : r.hot ? 'hot' : ''}">`
    + `<span class="bd-ic">${icon(r.ic)}</span><span class="bd-name">${r.name}</span><span class="bd-count">${esc(r.count)}</span><b class="bd-pts">+0</b></li>`).join('');
  $$('.bd-pts', ul).forEach((el, i) => countUp(el, rows[i].pts, 700, 450 + i * 100, '+'));

  const chips = [];
  chips.push(`<span class="chip">${icon('restart')} ${e.crashes ? `${e.crashes + 1} attempts` : 'First try'}</span>`);
  if (e.misses) chips.push(`<span class="chip bad">${icon('close')} ${e.misses} missed</span>`);
  if (partner) chips.push(`<span class="chip">${icon('users')} with ${esc(partner)}</span>`);
  $('.res-chips', res).innerHTML = chips.join('');

  showXp(L, e, score);

  res.classList.remove('hidden');
  const panel = $('.panel', res);
  panel.classList.remove('play'); void panel.offsetWidth; panel.classList.add('play');
  if (isRecord && prevScore) confetti($('.confetti', res)); else $('.confetti', res).innerHTML = '';
}

function endGame() {
  const g = app.game;
  app.inGame = false;
  document.body.classList.remove('cine-on');
  if (g) {
    try { g.view && g.view.destroy(); } catch (e) { console.warn(e); }
    try { g.minimap && g.minimap.destroy(); } catch (e) { console.warn(e); }
  }
  if (app.aiPilot) { app.aiPilot.destroy(); app.aiPilot = null; }
  if (app._navKeys) {
    window.removeEventListener('keydown', app._navKeys);
    window.removeEventListener('keyup', app._navKeys);
    app._navKeys = null;
  }
  app.game = null;
  $('#results').classList.add('hidden');
  $$('.center-msg').forEach((el) => { el.className = 'center-msg'; });
  $$('.gesture-hint').forEach((el) => el.classList.remove('show'));
  $$('.gbtn').forEach((el) => el.classList.remove('down'));
  if (app.npcVoice) app.npcVoice.stop();
  $('#btn-npc-voice').classList.add('hidden');
  try { app.wakeLock && app.wakeLock.release(); } catch (_) {}
  app.wakeLock = null;
}

// Free play: mode = 'npc' | 'navai' | 'solo'
function startSolo(mode, levelId) {
  cleanupNet();
  app.mode = mode;
  app.isHost = true;
  app.hostRole = 'pilot';
  app.levelId = LEVEL_INFO[levelId] ? levelId : 'test';
  startGame();
}

function closeGameMenu() {
  const gm = $('.game-menu');
  if (!gm || !gm.classList.contains('open')) return;
  gm.classList.remove('open');
  $('#btn-gmenu').setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------- konto, level och shop
// Level och shop finns bara för inloggade. Utloggade ser en låst förhandsvisning.
let shopPreview = null;
let shopSel = null;
let buyConfirm = null;
const thumbCache = {};

function mySkin() { return Account.signedIn ? Account.skin() : 'classic'; }

// Planets skin: pilotens val. I solo och med NPC/AI är det ditt plan.
function planeSkin() {
  if (app.mode !== 'online') return mySkin();
  return myRole() === 'pilot' ? mySkin() : (app.friendSkin || 'classic');
}

// Rund level-ring (SVG) med siffran i mitten
function lvlRing(level, progress) {
  const C = 2 * Math.PI * 20;
  const p = Math.max(0, Math.min(1, progress || 0));
  return `<svg viewBox="0 0 48 48" class="ring"><circle cx="24" cy="24" r="20" class="ring-bg"/>`
    + `<circle cx="24" cy="24" r="20" class="ring-fg" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - p)).toFixed(2)}"/></svg>`
    + `<span class="ring-num">${level}</span>`;
}

function rarityChip(s) {
  const R = RARITY[s.rarity] || RARITY.common;
  return `<span class="rar" style="--rc:${R.color}">${R.name}</span>`;
}

function renderAcctBar() {
  const bar = $('#acct-bar'), shopBtn = $('#btn-shop');
  const avail = Account.available;
  bar.classList.toggle('hidden', !avail);
  shopBtn.classList.toggle('hidden', !avail);
  $('.lock-badge', shopBtn).classList.toggle('hidden', Account.signedIn);
  if (!avail) return;
  if (Account.status === 'loading') { bar.innerHTML = '<div class="acct-chip skeleton" aria-busy="true"></div>'; return; }
  if (!Account.signedIn) {
    bar.innerHTML = `<button class="acct-chip guest" type="button" data-sfx>${icon('user')}<span><b>Log in</b><small>Earn XP, level up and unlock skins</small></span>${icon('right')}</button>`;
  } else {
    const p = Account.profile, li = Account.level;
    bar.innerHTML = `<button class="acct-chip" type="button" data-sfx aria-label="Your account: level ${li.level}">`
      + `<span class="lvl-ring">${lvlRing(li.level, li.progress)}</span>`
      + `<span class="ac-mid"><b>${esc(p.display_name)}</b><span class="xp-bar sm"><i style="width:${(li.progress * 100).toFixed(1)}%"></i></span>`
      + `<small>${li.max ? 'Max level' : `${li.into} / ${li.need} XP`}</small></span>`
      + `<span class="coin-pill">${icon('coin')}<b>${p.coins.toLocaleString('en-US')}</b></span></button>`;
  }
  $('.acct-chip', bar).onclick = () => openAccount();
}

function openAccount() {
  renderAccount();
  show('screen-account');
}

function renderAccount() {
  const signed = Account.signedIn;
  $('.acct-login').classList.toggle('hidden', signed);
  $('.acct-profile').classList.toggle('hidden', !signed);
  if (!signed) {
    const st = $('#acct-status');
    if (!Account.available) setStatus(st, 'Accounts are not set up yet.', 'error');
    else if (Account.status === 'error' && Account.error) setStatus(st, Account.error, 'error');
    return;
  }
  const p = Account.profile, li = Account.level;
  $('.acct-profile .lvl-ring').innerHTML = lvlRing(li.level, li.progress);
  $('.acct-name').textContent = p.display_name;
  $('.acct-email').textContent = (Account.user && Account.user.email) || '';
  $('.xp-level').textContent = li.max ? `Level ${li.level} · Max` : `Level ${li.level}`;
  $('.xp-nums').textContent = li.max ? '' : `${li.into.toLocaleString('en-US')} / ${li.need.toLocaleString('en-US')} XP · ${li.left.toLocaleString('en-US')} to level ${li.level + 1}`;
  $('.acct-profile .xp-bar i').style.width = (li.progress * 100).toFixed(1) + '%';
  const maps = MAPS.filter((m) => m.available).length;
  const tile = (ic, v, label) => `<div class="ms-stat">${icon(ic)}<b>${v}</b><small>${label}</small></div>`;
  $('.acct-stats').innerHTML = tile('zap', p.xp.toLocaleString('en-US'), 'Total XP')
    + tile('coin', p.coins.toLocaleString('en-US'), 'Coins')
    + tile('target', `${Account.clearsCount()}/${maps}`, 'Maps cleared')
    + tile('bag', `${p.owned_skins.length}/${SKINS.length}`, 'Skins');
  // nästa skins man kan låsa upp
  const next = SKINS.filter((s) => !Account.owns(s.id)).sort((a, b) => a.level - b.level || a.price - b.price).slice(0, 3);
  $('.acct-next').innerHTML = next.length ? next.map((s) => {
    const ok = li.level >= s.level;
    return `<div class="next-row"><span class="nr-dot" style="--rc:${(RARITY[s.rarity] || RARITY.common).color}"></span>`
      + `<span class="nr-name"><b>${esc(s.name)}</b>${rarityChip(s)}</span>`
      + `<span class="nr-req ${ok ? 'ok' : ''}">${ok ? (s.price ? `${icon('coin')}${s.price}` : 'Free') : `${icon('lock')}Level ${s.level}`}</span></div>`;
  }).join('') : '<p class="hint">You own every skin. Legend!</p>';
}

// ---- shop
async function openShop() {
  show('screen-shop');
  if (!shopPreview) {
    try {
      const { SkinPreview } = await import('./shopview.js');
      shopPreview = new SkinPreview($('.shop-canvas'));
    } catch (e) { console.warn(e); }
  }
  if (!shopSel) shopSel = mySkin();
  shopTab = skinById(shopSel).rarity;
  renderShop();
  if (shopPreview && current === 'screen-shop') { shopPreview.setSkin(shopSel); shopPreview.start(); }
}

function skinState(s) {
  if (!Account.signedIn) return 'guest';
  const li = Account.level;
  if (Account.skin() === s.id) return 'equipped';
  if (Account.owns(s.id)) return 'owned';
  if (li.level < s.level) return 'locked';
  if (Account.profile.coins < s.price) return 'poor';
  return 'buy';
}

let shopTab = null;
let thumbBusy = false;

function renderShop() {
  const signed = Account.signedIn;
  $('.shop-guest').classList.toggle('hidden', signed);
  $('.shop-wallet').innerHTML = signed
    ? `<span class="wallet-lvl">${icon('zap')}Level <b>${Account.level.level}</b></span><span class="coin-pill">${icon('coin')}<b>${Account.profile.coins.toLocaleString('en-US')}</b></span>`
    : '';
  // flikar per sällsynthet (Common, Epic, Legendary, Ultra)
  if (!shopTab) shopTab = skinById(shopSel).rarity;
  const lvl = Account.level ? Account.level.level : 0;
  $('.shop-tabs').innerHTML = RARITY_ORDER.map((r) => {
    const list = SKINS.filter((s) => s.rarity === r);
    const owned = signed ? list.filter((s) => Account.owns(s.id)).length : 0;
    const from = Math.min(...list.map((s) => s.level));
    const sub = signed ? (lvl >= from ? `${owned}/${list.length} owned` : `Level ${from}+`) : `${list.length} skins`;
    return `<button class="shop-tab" role="tab" type="button" data-r="${r}" aria-selected="${r === shopTab}" style="--rc:${RARITY[r].color}"><b>${RARITY[r].name}</b><small>${sub}</small></button>`;
  }).join('');
  $$('.shop-tab').forEach((b) => { b.onclick = () => { sfx.click(); shopTab = b.dataset.r; renderShop(); }; });

  const grid = $('.shop-grid');
  grid.innerHTML = '';
  SKINS.filter((s) => s.rarity === shopTab).forEach((s, i) => {
    const st = skinState(s);
    const R = RARITY[s.rarity] || RARITY.common;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `skin-card st-${st} r-${s.rarity}` + (s.id === shopSel ? ' sel' : '');
    el.dataset.id = s.id;
    el.setAttribute('role', 'listitem');
    el.style.setProperty('--rc', R.color);
    el.style.animationDelay = (i * 0.025) + 's';
    const tag = st === 'equipped' ? `<span class="sc-tag eq">${icon('check')}Equipped</span>`
      : st === 'owned' ? '<span class="sc-tag own">Owned</span>'
        : st === 'locked' || st === 'guest' ? `<span class="sc-tag lock">${icon('lock')}Lvl ${s.level}</span>`
          : `<span class="sc-tag price">${s.price ? icon('coin') + s.price.toLocaleString('en-US') : 'Free'}</span>`;
    // färgprovet syns tills bilden är klar
    const swatch = `linear-gradient(110deg, ${s.swatch.concat(s.swatch).join(', ')})`;
    el.innerHTML = `<span class="sc-img" style="--sw:${swatch}"><img alt="" decoding="async"></span><span class="sc-body"><b>${esc(s.name)}</b><span class="sc-meta">${rarityChip(s)}${tag}</span></span>`;
    const img = $('img', el);
    if (thumbCache[s.id]) img.src = thumbCache[s.id];
    el.onclick = () => { sfx.click(); shopSel = s.id; buyConfirm = null; if (shopPreview) shopPreview.setSkin(s.id); renderShop(); };
    grid.appendChild(el);
  });
  renderShopInfo();
  makeThumbs();
}

// små bilder av skinsen, en i taget (fliken man tittar på först) så att sidan inte hackar
function makeThumbs() {
  if (!shopPreview || thumbBusy) return;
  const next = () => SKINS.filter((s) => !(s.id in thumbCache)).sort((a, b) => (a.rarity === shopTab ? 0 : 1) - (b.rarity === shopTab ? 0 : 1))[0];
  const step = () => {
    const s = next();
    if (!s || current !== 'screen-shop') { thumbBusy = false; return; }
    try { thumbCache[s.id] = shopPreview.thumbnail(s.id); } catch (e) { console.warn('thumbnail', s.id, e); thumbCache[s.id] = ''; }
    const card = $(`.skin-card[data-id="${s.id}"]`);
    if (card && thumbCache[s.id]) $('img', card).src = thumbCache[s.id];
    setTimeout(step, 30);
  };
  thumbBusy = true;
  setTimeout(step, 60);
}

function renderShopInfo() {
  const s = skinById(shopSel);
  const st = skinState(s);
  const R = RARITY[s.rarity] || RARITY.common;
  const info = $('.shop-info');
  info.style.setProperty('--rc', R.color);
  $('.shop-rarity').innerHTML = rarityChip(s);
  $('.shop-name').textContent = s.name;
  $('.shop-desc').textContent = s.desc;
  const li = Account.level;
  const reqLvl = `<span class="req ${li && li.level >= s.level ? 'ok' : ''}">${icon(li && li.level >= s.level ? 'check' : 'lock')}Level ${s.level}</span>`;
  const reqPrice = `<span class="req ${Account.signedIn && Account.profile.coins >= s.price ? 'ok' : ''}">${icon('coin')}${s.price ? s.price.toLocaleString('en-US') + ' coins' : 'Free'}</span>`;
  $('.shop-req').innerHTML = reqLvl + reqPrice;
  const btn = $('#btn-shop-action');
  btn.disabled = false;
  btn.className = 'btn primary big';
  const set = (ic, text) => { btn.innerHTML = (ic ? icon(ic) : '') + `<span>${text}</span>`; };
  if (st === 'guest') { set('user', 'Log in to unlock'); btn.onclick = () => openAccount(); }
  else if (st === 'equipped') { set('check', 'Equipped'); btn.disabled = true; }
  else if (st === 'owned') { set('plane', 'Equip'); btn.onclick = () => shopDo(() => Account.equip(s.id), `${s.name} equipped!`); }
  else if (st === 'locked') { set('lock', `Reach level ${s.level}`); btn.disabled = true; }
  else if (st === 'poor') { set('coin', `${(s.price - Account.profile.coins).toLocaleString('en-US')} more coins needed`); btn.disabled = true; }
  else if (buyConfirm === s.id) {
    btn.classList.add('confirm');
    set('coin', s.price ? `Confirm: buy for ${s.price.toLocaleString('en-US')}` : 'Confirm: claim');
    btn.onclick = () => { buyConfirm = null; shopDo(async () => { await Account.buy(s.id); await Account.equip(s.id); }, `${s.name} unlocked and equipped!`, true); };
  } else {
    set('coin', s.price ? `Buy for ${s.price.toLocaleString('en-US')}` : 'Claim for free');
    btn.onclick = () => { buyConfirm = s.id; renderShopInfo(); setTimeout(() => { if (buyConfirm === s.id) { buyConfirm = null; if (current === 'screen-shop') renderShopInfo(); } }, 3500); };
  }
}

async function shopDo(fn, okText, celebrate) {
  const btn = $('#btn-shop-action'), st = $('#shop-status');
  btn.disabled = true;
  setStatus(st, 'Saving…');
  try {
    await fn();
    setStatus(st, okText, 'ok');
    if (celebrate) { sfx.combo(); $('.shop-stage').classList.remove('cheer'); void $('.shop-stage').offsetWidth; $('.shop-stage').classList.add('cheer'); }
  } catch (e) {
    setStatus(st, e.message, 'error');
  }
  renderShop();
}

// ---- resultat: XP och mynt
function animateNumber(el, from, to, ms, fmtFn = (v) => v) {
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmtFn(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function showXp(L, e, score) {
  const box = $('.res-xp'), guest = $('.res-guest');
  box.classList.add('hidden'); guest.classList.add('hidden');
  if (!Account.available) return;
  if (!Account.signedIn) { guest.classList.remove('hidden'); return; }
  const before = Account.profile ? Account.profile.xp : 0;
  const li0 = levelInfo(before);
  box.classList.remove('hidden');
  $('.lvl-ring', box).innerHTML = lvlRing(li0.level, li0.progress);
  $('.rx-xp', box).textContent = '+0 XP';
  $('.rx-coins', box).innerHTML = '';
  $('.xp-bar i', box).style.width = (li0.progress * 100) + '%';
  $('.rx-note', box).textContent = 'Saving your flight…';
  $('.rx-levelup', box).classList.add('hidden');
  $('.rx-parts', box).innerHTML = '';
  const token = (box._token = {});
  let r;
  try {
    r = await Account.award({ map: L.id, score, stars: e.stars || 0, coop: app.mode === 'online', maxScore: maxScoreOf(L) });
  } catch (err) {
    if (box._token === token) $('.rx-note', box).textContent = err.message;
    return;
  }
  if (box._token !== token) return;
  const li1 = levelInfo(before + r.xp);
  animateNumber($('.rx-xp', box), 0, r.xp, 1100, (v) => `+${v.toLocaleString('en-US')} XP`);
  $('.rx-coins', box).innerHTML = `${icon('coin')}+${r.coins.toLocaleString('en-US')}`;
  const names = { run: r.repeat_pct < 100 ? `Map cleared · ${r.repeat_pct}% replay` : 'Map cleared', first: 'First clear', rank: `New best rank ${r.rank}`, coop: 'Co-op bonus' };
  $('.rx-parts', box).innerHTML = Object.entries(r.parts || {}).filter(([, v]) => v > 0)
    .map(([k, v]) => `<span class="chip">${esc(names[k] || k)} <b>+${v}</b></span>`).join('');
  $('.rx-note', box).textContent = li1.max ? 'Max level reached!' : `${li1.left.toLocaleString('en-US')} XP to level ${li1.level + 1}`;
  const bar = $('.xp-bar i', box);
  if (li1.level > li0.level) {
    bar.style.width = '100%';
    setTimeout(() => {
      $('.lvl-ring', box).innerHTML = lvlRing(li1.level, li1.progress);
      bar.style.transition = 'none'; bar.style.width = '0%'; void bar.offsetWidth; bar.style.transition = '';
      bar.style.width = (li1.progress * 100) + '%';
      const fresh = (r.new_skins || []).map((id) => skinById(id).name);
      const inShop = SKINS.filter((s) => s.price > 0 && s.level > li0.level && s.level <= li1.level).map((s) => s.name);
      const lu = $('.rx-levelup', box);
      lu.innerHTML = `<b>${icon('zap')}Level up! You are now level ${li1.level}</b>`
        + (fresh.length ? `<span>New skin: ${esc(fresh.join(', '))}</span>` : '')
        + (inShop.length ? `<span>Now in the shop: ${esc(inShop.join(', '))}</span>` : '');
      lu.classList.remove('hidden');
      sfx.combo();
    }, 900);
  } else {
    setTimeout(() => { bar.style.width = (li1.progress * 100) + '%'; $('.lvl-ring', box).innerHTML = lvlRing(li1.level, li1.progress); }, 300);
  }
}

function initAccount() {
  $('#btn-shop').onclick = () => openShop();
  $('#btn-acct-shop').onclick = () => openShop();
  $('#btn-shop-login').onclick = () => openAccount();
  $('#btn-res-login').onclick = () => { backToLobby(true); openAccount(); };
  const emailIn = $('#acct-email');
  const send = async () => {
    const btn = $('#btn-acct-send'), st = $('#acct-status');
    btn.disabled = true;
    setStatus(st, 'Sending…');
    try {
      const r = await Account.signIn(emailIn.value);
      if (r.sent) setStatus(st, `Check your inbox (${emailIn.value.trim()}) and open the link on this device.`, 'ok');
      else setStatus(st, '');
    } catch (e) { setStatus(st, e.message, 'error'); }
    btn.disabled = false;
  };
  $('#btn-acct-send').onclick = send;
  emailIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  $('#btn-acct-logout').onclick = async () => { await Account.signOut(); renderAccount(); };
  const editBox = $('.acct-name-edit'), nameIn = $('#acct-name-input');
  $('#btn-acct-edit').onclick = () => { editBox.classList.toggle('hidden'); nameIn.value = Account.profile ? Account.profile.display_name : ''; nameIn.focus(); };
  const saveName = async () => {
    try { await Account.setName(nameIn.value); editBox.classList.add('hidden'); setStatus($('#acct-status2'), 'Name saved.', 'ok'); }
    catch (e) { setStatus($('#acct-status2'), e.message, 'error'); }
  };
  $('#btn-acct-name-save').onclick = saveName;
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });

  Account.on(() => {
    renderAcctBar();
    if (current === 'screen-account') renderAccount();
    if (current === 'screen-shop') renderShop();
  });
  renderAcctBar();
  Account.init(Store.profile.name);
}

function initGameMenu() {
  // meny-knappen (kompakt läge): öppnar en liten lista med röst, omstart och avsluta
  const gm = $('.game-menu'), toggle = $('#btn-gmenu');
  toggle.onclick = () => {
    const open = !gm.classList.contains('open');
    gm.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.game-menu')) closeGameMenu(); }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGameMenu(); });
  $$('.gm-drop .btn').forEach((b) => b.addEventListener('click', () => { if (b.id !== 'btn-npc-voice') closeGameMenu(); }));
  $('#btn-restart').onclick = () => app.game && app.game.restart(true);
  $('#btn-again').onclick = () => app.game && app.game.restart(true);
  $('#btn-tolobby').onclick = () => backToLobby(true);
  $('#btn-res-lobby').onclick = () => backToLobby(true);
}

// ---------------------------------------------------------------- start
applyIcons();
setSfxEnabled(Store.profile.sfx);
initMenus();
initSettings();
initLobby();
initGameMenu();
initAccount();
applyTouchSetting();

// För automatiska tester
window.__blindflyg = { app, startSolo, rewardPopup, updateCombo, showResults, Account };
