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
 * reviewKey 形如 `${recordId}::${strategy}::${issue}`，
 * 天然去重，POST 重复写入覆盖即可。
 */

import { kv } from '@vercel/kv';

const REVIEW_LIMIT = 1000;

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
    if (req.method === 'GET') {
      const deviceId = String(req.query.deviceId || '').trim();
      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId required' });
      }

      const keys = (await kv.smembers(`reviews:byDevice:${deviceId}`)) || [];
      if (!keys.length) {
        return res.status(200).json({ reviews: [] });
      }

      const reviews = await kv.mget(...keys.map((k) => `review:${k}`));
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

      await kv.set(`review:${key}`, enriched);
      await kv.sadd(`reviews:byDevice:${cleanDeviceId}`, key);
      // 限制 set 体积，防止长期膨胀（粗略估算，超过限制就随机裁剪）
      const size = await kv.scard(`reviews:byDevice:${cleanDeviceId}`);
      if (size > REVIEW_LIMIT) {
        // 溢出保护：超出时不再限制，去重 + 主动裁剪最旧的
        const allKeys = await kv.smembers(`reviews:byDevice:${cleanDeviceId}`);
        const overflow = allKeys.slice(REVIEW_LIMIT);
        if (overflow.length) {
          await kv.srem(`reviews:byDevice:${cleanDeviceId}`, ...overflow);
          await kv.del(...overflow.map((k) => `review:${k}`));
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
