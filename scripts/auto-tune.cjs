#!/usr/bin/env node
/**
 * 大乐透策略自动调优（auto-tune）。
 *
 * 定位：每周一/三/六 22:15 复盘任务的第二阶段。只做"持续小步优化"，不做结构改动。
 *
 * 流程：
 *   1) 拉云端复盘（只读），按"每期取开奖前最新一版记录"的主口径，算各策略近 20 期滚动得分；
 *   2) 触发条件（必须同时满足，单期波动不动参数）：
 *      - 某策略在"最近 20 期"窗口与"往前再推 4 期的 20 期"窗口中，滚动均值均 < 最优策略的 85%；
 *      - 距上次采纳调参 ≥ 7 天（冷却）；
 *   3) 对垫底策略的主控参数生成 ±1 步候选（步长/边界见 KNOBS），逐个：
 *      - 正则锚定改 js/predictor.js 工作区（锚定失败则放弃，绝不猜）；
 *      - 跑语法 + 预测器结构校验；
 *      - 用 scripts/backtest-dlt-strategies.cjs 做 240 期滚动回放（4 种子×每期5套选优），
 *        以 git HEAD 的 predictor.js 为基线（--baseline-ref HEAD）；
 *      - 采纳门槛：验证窗期级中奖率相对提升 ≥2%，且验证窗单注率不降、
 *        留出窗期级率不退化（≥基线-0.5pp）、前区≥3/后区2个相对 ≥90%；
 *   4) 采纳最优通过者（每轮最多 1 个参数），更新 scripts/tuning/state.json，
 *      追加 docs/strategy-tuning-log.md；输出 JSON  verdict（提交与推送由调用方完成）。
 *
 * 用法：
 *   node scripts/auto-tune.cjs [--apply] [--device-id ID] [--api-base URL]
 *                             [--backtest-limit N] [--force-strategy S]
 *   不带 --apply 为演练：只评估触发条件并打印 verdict，不改任何文件。
 *
 * 约束：
 *   - 只动大乐透（dlt）；排列三（pl3）永不触碰；
 *   - 白名单参数之外的一个字符都不改；工作区 js/predictor.js 必须干净才开始；
 *   - 回测提升≠未来中奖概率提升，verdict 与日志如实记录数字，不做收益承诺。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PREDICTOR = path.join(ROOT, 'js', 'predictor.js');
const STATE_FILE = path.join(ROOT, 'scripts', 'tuning', 'state.json');
const LOG_FILE = path.join(ROOT, 'docs', 'strategy-tuning-log.md');
const SCRATCH_DIR = path.join(ROOT, 'scratch', 'auto-tune');

const args = process.argv.slice(2);
function arg(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const APPLY = args.includes('--apply');
const DEVICE_ID = arg('--device-id', process.env.TICAI_DEVICE_ID || '3722bf95-31b6-452b-9ced-76a39ccceeb0');
const API_BASE = (arg('--api-base', process.env.TICAI_API_BASE || 'https://ticai-taupe.vercel.app')).replace(/\/+$/, '');
const BACKTEST_LIMIT = Math.max(180, Number(arg('--backtest-limit', 240)) || 240);
const FORCE_STRATEGY = arg('--force-strategy', null);

const STRATEGIES = ['gap', 'cold', 'random', 'balanced', 'hot'];
const ROLL_WINDOW = 20;        // 滚动窗口期数
const SHIFT = 4;               // 第二窗口往前推的期数（持续性检验）
const LAG_RATIO = 0.85;        // 垫底阈值：< 最优策略均值的 85%
const COOLDOWN_DAYS = 7;
const MIN_ISSUES = ROLL_WINDOW + SHIFT; // 24

// 主控参数白名单：策略 -> 参数路径/步长/边界
// （只调该策略"最能代表其性格"的一个旋钮，每轮最多采纳 1 步）
function strategyLineRegex(s) {
  return new RegExp(
    `^    ${s}:(\\s+)\\{ gap: ([\\d.]+), freqDev: ([\\d.]+), trend: ([\\d.]+), ` +
    `statusBonus: \\{ cold: ([\\d.]+), warm: ([\\d.]+), hot: ([\\d.]+) \\} \\},?$`, 'm');
}
const KNOBS = {
  gap:      { path: 'STRATEGY_WEIGHTS.gap.gap',                 field: 'gap',            step: 0.05, min: 0.05, max: 0.80, decimals: 2 },
  cold:     { path: 'STRATEGY_WEIGHTS.cold.statusBonus.cold',   field: 'statusBonus.cold', step: 0.20, min: 0.50, max: 3.00, decimals: 1 },
  hot:      { path: 'STRATEGY_WEIGHTS.hot.statusBonus.hot',     field: 'statusBonus.hot',  step: 0.20, min: 0.50, max: 3.00, decimals: 1 },
  balanced: { path: 'STRATEGY_WEIGHTS.balanced.trend',          field: 'trend',          step: 0.04, min: 0.05, max: 0.60, decimals: 2 },
  random:   { path: 'STRATEGY_WEIGHTS.random.gap',              field: 'gap',            step: 0.04, min: 0.05, max: 0.60, decimals: 2 },
};
const FIELD_INDEX = { gap: 1, freqDev: 2, trend: 3, 'statusBonus.cold': 4, 'statusBonus.warm': 5, 'statusBonus.hot': 6 };

function log(...a) { console.error('[auto-tune]', ...a); }
function verdict(obj) { console.log('VERDICT:' + JSON.stringify(obj)); }

function fail(why, detail) {
  verdict({ ok: false, changed: false, skippedWhy: why, detail: detail || null });
  process.exit(1);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return { version: 1, lastRun: null, lastAdoptedAt: null, cooldownDays: COOLDOWN_DAYS, adopted: [] };
  }
}

async function fetchReviews() {
  const url = `${API_BASE}/api/reviews?deviceId=${encodeURIComponent(DEVICE_ID)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`reviews 接口 HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.reviews) ? data.reviews : [];
}

// 主口径：每期只取开奖前 createdAt 最晚的一版记录的 5 策略得分
function buildIssueScores(reviews) {
  const byIssue = new Map();
  for (const r of reviews) {
    if (r.type !== 'dlt' || !STRATEGIES.includes(r.strategy)) continue;
    if (typeof r.score !== 'number' || !r.issue) continue;
    const key = r.issue;
    const created = new Date(r.createdAt || 0).getTime();
    if (!byIssue.has(key)) byIssue.set(key, { created: -1, scores: {} });
    const slot = byIssue.get(key);
    const recKey = r.recordId || '';
    if (!slot.recKey || (r.recordId === slot.recKey)) {
      slot.recKey = recKey;
      if (created >= slot.created) { slot.created = created; slot.scores[r.strategy] = r.score; }
    } else if (created > slot.created) {
      slot.recKey = recKey; slot.created = created; slot.scores = { [r.strategy]: r.score };
    }
  }
  const issues = [];
  for (const [issue, slot] of byIssue) {
    if (STRATEGIES.every((s) => typeof slot.scores[s] === 'number')) {
      issues.push({ issue, scores: slot.scores });
    }
  }
  issues.sort((a, b) => (a.issue < b.issue ? -1 : 1));
  return issues;
}

function rollingMean(issues, strategies) {
  const mean = {};
  for (const s of strategies) {
    mean[s] = issues.reduce((sum, it) => sum + it.scores[s], 0) / issues.length;
  }
  return mean;
}

function getStrategyLine(source, s) {
  const re = strategyLineRegex(s);
  const m = source.match(re);
  if (!m) return null;
  return { line: m[0], pad: m[1], values: m.slice(2).map(Number) };
}

function setKnob(source, s, knob, newValue) {
  const found = getStrategyLine(source, s);
  if (!found) throw new Error(`锚定失败：${s} 行未匹配，放弃修改`);
  const idx = FIELD_INDEX[knob.field];
  const vals = found.values.slice();
  vals[idx - 1] = newValue;
  const fmt = (v) => String(parseFloat(v.toFixed(knob.decimals)));
  const newLine = `    ${s}:${found.pad}{ gap: ${fmt(vals[0])}, freqDev: ${fmt(vals[1])}, trend: ${fmt(vals[2])}, ` +
    `statusBonus: { cold: ${fmt(vals[3])}, warm: ${fmt(vals[4])}, hot: ${fmt(vals[5])} } },`;
  // 保留原行尾逗号风格：原行以 "}," 结尾则新行也如此
  const tail = found.line.trimEnd().endsWith('},') ? ',' : '';
  const finalLine = newLine.replace(/,\s*$/, '') + tail;
  const occurrences = source.split(found.line).length - 1;
  if (occurrences !== 1) throw new Error(`锚定失败：${s} 行出现 ${occurrences} 次，放弃修改`);
  return source.replace(found.line, finalLine);
}

function runCheck(cmdArgs, label) {
  const r = spawnSync(process.execPath, cmdArgs, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${label} 未通过：${(r.stderr || r.stdout || '').slice(0, 500)}`);
}

function runBacktest(tag) {
  const out = path.join(SCRATCH_DIR, `${tag}.json`);
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  const r = spawnSync(process.execPath,
    ['scripts/backtest-dlt-strategies.cjs', '--baseline-ref', 'HEAD',
     '--seeds', '4', '--sets', '5', '--limit', String(BACKTEST_LIMIT),
     '--models', 'previous-spread,independent', '--out', out],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`回测执行失败：${(r.stderr || r.stdout || '').slice(-800)}`);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

function phaseMetrics(result, modelName, phase) {
  const m = result.models.find((x) => x.name === modelName);
  if (!m) throw new Error(`回测结果缺少模型 ${modelName}`);
  const p = m.phases[phase];
  if (!p) throw new Error(`回测结果缺少 ${modelName}/${phase}`);
  return { periodRate: p.periodRate, ticketRate: p.ticketRate, front3Rate: p.front3Rate, back2Rate: p.back2Rate };
}

function stripCandidate(r) {
  const { base, cand, ...rest } = r;
  return rest;
}

// 采纳门槛（验证窗为主，留出窗防退化）
function passesBar(base, cand) {
  const v = {
    valPeriodGainRel: base.val.periodRate > 0 ? (cand.val.periodRate - base.val.periodRate) / base.val.periodRate : 0,
    valTicketOk: cand.val.ticketRate >= base.val.ticketRate,
    holdoutNotWorse: cand.holdout.periodRate >= base.holdout.periodRate - 0.005,
    front3Ok: base.val.front3Rate === 0 || cand.val.front3Rate >= base.val.front3Rate * 0.9,
    back2Ok: base.val.back2Rate === 0 || cand.val.back2Rate >= base.val.back2Rate * 0.9,
  };
  v.pass = v.valPeriodGainRel >= 0.02 && v.valTicketOk && v.holdoutNotWorse && v.front3Ok && v.back2Ok;
  return v;
}

function appendTuningLog(entry) {
  const header = '# 策略自动调优日志\n\n> 由 scripts/auto-tune.cjs 在复盘任务中自动追加。回测提升不等于未来中奖概率提升。\n\n';
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, header, 'utf8');
  fs.appendFileSync(LOG_FILE, entry + '\n', 'utf8');
}

async function main() {
  log(`启动（apply=${APPLY}，device=${DEVICE_ID.slice(0, 8)}…）`);

  // 安全：工作区必须干净
  const dirty = execFileSync('git', ['status', '--porcelain', 'js/predictor.js'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (dirty) fail('工作区 js/predictor.js 不干净，拒绝调优', dirty);

  const state = readState();
  state.lastRun = new Date().toISOString();

  // 1) 拉云端复盘并算滚动得分
  let issues;
  try {
    const reviews = await fetchReviews();
    issues = buildIssueScores(reviews);
  } catch (e) {
    fail('云端复盘拉取失败', String(e && e.message || e));
  }
  log(`可用主口径期数：${issues.length}`);
  if (issues.length < MIN_ISSUES) {
    if (APPLY) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n'); }
    verdict({ ok: true, changed: false, skippedWhy: `主口径期数 ${issues.length} < ${MIN_ISSUES}，样本不足跳过` });
    return;
  }

  const windowA = issues.slice(-ROLL_WINDOW);
  const windowB = issues.slice(-(ROLL_WINDOW + SHIFT), -SHIFT);
  const meanA = rollingMean(windowA, STRATEGIES);
  const meanB = rollingMean(windowB, STRATEGIES);
  const bestA = Math.max(...STRATEGIES.map((s) => meanA[s]));
  const bestB = Math.max(...STRATEGIES.map((s) => meanB[s]));

  // 2) 触发条件：连续两个窗口垫底（单期波动不动参数）
  let lagging = FORCE_STRATEGY;
  let triggerInfo = null;
  if (!lagging) {
    const cands = STRATEGIES
      .filter((s) => meanA[s] < bestA * LAG_RATIO && meanB[s] < bestB * LAG_RATIO)
      .map((s) => ({ s, ratio: meanA[s] / bestA }))
      .sort((a, b) => a.ratio - b.ratio);
    if (cands.length > 0) {
      lagging = cands[0].s;
      triggerInfo = {
        strategy: lagging,
        windowA: { issues: [windowA[0].issue, windowA[windowA.length - 1].issue], mean: +meanA[lagging].toFixed(3), bestMean: +bestA.toFixed(3), ratio: +(meanA[lagging] / bestA).toFixed(3) },
        windowB: { issues: [windowB[0].issue, windowB[windowB.length - 1].issue], mean: +meanB[lagging].toFixed(3), bestMean: +bestB.toFixed(3), ratio: +(meanB[lagging] / bestB).toFixed(3) },
      };
    }
  } else {
    triggerInfo = { strategy: lagging, forced: true, meanA: +meanA[lagging].toFixed(3), bestA: +bestA.toFixed(3) };
  }
  log('窗口A均值：', JSON.stringify(meanA), '窗口B均值：', JSON.stringify(meanB));

  if (!lagging) {
    if (APPLY) { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n'); }
    verdict({ ok: true, changed: false, skippedWhy: '无策略连续两窗口垫底（<×0.85 最优），本轮不调参', windowMeans: { A: meanA, B: meanB } });
    return;
  }

  // 3) 冷却检查
  if (state.lastAdoptedAt) {
    const days = (Date.now() - new Date(state.lastAdoptedAt).getTime()) / 86400000;
    if (days < (state.cooldownDays || COOLDOWN_DAYS)) {
      verdict({ ok: true, changed: false, skippedWhy: `触发（${lagging} 垫底）但距上次采纳仅 ${days.toFixed(1)} 天，冷却中`, trigger: triggerInfo });
      return;
    }
  }

  // 4) 生成候选（±1 步，边界内）
  const knob = KNOBS[lagging];
  if (!knob) fail(`策略 ${lagging} 无白名单参数`);
  const original = fs.readFileSync(PREDICTOR, 'utf8');
  const current = getStrategyLine(original, lagging);
  if (!current) fail(`锚定失败：${lagging} 行未匹配`);
  const curVal = current.values[FIELD_INDEX[knob.field] - 1];
  const round = (v) => parseFloat(v.toFixed(knob.decimals));
  const candidates = [];
  for (const dir of [1, -1]) {
    const nv = round(curVal + dir * knob.step);
    if (nv < knob.min || nv > knob.max || nv === curVal) continue;
    candidates.push({ dir: dir > 0 ? '+' : '-', newValue: nv });
  }
  if (candidates.length === 0) {
    verdict({ ok: true, changed: false, skippedWhy: `${knob.path} 当前值 ${curVal} 已在边界，无可调步长`, trigger: triggerInfo });
    return;
  }
  log(`垫底策略：${lagging}，参数 ${knob.path} 当前 ${curVal}，候选：`, JSON.stringify(candidates));

  if (!APPLY) {
    verdict({ ok: true, changed: false, dryRun: true, trigger: triggerInfo, param: knob.path, currentValue: curVal, candidates });
    return;
  }

  // 5) 逐候选：改工作区 -> 校验 -> 回放 -> 还原
  const results = [];
  for (const c of candidates) {
    const tag = `${new Date().toISOString().slice(0, 10)}-${lagging}-${c.dir === '+' ? 'up' : 'down'}`;
    try {
      const edited = setKnob(original, lagging, knob, c.newValue);
      fs.writeFileSync(PREDICTOR, edited, 'utf8');
      runCheck(['scripts/check-syntax.cjs'], '语法检查');
      runCheck(['scripts/check-dlt-predictor.cjs'], '预测器结构检查');
      const bt = runBacktest(tag);
      const base = { val: phaseMetrics(bt, 'previous-spread', 'validation'), holdout: phaseMetrics(bt, 'previous-spread', 'holdout') };
      const cand = { val: phaseMetrics(bt, 'independent', 'validation'), holdout: phaseMetrics(bt, 'independent', 'holdout') };
      const bar = passesBar(base, cand);
      results.push({ ...c, param: knob.path, oldValue: curVal, bar, base, cand, backtestOut: `scratch/auto-tune/${tag}.json` });
      log(`候选 ${c.dir}${c.newValue}: 验证窗期级率 ${base.val.periodRate.toFixed(4)}→${cand.val.periodRate.toFixed(4)}，通过=${bar.pass}`);
    } catch (e) {
      log(`候选 ${c.dir}${c.newValue} 异常：`, String(e && e.message || e).slice(0, 300));
      results.push({ ...c, param: knob.path, oldValue: curVal, error: String(e && e.message || e).slice(0, 300) });
    } finally {
      execFileSync('git', ['checkout', '--', 'js/predictor.js'], { cwd: ROOT });
    }
  }

  const passing = results.filter((r) => r.bar && r.bar.pass)
    .sort((a, b) => b.bar.valPeriodGainRel - a.bar.valPeriodGainRel);
  if (passing.length === 0) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
    verdict({ ok: true, changed: false, skippedWhy: '候选均未通过采纳门槛（验证窗相对提升≥2% 且留出窗不退化）', trigger: triggerInfo, candidates: results.map(stripCandidate) });
    return;
  }

  // 6) 采纳最优：写文件 + state + 日志（提交推送由调用方完成）
  const win = passing[0];
  const edited = setKnob(original, lagging, knob, win.newValue);
  fs.writeFileSync(PREDICTOR, edited, 'utf8');
  runCheck(['scripts/check-syntax.cjs'], '语法检查（终）');

  const nowIso = new Date().toISOString();
  const fmtPct = (v) => (v * 100).toFixed(2) + '%';
  const commitMessage =
`auto-tune: ${knob.path} ${curVal}→${win.newValue}

触发：${lagging} 在近 ${ROLL_WINDOW} 期云端滚动得分连续两个窗口垫底` +
`（窗口A ${triggerInfo.windowA ? `${triggerInfo.windowA.issues[0]}~${triggerInfo.windowA.issues[1]} 均值 ${triggerInfo.windowA.mean} / 最优 ${triggerInfo.windowA.bestMean}` : '强制触发'}）。` +
`
验证（${BACKTEST_LIMIT} 期滚动回放，4 种子×每期 5 套选优，基线=HEAD）：
- 验证窗：期级中奖率 ${fmtPct(win.base.val.periodRate)}→${fmtPct(win.cand.val.periodRate)}（相对 ${(win.bar.valPeriodGainRel * 100).toFixed(1)}%），单注率 ${fmtPct(win.base.val.ticketRate)}→${fmtPct(win.cand.val.ticketRate)}
- 留出窗：期级中奖率 ${fmtPct(win.base.holdout.periodRate)}→${fmtPct(win.cand.holdout.periodRate)}（未退化）
- 前区≥3：${fmtPct(win.base.val.front3Rate)}→${fmtPct(win.cand.val.front3Rate)}；后区2个：${fmtPct(win.base.val.back2Rate)}→${fmtPct(win.cand.val.back2Rate)}

说明：回测提升不等于未来中奖概率提升；单步小幅调整。回滚：git revert <commit>。`;

  state.lastAdoptedAt = nowIso;
  state.adopted.push({
    at: nowIso, strategy: lagging, param: knob.path,
    oldValue: curVal, newValue: win.newValue,
    trigger: triggerInfo,
    validation: {
      baseVal: win.base.val, candVal: win.cand.val,
      baseHoldout: win.base.holdout, candHoldout: win.cand.holdout,
      gainRel: +win.bar.valPeriodGainRel.toFixed(4),
    },
    backtestOut: win.backtestOut,
  });
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');

  appendTuningLog(
`## ${nowIso.slice(0, 10)} 自动调优：${knob.path} ${curVal} → ${win.newValue}

- 垫底策略：${lagging}（连续两窗口滚动均值 < 最优 ×${LAG_RATIO}）
- 验证窗（${BACKTEST_LIMIT} 期回放）：期级中奖率 ${fmtPct(win.base.val.periodRate)} → ${fmtPct(win.cand.val.periodRate)}；单注率 ${fmtPct(win.base.val.ticketRate)} → ${fmtPct(win.cand.val.ticketRate)}
- 留出窗：期级中奖率 ${fmtPct(win.base.holdout.periodRate)} → ${fmtPct(win.cand.holdout.periodRate)}
- 回放产物：${win.backtestOut}（scratch/ 不进仓库提交，由复盘任务归档）
- 回滚：git revert <本提交>
`);

  verdict({
    ok: true, changed: true,
    strategy: lagging, param: knob.path, oldValue: curVal, newValue: win.newValue,
    trigger: triggerInfo,
    validation: {
      baseVal: win.base.val, candVal: win.cand.val,
      baseHoldout: win.base.holdout, candHoldout: win.cand.holdout,
      gainRel: +win.bar.valPeriodGainRel.toFixed(4),
    },
    filesChanged: ['js/predictor.js', 'scripts/tuning/state.json', 'docs/strategy-tuning-log.md'],
    commitMessage,
    note: '回测提升不等于未来中奖概率提升；已通过语法与预测器结构校验。',
  });
}

main().catch((e) => fail('调优器异常', String(e && e.stack || e).slice(0, 800)));
