import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

/**
 * odds-backend-gpt
 * Public:
 *   GET /api/health
 * Protected (x-api-key if PUBLIC_API_KEY is set):
 *   GET /api/gpt/sports
 *   GET /api/gpt/scan?sport=<alias|key>&limit=10
 *   GET /api/gpt/markets?sport=<alias|key>&eventId=<id>&markets=h2h
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
  if (!required) return next(); // disabled if not set
  if (req.header('x-api-key') !== required) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }
  next();
});

// ---------- config ----------
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';
const ODDS_API_KEY  = process.env.ODDS_API_KEY;

// helpful alias map -> The Odds API sport keys
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
  // soccer & tennis (broad defaults)
  soccer: 'soccer',
  tennis: 'tennis_atp',
  atp: 'tennis_atp',
  wta: 'tennis_wta',
};

const resolveSportKey = (value) => {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  // if caller already passes a full key, use it; else map alias
  if (v.includes('_')) return v;
  return SPORT_ALIASES[v] || null;
};

const qs = (obj) => new URLSearchParams(obj).toString();

// Always return 200 so PowerShell shows the JSON body
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

// ---------- scan ----------
app.get('/api/gpt/scan', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');

    const sportInput = req.query.sport;
    const sportKey = resolveSportKey(sportInput);
    const limit = Number(req.query.limit ?? 10);

    if (!sportKey) {
      return sendErr(res, 'Invalid or missing ?sport. Try one of: mlb, nfl, nba, nhl, ncaaf, ncaab, soccer, tennis (aliases are accepted).');
    }

    const url = `${ODDS_API_BASE}/sports/${sportKey}/odds?` + qs({
      regions: 'us',
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
      apiKey: ODDS_API_KEY,
    });

    const r = await fetch(url);
    const txt = await r.text();
    if (!r.ok) return sendErr(res, `Odds API ${r.status}`, { upstream: txt });

    const raw = JSON.parse(txt) || [];
    const events = raw.slice(0, limit).map((e) => ({
      id: e.id ?? e.game_id ?? e.event_id,
      sport_key: e.sport_key ?? sportKey,
      commence_time: e.commence_time,
      home: e.home_team,
      away: e.away_team,
      bookmakers: (e.bookmakers || []).map((b) => ({
        key: b.key,
        title: b.title,
        markets: (b.markets || []).map((m) => ({
          key: m.key, // h2h | spreads | totals
          outcomes: (m.outcomes || []).map((o) => ({
            name: o.name,
            price: o.price,
            point: o.point ?? null,
          })),
        })),
      })),
    }));

    res.json({ ok: true, pulled: events.length, events });
  } catch (err) {
    sendErr(res, err.message);
  }
});

// ---------- markets ----------
app.get('/api/gpt/markets', async (req, res) => {
  try {
    if (!ODDS_API_KEY) return sendErr(res, 'Set ODDS_API_KEY in Render env');

    const sportInput = req.query.sport;
    const eventId = String(req.query.eventId || '').trim();
    const markets = String(req.query.markets || 'h2h');
    const sportKey = resolveSportKey(sportInput);

    if (!sportKey || !eventId) {
      return sendErr(res, 'Missing sport or eventId. sport may be alias (e.g., mlb → baseball_mlb).');
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
    res.json({ ok: true, eventId, data });
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
