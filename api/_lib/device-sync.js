const V1_RECORD_LIMIT = 200;
const V1_REVIEW_LIMIT = 1000;

function recordIndexKey(deviceId) {
  return `device:${deviceId}:records`;
}

function recordObjectKey(deviceId, recordId) {
  return `device:${deviceId}:record:${recordId}`;
}

function reviewIndexKey(deviceId) {
  return `device:${deviceId}:reviews`;
}

function reviewObjectKey(deviceId, key) {
  return `device:${deviceId}:review:${key}`;
}

export function makeReviewKey(review) {
  if (!review) return '';
  return `${review.recordId || ''}::${review.strategy || ''}::${review.issue || ''}`;
}

function scoreFor(value) {
  const parsed = Date.parse(value?.createdAt || value?.syncedAt || '');
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sortNewest(items) {
  return items.sort((a, b) => scoreFor(b) - scoreFor(a));
}

async function trimSortedIndex(redis, indexKey, objectKeyFor, limit) {
  const size = await redis.zcard(indexKey);
  const overflowCount = size - limit;
  if (overflowCount <= 0) return;
  const members = await redis.zrange(indexKey, 0, overflowCount - 1);
  if (!members.length) return;
  const pipeline = redis.pipeline();
  pipeline.zrem(indexKey, ...members);
  pipeline.del(...members.map(objectKeyFor));
  await pipeline.exec();
}

async function readObjects(redis, keys) {
  if (!keys.length) return [];
  const values = await redis.mget(...keys);
  return values.filter(Boolean);
}

function mergeUnique(primary, legacy, identity, limit) {
  const merged = new Map();
  for (const value of [...primary, ...legacy]) {
    const key = identity(value);
    if (key && !merged.has(key)) merged.set(key, value);
  }
  return sortNewest(Array.from(merged.values())).slice(0, limit);
}

export async function listRecords(redis, deviceId, limit = V1_RECORD_LIMIT) {
  const ids = await redis.zrange(recordIndexKey(deviceId), 0, limit - 1, { rev: true });
  const current = await readObjects(redis, ids.map((id) => recordObjectKey(deviceId, id)));

  const legacyIds = (await redis.lrange(`records:byDevice:${deviceId}`, 0, V1_RECORD_LIMIT - 1)) || [];
  const legacy = await readObjects(redis, legacyIds.map((id) => `record:${id}`));
  return mergeUnique(current, legacy, (record) => record?.id, limit);
}

export async function upsertRecord(redis, deviceId, record, limit = V1_RECORD_LIMIT) {
  const enriched = { ...record, deviceId, syncedAt: new Date().toISOString() };
  const indexKey = recordIndexKey(deviceId);
  const pipeline = redis.pipeline();
  pipeline.set(recordObjectKey(deviceId, record.id), enriched);
  pipeline.zadd(indexKey, { score: scoreFor(enriched), member: record.id });
  await pipeline.exec();
  await trimSortedIndex(redis, indexKey, (id) => recordObjectKey(deviceId, id), limit);
  return enriched;
}

export async function listReviews(redis, deviceId, limit = V1_REVIEW_LIMIT) {
  const keys = await redis.zrange(reviewIndexKey(deviceId), 0, limit - 1, { rev: true });
  const current = await readObjects(redis, keys.map((key) => reviewObjectKey(deviceId, key)));

  const legacyKeys = (await redis.smembers(`reviews:byDevice:${deviceId}`)) || [];
  const legacy = await readObjects(redis, legacyKeys.map((key) => `review:${key}`));
  return mergeUnique(current, legacy, makeReviewKey, limit);
}

export async function upsertReview(redis, deviceId, review, limit = V1_REVIEW_LIMIT) {
  const key = makeReviewKey(review);
  const enriched = { ...review, deviceId, syncedAt: new Date().toISOString() };
  const indexKey = reviewIndexKey(deviceId);
  const pipeline = redis.pipeline();
  pipeline.set(reviewObjectKey(deviceId, key), enriched);
  pipeline.zadd(indexKey, { score: scoreFor(enriched), member: key });
  await pipeline.exec();
  await trimSortedIndex(redis, indexKey, (member) => reviewObjectKey(deviceId, member), limit);
  return { key, enriched };
}
