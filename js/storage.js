// Lokal profil (utan konto): namn, inställningar, historik och rekord.
// Sparas i webbläsaren. Kan senare synkas mot ett konto.

const KEY = 'blindflyg.profile.v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return { name: '', invertY: false, history: [], best: {}, ...p };
    }
  } catch (_) { /* privat läge eller blockerad lagring */ }
  return { name: '', invertY: false, history: [], best: {} };
}

let profile = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (_) {}
}

export const Store = {
  get profile() { return profile; },
  setName(n) { profile.name = String(n || '').slice(0, 16); save(); },
  setInvert(v) { profile.invertY = !!v; save(); },
  // Returnerar true om det är nytt rekord
  addResult(r) {
    const entry = { ...r, date: new Date().toISOString() };
    profile.history.unshift(entry);
    profile.history = profile.history.slice(0, 50);
    const key = r.level;
    const prev = profile.best[key];
    const isRecord = !prev || r.time < prev.time;
    if (isRecord) profile.best[key] = { time: r.time, crashes: r.crashes, partner: r.partner || null, role: r.role, date: entry.date };
    save();
    return isRecord;
  },
};
