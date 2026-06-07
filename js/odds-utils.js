/**
 * 赔率/价值计算工具集
 * 移植自 bet-worldcup2026/quant/{odds/devig, edge/ev, portfolio/kelly}.js
 *
 * 用法：
 *   const fair = OddsUtils.devig.fairOdds([{name: 'France', odds: 5.5}, ...])
 *   const edge = OddsUtils.ev.edge(modelProb, fair[0].fairProbability)
 *   const ev = OddsUtils.ev.expectedValue(decimalOdds, modelProb)
 *   const stake = OddsUtils.kelly.fractionalKelly(decimalOdds, modelProb, 0.25)
 */
;(function () {
  'use strict';

  // ==================== 校验 ====================
  function assertProbability(value, label) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${label || 'Probability'} must be between 0 and 1 (got ${value})`);
    }
  }

  function assertDecimalOdds(decimalOdds) {
    if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
      throw new Error(`Decimal odds must be a finite number greater than 1 (got ${decimalOdds})`);
    }
  }

  // ==================== 去水（devig）====================
  // 接受 [{name, decimalOdds}, ...] 或 [odds1, odds2, ...]
  // 输出 [{name, decimalOdds, rawProbability, fairProbability, fairOdds}, ...]
  function normalizeOutcomes(outcomes) {
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      throw new Error('Outcomes must be a non-empty array');
    }
    return outcomes.map(function (outcome, i) {
      if (typeof outcome === 'number') {
        if (outcome <= 1) throw new Error('Decimal odds must be > 1');
        return { name: 'outcome_' + i, decimalOdds: outcome };
      }
      if (!outcome || typeof outcome !== 'object') {
        throw new Error('Outcome must be a number or object');
      }
      const odds = outcome.decimalOdds ?? outcome.odds ?? outcome.price === 0 ? null : (1 / (outcome.price || 0));
      // 如果传入的是 price（概率），转成 odds
      let decimalOdds;
      if (outcome.decimalOdds != null) decimalOdds = outcome.decimalOdds;
      else if (outcome.odds != null) decimalOdds = outcome.odds;
      else if (outcome.price != null && outcome.price > 0) decimalOdds = 1 / outcome.price;
      else throw new Error('Need decimalOdds / odds / price field');
      if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
        throw new Error('Decimal odds must be > 1 (got ' + decimalOdds + ')');
      }
      return {
        name: outcome.name || ('outcome_' + i),
        decimalOdds: decimalOdds
      };
    });
  }

  // 含水分原始概率
  function rawProbabilities(outcomes) {
    return normalizeOutcomes(outcomes).map(function (o) {
      return Object.assign({}, o, { rawProbability: 1 / o.decimalOdds });
    });
  }

  // 总水分（vig）：sum(rawProb) - 1，越大越"黑"
  function margin(outcomes) {
    const raw = rawProbabilities(outcomes);
    const sum = raw.reduce(function (s, o) { return s + o.rawProbability; }, 0);
    return sum - 1;
  }

  // 按比例去水：净概率 = raw / total
  function proportionalDevig(outcomes) {
    const raw = rawProbabilities(outcomes);
    const total = raw.reduce(function (s, o) { return s + o.rawProbability; }, 0);
    if (total <= 0) throw new Error('Total implied probability must be > 0');
    return raw.map(function (o) {
      return Object.assign({}, o, { fairProbability: o.rawProbability / total });
    });
  }

  // 净赔率（去水后）
  function fairOdds(outcomes) {
    return proportionalDevig(outcomes).map(function (o) {
      return Object.assign({}, o, { fairOdds: 1 / o.fairProbability });
    });
  }

  // ==================== 期望值（EV）====================
  // 期望值（占 1 单位本金）：modelProb * (decimalOdds - 1) - (1 - modelProb)
  // > 0 表示有正期望（值得下注），< 0 表示负期望
  function expectedValue(decimalOdds, modelProb) {
    assertDecimalOdds(decimalOdds);
    assertProbability(modelProb, 'Model probability');
    return modelProb * (decimalOdds - 1) - (1 - modelProb);
  }

  // 绝对 edge：模型 - 市场（已正负）
  function edge(modelProb, marketProb) {
    assertProbability(modelProb, 'Model probability');
    assertProbability(marketProb, 'Market probability');
    return modelProb - marketProb;
  }

  // 相对 edge：model / market - 1
  function relativeEdge(modelProb, marketProb) {
    assertProbability(modelProb, 'Model probability');
    assertProbability(marketProb, 'Market probability');
    if (marketProb === 0) throw new Error('Market probability must be > 0');
    return modelProb / marketProb - 1;
  }

  // 贝叶斯收缩：lambda * model + (1 - lambda) * market
  function shrinkProbability(modelProb, marketProb, lambda) {
    assertProbability(modelProb, 'Model probability');
    assertProbability(marketProb, 'Market probability');
    if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
      throw new Error('Lambda must be between 0 and 1');
    }
    return lambda * modelProb + (1 - lambda) * marketProb;
  }

  // ==================== Kelly 仓位 ====================
  // 完整 Kelly：(b*p - q) / b，其中 b = decimalOdds - 1, p = prob, q = 1 - p
  // 当 EV <= 0 时返回 0（不下注）
  function fullKelly(decimalOdds, prob) {
    assertDecimalOdds(decimalOdds);
    assertProbability(prob);
    if (expectedValue(decimalOdds, prob) <= 0) return 0;
    const b = decimalOdds - 1;
    const q = 1 - prob;
    return Math.max(0, (b * prob - q) / b);
  }

  // 分数 Kelly（推荐 0.25 ~ 0.5 应对模型不确定）
  function fractionalKelly(decimalOdds, prob, fraction) {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw new Error('Fraction must be between 0 and 1');
    }
    return fullKelly(decimalOdds, prob) * fraction;
  }

  // 单注 / 单场 / 单日上限
  function capStake(rawStake, caps) {
    const opts = caps || {};
    const singleBetCap = opts.singleBetCap != null ? opts.singleBetCap : 1;
    const matchCap = opts.matchCap != null ? opts.matchCap : 1;
    const dayCap = opts.dayCap != null ? opts.dayCap : 1;
    if (!Number.isFinite(rawStake)) throw new Error('Raw stake must be finite');
    [singleBetCap, matchCap, dayCap].forEach(function (v, i) {
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(['singleBetCap', 'matchCap', 'dayCap'][i] + ' must be finite and >= 0');
      }
    });
    return Math.min(Math.max(0, rawStake), singleBetCap, matchCap, dayCap);
  }

  // ==================== 便捷组合 ====================
  // 多 outcome 价格（含水分）→ 净概率映射表
  // 输入：[{name, price}, ...]（price 是 0-1 的概率）
  // 输出：{name: fairProbability}
  function fairProbsFromPrices(priceOutcomes) {
    const odds = priceOutcomes.map(function (o) {
      return { name: o.name, decimalOdds: 1 / o.price };
    });
    const fair = proportionalDevig(odds);
    const map = {};
    fair.forEach(function (o) { map[o.name] = o.fairProbability; });
    return map;
  }

  // 暴露 API
  window.OddsUtils = {
    devig: {
      rawProbabilities: rawProbabilities,
      margin: margin,
      proportionalDevig: proportionalDevig,
      fairOdds: fairOdds,
      fairProbsFromPrices: fairProbsFromPrices
    },
    ev: {
      expectedValue: expectedValue,
      edge: edge,
      relativeEdge: relativeEdge,
      shrinkProbability: shrinkProbability
    },
    kelly: {
      fullKelly: fullKelly,
      fractionalKelly: fractionalKelly,
      capStake: capStake
    }
  };
})();
