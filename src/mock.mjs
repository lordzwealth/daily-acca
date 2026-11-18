// Synthetic API-Football responses for offline testing (MOCK=1). Not real data.
import { marketProbs } from './model.mjs';

function rng(seed) {
  let a = 0;
  for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) | 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pois = (r, l) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };

const LEAGUES = { 39: 'Mock Premier', 140: 'Mock Liga' };
const REFS = ['A. Taylor', 'M. Oliver', 'J. Gil', 'C. Kavanagh', 'S. Hooper', 'P. Bankes'];

function buildLeague(lid) {
  const r = rng(`league${lid}`);
  const teams = Array.from({ length: 20 }, (_, i) => ({
    id: lid * 100 + i, name: `${LEAGUES[lid].split(' ')[1]} ${String.fromCharCode(65 + i)}FC`,
    att: 0.6 + r() * 0.9, def: 0.6 + r() * 0.9,
  }));
  const rows = Object.fromEntries(teams.map((t) => [t.id, {
    team: { id: t.id, name: t.name }, points: 0, form: '',
    all: { played: 0, goals: { for: 0, against: 0 } }, home: { played: 0, goals: { for: 0, against: 0 } }, away: { played: 0, goals: { for: 0, against: 0 } },
  }]));
  for (let round = 0; round < 12; round++) {
    const order = [...teams].sort(() => r() - 0.5);
    for (let i = 0; i < 20; i += 2) {
      const h = order[i], a = order[i + 1];
      const gh = pois(r, 1.5 * h.att * a.def), ga = pois(r, 1.15 * a.att * h.def);
      const upd = (row, venue, f, ag) => {
        for (const k of ['all', venue]) { row[k].played++; row[k].goals.for += f; row[k].goals.against += ag; }
        const res = f > ag ? 'W' : f === ag ? 'D' : 'L';
        row.points += res === 'W' ? 3 : res === 'D' ? 1 : 0;
        row.form = (row.form + res).slice(-5);
      };
      upd(rows[h.id], 'home', gh, ga);
      upd(rows[a.id], 'away', ga, gh);
    }
  }
  const table = Object.values(rows).sort((x, y) => y.points - x.points || (y.all.goals.for - y.all.goals.against) - (x.all.goals.for - x.all.goals.against));
  table.forEach((t, i) => {
    t.rank = i + 1;
    t.description = i < 4 ? 'Promotion - Champions League' : i >= 17 ? 'Relegation' : null;
  });
  return { teams, table };
}

