import { cache } from './cache.js';
import { request } from 'undici';

const BASE = process.env.ODDS_API_BASE;
const KEY  = process.env.ODDS_API_KEY;

function qs(params) {
  const u = new URLSearchParams(params);
  return u.toString();
}

export async function fetchOdds(endpoint, params, ttlKey) {
  const key = `${endpoint}?${qs(params)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `${BASE}${endpoint}?${qs({ ...params, apiKey: KEY })}`;
  const { body, statusCode } = await request(url);
  if (statusCode >= 400) {
    const txt = await body.text();
    throw new Error(`Odds API error ${statusCode}: ${txt}`);
  }
  const data = await body.json();
  cache.set(key, data);
  return data;
}
