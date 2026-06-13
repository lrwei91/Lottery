/**
 * 读取 world cup matches snapshot (前端使用)
 * 数据来源：/api/cron/sync-matches 6h 一次写入 Redis matches:snapshot
 *
 * GET /api/matches
 *   → { metadata, groups } 完整结构 (跟 data/worldcup_matches.json 一致)
 *
 * 如果 Redis 空 (env 没配 / cron 还没跑过), 返回 503
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
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300'); // 1min client / 5min CDN
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
    const payload = await redis.get('matches:snapshot');
    if (!payload) {
      return res.status(404).json({
        error: 'No matches snapshot in Redis',
        hint: 'Vercel Cron should call /api/cron/sync-matches every 6h; or run manually with CRON_SECRET auth'
      });
    }
    return res.status(200).json(payload);
  } catch (err) {
    console.error('api/matches error:', err);
    return res.status(500).json({ error: 'internal error', message: err?.message || String(err) });
  }
}
