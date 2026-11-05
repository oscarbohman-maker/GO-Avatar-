// Lokal profil (utan konto): namn, inställningar, historik och rekord.
// Sparas i webbläsaren. Kan senare synkas mot ett konto.

const KEY = 'blindflyg.profile.v1';

export const DEFAULT_SETTINGS = {
  invertY: false,       // invertera upp/ner
  sensitivity: 1,       // styrkänslighet 0.5–1.5
  touchControls: 'auto', // 'auto' | 'on' | 'off'
  npcVoice: true,       // NPC-navigatörens röst
  sfx: true,            // ljudeffekter
};

function defaults() {
  return { name: '', history: [], best: {}, ...DEFAULT_SETTINGS };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return { ...defaults(), ...p };
    }
  } catch (_) { /* privat läge eller blockerad lagring */ }
  return defaults();
}

let profile = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (_) {}
}

export const Store = {
  get profile() { return profile; },
  setName(n) { profile.name = String(n || '').slice(0, 16); save(); },
  setInvert(v) { profile.invertY = !!v; save(); },
  // generell inställning (validerad mot standardvärdets typ)
  setSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    const def = DEFAULT_SETTINGS[key];
    if (typeof def === 'boolean') value = !!value;
    else if (typeof def === 'number') value = Math.max(0.5, Math.min(1.5, Number(value) || def));
    else if (key === 'touchControls' && !['auto', 'on', 'off'].includes(value)) value = def;
    profile[key] = value;
    save();
  },
  resetSettings() { Object.assign(profile, DEFAULT_SETTINGS); save(); },
  // Returnerar true om det är nytt rekord
  addResult(r) {
    const entry = { ...r, date: new Date().toISOString() };
    profile.history.unshift(entry);
    profile.history = profile.history.slice(0, 50);
    const key = r.level;
    const prev = profile.best[key];
    // rekord = högst poäng (äldre rekord utan poäng räknas som slagna)
    const isRecord = !prev || prev.score == null || (r.score || 0) > prev.score || ((r.score || 0) === prev.score && r.time < prev.time);
    if (isRecord) profile.best[key] = { score: r.score || 0, time: r.time, crashes: r.crashes, stars: r.stars || 0, partner: r.partner || null, role: r.role, date: entry.date };
    save();
    return isRecord;
  },
};
