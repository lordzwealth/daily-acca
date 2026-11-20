// All tunable settings live here. Most can be overridden with GitHub Action variables.
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));

export const CONFIG = {
  timezone: 'Africa/Lagos',

  // Slip shape
  minTotalOdds: num(process.env.MIN_TOTAL_ODDS, 1.70),
  maxTotalOdds: num(process.env.MAX_TOTAL_ODDS, 2.00),
  minLegs: 2,
  maxLegs: 4,

  // Leg filters
  minLegOdds: num(process.env.MIN_LEG_ODDS, 1.12),
  maxLegOdds: num(process.env.MAX_LEG_ODDS, 1.55),
  minLegProb: num(process.env.MIN_LEG_PROB, 0.78),
  minEdge: num(process.env.MIN_EDGE, -0.03),
  maxModelMarketGap: 0.10,
  minGamesPlayed: 5,
  maxLegsPerLeague: 3,

  // Blend: bookmaker prices are sharp, so they carry most of the weight
  marketWeight: 0.6,
  // Typical bookmaker margin, used to estimate prices for markets the free odds feed doesn't carry
  assumedMargin: num(process.env.ASSUMED_MARGIN, 0.06),

  // The Odds API free plan = 500 credits/month. Each league call costs 2 (h2h + totals, 1 region).
  oddsRegion: process.env.ODDS_REGION || 'eu',
  minOddsCreditsLeft: 4,

  // football-data.org free competitions → The Odds API sport key, relegation places
  competitions: {
    PL: { name: 'Premier League', odds: 'soccer_epl', releg: 3 },
    ELC: { name: 'Championship', odds: 'soccer_efl_champ', releg: 3 },
    PD: { name: 'La Liga', odds: 'soccer_spain_la_liga', releg: 3 },
    SA: { name: 'Serie A', odds: 'soccer_italy_serie_a', releg: 3 },
    BL1: { name: 'Bundesliga', odds: 'soccer_germany_bundesliga', releg: 3 },
    FL1: { name: 'Ligue 1', odds: 'soccer_france_ligue_one', releg: 3 },
    DED: { name: 'Eredivisie', odds: 'soccer_netherlands_eredivisie', releg: 3 },
    PPL: { name: 'Primeira Liga', odds: 'soccer_portugal_primeira_liga', releg: 3 },
    BSA: { name: 'Brasileirão', odds: 'soccer_brazil_campeonato', releg: 4 },
    CL: { name: 'Champions League', odds: 'soccer_uefa_champs_league', releg: 0, cup: true },
  },
};
