import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

/**
 * odds-backend-gpt
 *
 * Public:
 *   GET  /api/health
 *
 * Protected (x-api-key required if PUBLIC_API_KEY is set):
 *   GET  /api/gpt/sports
 *   GET  /api/gpt/scan?sport=<alias|key>&markets=h2h,spreads,totals&limit=10
 *   GET  /api/gpt/markets?sport=<alias|key>&eventId=<id>&markets=<csv>
 *   GET  /api/gpt/markets/preset?sport=<alias|key>&eventId=<id>&preset=<moneyline|spreads|totals|f5|first_half|props_basic>
 *   GET  /api/gpt/parlay/price?format=<american|decimal>&legs=<csv_of_odds>
 *   GET  /api/diag/routes
 *
 * Notes:
 *  - Use /scan for listing events (featured markets only per The Odds API docs).
 *  - Use /markets for any market set, including F5, 1H, props (via event-odds endpoint).
 *  - /markets/preset gives you handy one-word presets Russ uses daily.
 */

const app = express();
app.use(cors({ origin: '*', maxAge: 600 }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// ---------- health (public) ----------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'odds-backend-gpt',
    env: process.env.NODE_ENV || 'dev',
    time: new Date().toISOString(),
  });
});

// ---------- optional API key gate ----------
app.use((req, res, next) => {
  const required = process.env.PUBLIC_API_KEY;
  if (!required) return next(); // gate disabled if not set
  if (req.header('x-api-key') !== required) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }
  next();
});

// ---------- config ----------
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';
const ODDS_API_KEY  = process.env.ODDS_API_KEY;

// sport aliases -> The Odds API sport keys
const SPORT_ALIASES = {
  // baseball
  mlb: 'baseball_mlb',
  // basketball
  nba: 'basketball_nba',
  ncaab: 'basketball_ncaab',
  // football
  nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  // hockey
  nhl: 'icehockey_nhl',
  // broad
  soccer: 'soccer',
  tennis: 'tennis_atp',
  atp: 'tennis_atp',
  wta: 'tennis_wta',
};
const resolveSportKey = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('_')) return v; // caller already passed a full key
  return SPORT_ALIASES[v] || null;
};

// helpers
const qs = (obj) => new URLSearchParams(obj).toString();
const sendErr = (res, reason, meta = {}) => res.json({ ok: false, reason, ...meta });

// ---------- list sports ----------
app.get('/api/gpt/sports', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');
    const url = `${ODDS_API_BASE}/sports?${qs({ apiKey: ODDS_API_KEY })}`;
    const r = await fetch(url);
    const txt = await r.text();
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: txt });
    const data = JSON.parse(txt);
    res.json({ ok: true, count: data?.length || 0, sports: data });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------- event scan (featured markets only) ----------
/**
 * /v4/sports/{sport}/odds returns ONLY featured markets (h2h, spreads, totals).
 * For F5/1H/props use /markets endpoint below.
 */
