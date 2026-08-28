#!/usr/bin/env node
/**
 * 每日大乐透 5 注自动生成 + 云端同步
 *
 * 用法：
 *   node scripts/cron_generate_daily_predictions.cjs           # 生成 + 云端 POST
 *   node scripts/cron_generate_daily_predictions.cjs --dry-run # 只生成、只日志、不 POST
 *
 * 环境变量：
 *   TICAI_DEVICE_ID   目标云端 deviceId（默认 3722bf95-31b6-452b-9ced-76a39ccceeb0）
 *   TICAI_API_BASE    API base（默认 https://bet.lrwei91.online）
 *
 * 逻辑：
 *   1) 用 vm 沙箱加载浏览器端 predictor-config.js + predictor.js + dlt-conformal.js
 *   2) 读 data/lottery_data.json，调 window.Predictor.generateMultiplePredictions(data, 5)
 *   3) 组装成和 js/app.js:savePredictionRecord 完全一致的 record shape
 *   4) POST /api/records（Upstash Redis Sorted Set，与浏览器写入同一 index）
 *   5) 每日归档一份 JSON 到 scripts/logs/daily-predictions/<YYYY-MM-DD>.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'lottery_data.json');
const LOG_DIR = path.join(__dirname, 'logs', 'daily-predictions');

const DEVICE_ID = process.env.TICAI_DEVICE_ID || '3722bf95-31b6-452b-9ced-76a39ccceeb0';
const API_BASE = (process.env.TICAI_API_BASE || 'https://bet.lrwei91.online').replace(/\/+$/, '');
const DRY_RUN = process.argv.includes('--dry-run');

const RUN_STARTED = new Date().toISOString();

const STRATEGY_LABELS = Object.freeze({
  gap: '遗漏',
  cold: '冷号',
  random: '随机',
  balanced: '均衡',
  hot: '热号',
  danTuo: '胆拖',
});

const CONFIDENCE_LABELS = Object.freeze({
  high: '高置信',
  balanced: '均衡',
  aggressive: '激进',
});

// 详细过程只进日志，stdout 只保留最终推送内容。
function trace(...args) {
  console.error('[大乐透任务]', ...args);
}

function fatal(reason, detail) {
  console.log(['❌ 大乐透每日预测', '', `失败原因：${reason}`].join('\n'));
  trace('错误：', reason, detail || '');
  process.exit(1);
}

function loadPredictorSandbox() {
  const files = [
    'js/predictor-config.js',
    'js/predictor.js',
    'js/dlt-conformal.js',
  ];

  // 纯内存 localStorage（predictor.js 会读写 ticai.overKillRuntime）
  const memStore = new Map();
  const localStorage = {
    getItem(k) { return memStore.has(k) ? memStore.get(k) : null; },
    setItem(k, v) { memStore.set(String(k), String(v)); },
    removeItem(k) { memStore.delete(k); },
    clear() { memStore.clear(); },
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  // 让 window 与 sandbox 内的全局对象等价（js/dlt-conformal.js 用 (function(global){...})(window)，
  // 而 predictor.js 用裸 window.PredictorConfig 等；两种都通过同一个引用即可拿到）
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.localStorage = localStorage;
  // 有些 predictor 分支访问 Math/JSON 等——沙箱里 Node 自带的原生对象已经存在

  vm.createContext(sandbox);

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const code = fs.readFileSync(abs, 'utf8');
    try {
      vm.runInContext(code, sandbox, { filename: rel });
    } catch (err) {
      throw new Error(`加载 ${rel} 失败：${err.message}`);
    }
  }

  if (!sandbox.Predictor || typeof sandbox.Predictor.generateMultiplePredictions !== 'function') {
    throw new Error('沙箱内未导出 window.Predictor.generateMultiplePredictions');
  }
  return sandbox;
}

function inferNextIssue(issue) {
  const raw = String(issue || '');
  if (!/^\d+$/.test(raw)) return '下一期';
  return String(Number(raw) + 1).padStart(raw.length, '0');
}

function assertDltStrategySet(predictions) {
  const expected = ['gap', 'cold', 'random', 'balanced', 'hot'];
  const actual = Array.isArray(predictions) ? predictions.map((p) => p && p.strategy) : [];
  const valid = actual.length === expected.length
    && new Set(actual).size === expected.length
    && expected.every((strategy) => actual.includes(strategy));
  if (!valid) {
    throw new Error(`五注策略集合异常：${actual.join(',') || '空'}`);
  }
}

function buildRecord(predictions, latestDraw) {
  const allOverKillFront = new Set();
  const allOverKillBack = new Set();
  for (const p of predictions) {
    const m = p.meta;
    if (!m || !m.overKillWarn) continue;
    (m.overKillWarn.front || []).forEach((n) => allOverKillFront.add(n));
    (m.overKillWarn.back || []).forEach((n) => allOverKillBack.add(n));
  }

  const now = Date.now();
  return {
    id: `dlt-cron-${now}`,
    type: 'dlt',
    createdAt: new Date(now).toISOString(),
    baseIssue: String(latestDraw.issue || ''),
    targetIssue: inferNextIssue(latestDraw.issue),
    source: 'cron-daily-1800',
    predictions: predictions.map((prediction) => ({
      strategy: prediction.strategy,
      front: prediction.front,
      back: prediction.back || [],
      reasoning: prediction.reasoning || '',
      confidence: prediction.confidence || null,
      minScore: prediction.minScore != null ? prediction.minScore : null,
      meta: prediction.meta || null,
    })),
    overKillWarn: {
      front: Array.from(allOverKillFront).sort((a, b) => a - b),
      back: Array.from(allOverKillBack).sort((a, b) => a - b),
    },
  };
}

async function postRecord(record) {
  const url = `${API_BASE}/api/records`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: DEVICE_ID, record }),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { /* ignore */ }
  return { ok: res.ok, status: res.status, body: parsed || text };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function saveArchive(payload) {
  ensureDir(LOG_DIR);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(LOG_DIR, `${day}.json`);
  let existing = [];
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(existing)) existing = [];
    } catch (_) {
      existing = [];
    }
  }
  existing.push(payload);
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return file;
}