export function createMockApi(today, yesterday) {
  const leagues = Object.fromEntries(Object.keys(LEAGUES).map((l) => [l, buildLeague(+l)]));
  let used = 0;

  const dayFixtures = (date) => {
    const out = [];
    for (const lid of Object.keys(LEAGUES)) {
      const r = rng(`${date}-${lid}`);
      const { teams } = leagues[lid];
      const order = [...teams].sort(() => r() - 0.5);
      for (let i = 0; i < 20; i += 2) {
        const h = order[i], a = order[i + 1];
        const id = Number(`${date.replace(/-/g, '').slice(2)}${lid}${i}`);
        const ts = Date.parse(`${date}T20:00:00Z`) / 1000 + i * 300;
        const lh = 1.5 * h.att * a.def, la = 1.15 * a.att * h.def;
        const gh = pois(r, lh), ga = pois(r, la);
        out.push({
          fixture: { id, referee: REFS[Math.floor(r() * REFS.length)] + ', England', date: new Date(ts * 1000).toISOString(), timestamp: ts, status: { short: 'NS' } },
          league: { id: +lid, name: LEAGUES[lid], season: 2026 },
          teams: { home: { id: h.id, name: h.name }, away: { id: a.id, name: a.name } },
          _true: { lh, la, gh, ga, ghHt: Math.min(gh, pois(r, lh * 0.45)), gaHt: Math.min(ga, pois(r, la * 0.45)), corners: pois(r, 9.8) },
        });
      }
    }
    // one fixture outside covered leagues (should be ignored)
    out.push({ fixture: { id: 1, referee: null, date: `${date}T19:00:00Z`, timestamp: Date.parse(`${date}T19:00:00Z`) / 1000, status: { short: 'NS' } }, league: { id: 9999, name: 'Other', season: 2026 }, teams: { home: { id: 1, name: 'X' }, away: { id: 2, name: 'Y' } }, _true: { gh: 0, ga: 0 } });
    return out;
  };
  const finished = (f) => ({
    ...f,
    fixture: { ...f.fixture, status: { short: 'FT' } },
    goals: { home: f._true.gh, away: f._true.ga },
    score: { fulltime: { home: f._true.gh, away: f._true.ga }, halftime: { home: f._true.ghHt, away: f._true.gaHt } },
  });
  const all = () => [...dayFixtures(yesterday), ...dayFixtures(today)];

  function oddsFor(f) {
    const r = rng(`odds${f.fixture.id}`);
    const noise = () => 1 + (r() - 0.5) * 0.08;
    const P = marketProbs(f._true.lh * noise(), f._true.la * noise(), { home: 5.2, away: 4.6 });
    const o = (p) => ({ odd: Math.max(1.01, 1 / (p * 1.055)).toFixed(2) });
    const v = (value, p) => ({ value, ...o(p) });
    const bets = [
      { name: 'Match Winner', values: [v('Home', P.home), v('Draw', P.draw), v('Away', P.away)] },
      { name: 'Double Chance', values: [v('Home/Draw', P.home + P.draw), v('Home/Away', P.home + P.away), v('Draw/Away', P.draw + P.away)] },
      { name: 'Home/Away', values: [v('Home', P.home / (1 - P.draw)), v('Away', P.away / (1 - P.draw))] },
      { name: 'Goals Over/Under', values: [0.5, 1.5, 2.5, 3.5, 4.5].flatMap((l) => [v(`Over ${l}`, P.over[l]), v(`Under ${l}`, 1 - P.over[l])]) },
      { name: 'Goals Over/Under First Half', values: [0.5, 1.5].flatMap((l) => [v(`Over ${l}`, P.fhOver[l]), v(`Under ${l}`, 1 - P.fhOver[l])]) },
      { name: 'Both Teams Score', values: [v('Yes', P.bttsYes), v('No', P.bttsNo)] },
      { name: 'Total - Home', values: [0.5, 1.5].flatMap((l) => [v(`Over ${l}`, P.homeOver[l]), v(`Under ${l}`, 1 - P.homeOver[l])]) },
      { name: 'Total - Away', values: [0.5, 1.5].flatMap((l) => [v(`Over ${l}`, P.awayOver[l]), v(`Under ${l}`, 1 - P.awayOver[l])]) },
      { name: 'Corners Over Under', values: [7.5, 8.5, 9.5].flatMap((l) => [v(`Over ${l}`, P.cornersOver[l]), v(`Under ${l}`, 1 - P.cornersOver[l])]) },
    ];
    return { league: f.league, fixture: { id: f.fixture.id }, bookmakers: [{ id: 8, name: 'Bet365', bets }] };
  }

  const ok = (response) => ({ response, paging: { current: 1, total: 1 }, errors: [] });

  return {
    used: () => used,
    budgetLeft: () => 90 - used,
    async get(path, p = {}) {
      used++;
      if (used > 90) throw new Error('Request budget reached');
      if (path === 'fixtures' && p.date) {
        return ok(p.date === yesterday ? dayFixtures(yesterday).map(finished) : dayFixtures(p.date));
      }
      if (path === 'fixtures' && p.ids) {
        const ids = new Set(String(p.ids).split('-').map(Number));
        return ok(all().filter((f) => ids.has(f.fixture.id)).map((f) => (f.fixture.timestamp * 1000 < Date.now() + 864e5 * 2 ? finished(f) : f)));
      }
      if (path === 'fixtures' && p.team) return ok(Array.from({ length: p.last }, (_, i) => ({ fixture: { id: p.team * 10 + i } })));
      if (path === 'fixtures/statistics') {
        const r = rng(`st${p.fixture}`);
        return ok([{ team: { id: Math.floor(p.fixture / 10) }, statistics: [{ type: 'Corner Kicks', value: pois(r, 5) }] }, { team: { id: -1 }, statistics: [{ type: 'Corner Kicks', value: pois(r, 4.5) }] }]);
      }
      if (path === 'odds') return ok(dayFixtures(p.date).filter((f) => f.league.id === +p.league).map(oddsFor));
      if (path === 'standings') return ok([{ league: { standings: [leagues[p.league].table] } }]);
      if (path === 'predictions') {
        const f = all().find((x) => x.fixture.id === +p.fixture);
        const r = rng(`pred${p.fixture}`);
        const g = (x) => ({ average: (x * (0.8 + r() * 0.4)).toFixed(1) });
        return ok([{
          teams: {
            home: { last_5: { goals: { for: g(f._true.lh), against: g(f._true.la) } } },
            away: { last_5: { goals: { for: g(f._true.la), against: g(f._true.lh) } } },
          },
          h2h: Array.from({ length: 5 }, () => ({ goals: { home: pois(r, 1.4), away: pois(r, 1.1) } })),
        }]);
      }
      if (path === 'injuries') {
        const f = all().find((x) => x.fixture.id === +p.fixture);
        const r = rng(`inj${p.fixture}`);
        const n = Math.floor(r() * 4);
        return ok(Array.from({ length: n }, (_, i) => ({ player: { name: `Player ${i}`, type: 'Missing Fixture' }, team: { id: i % 2 ? f.teams.away.id : f.teams.home.id } })));
      }
      return ok([]);
    },
  };
}
