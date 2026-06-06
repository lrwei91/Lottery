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
 * 存储结构（Vercel KV / Upstash Redis）：
 *   record:{recordId}              → JSON(record)
 *   records:byDevice:{deviceId}    → LIST<recordId>  (ltrim 200)
 */

import { kv } from '@vercel/kv';

const RECORD_LIMIT = 200;

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
    if (req.method === 'GET') {
      const deviceId = String(req.query.deviceId || '').trim();
      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId required' });
      }

      const ids = (await kv.lrange(`records:byDevice:${deviceId}`, 0, RECORD_LIMIT - 1)) || [];
      if (!ids.length) {
        return res.status(200).json({ records: [] });
      }

      const records = await kv.mget(...ids.map((id) => `record:${id}`));
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

      await kv.set(`record:${record.id}`, enriched);
      await kv.lpush(`records:byDevice:${cleanDeviceId}`, record.id);
      await kv.ltrim(`records:byDevice:${cleanDeviceId}`, 0, RECORD_LIMIT - 1);

      return res.status(200).json({ ok: true, id: record.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/records error:', err);
    return res.status(500).json({ error: 'internal error', message: err?.message || String(err) });
  }
}
