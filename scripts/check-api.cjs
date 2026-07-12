#!/usr/bin/env node

const assert = require('node:assert/strict');

class MockPipeline {
  constructor(redis) {
    this.redis = redis;
    this.commands = [];
  }
  set(...args) { this.commands.push(() => this.redis.set(...args)); return this; }
  zadd(...args) { this.commands.push(() => this.redis.zadd(...args)); return this; }
  zrem(...args) { this.commands.push(() => this.redis.zrem(...args)); return this; }
  del(...args) { this.commands.push(() => this.redis.del(...args)); return this; }
  async exec() { return Promise.all(this.commands.map((command) => command())); }
}

class MockRedis {
  constructor() {
    this.values = new Map();
    this.sorted = new Map();
    this.lists = new Map();
    this.sets = new Map();
  }
  pipeline() { return new MockPipeline(this); }
  async set(key, value) { this.values.set(key, value); return 'OK'; }
  async mget(...keys) { return keys.map((key) => this.values.get(key) ?? null); }
  async zadd(key, item) {
    if (!this.sorted.has(key)) this.sorted.set(key, new Map());
    this.sorted.get(key).set(item.member, item.score);
    return 1;
  }
  async zcard(key) { return this.sorted.get(key)?.size || 0; }
  async zrange(key, start, stop, options = {}) {
    let entries = Array.from(this.sorted.get(key)?.entries() || []);
    entries.sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
    if (options.rev) entries.reverse();
    const end = stop < 0 ? entries.length + stop + 1 : stop + 1;
    return entries.slice(start, end).map(([member]) => member);
  }
  async zrem(key, ...members) {
    let removed = 0;
    for (const member of members) removed += this.sorted.get(key)?.delete(member) ? 1 : 0;
    return removed;
  }
  async del(...keys) {
    let removed = 0;
    for (const key of keys) removed += this.values.delete(key) ? 1 : 0;
    return removed;
  }
  async lrange(key, start, stop) {
    const values = this.lists.get(key) || [];
    return values.slice(start, stop + 1);
  }
  async smembers(key) { return Array.from(this.sets.get(key) || []); }
}

async function main() {
  const {
    listRecords,
    listReviews,
    makeReviewKey,
    upsertRecord,
    upsertReview
  } = await import('../api/_lib/device-sync.js');

  const redis = new MockRedis();
  const deviceA = 'device-alpha';
  const deviceB = 'device-bravo';
  const record = (id, createdAt) => ({ id, createdAt, predictions: [] });

  await upsertRecord(redis, deviceA, record('same-id', '2026-07-11T00:00:00Z'), 2);
  await upsertRecord(redis, deviceB, record('same-id', '2026-07-11T00:01:00Z'), 2);
  assert.equal((await listRecords(redis, deviceA, 2))[0].deviceId, deviceA, '跨设备记录发生覆盖');
  assert.equal((await listRecords(redis, deviceB, 2))[0].deviceId, deviceB, '跨设备记录发生覆盖');

  await upsertRecord(redis, deviceA, record('same-id', '2026-07-11T00:02:00Z'), 2);
  assert.equal((await listRecords(redis, deviceA, 2)).filter((item) => item.id === 'same-id').length, 1, '重复写入产生重复索引');

  await upsertRecord(redis, deviceA, record('second', '2026-07-11T00:03:00Z'), 2);
  await upsertRecord(redis, deviceA, record('third', '2026-07-11T00:04:00Z'), 2);
  assert.deepEqual((await listRecords(redis, deviceA, 2)).map((item) => item.id), ['third', 'second'], '记录未按时间稳定裁剪');

  redis.lists.set(`records:byDevice:${deviceA}`, ['legacy']);
  redis.values.set('record:legacy', record('legacy', '2026-07-10T00:00:00Z'));
  assert.deepEqual((await listRecords(redis, deviceA, 3)).map((item) => item.id), ['third', 'second', 'legacy'], 'v1/v2 记录未合并');

  const review = { recordId: 'third', strategy: 'gap', issue: '26077', createdAt: '2026-07-11T00:05:00Z' };
  await upsertReview(redis, deviceA, review, 2);
  await upsertReview(redis, deviceA, review, 2);
  assert.equal((await listReviews(redis, deviceA, 2)).length, 1, '复盘重复写入未去重');
  assert.equal(makeReviewKey(review), 'third::gap::26077');

  redis.sets.set(`reviews:byDevice:${deviceA}`, new Set(['legacy::cold::26076']));
  redis.values.set('review:legacy::cold::26076', {
    recordId: 'legacy', strategy: 'cold', issue: '26076', createdAt: '2026-07-10T00:00:00Z'
  });
  assert.equal((await listReviews(redis, deviceA, 2)).length, 2, 'v1/v2 复盘未合并');

  const [{ default: recordsHandler }, { default: reviewsHandler }] = await Promise.all([
    import('../api/records.js'),
    import('../api/reviews.js')
  ]);
  const invoke = async (handler, req) => {
    const response = {
      headers: {}, statusCode: 200, body: null,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }
    };
    await handler(req, response);
    return response;
  };
  assert.equal((await invoke(recordsHandler, { method: 'GET', query: { deviceId: 'bad' } })).statusCode, 400);
  assert.equal((await invoke(reviewsHandler, { method: 'POST', body: { deviceId: deviceA, review: {} } })).statusCode, 400);
  const oversized = { deviceId: deviceA, padding: 'x'.repeat(129 * 1024) };
  assert.equal((await invoke(recordsHandler, { method: 'POST', body: oversized })).statusCode, 413);

  console.log(JSON.stringify({ ok: true, scenarios: 9 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
