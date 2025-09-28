import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

// ---------------- Base setup ----------------
const app = express();
app.use(cors({ origin: '*', maxAge: 600 }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';
const ODDS_API_KEY  = process.env.ODDS_API_KEY;

// ---------------- Root ----------------
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'odds-backend-gpt', root: true });
});

// ---------------- Health (patched) ----------------
app.get('/api/health', async (req, res) => {
  try {
    const r = await fetch(`${ODDS_API_BASE}/health`, {
      method: 'GET',
      headers: {
        "Authorization": `Bearer ${ODDS_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    let backend = {};
    try {
      backend = await r.json();
    } catch {
      backend = { raw: await r.text() };
    }

    const result = {
      ok: true,
      service: 'odds-backend-gpt',
      env: process.env.NODE_ENV || 'dev',
      time: new Date().toISOString(),
      backendStatus: r.status,
      backend,
    };

    console.log("✅ Health check:", result);
    res.json(result);

  } catch (err) {
    console.error("❌ Health check failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------- Optional API key gate ----------------
app.use((req, res, next) => {
  const required = process.env.PUBLIC_API_KEY;
  if (!required) return next(); // disabled if not set
  if (req.header('x-api-key') !== required) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }
  next();
});

// ---------------- Config ----------------
const SPORT_ALIASES = {
  mlb: 'baseball_mlb',
  nba: 'basketball_nba',
  ncaab: 'basketball_ncaab',
  nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  nhl: 'icehockey_nhl',
  soccer: 'soccer',
  tennis: 'tennis_atp',
  atp: 'tennis_atp',
  wta: 'tennis_wta',
};
const resolveSportKey = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('_')) return v;
  return SPORT_ALIASES[v] || null;
};

// ---------------- Helpers ----------------
const qs = (obj) => new URLSearchParams(obj).toString();
const num = (v) => (v == null ? null : Number(v));
const safeParse = (txt) => { try { return JSON.parse(txt); } catch { return txt; } };
const extractUsage = (r) => ({
  provider: 'the-odds-api',
  used: num(r.headers.get('x-requests-used')),
  remaining: num(r.headers.get('x-requests-remaining')),
  last: num(r.headers.get('x-requests-last')),
});
const sendErr = (res, reason, meta = {}) => res.json({ ok: false, reason, ...meta });
function logUsage(tag, usage, extra = {}) {
  if (!usage) return;
  const { used, remaining, last } = usage;
  console.log(`[USAGE] ${tag} -> used=${used} remaining=${remaining} last=${last}`, Object.keys(extra).length ? extra : '');
}

// ---------------- Sports list ----------------
app.get('/api/gpt/sports', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');
    const url = `${ODDS_API_BASE}/sports`;
    const r = await fetch(url, {
      headers: { "Authorization": `Bearer ${ODDS_API_KEY}` }
    });
    const txt = await r.text();
    const usage = extractUsage(r);
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: safeParse(txt), usage });
    const data = safeParse(txt);
    logUsage('sports', usage);
    res.json({ ok: true, count: data?.length || 0, sports: data, usage });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------------- Event scan ----------------
app.get('/api/gpt/scan', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');
    const sportKey = resolveSportKey(req.query.sport);
    const limit = Number(req.query.limit ?? 10);
    const markets = String(req.query.markets || 'h2h,spreads,totals');
    if (!sportKey) return sendErr(res, 'Invalid or missing ?sport');

    const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?` + qs({
      regions: 'us',
      markets,
      oddsFormat: 'american',
      dateFormat: 'iso',
    });

    const r = await fetch(url, {
      headers: { "Authorization": `Bearer ${ODDS_API_KEY}` }
    });
    const txt = await r.text();
    const usage = extractUsage(r);
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: safeParse(txt), usage });

    const raw = safeParse(txt) || [];
    const events = raw.slice(0, limit).map((e) => ({
      id: e.id,
      sport_key: e.sport_key ?? sportKey,
      commence_time: e.commence_time,
      home: e.home_team,
      away: e.away_team,
      bookmakers: e.bookmakers || [],
    }));

    logUsage('scan', usage, { sportKey, markets, limit, pulled: events.length });
    res.json({ ok: true, pulled: events.length, events, usage });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------------- Markets ----------------
app.get('/api/gpt/markets', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');
    const sportKey = resolveSportKey(req.query.sport);
    const eventId  = String(req.query.eventId || '').trim();
    const markets  = String(req.query.markets || 'h2h');
    if (!sportKey || !eventId) return sendErr(res, 'Missing sport or eventId');

    const url = `${ODDS_API_BASE}/sports/${sportKey}/events/${eventId}/odds?` + qs({
      regions: 'us',
      markets,
      oddsFormat: 'american',
      dateFormat: 'iso',
    });

    const r = await fetch(url, {
      headers: { "Authorization": `Bearer ${ODDS_API_KEY}` }
    });
    const txt = await r.text();
    const usage = extractUsage(r);
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: safeParse(txt), usage });

    const data = safeParse(txt);
    logUsage('markets', usage, { sportKey, eventId, markets });
    res.json({ ok: true, sport: sportKey, eventId, markets: markets.split(','), data, usage });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------------- Presets ----------------
const PRESETS = {
  moneyline: 'h2h',
  spreads: 'spreads',
  totals: 'totals',
  first_half: 'h2h_h1,spreads_h1,totals_h1',
  f5: 'h2h_1st_5_innings,spreads_1st_5_innings,totals_1st_5_innings',
  props_basic: 'pitcher_strikeouts,batter_home_run,batter_hits_over_under,batter_total_bases_over_under',
};

app.get('/api/gpt/markets/preset', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');
    const sportKey = resolveSportKey(req.query.sport);
    const eventId  = String(req.query.eventId || '').trim();
    const preset   = String(req.query.preset || '').trim().toLowerCase();
    if (!sportKey || !eventId || !preset) return sendErr(res, 'Missing sport, eventId, or preset');

    let markets = PRESETS[preset];
    if (!markets) return sendErr(res, `Unknown preset "${preset}"`);
    if (preset === 'f5' && !sportKey.startsWith('baseball_')) {
      return sendErr(res, 'Preset "f5" is only valid for baseball sports');
    }

    const url = `${ODDS_API_BASE}/sports/${sportKey}/events/${eventId}/odds?` + qs({
      regions: 'us',
      markets,
      oddsFormat: 'american',
      dateFormat: 'iso',
    });

    const r = await fetch(url, {
      headers: { "Authorization": `Bearer ${ODDS_API_KEY}` }
    });
    const txt = await r.text();
    const usage = extractUsage(r);
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: safeParse(txt), usage });

    const data = safeParse(txt);
    logUsage('preset', usage, { sportKey, eventId, preset, markets });
    res.json({ ok: true, sport: sportKey, eventId, preset, markets: markets.split(','), data, usage });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------------- Parlay pricing ----------------
function americanToDecimal(a) {
  const n = Number(a);
  if (!isFinite(n) || n === 0) throw new Error(`bad american leg: ${a}`);
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}
function decimalToAmerican(d) {
  const n = Number(d);
  if (!isFinite(n) || n <= 1) throw new Error(`bad decimal: ${d}`);
  return n >= 2 ? Math.round((n - 1) * 100) : Math.round(-100 / (n - 1));
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

app.get('/api/gpt/parlay/price', (req, res) => {
  try {
    const format = String(req.query.format || 'american').toLowerCase();
    const legsCsv = String(req.query.legs || '').trim();
    if (!legsCsv) return sendErr(res, 'Missing ?legs (csv of odds)');

    const legs = legsCsv.split(',').map(s => s.trim()).filter(Boolean);
    if (legs.length === 0) return sendErr(res, 'No legs provided');

    let decimalLegs;
    if (format === 'american') {
      decimalLegs = legs.map(americanToDecimal);
    } else if (format === 'decimal') {
      decimalLegs = legs.map((d) => {
        const n = Number(d);
        if (!isFinite(n) || n <= 1) throw new Error(`bad decimal leg: ${d}`);
        return n;
      });
    } else {
      return sendErr(res, `Unknown format "${format}" (use american|decimal)`);
    }

    const product = decimalLegs.reduce((acc, d) => acc * d, 1);
    const american = decimalToAmerican(product);
    const implied = clamp(1 / product, 0, 1);

    res.json({
      ok: true,
      legs: { format, values: legs },
      price: {
        decimal: Number(product.toFixed(6)),
        american,
        implied_probability: Number((implied * 100).toFixed(4)) // %
      },
      usage: { provider: 'local', used: 0, remaining: null, last: 0 }
    });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------------- Diagnostics ----------------
app.get('/api/diag/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route?.path) {
      routes.push({ method: Object.keys(m.route.methods)[0]?.toUpperCase(), path: m.route.path });
    } else if (m.name === 'router' && m.handle?.stack) {
      m.handle.stack.forEach((h) => {
        if (h.route?.path) {
          routes.push({ method: Object.keys(h.route.methods)[0]?.toUpperCase(), path: h.route.path });
        }
      });
    }
  });
  res.json({ ok: true, routes });
});

// ---------------- Start ----------------
const assigned = process.env.PORT ? Number(process.env.PORT) : 10000;
app.listen(assigned, () => {
  console.log(`🚀 odds-backend-gpt listening on ${assigned} (PORT=${process.env.PORT || 'unset'})`);
});
