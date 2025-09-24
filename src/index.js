import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
app.use(cors({ origin: '*'}));
app.use(morgan('tiny'));

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'odds-backend-gpt', root: true });
});

// HEALTH (no auth, explicit path)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'odds-backend-gpt',
    env: process.env.NODE_ENV || 'dev',
    time: new Date().toISOString()
  });
});

// 404 helper so you never see a blank "Not Found"
app.use((req, res) => {
  res.status(404).json({ ok: false, reason: `No route: ${req.method} ${req.path}` });
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`listening on ${port}`));
