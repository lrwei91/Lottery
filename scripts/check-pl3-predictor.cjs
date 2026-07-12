#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPredictor() {
  const sandbox = {
    console, Math, Date, JSON, Set, Map, Array, Number, String,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const rel of ['js/dlt-conformal.js', 'js/predictor-config.js', 'js/predictor.js']) {
    const filename = path.join(root, rel);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  }
  return sandbox.Predictor;
}

function seededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function validatePl3(predictions, seed) {
  const expected = ['balanced', 'random', 'gap', 'hot', 'cold'];
  assert(predictions.length === expected.length, `seed ${seed} 应生成 5 注`);
  assert(predictions.map((item) => item.strategy).join(',') === expected.join(','), `seed ${seed} 策略顺序异常`);
  for (const [index, prediction] of predictions.entries()) {
    assert(Array.isArray(prediction.front) && prediction.front.length === 3, `seed ${seed} 第 ${index + 1} 注应为三位`);
    assert(prediction.front.every((value) => Number.isInteger(value) && value >= 0 && value <= 9), `seed ${seed} 第 ${index + 1} 注号码越界`);
    assert(Array.isArray(prediction.back) && prediction.back.length === 0, `seed ${seed} 第 ${index + 1} 注不应有后区`);
    assert(prediction.strategy !== 'danTuo', `seed ${seed} 排列三不应使用胆码分层默认策略`);
  }
}

const Predictor = loadPredictor();
assert(Predictor, 'Predictor 未加载');
const dlt = JSON.parse(fs.readFileSync(path.join(root, 'data/lottery_data.json'), 'utf8')).data;
const pl3 = JSON.parse(fs.readFileSync(path.join(root, 'data/pl3_data.json'), 'utf8')).data;

for (const seed of [26076, 26077, 26078]) {
  validatePl3(Predictor.generateMultiplePredictions(pl3, 5, { rng: seededRng(seed) }), seed);
}

Predictor.computeScores(dlt);
validatePl3(Predictor.generateMultiplePredictions(pl3, 5, { rng: seededRng(31001) }), 31001);
const pl3Params = Predictor.getParams('pl3');
assert(pl3Params.FRONT_MIN === 0 && pl3Params.FRONT_MAX === 9 && pl3Params.BACK_COUNT === 0, '排列三参数发生串扰');

Predictor.computeScores(dlt);
const dltParams = Predictor.getParams('dlt');
assert(dltParams.FRONT_MIN === 1 && dltParams.FRONT_MAX === 35 && dltParams.BACK_COUNT === 2, '大乐透参数恢复失败');

console.log(JSON.stringify({ ok: true, seeds: 4, latestIssue: pl3[0].issue }));
