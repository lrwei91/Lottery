#!/usr/bin/env node
// 只读滚动回测。每个目标期只使用更早开奖；随机种子不是独立开奖样本。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const seeds = Number(arg('--seeds', 4));
const warmup = Number(arg('--warmup', 500));
const setsPerSeed = Number(arg('--sets', 1));
const requestedModels = arg('--models', '').split(',').filter(Boolean);
const limit = Number(arg('--limit', 0));
const baselineRef = arg('--baseline-ref', null);
const output = arg('--out', 'scratch/dlt-backtest.json');
if (![seeds, warmup, setsPerSeed].every(n => Number.isInteger(n) && n > 0) || !Number.isInteger(limit) || limit < 0) throw new Error('无效回测参数');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/lottery_data.json'), 'utf8')).data;
const currentSource = fs.readFileSync(path.join(root, 'js/predictor.js'), 'utf8');
const baselineSource = baselineRef ? execFileSync('git', ['show', `${baselineRef}:js/predictor.js`], { cwd: root, encoding: 'utf8' }) : null;
function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}
function load(source) {
  const sandbox = { console, localStorage: { getItem: () => null, setItem() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const name of ['predictor-config', 'dlt-conformal']) vm.runInContext(fs.readFileSync(path.join(root, `js/${name}.js`), 'utf8'), sandbox);
  // 仅在回测沙箱暴露内部 context，避免每个 seed 重复准备相同历史统计。
  const marker = '  window.Predictor = {';
  if (!source.includes(marker)) throw new Error('预测器接口变更，需核对回测插桩');
  vm.runInContext(source.replace(marker, '  window.Backtest = { createPredictionContext, evaluateFrontCombination };\n' + marker), sandbox);
  return sandbox;
}
const models = [
  ...(baselineSource ? [{ name: 'previous-spread', source: baselineSource, options: {} }] : []),
  { name: 'independent', source: currentSource, options: { randomExploration: false, frontConstraintMode: 'filter' } },
  { name: 'exploration', source: currentSource, options: { randomExploration: true, frontConstraintMode: 'filter' } },
  { name: 'observe-all', source: currentSource, options: { randomExploration: false, frontConstraintMode: 'observe' } }
].filter(m => !requestedModels.length || requestedModels.includes(m.name)).map(m => ({ ...m, sandbox: load(m.source), phases: {}, issues: [] }));
if (!models.some(m => m.name === 'independent')) throw new Error('配对回测必须包含 independent 基线');
function empty() { return { batches: 0, tickets: 0, wins: 0, periodWins: 0, front: Array(6).fill(0), back: Array(3).fill(0), prizes: Array(8).fill(0), frontUnion: 0, backUnion: 0, strategies: {}, confidence: {} }; }
function prize(f, b) {
  if (f === 5) return b === 2 ? 1 : b === 1 ? 2 : 3;
  if (f === 4) return b === 2 ? 3 : b === 1 ? 4 : 5;
  if (f === 3) return b === 2 ? 5 : b === 1 ? 6 : 7;
  return b === 2 ? (f === 2 ? 6 : 7) : f === 2 && b === 1 ? 7 : 0;
}
function evaluate(batch, draw, agg) {
  let wins = 0;
  agg.batches++;
  agg.frontUnion += new Set(batch.flatMap(p => p.front)).size;
  agg.backUnion += new Set(batch.flatMap(p => p.back)).size;
  for (const p of batch) {
    const f = p.front.filter(n => draw.front.includes(n)).length;
    const b = p.back.filter(n => draw.back.includes(n)).length;
    const level = prize(f, b);
    wins += !!level;
    agg.tickets++; agg.wins += !!level; agg.front[f]++; agg.back[b]++; agg.prizes[level]++;
    for (const field of ['strategy', 'confidence']) {
      const group = (field === 'strategy' ? agg.strategies : agg.confidence);
      const stat = group[p[field]] ||= { n: 0, wins: 0, front: 0, back: 0 };
      stat.n++; stat.wins += !!level; stat.front += f; stat.back += b;
    }
  }
  agg.periodWins += wins > 0;
  return wins;
}
let indices = Array.from({ length: data.length - warmup }, (_, i) => i).reverse();
if (limit) indices = indices.slice(-limit);
if (indices.length < 180) throw new Error('至少需要 180 个滚动目标期，以分开开发、验证与留出窗口');
const holdoutSize = 120;
const validationSize = Math.min(300, Math.floor((indices.length - holdoutSize) / 2));
const phaseOf = index => index >= indices.length - holdoutSize ? 'holdout' : index >= indices.length - holdoutSize - validationSize ? 'validation' : 'development';
const coverage = { passed: 0, total: 0, phases: {} };
const started = Date.now();
for (let k = 0; k < indices.length; k++) {
  const i = indices[k];
  const draw = data[i];
  const history = data.slice(i + 1);
  const phase = phaseOf(k);
  for (const model of models) {
    const context = model.sandbox.Backtest.createPredictionContext(history);
    if (model.name === 'independent') {
      const passed = model.sandbox.Backtest.evaluateFrontCombination(draw.front, context.frontConstraints, context.params).valid;
      const c = coverage.phases[phase] ||= { total: 0, passed: 0 };
      c.total++; c.passed += passed; coverage.total++; coverage.passed += passed;
    }
    const agg = model.phases[phase] ||= empty();
    let issueWins = 0, ticketWins = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const seedValue = (Number(draw.issue) * 1009 + seed * 9176 + 20261018) >>> 0;
      const random = rng(seedValue);
      let batch, bestScore = -Infinity;
      for (let setIndex = 0; setIndex < setsPerSeed; setIndex++) {
        const candidate = model.sandbox.Predictor.generateMultiplePredictions(history, 5, { ...model.options, context, rng: random });
        const score = candidate.reduce((sum,p) => sum + p.minScore, 0) / candidate.length;
        if (score > bestScore) { batch = candidate; bestScore = score; }
      }
      if (batch.length !== 5 || new Set(batch.map(p => p.strategy)).size !== 5) throw new Error(`五注集合异常 ${model.name}`);
      const wins = evaluate(batch, draw, agg);
      issueWins += wins > 0; ticketWins += wins;
    }
    model.issues.push({ issue: draw.issue, phase, periodWin: issueWins / seeds, ticketWin: ticketWins / (seeds * 5) });
  }
  if ((k + 1) % 100 === 0) console.error(`已回放 ${k + 1}/${indices.length} 期，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
function summary(agg) {
  return { ...agg, ticketRate: agg.wins / agg.tickets, periodRate: agg.periodWins / agg.batches, front3Rate: agg.front.slice(3).reduce((a,b)=>a+b,0) / agg.tickets, back2Rate: agg.back[2] / agg.tickets, averageFrontUnion: agg.frontUnion / agg.batches, averageBackUnion: agg.backUnion / agg.batches };
}
// 配对差值按“目标期”聚类，seed 只用于降低生成器 Monte Carlo 噪声。
function pairedInterval(model, base, phase) {
  const a = model.issues.filter(x => x.phase === phase);
  const b = base.issues.filter(x => x.phase === phase);
  if (!a.length || a.length !== b.length || a.some((x,i)=>x.issue!==b[i].issue)) throw new Error('配对窗口异常');
  const diffs = a.map((x, i) => x.periodWin - b[i].periodWin);
  const random = rng(20261018), means = [];
  for (let j = 0; j < 2000; j++) {
    let sum = 0;
    for (let k = 0; k < diffs.length; k++) sum += diffs[Math.floor(random() * diffs.length)];
    means.push(sum / diffs.length);
  }
  means.sort((a,b)=>a-b);
  return { issues: a.length, delta: diffs.reduce((a,b)=>a+b,0)/diffs.length, bootstrap95: [means[49],means[1949]] };
}
const base = models.find(x=>x.name==='independent');
const result = {
  verifiedAt: new Date().toISOString(), dataSha256: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'), currentSourceSha256: crypto.createHash('sha256').update(currentSource).digest('hex'), baselineRef,
  protocol: { draws: data.length, targets: indices.length, warmup, seeds, setsPerSeed, validationSize, holdoutSize, rule: '所有历史回放统一按现行七奖级重评；非当期实际奖级统计', leakage: 'data.slice(targetIndex + 1)，不含目标期及之后开奖；不复用当前 localStorage 校准值', selection: '先看 development/validation；holdout 仅一次报告，禁止据此反复改参' },
  shapeCoverage: coverage,
  models: models.map(m => ({ name: m.name, sourceSha256: crypto.createHash('sha256').update(m.source).digest('hex'), options: m.options, phases: Object.fromEntries(Object.entries(m.phases).map(([key,value])=>[key,summary(value)])), pairedAgainstIndependent: Object.fromEntries(['validation','holdout'].map(phase=>[phase,pairedInterval(m,base,phase)])), issues: m.issues })),
  seconds: (Date.now() - started) / 1000
};
fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
fs.writeFileSync(path.resolve(root, output), JSON.stringify(result, null, 2) + '\n');
for (const m of result.models) console.log(JSON.stringify({ model: m.name, phases: Object.fromEntries(Object.entries(m.phases).map(([key,p])=>[key,{periodRate:p.periodRate,ticketRate:p.ticketRate,front3:p.front3Rate,back2:p.back2Rate}])), paired: m.pairedAgainstIndependent }));
console.log(JSON.stringify({ output, protocol: result.protocol, shapeCoverage: coverage, seconds: result.seconds }));
