import NodeCache from 'node-cache';
export const cache = new NodeCache({ stdTTL: Number(process.env.CACHE_TTL_SECONDS || 30) });
