// Bookmaker odds → margin-free probabilities, and candidate legs for every market we cover.
import { CONFIG } from './config.mjs';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Summarise one Odds API event: median 1X2 prices and the main over/under line. */
export function summariseOdds(ev) {
  const h2h = { home: [], draw: [], away: [] };
  const totals = {};
  for (const bm of ev.bookmakers || []) {
    for (const mk of bm.markets || []) {
      if (mk.key === 'h2h') {
        for (const o of mk.outcomes) {
          const k = o.name === ev.home_team ? 'home' : o.name === ev.away_team ? 'away' : o.name === 'Draw' ? 'draw' : null;
          if (k) h2h[k].push(o.price);
        }
      } else if (mk.key === 'totals') {
        for (const o of mk.outcomes) {
          if (o.point == null || o.point % 1 !== 0.5) continue;
          const t = (totals[o.point] ||= { over: [], under: [] });
          if (/over/i.test(o.name)) t.over.push(o.price); else if (/under/i.test(o.name)) t.under.push(o.price);
        }
      }
    }
  }
  if (!h2h.home.length || !h2h.draw.length || !h2h.away.length) return null;
  const odds = { home: median(h2h.home), draw: median(h2h.draw), away: median(h2h.away) };
  const inv = { home: 1 / odds.home, draw: 1 / odds.draw, away: 1 / odds.away };
  const s = inv.home + inv.draw + inv.away;
  const fair = { home: inv.home / s, draw: inv.draw / s, away: inv.away / s };

  let ou = null;
  const lines = Object.entries(totals).filter(([, t]) => t.over.length && t.under.length);
  if (lines.length) {
    lines.sort((a, b) => (a[0] === '2.5' ? -1 : b[0] === '2.5' ? 1 : b[1].over.length - a[1].over.length));
    const [line, t] = lines[0];
    const o = median(t.over), u = median(t.under);
    ou = { line: Number(line), overOdds: o, underOdds: u, over: (1 / o) / (1 / o + 1 / u) };
  }
  return { odds, fair, ou, books: ev.bookmakers.length };
}

/**
 * Candidate legs for one match.
 *  F: market-implied probabilities (from the bookmakers' goal expectancy)
 *  M: our model's probabilities
 *  S: summariseOdds() result (real prices for 1X2 and the main goals line)
 */
export function buildLegs(match, F, M, S) {
  const legs = [];
  const H = match.homeTeam.shortName || match.homeTeam.name;
  const A = match.awayTeam.shortName || match.awayTeam.name;
  const est = (p) => +(1 / (p * (1 + CONFIG.assumedMargin))).toFixed(2);
  const add = (label, settle, fair, model, realOdd, note) =>
    legs.push({ fixtureId: match.id, label, settle, fair, model, odd: realOdd ?? est(fair), estimated: realOdd == null, ...(note ? { note } : {}) });

  // Match result (real prices)
  add(`${H} to win`, { kind: '1x2', side: 'home' }, S.fair.home, M.home, S.odds.home);
  add(`${A} to win`, { kind: '1x2', side: 'away' }, S.fair.away, M.away, S.odds.away);

  // Double chance / draw no bet (estimated prices, from the 1X2 market)
  add(`${H} or draw (double chance)`, { kind: 'dc', side: 'hd' }, S.fair.home + S.fair.draw, M.home + M.draw);
  add(`${A} or draw (double chance)`, { kind: 'dc', side: 'da' }, S.fair.away + S.fair.draw, M.away + M.draw);
  add(`${H} or ${A} (no draw)`, { kind: 'dc', side: 'ha' }, S.fair.home + S.fair.away, M.home + M.away);
  for (const side of ['home', 'away']) {
    const winGivenNoDraw = S.fair[side] / (1 - S.fair.draw);
    // "success" for draw-no-bet = win or refund
    legs.push({
      fixtureId: match.id, label: `${side === 'home' ? H : A} draw no bet`, settle: { kind: 'dnb', side },
      fair: S.fair[side] + S.fair.draw, model: M[side] + M.draw, odd: est(winGivenNoDraw), estimated: true, note: 'refund if draw',
    });
  }

  // Goals
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const real = S.ou && S.ou.line === line ? S.ou : null;
    const fOver = real ? real.over : F.over[line];
    add(`Over ${line} goals`, { kind: 'ou', side: 'over', line }, fOver, M.over[line], real?.overOdds);
    add(`Under ${line} goals`, { kind: 'ou', side: 'under', line }, 1 - fOver, 1 - M.over[line], real?.underOdds);
  }
  for (const line of [0.5, 1.5]) {
    add(`Over ${line} first-half goals`, { kind: 'fh_ou', side: 'over', line }, F.fhOver[line], M.fhOver[line]);
    add(`${H} over ${line} goals`, { kind: 'home_ou', side: 'over', line }, F.homeOver[line], M.homeOver[line]);
    add(`${A} over ${line} goals`, { kind: 'away_ou', side: 'over', line }, F.awayOver[line], M.awayOver[line]);
  }
  add('Both teams to score: Yes', { kind: 'btts', side: 'yes' }, F.bttsYes, M.bttsYes);
  add('Both teams to score: No', { kind: 'btts', side: 'no' }, F.bttsNo, M.bttsNo);
  return legs;
}
