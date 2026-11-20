// Scores legs and picks the 2–4 leg combination with the highest chance of landing
// whose total odds fall inside the target band.
import { CONFIG } from './config.mjs';

export function scoreLeg(leg) {
  const w = CONFIG.marketWeight;
  const blend = leg.model == null ? leg.fair : w * leg.fair + (1 - w) * leg.model;
  // Picking the legs our model likes most inflates its confidence (winner's curse),
  // so never claim more than 3 points above the bookmaker's fair price.
  const p = Math.min(blend, leg.fair + 0.03);
  return { ...leg, p, edge: p * leg.odd - 1, gap: leg.model == null ? 0 : leg.model - leg.fair };
}

export function filterLegs(legs) {
  return legs.filter(
    (l) =>
      l.model != null &&
      l.odd >= CONFIG.minLegOdds &&
      l.odd <= CONFIG.maxLegOdds &&
      l.p >= CONFIG.minLegProb &&
      // real prices must clear the edge bar; estimated prices can't, so require the model to agree with the market instead
      (l.estimated ? l.p >= l.fair - 0.01 : l.edge >= CONFIG.minEdge) &&
      l.gap > -CONFIG.maxModelMarketGap && // our model must not be much less confident than the bookie
      !l.blocked,
  );
}

// Keep only the best leg per fixture-market family to avoid near-duplicates, then rank
function dedupe(legs) {
  const best = new Map();
  for (const l of legs) {
    const k = `${l.fixtureId}`;
    const arr = best.get(k) || [];
    arr.push(l);
    best.set(k, arr);
  }
  const out = [];
  for (const arr of best.values()) {
    arr.sort((a, b) => b.p - a.p || b.edge - a.edge);
    out.push(...arr.slice(0, 3)); // up to 3 options per fixture; builder still uses max 1 per fixture
  }
  return out.sort((a, b) => b.p - a.p);
}

// meta: { [fixtureId]: { ts, comp } }
export function buildSlips(candidates, meta, howMany = 2) {
  const pool = dedupe(candidates).slice(0, 40);
  const combos = [];
  const n = pool.length;

  const rec = (start, chosen, odds, prob) => {
    if (chosen.length >= CONFIG.minLegs && odds >= CONFIG.minTotalOdds && odds <= CONFIG.maxTotalOdds) {
      combos.push({ legs: [...chosen], odds, prob });
    }
    if (chosen.length === CONFIG.maxLegs || odds > CONFIG.maxTotalOdds) return;
    for (let i = start; i < n; i++) {
      const l = pool[i];
      if (chosen.some((c) => c.fixtureId === l.fixtureId)) continue;
      // max one draw-no-bet per slip: refunds shrink the payout below the target odds
      if (l.settle.kind === 'dnb' && chosen.some((c) => c.settle.kind === 'dnb')) continue;
      const lg = meta[l.fixtureId]?.comp;
      if (chosen.filter((c) => meta[c.fixtureId]?.comp === lg).length >= CONFIG.maxLegsPerLeague) continue;
      chosen.push(l);
      rec(i + 1, chosen, odds * l.odd, prob * l.p);
      chosen.pop();
    }
  };
  rec(0, [], 1, 1);

  combos.sort((a, b) => b.prob - a.prob || b.prob * b.odds - a.prob * a.odds);

  const slips = [];
  const used = new Set();
  for (const c of combos) {
    if (c.legs.some((l) => used.has(l.fixtureId))) continue;
    slips.push({
      legs: c.legs.sort((a, b) => meta[a.fixtureId].ts - meta[b.fixtureId].ts),
      totalOdds: +c.odds.toFixed(2),
      prob: +c.prob.toFixed(3),
      ev: +(c.prob * c.odds - 1).toFixed(3),
    });
    c.legs.forEach((l) => used.add(l.fixtureId));
    if (slips.length >= howMany) break;
  }
  return slips;
}