function formatNumbers(numbers) {
  return (numbers || [])
    .map((number) => String(number).padStart(2, '0'))
    .join(' ');
}

function summarize(predictions) {
  return predictions.map((p, i) => {
    const strategy = STRATEGY_LABELS[p.strategy] || '其他策略';
    const confidence = CONFIDENCE_LABELS[p.confidence] || '未分级';
    const front = formatNumbers(p.front);
    const back = formatNumbers(p.back);
    return `${i + 1}. ${strategy}｜${confidence}：前区 ${front}；后区 ${back}`;
  }).join('\n');
}

function syncSummary(uploadResult) {
  if (DRY_RUN) return '云端同步：已跳过（演练模式）';
  if (uploadResult.ok) return `云端同步：成功（状态码 ${uploadResult.status}）`;
  if (uploadResult.status) return `云端同步：失败（状态码 ${uploadResult.status}）`;
  return '云端同步：异常（未获得响应）';
}

function printSummary({ latestDraw, draws, record, predictions, uploadResult }) {
  const title = record.targetIssue === '下一期'
    ? '🎯 大乐透每日预测'
    : `🎯 大乐透第 ${record.targetIssue} 期预测`;
  const baseDate = latestDraw.date ? `（${latestDraw.date}）` : '';
  console.log([
    title,
    '',
    `数据基准：第 ${latestDraw.issue} 期${baseDate}｜历史 ${draws.length} 期`,
    '',
    '预测号码：',
    summarize(predictions),
    '',
    syncSummary(uploadResult),
  ].join('\n'));
}

(async function main() {
  trace('任务开始', { runStarted: RUN_STARTED, deviceId: DEVICE_ID, dryRun: DRY_RUN });

  if (!fs.existsSync(DATA_FILE)) fatal('缺少历史开奖数据文件', DATA_FILE);
  const rawData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const draws = Array.isArray(rawData.data) ? rawData.data : [];
  if (draws.length === 0) fatal('历史开奖数据为空');
  const latestDraw = draws[0];
  trace(`已加载历史开奖 ${draws.length} 期，最新期 ${latestDraw.issue}（${latestDraw.date}）`);

  const sandbox = loadPredictorSandbox();
  trace('预测器沙箱加载完成');

  let predictions;
  try {
    predictions = sandbox.Predictor.generateMultiplePredictions(draws, 5);
  } catch (err) {
    fatal('预测生成失败', err && err.stack || err);
  }
  if (!Array.isArray(predictions) || predictions.length !== 5) {
    fatal('预测数量不是 5 注', `实际数量：${predictions && predictions.length}`);
  }
  try {
    assertDltStrategySet(predictions);
  } catch (err) {
    fatal('五注策略集合不完整', err && err.message || err);
  }
  trace(`已生成 5 注预测，目标期号 ${inferNextIssue(latestDraw.issue)}：\n${summarize(predictions)}`);

  const record = buildRecord(predictions, latestDraw);

  let uploadResult = { ok: null, status: null, body: null, dryRun: DRY_RUN };
  if (DRY_RUN) {
    trace('演练模式，跳过云端提交');
  } else {
    try {
      uploadResult = await postRecord(record);
      if (uploadResult.ok) {
        trace('云端同步成功：', uploadResult.status);
      } else {
        trace('云端同步失败：HTTP', uploadResult.status, uploadResult.body);
      }
    } catch (err) {
      uploadResult = { ok: false, status: null, error: String(err) };
      trace('云端同步异常：', err);
    }
  }

  const archivePath = saveArchive({
    runStarted: RUN_STARTED,
    finishedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    deviceId: DEVICE_ID,
    baseIssue: record.baseIssue,
    targetIssue: record.targetIssue,
    upload: uploadResult,
    record,
  });
  trace('归档写入：', archivePath);

  printSummary({ latestDraw, draws, record, predictions, uploadResult });

  if (!DRY_RUN && !uploadResult.ok) process.exit(2);
})().catch((err) => {
  fatal('任务执行异常', err && err.stack || err);
});
