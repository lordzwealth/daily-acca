// Season context built from finished matches: league table (overall/home/away), form,
// recent goals, referee tendencies, head-to-head, and how much each team has to play for.

export const goalsOf = (m) => {
  const s = m.score?.regularTime?.home != null ? m.score.regularTime : m.score?.fullTime;
  return s && s.home != null && s.away != null ? { h: s.home, a: s.away } : null;
};

const blank = () => ({ played: 0, goals: { for: 0, against: 0 } });

export function buildTable(finished) {
  const rows = {};
  const sorted = [...finished].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  for (const m of sorted) {
    const g = goalsOf(m);
    if (!g) continue;
    for (const [side, team, gf, ga, venue] of [['home', m.homeTeam, g.h, g.a, 'home'], ['away', m.awayTeam, g.a, g.h, 'away']]) {
      const r = (rows[team.id] ||= { team: { id: team.id, name: team.shortName || team.name }, points: 0, form: '', recent: [], all: blank(), home: blank(), away: blank() });
      for (const k of ['all', venue]) { r[k].played++; r[k].goals.for += gf; r[k].goals.against += ga; }
      const res = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
      r.points += res === 'W' ? 3 : res === 'D' ? 1 : 0;
      r.form = (r.form + res).slice(-5);
      r.recent = [...r.recent, { gf, ga }].slice(-5);
    }
  }
  const table = Object.values(rows).sort(
    (x, y) => y.points - x.points || (y.all.goals.for - y.all.goals.against) - (x.all.goals.for - x.all.goals.against) || y.all.goals.for - x.all.goals.for,
  );
  table.forEach((r, i) => {
    r.rank = i + 1;
    const n = r.recent.length || 1;
    r.last5 = { for: r.recent.reduce((s, x) => s + x.gf, 0) / n, against: r.recent.reduce((s, x) => s + x.ga, 0) / n, n: r.recent.length };
  });
  return table;
}

export function importance(table, row, comp) {
  if (!table?.length || !row || comp.cup) return { level: 'unknown', label: comp.cup ? 'cup' : 'no table' };
  const n = table.length;
  const total = 2 * (n - 1);
  const remaining = Math.max(total - row.all.played, 0);
  const progress = row.all.played / total;
  const closeGap = 3 + remaining * 0.15;
  const tags = [];
  if (row.rank <= 3 && table[0].points - row.points <= Math.max(6, remaining * 3 * 0.35)) tags.push('title race');
  if (comp.releg && progress >= 0.2) {
    const firstReleg = table[n - comp.releg];
    if (row.rank >= n - comp.releg + 1) tags.push('in relegation zone');
    else if (progress >= 0.3 && row.rank > n / 2 && row.points - firstReleg.points <= closeGap) tags.push('relegation battle');
  }
  const level = tags.length ? 'high' : progress > 0.7 ? 'low' : 'medium';
  return { level, label: tags.length ? tags.join(', ') : progress > 0.7 ? 'little to play for' : 'mid-table' };
}

export const refName = (m) => m.referees?.find((r) => r.type === 'REFEREE')?.name || null;

export function refereeStats(finished) {
  const refs = {};
  let games = 0, goals = 0;
  for (const m of finished) {
    const g = goalsOf(m);
    if (!g) continue;
    games++; goals += g.h + g.a;
    const k = refName(m);
    if (!k) continue;
    const r = (refs[k] ||= { games: 0, goals: 0 });
    r.games++; r.goals += g.h + g.a;
  }
  return { refs, totals: { games, goals } };
}

export function refereeFactor(stats, name) {
  const r = name && stats.refs[name];
  if (!r || r.games < 5 || !stats.totals.games) return { factor: 1, info: null };
  const ratio = r.goals / r.games / (stats.totals.goals / stats.totals.games);
  const f = Math.min(1.08, Math.max(0.92, 1 + (ratio - 1) * (r.games / (r.games + 15))));
  return { factor: f, info: `avg ${(r.goals / r.games).toFixed(1)} goals in ${r.games} games` };
}

export function headToHead(finished, homeId, awayId) {
  return finished
    .filter((m) => [m.homeTeam.id, m.awayTeam.id].includes(homeId) && [m.homeTeam.id, m.awayTeam.id].includes(awayId))
    .map(goalsOf)
    .filter(Boolean);
}
