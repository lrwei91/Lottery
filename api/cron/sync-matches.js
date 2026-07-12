/**
 * 兼容入口：世界杯实时赛程由 daily sync-odds cron 统一刷新。
 * 此路由保留给已有手动调用方，内部复用同一份 FIFA 标准化实现。
 */

import { getRedis } from '../_lib/redis.js';
import { setCors } from '../_lib/http.js';
import {
  fetchFifaMatchesSnapshot,
  MATCHES_SNAPSHOT_KEY,
  MATCHES_SNAPSHOT_TTL_SECONDS
} from '../_lib/worldcup-matches.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  if ((req.headers?.authorization || '') !== `Bearer ${expected}`) return res.status(401).json({ error: 'Unauthorized' });

  const redis = getRedis({ required: false });
  if (!redis) return res.status(503).json({ error: 'Upstash Redis env not configured' });

  const startedAt = new Date().toISOString();
  try {
    const payload = await fetchFifaMatchesSnapshot();
    await redis.set(MATCHES_SNAPSHOT_KEY, payload, { ex: MATCHES_SNAPSHOT_TTL_SECONDS });
    return res.status(200).json({
      ok: true,
      meta: {
        startedAt,
        finishedAt: new Date().toISOString(),
        matchCount: payload.metadata.matchCount,
        h2hOk: payload.metadata.h2hAttached,
        h2hFail: payload.metadata.h2hFailed
      }
    });
  } catch (error) {
    console.error('[sync-matches] failed:', error);
    return res.status(500).json({ ok: false, error: 'sync failed', startedAt, finishedAt: new Date().toISOString() });
  }
}
