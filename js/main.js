// Appens styrning: startsida, lobby, spelstart, nätverksmeddelanden och resultat.
import { Net, PROTOCOL_VERSION, normalizeCode } from './net.js';
import { Voice } from './voice.js';
import { Store } from './storage.js';
import { WORLDS, LEVEL_INFO, buildLevel } from './levels.js';
import { sfx, unlockAudio } from './sfx.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const ROLE = {
  pilot: { name: 'Pilot', icon: '✈️', desc: 'Flyger planet' },
  navigator: { name: 'Navigatör', icon: '🧭', desc: 'Ser radarn och guidar' },
};
const other = (r) => (r === 'pilot' ? 'navigator' : 'pilot');

const app = {
  net: null,
  voice: null,
  isHost: false,
  hostRole: 'pilot',
  friendName: null,
  levelId: 'demo',
  solo: false,
  game: null,
  inGame: false,
};
const myRole = () => (app.solo ? 'pilot' : app.isHost ? app.hostRole : other(app.hostRole));

// ---------------------------------------------------------------- skärmar
function show(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

function message(title, text, onOk) {
  const ov = $('#overlay-msg');
  $('.ov-title', ov).textContent = title;
  $('.ov-text', ov).textContent = text;
  ov.classList.remove('hidden');
  $('#btn-ov').onclick = () => { ov.classList.add('hidden'); onOk && onOk(); };
}

function setStatus(el, text, cls = '') {
  el.textContent = text || '';
  el.className = 'status ' + cls;
}

// Pekskärm?
function detectTouch() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (coarse || 'ontouchstart' in window) document.body.classList.add('touch');
}
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
// Safari: hindra nyp-zoom i spelet
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------------------------------------------------------------- startsida
function renderRecords() {
  const p = Store.profile;
  const el = $('#records');
  const best = Object.entries(p.best);
  if (!best.length && !p.history.length) { el.innerHTML = ''; return; }
  let html = '<h4>Dina rekord (sparas på den här enheten)</h4><ul>';
  for (const [lvl, b] of best) {
    const name = (LEVEL_INFO[lvl] && LEVEL_INFO[lvl].name) || lvl;
    html += `<li>${esc(name)}: <b>${b.time.toFixed(1)} s</b> (${b.crashes} krascher${b.partner ? ', med ' + esc(b.partner) : ''})</li>`;
  }
  html += `</ul><small>Totalt ${p.history.length} flygningar.</small>`;
  el.innerHTML = html;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function myName() {
  return Store.profile.name || 'Spelare';
}

function initHome() {
  const nameIn = $('#name-input');
  nameIn.value = Store.profile.name;
  nameIn.addEventListener('input', () => Store.setName(nameIn.value.trim()));
  const inv = $('#invert-input');
  inv.checked = Store.profile.invertY;
  inv.addEventListener('change', () => Store.setInvert(inv.checked));

  const codeIn = $('#code-input');
  codeIn.addEventListener('input', () => { codeIn.value = normalizeCode(codeIn.value); });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });

  $('#btn-create').onclick = () => { unlockAudio(); hostGame(); };
  $('#btn-join').onclick = () => {
    unlockAudio();
    const code = normalizeCode(codeIn.value);
    if (code.length !== 4) { setStatus($('#home-status'), 'Koden ska vara 4 tecken.', 'error'); return; }
    joinGame(code);
  };
  $('#btn-solo').onclick = () => { unlockAudio(); startSolo(); };
  renderRecords();

  // Inbjudningslänk: ?join=KOD
  const q = new URLSearchParams(location.search);
  const j = q.get('join');
  if (j) {
    codeIn.value = normalizeCode(j);
    q.delete('join');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
    if (codeIn.value.length === 4) joinGame(codeIn.value);
  }
}

// ---------------------------------------------------------------- nätverk
function cleanupNet() {
  if (app.net && app.net.connected) app.net.send({ t: 'bye' });
  if (app.voice) { app.voice.destroy(); app.voice = null; }
  if (app.net) { app.net.close(); app.net = null; }
  app.friendName = null;
  $$('.voice-btn').forEach((b) => { b.classList.add('hidden'); b.classList.remove('on', 'muted'); b.textContent = '🎤 Röst av'; });
  $('#btn-audio-tap').classList.add('hidden');
}

