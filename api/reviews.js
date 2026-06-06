/**
 * 复盘结果云端同步 API
 *
 * GET  /api/reviews?deviceId=xxx
 *   → { reviews: [...] }
 *
 * POST /api/reviews
 *   body: { deviceId, review }
 *   → { ok: true, key }
 *
 * 存储结构：
 *   review:{recordId}:{strategy}:{issue}  → JSON(review)
 *   reviews:byDevice:{deviceId}           → SET<reviewKey>
 *
 * reviewKey 形如 `${recordId}::${strategy}::${issue}`，天然去重。
 */

import { Redis } from '@upstash/redis';

const REVIEW_LIMIT = 1000;
let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    throw new Error('Upstash Redis 环境变量未配置（请在 Vercel Dashboard → Storage 装 Upstash Redis integration）');
  }
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function reviewKey(review) {
  if (!review) return '';
  return `${review.recordId || ''}::${review.strategy || ''}::${review.issue || ''}`;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  try {
    const redis = getRedis();

    if (req.method === 'GET') {
      const deviceId = String(req.query.deviceId || '').trim();
      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId required' });
      }

      const keys = (await redis.smembers(`reviews:byDevice:${deviceId}`)) || [];
      if (!keys.length) {
        return res.status(200).json({ reviews: [] });
      }

      const reviews = await redis.mget(...keys.map((k) => `review:${k}`));
      return res.status(200).json({
        reviews: reviews.filter(Boolean),
      });
    }

    if (req.method === 'POST') {
      const { deviceId, review } = req.body || {};
      const cleanDeviceId = String(deviceId || '').trim();
      if (!cleanDeviceId || !review) {
        return res.status(400).json({ error: 'deviceId + review required' });
      }

      const key = reviewKey(review);
      if (!key || key === '::') {
        return res.status(400).json({ error: 'review.recordId / strategy / issue required' });
      }

      const enriched = {
        ...review,
        deviceId: cleanDeviceId,
        syncedAt: new Date().toISOString(),
      };

      const pipeline = redis.pipeline();
      pipeline.set(`review:${key}`, enriched);
      pipeline.sadd(`reviews:byDevice:${cleanDeviceId}`, key);
      await pipeline.exec();

      // 溢出保护（set 长期膨胀时裁剪最旧项）
      const size = await redis.scard(`reviews:byDevice:${cleanDeviceId}`);
      if (size > REVIEW_LIMIT) {
        const allKeys = await redis.smembers(`reviews:byDevice:${cleanDeviceId}`);
        const overflow = allKeys.slice(REVIEW_LIMIT);
        if (overflow.length) {
          const cleanup = redis.pipeline();
          cleanup.srem(`reviews:byDevice:${cleanDeviceId}`, ...overflow);
          cleanup.del(...overflow.map((k) => `review:${k}`));
          await cleanup.exec();
        }
      }

      return res.status(200).json({ ok: true, key });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/reviews error:', err);
    return res.status(500).json({ error: 'internal error', message: err?.message || String(err) });
  }
}