app.get('/api/gpt/scan', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');

    const sportKey = resolveSportKey(req.query.sport);
    const limit = Number(req.query.limit ?? 10);
    const markets = String(req.query.markets || 'h2h,spreads,totals');

    if (!sportKey) {
      return sendErr(res, 'Invalid or missing ?sport. Try aliases like mlb, nfl, nba, nhl.');
    }

    const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?` + qs({
      regions: 'us',
      markets,                // featured only honored here
      oddsFormat: 'american',
      dateFormat: 'iso',
      apiKey: ODDS_API_KEY,
    });

    const r = await fetch(url);
    const txt = await r.text();
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: txt });

    const raw = JSON.parse(txt) || [];
    const events = raw.slice(0, limit).map((e) => ({
      id: e.id,
      sport_key: e.sport_key ?? sportKey,
      commence_time: e.commence_time,
      home: e.home_team,
      away: e.away_team,
      bookmakers: e.bookmakers || [],
    }));
    res.json({ ok: true, pulled: events.length, events });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------- markets (flex: F5, 1H, props, etc.) ----------
/**
 * Use /v4/sports/{sport}/events/{eventId}/odds with markets=<csv>
 * Examples of markets:
 *   Featured: h2h, spreads, totals
 *   MLB F5:  h2h_1st_5_innings, spreads_1st_5_innings, totals_1st_5_innings
 *   1st half (NFL/NBA, etc.): h2h_h1, spreads_h1, totals_h1
 *   Props (MLB): batter_home_run, batter_hits_over_under, batter_total_bases_over_under, pitcher_strikeouts (varies by book/coverage)
 */
app.get('/api/gpt/markets', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');

    const sportKey = resolveSportKey(req.query.sport);
    const eventId  = String(req.query.eventId || '').trim();
    const markets  = String(req.query.markets || 'h2h');

    if (!sportKey || !eventId) {
      return sendErr(res, 'Missing sport or eventId');
    }

    const url = `${ODDS_API_BASE}/sports/${sportKey}/events/${eventId}/odds?` + qs({
      regions: 'us',
      markets,                // any supported market keys
      oddsFormat: 'american',
      dateFormat: 'iso',
      apiKey: ODDS_API_KEY,
    });

    const r = await fetch(url);
    const txt = await r.text();
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: txt });

    const data = JSON.parse(txt);
    res.json({ ok: true, sport: sportKey, eventId, markets: markets.split(','), data });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------- presets (Russ-friendly shorthands) ----------
/**
 * Presets:
 *  - moneyline     → h2h
 *  - spreads       → spreads
 *  - totals        → totals
 *  - f5            → (mlb) h2h_1st_5_innings,spreads_1st_5_innings,totals_1st_5_innings
 *  - first_half    → h2h_h1,spreads_h1,totals_h1
 *  - props_basic   → pitcher_strikeouts,batter_home_run,batter_hits_over_under,batter_total_bases_over_under
 */
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

    if (!sportKey || !eventId || !preset) {
      return sendErr(res, 'Missing sport, eventId, or preset');
    }
    let markets = PRESETS[preset];
    if (!markets) return sendErr(res, `Unknown preset "${preset}"`);

    // guard: F5 really only makes sense for MLB keys
    if (preset === 'f5' && !sportKey.startsWith('baseball_')) {
      return sendErr(res, 'Preset "f5" is only valid for baseball sports (e.g., baseball_mlb)');
    }

    const url = `${ODDS_API_BASE}/sports/${sportKey}/events/${eventId}/odds?` + qs({
      regions: 'us',
      markets,
      oddsFormat: 'american',
      dateFormat: 'iso',
      apiKey: ODDS_API_KEY,
    });

    const r = await fetch(url);
    const txt = await r.text();
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: txt });

    const data = JSON.parse(txt);
    res.json({ ok: true, sport: sportKey, eventId, preset, markets: markets.split(','), data });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------- parlay pricing ----------
/**
 * GET /api/gpt/parlay/price?format=<american|decimal>&legs=<csv_of_odds>
 * Example:
 *   /api/gpt/parlay/price?format=american&legs=-110,-105,+120
 *   /api/gpt/parlay/price?format=decimal&legs=1.91,1.95,2.20
 * Returns combined price in both decimal & American with implied prob.
 */
function americanToDecimal(a) {
  const n = Number(a);
  if (!isFinite(n) || n === 0) throw new Error('bad american');
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}
function decimalToAmerican(d) {
  const n = Number(d);
  if (n <= 1) throw new Error('bad decimal');
  return n >= 2 ? Math.round((n - 1) * 100) : Math.round(-100 / (n - 1));
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

app.get('/api/gpt/parlay/price', (req, res) => {
  try {
    const format = String(req.query.format || 'american').toLowerCase();
    const legsCsv = String(req.query.legs || '').trim();
    if (!legsCsv) return sendErr(res, 'Missing ?legs (csv of odds)');

    const legs = legsCsv.split(',').map(s => s.trim()).filter(Boolean);
    if (legs.length === 0) return sendErr(res, 'No legs provided');

    const decimals = format === 'decimal'
      ? legs.map(americanToDecimal.bind(null)) // oops reversed; handle below
      : legs.map(americanToDecimal);

    // if user said decimal, convert each from decimal, not american
    let decimalLegs;
    if (format === 'decimal') {
      decimalLegs = legs.map((d) => {
        const n = Number(d);
        if (!isFinite(n) || n <= 1) throw new Error(`bad decimal leg: ${d}`);
        return n;
      });
    } else {
      decimalLegs = decimals;
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
      }
    });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------- diagnostics ----------
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

// ---------- root + 404 ----------
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'odds-backend-gpt', root: true });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, reason: `No route: ${req.method} ${req.path}` });
});

// ---------- start ----------
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`odds-backend-gpt listening on ${port}`));
