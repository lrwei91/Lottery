#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadBrowserScripts() {
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    Set,
    Map,
    Array,
    Number,
    String,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  for (const rel of ['js/dlt-conformal.js', 'js/predictor-config.js', 'js/predictor.js']) {
    const filename = path.join(root, rel);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  }
  return sandbox.window;
}

function seededRng(seed = 26070) {
  let state = seed >>> 0;
  return function rng() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function drawKey(front, back) {
  return `${front.slice().sort((a, b) => a - b).join(',')}+${back.slice().sort((a, b) => a - b).join(',')}`;
}

function assertUniqueSortedRange(nums, count, min, max, label) {
  assert(Array.isArray(nums), `${label} 必须是数组`);
  assert(nums.length === count, `${label} 数量应为 ${count}，实际 ${nums.length}`);
  const sorted = nums.slice().sort((a, b) => a - b);
  assert(nums.every((n, i) => n === sorted[i]), `${label} 必须升序排列`);
  assert(new Set(nums).size === nums.length, `${label} 不能重复`);
  assert(nums.every(n => Number.isInteger(n) && n >= min && n <= max), `${label} 超出范围 ${min}-${max}`);
}

function main() {
  const globals = loadBrowserScripts();
  const { Predictor, DltConformal } = globals;
  assert(Predictor, 'Predictor 未加载');
  assert(DltConformal, 'DltConformal 未加载');

  const payload = JSON.parse(fs.readFileSync(path.join(root, 'data/lottery_data.json'), 'utf8'));
  const data = payload.data;
  assert(Array.isArray(data) && data.length >= 10, '大乐透数据不足');

  const report = DltConformal.predictAll(data, {
    frontMin: 1,
    frontMax: 35,
    backMin: 1,
    backMax: 12
  });
  assert(report.empiricalCoverage >= 0.85, `Conformal 校准覆盖率过低：${report.empiricalCoverage}`);
  assert(report.front.some(r => r.stabilityScore >= 0.75), '前区没有稳定性高的号码');
  assert(report.front.some(r => r.stabilityScore <= 0.35), '前区没有稳定性低的号码，信号缺少区分度');

  const predictions = Predictor.generateMultiplePredictions(data, 5, { rng: seededRng() });
  assert(predictions.length === 5, `应生成 5 注，实际 ${predictions.length}`);

  const historyKeys = new Set(data.map(d => drawKey(d.front, d.back || [])));
  const predictionKeys = new Set();
  const confidenceSet = new Set(['high', 'balanced', 'aggressive']);
  for (const [idx, prediction] of predictions.entries()) {
    assertUniqueSortedRange(prediction.front, 5, 1, 35, `第 ${idx + 1} 注前区`);
    assertUniqueSortedRange(prediction.back, 2, 1, 12, `第 ${idx + 1} 注后区`);
    const key = drawKey(prediction.front, prediction.back);
    assert(!predictionKeys.has(key), `第 ${idx + 1} 注与前面预测重复`);
    assert(!historyKeys.has(key), `第 ${idx + 1} 注与历史开奖完全重复`);
    predictionKeys.add(key);
    assert(confidenceSet.has(prediction.confidence), `第 ${idx + 1} 注置信度无效`);
    assert(typeof prediction.minScore === 'number', `第 ${idx + 1} 注缺少 minScore`);
    assert(prediction.reasoning.includes('conformal'), `第 ${idx + 1} 注说明缺少 conformal 信号`);
  }

  console.log(JSON.stringify({
    ok: true,
    latestIssue: data[0].issue,
    total: data.length,
    conformalCoverage: report.empiricalCoverage,
    qhat: report.qhat,
    predictions: predictions.map(p => ({
      strategy: p.strategy,
      confidence: p.confidence,
      minScore: p.minScore,
      front: p.front,
      back: p.back
    }))
  }, null, 2));
}

main();
