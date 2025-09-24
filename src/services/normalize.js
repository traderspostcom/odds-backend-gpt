export function normalizeEvents(rawEvents) {
  return rawEvents.map(e => ({
    id: e.id || e.game_id || e.event_id,
    sport_key: e.sport_key || e.sportKey,
    commence_time: e.commence_time,
    home: e.home_team,
    away: e.away_team,
    bookmakers: (e.bookmakers || []).map(b => ({
      key: b.key,
      title: b.title,
      markets: (b.markets || []).map(m => ({
        key: m.key, // h2h, spreads, totals
        outcomes: (m.outcomes || []).map(o => ({
          name: o.name,
          price: o.price,
          point: o.point ?? null
        }))
      }))
    }))
  }));
}
