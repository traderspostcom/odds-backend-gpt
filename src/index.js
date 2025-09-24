import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { validateEnv } from './util/env.js';
import healthRouter from './routes/health.js';
import gptRouter from './routes/gpt.js';

validateEnv();

const app = express();
app.use(cors({ origin: '*', maxAge: 600 }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// Simple API key gate for GPT Actions (optional but recommended)
app.use((req, res, next) => {
  const required = process.env.PUBLIC_API_KEY;
  if (!required) return next();
  const key = req.header('x-api-key');
  if (key !== required) return res.status(401).json({ ok: false, reason: 'unauthorized' });
  next();
});

app.use('/api/health', healthRouter);
app.use('/api/gpt', gptRouter);  // read-only endpoints for GPT

app.get('/', (req, res) => res.json({ ok: true, service: process.env.SERVICE_NAME || 'odds-backend-gpt' }));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`odds-backend-gpt listening on ${port}`));
