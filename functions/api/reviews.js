/**
 * Cloudflare Pages Functions：/api/reviews
 * 跨端同步「复盘结果」，用 Cloudflare KV 存储，替代原 Vercel + Upstash Redis 版本。
 * 前端请求和响应格式与原接口完全一致，前端文件不需要改动。
 *
 * 需要在 Pages 项目里绑定一个 KV 命名空间，绑定变量名：SYNC_KV
 */

const REVIEW_LIMIT = 1000;
const MAX_BODY_BYTES = 32 * 1024;
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

function makeReviewKey(review) {
  if (!review) return '';
  return `${review.recordId || ''}::${review.strategy || ''}::${review.issue || ''}`;
}

function isValidReview(review) {
  if (!review || typeof review !== 'object') return false;
  const key = makeReviewKey(review);
  return /^[a-zA-Z0-9-]{3,128}$/.test(String(review.recordId || ''))
    && /^[a-zA-Z0-9_-]{1,32}$/.test(String(review.strategy || ''))
    && /^\d{4,16}$/.test(String(review.issue || ''))
    && key.length <= 384;
}

function scoreFor(value) {
  const parsed = Date.parse(value?.createdAt || value?.syncedAt || '');
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function readList(kv, deviceId) {
  const raw = await kv.get(`device:${deviceId}:reviews`);
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

  const reviews = (await readList(kv, deviceId)).slice(0, REVIEW_LIMIT);
  return json({ reviews });
}

export async function onRequestPost(context) {
  const kv = context.env.SYNC_KV;
  if (!kv) return json({ error: 'KV binding SYNC_KV missing' }, 500);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'valid deviceId + review required' }, 400);
  }

  if (bodyBytes(body) > MAX_BODY_BYTES) return json({ error: 'request body too large' }, 413);

  const deviceId = String(body?.deviceId || '').trim();
  const review = body?.review;
  if (!isValidDeviceId(deviceId) || !isValidReview(review)) {
    return json({ error: 'valid deviceId + review required' }, 400);
  }

  const list = await readList(kv, deviceId);
  const enriched = { ...review, deviceId, syncedAt: new Date().toISOString() };
  const key = makeReviewKey(enriched);
  const map = new Map();
  for (const value of list) {
    const valueKey = makeReviewKey(value);
    if (valueKey) map.set(valueKey, value);
  }
  map.set(key, enriched);
  const merged = Array.from(map.values())
    .sort((a, b) => scoreFor(b) - scoreFor(a))
    .slice(0, REVIEW_LIMIT);

  await kv.put(`device:${deviceId}:reviews`, JSON.stringify(merged));
  return json({ ok: true, key });
}

export function onRequestOptions() {
  return json({ ok: true });
}
