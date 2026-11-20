// Daily pipeline: settle open slips → today's fixtures → season context + odds → model → slip → Telegram → save.
// Data: football-data.org (fixtures, results, referees) + The Odds API (bookmaker prices). Both free.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { createFootballData, createOddsApi, SourceError } from './sources.mjs';
import { expectedGoals, fitMarket, marketProbs } from './model.mjs';
import { summariseOdds, buildLegs } from './markets.mjs';
import { buildTable, importance, refereeStats, refereeFactor, refName, headToHead } from './context.mjs';
import { pairMatches } from './teams.mjs';
import { scoreLeg, filterLegs, buildSlips } from './builder.mjs';
import { gradeLeg, gradeSlip, recordStats } from './settle.mjs';
import { formatMessage, sendTelegram } from './telegram.mjs';

const DATA = path.resolve(process.env.DATA_DIR || 'data');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const writeJson = (f, v, pretty = true) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, pretty ? 1 : 0)); };

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone }).format(d);
const today = process.env.RUN_DATE || ymd(new Date());
const dayMs = 864e5;
const shift = (d, n) => ymd(new Date(Date.parse(`${d}T12:00:00Z`) + n * dayMs));
const yesterday = shift(today, -1);
const isoNoMs = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

async function main() {
  let fd, odds;
  if (process.env.MOCK) ({ fd, odds } = (await import('./mock.mjs')).createMocks(today));
  else {
    fd = createFootballData(process.env.FOOTBALL_DATA_KEY);
    odds = createOddsApi(process.env.ODDS_API_KEY);
  }
  const history = readJson('history.json', []);
  const log = (...a) => console.log(`[fd ${fd.used()} | odds ${odds.used()}]`, ...a);
  const notices = [];

  // ---------- 1. Settle open slips ----------
  try {
    const open = history.filter((d) => d.slips?.some((s) => s.result === 'pending')).slice(-7);
    const ids = [...new Set(open.flatMap((d) => d.slips.flatMap((s) => s.legs.map((l) => l.fixtureId))))];
    if (ids.length) {
      const res = (await fd.get('matches', { ids: ids.join(',') })).matches || [];
      const byId = Object.fromEntries(res.map((m) => [m.id, m]));
      for (const d of open) for (const s of d.slips) {
        for (const l of s.legs) {
          if (l.result && l.result !== 'pending') continue;
          const m = byId[l.fixtureId];
          l.result = gradeLeg(l, m);
          const g = m?.score?.fullTime;
          if (g?.home != null) l.score = `${g.home}-${g.away}`;
        }
        Object.assign(s, gradeSlip(s));
      }
    }
    log('settled', open.length, 'open day(s)');
  } catch (e) {
    console.error('settle step failed:', e.message);
  }

  // ---------- 2. Today's fixtures ----------
  const now = Date.now();
  const raw = (await fd.get('matches', { dateFrom: shift(today, -1), dateTo: shift(today, 1) })).matches || [];
  const matches = raw.filter(
    (m) => CONFIG.competitions[m.competition?.code] && ['SCHEDULED', 'TIMED'].includes(m.status) &&
      ymd(new Date(m.utcDate)) === today && Date.parse(m.utcDate) > now + 20 * 60e3,
  );
  const meta = Object.fromEntries(matches.map((m) => [m.id, { ts: Date.parse(m.utcDate), comp: m.competition.code }]));
  log(`today ${today}: ${matches.length} matches in covered competitions`);

  // ---------- 3. Per competition: season context + odds ----------
  const byComp = {};
  for (const m of matches) (byComp[m.competition.code] ||= []).push(m);
  const comps = Object.keys(byComp).sort((a, b) => byComp[b].length - byComp[a].length);

  const candidates = [];
  let priced = 0;
  for (const code of comps) {
    const comp = CONFIG.competitions[code];
    try {
      // Odds first (scarcer resource)
      if (odds.remaining() < CONFIG.minOddsCreditsLeft) { notices.push('Odds credits for this month are nearly used up.'); break; }
      const window = { commenceTimeFrom: isoNoMs(Math.max(now, Date.parse(`${shift(today, -1)}T23:00:00Z`))), commenceTimeTo: isoNoMs(Date.parse(`${today}T23:00:00Z`)) };
      let events;
      try {
        events = await odds.get(`sports/${comp.odds}/odds`, { regions: CONFIG.oddsRegion, markets: 'h2h,totals', oddsFormat: 'decimal', dateFormat: 'iso', ...window });
      } catch (e) {
        if (!/422|INVALID/i.test(e.message)) throw e;
        events = await odds.get(`sports/${comp.odds}/odds`, { regions: CONFIG.oddsRegion, markets: 'h2h', oddsFormat: 'decimal', dateFormat: 'iso', ...window });
      }
      const pairs = pairMatches(byComp[code], events || []);
      if (!pairs.size) { log(`${code}: no odds matched (${events?.length || 0} events)`); continue; }

      const finished = (await fd.get(`competitions/${code}/matches`, { status: 'FINISHED' })).matches || [];
      const table = buildTable(finished);
      const refs = refereeStats(finished);
      log(`${code}: ${byComp[code].length} matches, ${pairs.size} priced, ${finished.length} results this season`);

      for (const m of byComp[code]) {
        const ev = pairs.get(m.id);
        if (!ev) continue;
        const S = summariseOdds(ev);
        if (!S) continue;
        priced++;
        const homeRow = table.find((t) => t.team.id === m.homeTeam.id);
        const awayRow = table.find((t) => t.team.id === m.awayTeam.id);
        if (!homeRow || !awayRow || homeRow.all.played < CONFIG.minGamesPlayed || awayRow.all.played < CONFIG.minGamesPlayed) continue;

        const ref = refName(m);
        const rf = refereeFactor(refs, ref);
        const mk = fitMarket(S.fair, S.ou);
        const md = expectedGoals({ table, homeRow, awayRow, refFactor: rf.factor });
        if (!md) continue;
        const F = marketProbs(mk.lh, mk.la), M = marketProbs(md.lh, md.la);
        const impH = importance(table, homeRow, comp), impA = importance(table, awayRow, comp);

        const H = m.homeTeam.shortName || m.homeTeam.name, A = m.awayTeam.shortName || m.awayTeam.name;
        const why = [
          `${homeRow.rank}${ord(homeRow.rank)} (${homeRow.form}) v ${awayRow.rank}${ord(awayRow.rank)} (${awayRow.form})`,
          `xG bookies ${mk.lh.toFixed(2)}–${mk.la.toFixed(2)}, model ${md.lh.toFixed(2)}–${md.la.toFixed(2)}`,
          `${H} home: ${homeRow.home.goals.for}-${homeRow.home.goals.against} in ${homeRow.home.played}; ${A} away: ${awayRow.away.goals.for}-${awayRow.away.goals.against} in ${awayRow.away.played}`,
        ];
        if (rf.info) why.push(`ref ${ref}: ${rf.info}`);
        const hi = [impH.level === 'high' && `${H} ${impH.label}`, impA.level === 'high' && `${A} ${impA.label}`].filter(Boolean);
        if (hi.length) why.push(hi.join('; '));
        const h2h = headToHead(finished, m.homeTeam.id, m.awayTeam.id);
        if (h2h.length) why.push(`met this season: ${h2h.map((g) => `${g.h}-${g.a}`).join(', ')}`);

        const ctx = {
          match: `${H} v ${A}`, league: comp.name, kickoff: m.utcDate, referee: ref,
          xg: [+md.lh.toFixed(2), +md.la.toFixed(2)], marketXg: [+mk.lh.toFixed(2), +mk.la.toFixed(2)], books: S.books, why,
        };
        for (const leg of buildLegs(m, F, M, S).map(scoreLeg)) {
          const side = leg.settle.kind === 'dc' ? { hd: 'home', da: 'away' }[leg.settle.side] : ['1x2', 'dnb'].includes(leg.settle.kind) ? leg.settle.side : null;
          if (side) {
            const mine = side === 'home' ? impH : impA, theirs = side === 'home' ? impA : impH;
            if (mine.level === 'low' && theirs.level === 'high') leg.blocked = 'motivation';
          }
          candidates.push({ ...leg, ctx });
        }
      }
    } catch (e) {
      console.error(`${code}:`, e.message);
      if (e instanceof SourceError && /odds api (401|429)/i.test(e.message)) { notices.push(e.message); break; }
    }
  }

  const passed = filterLegs(candidates);
  const slips = buildSlips(passed, meta, 2);
  log(`${priced} matches priced, ${candidates.length} legs analysed, ${passed.length} passed filters, ${slips.length} slip(s); odds credits left: ${odds.remaining()}`);
  if (!matches.length) notices.push('No matches in covered leagues today.');
  else if (!priced) notices.push('No bookmaker odds were available for today\'s matches.');
  if (odds.remaining() < 60 && odds.remaining() >= 0 && isFinite(odds.remaining())) notices.push(`Only ${odds.remaining()} odds credits left this month.`);
  const notice = notices.join(' ') || null;

  // ---------- 4. Save + send ----------
  const entry = {
    date: today,
    generatedAt: new Date().toISOString(),
    requests: { footballData: fd.used(), odds: odds.used(), oddsCreditsLeft: isFinite(odds.remaining()) ? odds.remaining() : null },
    scanned: matches.length,
    analysed: priced,
    slips: slips.map((s) => ({ ...s, result: 'pending', paidOdds: null })),
    topLegs: passed.slice(0, 12).map(({ ctx, ...l }) => ({ ...l, match: ctx.match, league: ctx.league, kickoff: ctx.kickoff })),
    notice,
  };
  const idx = history.findIndex((d) => d.date === today);
  if (idx >= 0) history[idx] = entry; else history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  const stats = recordStats(history);
  const yEntry = history.find((d) => d.date === yesterday);
  const lean = history.map(({ topLegs, ...d }) => d);
  writeJson('history.json', lean, false);
  writeJson('latest.json', { ...entry, stats, yesterday: yEntry ? { date: yEntry.date, slips: yEntry.slips } : null });

  await sendTelegram(formatMessage({ date: today, slips: entry.slips, yesterday: yEntry, stats, dashboardUrl: process.env.DASHBOARD_URL, notice }));
  log('done');
}

main().catch(async (e) => {
  console.error(e);
  await sendTelegram(`⚠️ Daily Acca failed today: ${e.message}`);
  process.exit(1);
});
