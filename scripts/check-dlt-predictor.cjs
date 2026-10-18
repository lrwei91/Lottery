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
  const expectedStrategies = ['gap', 'cold', 'random', 'balanced', 'hot'];
  const actualStrategies = predictions.map(prediction => prediction.strategy);
  assert(
    new Set(actualStrategies).size === expectedStrategies.length
      && expectedStrategies.every(strategy => actualStrategies.includes(strategy)),
    `五注策略集合异常：${actualStrategies.join(',')}`
  );

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
    assert(prediction.meta.frontConstraintMode === 'filter', '默认应恢复原有训练形态过滤');
    assert(prediction.reasoning.includes('conformal'), `第 ${idx + 1} 注说明缺少 conformal 信号`);
  }

  const expectedBackStrategies = ['random', 'balanced', 'random', 'balanced', 'random'];
  assert(
    predictions.every((prediction, index) => prediction.meta && prediction.meta.backStrategy === expectedBackStrategies[index]),
    '五注后区未按独立回测后的策略分配生成'
  );

  // 默认恢复跨注分散；不可行时生成器可逐级放宽，使用保守并集下限回归。
  const frontUnion = new Set(predictions.flatMap(prediction => prediction.front)).size;
  const backUnion = new Set(predictions.flatMap(prediction => prediction.back)).size;
  assert(frontUnion >= 22, `默认五注前区分散不足：${frontUnion}`);
  assert(backUnion >= 8, `默认五注后区分散不足：${backUnion}`);
  let offAllowsFrontOverlap = false;
  let offAllowsBackOverlap = false;

  // 五注覆盖回归：不同随机种子下不应出现完全相同的后区对子。
  for (let seed = 0; seed < 32; seed += 1) {
    const batch = Predictor.generateMultiplePredictions(data, 5, { rng: seededRng(seed) });
    const batchStrategies = batch.map(prediction => prediction.strategy);
    assert(
      new Set(batchStrategies).size === expectedStrategies.length
        && expectedStrategies.every(strategy => batchStrategies.includes(strategy)),
      `seed=${seed} 五注策略集合异常：${batchStrategies.join(',')}`
    );
    const backKeys = batch.map(prediction => prediction.back.join(','));
    assert(new Set(backKeys).size === backKeys.length, `seed=${seed} 出现重复后区对子`);
    const batchFrontUnion = new Set(batch.flatMap(prediction => prediction.front)).size;
    const batchBackUnion = new Set(batch.flatMap(prediction => prediction.back)).size;
    assert(batchFrontUnion >= 22, `seed=${seed} 默认前区分散不足：${batchFrontUnion}`);
    assert(batchBackUnion >= 8, `seed=${seed} 默认后区分散不足：${batchBackUnion}`);
    const offBatch = Predictor.generateMultiplePredictions(data, 5, { rng: seededRng(seed), spreadEnforcement: 'off' });
    offAllowsFrontOverlap ||= new Set(offBatch.flatMap(p => p.front)).size < 22;
    offAllowsBackOverlap ||= new Set(offBatch.flatMap(p => p.back)).size < 8;
    for (const prediction of batch) {
      assertUniqueSortedRange(prediction.front, 5, 1, 35, `seed=${seed} 前区`);
      assertUniqueSortedRange(prediction.back, 2, 1, 12, `seed=${seed} 后区`);
      assert(!historyKeys.has(drawKey(prediction.front, prediction.back)), `seed=${seed} 与历史开奖完全重复`);
    }
  }

  assert(offAllowsFrontOverlap && offAllowsBackOverlap, '关闭分散的对照选项失效');

  // 观察模式保留为显式实验选项，验证它与默认过滤模式的边界。
  const scoreBundle = Predictor.computeScores(data);
  const context = {
    ...scoreBundle,
    type: 'dlt', params: Predictor.getParams('dlt'),
    exactDrawSet: new Set(),
    frontConstraints: { sumMin: 1000, sumMax: 2000, maxConsecutive: 0, minAC: 99, minZonesCovered: 99, maxTailPairs: 0 },
    backConstraints: { sumMin: 0, sumMax: 24, diffMin: 1, diffMax: 11 }
  };
  const extreme = Predictor.generatePrediction(data, 'gap', { context, rng: () => 0.0001, frontConstraintMode: 'observe' });
  assert(extreme.front.join(',') === '1,2,3,4,5', '合法极端形态仍被过滤');
  assert(extreme.meta.frontConstraintMode === 'observe', '缺少结构观察标记');
  assert(extreme.reasoning.includes('仅观察，不过滤'), '结构说明与实际执行不一致');
  let rejected = false;
  try {
    Predictor.generatePrediction(data, 'gap', { context, rng: () => 0.0001, frontConstraintMode: 'filter' });
  } catch (error) { rejected = error.message.includes('重试预算耗尽'); }
  assert(rejected, '显式过滤模式不应返回未经校验的兜底号码');
  rejected = false;
  try {
    Predictor.generatePrediction(data, 'gap', { context: { ...context, exactDrawSet: { has: () => true } }, rng: () => 0.0001 });
  } catch (error) { rejected = error.message.includes('重试预算耗尽'); }
  assert(rejected, '历史完全重复号码不能通过兜底返回');


  console.log(JSON.stringify({
    ok: true,
    latestIssue: data[0].issue,
    total: data.length,
    conformalCoverage: report.empiricalCoverage,
    qhat: report.qhat,
    frontUnion,
    backUnion,
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
