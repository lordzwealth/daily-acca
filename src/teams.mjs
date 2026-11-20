// Matches football-data.org fixtures to The Odds API events (team names differ between sources).

const FILLER = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'us', 'sv', 'tsg', 'vfl', 'vfb', 'rc', 'rcd', 'cd', 'ud', 'sd', 'ca', 'club', 'de', 'la', 'the', 'calcio', 'bc', 'fk', 'sk', 'if', 'bk', 'ec', 'se', 'cr', 'ogc', 'stade', 'and', 'hove', 'futebol', 'clube']);
const ALIAS = {
  internazionale: 'inter', munchen: 'munich', münchen: 'munich', psg: 'paris', wolves: 'wolverhampton', spurs: 'tottenham',
  athletico: 'athletic', atletico: 'atletico', gladbach: 'monchengladbach', mönchengladbach: 'monchengladbach',
  sporting: 'sporting', lisboa: 'lisbon', portugal: 'lisbon', utd: 'united', 'nottm': 'nottingham', saint: 'st', sankt: 'st',
};

export function tokens(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map((t) => ALIAS[t] || t)
    .filter((t) => !FILLER.has(t) && !/^\d+$/.test(t));
}

function tokSim(a, b) {
  if (a === b) return 1;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 3 && l.startsWith(s)) return 0.8;
  let p = 0;
  while (p < s.length && s[p] === l[p]) p++;
  return p >= 4 ? 0.6 : 0;
}

export function nameSim(x, y) {
  const A = tokens(x), B = tokens(y);
  if (!A.length || !B.length) return 0;
  const best = (P, Q) => P.reduce((s, p) => s + Math.max(...Q.map((q) => tokSim(p, q))), 0);
  return (best(A, B) + best(B, A)) / (A.length + B.length);
}

const teamSim = (fdTeam, oddsName) => Math.max(nameSim(fdTeam.name, oddsName), nameSim(fdTeam.shortName, oddsName));

/** Returns Map(fdMatchId → oddsEvent) */
export function pairMatches(fdMatches, oddsEvents) {
  const pairs = [];
  for (const m of fdMatches) {
    const t = Date.parse(m.utcDate);
    for (const ev of oddsEvents) {
      if (Math.abs(Date.parse(ev.commence_time) - t) > 3 * 3600e3) continue;
      const h = teamSim(m.homeTeam, ev.home_team), a = teamSim(m.awayTeam, ev.away_team);
      if (h >= 0.6 && a >= 0.6) pairs.push({ m, ev, s: h + a });
    }
  }
  pairs.sort((a, b) => b.s - a.s);
  const out = new Map(), usedEv = new Set();
  for (const p of pairs) {
    if (out.has(p.m.id) || usedEv.has(p.ev.id)) continue;
    out.set(p.m.id, p.ev);
    usedEv.add(p.ev.id);
  }
  return out;
}
