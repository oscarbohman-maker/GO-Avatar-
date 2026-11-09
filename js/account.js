// Konto (Supabase): inloggning med e-postlänk, profil med XP, level, mynt och skins.
// XP och mynt delas bara ut av databasen (supabase/schema.sql), som också kontrollerar köp.
//
// Utvecklarläge: på localhost med ?devAccount=1 används ett låtsaskonto i webbläsaren
// (samma regler, ingen server) så att menyerna går att testa utan Supabase.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { calcReward, levelInfo, rankOf, RANKS } from './progress.js';
import { SKINS, skinById, DEFAULT_SKIN } from './skins.js';
import { MAPS } from './levels.js';

const ERRORS = {
  not_signed_in: 'You are not logged in.',
  level_too_low: 'Your level is too low for this skin.',
  not_enough_coins: 'Not enough coins.',
  not_owned: 'You do not own this skin yet.',
  unknown_skin: 'That skin does not exist.',
  unknown_map: 'This map does not give XP.',
  invalid_score: 'The result could not be verified.',
  invalid_stars: 'The result could not be verified.',
  too_soon: 'Too many results in a short time. Try again in a moment.',
  invalid_name: 'The name must be 1–16 characters.',
};
function friendly(err) {
  const msg = (err && (err.message || err.error_description || err.msg)) || String(err || 'Unknown error');
  const key = Object.keys(ERRORS).find((k) => msg.includes(k));
  if (key) return ERRORS[key];
  if (/fetch|network|Failed to fetch/i.test(msg)) return 'No connection to the account server.';
  if (/rate limit|security purposes|seconds/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  return msg;
}

let libPromise = null;
function loadLib() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/lib/supabase.min.js';
      s.onload = () => (window.supabase ? resolve(window.supabase) : reject(new Error('Supabase did not load')));
      s.onerror = () => { libPromise = null; reject(new Error('Could not load the account library')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

// ---------------------------------------------------------------- låtsaskonto (bara lokalt)
const DEV_KEY = 'plaindodge-dev-account';
function devEnabled() {
  try {
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (!local) return false;
    const q = new URLSearchParams(location.search).get('devAccount');
    if (q === '1') localStorage.setItem(DEV_KEY + '-on', '1');
    if (q === '0') localStorage.removeItem(DEV_KEY + '-on');
    return localStorage.getItem(DEV_KEY + '-on') === '1';
  } catch (_) { return false; }
}
class DevBackend {
  constructor() { this.data = null; try { this.data = JSON.parse(localStorage.getItem(DEV_KEY) || 'null'); } catch (_) {} }
  _save() { try { localStorage.setItem(DEV_KEY, JSON.stringify(this.data)); } catch (_) {} }
  _json() {
    const d = this.data;
    return { ...d, level: levelInfo(d.xp).level, clears: Object.entries(d.clears).map(([map_id, c]) => ({ map_id, ...c })) };
  }
  _free() {
    const lvl = levelInfo(this.data.xp).level, got = [];
    SKINS.filter((s) => s.price === 0 && s.level <= lvl && !this.data.owned_skins.includes(s.id)).forEach((s) => { this.data.owned_skins.push(s.id); got.push(s.id); });
    return got;
  }
  async session() { return this.data ? { email: this.data.email } : null; }
  async signIn(email) {
    this.data = this.data || { email, display_name: email.split('@')[0].slice(0, 16) || 'Pilot', xp: 0, coins: 0, equipped_skin: DEFAULT_SKIN, owned_skins: [DEFAULT_SKIN], clears: {} };
    this._save();
    return { instant: true };
  }
  async signOut() { this.data = null; try { localStorage.removeItem(DEV_KEY); } catch (_) {} }
  async rpc(fn, args) {
    if (!this.data) throw new Error('not_signed_in');
    const d = this.data;
    if (fn === 'get_profile') { if (args.p_name && d.display_name === 'Pilot') d.display_name = args.p_name; this._free(); this._save(); return this._json(); }
    if (fn === 'set_display_name') { const n = String(args.p_name || '').trim().slice(0, 16); if (!n) throw new Error('invalid_name'); d.display_name = n; this._save(); return this._json(); }
    if (fn === 'buy_skin') {
      const s = SKINS.find((x) => x.id === args.p_skin); if (!s) throw new Error('unknown_skin');
      if (d.owned_skins.includes(s.id)) return this._json();
      if (levelInfo(d.xp).level < s.level) throw new Error('level_too_low');
      if (d.coins < s.price) throw new Error('not_enough_coins');
      d.coins -= s.price; d.owned_skins.push(s.id); this._save(); return this._json();
    }
    if (fn === 'equip_skin') { if (!d.owned_skins.includes(args.p_skin)) throw new Error('not_owned'); d.equipped_skin = args.p_skin; this._save(); return this._json(); }
    if (fn === 'award_flight') {
      const m = MAPS.find((x) => x.id === args.p_map); if (!m) throw new Error('unknown_map');
      const c = d.clears[args.p_map] || { runs: 0, best_score: 0, best_rank: null };
      const r = calcReward({ tier: m.tier, score: args.p_score, maxScore: args.p_max, stars: args.p_stars, prevRuns: c.runs, prevBest: c.best_rank, coop: args.p_coop });
      const before = levelInfo(d.xp).level;
      d.xp += r.xp; d.coins += r.coins;
      d.clears[args.p_map] = { runs: c.runs + 1, best_score: Math.max(c.best_score, args.p_score), best_rank: RANKS.indexOf(r.rank) > RANKS.indexOf(c.best_rank || 'D') ? r.rank : c.best_rank };
      const fresh = this._free();
      this._save();
      const parts = Object.fromEntries(['run', 'first', 'rank', 'coop'].map((k) => [k, (r.parts.find((p) => p.key === k) || { xp: 0 }).xp]));
      return { rank: r.rank, xp: r.xp, coins: r.coins, repeat_pct: r.repeatPct, parts, level_before: before, level_after: levelInfo(d.xp).level, new_skins: fresh, profile: this._json() };
    }
    throw new Error('unknown function ' + fn);
  }
}

// ---------------------------------------------------------------- kontot
export const Account = {
  configured: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
  dev: false,
  client: null,
  backend: null,
  user: null,          // { email }
  profile: null,       // { display_name, xp, coins, level, equipped_skin, owned_skins, clears }
  status: 'idle',      // idle | loading | signed-out | signed-in | error
  error: '',
  _subs: new Set(),

  get available() { return this.configured || this.dev; },
  get signedIn() { return !!(this.user && this.profile); },
  get level() { return this.profile ? levelInfo(this.profile.xp) : null; },
  skin() { return this.profile ? this.profile.equipped_skin : DEFAULT_SKIN; },
  owns(id) { return !!(this.profile && this.profile.owned_skins.includes(id)); },
  clearsCount() { return this.profile ? this.profile.clears.length : 0; },

  on(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  _emit() { this._subs.forEach((fn) => { try { fn(this); } catch (e) { console.error(e); } }); },
  _set(patch) { Object.assign(this, patch); this._emit(); },

  async init(nameHint) {
    this.dev = devEnabled();
    this._nameHint = nameHint;
    if (!this.available) { this._set({ status: 'signed-out' }); return; }
    this._set({ status: 'loading' });
    try {
      if (this.dev) {
        this.backend = new DevBackend();
        const s = await this.backend.session();
        if (s) { this.user = s; await this.refresh(); } else this._set({ status: 'signed-out' });
        return;
      }
      const lib = await loadLib();
      this.client = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
      });
      this.client.auth.onAuthStateChange((event, session) => {
        const u = session && session.user ? { email: session.user.email, id: session.user.id } : null;
        if (u && (!this.user || this.user.id !== u.id)) { this.user = u; this.refresh(); }
        if (!u && this.user) this._set({ user: null, profile: null, status: 'signed-out' });
      });
      const { data } = await this.client.auth.getSession();
      const u = data && data.session && data.session.user;
      if (u) { this.user = { email: u.email, id: u.id }; await this.refresh(); } else this._set({ status: 'signed-out' });
      // ta bort inloggningsdelen ur adressen efter e-postlänken
      if (/access_token=|error_description=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      this._set({ status: 'error', error: friendly(e) });
    }
  },

  async _rpc(fn, args = {}) {
    if (this.dev) return this.backend.rpc(fn, args);
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw error;
    return data;
  },

  async refresh() {
    try {
      const p = await this._rpc('get_profile', { p_name: this._nameHint || null });
      this._set({ profile: p, status: 'signed-in', error: '' });
    } catch (e) {
      this._set({ status: 'error', error: friendly(e) });
    }
  },

  // Skickar en inloggningslänk. Returnerar { sent: true } eller kastar ett vänligt fel.
  async signIn(email) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    if (!this.available) throw new Error('Accounts are not set up yet.');
    if (this.dev) {
      await this.backend.signIn(email);
      this.user = { email };
      await this.refresh();
      return { sent: false, instant: true };
    }
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw new Error(friendly(error));
    return { sent: true };
  },

  async signOut() {
    if (this.dev) await this.backend.signOut();
    else if (this.client) await this.client.auth.signOut();
    this._set({ user: null, profile: null, status: 'signed-out' });
  },

  async setName(name) { this._set({ profile: await this._call('set_display_name', { p_name: name }) }); },
  async buy(id) { this._set({ profile: await this._call('buy_skin', { p_skin: id }) }); },
  async equip(id) { this._set({ profile: await this._call('equip_skin', { p_skin: id }) }); },

  // Belöning efter en klarad bana (servern räknar ut och sparar XP och mynt)
  async award({ map, score, stars, coop, maxScore }) {
    const r = await this._call('award_flight', { p_map: map, p_score: Math.max(0, Math.round(score)), p_stars: stars | 0, p_coop: !!coop, ...(this.dev ? { p_max: maxScore } : {}) });
    if (r && r.profile) this._set({ profile: r.profile });
    return r;
  },

  async _call(fn, args) {
    try { return await this._rpc(fn, args); } catch (e) { throw new Error(friendly(e)); }
  },
};

export { friendly, rankOf, skinById };
