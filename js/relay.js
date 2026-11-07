// Reservväg när en direktanslutning (WebRTC) inte går att öppna mellan två nätverk.
// Speldatan skickas då via en offentlig MQTT-server över en vanlig säker webbanslutning (wss),
// som fungerar på i princip alla nät. Röstchatt går inte via reläet.
/* global mqtt */

// Offentliga MQTT-servrar (gratis, inget konto). Värden lyssnar på alla, gästen använder den första som svarar.
export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];

export function relayBrokers() {
  const q = new URLSearchParams(location.search);
  return q.get('relay') ? [q.get('relay')] : BROKERS;   // ?relay=ws://... för test mot egen server
}

let loading = null;
export function loadMqtt() {
  if (typeof mqtt !== 'undefined') return Promise.resolve();
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'js/lib/mqtt.min.js';
      s.onload = () => res();
      s.onerror = () => { loading = null; rej(new Error('Could not load the relay library.')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export const relayTopic = (code) => `plaindodge/v2/${code}`;

// Ansluter till en broker. Löser med klienten när den är ansluten, annars fel efter timeout.
export function connectBroker(url, timeoutMs = 6000) {
  return new Promise((res, rej) => {
    const c = mqtt.connect(url, { connectTimeout: timeoutMs, reconnectPeriod: 2000, clean: true, keepalive: 20 });
    const t = setTimeout(() => { c.end(true); rej(new Error('timeout ' + url)); }, timeoutMs + 500);
    c.once('connect', () => { clearTimeout(t); res(c); });
    c.on('error', () => {});
  });
}

// En "anslutning" via reläet med samma gränssnitt som PeerJS DataConnection (open, send, on, close)
export class RelayConn {
  constructor(client, outTopic, sid) {
    this.client = client;
    this.outTopic = outTopic;
    this.sid = sid;
    this.open = false;
    this.peer = 'relay';
    this.relay = true;
    this.h = {};
    this._lastSt = 0;
  }

  on(ev, fn) { (this.h[ev] ||= []).push(fn); return this; }
  _emit(ev, ...a) { (this.h[ev] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); }

  // anropas av Net när ett meddelande för den här sessionen kommer in
  deliver(m) { if (this.open) this._emit('data', m); }

  markOpen() { if (!this.open) { this.open = true; this._emit('open'); } }

  send(m) {
    if (!this.open) return;
    // planets läge skickas högst 10 ggr/s via reläet (navigatörens vy interpolerar mellan lägena)
    if (m && m.t === 'st') {
      const now = performance.now();
      if (now - this._lastSt < 95) return;
      this._lastSt = now;
    }
    try { this.client.publish(this.outTopic, JSON.stringify({ sid: this.sid, m })); } catch (_) {}
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this._emit('close');
  }
}
