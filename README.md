# Daily Acca

Every morning at **07:00 Lagos time**, a GitHub Action:

1. Settles yesterday's slip and updates your running record.
2. Pulls today's fixtures in ~33 leagues from API-Football.
3. Gets the bookmaker odds, league tables, recent form, injuries, head-to-head records and referee data.
4. Runs a goals model (Poisson ratings with home/away splits, recent form, injury and referee adjustments) and checks how much each team has to play for.
5. Builds a **2–4 game slip with total odds of 1.70–2.00**, picking the combination with the highest estimated chance. It also builds a backup slip from different games.
6. Sends the slip to your **Telegram** and saves it to `data/`. The **Vercel dashboard** shows it along with your full history.

If nothing passes the safety filters, it sends "no slip today" instead of forcing one.

---

## Setup (about 15 minutes, all in the browser)

### 1. API-Football key
- Sign up at **dashboard.api-football.com** (free, no card needed).
- Go to **Account → My Access** and copy your API key.

### 2. Telegram bot
- In Telegram, open **@BotFather** and send `/newbot`. Follow the prompts and copy the **token** it gives you.
- Open your new bot and send it any message, e.g. "hi".
- In a browser, visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and copy the number after `"chat":{"id":`. That's your **chat ID**.

### 3. GitHub secrets
In this repo, go to **Settings → Secrets and variables → Actions**.

**Secrets** tab → *New repository secret*:

| Name | Value |
|---|---|
| `API_FOOTBALL_KEY` | your API-Football key |
| `TELEGRAM_BOT_TOKEN` | your bot token |
| `TELEGRAM_CHAT_ID` | your chat ID |

### 4. First run
Go to **Actions → Daily Acca → Run workflow**. About 5–8 minutes later the slip arrives on Telegram, and the run commits `data/latest.json`.

### 5. Dashboard on Vercel
- In Vercel: **Add New → Project →** import this repo **→ Deploy**. No settings to change.
- Copy the site URL. Back in GitHub, under **Settings → Secrets and variables → Actions → Variables**, add `DASHBOARD_URL` = that URL. Telegram messages will then link to the dashboard.

---

## Data plan

The free API-Football plan allows **100 requests a day at 10 a minute**. A daily run uses about 35–90 of those.

- If the free plan won't serve the current season, the bot sends a ⚠️ Telegram message saying so.
- The **Pro plan ($19/month, 7,500 requests a day)** scans more games and switches on **corner markets**. To use it, add these GitHub *Variables*:

| Variable | Free | Pro |
|---|---|---|
| `MAX_REQUESTS` | 90 | 1500 |
| `RATE_PER_MIN` | 10 | 250 |
| `SHORTLIST` | 14 | 40 |
| `CORNERS_DEPTH` | 0 | 5 |

## Tuning (optional variables)
- `MIN_TOTAL_ODDS` and `MAX_TOTAL_ODDS`: the slip's odds band (default 1.70–2.00).
- `MIN_LEG_PROB`: the minimum estimated chance for each game (default 0.78).
- `MIN_LEG_ODDS` and `MAX_LEG_ODDS`: the odds range for each game (default 1.12–1.55).
- The list of leagues is in `src/config.mjs`.

## How the chance figure is worked out
- Each leg's chance = 60% the bookmaker's margin-free price + 40% our model. It is **capped at 3 points above the bookmaker**, because the legs the model likes most tend to be the ones where it's over-confident.
- A leg is dropped if:
  - our model is more than 10 points *less* confident than the bookmaker,
  - either team has played fewer than 5 league games, or
  - it backs a team with nothing to play for against an opponent fighting for something.
- Each slip can include at most one draw-no-bet leg and at most two legs from the same league.
- The slip's chance is the legs' chances multiplied together. The dashboard shows **predicted vs actual hit rate**. After 30 or more slips, that comparison tells you whether the numbers can be trusted.

## Limits
- **Referee data** builds up from games the bot settles. A referee needs about 6 logged games before they affect predictions.
- **Tactics** are covered only indirectly, through goal patterns, form and home/away splits. No free data source rates tactics.
- **Corners** need the Pro plan.
- Expect to lose some days. At these odds, a good model wins roughly 55–65% of slips.

## Files
`src/run.mjs` runs the daily pipeline. The other files in `src/`:
- `model.mjs`: goals model
- `markets.mjs`: reads the odds
- `context.mjs`: table position, referees, injuries, corners
- `builder.mjs`: builds the slip
- `settle.mjs`: grades results
- `telegram.mjs`: sends the message
- `mock.mjs`: fake data for testing

The dashboard is `index.html`, and `data/` holds the outputs.
