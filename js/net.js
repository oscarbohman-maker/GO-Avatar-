// Nätverk: peer-to-peer via WebRTC (PeerJS). Värden får en kort kod,
// vännen ansluter med koden. Ingen egen server behövs.
/* global Peer */
import { loadMqtt, relayBrokers, relayTopic, connectBroker, RelayConn } from './relay.js';

export const PROTOCOL_VERSION = 2;
const PREFIX = 'plaindodge-v2-';
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 24 * 60 * 60 * 1000;   // en kod gäller i ett dygn
const CODE_KEY = 'plaindodge.hostcode.v1';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // inga 0/O eller 1/I
const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 10000;

export function randomCode(len = CODE_LENGTH) {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export function normalizeCode(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function clearHostCode() { try { localStorage.removeItem(CODE_KEY); } catch (_) {} }

// Möjlighet att peka på egen PeerJS-server, t.ex. ?peerHost=localhost&peerPort=9000&peerPath=/
// Fler STUN-servrar (hittar vägen genom routrar) och PeerJS TURN-reläer både via UDP och TCP
// (TCP hjälper när mobilnät blockerar UDP).
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478',
        'turn:eu-0.turn.peerjs.com:3478?transport=tcp', 'turn:us-0.turn.peerjs.com:3478?transport=tcp'],
      username: 'peerjs', credential: 'peerjsp',
    },
  ],
  sdpSemantics: 'unified-plan',
};

function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 1, config: ICE };
  if (q.get('peerHost')) {
    opts.host = q.get('peerHost');
    opts.port = Number(q.get('peerPort') || 443);
    opts.path = q.get('peerPath') || '/';
    opts.secure = q.get('peerSecure') !== '0';
  }
  return opts;
}

