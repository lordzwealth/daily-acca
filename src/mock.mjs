// Synthetic football-data.org + The Odds API responses for offline testing (MOCK=1). Not real data.
import { marketProbs } from './model.mjs';

function rng(seed) {
  let a = 0;
  for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pois = (r, l) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };
const CITIES = ['Arlington', 'Brookfield', 'Carrow', 'Dunmore', 'Eastleigh', 'Fairview', 'Glenwood', 'Hartley', 'Ironbridge', 'Kingsbury', 'Lakeside', 'Marston', 'Northgate', 'Oakham', 'Pembury', 'Queensway', 'Redhill', 'Stanmore', 'Thornbury', 'Upton'];
const REFS = ['A. Taylor', 'M. Oliver', 'J. Gil', 'C. Kavanagh', 'S. Hooper', 'P. Bankes', 'R. Jones'];
const COMPS = { PL: 'Premier League', PD: 'Primera Division' };
const ODDS_KEY = { PL: 'soccer_epl', PD: 'soccer_spain_la_liga' };

export function createMocks(today) {
  const teams = {};
  for (const code of Object.keys(COMPS)) {
    const r = rng(`teams${code}`);
    teams[code] = CITIES.map((c, i) => ({ id: (code === 'PL' ? 1000 : 2000) + i, name: `${c} ${code === 'PL' ? 'FC' : 'CF'}`, shortName: c, att: 0.6 + r() * 0.9, def: 0.6 + r() * 0.9 }));
  }
  const seasonStart = Date.parse('2026-08-15T12:00:00Z');
  const cache = {};
  // one round per competition every 3 days from season start
  function roundFor(code, day) {
    const key = `${code}${day}`;
    if (cache[key]) return cache[key];
    const r = rng(key);
    const order = [...teams[code]].sort(() => r() - 0.5);
    const out = [];
    for (let i = 0; i < 20; i += 2) {
      const h = order[i], a = order[i + 1];
      const lh = 1.5 * h.att * a.def, la = 1.15 * a.att * h.def;
      const gh = pois(r, lh), ga = pois(r, la);
      out.push({
        id: Number(`${code === 'PL' ? 1 : 2}${day.replace(/-/g, '').slice(2)}${i}`),
        utcDate: `${day}T${String(17 + (i % 4)).padStart(2, '0')}:30:00Z`,
        competition: { code, name: COMPS[code] },
        homeTeam: h, awayTeam: a,
        referees: [{ name: REFS[Math.floor(r() * REFS.length)], type: 'REFEREE' }],
        _true: { lh, la, gh, ga, ht: { home: Math.min(gh, pois(r, lh * 0.45)), away: Math.min(ga, pois(r, la * 0.45)) } },
      });
    }
    return (cache[key] = out);
  }
  const matchDays = (code, upTo) => {
    const out = [];
    for (let t = seasonStart + (code === 'PD' ? 3 * 864e5 : 0); t <= Date.parse(`${upTo}T12:00:00Z`); t += 3 * 864e5) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  const finished = (m) => ({ ...m, status: 'FINISHED', score: { fullTime: { home: m._true.gh, away: m._true.ga }, halfTime: m._true.ht } });
  const scheduled = (m) => ({ ...m, status: 'TIMED', score: { fullTime: { home: null, away: null }, halfTime: { home: null, away: null } } });
  const isPast = (day) => day < today;
  const view = (m) => (isPast(m.utcDate.slice(0, 10)) ? finished(m) : scheduled(m));
  const allUpTo = (d) => Object.keys(COMPS).flatMap((c) => matchDays(c, d).flatMap((day) => roundFor(c, day)));

  let fdUsed = 0, oddsUsed = 0, credits = 480;
  const fd = {
    used: () => fdUsed,
    async get(path, p = {}) {
      fdUsed++;
      if (path === 'matches' && p.ids) {
        const ids = new Set(String(p.ids).split(',').map(Number));
        return { matches: allUpTo(today).filter((m) => ids.has(m.id)).map(view) };
      }
      if (path === 'matches') {
        return { matches: allUpTo(p.dateTo).filter((m) => m.utcDate.slice(0, 10) >= p.dateFrom && m.utcDate.slice(0, 10) <= p.dateTo).map(view) };
      }
      const cm = /^competitions\/(\w+)\/matches$/.exec(path);
      if (cm) return { matches: matchDays(cm[1], today).filter(isPast).flatMap((d) => roundFor(cm[1], d)).map(finished) };
      return {};
    },
  };
  const odds = {
    used: () => oddsUsed,
    remaining: () => credits,
    async get(path, p) {
      oddsUsed++; credits -= p.markets.split(',').length;
      const code = Object.keys(ODDS_KEY).find((c) => path.includes(ODDS_KEY[c]));
      return roundFor(code, today).filter((m) => m.utcDate >= p.commenceTimeFrom && m.utcDate <= p.commenceTimeTo).map((m) => {
        const r = rng(`odds${m.id}`);
        const n = () => 1 + (r() - 0.5) * 0.1;
        const P = marketProbs(m._true.lh * n(), m._true.la * n());
        const book = (k) => {
          const pr = (x) => +(1 / (x * (1.05 + r() * 0.03))).toFixed(2);
          return { key: k, markets: [
            { key: 'h2h', outcomes: [{ name: m.homeTeam.shortName, price: pr(P.home) }, { name: m.awayTeam.shortName, price: pr(P.away) }, { name: 'Draw', price: pr(P.draw) }] },
            { key: 'totals', outcomes: [{ name: 'Over', point: 2.5, price: pr(P.over[2.5]) }, { name: 'Under', point: 2.5, price: pr(1 - P.over[2.5]) }] },
          ] };
        };
        return { id: `ev${m.id}`, commence_time: m.utcDate, home_team: m.homeTeam.shortName, away_team: m.awayTeam.shortName, bookmakers: ['a', 'b', 'c', 'd'].map(book) };
      });
    },
  };
  return { fd, odds };
}
