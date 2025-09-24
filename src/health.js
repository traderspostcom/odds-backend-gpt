import { Router } from 'express';
const r = Router();

r.get('/', (req, res) => {
  res.json({
    ok: true,
    service: process.env.SERVICE_NAME || 'odds-backend-gpt',
    env: process.env.NODE_ENV,
  });
});

export default r;
