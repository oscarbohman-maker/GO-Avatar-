// Appens styrning: menyer (start, free play, vänner, inställningar), lobby,
// spelstart i olika lägen, nätverksmeddelanden, HUD och resultat.
import { Net, PROTOCOL_VERSION, normalizeCode, CODE_LENGTH } from './net.js';
import { Voice } from './voice.js';
import { Store } from './storage.js';
import { MAPS, LEVEL_INFO, buildLevel } from './levels.js';
import { sfx, unlockAudio, setSfxEnabled } from './sfx.js';
import { NpcNavigator, NpcVoice } from './npc.js';
import { icon, applyIcons, setIconLabel } from './icons.js';

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
}
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
function mapCard(m, opts = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'map-card' + (m.available ? '' : ' locked') + (opts.selected ? ' selected' : '');
  const best = m.available && Store.profile.best[m.id];
  el.innerHTML = `<span class="num">MAP ${m.n}</span><span class="name">${esc(m.available ? m.name : 'Coming soon')}</span>`
    + `<span class="diff d-${esc(m.difficulty)}">${esc(m.difficulty)}</span>`
    + (best ? `<span class="best">Best: ${best.score != null ? best.score + ' pts · ' : ''}${best.time.toFixed(1)} s</span>` : (m.available ? '<span class="best">Not flown yet</span>' : ''))
    + (m.available ? `<span class="art">${icon('plane')}</span>` : `<span class="lock">${icon('lock')}</span>`);
  if (!m.available) el.disabled = true;
  return el;
}

function renderMapGrid() {
  const grid = $('#map-grid');
  grid.innerHTML = '';
  MAPS.forEach((m, i) => {
    const el = mapCard(m);
    el.style.animationDelay = (i * 0.025) + 's';
    if (m.available) el.onclick = () => { sfx.click(); openModeSheet(m); };
    grid.appendChild(el);
  });
}

function openModeSheet(m) {
  const sheet = $('#mode-sheet');
  sheet.dataset.level = m.id;
  $('.sheet-title', sheet).textContent = `Map ${m.n}: ${m.name}`;
  sheet.classList.remove('hidden');
  const panel = $('.sheet-panel', sheet);
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
  net.on('open', () => {
    if (app.net !== net) return;
    setupVoice();
    if (!app.isHost) net.send({ t: 'hello', name: myName(), ver: PROTOCOL_VERSION });
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
    setStatus($('#lobby-status'), 'Give the code to your friend, or tap "Share link".');
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
      if (m.ver !== PROTOCOL_VERSION) setStatus($('#lobby-status'), 'Warning: your friend has a different version of the game. Reload the page.', 'error');
      else setStatus($('#lobby-status'), app.friendName + ' joined!', 'ok');
      app.net.send({ t: 'welcome', name: myName(), hostRole: app.hostRole, level: app.levelId, ver: PROTOCOL_VERSION });
      renderLobby();
      break;
    case 'welcome':
      app.friendName = String(m.name || 'Friend').slice(0, 16);
      app.hostRole = m.hostRole === 'navigator' ? 'navigator' : 'pilot';
      app.levelId = LEVEL_INFO[m.level] ? m.level : 'test';
      $('#lobby-code').textContent = app.net.code;
      $('#code-expiry').textContent = '';
      setStatus($('#lobby-status'), m.ver !== PROTOCOL_VERSION ? 'Warning: different game versions. Reload the page.' : 'Connected to ' + app.friendName + '!', m.ver !== PROTOCOL_VERSION ? 'error' : 'ok');
      renderLobby();
      show('screen-lobby');
      break;
    case 'bye':
      friendLost(app.net, true);
      break;
    case 'full':
      goHome('The game is already full (two players).', 'error', 'screen-friends');
      break;
    case 'expired':
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
    const el = mapCard(m, { selected: m.id === app.levelId });
    if (app.isHost) el.onclick = () => { sfx.click(); app.levelId = m.id; app.net && app.net.send({ t: 'level', level: m.id }); renderLobby(); };
    else el.style.cursor = 'default';
    list.appendChild(el);
  }
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

function bumpScore() {
  $$('.hud-item.score').forEach((el) => { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); });
}

function handleEvent(e) {
  const g = app.game;
  if (!g) return;
  switch (e.kind) {
    case 'go': flash('GO!', 'good big', 700); sfx.go(); break;
    case 'pass':
      if (!e.finished) {
        if (e.perfect) { flash(`PERFECT! <small>+${e.bonus} points</small>`, 'gold', 900, true); sfx.perfect(); }
        else { flash(`Gate ${e.gate + 1} ✓ <small>+${e.bonus} points</small>`, 'good', 800, true); sfx.gate(); }
        bumpScore();
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
      bumpScore();
      if (g.onStar) g.onStar(e.idx);
      break;
    case 'finish': sfx.finish(); showResults(e); break;
  }
}

function updateHud(root, snap, level) {
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
      begin: () => { pv.begin(); $('.wait-msg', pilotUI).classList.add('hidden'); },
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
    pv.start();
    if (isSolo()) g.begin(); else showWait();
    if (npc) setSub("Hi! I can see the course for you. Listen to me and we'll fly through the gates.");
  } else {
    // Navigatören sitter med i planet (helskärm 3D utan dimma) och har en liten minikarta.
    const [{ RadarView }, { NavCockpit }] = await Promise.all([import('./radar.js'), import('./nav3d.js')]);
    if (!app.inGame) return;
    const view = new NavCockpit($('.view3d-holder', navUI), level);
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
          g.goSentAt = performance.now();
          toPeer({ t: 'go' });
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
function countUp(el, to, ms = 900) {
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showResults(e) {
  const g = app.game;
  if (!g) return;
  const role = g.role;
  const score = e.score || 0;
  const partner = app.mode === 'npc' ? 'NPC' : app.mode === 'navai' ? 'AI pilot' : app.mode === 'solo' ? null : app.friendName;
  const isRecord = Store.addResult({
    level: g.level.id, time: Math.round(e.time * 10) / 10, score, crashes: e.crashes, misses: e.misses, stars: e.stars || 0,
    role, partner, solo: isSolo(),
  });
  const res = $('#results');
  $('.res-title', res).textContent = e.crashes ? `Finished! (attempt ${e.crashes + 1})` : 'Finished – first try!';
  countUp($('.res-score', res), score);
  $('.res-time', res).textContent = e.time.toFixed(1) + ' s';
  $('.res-stars', res).textContent = `${e.stars || 0}/${e.totalStars || 0}`;
  $('.res-perfect', res).textContent = String(e.perfects || 0);
  $('.res-tbonus', res).textContent = '+' + (e.timeBonus || 0);
  $('.res-details', res).textContent = e.misses ? `${e.misses} missed gate${e.misses > 1 ? 's' : ''}` : '';
  $('.res-record', res).textContent = isRecord ? '🏆 New record!' : '';
  res.classList.remove('hidden');
  const panel = $('.panel', res);
  panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
}

function endGame() {
  const g = app.game;
  app.inGame = false;
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

function initGameMenu() {
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
applyTouchSetting();

// För automatiska tester
window.__blindflyg = { app, startSolo };
