/**
 * ============================================================
 * 体彩预测比对模块 — 开奖号码 vs 预测结果
 * ============================================================
 * 
 * 功能：
 * 1. 读取最新一期开奖号码
 * 2. 读取最近一期预测记录（从预测数据文件或实时生成）
 * 3. 比对命中情况，输出中奖/未中奖原因分析
 * 
 * 使用：
 *   node scripts/compare_prediction.js              # 默认比对最新一期
 *   node scripts/compare_prediction.js --issue 26058  # 指定期号
 *   node scripts/compare_prediction.js --type pl3     # 排列三
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// 数据加载
// ============================================================

const DATA_DIR = path.join(__dirname, '..', 'data');

function loadLotteryData(type = 'dlt') {
  const file = type === 'pl3' ? 'pl3_data.json' : 'lottery_data.json';
  const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
  return JSON.parse(raw).data || [];
}

function loadPredictions(type = 'dlt') {
  const file = type === 'pl3' ? 'pl3_predictions.json' : 'predictions.json';
  const filePath = path.join(DATA_DIR, file);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

// ============================================================
// 核心分析函数（从 predictor.js 移植）
// ============================================================

function frequencyAnalysis(data, frontMax = 35, backMax = 12) {
  const freqMap = new Map();
  const backFreqMap = new Map();
  for (let i = 1; i <= frontMax; i++) freqMap.set(i, 0);
  for (let i = 1; i <= backMax; i++) backFreqMap.set(i, 0);
  
  for (const draw of data) {
    for (const n of draw.front) {
      freqMap.set(n, (freqMap.get(n) || 0) + 1);
    }
    if (draw.back) {
      for (const n of draw.back) {
        backFreqMap.set(n, (backFreqMap.get(n) || 0) + 1);
      }
    }
  }
  return { front: freqMap, back: backFreqMap };
}

function gapAnalysis(data, frontMax = 35, backMax = 12) {
  const gapMap = new Map();
  const backGapMap = new Map();
  for (let i = 1; i <= frontMax; i++) gapMap.set(i, 0);
  for (let i = 1; i <= backMax; i++) backGapMap.set(i, 0);
  
  for (const draw of data) {
    for (let i = 1; i <= frontMax; i++) {
      if (!draw.front.includes(i)) {
        gapMap.set(i, gapMap.get(i) + 1);
      } else {
        gapMap.set(i, 0);
      }
    }
    if (draw.back) {
      for (let i = 1; i <= backMax; i++) {
        if (!draw.back.includes(i)) {
          backGapMap.set(i, backGapMap.get(i) + 1);
        } else {
          backGapMap.set(i, 0);
        }
      }
    }
  }
  return { front: gapMap, back: backGapMap };
}

function hotColdStatus(freqMap, dataLength, coldThreshold = 0.15, hotThreshold = 0.7) {
  const avgFreq = dataLength * (5 / 35); // 大乐透前区每期 5 个号
  const status = {};
  for (const [num, freq] of freqMap) {
    const ratio = freq / avgFreq;
    if (ratio < coldThreshold) status[num] = 'cold';
    else if (ratio > hotThreshold) status[num] = 'hot';
    else status[num] = 'warm';
  }
  return status;
}

function computeScores(data, strategy = 'balanced', period = 50) {
  const recent = data.slice(0, period);
  const { front: freqMap } = frequencyAnalysis(recent);
  const { front: gapMap } = gapAnalysis(recent);
  const status = hotColdStatus(freqMap, recent.length);
  
  const scores = {};
  const weights = {
    balanced: { gap: 0.3, freqDev: 0.3, trend: 0.3, statusBonus: { cold: 1.0, warm: 1.0, hot: 1.0 } },
    hot: { gap: 0.1, freqDev: 0.2, trend: 0.4, statusBonus: { cold: 0.1, warm: 0.5, hot: 2.0 } },
    cold: { gap: 0.3, freqDev: 0.2, trend: 0.1, statusBonus: { cold: 2.0, warm: 0.5, hot: 0.1 } },
    gap: { gap: 0.6, freqDev: 0.1, trend: 0.1, statusBonus: { cold: 1.2, warm: 1.0, hot: 0.8 } }
  }[strategy] || { gap: 0.3, freqDev: 0.3, trend: 0.3, statusBonus: { cold: 1.0, warm: 1.0, hot: 1.0 } };
  
  const maxFreq = Math.max(...freqMap.values()) || 1;
  const maxGap = Math.max(...gapMap.values()) || 1;
  
  for (let i = 1; i <= 35; i++) {
    const freqScore = (freqMap.get(i) || 0) / maxFreq;
    const gapScore = (gapMap.get(i) || 0) / maxGap;
    const trendScore = freqScore; // 简化
    const bonus = weights.statusBonus[status[i]] || 1.0;
    
    scores[i] = (
      weights.gap * gapScore +
      weights.freqDev * freqScore +
      weights.trend * trendScore
    ) * bonus;
  }
  return scores;
}

function weightedSample(items, count) {
  const pool = items.slice();
  const selected = [];
  while (selected.length < count && pool.length > 0) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let rand = Math.random() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      rand -= pool[i].weight;
      if (rand <= 0) {
        selected.push(pool[i].value);
        pool.splice(i, 1);
        break;
      }
    }
  }
  return selected.sort((a, b) => a - b);
}

function generatePrediction(data, strategy = 'balanced') {
  const scores = computeScores(data, strategy);
  const items = Object.entries(scores).map(([num, weight]) => ({
    value: parseInt(num),
    weight: Math.max(0.01, weight)
  }));
  
  // 前区
  const front = weightedSample(items, 5);
  // 后区（简化：随机）
  const back = [];
  while (back.length < 2) {
    const n = Math.floor(Math.random() * 12) + 1;
    if (!back.includes(n)) back.push(n);
  }
  back.sort((a, b) => a - b);
  
  return {
    strategy,
    front,
    back,
    reasoning: `策略: ${strategy} | 基于最近50期频率/遗漏/冷热分析`
  };
}

// ============================================================
// 比对逻辑
// ============================================================

function getPrizeTierName(frontMatches, backMatches) {
  if (frontMatches === 5 && backMatches === 2) return '一等奖';
  if (frontMatches === 5 && backMatches === 1) return '二等奖';
  if (frontMatches === 5 && backMatches === 0) return '三等奖';
  if (frontMatches === 4 && backMatches === 2) return '四等奖';
  if (frontMatches === 4 && backMatches === 1) return '五等奖';
  if (frontMatches === 3 && backMatches === 2) return '六等奖';
  if (frontMatches === 4 && backMatches === 0) return '七等奖';
  if (frontMatches === 3 && backMatches === 1) return '八等奖';
  if (frontMatches === 2 && backMatches === 2) return '九等奖';
  if (frontMatches === 3 && backMatches === 0) return '九等奖';
  if (frontMatches === 1 && backMatches === 2) return '九等奖';
  if (frontMatches === 0 && backMatches === 2) return '九等奖';
  if (frontMatches === 2 && backMatches === 1) return '未中奖';
  if (frontMatches === 1 && backMatches === 1) return '未中奖';
  if (frontMatches === 2 && backMatches === 0) return '未中奖';
  if (frontMatches === 1 && backMatches === 0) return '未中奖';
  if (frontMatches === 0 && backMatches === 1) return '未中奖';
  if (frontMatches === 0 && backMatches === 0) return '未中奖';
  return '未中奖';
}

function evaluatePrediction(prediction, draw) {
  if (!draw) return null;
  
  const matchedFront = prediction.front.filter(n => draw.front.includes(n));
  const matchedBack = prediction.back.filter(n => draw.back.includes(n));
  const prize = getPrizeTierName(matchedFront.length, matchedBack.length);
  
  return {
    frontMatches: matchedFront.length,
    backMatches: matchedBack.length,
    prize,
    matchedFront,
    matchedBack,
    unmatchedFront: prediction.front.filter(n => !draw.front.includes(n)),
    missedFront: draw.front.filter(n => !prediction.front.includes(n)),
    missedBack: draw.back.filter(n => !prediction.back.includes(n))
  };
}

function analyzeReason(evaluation, prediction, draw, data) {
  const lines = [];
  const { frontMatches, backMatches, prize, matchedFront, matchedBack, unmatchedFront, missedFront, missedBack } = evaluation;
  
  // 基础信息
  lines.push(`🎯 期号：${draw.issue}（${draw.date}）`);
  lines.push(`📊 预测策略：${prediction.strategy}`);
  lines.push(``);
  
  // 开奖号码
  lines.push(`🔴 开奖前区：${draw.front.map(n => String(n).padStart(2, '0')).join(' ')}`);
  lines.push(`🔵 开奖后区：${draw.back.map(n => String(n).padStart(2, '0')).join(' ')}`);
  lines.push(``);
  
  // 预测号码
  lines.push(`📝 预测前区：${prediction.front.map(n => String(n).padStart(2, '0')).join(' ')}`);
  lines.push(`📝 预测后区：${prediction.back.map(n => String(n).padStart(2, '0')).join(' ')}`);
  lines.push(``);
  
  // 比对结果
  if (frontMatches > 0 || backMatches > 0) {
    lines.push(`✅ 命中情况：前区 ${frontMatches}/5 | 后区 ${backMatches}/2`);
    if (matchedFront.length > 0) {
      lines.push(`   命中前区：${matchedFront.map(n => String(n).padStart(2, '0')).join(' ')}`);
    }
    if (matchedBack.length > 0) {
      lines.push(`   命中后区：${matchedBack.map(n => String(n).padStart(2, '0')).join(' ')}`);
    }
  } else {
    lines.push(`❌ 命中情况：前区 0/5 | 后区 0/2`);
  }
  lines.push(``);
  
  // 中奖等级
  lines.push(`🏆 结果：${prize}`);
  lines.push(``);
  
  // 原因分析
  lines.push(`📋 原因分析：`);
  
  if (prize !== '未中奖') {
    lines.push(`  ✅ 恭喜中奖！${prize}`);
    if (frontMatches >= 4) {
      lines.push(`  🎉 前区命中 ${frontMatches} 个，表现优秀`);
    }
    if (backMatches >= 1) {
      lines.push(`  🎯 后区命中 ${backMatches} 个，关键命中`);
    }
  } else {
    lines.push(`  ❌ 未中奖，具体原因：`);
    
    if (frontMatches === 0 && backMatches === 0) {
      lines.push(`  - 前区后区均未命中，号码偏离较大`);
    }
    
    if (frontMatches > 0 && frontMatches < 3) {
      lines.push(`  - 前区仅命中 ${frontMatches} 个，未达到最低中奖要求（需 3+0 或 0+2）`);
    }
    
    if (backMatches === 1 && frontMatches < 3) {
      lines.push(`  - 后区命中 1 个，但前区命中不足（需 2+2 或 3+0 等组合）`);
    }
    
    if (unmatchedFront.length > 0) {
      lines.push(`  - 未命中号码：${unmatchedFront.map(n => String(n).padStart(2, '0')).join(' ')}`);
    }
    
    if (missedBack.length > 0) {
      lines.push(`  - 遗漏后区号码：${missedBack.map(n => String(n).padStart(2, '0')).join(' ')}`);
    }
  }
  
  // 冷热号分析
  const recent = data.slice(0, 30);
  const { front: freqMap } = frequencyAnalysis(recent);
  const status = hotColdStatus(freqMap, recent.length);
  
  const hotMissed = missedFront.filter(n => status[n] === 'hot');
  const coldHit = matchedFront.filter(n => status[n] === 'cold');
  
  if (hotMissed.length > 0) {
    lines.push(`  ⚠️ 遗漏热号：${hotMissed.map(n => `${String(n).padStart(2, '0')}(热)`).join(' ')}`);
  }
  if (coldHit.length > 0) {
    lines.push(`  ❄️ 命中冷号：${coldHit.map(n => `${String(n).padStart(2, '0')}(冷)`).join(' ')}`);
  }
  
  return lines.join('\n');
}

// ============================================================
// 主流程
// ============================================================

function main() {
  const args = process.argv.slice(2);
  let targetIssue = null;
  let type = 'dlt';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--issue' && i + 1 < args.length) {
      targetIssue = args[i + 1];
      i++;
    } else if (args[i] === '--type') {
      type = args[i + 1] || 'dlt';
      i++;
    }
  }
  
  // 加载数据
  const data = loadLotteryData(type);
  if (!data || data.length === 0) {
    console.error('❌ 无开奖数据');
    process.exit(1);
  }
  
  const latestDraw = targetIssue 
    ? data.find(d => String(d.issue) === String(targetIssue))
    : data[0];
  
  if (!latestDraw) {
    console.error(`❌ 未找到期号 ${targetIssue} 的开奖数据`);
    process.exit(1);
  }
  
  // 生成预测（模拟最近一期的预测）
  const strategies = ['balanced', 'hot', 'cold', 'gap'];
  const predictions = strategies.map(s => generatePrediction(data, s));
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 体彩预测比对报告 — ${type === 'pl3' ? '排列三' : '大乐透'}`);
  console.log(`${'='.repeat(60)}\n`);
  
  // 对每个策略进行比对
  predictions.forEach((pred, idx) => {
    const evaluation = evaluatePrediction(pred, latestDraw);
    if (evaluation) {
      const analysis = analyzeReason(evaluation, pred, latestDraw, data);
      console.log(analysis);
      console.log(`\n${'-'.repeat(40)}\n`);
    }
  });
  
  // 保存结果
  const outputFile = path.join(DATA_DIR, `${type}_comparison_result.json`);
  const result = {
    issue: latestDraw.issue,
    date: latestDraw.date,
    type,
    draw: latestDraw,
    predictions: predictions.map(pred => ({
      ...pred,
      evaluation: evaluatePrediction(pred, latestDraw)
    })),
    timestamp: new Date().toISOString()
  };
  
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`📦 结果已保存至：${outputFile}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  loadLotteryData,
  generatePrediction,
  evaluatePrediction,
  analyzeReason,
  getPrizeTierName
};
