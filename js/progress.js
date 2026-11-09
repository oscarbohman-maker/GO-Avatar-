// Level, XP och mynt. Samma regler finns i databasen (supabase/schema.sql), som är den som
// faktiskt delar ut XP och mynt; den här filen används för att visa förhandsbesked och i testerna.
import { POINTS, comboMult } from './sim.js';

export const MAX_LEVEL = 50;

// XP som behövs för att gå från level L till L+1: 100, 140, 180, … (+40 per level)
export function xpToNext(L) {
  return L >= MAX_LEVEL ? Infinity : 100 + 40 * (L - 1);
}

// Total XP som krävs för att nå level L (level 1 = 0 XP)
export function xpForLevel(L) {
  L = Math.max(1, Math.min(MAX_LEVEL, Math.floor(L)));
  return 100 * (L - 1) + 20 * (L - 1) * (L - 2);
}

// Level, XP in på nuvarande level, XP kvar och andel (0–1)
export function levelInfo(xp) {
  xp = Math.max(0, Math.floor(xp || 0));
  let L = 1;
  while (L < MAX_LEVEL && xpForLevel(L + 1) <= xp) L++;
  const into = xp - xpForLevel(L);
  const need = xpToNext(L);
  return { level: L, into, need, left: L >= MAX_LEVEL ? 0 : need - into, progress: L >= MAX_LEVEL ? 1 : into / need, max: L >= MAX_LEVEL };
}

// Högsta "rimliga" poäng på en bana (alla ringar perfekt med full combo, alla stjärnor, halva tidsbonusen).
// Betyget räknas mot den här siffran.
export function maxScoreOf(level) {
  let gateMax = 0;
  for (let c = 1; c <= level.gates.length; c++) gateMax += Math.round(POINTS.perfect * comboMult(c));
  return Math.round(gateMax + (level.stars ? level.stars.length : 0) * POINTS.star + (level.par || 60) * POINTS.timeBonusPerSec * 0.5);
}

export const RANKS = ['D', 'C', 'B', 'A', 'S'];
export function rankOf(score, maxScore) {
  // heltal (score·100 mot max·procent), samma som i databasen
  const s = score * 100, m = Math.max(1, maxScore);
  return s >= m * 85 ? 'S' : s >= m * 70 ? 'A' : s >= m * 55 ? 'B' : s >= m * 40 ? 'C' : 'D';
}

// Belöningar
export const TIER_XP = [0, 60, 90, 130, 180, 250];          // klarad bana, efter svårighet (1–5 pluppar)
export const RANK_XP = { D: 0, C: 0, B: 20, A: 50, S: 100 };  // engångsbonus när man når ett nytt, bättre betyg
// Procent (heltal, så att spelet och databasen avrundar exakt likadant)
export const REPEAT = [100, 60, 40, 30, 25];                // omspel ger mindre: 1:a, 2:a, 3:e, 4:e, 5:e+ gången
export const FIRST_CLEAR = 150;                             // första gången: +150 % av grundbelöningen
export const COOP_BONUS = 10;                               // co-op: +10 %
export const COIN_RATE = 50;                                // mynt = halva XP:n
const pct = (v, p) => Math.round((v * p) / 100);

// prevRuns = antal gånger man redan klarat banan, prevBest = bästa betyg hittills (eller null)
export function calcReward({ tier, score, maxScore, stars, prevRuns = 0, prevBest = null, coop = false }) {
  const rank = rankOf(score, maxScore);
  const base = TIER_XP[Math.max(1, Math.min(5, tier | 0))];
  const perf = Math.round(Math.min(score, maxScore) / 50);
  const starXp = (stars | 0) * 5;
  const mult = REPEAT[Math.min(prevRuns, REPEAT.length - 1)];
  const run = pct(base + perf + starXp, mult);
  const first = prevRuns === 0 ? pct(base, FIRST_CLEAR) : 0;
  const better = RANKS.indexOf(rank) > RANKS.indexOf(prevBest || 'D');
  const rankXp = better ? RANK_XP[rank] - RANK_XP[prevBest || 'D'] : 0;
  const subtotal = run + first + rankXp;
  const coopXp = coop ? pct(subtotal, COOP_BONUS) : 0;
  const xp = subtotal + coopXp;
  return {
    rank, xp, coins: pct(xp, COIN_RATE), repeatPct: mult,
    parts: [
      { key: 'run', label: prevRuns ? `Map cleared (${mult}% replay)` : 'Map cleared', xp: run },
      { key: 'first', label: 'First clear', xp: first },
      { key: 'rank', label: `New rank ${rank}`, xp: rankXp },
      { key: 'coop', label: 'Co-op bonus', xp: coopXp },
    ].filter((p) => p.xp > 0),
  };
}
