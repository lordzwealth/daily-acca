// Turns bookmaker odds + model probabilities into candidate legs.

const parseOU = (v) => {
  const m = /^(Over|Under)\s+([\d.]+)$/i.exec(String(v).trim());
  if (!m) return null;
  const line = Number(m[2]);
  if (line % 1 !== 0.5) return null; // only .5 lines (no pushes, no Asian quarter lines)
  return { side: m[1].toLowerCase(), line };
};

// Remove bookmaker margin within a market
function fairMap(values) {
  const inv = values.map((v) => 1 / v.odd);
  const s = inv.reduce((a, b) => a + b, 0);
  return values.map((v, i) => ({ ...v, fair: inv[i] / s }));
}

export function extractBets(oddsEntry, bookmakerId) {
  const bms = oddsEntry?.bookmakers || [];
  const bm = bms.find((b) => b.id === bookmakerId) || bms[0];
  if (!bm) return null;
  const bets = {};
  for (const b of bm.bets) bets[b.name] = b.values.map((v) => ({ value: String(v.value), odd: Number(v.odd) })).filter((v) => v.odd > 1);
  return { bookmaker: bm.name, bets };
}

/**
 * Build candidate legs for one fixture.
 * fx: fixture object, B: extracted bets, P: model probs or null (null => market-only, used for shortlisting)
 */
export function buildLegs(fx, B, P) {
  const legs = [];
  const H = fx.teams.home.name, A = fx.teams.away.name;
  const add = (o) => legs.push({ fixtureId: fx.fixture.id, ...o, model: P ? o.model : null });

  // 1X2 fair probs (used for DC as well)
  const mw = B.bets['Match Winner'];
  let fair1x2 = null;
  if (mw && mw.length === 3) {
    const f = fairMap(mw);
    fair1x2 = Object.fromEntries(f.map((v) => [v.value, v.fair]));
    for (const v of f) {
      const side = v.value.toLowerCase();
      if (side === 'draw') continue;
      add({ label: `${side === 'home' ? H : A} to win`, settle: { kind: '1x2', side }, odd: v.odd, fair: v.fair, model: P?.[side] });
    }
  }

  const dc = B.bets['Double Chance'];
  if (dc) {
    const map = { 'Home/Draw': ['hd', `${H} or draw`], 'Draw/Away': ['da', `${A} or draw`], 'Home/Away': ['ha', `${H} or ${A} (no draw)`] };
    for (const v of dc) {
      const m = map[v.value];
      if (!m) continue;
      const [side, label] = m;
      const fair = fair1x2
        ? side === 'hd' ? fair1x2.Home + fair1x2.Draw : side === 'da' ? fair1x2.Away + fair1x2.Draw : fair1x2.Home + fair1x2.Away
        : 1 / v.odd / 1.05;
      const model = P ? (side === 'hd' ? P.home + P.draw : side === 'da' ? P.away + P.draw : P.home + P.away) : null;
      add({ label: `${label} (double chance)`, settle: { kind: 'dc', side }, odd: v.odd, fair, model });
    }
  }

  const dnb = B.bets['Home/Away'];
  if (dnb && dnb.length === 2) {
    for (const v of fairMap(dnb)) {
      const side = v.value.toLowerCase();
      if (side !== 'home' && side !== 'away') continue;
      // "success" for a DNB leg = win or refund (not losing)
      const notLoseFair = fair1x2 ? fair1x2[side === 'home' ? 'Home' : 'Away'] + fair1x2.Draw : v.fair;
      const model = P ? P[side] + P.draw : null;
      add({ label: `${side === 'home' ? H : A} draw no bet`, settle: { kind: 'dnb', side }, odd: v.odd, fair: notLoseFair, model, note: 'refund if draw' });
    }
  }

  const ouMarkets = [
    ['Goals Over/Under', 'ou', (s, l) => `${s === 'over' ? 'Over' : 'Under'} ${l} goals`, P?.over],
    ['Goals Over/Under First Half', 'fh_ou', (s, l) => `${s === 'over' ? 'Over' : 'Under'} ${l} first-half goals`, P?.fhOver],
    ['Total - Home', 'home_ou', (s, l) => `${H} ${s} ${l} goals`, P?.homeOver],
    ['Total - Away', 'away_ou', (s, l) => `${A} ${s} ${l} goals`, P?.awayOver],
    ['Corners Over Under', 'corners_ou', (s, l) => `${s === 'over' ? 'Over' : 'Under'} ${l} corners`, P?.cornersOver],
  ];
  for (const [name, kind, labelFn, probs] of ouMarkets) {
    const vals = B.bets[name];
    if (!vals) continue;
    const byLine = {};
    for (const v of vals) {
      const p = parseOU(v.value);
      if (!p) continue;
      (byLine[p.line] ||= {})[p.side] = v.odd;
    }
    for (const [lineStr, sides] of Object.entries(byLine)) {
      const line = Number(lineStr);
      const pair = ['over', 'under'].filter((s) => sides[s]).map((s) => ({ value: s, odd: sides[s] }));
      const fairs = pair.length === 2 ? fairMap(pair) : pair.map((v) => ({ ...v, fair: 1 / v.odd / 1.05 }));
      for (const v of fairs) {
        let model = null;
        if (P) {
          if (kind === 'corners_ou' && probs?.[line] === undefined) continue; // no corners model → skip
          const pOver = probs?.[line];
          if (pOver === undefined) continue;
          model = v.value === 'over' ? pOver : 1 - pOver;
        }
        add({ label: labelFn(v.value, line), settle: { kind, side: v.value, line }, odd: v.odd, fair: v.fair, model });
      }
    }
  }

  const btts = B.bets['Both Teams Score'];
  if (btts && btts.length === 2) {
    for (const v of fairMap(btts)) {
      const yes = v.value.toLowerCase() === 'yes';
      add({ label: `Both teams to score: ${yes ? 'Yes' : 'No'}`, settle: { kind: 'btts', side: yes ? 'yes' : 'no' }, odd: v.odd, fair: v.fair, model: P ? (yes ? P.bttsYes : P.bttsNo) : null });
    }
  }
  return legs;
}
