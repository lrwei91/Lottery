/**
 * 预测记录云端同步 API
 *
 * GET  /api/records?deviceId=xxx
 *   → { records: [...] }
 *
 * POST /api/records
 *   body: { deviceId, record }
 *   → { ok: true, id }
 *
 * 存储结构（Upstash Redis / Vercel Marketplace Upstash Redis integration）：
 *   record:{recordId}              → JSON(record)
 *   records:byDevice:{deviceId}    → LIST<recordId>  (LTRIM 200)
 *
 * 环境变量（Vercel Marketplace 装 Upstash Redis 后自动注入）：
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { Redis } from '@upstash/redis';

const RECORD_LIMIT = 200;
let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  // 兼容 Vercel Marketplace Upstash Redis（新）和老的 Vercel KV（即将下线）两种环境变量名
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error('Upstash Redis 环境变量未配置（请在 Vercel Dashboard → Storage 装/连 Upstash Redis）');
  }
  _redis = new Redis({ url, token });
  return _redis;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

      const ids = (await redis.lrange(`records:byDevice:${deviceId}`, 0, RECORD_LIMIT - 1)) || [];
      if (!ids.length) {
        return res.status(200).json({ records: [] });
      }

      const records = await redis.mget(...ids.map((id) => `record:${id}`));
      return res.status(200).json({
        records: records.filter(Boolean),
      });
    }

    if (req.method === 'POST') {
      const { deviceId, record } = req.body || {};
      const cleanDeviceId = String(deviceId || '').trim();
      if (!cleanDeviceId || !record || !record.id) {
        return res.status(400).json({ error: 'deviceId + record.id required' });
      }

      const enriched = {
        ...record,
        deviceId: cleanDeviceId,
        syncedAt: new Date().toISOString(),
      };

      // pipeline：减少一次 round-trip
      const pipeline = redis.pipeline();
      pipeline.set(`record:${record.id}`, enriched);
      pipeline.lpush(`records:byDevice:${cleanDeviceId}`, record.id);
      pipeline.ltrim(`records:byDevice:${cleanDeviceId}`, 0, RECORD_LIMIT - 1);
      await pipeline.exec();

      return res.status(200).json({ ok: true, id: record.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/records error:', err);
    return res.status(500).json({ error: 'internal error', message: err?.message || String(err) });
  }
}
