// Grades legs and slips once results are in.

import { goalsOf } from './context.mjs';

const VOID_STATUSES = new Set(['POSTPONED', 'CANCELLED', 'SUSPENDED', 'AWARDED']);

// m: football-data.org match. Returns 'won' | 'lost' | 'void' | 'pending'
export function gradeLeg(leg, m) {
  if (!m?.status) return 'pending';
  if (VOID_STATUSES.has(m.status)) return 'void';
  if (m.status !== 'FINISHED') return 'pending';
  const g = goalsOf(m); // 90 minutes, as bookmakers settle
  if (!g) return 'pending';
  const h = g.h, a = g.a;
  const ht = m.score?.halfTime;
  const s = leg.settle;
  const ou = (val) => ((s.side === 'over' ? val > s.line : val < s.line) ? 'won' : 'lost');

  switch (s.kind) {
    case '1x2': return (s.side === 'home' ? h > a : a > h) ? 'won' : 'lost';
    case 'dc':
      if (s.side === 'hd') return h >= a ? 'won' : 'lost';
      if (s.side === 'da') return a >= h ? 'won' : 'lost';
      return h !== a ? 'won' : 'lost';
    case 'dnb':
      if (h === a) return 'void';
      return (s.side === 'home' ? h > a : a > h) ? 'won' : 'lost';
    case 'ou': return ou(h + a);
    case 'fh_ou': return ht?.home == null ? 'pending' : ou(ht.home + ht.away);
    case 'home_ou': return ou(h);
    case 'away_ou': return ou(a);
    case 'btts': return ((h > 0 && a > 0) === (s.side === 'yes')) ? 'won' : 'lost';
    default: return 'pending';
  }
}

export function gradeSlip(slip) {
  const r = slip.legs.map((l) => l.result || 'pending');
  if (r.includes('lost')) return { result: 'lost', paidOdds: 0 };
  if (r.includes('pending')) return { result: 'pending', paidOdds: null };
  const paid = slip.legs.reduce((o, l) => o * (l.result === 'void' ? 1 : l.odd), 1);
  if (r.every((x) => x === 'void')) return { result: 'void', paidOdds: 1 };
  return { result: 'won', paidOdds: +paid.toFixed(2) };
}

export function recordStats(history) {
  const settled = history.filter((d) => d.slips?.[0] && ['won', 'lost'].includes(d.slips[0].result));
  const won = settled.filter((d) => d.slips[0].result === 'won');
  const profit = settled.reduce((s, d) => s + (d.slips[0].result === 'won' ? d.slips[0].paidOdds - 1 : -1), 0);
  const expected = settled.reduce((s, d) => s + d.slips[0].prob, 0);
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i].slips?.[0]?.result;
    if (r === 'pending' || r === 'void' || !r) continue;
    if (streak === 0) streak = r === 'won' ? 1 : -1;
    else if ((streak > 0) === (r === 'won')) streak += streak > 0 ? 1 : -1;
    else break;
  }
  return {
    settled: settled.length,
    won: won.length,
    hitRate: settled.length ? won.length / settled.length : null,
    expectedWins: +expected.toFixed(2),
    profitUnits: +profit.toFixed(2),
    roi: settled.length ? profit / settled.length : null,
    streak,
  };
}
