import { getRedis } from './_lib/redis.js';
import { bodySize, internalError, isValidDeviceId, setCors } from './_lib/http.js';
import { listReviews, makeReviewKey, upsertReview } from './_lib/device-sync.js';

const REVIEW_LIMIT = 1000;
const MAX_BODY_BYTES = 32 * 1024;

function isValidReview(review) {
  if (!review || typeof review !== 'object') return false;
  const key = makeReviewKey(review);
  return /^[a-zA-Z0-9-]{3,128}$/.test(String(review.recordId || ''))
    && /^[a-zA-Z0-9_-]{1,32}$/.test(String(review.strategy || ''))
    && /^\d{4,16}$/.test(String(review.issue || ''))
    && key.length <= 384;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });

  try {
    if (req.method === 'GET') {
      const deviceId = String(req.query.deviceId || '').trim();
      if (!isValidDeviceId(deviceId)) return res.status(400).json({ error: 'valid deviceId required' });
      const redis = getRedis();
      return res.status(200).json({ reviews: await listReviews(redis, deviceId, REVIEW_LIMIT) });
    }

    if (req.method === 'POST') {
      if (bodySize(req.body) > MAX_BODY_BYTES) return res.status(413).json({ error: 'request body too large' });
      const { deviceId: rawDeviceId, review } = req.body || {};
      const deviceId = String(rawDeviceId || '').trim();
      if (!isValidDeviceId(deviceId) || !isValidReview(review)) {
        return res.status(400).json({ error: 'valid deviceId + review required' });
      }
      const redis = getRedis();
      const { key } = await upsertReview(redis, deviceId, review, REVIEW_LIMIT);
      return res.status(200).json({ ok: true, key });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return internalError(res, 'api/reviews error:', error);
  }
}
