import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

/**
 * Minimal, GPT-safe odds gateway:
 * - /api/health            → health check (public)
 * - /api/gpt/scan          → list events + markets (read-only)
 * - /api/gpt/markets       → markets for one event (read-only)
 * Optional header auth: set PUBLIC_API_KEY on Render; GPT sends x-api-key.
 */

const app = express();
app.use(cors({ origin: '*', maxAge: 600 }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// ---------------------- HEALTH (public) ----------------------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'odds-backend-gpt',
    env: process.env.NODE_ENV || 'dev',
    time: new Date().toISOString()
  });
});

// ---------------------- Optional API key gate ----------------------
app.use((req, res, next) => {
  const required = process.env.PUBLIC_API_KEY;
  if (!required) return next(); // gate disabled if no key set
  if (req.header('x-api-key') !== required) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }
  next();
});

// ---------------------- Config ----------------------
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';
const ODDS_API_KEY  = process.env.ODDS_API_KEY; // must be set on Render

function q(params) {
  return new URLSearchParams(params).toString();
}

// ---------------------- GPT endpoints ----------------------

/**
 * GET /api/gpt/scan?sport=mlb&limit=10
 * regions=us, markets=h2h,spreads,totals, odds/date format fixed for GPT.
 */
app.get('/api/gpt/scan', async (req, res) => {
  try {
    const sport = String(req.query.sport || '').trim();
    const limit = Number(req.query.limit ?? 10);

    if (!sport) return res.status(400).json({ ok: false, reason: 'Missing ?sport' });
    if (!ODDS_API_KEY) return res.status(500).json({ ok: false, reason: 'Set ODDS_API_KEY in Render env' });

    const url = `${ODDS_API_BASE}/sports/${sport}/odds?` + q({
      regions: 'us',
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
      dateFormat: 'iso',
      apiKey: ODDS_API_KEY
    });

    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ ok: false, reason: `Odds API ${r.status}: ${txt}` });
    }

    const raw = await r.json();
    const events = (raw || []).slice(0, limit).map(e => ({
      id: e.id ?? e.game_id ?? e.event_id,
      sport_key: e.sport_key ?? e.sportKey,
      commence_time: e.commence_time,
      home: e.home_team,
      away: e.away_team,
      bookmakers: (e.bookmakers || []).map(b => ({
        key: b.key,
        title: b.title,
        markets: (b.markets || []).map(m => ({
          key: m.key, // h2h | spreads | totals
          outcomes: (m.outcomes || []).map(o => ({
            name: o.name,
            price: o.price,
            point: o.point ?? null
          }))
        }))
      }))
    }));

    res.json({ ok: true, pulled: events.length, events });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err.message });
  }
});

/**
 * GET /api/gpt/markets?sport=mlb&eventId=XXXX&markets=h2h
 */
app.get('/api/gpt/markets', async (req, res) => {
  try {
    const sport   = String(req.query.sport || '').trim();
    const eventId = String(req.query.eventId || '').trim();
    const markets = String(req.query.markets || 'h2h');

    if (!sport || !eventId) {
      return res.status(400).json({ ok: false, reason: 'Missing sport or eventId' });
    }
    if (!ODDS_API_KEY) {
      return res.status(500).json({ ok: false, reason: 'Set ODDS_API_KEY in Render env' });
    }

    const url = `${ODDS_API_BASE}/sports/${sport}/events/${eventId}/odds?` + q({
      regions: 'us',
      markets,
      oddsFormat: 'american',
      dateFormat: 'iso',
      apiKey: ODDS_API_KEY
    });

    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ ok: false, reason: `Odds API ${r.status}: ${txt}` });
    }

    const data = await r.json();
    res.json({ ok: true, eventId, data });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err.message });
  }
});

// ---------------------- Root + 404 ----------------------
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'odds-backend-gpt', root: true });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, reason: `No route: ${req.method} ${req.path}` });
});

// ---------------------- Start ----------------------
const port = process.env.PORT || 10000; // Render injects PORT
app.listen(port, () => console.log(`odds-backend-gpt listening on ${port}`));
