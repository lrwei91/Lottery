#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf8'));
}

function assertIntegersInRange(values, count, min, max, label, unique, sorted) {
  assert(Array.isArray(values) && values.length === count, `${label} 数量应为 ${count}`);
  assert(values.every((value) => Number.isInteger(value) && value >= min && value <= max), `${label} 超出范围 ${min}-${max}`);
  if (unique) assert(new Set(values).size === values.length, `${label} 存在重复号码`);
  if (sorted) assert(values.every((value, index) => index === 0 || values[index - 1] < value), `${label} 必须严格升序`);
}

function validateLottery(filename, config) {
  const payload = readJson(filename);
  assert(Array.isArray(payload.data) && payload.data.length > 0, `${filename} data 不能为空`);
  assert(payload.total === payload.data.length, `${filename} total 与 data.length 不一致`);
  assert(typeof payload.source === 'string' && payload.source.trim(), `${filename} 缺少 source`);
  assert(!Number.isNaN(Date.parse(payload.updateTime)), `${filename} updateTime 无效`);

  const issues = new Set();
  for (const [index, draw] of payload.data.entries()) {
    const label = `${filename} 第 ${index + 1} 条`;
    assert(typeof draw.issue === 'string' && /^\d+$/.test(draw.issue), `${label} issue 无效`);
    assert(!issues.has(draw.issue), `${filename} 期号重复：${draw.issue}`);
    issues.add(draw.issue);
    assert(typeof draw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(draw.date), `${label} date 无效`);
    assertIntegersInRange(draw.front, config.frontCount, config.frontMin, config.frontMax, `${label} 前区`, config.frontUnique, config.frontSorted);
    const back = draw.back || [];
    assertIntegersInRange(back, config.backCount, config.backMin, config.backMax, `${label} 后区`, true, true);
  }
  return payload.data.length;
}

function validateWorldCupMatches() {
  const payload = readJson('worldcup_matches.json');
  assert(payload.metadata?.generatedBy === 'scripts/sync_worldcup_matches.py', 'worldcup_matches.json canonical writer 标记错误');
  assert(payload.groups && typeof payload.groups === 'object', 'worldcup_matches.json 缺少 groups');
  const ids = new Set();
  let count = 0;
  const collections = Object.entries(payload.groups).map(([name, group]) => [`分组 ${name}`, group.matches]);
  for (const [stage, matches] of Object.entries(payload.knockout || {})) {
    collections.push([`淘汰赛 ${stage}`, matches]);
  }
  for (const [label, matches] of collections) {
    assert(Array.isArray(matches), `世界杯${label} matches 无效`);
    for (const match of matches) {
      assert(match.id && !ids.has(match.id), `世界杯比赛 ID 缺失或重复：${match.id || '(empty)'}`);
      ids.add(match.id);
      assert(typeof match.home === 'string' && typeof match.away === 'string', `世界杯比赛 ${match.id} 队名无效`);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(match.date), `世界杯比赛 ${match.id} 日期无效`);
      assert(/^\d{2}:\d{2}$/.test(match.time), `世界杯比赛 ${match.id} 时间无效`);
      count += 1;
    }
  }
  assert(payload.metadata.matchCount === count, 'worldcup_matches.json metadata.matchCount 不一致');
  return count;
}

for (const filename of fs.readdirSync(dataDir).filter((name) => name.endsWith('.json'))) readJson(filename);

const dlt = validateLottery('lottery_data.json', {
  frontCount: 5, frontMin: 1, frontMax: 35, frontUnique: true, frontSorted: true,
  backCount: 2, backMin: 1, backMax: 12
});
const pl3 = validateLottery('pl3_data.json', {
  frontCount: 3, frontMin: 0, frontMax: 9, frontUnique: false, frontSorted: false,
  backCount: 0, backMin: 1, backMax: 0
});
const worldCupMatches = validateWorldCupMatches();

console.log(JSON.stringify({ ok: true, dlt, pl3, worldCupMatches }));
