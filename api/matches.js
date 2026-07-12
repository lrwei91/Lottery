/**
 * 读取 world cup matches snapshot (前端使用)
 * 数据来源：daily /api/cron/sync-odds 写入 Redis matches:snapshot
 *
 * GET /api/matches
 *   → { metadata, groups } 完整结构 (跟 data/worldcup_matches.json 一致)
 *
 * 如果 Redis 空 (env 没配 / cron 还没跑过), 返回 503
 */

import { getRedis } from './_lib/redis.js';
import { internalError, setCors } from './_lib/http.js';
import { MATCHES_SNAPSHOT_KEY } from './_lib/worldcup-matches.js';

export default async function handler(req, res) {
  setCors(res);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const redis = getRedis({ required: false });
  if (!redis) {
    return res.status(503).json({
      error: 'Upstash Redis env not configured',
      hint: 'Vercel Dashboard → Storage → Marketplace → Upstash Redis'
    });
  }

  try {
    const payload = await redis.get(MATCHES_SNAPSHOT_KEY);
    if (!payload) {
      return res.status(404).json({
        error: 'No matches snapshot in Redis',
        hint: 'The daily Vercel sync-odds cron has not produced a snapshot yet.'
      });
    }
    return res.status(200).json(payload);
  } catch (error) {
    return internalError(res, 'api/matches error:', error);
  }
}
