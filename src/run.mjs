// Daily pipeline: settle yesterday → scan today → deep-dive shortlist → build slip → Telegram → save.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { createApi, getAll, ApiError } from './api.mjs';
import { expectedGoals, marketProbs } from './model.mjs';
import { extractBets, buildLegs } from './markets.mjs';
import { flattenTable, importance, refereeFactor, updateRefStore, countInjuries, cornerAverages } from './context.mjs';
import { scoreLeg, filterLegs, buildSlips } from './builder.mjs';
import { gradeLeg, gradeSlip, recordStats } from './settle.mjs';
import { formatMessage, sendTelegram } from './telegram.mjs';

const DATA = path.resolve(process.env.DATA_DIR || 'data');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 1)); };

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timezone }).format(d);
const today = process.env.RUN_DATE || ymd(new Date());
const yesterday = ymd(new Date(new Date(`${today}T12:00:00Z`).getTime() - 864e5));

async function main() {
  let mock = null;
  if (process.env.MOCK) mock = (await import('./mock.mjs')).createMockApi(today, yesterday);
  const api = createApi({ key: process.env.API_FOOTBALL_KEY, mock });
  const history = readJson('history.json', []);
  const refStore = readJson('referees.json', {});
  const log = (...a) => console.log(`[${api.used()} req]`, ...a);
  let notice = null;

  // ---------- 1. Settle open slips ----------
  try {
    const yFix = (await api.get('fixtures', { date: yesterday, timezone: CONFIG.timezone })).response || [];
    const inScope = yFix.filter((f) => CONFIG.leagues[f.league.id]);
    updateRefStore(refStore, inScope.filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture.status.short)));
    const byId = Object.fromEntries(yFix.map((f) => [f.fixture.id, f]));

    const open = history.filter((d) => d.slips?.some((s) => s.result === 'pending')).slice(-7);
    const missing = [...new Set(open.flatMap((d) => d.slips.flatMap((s) => s.legs.map((l) => l.fixtureId))))].filter((id) => !byId[id]);
    for (let i = 0; i < missing.length; i += 20) {
      const r = await api.get('fixtures', { ids: missing.slice(i, i + 20).join('-') });
      for (const f of r.response || []) byId[f.fixture.id] = f;
    }
    for (const d of open) {
      for (const s of d.slips) {
        for (const l of s.legs) {
          if (l.result && l.result !== 'pending') continue;
          let corners = null;
          if (l.settle.kind === 'corners_ou' && ['FT', 'AET', 'PEN'].includes(byId[l.fixtureId]?.fixture?.status?.short)) {
            const st = (await api.get('fixtures/statistics', { fixture: l.fixtureId })).response || [];
            corners = st.reduce((sum, t) => sum + Number(t.statistics.find((x) => x.type === 'Corner Kicks')?.value || 0), 0);
          }
          l.result = gradeLeg(l, byId[l.fixtureId], corners);
          const fx = byId[l.fixtureId];
          if (fx?.score?.fulltime?.home != null) l.score = `${fx.score.fulltime.home}-${fx.score.fulltime.away}`;
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
  const all = (await api.get('fixtures', { date: today, timezone: CONFIG.timezone })).response || [];
  const fixtures = all.filter(
    (f) => CONFIG.leagues[f.league.id] && f.fixture.status.short === 'NS' && f.fixture.timestamp * 1000 > now + 20 * 60e3,
  );
  const fixturesById = Object.fromEntries(fixtures.map((f) => [f.fixture.id, f]));
  log(`today ${today}: ${all.length} fixtures worldwide, ${fixtures.length} in covered leagues`);

  // ---------- 3. Odds + tables per league (market-only pass) ----------
  const byLeague = {};
  for (const f of fixtures) (byLeague[f.league.id] ||= []).push(f);
  const leagueOrder = Object.keys(byLeague).sort((a, b) => byLeague[b].length - byLeague[a].length);

  const odds = {}, tables = {};
  for (const lid of leagueOrder) {
    if (api.budgetLeft() < CONFIG.shortlistSize * 2 + 4) { notice = 'API budget limited the scan to the busiest leagues.'; break; }
    const season = byLeague[lid][0].league.season;
    try {
      const o = await getAll(api, 'odds', { league: lid, season, date: today, bookmaker: CONFIG.bookmakerId }, 3);
      for (const e of o) odds[e.fixture.id] = extractBets(e, CONFIG.bookmakerId);
      if (o.length) tables[lid] = flattenTable((await api.get('standings', { league: lid, season })).response);
    } catch (e) {
      if (e instanceof ApiError && /budget/i.test(e.message)) break;
      console.error(`league ${lid}:`, e.message);
    }
  }

  const prelim = [];
  for (const f of fixtures) {
    const B = odds[f.fixture.id];
    if (!B) continue;
    const legs = buildLegs(f, B, null).map(scoreLeg).filter((l) => l.odd >= CONFIG.minLegOdds && l.odd <= CONFIG.maxLegOdds);
    if (!legs.length) continue;
    prelim.push({ f, best: Math.max(...legs.map((l) => l.fair)) });
  }
  prelim.sort((a, b) => b.best - a.best);
  const shortlist = prelim.slice(0, CONFIG.shortlistSize);
  log(`${prelim.length} fixtures priced, shortlisting ${shortlist.length}`);

  // ---------- 4. Deep dive ----------
  const candidates = [];
  for (const { f } of shortlist) {
    if (api.budgetLeft() < 2) break;
    const id = f.fixture.id, hid = f.teams.home.id, aid = f.teams.away.id, lid = f.league.id;
    try {
      const pred = (await api.get('predictions', { fixture: id })).response?.[0];
      const inj = countInjuries((await api.get('injuries', { fixture: id })).response, hid, aid);

      let corners = null;
      if (CONFIG.cornersDepth > 0 && api.budgetLeft() > CONFIG.cornersDepth * 2 + 4) {
        const avg = {};
        for (const tid of [hid, aid]) {
          const last = (await api.get('fixtures', { team: tid, last: CONFIG.cornersDepth })).response || [];
          const stats = [];
          for (const lf of last) stats.push({ stats: (await api.get('fixtures/statistics', { fixture: lf.fixture.id })).response || [] });
          avg[tid] = cornerAverages(tid, stats);
        }
        if (avg[hid] && avg[aid]) {
          corners = { home: (avg[hid].for + avg[aid].against) / 2, away: (avg[aid].for + avg[hid].against) / 2 };
        }
      }

      const table = tables[lid];
      const homeRow = table?.find((t) => t.team.id === hid);
      const awayRow = table?.find((t) => t.team.id === aid);
      if (homeRow && awayRow && (homeRow.all.played < CONFIG.minGamesPlayed || awayRow.all.played < CONFIG.minGamesPlayed)) continue;

      const ref = refereeFactor(refStore, f.fixture.referee);
      const xg = expectedGoals({ table, homeRow, awayRow, pred, injuries: inj, refFactor: ref.factor });
      if (!xg) continue;
      const P = marketProbs(xg.lh, xg.la, corners);
      const impH = importance(table, homeRow, lid), impA = importance(table, awayRow, lid);

      // Context reasons shown in the message
      const why = [];
      if (homeRow && awayRow) why.push(`${homeRow.rank}${ord(homeRow.rank)} (${homeRow.form || '-'}) v ${awayRow.rank}${ord(awayRow.rank)} (${awayRow.form || '-'})`);
      why.push(`model xG ${xg.lh.toFixed(2)}–${xg.la.toFixed(2)}`);
      if (inj.home || inj.away) why.push(`out: ${inj.home} home / ${inj.away} away`);
      if (ref.info) why.push(`ref ${String(f.fixture.referee).split(',')[0]}: ${ref.info}`);
      if (impH.level === 'high' || impA.level === 'high') why.push([impH.level === 'high' && `${f.teams.home.name} ${impH.label}`, impA.level === 'high' && `${f.teams.away.name} ${impA.label}`].filter(Boolean).join('; '));
      const h2h = pred?.h2h?.slice(0, 5) || [];
      if (h2h.length >= 3) {
        const g = h2h.map((m) => (m.goals.home ?? 0) + (m.goals.away ?? 0));
        why.push(`H2H last ${h2h.length}: avg ${(g.reduce((a, b) => a + b, 0) / g.length).toFixed(1)} goals`);
      }
      if (corners) why.push(`exp. corners ${(corners.home + corners.away).toFixed(1)}`);
      why.push(...xg.notes);

      const ctx = {
        match: `${f.teams.home.name} v ${f.teams.away.name}`,
        league: CONFIG.leagues[lid] || f.league.name,
        kickoff: f.fixture.date,
        referee: f.fixture.referee || null,
        xg: [+xg.lh.toFixed(2), +xg.la.toFixed(2)],
        injuries: inj.names,
        importance: { home: impH, away: impA },
        why,
      };

      for (const leg of buildLegs(f, odds[id], P).map(scoreLeg)) {
        // Motivation guard: don't back a side with nothing to play for against a desperate opponent
        const side = leg.settle.kind === 'dc' ? { hd: 'home', da: 'away' }[leg.settle.side] : ['1x2', 'dnb'].includes(leg.settle.kind) ? leg.settle.side : null;
        if (side) {
          const mine = side === 'home' ? impH : impA, theirs = side === 'home' ? impA : impH;
          if (mine.level === 'low' && theirs.level === 'high') leg.blocked = 'motivation';
        }
        candidates.push({ ...leg, ctx });
      }
    } catch (e) {
      if (e instanceof ApiError && /budget/i.test(e.message)) break;
      console.error(`fixture ${id}:`, e.message);
    }
  }

  const passed = filterLegs(candidates);
  const slips = buildSlips(passed, fixturesById, 2);
  log(`${candidates.length} legs analysed, ${passed.length} passed filters, ${slips.length} slip(s) built`);
  if (!fixtures.length) notice = 'No matches in covered leagues today (international break or off-day).';

  // ---------- 5. Save + send ----------
  const entry = {
    date: today,
    generatedAt: new Date().toISOString(),
    requestsUsed: api.used(),
    scanned: fixtures.length,
    analysed: shortlist.length,
    slips: slips.map((s) => ({ ...s, result: 'pending', paidOdds: null })),
    topLegs: passed.slice(0, 12).map(({ ctx, ...l }) => ({ ...l, match: ctx.match, league: ctx.league, kickoff: ctx.kickoff })),
    notice,
  };
  const idx = history.findIndex((d) => d.date === today);
  if (idx >= 0) history[idx] = entry; else history.push(entry);
  history.sort((a, b) => a.date.localeCompare(b.date));

  const stats = recordStats(history);
  const yEntry = history.find((d) => d.date === yesterday);
  // keep history lean: no per-day leg pool, compact leg context
  const lean = history.map(({ topLegs, ...d }) => ({
    ...d,
    slips: (d.slips || []).map((sl) => ({ ...sl, legs: sl.legs.map(({ ctx, ...l }) => ({ ...l, ctx: ctx && { match: ctx.match, league: ctx.league, kickoff: ctx.kickoff, referee: ctx.referee, xg: ctx.xg, why: ctx.why } })) })),
  }));
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'history.json'), JSON.stringify(lean));
  writeJson('referees.json', refStore);
  writeJson('latest.json', { ...entry, stats, yesterday: yEntry ? { date: yEntry.date, slips: yEntry.slips } : null });

  const msg = formatMessage({ date: today, slips: entry.slips, yesterday: yEntry, stats, dashboardUrl: process.env.DASHBOARD_URL, notice });
  await sendTelegram(msg);
  log('done');
}

const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

main().catch(async (e) => {
  console.error(e);
  const hint = /season|plan/i.test(e.message)
    ? '\nYour API-Football plan may not cover the current season. See README → "Data plan".'
    : '';
  await sendTelegram(`⚠️ Daily Acca failed today: ${e.message}${hint}`);
  process.exit(1);
});
