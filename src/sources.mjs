// Clients for the two free data sources.
//  - football-data.org: fixtures, results, referees (10 requests/minute, no daily cap)
//  - The Odds API: bookmaker odds (500 credits/month on the free plan)

export class SourceError extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createFootballData(key) {
  if (!key) throw new SourceError('FOOTBALL_DATA_KEY is missing. Add it under GitHub → Settings → Secrets → Actions.');
  let last = 0, used = 0;
  async function get(path, params = {}, attempt = 0) {
    const wait = last + 6500 - Date.now(); // stay under 10/min
    if (wait > 0) await sleep(wait);
    last = Date.now();
    used++;
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
    const res = await fetch(`https://api.football-data.org/v4/${path}${qs.size ? `?${qs}` : ''}`, { headers: { 'X-Auth-Token': key } });
    if (res.status === 429 && attempt < 2) {
      const s = Number(res.headers.get('x-requestcounter-reset') || 60);
      await sleep((s + 1) * 1000);
      return get(path, params, attempt + 1);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new SourceError(`football-data.org ${res.status}: ${json.message || res.statusText} (/${path})`);
    return json;
  }
  return { get, used: () => used };
}

export function createOddsApi(key) {
  if (!key) throw new SourceError('ODDS_API_KEY is missing. Add it under GitHub → Settings → Secrets → Actions.');
  let remaining = Infinity, used = 0;
  async function get(path, params = {}) {
    const qs = new URLSearchParams({ apiKey: key, ...params });
    const res = await fetch(`https://api.the-odds-api.com/v4/${path}?${qs}`);
    used++;
    const rem = res.headers.get('x-requests-remaining');
    if (rem !== null) remaining = Number(rem);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new SourceError(`The Odds API ${res.status}: ${json.message || res.statusText}`);
    return json;
  }
  return { get, used: () => used, remaining: () => remaining };
}
