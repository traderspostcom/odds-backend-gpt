import { request } from 'undici';

const BASE = process.env.ODDS_API_BASE || "https://odds-backend-gpt.onrender.com";
const KEY  = process.env.ODDS_API_KEY;

export default async function health(req, res) {
  try {
    // Call backend health endpoint with Authorization header
    const { body, statusCode } = await request(`${BASE}/health`, {
      method: 'GET',
      headers: {
        "Authorization": `Bearer ${KEY}`,
        "Content-Type": "application/json"
      }
    });

    let backend = {};
    try {
      backend = await body.json();
    } catch {
      backend = { raw: await body.text() };
    }

    const result = {
      service: "odds-backend-gpt",
      status: "ok",
      backendStatus: statusCode,
      backend,
    };

    console.log("✅ Health check:", result);
    res.status(200).json(result);

  } catch (err) {
    console.error("❌ Health check failed:", err.message);
    res.status(500).json({ status: "error", error: err.message });
  }
}
