import { Router } from 'express';
import { z } from 'zod';
import { fetchOdds } from '../services/oddsApi.js';
import { normalizeEvents } from '../services/normalize.js';

const r = Router();

const ScanQuery = z.object({
  sport: z.string().min(2),    // e.g., "mlb", "nfl"
  regions: z.string().optional().default('us'),
  markets: z.string().optional().default('h2h,spreads,totals'),
  oddsFormat: z.string().optional().default('american'),
  dateFormat: z.string().optional().default('iso'),
  limit: z.coerce.number().optional().default(10)
});

/**
 * GET /api/gpt/scan
 * Example: /api/gpt/scan?sport=mlb&limit=5
 * Returns normalized events + markets. No Telegram sends. Safe for GPT.
 */
r.get('/scan', async (req, res) => {
  try {
    const q = ScanQuery.parse(req.query);
    const raw = await fetchOdds(
      `/sports/${q.sport}/odds`,
      {
        regions: q.regions,
        markets: q.markets,
        oddsFormat: q.oddsFormat,
        dateFormat: q.dateFormat
      }
    );
    const events = normalizeEvents(raw).slice(0, q.limit);
    res.json({ ok: true, pulled: events.length, events });
  } catch (err) {
    console.error(err);
    res.status(400).json({ ok: false, reason: err.message });
  }
});

/**
 * GET /api/gpt/markets
 * Example: /api/gpt/markets?sport=mlb&eventId=abcd123&markets=h2h
 * Fetch markets for a single game.
 */
const MarketsQuery = z.object({
  sport: z.string().min(2),
  eventId: z.string().min(3),
  markets: z.string().optional().default('h2h,spreads,totals'),
  regions: z.string().optional().default('us'),
  oddsFormat: z.string().optional().default('american'),
  dateFormat: z.string().optional().default('iso')
});

r.get('/markets', async (req, res) => {
  try {
    const q = MarketsQuery.parse(req.query);
    const raw = await fetchOdds(
      `/sports/${q.sport}/events/${q.eventId}/odds`,
      {
        regions: q.regions,
        markets: q.markets,
        oddsFormat: q.oddsFormat,
        dateFormat: q.dateFormat
      }
    );
    res.json({ ok: true, eventId: q.eventId, data: raw });
  } catch (err) {
    console.error(err);
    res.status(400).json({ ok: false, reason: err.message });
  }
});

export default r;