const ERRORS = {
  'peer-unavailable': 'No game found with that code. Check the code and that your friend has the lobby open.',
  'network': 'Could not reach the connection server. Check your internet connection.',
  'server-error': 'The connection server did not respond. Try again in a moment.',
  'socket-error': 'The connection to the server was lost. Try again.',
  'socket-closed': 'The connection to the server was closed. Try again.',
  'browser-incompatible': 'Your browser does not support WebRTC. Update Safari or try another browser.',
  'webrtc': 'Could not create a direct connection between you (WebRTC).',
};
const MSG_ICE_FAILED = 'Your devices found each other but could not connect, not even through the relay. Check that both have internet and try again.';
const RELAY_AFTER_MS = 7000;   // byt till reläet om direktanslutningen inte öppnats efter så här lång tid
const MSG_NO_HOST = "Could not reach your friend's game. Make sure the code is right and that your friend keeps Plain Dodge open on screen (not in the background).";

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.code = null;
    this.handlers = {};
    this.lastSeen = 0;
    this._hb = null;
    this.closed = false;
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  emit(type, ...a) { (this.handlers[type] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); }

  get connected() { return !!(this.conn && this.conn.open); }
  get remoteId() { return this.conn ? this.conn.peer : null; }

  _createPeer(id) {
    if (typeof Peer === 'undefined') throw new Error('PeerJS could not be loaded.');
    return id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
  }

  host(attempt = 0) {
    this.isHost = true;
    // En ny kod för varje party. Vid återanslutning (_forced) behålls samma kod.
    const saved = this._forced || null;
    this._forced = null;
    this.code = saved ? saved.code : randomCode();
    this.created = saved ? saved.created : Date.now();
    const peer = this._createPeer(PREFIX + this.code);
    this.peer = peer;
    peer.on('open', () => {
      this.emit('code', this.code);
      this._hostRelay();
    });
    peer.on('connection', (conn) => {
      if (this.expired) {
        conn.on('open', () => { conn.send({ t: 'expired' }); setTimeout(() => conn.close(), 500); });
        return;
      }
      if (this.conn && this.conn.open) {
        conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); });
        return;
      }
      this._bind(conn);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        if (this._registered) {
          // Vi hade redan koden och höll på att återansluta (t.ex. efter att Safari varit i bakgrunden).
          // Servern minns fortfarande den gamla anslutningen en stund – försök igen med SAMMA kod,
          // så att koden som vännen fått fortsätter att fungera.
          this._retrySameCode();
          return;
        }
        if (attempt < 5) {
          // koden används redan av någon annan (eller en annan flik) – ta en ny innan vi visat den
          peer.destroy();
          this.host(attempt + 1);
          return;
        }
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type) && this._registered) {
        this.emit('status', 'reconnecting');
        this._scheduleReconnect();
        return;
      }
      this._error(err);
    });
    peer.on('open', () => { this._registered = true; this._retries = 0; this.emit('status', 'online'); });
    peer.on('disconnected', () => {
      // Tappad kontakt med servern (t.ex. när Safari lagts i bakgrunden).
      // Ett pågående spel fortsätter direkt mellan er, men utan servern kan ingen ny vän gå med.
      if (this.closed || peer.destroyed) return;
      this.emit('status', 'reconnecting');
      this._scheduleReconnect();
    });
    // När sidan blir synlig igen: återanslut direkt
    if (!this._vis) {
      this._vis = () => { if (document.visibilityState === 'visible' && this.peer && this.peer.disconnected && !this.closed) this._scheduleReconnect(0); };
      document.addEventListener('visibilitychange', this._vis);
    }
  }

  _scheduleReconnect(delay = 1000) {
    clearTimeout(this._rt);
    this._rt = setTimeout(() => {
      const p = this.peer;
      if (this.closed || !p) return;
      if (p.destroyed) { this._retrySameCode(); return; }
      if (p.disconnected) { try { p.reconnect(); } catch (_) { this._retrySameCode(); } }
    }, delay);
  }

  // Skapa en ny peer med samma kod (efter en stund, så att servern hunnit glömma den gamla)
  _retrySameCode() {
    clearTimeout(this._rt);
    this._retries = (this._retries || 0) + 1;
    const wait = Math.min(8000, 1500 * this._retries);
    this.emit('status', 'reconnecting');
    this._rt = setTimeout(() => {
      if (this.closed) return;
      // Pågår ett spel får peeren inte förstöras (då stängs anslutningen till vännen) – försök bara återansluta
      if (this.connected && this.peer && !this.peer.destroyed) { try { this.peer.reconnect(); } catch (_) {} return; }
      try { this.peer && this.peer.destroy(); } catch (_) {}
      this._forced = { code: this.code, created: this.created };   // samma kod, ingen ny
      this.host(0);
    }, wait);
  }

  // ---------------------------------------------------------------- relä (reservväg)
  // Värden lyssnar på reläet från början, så att en gäst som inte får en direktanslutning
  // kan nå värden den vägen i stället.
  async _hostRelay() {
    if (this._relayStarted || this.closed) return;
    this._relayStarted = true;
    try { await loadMqtt(); } catch (e) { console.warn(e); return; }
    const base = relayTopic(this.code);
    this._relayClients = [];
    for (const url of relayBrokers()) {
      connectBroker(url).then((c) => {
        if (this.closed) { c.end(true); return; }
        this._relayClients.push(c);
        c.subscribe(base + '/h');
        c.on('message', (topic, buf) => {
          let d; try { d = JSON.parse(buf.toString()); } catch (_) { return; }
          if (!d || typeof d.sid !== 'string' || !d.m) return;
          const m = d.m;
          if (m.t === 'relay-hello') {
            const reply = (msg) => c.publish(base + '/g', JSON.stringify({ sid: d.sid, m: msg }));
            if (this.expired) { reply({ t: 'expired' }); return; }
            if (this.conn && this.conn.open && !(this.conn.relay && this.conn.sid === d.sid)) { reply({ t: 'full' }); return; }
            if (!(this.conn && this.conn.relay && this.conn.sid === d.sid)) {
              // ingen öppen direktanslutning: använd reläet för den här gästen
              try { if (this.conn && !this.conn.relay) this.conn.close(); } catch (_) {}
              const rc = new RelayConn(c, base + '/g', d.sid);
              this._bind(rc);
              reply({ t: 'relay-ok' });
              rc.markOpen();
            } else reply({ t: 'relay-ok' });
            return;
          }
          if (this.conn && this.conn.relay && this.conn.sid === d.sid) this.conn.deliver(m);
        });
      }).catch((e) => console.warn('relay', e.message));
    }
  }

  // Gästen: direktanslutningen öppnades inte – gå via reläet
  async _guestRelay() {
    if (this._relayStarted || this.closed || this.connected) return;
    this._relayStarted = true;
    this.emit('status', 'relay');
    try { await loadMqtt(); } catch (e) { this._relayFailed(); return; }
    const base = relayTopic(this.code);
    const sid = Math.random().toString(36).slice(2, 10);
    let client = null;
    for (const url of relayBrokers()) {
      try { client = await connectBroker(url); break; } catch (e) { console.warn('relay', e.message); }
      if (this.closed) return;
    }
    if (!client || this.closed || this.connected) { if (client) client.end(true); if (!client) this._relayFailed(); return; }
    this._relayClients = [client];
    let rc = null, hello = null;
    client.subscribe(base + '/g');
    client.on('message', (topic, buf) => {
      let d; try { d = JSON.parse(buf.toString()); } catch (_) { return; }
      if (!d || d.sid !== sid || !d.m) return;
      if (d.m.t === 'relay-ok' && !rc) {
        clearInterval(hello);
        if (this.connected) return;                        // direktanslutningen hann öppnas
        try { if (this.conn && !this.conn.relay) this.conn.close(); } catch (_) {}
        rc = new RelayConn(client, base + '/h', sid);
        this._bind(rc);
        rc.markOpen();
        return;
      }
      if (d.m.t === 'full' || d.m.t === 'expired') { clearInterval(hello); }
      if (rc) rc.deliver(d.m);
      else if (d.m.t === 'full' || d.m.t === 'expired') this.emit('message', d.m);
    });
    const send = () => client.publish(base + '/h', JSON.stringify({ sid, m: { t: 'relay-hello' } }));
    send();
    hello = setInterval(() => { if (this.closed || rc) { clearInterval(hello); return; } send(); }, 1500);
  }

  _relayFailed() {
    if (this._errored || this.closed || this.connected) return;
    this._errored = true;
    clearTimeout(this._joinDeadline);
    this.emit('error', MSG_ICE_FAILED);
  }

  get relay() { return !!(this.conn && this.conn.relay); }

  // Millisekunder kvar tills koden går ut
  get expiresIn() { return this.created ? this.created + CODE_TTL_MS - Date.now() : CODE_TTL_MS; }

  // Kallas när koden har gått ut: inga nya spelare kan gå med
  expire() {
    this.expired = true;
    clearHostCode();
  }

  // Gå med: kontakta servern, leta upp värdens kod och öppna en direktanslutning.
  // Hittas inte värden försöker vi igen några gånger (värden kan ha haft spelet i bakgrunden).
  join(code) {
    this.isHost = false;
    this.code = normalizeCode(code);
    this._joinTries = 0;
    const peer = this._createPeer(null);
    this.peer = peer;
    this.emit('status', 'server');
    // Hela förloppet har en tidsgräns, även om servern aldrig svarar
    this._joinDeadline = setTimeout(() => {
      if (this.closed || this.connected || this._errored) return;
      this._errored = true;
      this.emit('error', !peer.open ? ERRORS.network
        : this._iceFailed || this._sawHost ? MSG_ICE_FAILED : MSG_NO_HOST);
    }, 45000);
    peer.on('open', () => this._tryConnect());
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') clearTimeout(this._relayT);   // värden finns inte – inget relä
      if (err.type === 'peer-unavailable' && this._joinTries < 4 && !this.closed) {
        // värden finns inte (just nu) – vänta och försök igen
        this.emit('status', 'retry');
        setTimeout(() => this._tryConnect(), 3000);
        return;
      }
      if (err.type === 'peer-unavailable') { this._errored = true; clearTimeout(this._joinDeadline); this.emit('error', MSG_NO_HOST); return; }
      clearTimeout(this._joinDeadline);
      this._error(err);
    });
  }

  _tryConnect() {
    if (this.closed || this.connected || this._errored) return;
    this._joinTries++;
    this.emit('status', 'finding');
    // öppnas ingen direktanslutning alls (inte ens ett försök) går vi via reläet efter en stund
    clearTimeout(this._relayT);
    this._relayT = setTimeout(() => this._guestRelay(), RELAY_AFTER_MS + 2000);
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    this._bind(conn);
    conn.on('iceStateChanged', (st) => {
      if (st === 'checking') {
        this._sawHost = true; this.emit('status', 'linking');
        // värden finns – öppnas inte direktanslutningen snart går vi via reläet
        clearTimeout(this._relayT);
        this._relayT = setTimeout(() => this._guestRelay(), RELAY_AFTER_MS);
      }
      if (st === 'failed' && !conn.open) { this._iceFailed = true; this._guestRelay(); }
    });
  }

  _error(err) {
    console.warn('Peer error', err && err.type, err);
    this._errored = true;
    this.emit('error', ERRORS[err && err.type] || ('Connection error: ' + ((err && err.message) || err)));
  }

  _bind(conn) {
    this.conn = conn;
    this._lostFired = false;
    conn.on('open', () => {
      if (this.conn !== conn) return;
      clearTimeout(this._joinDeadline);
      this.lastSeen = performance.now();
      clearInterval(this._hb);
      this._hb = setInterval(() => {
        if (!this.connected) return;
        this.send({ t: 'hb' });
        if (performance.now() - this.lastSeen > TIMEOUT_MS) this._lost();
      }, HEARTBEAT_MS);
      this.emit('open');
    });
    conn.on('data', (msg) => {
      if (this.conn !== conn) return;
      this.lastSeen = performance.now();
      if (!msg || typeof msg !== 'object' || msg.t === 'hb') return;
      this.emit('message', msg);
    });
    conn.on('close', () => { if (this.conn === conn) this._lost(); });
    conn.on('error', (e) => { console.warn('conn error', e); });
  }

  _lost() {
    if (this.closed || this._lostFired) return;
    this._lostFired = true;
    clearInterval(this._hb);
    const old = this.conn;
    try { old && old.close(); } catch (_) {}
    this.emit('close');
  }

  send(msg) {
    if (this.connected) {
      try { this.conn.send(msg); } catch (e) { console.warn('send failed', e); }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this._hb);
    clearTimeout(this._rt);
    clearTimeout(this._joinDeadline);
    clearTimeout(this._relayT);
    if (this._vis) document.removeEventListener('visibilitychange', this._vis);
    (this._relayClients || []).forEach((c) => { try { c.end(true); } catch (_) {} });
    try { this.conn && this.conn.close(); } catch (_) {}
    try { this.peer && this.peer.destroy(); } catch (_) {}
    this.handlers = {};
  }
}
