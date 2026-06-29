/**
 * ============================================================
 * 大乐透专属 Conformal Prediction (v2026-06-22)
 * ============================================================
 *
 * 目标：给每个号码一个"1 期出现概率"的 90% 置信区间
 * 思路：Beta(1,1) prior + Binomial(N, p) likelihood → Wilson score 90% CI
 *      （不是 LOO conformal；LOO 对二元 0/1 数据会得到过宽的 CI，Wilson 更合适）
 *
 * 用途：
 *   - 号码 CI 半宽 < 0.05  → 模式稳定，可作为高把握胆码
 *   - 号码 CI 半宽 > 0.15  → 高度不确定，避免作为胆码
 *   - 配合 predictor.js 选号：在 final ranking 时给 CI 窄的号码加权
 *
 * 校准：用最后 20% 期作 holdout，校验 cal 期的真实经验频率是否落在 CI 内
 * 方法参考：Wilson (1927) score interval; Brown, Cai & DasGupta (2001)
 *
 * 限制：每期只标记 {0, 1} 二元，CI 是"经验频率"的范围，不是"label"的 CI
 */

;(function (global) {
  'use strict';

  const ALPHA = 0.10;  // 90% coverage target
  const HOLDOUT_RATIO = 0.20;
  const MIN_CAL_SIZE = 10;
  const Z_HALF_WIDTH_THRESHOLDS = { low: 0.05, medium: 0.10 };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function quantile(values, q) {
    if (!values || values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
    return sorted[idx];
  }

  function splitTrainCalibration(data) {
    const calSize = Math.min(
      Math.max(MIN_CAL_SIZE, Math.ceil(data.length * HOLDOUT_RATIO)),
      Math.max(1, data.length - 1)
    );
    // 数据按期号降序排列：前 20% 是最近开奖，用作校准集；剩余旧数据用于训练。
    return {
      cal: data.slice(0, calSize),
      train: data.slice(calSize),
      calSize,
      trainSize: data.length - calSize
    };
  }

  /**
   * 构建每个号码的"出现序列"
   * @param {Array} data - 开奖数据
   * @param {object} opts - { frontMin, frontMax, backMin, backMax }
   * @returns {{ front: Map<num, number[]>, back: Map<num, number[]> }}
   */
  function buildAppearanceSequences(data, opts) {
    const frontMin = (opts && opts.frontMin) || 1;
    const frontMax = (opts && opts.frontMax) || 35;
    const backMin = (opts && opts.backMin) || 1;
    const backMax = (opts && opts.backMax) || 12;

    const frontSeq = new Map();
    const backSeq = new Map();
    for (let n = frontMin; n <= frontMax; n++) frontSeq.set(n, []);
    for (let n = backMin; n <= backMax; n++) backSeq.set(n, []);

    for (const draw of data) {
      const fSet = new Set(draw.front || []);
      for (let n = frontMin; n <= frontMax; n++) {
        frontSeq.get(n).push(fSet.has(n) ? 1 : 0);
      }
      const bSet = new Set(draw.back || []);
      for (let n = backMin; n <= backMax; n++) {
        backSeq.get(n).push(bSet.has(n) ? 1 : 0);
      }
    }
    return { front: frontSeq, back: backSeq };
  }

  /**
   * Beta-Binomial 90% CI 半宽
   * Prior Beta(1,1) (uniform), Likelihood Binomial(N, p)
   * 用正态近似 + Wilson score 公式
   * @param {number} count - 出现次数
   * @param {number} N - 总期数
   * @returns {number} 90% CI 半宽
   */
  function wilsonHalfWidth(count, N) {
    if (N <= 0) return 0.5;
    const p = count / N;
    const z = 1.645;  // 90% CI 对应 z
    const denom = 1 + z * z / N;
    const center = (p + z * z / (2 * N)) / denom;
    const margin = (z * Math.sqrt(p * (1 - p) / N + z * z / (4 * N * N))) / denom;
    return Math.max(0.01, Math.min(0.5, margin));
  }

  /**
   * 对单个号码计算 1 期出现概率 + 90% CI
   */
  function predictNumber(num, seq) {
    const N = seq.length;
    const count = seq.reduce((a, b) => a + b, 0);
    const p = N > 0 ? count / N : 0;
    const halfWidth = wilsonHalfWidth(count, N);
    const ciLow = Math.max(0, p - halfWidth);
    const ciHigh = Math.min(1, p + halfWidth);

    let uncLevel;
    if (halfWidth < Z_HALF_WIDTH_THRESHOLDS.low) uncLevel = 'low';
    else if (halfWidth < Z_HALF_WIDTH_THRESHOLDS.medium) uncLevel = 'medium';
    else uncLevel = 'high';

    return {
      num,
      empiricalProb: Number(p.toFixed(4)),
      ciLow: Number(ciLow.toFixed(4)),
      ciHigh: Number(ciHigh.toFixed(4)),
      halfWidth: Number(halfWidth.toFixed(4)),
      uncertaintyLevel: uncLevel,
      sampleSize: N
    };
  }

  function countProb(draws, num, zone) {
    if (!draws || draws.length === 0) return 0;
    const count = draws.reduce((acc, draw) => {
      const nums = zone === 'back' ? (draw.back || []) : (draw.front || []);
      return acc + (nums.includes(num) ? 1 : 0);
    }, 0);
    return count / draws.length;
  }

  function calibrateZone(results, cal, zone, alpha) {
    const driftScores = results.map(r => Math.abs(countProb(cal, r.num, zone) - r.empiricalProb));
    const qhat = quantile(driftScores, 1 - alpha);
    let covered = 0;

    const calibrated = results.map(r => {
      const calProb = countProb(cal, r.num, zone);
      const recentDrift = Number((calProb - r.empiricalProb).toFixed(4));
      const conformalHalfWidth = Number(clamp(r.halfWidth + qhat, 0.01, 0.5).toFixed(4));
      const ciLow = Number(clamp(r.empiricalProb - conformalHalfWidth, 0, 1).toFixed(4));
      const ciHigh = Number(clamp(r.empiricalProb + conformalHalfWidth, 0, 1).toFixed(4));
      const isCovered = calProb >= ciLow - 1e-6 && calProb <= ciHigh + 1e-6;
      if (isCovered) covered++;

      const driftPenalty = clamp(Math.abs(recentDrift) / (conformalHalfWidth || 0.01), 0, 1);
      const widthPenalty = clamp(conformalHalfWidth / 0.20, 0, 1);
      const stabilityScore = Number(clamp(1 - driftPenalty * 0.65 - widthPenalty * 0.35, 0, 1).toFixed(4));

      return {
        ...r,
        calProb: Number(calProb.toFixed(4)),
        qhat: Number(qhat.toFixed(4)),
        conformalHalfWidth,
        ciLow,
        ciHigh,
        recentDrift,
        stabilityScore,
        uncertaintyLevel: stabilityScore >= 0.75 ? 'low' : stabilityScore >= 0.35 ? 'medium' : 'high'
      };
    });

    return {
      results: calibrated,
      qhat: Number(qhat.toFixed(4)),
      covered,
      total: results.length
    };
  }

  /**
   * 批量预测所有号码
   * @param {Array} data - 开奖数据
   * @param {object} opts - { frontMin, frontMax, backMin, backMax }
   * @returns {{ front: Array, back: Array, empiricalCoverage: number, calSize: number }}
   */
  function predictAll(data, opts) {
    if (!data || data.length < 5) {
      return { front: [], back: [], empiricalCoverage: 0, calSize: 0 };
    }
    const split = splitTrainCalibration(data);
    const { front, back } = buildAppearanceSequences(split.train, opts);
    const frontResults = Array.from(front.entries()).map(([num, seq]) => predictNumber(num, seq));
    const backResults = Array.from(back.entries()).map(([num, seq]) => predictNumber(num, seq));

    const frontCal = calibrateZone(frontResults, split.cal, 'front', ALPHA);
    const backCal = calibrateZone(backResults, split.cal, 'back', ALPHA);
    const covered = frontCal.covered + backCal.covered;
    const total = frontCal.total + backCal.total;
    const empiricalCoverage = total > 0 ? covered / total : 0;

    return {
      front: frontCal.results,
      back: backCal.results,
      empiricalCoverage: Number(empiricalCoverage.toFixed(4)),
      calSize: split.calSize,
      trainSize: split.trainSize,
      qhat: {
        front: frontCal.qhat,
        back: backCal.qhat
      }
    };
  }

  /**
   * 按 conformal 分数选出"高把握号码"——CI 半宽 < medium 阈值 且 empirical 概率合理
   * @param {Array} results - predictAll().front 或 .back
   * @param {object} opts - { topN, maxHalfWidth, minProb }
   * @returns {Array} 高把握号码（按 empirical prob × (1 - halfWidth) 排序）
   */
  function rankByConfidence(results, opts) {
    const topN = (opts && opts.topN) || 5;
    const maxHalfWidth = (opts && opts.maxHalfWidth) || 0.10;
    const minProb = (opts && opts.minProb) || 0.05;
    return results
      .filter(r => (r.conformalHalfWidth || r.halfWidth) <= maxHalfWidth && r.empiricalProb >= minProb)
      .map(r => ({
        num: r.num,
        score: r.empiricalProb * (1 - (r.conformalHalfWidth || r.halfWidth)) * (r.stabilityScore || 0.5),
        halfWidth: r.conformalHalfWidth || r.halfWidth,
        stabilityScore: r.stabilityScore,
        prob: r.empiricalProb
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  /**
   * 大乐透整体 conformal 报告
   */
  function generateReport(data) {
    const result = predictAll(data);
    return {
      front: result.front,
      back: result.back,
      empiricalCoverage: result.empiricalCoverage,
      calSize: result.calSize,
      frontRanking: rankByConfidence(result.front, { topN: 10, maxHalfWidth: 0.10, minProb: 0.10 }),
      backRanking: rankByConfidence(result.back, { topN: 5, maxHalfWidth: 0.15, minProb: 0.10 }),
      generatedAt: new Date().toISOString()
    };
  }

  global.DltConformal = {
    predictAll,
    predictNumber,
    rankByConfidence,
    generateReport,
    ALPHA,
    HOLDOUT_RATIO,
    Z_HALF_WIDTH_THRESHOLDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