function goHome(statusText, cls) {
  endGame();
  cleanupNet();
  app.solo = false;
  document.body.classList.remove('is-host');
  show('screen-home');
  renderRecords();
  setStatus($('#home-status'), statusText || '', cls);
}

function wireNet(net) {
  net.on('message', onMessage);
  net.on('close', () => friendLost(net, false));
  net.on('error', (text) => {
    if (app.net !== net) return;
    if (net.connected) { console.warn(text); return; }
    if (app.isHost) setStatus($('#lobby-status'), text, 'error');
    else goHome(text, 'error');
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
  const who = app.friendName || 'Din vän';
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
    setStatus($('#lobby-status'), (left ? who + ' lämnade spelet.' : 'Anslutningen till ' + who + ' bröts.') + ' Samma kod gäller – din vän kan gå med igen.', 'error');
  } else {
    goHome();
    message(left ? 'Värden lämnade' : 'Anslutningen bröts',
      left ? who + ' avslutade spelet.' : 'Kontakten med ' + who + ' tappades. Gå med igen med koden om spelet fortfarande är öppet.');
  }
}

function hostGame() {
  cleanupNet();
  app.isHost = true;
  app.solo = false;
  document.body.classList.add('is-host');
  app.net = new Net();
  wireNet(app.net);
  app.net.on('code', (code) => {
    $('#lobby-code').textContent = code;
    setStatus($('#lobby-status'), 'Ge koden till din vän, eller tryck "Dela länk".');
  });
  $('#lobby-code').textContent = '····';
  setStatus($('#lobby-status'), 'Skapar spel...');
  renderLobby();
  show('screen-lobby');
  try { app.net.host(); } catch (e) { setStatus($('#lobby-status'), e.message, 'error'); }
}

function joinGame(code) {
  cleanupNet();
  app.isHost = false;
  app.solo = false;
  document.body.classList.remove('is-host');
  setStatus($('#home-status'), 'Ansluter till ' + code + '...');
  app.net = new Net();
  wireNet(app.net);
  try { app.net.join(code); } catch (e) { goHome(e.message, 'error'); }
}

function onMessage(m) {
  switch (m.t) {
    // ---- lobby
    case 'hello':
      if (!app.isHost) return;
      app.friendName = String(m.name || 'Vän').slice(0, 16);
      if (m.ver !== PROTOCOL_VERSION) setStatus($('#lobby-status'), 'Varning: din vän har en annan version av spelet. Ladda om sidan.', 'error');
      else setStatus($('#lobby-status'), app.friendName + ' är med!', 'ok');
      app.net.send({ t: 'welcome', name: myName(), hostRole: app.hostRole, level: app.levelId, ver: PROTOCOL_VERSION });
      renderLobby();
      break;
    case 'welcome':
      app.friendName = String(m.name || 'Vän').slice(0, 16);
      app.hostRole = m.hostRole === 'navigator' ? 'navigator' : 'pilot';
      app.levelId = LEVEL_INFO[m.level] ? m.level : 'demo';
      $('#lobby-code').textContent = app.net.code;
      setStatus($('#lobby-status'), m.ver !== PROTOCOL_VERSION ? 'Varning: olika versioner av spelet. Ladda om sidan.' : 'Ansluten till ' + app.friendName + '!', m.ver !== PROTOCOL_VERSION ? 'error' : 'ok');
      renderLobby();
      show('screen-lobby');
      break;
    case 'bye':
      friendLost(app.net, true);
      break;
    case 'full':
      goHome('Spelet är redan fullt (två spelare).', 'error');
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
  }
}

// ---------------------------------------------------------------- röst
function setupVoice() {
  if (app.voice || !app.net || !app.net.peer) return;
  const btns = $$('.voice-btn');
  const tap = $('#btn-audio-tap');
  app.voice = new Voice(app.net, $('#remote-audio'), (state) => {
    btns.forEach((btn) => {
      btn.classList.toggle('on', state === 'on');
      btn.classList.toggle('muted', state === 'muted');
      btn.textContent = state === 'on' ? '🎤 Röst på' : state === 'muted' ? '🔇 Tystad' : '🎤 Röst av';
    });
    tap.classList.toggle('hidden', !(app.voice && app.voice.needsTap));
  });
  btns.forEach((btn) => {
    btn.classList.remove('hidden');
    btn.textContent = '🎤 Röst av';
    btn.onclick = async () => {
      const v = app.voice;
      if (!v) return;
      if (v.state === 'off') {
        try { await v.enable(); }
        catch (e) {
          const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
          message('Mikrofonen kunde inte startas', denied ? 'Tillåt mikrofonen för sidan i Safari och försök igen. Ni kan också ringa varandra istället.' : ((e && e.message) || 'Okänt fel.'));
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
    $('.role-icon', el).textContent = empty ? '⏳' : ROLE[role].icon;
    $('.pname', el).textContent = empty ? 'Väntar på vän...' : name;
    $('.prole', el).textContent = empty ? 'Dela koden ovan' : ROLE[role].name + ' – ' + ROLE[role].desc;
  };
  fill('#slot-me', myName() + ' (du)', mine, false);
  fill('#slot-friend', app.friendName, other(mine), !app.friendName);

  const list = $('#world-list');
  list.innerHTML = '';
  for (const w of WORLDS) {
    const el = document.createElement('div');
    const lvl = w.levels[0];
    const selected = w.available && lvl === app.levelId;
    el.className = 'world' + (w.available ? '' : ' locked') + (selected ? ' selected' : '');
    const best = lvl && Store.profile.best[lvl];
    el.innerHTML = `<div><b>${esc(w.name)}</b><small>${w.available ? esc(LEVEL_INFO[lvl].name) + (best ? ' · rekord ' + best.time.toFixed(1) + ' s' : '') : 'Kommer snart'}</small></div><span class="diff">${esc(w.difficulty)}</span>`;
    if (w.available && app.isHost) {
      el.style.cursor = 'pointer';
      el.onclick = () => { app.levelId = lvl; app.net && app.net.send({ t: 'level', level: lvl }); renderLobby(); };
    }
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
  $('#btn-leave').onclick = () => goHome();
  $('#btn-share').onclick = async () => {
    const code = app.net && app.net.code;
    if (!code) return;
    const q = new URLSearchParams(location.search);
    q.set('join', code);
    const url = location.origin + location.pathname + '?' + q.toString();
    const text = `Flyg med mig i Blindflyg! Kod: ${code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Blindflyg', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try {
      await navigator.clipboard.writeText(url);
      setStatus($('#lobby-status'), 'Länken är kopierad!', 'ok');
    } catch (_) {
      window.prompt('Kopiera länken:', url);
    }
  };
}

function backToLobby(notify) {
  if (notify && app.net) app.net.send({ t: 'lobby' });
  endGame();
  if (app.solo || !app.net) { goHome(); return; }
  renderLobby();
  show('screen-lobby');
}

// ---------------------------------------------------------------- spel
let flashTimer = null;
function flash(text, cls = '', ms = 1100, html = false) {
  const el = app.game && app.game.msgEl;
  if (!el) return;
  if (html) el.innerHTML = text; else el.textContent = text;
  el.className = 'center-msg show ' + cls;
  clearTimeout(flashTimer);
  if (ms) flashTimer = setTimeout(() => { el.className = 'center-msg'; }, ms);
}

function handleEvent(e) {
  const g = app.game;
  if (!g) return;
  switch (e.kind) {
    case 'go': flash('KÖR!', 'good big', 700); sfx.go(); break;
    case 'pass':
      if (!e.finished) { flash(`Port ${e.gate + 1} ✓`, 'good', 800); sfx.gate(); }
      break;
    case 'miss': flash(`Missad port ${e.gate + 1}! <small>+${g.level.penalties.miss} s</small>`, 'bad', 1300, true); sfx.miss(); break;
    case 'crash': flash(`KRASCH! <small>in i ${esc(e.what)} · +${g.level.penalties.crash} s</small>`, 'bad', 1300, true); sfx.crash(); break;
    case 'finish': sfx.finish(); showResults(e); break;
  }
}

function updateHud(root, snap, level) {
  const total = level.gates.length;
  $$('.hud-time', root).forEach((el) => { el.textContent = snap.tm.toFixed(1); });
  $$('.hud-gate', root).forEach((el) => { el.textContent = Math.min(snap.ng + 1, total) + '/' + total; });
  $$('.hud-crash', root).forEach((el) => { el.textContent = String(snap.cr); });
  $$('.hud-speed', root).forEach((el) => { el.textContent = String(Math.round(snap.sp * 3.6)); });
  $$('.hud-alt', root).forEach((el) => { el.textContent = Math.round(snap.y) + ' m'; });
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
  detectTouch();
  requestWakeLock();
  $('#results').classList.add('hidden');
  const pilotUI = $('#pilot-ui'), navUI = $('#nav-ui');
  pilotUI.classList.toggle('hidden', role !== 'pilot');
  navUI.classList.toggle('hidden', role !== 'navigator');

  if (role === 'pilot') {
    const { PilotView } = await import('./pilot.js');
    if (!app.inGame) return;
    let sendT = 0;
    const g = {
      role, level,
      msgEl: $('.center-msg', pilotUI),
      begin: () => { pv.begin(); $('.wait-msg', pilotUI).classList.add('hidden'); },
      restart: (notify) => {
        pv.restart();
        $('#results').classList.add('hidden');
        if (minimap) minimap.resetTrail();
        if (notify && app.net) app.net.send({ t: 'restart' });
        if (app.solo) g.begin();
        else showWait();
      },
    };
    const showWait = () => {
      const w = $('.wait-msg', pilotUI);
      w.textContent = 'Navigatören planerar rutten... Gör dig redo!';
      w.classList.remove('hidden');
    };
    let minimap = null;
    const pv = new PilotView(pilotUI, level, {
      invertY: Store.profile.invertY,
      onEvent: (e) => {
        handleEvent(e);
        if (app.net) app.net.send({ t: 'ev', e });
      },
      onFrame: (S, dt) => {
        const snap = S.snapshot();
        updateHud(pilotUI, snap, level);
        countdownDisplay(g, snap);
        if (minimap) minimap.setState(snap);
        sendT += dt;
        if (app.net && sendT >= 0.05) { sendT = 0; app.net.send(snap); }
      },
    });
    g.view = pv;
    app.game = g;
    if (app.solo) {
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
    if (app.solo) g.begin(); else showWait();
  } else {
    const { RadarView } = await import('./radar.js');
    if (!app.inGame) return;
    const canvas = $('.radar', navUI);
    const rv = new RadarView(canvas, level, { interactive: true, mode: 'overview' });
    const planBox = $('.plan-box', navUI);
    const toolBtn = (a) => $(`[data-act="${a}"]`, navUI);
    const syncTools = () => {
      toolBtn('mode').textContent = rv.mode === 'north' ? 'Norr upp' : 'Nos upp';
      toolBtn('overview').classList.toggle('on', rv.mode === 'overview');
    };
    let modeBeforeOverview = 'heading';
    const g = {
      role, level, view: rv,
      msgEl: $('.center-msg', navUI),
      onState: (snap) => {
        rv.setState(snap);
        updateHud(navUI, snap, level);
        countdownDisplay(g, snap);
        updateGuide(navUI, rv);
        // Om "go" kom bort (t.ex. om pilotens vy inte hunnit laddas) – skicka igen
        if (g.goSentAt && snap.ph === 'waiting' && performance.now() - g.goSentAt > 1500) {
          g.goSentAt = performance.now();
          if (app.net) app.net.send({ t: 'go' });
        } else if (snap.ph !== 'waiting') g.goSentAt = 0;
      },
      planning: () => {
        g.goSentAt = 0;
        rv.setMode('overview');
        rv.resetTrail();
        planBox.classList.remove('hidden');
        $('.guide', navUI).classList.add('hidden');
        syncTools();
      },
      restart: (notify) => {
        $('#results').classList.add('hidden');
        if (notify && app.net) app.net.send({ t: 'restart' });
        g.planning();
      },
    };
    $$('[data-act]', navUI).forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'zoom-in') { if (rv.mode === 'overview') rv.setMode(modeBeforeOverview); rv.zoom(-1); }
        if (a === 'zoom-out') { if (rv.mode === 'overview') rv.setMode(modeBeforeOverview); rv.zoom(1); }
        if (a === 'mode') {
          const base = rv.mode === 'overview' ? modeBeforeOverview : rv.mode;
          modeBeforeOverview = base === 'heading' ? 'north' : 'heading';
          rv.setMode(modeBeforeOverview);
        }
        if (a === 'overview') {
          if (rv.mode === 'overview') rv.setMode(modeBeforeOverview);
          else { modeBeforeOverview = rv.mode; rv.setMode('overview'); }
        }
        if (a === 'undo') rv.undoRoute();
        if (a === 'clear') rv.clearRoute();
        if (a === 'go') {
          unlockAudio();
          planBox.classList.add('hidden');
          $('.guide', navUI).classList.remove('hidden');
          rv.setMode(modeBeforeOverview);
          g.goSentAt = performance.now();
          if (app.net) app.net.send({ t: 'go' });
        }
        syncTools();
      };
    });
    // Översiktskartan ska rymmas mellan panelerna
    const updateInsets = () => {
      const H = navUI.clientHeight;
      const panelB = $('.nav-panel', navUI).getBoundingClientRect().bottom;
      const tools = $('.nav-tools', navUI).getBoundingClientRect().top;
      const plan = planBox.classList.contains('hidden') ? H : planBox.getBoundingClientRect().top;
      const narrow = navUI.clientWidth < 640;
      rv.insets = { top: narrow ? panelB + 6 : 10, bottom: H - Math.min(tools, plan) + 6, left: 8, right: 64 };
    };
    rv.beforeDraw = updateInsets;
    app.game = g;
    rv.start();
    g.planning();
  }
}

function updateGuide(root, rv) {
  const gd = rv.guidance();
  if (!gd) return;
  const t = Math.round(gd.turn);
  const turnEl = $('.guide-turn', root), altEl = $('.guide-alt', root), distEl = $('.guide-dist', root);
  const name = gd.gate.finish ? 'målet' : 'port ' + (gd.gate.idx + 1);
  if (Math.abs(t) > 150) turnEl.textContent = '↩ Vänd om';
  else if (t > 6) turnEl.textContent = `↱ Höger ${t}°`;
  else if (t < -6) turnEl.textContent = `↰ Vänster ${-t}°`;
  else turnEl.textContent = '↑ Rakt fram';
  const dy = Math.round(gd.dy);
  altEl.textContent = dy > 1 ? `Stig ${dy} m` : dy < -1 ? `Sjunk ${-dy} m` : 'Rätt höjd';
  distEl.textContent = `${Math.round(gd.dist)} m till ${name}`;
}

function showResults(e) {
  const g = app.game;
  if (!g) return;
  const role = g.role;
  const isRecord = Store.addResult({
    level: g.level.id, time: Math.round(e.time * 10) / 10, crashes: e.crashes, misses: e.misses,
    role, partner: app.solo ? null : app.friendName, solo: app.solo,
  });
  const res = $('#results');
  $('.res-title', res).textContent = 'I mål!';
  $('.res-time', res).textContent = e.time.toFixed(1) + ' s';
  $('.res-details', res).textContent = `${e.crashes} krascher · ${e.misses} missade portar`;
  $('.res-record', res).textContent = isRecord ? '🏆 Nytt rekord!' : '';
  res.classList.remove('hidden');
}

function endGame() {
  const g = app.game;
  app.inGame = false;
  if (g) {
    try { g.view && g.view.destroy(); } catch (e) { console.warn(e); }
    try { g.minimap && g.minimap.destroy(); } catch (e) { console.warn(e); }
  }
  app.game = null;
  $('#results').classList.add('hidden');
  $$('.center-msg').forEach((el) => { el.className = 'center-msg'; });
  try { app.wakeLock && app.wakeLock.release(); } catch (_) {}
  app.wakeLock = null;
}

function startSolo() {
  cleanupNet();
  app.solo = true;
  app.isHost = true;
  app.hostRole = 'pilot';
  startGame();
}

function initGameMenu() {
  $('#btn-restart').onclick = () => app.game && app.game.restart(true);
  $('#btn-again').onclick = () => app.game && app.game.restart(true);
  $('#btn-tolobby').onclick = () => backToLobby(true);
  $('#btn-res-lobby').onclick = () => backToLobby(true);
}

// ---------------------------------------------------------------- start
initHome();
initLobby();
initGameMenu();
detectTouch();

// För automatiska tester
window.__blindflyg = { app };
