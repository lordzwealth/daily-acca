// All tunable settings live here. Most can be overridden with GitHub Action env vars.
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
  minLegProb: num(process.env.MIN_LEG_PROB, 0.78),   // our blended probability per leg
  minEdge: num(process.env.MIN_EDGE, -0.03),          // p*odds-1; small negative allowed (bookie margin)
  maxModelMarketGap: 0.10,                            // skip legs where our model and bookie disagree a lot
  minGamesPlayed: 5,
  maxLegsPerLeague: 2,

  // Probability blend: bookmaker prices are very sharp, so they carry the most weight
  marketWeight: 0.6,

  // API budget (free plan = 100/day, 10/min). Pro plan: set MAX_REQUESTS=1500, RATE_PER_MIN=250
  maxRequests: num(process.env.MAX_REQUESTS, 90),
  ratePerMinute: num(process.env.RATE_PER_MIN, 10),
  shortlistSize: num(process.env.SHORTLIST, 14),     // fixtures that get the deep dive
  cornersDepth: num(process.env.CORNERS_DEPTH, 0),   // last-N matches per team for corners (0 = off; needs paid plan)

  bookmakerId: num(process.env.BOOKMAKER_ID, 8),     // 8 = Bet365 in API-Football

  // Competitions scanned (API-Football league IDs)
  leagues: {
    39: 'Premier League', 40: 'Championship', 41: 'League One',
    140: 'La Liga', 141: 'La Liga 2', 135: 'Serie A', 136: 'Serie B',
    78: 'Bundesliga', 79: '2. Bundesliga', 61: 'Ligue 1', 62: 'Ligue 2',
    88: 'Eredivisie', 94: 'Primeira Liga', 144: 'Belgian Pro League',
    203: 'Süper Lig', 179: 'Scottish Premiership', 207: 'Swiss Super League',
    218: 'Austrian Bundesliga', 197: 'Greek Super League', 119: 'Danish Superliga',
    113: 'Allsvenskan', 103: 'Eliteserien', 2: 'Champions League',
    3: 'Europa League', 848: 'Conference League', 253: 'MLS', 262: 'Liga MX',
    71: 'Brasileirão', 128: 'Argentina Liga Profesional', 307: 'Saudi Pro League',
    98: 'J1 League', 292: 'K League 1', 188: 'A-League',
  },
};
