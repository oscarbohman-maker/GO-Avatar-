// Röstchatt (beta) via samma WebRTC-anslutning. Var spelare slår på sin mikrofon själv.
// Varje spelare skickar sitt ljud i högst ett samtal, så att ljudet aldrig dubbleras.

export class Voice {
  constructor(net, audioEl, onState) {
    this.net = net;
    this.audioEl = audioEl;
    this.onState = onState || (() => {});
    this.localStream = null;
    this.sent = false;
    this.muted = false;
    this.calls = [];
    this.needsTap = false;
    this._onCall = (call) => this._incoming(call);
    net.peer.on('call', this._onCall);
  }

  get state() {
    if (!this.localStream) return 'off';
    return this.muted ? 'muted' : 'on';
  }

  async enable() {
    if (this.localStream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Mikrofon stöds inte här. Röstchatt kräver https och en modern webbläsare.');
    }
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (!this.sent && this.net.remoteId) {
      this.sent = true;
      const call = this.net.peer.call(this.net.remoteId, this.localStream);
      this._track(call);
    }
    this.onState(this.state);
  }

  toggleMute() {
    if (!this.localStream) return;
    this.muted = !this.muted;
    this.localStream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    this.onState(this.state);
  }

  _incoming(call) {
    if (this.destroyed || call.peer !== this.net.remoteId) { call.close(); return; }
    if (this.localStream && !this.sent) { this.sent = true; call.answer(this.localStream); }
    else call.answer();
    this._track(call);
  }

  _track(call) {
    this.calls.push(call);
    call.on('stream', (stream) => {
      if (!stream.getAudioTracks().length) return;
      this.audioEl.srcObject = stream;
      const p = this.audioEl.play();
      if (p && p.catch) p.catch(() => { this.needsTap = true; this.onState(this.state); });
    });
    call.on('error', (e) => console.warn('voice call error', e));
  }

  // Safari kan kräva ett tryck innan ljud spelas upp
  resumePlayback() {
    this.needsTap = false;
    const p = this.audioEl.play();
    if (p && p.catch) p.catch(() => {});
    this.onState(this.state);
  }

  destroy() {
    try { this.net.peer && this.net.peer.off('call', this._onCall); } catch (_) {}
    this.calls.forEach((c) => { try { c.close(); } catch (_) {} });
    if (this.localStream) this.localStream.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.destroyed = true;
    try { this.audioEl.srcObject = null; } catch (_) {}
  }
}
