/**
 * 读赔率历史快照列表（前端 modal 趋势用）
 *
 * GET /api/odds/history?source=the-odds-api
 *   → {
 *       source: 'the-odds-api',
 *       history: [
 *         { fetchedAt, eventCount, events: [...] },
 *         ...
 *       ]   // 最新在前，最多 28 个点
 *     }
 *
 * 数据由 /api/cron/sync-odds 在每次 the-odds-api 拉取后追加（保留约 35 天 TTL）。
 */

import { getRedis } from '../_lib/redis.js';
import { internalError, setCors } from '../_lib/http.js';

const SUPPORTED = new Set(['the-odds-api']);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const source = (req.query?.source || 'the-odds-api').toLowerCase();
  if (!SUPPORTED.has(source)) {
    return res.status(400).json({ error: `Unsupported source: ${source}. Supported: ${[...SUPPORTED].join(', ')}` });
  }

  const redis = getRedis({ required: false });
  if (!redis) {
    return res.status(503).json({ error: 'Upstash Redis env not configured' });
  }

  try {
    const list = await redis.lrange(`odds:history:${source}`, 0, -1);
    return res.status(200).json({ source, count: list.length, history: list });
  } catch (error) {
    return internalError(res, 'api/odds/history error:', error);
  }
}
