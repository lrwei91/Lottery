/**
 * Cloudflare Pages Functions：/api/records
 * 跨端同步「预测记录」，用 Cloudflare KV 存储，替代原 Vercel + Upstash Redis 版本。
 * 前端请求和响应格式与原接口完全一致，前端文件不需要改动。
 *
 * 需要在 Pages 项目里绑定一个 KV 命名空间，绑定变量名：SYNC_KV
 */

const RECORD_LIMIT = 200;
const MAX_BODY_BYTES = 128 * 1024;
const DEVICE_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
    },
  });
}

function isValidDeviceId(value) {
  return typeof value === 'string' && DEVICE_ID_RE.test(value.trim());
}

function bodyBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value || {})).byteLength;
}

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

function scoreFor(value) {
  const parsed = Date.parse(value?.createdAt || value?.syncedAt || '');
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function readList(kv, deviceId) {
  const raw = await kv.get(`device:${deviceId}:records`);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function onRequestGet(context) {
  const kv = context.env.SYNC_KV;
  if (!kv) return json({ error: 'KV binding SYNC_KV missing' }, 500);

  const deviceId = (new URL(context.request.url).searchParams.get('deviceId') || '').trim();
  if (!isValidDeviceId(deviceId)) return json({ error: 'valid deviceId required' }, 400);

  const records = (await readList(kv, deviceId)).slice(0, RECORD_LIMIT);
  return json({ records });
}

export async function onRequestPost(context) {
  const kv = context.env.SYNC_KV;
  if (!kv) return json({ error: 'KV binding SYNC_KV missing' }, 500);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'valid deviceId + record required' }, 400);
  }

  if (bodyBytes(body) > MAX_BODY_BYTES) return json({ error: 'request body too large' }, 413);

  const deviceId = String(body?.deviceId || '').trim();
  const record = body?.record;
  if (!isValidDeviceId(deviceId) || !isValidRecord(record)) {
    return json({ error: 'valid deviceId + record required' }, 400);
  }

  const list = await readList(kv, deviceId);
  const enriched = { ...record, deviceId, syncedAt: new Date().toISOString() };
  const map = new Map();
  for (const value of list) {
    if (value?.id) map.set(value.id, value);
  }
  map.set(enriched.id, enriched);
  const merged = Array.from(map.values())
    .sort((a, b) => scoreFor(b) - scoreFor(a))
    .slice(0, RECORD_LIMIT);

  await kv.put(`device:${deviceId}:records`, JSON.stringify(merged));
  return json({ ok: true, id: record.id });
}

export function onRequestOptions() {
  return json({ ok: true });
}
