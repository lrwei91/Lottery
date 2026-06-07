/**
 * 从 Vercel KV 读取 odds snapshot（前端使用）
 *
 * GET /api/odds/snapshots
 *   → {
 *       meta: { startedAt, finishedAt, kvEnabled, results },
 *       polymarket: {...} | null,
 *       'the-odds-api': {...} | null,
 *       'football-data': {...} | null,
 *     }
 *
 * 如果某个 key 不存在（cron 还没跑过 / 未配 env），对应字段是 null。
 */

import { Redis } from '@upstash/redis';

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({
      error: 'Upstash Redis env not configured',
      hint: 'Vercel Dashboard → Storage → Marketplace → Upstash Redis'
    });
  }

  try {
    const [meta, polymarket, theOddsApi, footballData] = await Promise.all([
      redis.get('odds:snapshot:_meta'),
      redis.get('odds:snapshot:polymarket'),
      redis.get('odds:snapshot:the-odds-api'),
      redis.get('odds:snapshot:football-data')
    ]);

    return res.status(200).json({
      meta,
      polymarket,
      'the-odds-api': theOddsApi,
      'football-data': footballData
    });
  } catch (err) {
    console.error('api/odds/snapshots error:', err);
    return res.status(500).json({ error: 'internal error', message: err?.message || String(err) });
  }
}
