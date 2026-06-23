// api/wishes.js
// Serverless function (runs on Vercel) that stores birthday wishes in
// Upstash Redis (via Vercel's KV/Marketplace integration) so they persist
// across visits/devices.
//
// Vercel's KV/Upstash integration sets these env vars automatically when
// you connect a database in the Storage tab:
//   KV_REST_API_URL
//   KV_REST_API_TOKEN
// (Falls back to UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN too, in
// case you connected Upstash directly instead of through Vercel KV.)

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const WISH_KEY = 'birthday:wishes';
const MAX_WISHES = 200; // keep the log from growing forever

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash error ${res.status}: ${text}`);
  }
  return res.json();
}

function sanitize(str, maxLen) {
  return String(str || '')
    .trim()
    .slice(0, maxLen)
    .replace(/[<>]/g, ''); // strip angle brackets to avoid HTML injection in the dialogue boxes
}

module.exports = async (req, res) => {
  // Basic CORS so this also works if you preview the HTML from a different origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(500).json({
      error:
        'Storage is not configured yet. Connect a database in Vercel (Storage tab) so KV_REST_API_URL and KV_REST_API_TOKEN get set, then redeploy.',
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      // LRANGE birthday:wishes 0 -1  -> returns all stored wishes, oldest first
      const { result } = await redis(['LRANGE', WISH_KEY, '0', '-1']);
      const wishes = (result || []).map((item) => JSON.parse(item)).reverse();
      res.status(200).json({ wishes });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      body = body || {};

      const name = sanitize(body.name, 24) || 'Anonymous';
      const text = sanitize(body.text, 220);

      if (!text) {
        res.status(400).json({ error: 'Wish text is required.' });
        return;
      }

      const wish = {
        name,
        text,
        createdAt: new Date().toISOString(),
      };

      // LPUSH so newest is always at index 0, then trim so the list can't grow unbounded
      await redis(['LPUSH', WISH_KEY, JSON.stringify(wish)]);
      await redis(['LTRIM', WISH_KEY, '0', String(MAX_WISHES - 1)]);

      res.status(201).json({ wish });
      return;
    }

    res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
};