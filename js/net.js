// Nätverk: peer-to-peer via WebRTC (PeerJS). Värden får en kort kod,
// vännen ansluter med koden. Ingen egen server behövs.
/* global Peer */

export const PROTOCOL_VERSION = 1;
const PREFIX = 'blindflyg-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // inga 0/O eller 1/I
const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 10000;

export function randomCode(len = 4) {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export function normalizeCode(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

// Möjlighet att peka på egen PeerJS-server, t.ex. ?peerHost=localhost&peerPort=9000&peerPath=/
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 1 };
  if (q.get('peerHost')) {
    opts.host = q.get('peerHost');
    opts.port = Number(q.get('peerPort') || 443);
    opts.path = q.get('peerPath') || '/';
    opts.secure = q.get('peerSecure') !== '0';
  }
  return opts;
}

const ERRORS = {
  'peer-unavailable': 'Hittade inget spel med den koden. Kontrollera koden och att din vän har lobbyn öppen.',
  'network': 'Kunde inte nå anslutningsservern. Kontrollera internetanslutningen.',
  'server-error': 'Anslutningsservern svarade inte. Försök igen om en stund.',
  'socket-error': 'Anslutningen till servern bröts. Försök igen.',
  'socket-closed': 'Anslutningen till servern stängdes. Försök igen.',
  'browser-incompatible': 'Din webbläsare stöder inte WebRTC. Uppdatera Safari eller prova en annan webbläsare.',
  'webrtc': 'Kunde inte skapa en direktanslutning mellan er (WebRTC).',
};

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
    if (typeof Peer === 'undefined') throw new Error('PeerJS kunde inte laddas.');
    return id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
  }

  host(attempt = 0) {
    this.isHost = true;
    this.code = randomCode();
    const peer = this._createPeer(PREFIX + this.code);
    this.peer = peer;
    peer.on('open', () => this.emit('code', this.code));
    peer.on('connection', (conn) => {
      if (this.conn && this.conn.open) {
        conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); });
        return;
      }
      this._bind(conn);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && attempt < 5) {
        peer.destroy();
        this.host(attempt + 1);
        return;
      }
      this._error(err);
    });
    peer.on('disconnected', () => {
      // Tappad kontakt med signalservern. Pågående spel fortsätter peer-to-peer,
      // men försök återansluta så att vännen kan gå med.
      if (!this.closed && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (_) {} }, 1000);
    });
  }

  join(code) {
    this.isHost = false;
    this.code = normalizeCode(code);
    const peer = this._createPeer(null);
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this._bind(conn);
      // Om anslutningen inte öppnas inom rimlig tid
      setTimeout(() => {
        if (!this.closed && !this._errored && !(this.conn && this.conn.open)) this.emit('error', 'Det tog för lång tid att ansluta. Kontrollera koden och försök igen.');
      }, 15000);
    });
    peer.on('error', (err) => this._error(err));
  }

  _error(err) {
    console.warn('Peer error', err && err.type, err);
    this._errored = true;
    this.emit('error', ERRORS[err && err.type] || ('Anslutningsfel: ' + ((err && err.message) || err)));
  }

  _bind(conn) {
    this.conn = conn;
    this._lostFired = false;
    conn.on('open', () => {
      if (this.conn !== conn) return;
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
    try { this.conn && this.conn.close(); } catch (_) {}
    try { this.peer && this.peer.destroy(); } catch (_) {}
    this.handlers = {};
  }
}
