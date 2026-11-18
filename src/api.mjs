// API-Football client with a daily request budget and per-minute pacing.
import { CONFIG } from './config.mjs';

const BASE = 'https://v3.football.api-sports.io';

export class ApiError extends Error {}

export function createApi({ key, mock } = {}) {
  if (mock) return mock;
  if (!key) throw new ApiError('API_FOOTBALL_KEY is missing. Add it under GitHub → Settings → Secrets → Actions.');

  let used = 0;
  let remainingToday = Infinity;
  let last = 0;
  const gap = Math.ceil(60000 / CONFIG.ratePerMinute) + 200;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function get(path, params = {}) {
    if (used >= CONFIG.maxRequests || remainingToday <= 1) {
      throw new ApiError(`Request budget reached (${used} used).`);
    }
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();

    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined));
    const res = await fetch(`${BASE}/${path}?${qs}`, { headers: { 'x-apisports-key': key } });
    used++;
    const rem = res.headers.get('x-ratelimit-requests-remaining');
    if (rem !== null) remainingToday = Number(rem);
    if (!res.ok) throw new ApiError(`API-Football HTTP ${res.status} on /${path}`);
    const json = await res.json();
    const errs = json.errors && (Array.isArray(json.errors) ? json.errors : Object.values(json.errors));
    if (errs && errs.length) throw new ApiError(`API-Football: ${errs.join('; ')} (/${path})`);
    return json;
  }

  return {
    get,
    budgetLeft: () => Math.min(CONFIG.maxRequests - used, remainingToday - 1),
    used: () => used,
  };
}

// Helper: fetch all pages of a paginated endpoint (odds is paginated).
export async function getAll(api, path, params, maxPages = 5) {
  const out = [];
  let page = 1;
  while (page <= maxPages) {
    const j = await api.get(path, page > 1 ? { ...params, page } : params);
    out.push(...(j.response || []));
    const total = j.paging?.total || 1;
    if (page >= total || api.budgetLeft() < 5) break;
    page++;
  }
  return out;
}
