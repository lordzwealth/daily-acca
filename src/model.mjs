// Goals model: venue-specific Poisson ratings from the league table, blended with recent form,
// adjusted for injuries and referee tendency, with a Dixon-Coles low-score correction.

const MAXG = 10;
const RHO = -0.08;

function poissonPmf(l, k) {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

export function scoreGrid(lh, la) {
  const grid = [];
  let total = 0;
  for (let h = 0; h <= MAXG; h++) {
    grid[h] = [];
    for (let a = 0; a <= MAXG; a++) {
      let p = poissonPmf(lh, h) * poissonPmf(la, a);
      if (h === 0 && a === 0) p *= 1 - lh * la * RHO;
      else if (h === 0 && a === 1) p *= 1 + lh * RHO;
      else if (h === 1 && a === 0) p *= 1 + la * RHO;
      else if (h === 1 && a === 1) p *= 1 - RHO;
      grid[h][a] = p;
      total += p;
    }
  }
  for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) grid[h][a] /= total;
  return grid;
}

export function sumGrid(grid, fn) {
  let s = 0;
  for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) if (fn(h, a)) s += grid[h][a];
  return s;
}

// Negative binomial for corners (overdispersed counts)
export function nbCdf(mean, k, r = 12) {
  const p = r / (r + mean);
  let term = Math.pow(p, r);
  let s = term;
  for (let i = 1; i <= k; i++) {
    term *= ((i + r - 1) / i) * (1 - p);
    s += term;
  }
  return Math.min(1, s);
}

// ---------- Ratings from standings ----------
export function leagueAverages(table) {
  let hg = 0, hp = 0, ag = 0, ap = 0;
  for (const t of table) {
    hg += t.home.goals.for; hp += t.home.played;
    ag += t.away.goals.for; ap += t.away.played;
  }
  const home = hp ? hg / hp : 1.5;
  const away = ap ? ag / ap : 1.15;
  return { home, away, all: (home + away) / 2 };
}

function shrink(observed, games, prior, k) {
  return (observed * games + prior * k) / (games + k);
}

export function teamRatings(row, avg) {
  const all = row.all;
  const attAll = shrink(all.played ? all.goals.for / all.played / avg.all : 1, all.played, 1, 3);
  const defAll = shrink(all.played ? all.goals.against / all.played / avg.all : 1, all.played, 1, 3);
  const h = row.home, a = row.away;
  return {
    attHome: shrink(h.played ? h.goals.for / h.played / avg.home : attAll, h.played, attAll, 4),
    defHome: shrink(h.played ? h.goals.against / h.played / avg.away : defAll, h.played, defAll, 4),
    attAway: shrink(a.played ? a.goals.for / a.played / avg.away : attAll, a.played, attAll, 4),
    defAway: shrink(a.played ? a.goals.against / a.played / avg.home : defAll, a.played, defAll, 4),
  };
}

/**
 * Expected goals for a fixture.
 * ctx: { table, homeRow, awayRow, pred (API predictions object), injuries:{home,away}, refFactor }
 */
export function expectedGoals(ctx) {
  const notes = [];
  let lh, la;

  if (ctx.homeRow && ctx.awayRow && ctx.table) {
    const avg = leagueAverages(ctx.table);
    const H = teamRatings(ctx.homeRow, avg);
    const A = teamRatings(ctx.awayRow, avg);
    lh = avg.home * H.attHome * A.defAway;
    la = avg.away * A.attAway * H.defHome;

    // Recent form (last 5) from predictions endpoint
    const h5 = ctx.pred?.teams?.home?.last_5?.goals;
    const a5 = ctx.pred?.teams?.away?.last_5?.goals;
    if (h5 && a5) {
      const hf = +h5.for.average, ha = +h5.against.average, af = +a5.for.average, aa = +a5.against.average;
      if ([hf, ha, af, aa].every((x) => isFinite(x))) {
        const homeAdj = avg.home / avg.all, awayAdj = avg.away / avg.all;
        const rh = Math.sqrt(Math.max(hf, 0.2) * Math.max(aa, 0.2)) * homeAdj;
        const ra = Math.sqrt(Math.max(af, 0.2) * Math.max(ha, 0.2)) * awayAdj;
        lh = 0.75 * lh + 0.25 * rh;
        la = 0.75 * la + 0.25 * ra;
      }
    }
  } else if (ctx.pred?.teams?.home?.league?.goals) {
    // No table (e.g. cup) – fall back to season goal averages from predictions
    const H = ctx.pred.teams.home.league.goals, A = ctx.pred.teams.away.league.goals;
    const hf = +H.for.average.home, aa = +A.against.average.away, af = +A.for.average.away, ha = +H.against.average.home;
    if (![hf, aa, af, ha].every((x) => isFinite(x) && x > 0)) return null;
    lh = Math.sqrt(hf * aa);
    la = Math.sqrt(af * ha);
    notes.push('no league table – used season averages');
  } else {
    return null;
  }

  // Injuries: each confirmed absentee trims own attack, boosts opponent slightly (capped)
  const ih = ctx.injuries?.home || 0, ia = ctx.injuries?.away || 0;
  lh *= (1 - Math.min(0.08, 0.015 * ih)) * (1 + Math.min(0.06, 0.01 * ia));
  la *= (1 - Math.min(0.08, 0.015 * ia)) * (1 + Math.min(0.06, 0.01 * ih));

  // Referee tendency (builds up over time from settled games)
  if (ctx.refFactor && ctx.refFactor !== 1) {
    lh *= ctx.refFactor;
    la *= ctx.refFactor;
  }

  lh = Math.min(Math.max(lh, 0.15), 4.5);
  la = Math.min(Math.max(la, 0.15), 4.5);
  return { lh, la, notes };
}

// Probability of every supported market from the score grid
export function marketProbs(lh, la, corners) {
  const g = scoreGrid(lh, la);
  const g1 = scoreGrid(lh * 0.45, la * 0.45); // first half ≈ 45% of goals
  const P = {
    home: sumGrid(g, (h, a) => h > a),
    draw: sumGrid(g, (h, a) => h === a),
    away: sumGrid(g, (h, a) => h < a),
    bttsYes: sumGrid(g, (h, a) => h > 0 && a > 0),
    over: {}, homeOver: {}, awayOver: {}, fhOver: {}, cornersOver: {},
  };
  P.bttsNo = 1 - P.bttsYes;
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
    P.over[line] = sumGrid(g, (h, a) => h + a > line);
    P.homeOver[line] = sumGrid(g, (h) => h > line);
    P.awayOver[line] = sumGrid(g, (h, a) => a > line);
    P.fhOver[line] = sumGrid(g1, (h, a) => h + a > line);
  }
  if (corners) {
    const mean = corners.home + corners.away;
    for (let line = 5.5; line <= 13.5; line += 1) P.cornersOver[line] = 1 - nbCdf(mean, Math.floor(line));
  }
  return P;
}
