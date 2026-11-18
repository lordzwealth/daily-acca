// Match context: table importance, referee tendency, injuries, corners averages.

const CUP_LEAGUES = new Set([2, 3, 848]);

export function flattenTable(standingsResp) {
  const groups = standingsResp?.[0]?.league?.standings || [];
  return groups.flat();
}

export function importance(table, row, leagueId) {
  if (!table?.length || !row) return { level: 'unknown', label: 'no table' };
  const n = table.length;
  const maxPlayed = Math.max(...table.map((t) => t.all.played));
  const total = CUP_LEAGUES.has(leagueId) ? 8 : Math.max(2 * (n - 1), maxPlayed);
  const remaining = Math.max(total - row.all.played, 0);
  const progress = total ? row.all.played / total : 0;
  const maxGain = remaining * 3;

  const sorted = [...table].sort((a, b) => a.rank - b.rank);
  const top = sorted[0];
  const gapTop = top.points - row.points;
  const relegRows = sorted.filter((t) => /relegation/i.test(t.description || ''));
  const firstReleg = relegRows.length ? relegRows[0] : null;
  const euroRows = sorted.filter((t) => /champions|europa|conference|promotion/i.test(t.description || ''));
  const lastEuro = euroRows.length ? euroRows[euroRows.length - 1] : null;

  const tags = [];
  if (row.rank <= 3 && gapTop <= Math.max(6, maxGain * 0.35)) tags.push('title race');
  const closeGap = 3 + remaining * 0.15; // points gap that still counts as "in a race"
  const settled = progress >= 0.3;          // early-season tables are too noisy for race labels
  if (firstReleg) {
    const inZone = row.rank >= firstReleg.rank;
    if (inZone && progress >= 0.2) tags.push('in relegation zone');
    else if (settled && row.rank > n / 2 && row.points - firstReleg.points <= closeGap) tags.push('relegation battle');
  }
  if (settled && lastEuro && !tags.includes('title race') && row.rank > 3) {
    if (Math.abs(row.points - lastEuro.points) <= closeGap && row.rank <= lastEuro.rank + 4) tags.push('fighting for Europe/promotion');
  }

  let level = 'medium';
  if (tags.length) level = 'high';
  else if (progress > 0.7) level = 'low';
  return { level, label: tags.length ? tags.join(', ') : progress > 0.7 ? 'little to play for' : 'mid-table', rank: row.rank, of: n, form: row.form };
}

export const refKey = (name) => (name ? String(name).split(',')[0].trim() : null);

export function refereeFactor(refStore, name) {
  const k = refKey(name);
  const r = k && refStore.refs?.[k];
  const g = refStore.totals;
  if (!r || r.games < 6 || !g?.games) return { factor: 1, info: null };
  const ratio = r.goals / r.games / (g.goals / g.games);
  const f = Math.min(1.08, Math.max(0.92, 1 + (ratio - 1) * (r.games / (r.games + 20))));
  return { factor: f, info: `avg ${(r.goals / r.games).toFixed(2)} goals in ${r.games} games` };
}

export function updateRefStore(refStore, finishedFixtures) {
  refStore.refs ||= {};
  refStore.totals ||= { games: 0, goals: 0 };
  refStore.seen ||= [];
  const seen = new Set(refStore.seen);
  for (const f of finishedFixtures) {
    const id = f.fixture.id;
    if (seen.has(id)) continue;
    const ft = f.score?.fulltime;
    if (ft?.home == null || ft?.away == null) continue;
    seen.add(id);
    const goals = ft.home + ft.away;
    refStore.totals.games++;
    refStore.totals.goals += goals;
    const k = refKey(f.fixture.referee);
    if (!k) continue;
    const r = (refStore.refs[k] ||= { games: 0, goals: 0, homeWins: 0 });
    r.games++;
    r.goals += goals;
    if (ft.home > ft.away) r.homeWins++;
  }
  refStore.seen = [...seen].slice(-5000);
  return refStore;
}

export function countInjuries(injResp, homeId, awayId) {
  const out = { home: 0, away: 0, names: { home: [], away: [] } };
  for (const i of injResp || []) {
    if (!/missing/i.test(i.player?.type || '')) continue;
    const side = i.team?.id === homeId ? 'home' : i.team?.id === awayId ? 'away' : null;
    if (!side) continue;
    out[side]++;
    out.names[side].push(i.player.name);
  }
  return out;
}

// statsByFixture: [{ fixtureId, homeId, awayId, stats: API /fixtures/statistics response }]
export function cornerAverages(teamId, statsList) {
  let f = 0, a = 0, n = 0;
  for (const s of statsList) {
    const mine = s.stats.find((x) => x.team.id === teamId);
    const theirs = s.stats.find((x) => x.team.id !== teamId);
    const cv = (t) => Number(t?.statistics?.find((x) => x.type === 'Corner Kicks')?.value ?? NaN);
    const cf = cv(mine), ca = cv(theirs);
    if (isFinite(cf) && isFinite(ca)) { f += cf; a += ca; n++; }
  }
  return n >= 3 ? { for: f / n, against: a / n, n } : null;
}
