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
  const Z_HALF_WIDTH_THRESHOLDS = { low: 0.05, medium: 0.10 };

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
    const { front, back } = buildAppearanceSequences(data, opts);
    const frontResults = Array.from(front.entries()).map(([num, seq]) => predictNumber(num, seq));
    const backResults = Array.from(back.entries()).map(([num, seq]) => predictNumber(num, seq));

    // 在 calibration 集上校验 empiricalCoverage（用最后 20% 期作 holdout）
    // 检查 cal 期的真实经验频率是否落在 CI 内
    const splitIdx = Math.max(1, Math.floor(data.length * 0.8));
    const cal = data.slice(splitIdx);
    if (cal.length === 0) {
      return { front: frontResults, back: backResults, empiricalCoverage: 0, calSize: 0 };
    }

    // 每期只建一次 Set，避免 O(N × M) 创建
    const calFrontSets = cal.map(d => new Set(d.front || []));
    const calBackSets = cal.map(d => new Set(d.back || []));

    let covered = 0;
    let total = 0;
    for (const r of frontResults) {
      const calCount = calFrontSets.reduce((acc, s) => acc + (s.has(r.num) ? 1 : 0), 0);
      const calProb = calCount / cal.length;
      if (calProb >= r.ciLow - 1e-6 && calProb <= r.ciHigh + 1e-6) covered++;
      total++;
    }
    for (const r of backResults) {
      const calCount = calBackSets.reduce((acc, s) => acc + (s.has(r.num) ? 1 : 0), 0);
      const calProb = calCount / cal.length;
      if (calProb >= r.ciLow - 1e-6 && calProb <= r.ciHigh + 1e-6) covered++;
      total++;
    }
    const empiricalCoverage = total > 0 ? covered / total : 0;

    return {
      front: frontResults,
      back: backResults,
      empiricalCoverage: Number(empiricalCoverage.toFixed(4)),
      calSize: cal.length
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
      .filter(r => r.halfWidth <= maxHalfWidth && r.empiricalProb >= minProb)
      .map(r => ({
        num: r.num,
        score: r.empiricalProb * (1 - r.halfWidth),
        halfWidth: r.halfWidth,
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
    Z_HALF_WIDTH_THRESHOLDS
  };
})(typeof window !== 'undefined' ? window : globalThis);
