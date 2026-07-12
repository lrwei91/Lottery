import { getRedis } from './_lib/redis.js';
import { bodySize, internalError, isValidDeviceId, setCors } from './_lib/http.js';
import { listRecords, upsertRecord } from './_lib/device-sync.js';

const RECORD_LIMIT = 200;
const MAX_BODY_BYTES = 128 * 1024;

function isValidRecord(record) {
  const validPrediction = (prediction) => prediction
    && typeof prediction === 'object'
    && typeof prediction.strategy === 'string'
    && prediction.strategy.length <= 32
    && Array.isArray(prediction.front)
    && prediction.front.length <= 5
    && prediction.front.every(Number.isInteger)
    && Array.isArray(prediction.back || [])
    && (prediction.back || []).length <= 2
    && (prediction.back || []).every(Number.isInteger);
  return !!record
    && typeof record === 'object'
    && typeof record.id === 'string'
    && /^[a-zA-Z0-9-]{3,128}$/.test(record.id)
    && ['dlt', 'pl3'].includes(record.type)
    && Array.isArray(record.predictions)
    && record.predictions.length >= 1
    && record.predictions.length <= 20
    && record.predictions.every(validPrediction);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });

  try {
    if (req.method === 'GET') {
      const deviceId = String(req.query.deviceId || '').trim();
      if (!isValidDeviceId(deviceId)) return res.status(400).json({ error: 'valid deviceId required' });
      const redis = getRedis();
      return res.status(200).json({ records: await listRecords(redis, deviceId, RECORD_LIMIT) });
    }

    if (req.method === 'POST') {
      if (bodySize(req.body) > MAX_BODY_BYTES) return res.status(413).json({ error: 'request body too large' });
      const { deviceId: rawDeviceId, record } = req.body || {};
      const deviceId = String(rawDeviceId || '').trim();
      if (!isValidDeviceId(deviceId) || !isValidRecord(record)) {
        return res.status(400).json({ error: 'valid deviceId + record required' });
      }
      const redis = getRedis();
      await upsertRecord(redis, deviceId, record, RECORD_LIMIT);
      return res.status(200).json({ ok: true, id: record.id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return internalError(res, 'api/records error:', error);
  }
}
