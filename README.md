# Daily Acca

Every morning, a GitHub Action:

1. Settles the open slips and updates your running record.
2. Pulls today's fixtures from **football-data.org** (free) for the Premier League, Championship, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Brasileirão and the Champions League.
3. Builds each league's table (overall, home and away), recent form, head-to-head results this season and referee goal averages from this season's results.
4. Gets match-result and over/under prices from **The Odds API** (free), using the median across bookmakers.
5. Works out the goals the bookmakers expect, blends that with our own goals model, and prices every market: double chance, draw no bet, over/under, team goals, first-half goals and both teams to score.
6. Builds a **2–4 game slip at about 1.70–2.00 total odds**, picking the combination with the highest estimated chance, plus a backup slip from different games.
7. Sends the slip to **Telegram** and the **dashboard**.

If nothing passes the safety filters, it sends "no slip today".

## Keys (GitHub → Settings → Secrets and variables → Actions → Secrets)

| Secret | Where to get it |
|---|---|
| `FOOTBALL_DATA_KEY` | Register at football-data.org (free). The token is emailed to you. |
| `ODDS_API_KEY` | Sign up at the-odds-api.com and choose the free plan (500 credits a month). |
| `TELEGRAM_BOT_TOKEN` | Your bot from @BotFather |
| `TELEGRAM_CHAT_ID` | Your chat ID |

`API_FOOTBALL_KEY` is no longer used. You can delete it.

## Daily trigger
cron-job.org POSTs to `https://api.github.com/repos/<you>/daily-acca/actions/workflows/daily.yml/dispatches` at 06:05 Lagos time, with the body `{"ref":"main"}`. GitHub's own schedule is a backup and skips the run if today's slip already exists.

## About the odds
- **Match result and over/under 2.5** use real bookmaker prices.
- **Every other market** (double chance, draw no bet, over 1.5, team goals and so on) gets an **estimated price, marked ≈**. The free odds feed doesn't carry these markets, so the price is worked out from the real markets with a typical 6% bookmaker margin. Check your own bookmaker's price, and skip a leg if it's offered well below the ≈ price.
- Each league scanned costs 2 credits. A typical month uses about 200–350 of the 500 free credits. The bot warns you on Telegram when fewer than 60 are left.

## How the chance figure is worked out
- Each leg's chance = 60% the bookmakers' margin-free probability + 40% our model. It is **capped at 3 points above the bookmakers**.
- A leg is dropped if:
  - our model is clearly less confident than the bookmakers,
  - either team has played fewer than 5 games, or
  - it backs a team with nothing to play for against an opponent fighting for something.
- Each slip can include at most one draw-no-bet leg and at most three legs from one league.
- The dashboard compares predicted and actual hit rate. After 30 or more slips, that comparison tells you whether the numbers can be trusted.

## Limits
- There are **no injury or corner data**; the free sources don't provide them.
- **Tactics** are covered only indirectly, through goal patterns and home/away form.
- Coverage is 10 competitions, so midweek days often have no slip.
- At these odds, expect to lose some days. A good model wins roughly 55–65% of slips.

## Tuning (optional Variables)
- `MIN_TOTAL_ODDS` and `MAX_TOTAL_ODDS`: the slip's odds band.
- `MIN_LEG_PROB`: the minimum estimated chance for each game.
- `MIN_LEG_ODDS` and `MAX_LEG_ODDS`: the odds range for each game.
- `ASSUMED_MARGIN`: the margin used for ≈ prices (default 0.06).

## Files
`src/run.mjs` runs the daily pipeline. The other files in `src/`:
- `sources.mjs`: the API clients
- `teams.mjs`: matches team names between the two sources
- `context.mjs`: tables, form, referees, head-to-head
- `model.mjs`: goals model and the bookmakers' implied goals
- `markets.mjs`: prices each market
- `builder.mjs`: builds the slip
- `settle.mjs`: grades results
- `telegram.mjs`: sends the message
- `mock.mjs`: fake data for testing

The dashboard is `index.html`, and `data/` holds the outputs.
