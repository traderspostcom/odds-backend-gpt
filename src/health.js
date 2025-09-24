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

{
  "name": "odds-backend-gpt",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.js",
  "scripts": { "start": "node src/index.js" },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "morgan": "^1.10.0"
  }
}
