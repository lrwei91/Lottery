/**
 * ============================================================
 * 体彩超级大乐透 - 预测分析引擎
 * ============================================================
 * 
 * 大乐透规则：
 * - 前区：从 1-35 中选 5 个号码
 * - 后区：从 1-12 中选 2 个号码
 * 
 * 数据格式：
 * { issue: string, date: string, front: number[], back: number[] }
 * 数据按期号降序排列（最新期在前）
 * 
 * 导出：window.Predictor 全局对象
 */

;(function () {
  'use strict';

  // ============================================================
  // 常量与变量定义 (支持大乐透/排列三动态适配)
  // ============================================================
  let FRONT_MIN = 1;
  let FRONT_MAX = 35;
  let BACK_MIN = 1;
  let BACK_MAX = 12;
  let FRONT_COUNT = 5; // 每期前区选号个数
  let BACK_COUNT = 2;  // 每期后区选号个数

  const DEFAULT_STRATEGIES = ['balanced', 'random', 'gap', 'hot', 'cold'];

  const STRATEGY_WEIGHTS = {
    cold:     { gap: 0.3, freqDev: 0.2, trend: 0.1, statusBonus: { cold: 2.0, warm: 0.5, hot: 0.1 } },
    hot:      { gap: 0.1, freqDev: 0.2, trend: 0.4, statusBonus: { cold: 0.1, warm: 0.5, hot: 2.0 } },
    balanced: { gap: 0.35, freqDev: 0.24, trend: 0.18, statusBonus: { cold: 1.0, warm: 1.0, hot: 1.0 } },
    gap:      { gap: 0.6, freqDev: 0.1, trend: 0.1, statusBonus: { cold: 1.2, warm: 1.0, hot: 0.8 } },
    random:   { gap: 0.33, freqDev: 0.33, trend: 0.33, statusBonus: { cold: 1.0, warm: 1.0, hot: 1.0 } }
  };


  const BOLLINGER_CONFIG = {
    analysisPeriods: 50,
    hotNumberRatio: 0.7,
    frontSumTolerance: 15,
    backSumTolerance: 4,
    stdMultiplier: 0.3
  };

  // ============================================================
  // 元层信号配置（双窗口 trend / transition / bias / 误杀预警）
  // ============================================================

  // 双窗口频率对比：trendScore 在近 10 期 vs 近 50 期窗口下检测"突然升温"信号
  const TREND_DUAL_WINDOW_CONFIG = {
    shortWindow: 10,
    longWindow: 50,
    shortMinCount: 2,        // 短窗口至少出现 N 次才可能视为 emergingHot
    longUnderRatio: 0.7,     // 长窗口出现次数 / 期望 < 此值视为长期偏冷
    trendBoost: 0.15         // emergingHot 给 trendScore 的加成
  };

  // transitionSignal：跨号码关系——看近 N 期的区间聚集度，本期反向加权
  const TRANSITION_CONFIG = {
    analysisPeriod: 5,       // 统计近 5 期的区间密度（与 BIAS_CONFIG.window 保持一致量级）
    zoneSize: 7,             // 每个区间 7 个号码 (1-7, 8-14, 15-21, 22-28, 29-35)
    zoneCount: 5,
    overHeatRatio: 1.3,      // 密度 > 期望 × 1.3 → 过热 → 本期降权 0.85
    underHeatRatio: 0.7,     // 密度 < 期望 × 0.7 → 过冷 → 本期升权 1.15
    adjustFactor: 0.15       // 调整幅度
  };

  // biasDetector：元层偏态信号——检测最近 N 期的区间/尾数/AC 聚集，触发反聚集
  const BIAS_CONFIG = {
    window: 10,
    zoneOverHeatRatio: 1.5,  // 某区间密度 > 期望 × 1.5 → 区间聚集
    tailConcentrate: 0.4,    // 某尾数出现占比 > 0.4 → 尾数聚集
    acThreshold: 3,          // ac <= 此值视为"低 AC"（ac 范围 0-6）
    acConcentrate: 0.4,      // 窗口内低 AC 占比 > 0.4 → AC 聚集
    counterBoost: 0.2        // 反聚集权重提升
  };

  // 元层权重合成：加性 + clamp 到 [-maxAbs, +maxAbs]，避免累乘失控
  const META_WEIGHT_CONFIG = {
    maxAbs: 0.40,            // 单个号码最终元层权重偏离基准最大 0.40（即 0.60-1.40）
    overKillBoost: 0.15      // 误杀预警号码的升权幅度（加性）
  };

  // 误杀预警层：得分处于 25%-50% 之间的号码标为预警
  const OVERKILL_CONFIG = {
    hardKillPercentile: 0.25,  // 低于 25% 分位的号码硬杀
    warnPercentile: 0.50,      // 25%-50% 分位的号码预警
    warnBoost: 1.15            // 预警号码在胆码分层选号时被加权
  };

  // rawComposite 合成：用于误杀预警排序的"号码综合得分"（不依赖具体选号策略）
  // 由 scoreZone 末尾写入 s.rawComposite，computeOverKillWarn 读取排序
  const RAW_COMPOSITE_WEIGHTS = {
    gap: 0.30,
    freqDev: 0.30,
    trend: 0.30,
    statusHot: 0.30,   // 热号 +0.30
    statusCold: 0.10,  // 冷号 +0.10
    statusWarm: 0.20   // 温号 +0.20
  };

  // 误杀预警阈值 runtime 副本（可被 calibrateOverKill 校准）
  const _overKillRuntime = {
    hardKillPercentile: OVERKILL_CONFIG.hardKillPercentile,
    warnPercentile: OVERKILL_CONFIG.warnPercentile,
    warnBoost: OVERKILL_CONFIG.warnBoost
  };

  // 后区非硬排决策：默认开启
  const BACK_SOFT_KILL_DEFAULT = true;

  // 短期冷号 / 近期表现信号配置（v2026-06-22 复盘后加）
  // 复盘发现：号码 31/18/11 引擎爱选但 0 命中（黑洞），后区 9/6 选 22/25 次 0 命中
  // 修复：用近 20/30 期窗口做短期频率降权，让"短期超冷"号码被自动边缘化
  const RECENT_FREQ_CONFIG = {
    frontWindow: 20,        // 前区近 20 期窗口
    backWindow: 30,         // 后区近 30 期窗口
    absentPenalty: 0.5,     // 完全没出现 → 0.5
    underHalfPenalty: 0.7,  // ratio < 0.5 → 0.7
    underThirdPenalty: 0.85,// ratio < 0.85 → 0.85
    overHotBoost: 1.15      // ratio > 1.5 → 1.15（短期热号升权）
  };

  function detectLotteryType(data) {
    if (!data || data.length === 0) return 'dlt';
    return data[0].front.length === 3 ? 'pl3' : 'dlt';
  }

  function updateLotteryParams(type) {
    if (type === 'pl3') {
      FRONT_MIN = 0;
      FRONT_MAX = 9;
      BACK_MIN = 1;
      BACK_MAX = 0; // 无后区
      FRONT_COUNT = 3;
      BACK_COUNT = 0;
    } else {
      FRONT_MIN = 1;
      FRONT_MAX = 35;
      BACK_MIN = 1;
      BACK_MAX = 12;
      FRONT_COUNT = 5;
      BACK_COUNT = 2;
    }
  }

  // ============================================================
  // 工具函数
  // ============================================================

  /**
   * 生成指定范围的整数数组 [min, max]
   */
  function range(min, max) {
    const arr = [];
    for (let i = min; i <= max; i++) arr.push(i);
    return arr;
  }

  /**
   * 按权重随机选择 count 个不重复元素
   * @param {Array<{value: number, weight: number}>} items - 带权重的候选项
   * @param {number} count - 选取数量
   * @returns {number[]} 选中的值
   */
  function weightedSample(items, count, rng = Math.random) {
    const pool = items.slice();
    const selected = [];

    for (let i = 0; i < count && pool.length > 0; i++) {
      const totalWeight = pool.reduce((sum, it) => sum + it.weight, 0);
      let rand = rng() * totalWeight;
      let idx = 0;

      for (let j = 0; j < pool.length; j++) {
        rand -= pool[j].weight;
        if (rand <= 0) {
          idx = j;
          break;
        }
      }

      selected.push(pool[idx].value);
      pool.splice(idx, 1);
    }

    return selected.sort((a, b) => a - b);
  }

  function gaussianRandom(rng = Math.random) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function getStrategyWeights(strategy) {
    return STRATEGY_WEIGHTS[strategy] || STRATEGY_WEIGHTS.balanced;
  }

  function drawKey(front, back) {
    const frontKey = front.slice().sort((a, b) => a - b).join(',');
    const backKey = back.slice().sort((a, b) => a - b).join(',');
    return `${frontKey}+${backKey}`;
  }

  function predictionKey(front, back, type) {
    return type === 'pl3' ? front.join(',') : drawKey(front, back || []);
  }

  function buildExactDrawSet(data, dataEnd) {
    const end = dataEnd != null ? dataEnd : data.length;
    const set = new Set();
    for (let i = 0; i < end; i++) {
      set.add(drawKey(data[i].front, data[i].back || []));
    }
    return set;
  }

  function percentile(values, q) {
    if (!values || values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1];
    return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
  }

  function roundPercentile(values, q) {
    return Math.round(percentile(values, q));
  }

  function topGroupsCovering(values, targetShare) {
    const counts = new Map();
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));

    const groups = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const total = values.length || 1;
    const selected = new Set();
    let covered = 0;

    for (const [value, count] of groups) {
      selected.add(value);
      covered += count;
      if (covered / total >= targetShare) break;
    }

    return selected;
  }

  /**
   * 计算标准差
   */
  function stdDev(values) {
    if (values.length === 0) return 0;
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * 归一化数值到 [0, 1]
   */
  function normalize(value, min, max) {
    if (max === min) return 0.5;
    return (value - min) / (max - min);
  }

  // ============================================================
  // 1. 频率分析 (带缓存)
  // ============================================================

  const _freqCache = { sig: null, dataEnd: null, result: null };
  const _transitionCache = { sig: null, result: null };
  const _biasCache = { sig: null, result: null };

  function _dataSignature(data, dataEnd) {
    const len = Math.min(dataEnd != null ? dataEnd : data.length, data.length);
    const firstIssue = data && data[0] ? data[0].issue || '' : '';
    const lastIssue = len > 0 && data[len - 1] ? data[len - 1].issue || '' : '';
    return `${detectLotteryType(data)}:${data.length}:${len}:${firstIssue}:${lastIssue}`;
  }

  /**
   * 统计每个号码在所有历史数据中出现的频率（带有时间衰减权重）
   * @param {Array} data - 开奖数据数组
   * @param {number} [dataEnd] - 只使用 data[0..dataEnd) 范围
   * @returns {{ front: Map<number, number>, back: Map<number, number> }}
   */
  function frequencyAnalysis(data, dataEnd) {
    const end = dataEnd != null ? dataEnd : data.length;
    const sig = _dataSignature(data, dataEnd);
    if (_freqCache.sig === sig && _freqCache.dataEnd === end) {
      return _freqCache.result;
    }

    updateLotteryParams(detectLotteryType(data));
    const front = new Map();
    const back = new Map();

    // 初始化所有号码计数为 0
    for (let i = FRONT_MIN; i <= FRONT_MAX; i++) front.set(i, 0);
    for (let i = BACK_MIN; i <= BACK_MAX; i++) back.set(i, 0);

    // 遍历每期数据累加计数，引入时间衰减机制
    const total = end;
    for (let i = 0; i < total; i++) {
      const draw = data[i];
      // 线性衰减：最近的一期权重为 1.5，最远的一期权重为 0.5
      // 这使得引擎具备“近期嗅觉”，能更敏锐地捕捉热号回暖
      const weight = total > 1 ? 1.5 - (i / (total - 1)) : 1.0;
      
      for (const num of draw.front) {
        if (front.has(num)) {
          front.set(num, front.get(num) + weight);
        }
      }
      for (const num of (draw.back || [])) {
        if (back.has(num)) {
          back.set(num, back.get(num) + weight);
        }
      }
    }

    const result = { front, back };
    _freqCache.sig = sig;
    _freqCache.dataEnd = end;
    _freqCache.result = result;
    return result;
  }

  // ============================================================
  // 2. 冷热分析
  // ============================================================

  /**
   * 分析最近 N 期的冷热号码
   * - 热号：出现 >= 4 次
   * - 冷号：出现 <= 1 次
   * - 温号：其余
   * @param {Array} data - 开奖数据
   * @param {number} recentN - 分析最近的期数，默认 300
   * @returns {{ front: { hot, cold, warm }, back: { hot, cold, warm } }}
   */
  function hotColdAnalysis(data, recentN = 300, dataEnd) {
    const isPl3 = detectLotteryType(data) === 'pl3';
    updateLotteryParams(isPl3 ? 'pl3' : 'dlt');

    const end = dataEnd != null ? Math.min(dataEnd, recentN) : Math.min(data.length, recentN);
    const freq = frequencyAnalysis(data, end);

    function classify(freqMap, total, isBackZone = false) {
      const hot = [], cold = [], warm = [];
      // 动态阈值：基于期数调整冷热判定标准
      let avgExpected = 0;
      if (isPl3) {
        avgExpected = total * 3 / 10;
      } else {
        avgExpected = isBackZone ? (total * 2 / 12) : (total * 5 / 35);
      }

      // v2026-06-22: 阈值收紧 1.15/0.85 → 1.5/0.5
      // 复盘发现 7 期实际开奖 0 个真冷号 (ratio<0.85)、3 个真热号都集中在 13
      // 1.5/0.5 让 hot/cold 策略真正能选到差异化的号码
      const hotThreshold = Math.ceil(avgExpected * 1.5);
      const coldThreshold = Math.floor(avgExpected * 0.5);

      for (const [num, count] of freqMap) {
        if (count >= hotThreshold) {
          hot.push(num);
        } else if (count <= coldThreshold) {
          cold.push(num);
        } else {
          warm.push(num);
        }
      }

      // 按号码排序
      hot.sort((a, b) => a - b);
      cold.sort((a, b) => a - b);
      warm.sort((a, b) => a - b);

      return { hot, cold, warm };
    }

    return {
      front: classify(freq.front, end, false),
      back: isPl3 ? { hot: [], cold: [], warm: [] } : classify(freq.back, end, true)
    };
  }

  // ============================================================
  // 3. 遗漏分析
  // ============================================================

  /**
   * 计算每个号码的遗漏值
   * - current：当前遗漏期数（距上次出现的期数）
   * - max：历史最大遗漏
   * - avg：平均遗漏
   * @param {Array} data - 开奖数据（最新期在前）
   * @returns {{ front: Map, back: Map }}
   */
  function gapAnalysis(data, dataEnd) {
    updateLotteryParams(detectLotteryType(data));

    const end = dataEnd != null ? dataEnd : data.length;

    function analyzeZone(getNumbers, min, max) {
      const result = new Map();

      for (let num = min; num <= max; num++) {
        let currentGap = -1;
        let maxGap = 0;
        let totalGap = 0;
        let gapCount = 0;
        let lastSeenIdx = -1;

        for (let i = 0; i < end; i++) {
          const numbers = getNumbers(data[i]);
          if (numbers.includes(num)) {
            if (currentGap === -1) {
              // 首次出现，记录当前遗漏值
              currentGap = i;
            }
            if (lastSeenIdx !== -1) {
              // 计算两次出现之间的间隔
              const gap = i - lastSeenIdx;
              maxGap = Math.max(maxGap, gap);
              totalGap += gap;
              gapCount++;
            }
            lastSeenIdx = i;
          }
        }

        // 如果从未出现过
        if (currentGap === -1) {
          currentGap = end;
        }

        // 末尾遗漏也纳入统计
        if (lastSeenIdx !== -1 && lastSeenIdx < end - 1) {
          const tailGap = end - 1 - lastSeenIdx;
          maxGap = Math.max(maxGap, tailGap);
          totalGap += tailGap;
          gapCount++;
        }

        // 首次出现前的遗漏也算
        if (currentGap > 0) {
          maxGap = Math.max(maxGap, currentGap);
        }

        const avg = gapCount > 0 ? Math.round((totalGap / gapCount) * 100) / 100 : currentGap;

        result.set(num, { current: currentGap, max: maxGap, avg });
      }

      return result;
    }

    return {
      front: analyzeZone(d => d.front, FRONT_MIN, FRONT_MAX),
      back: BACK_COUNT > 0 ? analyzeZone(d => d.back, BACK_MIN, BACK_MAX) : new Map()
    };
  }

  // ============================================================
  // 4. 奇偶分析
  // ============================================================

  /**
   * 分析前区号码的奇偶比分布
   * @param {Array} data - 开奖数据
   * @returns {Object} 奇偶比分布 { '5:0': count, '4:1': count, ... }
   */
  function oddEvenAnalysis(data) {
    updateLotteryParams(detectLotteryType(data));
    const isPl3 = detectLotteryType(data) === 'pl3';
    const distribution = isPl3 ? {
      '3:0': 0, '2:1': 0, '1:2': 0, '0:3': 0
    } : {
      '5:0': 0, '4:1': 0, '3:2': 0,
      '2:3': 0, '1:4': 0, '0:5': 0
    };

    for (const draw of data) {
      const oddCount = draw.front.filter(n => n % 2 === 1).length;
      const evenCount = FRONT_COUNT - oddCount;
      const key = `${oddCount}:${evenCount}`;
      if (distribution[key] !== undefined) {
        distribution[key]++;
      }
    }

    return distribution;
  }

  // ============================================================
  // 5. 和值分析
  // ============================================================

  /**
   * 计算前区号码的和值统计
   * @param {Array} data - 开奖数据
   * @returns {{ sums, avg, min, max, stdDev, distribution }}
   */
  function sumAnalysis(data) {
    const sums = data.map(draw => draw.front.reduce((a, b) => a + b, 0));

    if (sums.length === 0) {
      return {
        sums: [],
        avg: 0,
        min: 0,
        max: 0,
        stdDev: 0,
        distribution: new Map()
      };
    }

    const avg = Math.round((sums.reduce((a, b) => a + b, 0) / sums.length) * 100) / 100;
    const minVal = Math.min(...sums);
    const maxVal = Math.max(...sums);
    const sd = Math.round(stdDev(sums) * 100) / 100;

    // 将和值范围等分为 10 个桶
    const bucketSize = Math.max(1, Math.ceil((maxVal - minVal + 1) / 10));
    const distribution = new Map();

    for (let i = 0; i < 10; i++) {
      const lo = minVal + i * bucketSize;
      const hi = Math.min(lo + bucketSize - 1, maxVal);
      const label = `${lo}-${hi}`;
      distribution.set(label, 0);
    }

    for (const s of sums) {
      const bucketIdx = Math.min(Math.floor((s - minVal) / bucketSize), 9);
      const lo = minVal + bucketIdx * bucketSize;
      const hi = Math.min(lo + bucketSize - 1, maxVal);
      const label = `${lo}-${hi}`;
      distribution.set(label, (distribution.get(label) || 0) + 1);
    }

    return { sums, avg, min: minVal, max: maxVal, stdDev: sd, distribution };
  }

  // ============================================================
  // 6. 大小分析
  // ============================================================

  /**
   * 前区大小比分布（大号 >= 18，小号 < 18）
   * @param {Array} data - 开奖数据
   * @returns {Object} 大小比分布
   */
  function bigSmallAnalysis(data) {
    updateLotteryParams(detectLotteryType(data));
    const isPl3 = detectLotteryType(data) === 'pl3';
    const distribution = isPl3 ? {
      '3:0': 0, '2:1': 0, '1:2': 0, '0:3': 0
    } : {
      '5:0': 0, '4:1': 0, '3:2': 0,
      '2:3': 0, '1:4': 0, '0:5': 0
    };

    for (const draw of data) {
      const threshold = isPl3 ? 5 : 18;
      const bigCount = draw.front.filter(n => n >= threshold).length;
      const smallCount = FRONT_COUNT - bigCount;
      const key = `${bigCount}:${smallCount}`;
      if (distribution[key] !== undefined) {
        distribution[key]++;
      }
    }

    return distribution;
  }

  // ============================================================
  // 7. 连号分析
  // ============================================================

  /**
   * 分析前区号码中连号出现的频率
   * 统计每期中有 0/1/2/3+ 组连号的情况
   * @param {Array} data - 开奖数据
   * @returns {{ 0: count, 1: count, 2: count, '3+': count }}
   */
  // ============================================================
  // 8. 生成单注预测
  // ============================================================

  /**
   * 构建前区号码的伴生概率矩阵 (Co-occurrence Matrix)
   * 使用 lift 归一化，避免把号码自身高频误当成强关联。
   */
  function buildCoOccurrenceMatrix(data, dataEnd) {
    const isPl3 = detectLotteryType(data) === 'pl3';
    const size = isPl3 ? 10 : 36;
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));
    const appearances = Array(size).fill(0);
    const end = dataEnd != null ? dataEnd : data.length;

    for (let i = 0; i < end; i++) {
      const front = data[i].front;
      for (const num of front) {
        if (num < size) {
          appearances[num]++;
        }
      }
      for (let i = 0; i < front.length; i++) {
        for (let j = i + 1; j < front.length; j++) {
          if (front[i] < size && front[j] < size) {
            matrix[front[i]][front[j]]++;
            matrix[front[j]][front[i]]++;
          }
        }
      }
    }

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i === j) {
          matrix[i][j] = 1;
          continue;
        }
        const expected = end > 0 ? (appearances[i] * appearances[j]) / end : 0;
        matrix[i][j] = expected > 0 ? matrix[i][j] / expected : 1;
      }
    }

    return matrix;
  }

  // ============================================================
  // 元层信号 1：transitionSignal（跨号码关系——区间聚集 → 反向加权）
  // ============================================================

  /**
   * 计算每个号码的 transitionSignal 权重
   * 思路：近 N 期前区在 5 个区间（1-7/8-14/15-21/22-28/29-35）的密度，
   *       密度过高的区间本期降权，过低的区间本期升权（反聚集）。
   * @returns {Map<number, number>} 每个号码的 transitionSignal 权重（约 0.85-1.15）
   */
  function computeTransitionSignal(data, dataEnd) {
    updateLotteryParams(detectLotteryType(data));
    const end = Math.min(dataEnd != null ? dataEnd : data.length, data.length);
    const sig = `transition:${_dataSignature(data, end)}`;
    if (_transitionCache.sig === sig) return _transitionCache.result;

    const result = new Map();
    const periods = Math.min(TRANSITION_CONFIG.analysisPeriod, end);
    const expectedPerZone = (periods * FRONT_COUNT) / TRANSITION_CONFIG.zoneCount;

    // 1) 统计近 N 期每个区间的出现密度
    const zoneCounts = Array(TRANSITION_CONFIG.zoneCount).fill(0);
    for (let i = 0; i < periods; i++) {
      for (const num of data[i].front) {
        if (num >= FRONT_MIN && num <= FRONT_MAX) {
          const zoneIdx = Math.min(
            TRANSITION_CONFIG.zoneCount - 1,
            Math.floor((num - 1) / TRANSITION_CONFIG.zoneSize)
          );
          zoneCounts[zoneIdx]++;
        }
      }
    }

    // 2) 计算每个区间的 transition weight
    const zoneWeights = zoneCounts.map(count => {
      const ratio = expectedPerZone > 0 ? count / expectedPerZone : 1.0;
      if (ratio > TRANSITION_CONFIG.overHeatRatio) {
        // 过热 → 降权 (1 - adjustFactor)
        return 1.0 - TRANSITION_CONFIG.adjustFactor;
      } else if (ratio < TRANSITION_CONFIG.underHeatRatio) {
        // 过冷 → 升权 (1 + adjustFactor)
        return 1.0 + TRANSITION_CONFIG.adjustFactor;
      }
      return 1.0;
    });

    // 3) 把区间权重映射到每个号码
    for (let num = FRONT_MIN; num <= FRONT_MAX; num++) {
      const zoneIdx = Math.min(
        TRANSITION_CONFIG.zoneCount - 1,
        Math.floor((num - 1) / TRANSITION_CONFIG.zoneSize)
      );
      result.set(num, zoneWeights[zoneIdx]);
    }
    _transitionCache.sig = sig;
    _transitionCache.result = result;
    return result;
  }

  // ============================================================
  // 元层信号 1.5：recentFrequency（v2026-06-22 复盘后新增）
  // - 前区：近 20 期出现频率，0/偏少 → 降权，偏高 → 升权
  // - 后区：近 30 期出现频率（更短窗口但更严的惩罚）
  // 复盘发现：号码 31/18/11 是引擎爱选但 0 命中的黑洞（近 20 期出现 < 期望一半）
  //         后区 9/6 选 22/25 次 0 命中
  // ============================================================

  /**
   * 计算每个号码的"近期表现权重"
   * @param {Array} data
   * @param {number} dataEnd
   * @param {object} opts - { window, pickCount, min, max, zone }
   * @returns {Map<number, number>}
   */
  function computeRecentFrequency(data, dataEnd, opts) {
    const min = opts.min;
    const max = opts.max;
    const end = Math.min(dataEnd != null ? dataEnd : data.length, data.length);
    const window = Math.min(opts.window, end);
    const pickCount = opts.pickCount;
    const expected = window * pickCount / (max - min + 1);
    const getNumbers = opts.zone === 'back' ? (d) => d.back || [] : (d) => d.front;
    const result = new Map();
    for (let num = min; num <= max; num++) {
      let count = 0;
      for (let i = 0; i < window; i++) {
        const nums = getNumbers(data[i]);
        if (nums && nums.includes(num)) count++;
      }
      const ratio = expected > 0 ? count / expected : 1.0;
      let weight = 1.0;
      if (count === 0) weight = RECENT_FREQ_CONFIG.absentPenalty;
      else if (ratio < 0.33) weight = RECENT_FREQ_CONFIG.absentPenalty;
      else if (ratio < 0.5) weight = RECENT_FREQ_CONFIG.underHalfPenalty;
      else if (ratio < 0.85) weight = RECENT_FREQ_CONFIG.underThirdPenalty;
      else if (ratio > 1.5) weight = RECENT_FREQ_CONFIG.overHotBoost;
      result.set(num, weight);
    }
    return result;
  }

  // ============================================================
  // 元层信号 2：biasDetector（区间/尾数/AC 聚集 → 反聚集权重）
  // ============================================================

  /**
   * 检测最近 N 期的偏态信号
   * @returns {{ zone: {detected, hotZoneIdx, weight}, tail: {detected, hotTail, weight}, ac: {detected, weight}, severity: number }}
   */
  function detectBias(data, dataEnd) {
    updateLotteryParams(detectLotteryType(data));
    const end = Math.min(dataEnd != null ? dataEnd : data.length, data.length);
    const sig = `bias:${_dataSignature(data, end)}`;
    if (_biasCache.sig === sig) return _biasCache.result;

    const window = Math.min(BIAS_CONFIG.window, end);
    if (window <= 0) {
      const neutral = {
        zone: { detected: false, hotZoneIdx: -1, weight: 1.0 },
        tail: { detected: false, hotTail: -1, weight: 1.0 },
        ac: { detected: false, weight: 1.0 },
        severity: 0
      };
      _biasCache.sig = sig;
      _biasCache.result = neutral;
      return neutral;
    }
    const expectedPerZone = (window * FRONT_COUNT) / TRANSITION_CONFIG.zoneCount;

    // 1) 区间聚集检测
    const zoneCounts = Array(TRANSITION_CONFIG.zoneCount).fill(0);
    const tailCounts = new Map();
    let lowAcCount = 0;
    for (let i = 0; i < window; i++) {
      const draw = data[i];
      for (const num of draw.front) {
        if (num >= FRONT_MIN && num <= FRONT_MAX) {
          const zoneIdx = Math.min(
            TRANSITION_CONFIG.zoneCount - 1,
            Math.floor((num - 1) / TRANSITION_CONFIG.zoneSize)
          );
          zoneCounts[zoneIdx]++;
          const tail = num % 10;
          tailCounts.set(tail, (tailCounts.get(tail) || 0) + 1);
        }
      }
      // 复用 calculateACValue（ac 范围 0-6，阈值见 BIAS_CONFIG.acThreshold）
      if (calculateACValue(draw.front) <= BIAS_CONFIG.acThreshold) lowAcCount++;
    }

    // 区间聚集
    let zoneDetected = false;
    let hotZoneIdx = -1;
    let zoneBoost = 1.0;
    for (let i = 0; i < TRANSITION_CONFIG.zoneCount; i++) {
      if (zoneCounts[i] / expectedPerZone >= BIAS_CONFIG.zoneOverHeatRatio) {
        zoneDetected = true;
        hotZoneIdx = i;
        zoneBoost = 1.0 + BIAS_CONFIG.counterBoost;
        break;
      }
    }

    // 尾数聚集
    let tailDetected = false;
    let hotTail = -1;
    let tailBoost = 1.0;
    const tailThreshold = window * FRONT_COUNT * BIAS_CONFIG.tailConcentrate;
    for (const [tail, count] of tailCounts) {
      if (count >= tailThreshold) {
        tailDetected = true;
        hotTail = tail;
        tailBoost = 1.0 + BIAS_CONFIG.counterBoost;
        break;
      }
    }

    // AC 聚集
    let acDetected = false;
    let acBoost = 1.0;
    if (lowAcCount / window >= BIAS_CONFIG.acConcentrate) {
      acDetected = true;
      acBoost = 1.0 + BIAS_CONFIG.counterBoost;
    }

    const severity = (zoneDetected ? 1 : 0) + (tailDetected ? 1 : 0) + (acDetected ? 1 : 0);

    const result = {
      zone: { detected: zoneDetected, hotZoneIdx, weight: zoneBoost },
      tail: { detected: tailDetected, hotTail, weight: tailBoost },
      ac: { detected: acDetected, weight: acBoost },
      severity
    };
    _biasCache.sig = sig;
    _biasCache.result = result;
    return result;
  }

  // ============================================================
  // 元层信号 3：computeOverKillWarn（误杀预警层）
  // ============================================================

  /**
   * 在评分输出后处理：得分处于 25%-50% 分位的号码标为"误杀预警"
   * 用 s.rawComposite（号码综合得分，独立于具体选号策略）排序，
   * 避免之前用 s.composite=0 导致预警集合跟数据无关的 bug。
   * @param {Map<number, {rawComposite?: number}>} scores
   * @returns {Set<number>} 误杀预警号码集合
   */
  function computeOverKillWarn(scores) {
    if (!scores || scores.size === 0) return new Set();
    const values = Array.from(scores.entries())
      .map(([num, s]) => ({ num, score: s.rawComposite != null ? s.rawComposite : 0 }))
      .filter(v => Number.isFinite(v.score));
    if (values.length === 0) return new Set();
    values.sort((a, b) => a.score - b.score);
    const hardCutoff = Math.floor(values.length * _overKillRuntime.hardKillPercentile);
    const warnCutoff = Math.floor(values.length * _overKillRuntime.warnPercentile);
    const warn = new Set();
    for (let i = hardCutoff; i < warnCutoff && i < values.length; i++) {
      warn.add(values[i].num);
    }
    return warn;
  }

  // ============================================================
  // 误杀预警命中率回写校准
  // ============================================================

  /**
   * 根据历史预警命中率反向校准阈值
   * @param {object} stats - { totalPredictions, totalWarned, totalWarnHit, currentHitRate }
   *   - totalPredictions: 累计参与回测的预测期数
   *   - totalWarned: 累计预警号码总数
   *   - totalWarnHit: 累计预警号码实际开奖命中数
   *   - currentHitRate: 当前命中率 = totalWarnHit / totalWarned
   * 校准规则：
   *   - 命中率 < 30% → 预警太多，缩紧阈值 (warnPercentile 减少 0.05，下限 0.35)
   *   - 命中率 > 60% → 预警太准，可放宽阈值 (warnPercentile 增加 0.05，上限 0.60)
   *   - 30% ≤ 命中率 ≤ 60% → 保持不变
   */
  function calibrateOverKill(stats) {
    if (!stats || typeof stats.currentHitRate !== 'number') return _overKillRuntime;
    const rate = stats.currentHitRate;
    if (rate < 0.30 && _overKillRuntime.warnPercentile > 0.35) {
      _overKillRuntime.warnPercentile = Math.max(0.35, _overKillRuntime.warnPercentile - 0.05);
    } else if (rate > 0.60 && _overKillRuntime.warnPercentile < 0.60) {
      _overKillRuntime.warnPercentile = Math.min(0.60, _overKillRuntime.warnPercentile + 0.05);
    }
    return Object.assign({}, _overKillRuntime);
  }

  function getOverKillRuntime() {
    return Object.assign({}, _overKillRuntime);
  }

  function resetOverKillRuntime() {
    _overKillRuntime.hardKillPercentile = OVERKILL_CONFIG.hardKillPercentile;
    _overKillRuntime.warnPercentile = OVERKILL_CONFIG.warnPercentile;
    _overKillRuntime.warnBoost = OVERKILL_CONFIG.warnBoost;
  }

  function computeScores(data, dataEnd) {
    updateLotteryParams(detectLotteryType(data));

    const effectiveEnd = Math.min(dataEnd != null ? dataEnd : data.length, data.length);
    const scopedData = data.slice(0, effectiveEnd);
    const gapData = gapAnalysis(data, effectiveEnd);
    const freqData = frequencyAnalysis(data, effectiveEnd);
    const hotCold = hotColdAnalysis(data, 300, effectiveEnd);
    const isPl3 = detectLotteryType(data) === 'pl3';

    function scoreZone(min, max, gapMap, freqMap, hotColdInfo, totalDraws, pickCount) {
      const scores = new Map();

      // 获取所有遗漏值用于归一化
      const allGaps = [];
      for (let num = min; num <= max; num++) {
        allGaps.push(gapMap.get(num).current);
      }
      const gapMin = Math.min(...allGaps);
      const gapMax = Math.max(...allGaps);

      // 计算每个号码的近期趋势（滑动窗口）
      const windowSize = 10;
      const windows = [
        scopedData.slice(0, windowSize),
        scopedData.slice(windowSize, windowSize * 2),
        scopedData.slice(windowSize * 2, windowSize * 3)
      ];

      for (let num = min; num <= max; num++) {
        const gap = gapMap.get(num);
        const freq = freqMap.get(num);

        // 遗漏得分：遗漏越大得分越高
        const gapScore = normalize(gap.current, gapMin, gapMax);

        // 期望频率
        const expectedFreq = totalDraws * pickCount / (max - min + 1);
        // 频率偏差得分：偏离期望越远得分越高
        const deviation = Math.abs(freq - expectedFreq) / (expectedFreq || 1);
        const freqDeviationScore = Math.min(deviation, 1);

        // 近期趋势得分：近期出现次数递增则上升趋势
        const windowCounts = windows.map(w => {
          return w.filter(d => {
            const nums = (min <= 12 && max <= 12 && !isPl3) ? d.back : d.front;
            return nums.includes(num);
          }).length;
        });

        // 双窗口趋势对比：近 10 期 vs 近 50 期
        // 若近 10 期出现次数 / 期望 >= 1.5 视为 emergingHot（突然升温）
        const shortPeriod = Math.min(TREND_DUAL_WINDOW_CONFIG.shortWindow, totalDraws);
        const longPeriod = Math.min(TREND_DUAL_WINDOW_CONFIG.longWindow, totalDraws);
        let shortCount = 0;
        let longCount = 0;
        for (let i = 0; i < shortPeriod; i++) {
          const nums = (min <= 12 && max <= 12 && !isPl3) ? scopedData[i].back : scopedData[i].front;
          if (nums && nums.includes(num)) shortCount++;
        }
        for (let i = 0; i < longPeriod; i++) {
          const nums = (min <= 12 && max <= 12 && !isPl3) ? scopedData[i].back : scopedData[i].front;
          if (nums && nums.includes(num)) longCount++;
        }
        // 期望 longPeriod × pickCount / (max - min + 1)
        const expectedLong = longPeriod * pickCount / (max - min + 1);
        const emergingRatio = expectedLong > 0 ? (longCount / expectedLong) : 1.0;
        const isEmergingHot = shortCount >= TREND_DUAL_WINDOW_CONFIG.shortMinCount
          && emergingRatio < TREND_DUAL_WINDOW_CONFIG.longUnderRatio;

        // 比较最近窗口与之前窗口的趋势
        let trendScore = 0.5; // 中性
        if (windowCounts[0] > windowCounts[1]) {
          trendScore = 0.7; // 上升趋势
        } else if (windowCounts[0] < windowCounts[1]) {
          trendScore = 0.3; // 下降趋势
        }
        if (windowCounts.length >= 3 && windowCounts[0] > windowCounts[2]) {
          trendScore += 0.1;
        }
        if (isEmergingHot) {
          trendScore += TREND_DUAL_WINDOW_CONFIG.trendBoost;
        }
        trendScore = Math.min(1, Math.max(0, trendScore));

        // 冷热状态
        let status = 'warm';
        if (hotColdInfo.hot.includes(num)) status = 'hot';
        else if (hotColdInfo.cold.includes(num)) status = 'cold';

        // rawComposite：号码综合得分（不依赖具体选号策略，供 computeOverKillWarn 排序用）
        const statusScore = status === 'hot' ? RAW_COMPOSITE_WEIGHTS.statusHot
          : status === 'cold' ? RAW_COMPOSITE_WEIGHTS.statusCold
          : RAW_COMPOSITE_WEIGHTS.statusWarm;
        const rawComposite = gapScore * RAW_COMPOSITE_WEIGHTS.gap
          + freqDeviationScore * RAW_COMPOSITE_WEIGHTS.freqDev
          + trendScore * RAW_COMPOSITE_WEIGHTS.trend
          + statusScore;

        scores.set(num, {
          gapScore,
          freqDeviationScore,
          trendScore,
          status,
          currentGap: gap.current,
          frequency: freq,
          rawComposite: Number(rawComposite.toFixed(4)),
          composite: 0, // 策略级别的最终权重（selectByStrategy 阶段）
          emergingHot: isEmergingHot
        });
      }

      return scores;
    }

    // 元层信号注入：transitionSignal / biasDetector / overKillWarn / recentFrequency
    const transitionSignal = computeTransitionSignal(data, effectiveEnd);
    const biasReport = detectBias(data, effectiveEnd);
    // v2026-06-22: 近 20 期前区 / 近 30 期后区的"短期表现"信号
    const frontRecentFreq = computeRecentFrequency(data, effectiveEnd, {
      window: RECENT_FREQ_CONFIG.frontWindow, pickCount: FRONT_COUNT,
      min: FRONT_MIN, max: FRONT_MAX, zone: 'front'
    });
    const backRecentFreq = isPl3 ? new Map() : computeRecentFrequency(data, effectiveEnd, {
      window: RECENT_FREQ_CONFIG.backWindow, pickCount: BACK_COUNT,
      min: BACK_MIN, max: BACK_MAX, zone: 'back'
    });

    const injectMetaSignals = (scores, recentFreqMap, zone = 'front') => {
      const isFrontZone = zone === 'front';
      for (const [num, s] of scores) {
        s.transitionWeight = isFrontZone ? (transitionSignal.get(num) || 1.0) : 1.0;
        // bias 只作用于前区；后区没有区间/AC 结构，避免跨区误加权。
        let biasWeight = 1.0;
        if (isFrontZone && biasReport.tail.detected) {
          if ((num % 10) === biasReport.tail.hotTail) {
            // 该号码与聚集尾数同尾 → 反而降权
            biasWeight *= 0.85;
          } else {
            biasWeight *= 1.05;
          }
        }
        if (isFrontZone && biasReport.zone.detected) {
          const zoneIdx = Math.min(
            TRANSITION_CONFIG.zoneCount - 1,
            Math.floor((num - 1) / TRANSITION_CONFIG.zoneSize)
          );
          if (zoneIdx === biasReport.zone.hotZoneIdx) {
            biasWeight *= 0.9;
          }
        }
        // AC 聚集 → 升权号码 AC（提高组合复杂度，破坏聚集模式）
        if (isFrontZone && biasReport.ac.detected) {
          if (num >= 18) biasWeight *= (1.0 + BIAS_CONFIG.counterBoost * 0.5);
        }
        s.biasWeight = biasWeight;
        // v2026-06-22: 近期表现（近 20/30 期窗口）— 短期超冷号码降权
        s.recentFreqWeight = (recentFreqMap && recentFreqMap.get(num)) || 1.0;
      }
      return scores;
    };

    const frontScores = injectMetaSignals(
      scoreZone(FRONT_MIN, FRONT_MAX, gapData.front, freqData.front, hotCold.front, effectiveEnd, FRONT_COUNT),
      frontRecentFreq,
      'front'
    );
    const backScores = isPl3
      ? new Map()
      : injectMetaSignals(
        scoreZone(BACK_MIN, BACK_MAX, gapData.back, freqData.back, hotCold.back, effectiveEnd, BACK_COUNT),
        backRecentFreq,
        'back'
      );

    // 误杀预警层（在 composite 计算前先标)
    const frontOverKill = computeOverKillWarn(frontScores);
    const backOverKill = isPl3 ? new Set() : computeOverKillWarn(backScores);
    for (const [num, s] of frontScores) {
      s.overKillWarn = frontOverKill.has(num);
    }
    for (const [num, s] of backScores) {
      s.overKillWarn = backOverKill.has(num);
    }

    return {
      frontScores,
      backScores,
      hotCold,
      transitionSignal,
      biasReport,
      overKillWarn: { front: frontOverKill, back: backOverKill }
    };
  }

  function computePL3PositionScores(data, dataEnd) {
    const end = dataEnd != null ? dataEnd : data.length;
    const scopedData = data.slice(0, end);
    const windowSize = 10;
    const windows = [
      scopedData.slice(0, windowSize),
      scopedData.slice(windowSize, windowSize * 2),
      scopedData.slice(windowSize * 2, windowSize * 3)
    ];

    return [0, 1, 2].map(pos => {
      const freq = new Map();
      const currentGap = new Map();
      const gapTotals = new Map();
      const gapCounts = new Map();
      const maxGaps = new Map();
      const lastSeen = new Map();

      for (let num = 0; num <= 9; num++) {
        freq.set(num, 0);
        currentGap.set(num, -1);
        gapTotals.set(num, 0);
        gapCounts.set(num, 0);
        maxGaps.set(num, 0);
        lastSeen.set(num, -1);
      }

      const total = scopedData.length;
      for (let i = 0; i < total; i++) {
        const draw = scopedData[i];
        const num = draw.front[pos];
        const weight = total > 1 ? 1.5 - (i / (total - 1)) : 1.0;
        freq.set(num, (freq.get(num) || 0) + weight);

        if (currentGap.get(num) === -1) {
          currentGap.set(num, i);
        }

        const previous = lastSeen.get(num);
        if (previous !== -1) {
          const gap = i - previous;
          maxGaps.set(num, Math.max(maxGaps.get(num), gap));
          gapTotals.set(num, gapTotals.get(num) + gap);
          gapCounts.set(num, gapCounts.get(num) + 1);
        }
        lastSeen.set(num, i);
      }

      for (let num = 0; num <= 9; num++) {
        if (currentGap.get(num) === -1) {
          currentGap.set(num, scopedData.length);
        }
        const last = lastSeen.get(num);
        if (last !== -1 && last < scopedData.length - 1) {
          const tailGap = scopedData.length - 1 - last;
          maxGaps.set(num, Math.max(maxGaps.get(num), tailGap));
          gapTotals.set(num, gapTotals.get(num) + tailGap);
          gapCounts.set(num, gapCounts.get(num) + 1);
        }
        if (currentGap.get(num) > 0) {
          maxGaps.set(num, Math.max(maxGaps.get(num), currentGap.get(num)));
        }
      }

      const gaps = Array.from(currentGap.values());
      const gapMin = Math.min(...gaps);
      const gapMax = Math.max(...gaps);
      const expectedFreq = scopedData.length / 10;
      const freqValues = Array.from(freq.entries()).map(([num, count]) => ({ num, count }));
      const sortedFreq = freqValues.slice().sort((a, b) => a.count - b.count);
      const coldSet = new Set(sortedFreq.slice(0, 3).map(item => item.num));
      const hotSet = new Set(sortedFreq.slice(-3).map(item => item.num));

      const scores = new Map();
      for (let num = 0; num <= 9; num++) {
        const windowCounts = windows.map(w => w.filter(draw => draw.front[pos] === num).length);
        let trendScore = 0.5;
        if (windowCounts[0] > windowCounts[1]) {
          trendScore = 0.7;
        } else if (windowCounts[0] < windowCounts[1]) {
          trendScore = 0.3;
        }
        if (windowCounts[0] > windowCounts[2]) {
          trendScore += 0.1;
        }
        trendScore = Math.min(1, Math.max(0, trendScore));

        let status = 'warm';
        if (hotSet.has(num)) status = 'hot';
        else if (coldSet.has(num)) status = 'cold';

        const deviation = Math.abs(freq.get(num) - expectedFreq) / (expectedFreq || 1);
        scores.set(num, {
          gapScore: normalize(currentGap.get(num), gapMin, gapMax),
          freqDeviationScore: Math.min(deviation, 1),
          trendScore,
          status,
          currentGap: currentGap.get(num),
          frequency: freq.get(num),
          maxGap: maxGaps.get(num),
          avgGap: gapCounts.get(num) > 0
            ? Math.round((gapTotals.get(num) / gapCounts.get(num)) * 100) / 100
            : currentGap.get(num)
        });
      }

      return scores;
    });
  }

  function createPredictionContext(data, dataEnd) {
    const type = detectLotteryType(data);
    updateLotteryParams(type);

    const scoreBundle = computeScores(data, dataEnd);
    const context = {
      type,
      frontScores: scoreBundle.frontScores,
      backScores: scoreBundle.backScores,
      hotCold: scoreBundle.hotCold,
      // 元层信号：从 scoreBundle 透传（v2026-06-22）
      transitionSignal: scoreBundle.transitionSignal,
      biasReport: scoreBundle.biasReport,
      overKillWarn: scoreBundle.overKillWarn
    };

    if (type === 'pl3') {
      context.positionScores = computePL3PositionScores(data, dataEnd);
      const effectiveEnd = dataEnd != null ? dataEnd : data.length;
      context.recentKeys = new Set(data.slice(0, Math.min(10, effectiveEnd)).map(draw => draw.front.join(',')));
      context.pl3Constraints = computePL3Constraints(data, dataEnd);
    } else {
      context.coMatrix = buildCoOccurrenceMatrix(data, dataEnd);
      context.exactDrawSet = buildExactDrawSet(data, dataEnd);
      context.frontConstraints = computeFrontConstraints(data, dataEnd);
      context.backConstraints = computeBackConstraints(data, dataEnd);
      context.bollingerAnalysis = analyzeBollingerTrend(data, BOLLINGER_CONFIG, dataEnd);
    }

    return context;
  }

  function countNumbers(draws, getter, min, max) {
    const counts = new Map();
    for (let num = min; num <= max; num++) counts.set(num, 0);

    for (const draw of draws) {
      for (const num of getter(draw)) {
        if (counts.has(num)) counts.set(num, counts.get(num) + 1);
      }
    }

    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  }

  function analyzeBollingerTrend(data, config = BOLLINGER_CONFIG, dataEnd) {
    const end = dataEnd != null ? Math.min(config.analysisPeriods, dataEnd) : Math.min(config.analysisPeriods, data.length);
    const frontSums = [];
    const backSums = [];
    for (let i = 0; i < end; i++) {
      frontSums.push(data[i].front.reduce((sum, num) => sum + num, 0));
      backSums.push((data[i].back || []).reduce((sum, num) => sum + num, 0));
    }
    const middles = frontSums.map((sum, idx) => (sum + backSums[idx]) / 2);

    const avg = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const frontAvg = avg(frontSums);
    const backAvg = avg(backSums);
    const lastFiveFront = frontSums.slice(0, Math.min(5, frontSums.length));
    const lastFiveBack = backSums.slice(0, Math.min(5, backSums.length));
    const latestFrontSum = lastFiveFront[0] || 0;
    const latestBackSum = lastFiveBack[0] || 0;

    return {
      frontAvg,
      frontStd: stdDev(frontSums),
      backAvg,
      backStd: stdDev(backSums),
      middleAvg: avg(middles),
      frontTrend: latestFrontSum > avg(lastFiveFront) ? '上升' : '下降',
      backTrend: latestBackSum > avg(lastFiveBack) ? '上升' : '下降',
      hotFront: countNumbers(data.slice(0, end), draw => draw.front, 1, 35).slice(0, 10).map(([num]) => num),
      hotBack: countNumbers(data.slice(0, end), draw => draw.back || [], 1, 12).slice(0, 5).map(([num]) => num),
      latestFrontSum,
      latestBackSum,
      totalPeriods: end,
      analyzedPeriods: end
    };
  }

  function targetBollingerSum(avg, std, trend, min, max, config, rng) {
    const direction = trend === '上升' ? 1 : -1;
    const base = avg + direction * std * config.stdMultiplier;
    const spread = Math.max(1, std * 0.5);
    return Math.max(min, Math.min(max, base + gaussianRandom(rng) * spread));
  }

  function generateBollingerZoneNumbers(min, max, count, targetSum, hotNumbers, tolerance, config, rng) {
    let selected = [];
    const hotPool = hotNumbers.filter(num => num >= min && num <= max);
    const maxAttempts = 1000;

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      const useHot = hotPool.length > 0 && rng() < config.hotNumberRatio;
      const candidate = useHot
        ? hotPool[Math.floor(rng() * hotPool.length)]
        : Math.floor(rng() * (max - min + 1)) + min;

      if (!selected.includes(candidate)) {
        selected.push(candidate);
      }

      if (selected.length === count) {
        if (Math.abs(selected.reduce((sum, num) => sum + num, 0) - targetSum) <= tolerance) {
          return selected.sort((a, b) => a - b);
        }
        selected = [];
      }
    }

    const items = range(min, max).map(num => ({
      value: num,
      weight: hotPool.includes(num) ? config.hotNumberRatio : (1 - config.hotNumberRatio)
    }));
    return weightedSample(items, count, rng);
  }

  function generateBollingerPrediction(data, context, rng) {
    const config = BOLLINGER_CONFIG;
    const analysis = context.bollingerAnalysis || analyzeBollingerTrend(data, config);
    const targetFrontSum = targetBollingerSum(analysis.frontAvg, analysis.frontStd, analysis.frontTrend, 50, 140, config, rng);
    const targetBackSum = targetBollingerSum(analysis.backAvg, analysis.backStd, analysis.backTrend, 5, 20, config, rng);

    const front = generateBollingerZoneNumbers(
      1,
      35,
      5,
      targetFrontSum,
      analysis.hotFront,
      config.frontSumTolerance,
      config,
      rng
    );
    const back = generateBollingerZoneNumbers(
      1,
      12,
      2,
      targetBackSum,
      analysis.hotBack,
      config.backSumTolerance,
      config,
      rng
    );

    return {
      front,
      back,
      analysis,
      targets: {
        frontSum: Math.round(targetFrontSum * 100) / 100,
        backSum: Math.round(targetBackSum * 100) / 100
      }
    };
  }

  /**
   * 根据策略和评分选号
   * @param {Map} scores - 号码评分
   * @param {string} strategy - 策略名
   * @param {number} count - 选号数量
   * @returns {number[]} 选中号码
   */
  // 合成元层权重：加性 + clamp，避免累乘失控
  // 返回 multiplier（约 0.60-1.40）
  function computeMetaWeight(s) {
    const transitionDelta = (s.transitionWeight || 1.0) - 1.0;
    const biasDelta = (s.biasWeight || 1.0) - 1.0;
    const emergingDelta = s.emergingHot ? 0.10 : 0.0;
    const overKillDelta = s.overKillWarn ? META_WEIGHT_CONFIG.overKillBoost : 0.0;
    // v2026-06-22: recentFreqWeight 已直接是 multiplier 形式（0.5-1.15），转 delta
    const recentFreqDelta = ((s.recentFreqWeight || 1.0) - 1.0);
    const total = transitionDelta + biasDelta + emergingDelta + overKillDelta + recentFreqDelta;
    const clamped = Math.max(-META_WEIGHT_CONFIG.maxAbs, Math.min(META_WEIGHT_CONFIG.maxAbs, total));
    return 1.0 + clamped;
  }

  // 5 策略风格差异化（v2026-06-22 复盘后加）
  // 复盘发现 5 个策略选号风格趋同（温 89-98%，冷 0%）— 让 hot/cold/gap 真的偏
  // 返回 multiplier（hot 选热号升权，cold 选冷号升权，gap 选遗漏大号升权）
  function getStyleBoost(strategy, s) {
    if (strategy === 'hot' && s.status === 'hot') return 1.50;
    if (strategy === 'cold' && s.status === 'cold') return 1.50;
    if (strategy === 'gap' && (s.gapScore || 0) > 0.6) return 1.40;
    if (strategy === 'balanced') return 1.0;
    return 1.0;
  }

  function selectByStrategy(scores, strategy, count, coMatrix = null, rng = Math.random) {
    if (strategy === 'balanced' && count === FRONT_COUNT) {
      // 保持原有黄金比例抽样
      const targetHotCount = rng() < 0.6 ? 1 : 2;
      const targetWarmCount = targetHotCount === 1 ? 3 : 2;
      const targetColdCount = 1;

      const hotPool = [], warmPool = [], coldPool = [];
      const weights = { gap: 0.3, freqDev: 0.3, trend: 0.3 };

      for (const [num, s] of scores) {
        const baseScore = s.gapScore * weights.gap + s.freqDeviationScore * weights.freqDev + s.trendScore * weights.trend;
        const meta = computeMetaWeight(s);
        const style = getStyleBoost(strategy, s);
        const item = { value: num, weight: Math.max(0.01, baseScore * meta * style + rng() * 0.15) };
        if (s.status === 'hot') hotPool.push(item);
        else if (s.status === 'cold') coldPool.push(item);
        else warmPool.push(item);
      }

      const selected = [];
      if (hotPool.length >= targetHotCount && warmPool.length >= targetWarmCount && coldPool.length >= targetColdCount) {
        selected.push(...weightedSample(hotPool, targetHotCount, rng));
        selected.push(...weightedSample(warmPool, targetWarmCount, rng));
        selected.push(...weightedSample(coldPool, targetColdCount, rng));
        return selected.sort((a, b) => a - b);
      }
    }

    const w = getStrategyWeights(strategy);

    // 前区加入伴生矩阵动态抽样：逐个抽取，抽取后提升伴生兄弟的权重
    if (coMatrix && count === FRONT_COUNT) {
      const selected = [];
      const pool = [];
      for (const [num, s] of scores) {
        const baseScore = s.gapScore * w.gap + s.freqDeviationScore * w.freqDev + s.trendScore * w.trend;
        const bonus = w.statusBonus[s.status] || 1.0;
        const meta = computeMetaWeight(s);
        const style = getStyleBoost(strategy, s);
        pool.push({ value: num, baseWeight: baseScore * bonus * meta * style });
      }

      while (selected.length < count) {
        // 重新计算当前所有可选池的权重
        const currentItems = pool.filter(p => !selected.includes(p.value)).map(p => {
          let coBonus = 1.0;
          if (selected.length > 0) {
            // 计算与已选中号码的平均 lift，轻量奖励真实共现关系。
            let totalLift = 0;
            for (const sel of selected) {
              totalLift += coMatrix[sel][p.value] || 1;
            }
            const avgLift = totalLift / selected.length;
            coBonus = 1.0 + Math.max(-0.2, Math.min((avgLift - 1) * 0.35, 0.35));
          }
          const jitter = strategy === 'random' ? rng() * 0.5 : rng() * 0.15;
          return { value: p.value, weight: Math.max(0.01, p.baseWeight * coBonus + jitter) };
        });

        const picked = weightedSample(currentItems, 1, rng)[0];
        if(picked) selected.push(picked);
        else break;
      }
      return selected.sort((a, b) => a - b);
    }

    // 普通抽样 (后区)
    const items = [];
    for (const [num, s] of scores) {
      const baseScore = s.gapScore * w.gap + s.freqDeviationScore * w.freqDev + s.trendScore * w.trend;
      const bonus = w.statusBonus[s.status] || 1.0;
      const jitter = strategy === 'random' ? rng() * 0.5 : rng() * 0.15;
      const meta = computeMetaWeight(s);
      const style = getStyleBoost(strategy, s);
      items.push({ value: num, weight: Math.max(0.01, baseScore * bonus * meta * style + jitter) });
    }
    return weightedSample(items, count, rng);
  }

  // ============================================================
  // 胆码分层选号：先选 1-2 个胆码 → 围绕胆码按 coMatrix 补 3-4 个拖码
  // ============================================================

  /**
   * 胆码分层选号（Dan-Tuo 选号法）
   * 1) 胆码：用 hot/balanced 策略选 1-2 个高把握号码（带元信号加权）
   * 2) 拖码：从剩余号码里按 coMatrix 与胆码的共现关系补 3-4 个
   * 3) 拖码权重 = baseScore × co-lift × 元层权重
   *
   * @param {Map} frontScores
   * @param {Array<number>} matrix - 35×35 共现矩阵
   * @param {object} opts
   * @param {number} opts.danCount - 胆码数量，1 或 2
   * @param {string} opts.danStrategy - 胆码策略：hot/balanced
   * @param {function} opts.rng
   * @returns {{ danNums: number[], tuoNums: number[], front: number[] }}
   */
  function selectWithDanLayer(frontScores, coMatrix, opts = {}) {
    if (!frontScores || frontScores.size === 0) {
      return { danNums: [], tuoNums: [], front: [] };
    }
    const rng = opts.rng || Math.random;
    const danCount = opts.danCount || (rng() < 0.5 ? 1 : 2);
    const danStrategy = opts.danStrategy || (rng() < 0.5 ? 'hot' : 'balanced');

    // 1) 选胆码
    const danItems = [];
    for (const [num, s] of frontScores) {
      const baseScore = s.gapScore * 0.3 + s.freqDeviationScore * 0.3 + s.trendScore * 0.3;
      const meta = computeMetaWeight(s);
      const status = danStrategy === 'hot' && s.status === 'hot' ? 1.5 : 1.0;
      danItems.push({ value: num, weight: Math.max(0.01, baseScore * meta * status + rng() * 0.1) });
    }
    const danNums = weightedSample(danItems, danCount, rng);

    // 2) 围绕胆码按 coMatrix 补拖码
    const tuoCount = FRONT_COUNT - danNums.length;
    const tuoItems = [];
    for (const [num, s] of frontScores) {
      if (danNums.includes(num)) continue;
      const baseScore = s.gapScore * 0.3 + s.freqDeviationScore * 0.3 + s.trendScore * 0.3;
      const meta = computeMetaWeight(s);
      // 与胆码的平均 lift（几何平均，避免极端值）
      let avgLift = 1.0;
      for (const dan of danNums) {
        const lift = (coMatrix && coMatrix[dan] && coMatrix[dan][num]) || 1.0;
        avgLift *= lift;
      }
      avgLift = Math.pow(avgLift, 1 / danNums.length);
      tuoItems.push({
        value: num,
        weight: Math.max(0.01, baseScore * meta * avgLift + rng() * 0.1)
      });
    }
    const tuoNums = weightedSample(tuoItems, tuoCount, rng);

    return {
      danNums: danNums.slice().sort((a, b) => a - b),
      tuoNums: tuoNums.slice().sort((a, b) => a - b),
      front: [...danNums, ...tuoNums].sort((a, b) => a - b)
    };
  }

  /**
   * 计算前区号码的 AC 值 (Arithmetic Complexity)
   * @param {number[]} front - 选中的5个前区号码
   * @returns {number} AC 值 [0, 10]
   */
  function calculateACValue(front) {
    const sorted = front.slice().sort((a, b) => a - b);
    const diffs = new Set();
    
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        diffs.add(sorted[j] - sorted[i]);
      }
    }
    
    // AC = 差值个数 - (选号个数 - 1)
    return diffs.size - (FRONT_COUNT - 1);
  }

  function analyzeFrontShape(front) {
    const sorted = front.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const oddCount = sorted.filter(n => n % 2 === 1).length;
    const evenCount = FRONT_COUNT - oddCount;
    const bigThreshold = FRONT_MIN === 0 ? 5 : 18;
    const bigCount = sorted.filter(n => n >= bigThreshold).length;
    const smallCount = FRONT_COUNT - bigCount;

    let maxConsecutive = 1;
    let currentConsecutive = 1;
    let pairs = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] === 1) {
        currentConsecutive++;
        pairs++;
      } else {
        maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
        currentConsecutive = 1;
      }
    }
    maxConsecutive = Math.max(maxConsecutive, currentConsecutive);

    const ac = calculateACValue(front);
    const zoneSet = new Set();
    for (const num of sorted) {
      if (num <= 7) zoneSet.add(1);
      else if (num <= 14) zoneSet.add(2);
      else if (num <= 21) zoneSet.add(3);
      else if (num <= 28) zoneSet.add(4);
      else zoneSet.add(5);
    }

    const tailCounts = {};
    for (const num of sorted) {
      const tail = num % 10;
      tailCounts[tail] = (tailCounts[tail] || 0) + 1;
    }
    let tailPairsCount = 0;
    for (const count of Object.values(tailCounts)) {
      if (count === 2) tailPairsCount += 1;
      else if (count === 3) tailPairsCount += 2;
      else if (count >= 4) tailPairsCount += 3;
    }

    return {
      sorted,
      sum,
      oddCount,
      evenCount,
      oddEven: `${oddCount}:${evenCount}`,
      bigCount,
      smallCount,
      bigSmall: `${bigCount}:${smallCount}`,
      maxConsecutive,
      pairs,
      ac,
      zonesCovered: zoneSet.size,
      tailPairsCount
    };
  }

  function defaultFrontConstraints() {
    return {
      sumMin: 60,    // v2026-06-22: 63→60，避免 26065 和值 65 被约束死（实际 7 期范围 65-105）
      sumMax: 110,   // v2026-06-22: 107→110，给高位补位留余量
      allowedOddEven: new Set(['3:2', '2:3', '4:1', '1:4']),
      allowedBigSmall: new Set(['3:2', '2:3', '1:4', '4:1', '0:5']),
      maxConsecutive: 2,
      minAC: 4,
      minZonesCovered: 3,
      maxTailPairs: 2,
      minTailPairs: 0  // v2026-06-22: 新增；0 表示不强制，computeFrontConstraints 动态算
    };
  }

  function computeFrontConstraints(data, dataEnd) {
    if (!data || data.length === 0) return defaultFrontConstraints();

    const end = dataEnd != null ? dataEnd : data.length;
    const shapes = [];
    for (let i = 0; i < end; i++) {
      shapes.push(analyzeFrontShape(data[i].front));
    }
    const constraints = {
      sumMin: roundPercentile(shapes.map(shape => shape.sum), 0.15),
      sumMax: roundPercentile(shapes.map(shape => shape.sum), 0.85),
      allowedOddEven: topGroupsCovering(shapes.map(shape => shape.oddEven), 0.9),
      allowedBigSmall: topGroupsCovering(shapes.map(shape => shape.bigSmall), 0.9),
      maxConsecutive: Math.max(2, roundPercentile(shapes.map(shape => shape.maxConsecutive), 0.9)),
      minAC: Math.max(0, Math.floor(percentile(shapes.map(shape => shape.ac), 0.1))),
      minZonesCovered: Math.max(1, Math.floor(percentile(shapes.map(shape => shape.zonesCovered), 0.1))),
      maxTailPairs: Math.max(1, roundPercentile(shapes.map(shape => shape.tailPairsCount), 0.95)),
      // v2026-06-22: 新增同尾下界（用 30% 分位；不强制过高让 balanced 等策略能选）
      minTailPairs: Math.max(0, roundPercentile(shapes.map(shape => shape.tailPairsCount), 0.30))
    };

    if (constraints.sumMin > constraints.sumMax) {
      return defaultFrontConstraints();
    }

    return constraints;
  }

  function defaultBackConstraints() {
    return {
      sumMin: 7,
      sumMax: 19,
      diffMin: 1,
      diffMax: 8
    };
  }

  function computeBackConstraints(data, dataEnd) {
    if (!data || data.length === 0) return defaultBackConstraints();
    const end = dataEnd != null ? dataEnd : data.length;
    const sums = [];
    const diffs = [];
    for (let i = 0; i < end; i++) {
      const back = data[i].back || [];
      if (back.length < 2) continue;
      const sorted = back.slice().sort((a, b) => a - b);
      sums.push(sorted[0] + sorted[1]);
      diffs.push(sorted[1] - sorted[0]);
    }

    if (sums.length === 0) return defaultBackConstraints();

    return {
      sumMin: roundPercentile(sums, 0.15),
      sumMax: roundPercentile(sums, 0.85),
      diffMin: Math.max(1, Math.floor(percentile(diffs, 0.1))),
      diffMax: Math.max(1, Math.ceil(percentile(diffs, 0.9)))
    };
  }

  function defaultPL3Constraints() {
    return {
      sumMin: 9,
      sumMax: 18,
      spanMin: 3,
      spanMax: 8
    };
  }

  function computePL3Constraints(data, dataEnd) {
    if (!data || data.length === 0) return defaultPL3Constraints();

    const end = dataEnd != null ? dataEnd : data.length;
    const sums = [];
    const spans = [];
    for (let i = 0; i < end; i++) {
      const nums = data[i].front || [];
      if (nums.length < 3) continue;
      sums.push(nums.reduce((s, v) => s + v, 0));
      spans.push(Math.max(...nums) - Math.min(...nums));
    }

    if (sums.length === 0) return defaultPL3Constraints();

    return {
      sumMin: roundPercentile(sums, 0.1),
      sumMax: roundPercentile(sums, 0.9),
      spanMin: Math.max(0, Math.floor(percentile(spans, 0.1))),
      spanMax: Math.max(0, Math.ceil(percentile(spans, 0.9)))
    };
  }

  /**
   * 检验前区号码是否符合训练窗口分位数约束（和值、奇偶比、大小比、连号、AC值、区间覆盖）
   * @param {number[]} front - 选中的5个前区号码
   * @returns {{ valid: boolean, sum: number, oddEven: string, bigSmall: string, pairs: number, ac: number, zonesCovered,
      tailPairsCount: number }}
   */
  function evaluateFrontCombination(front, constraints = defaultFrontConstraints()) {
    const shape = analyzeFrontShape(front);
    const isSumValid = shape.sum >= constraints.sumMin && shape.sum <= constraints.sumMax;
    const isOddEvenValid = !constraints.allowedOddEven || constraints.allowedOddEven.has(shape.oddEven);
    const isBigSmallValid = !constraints.allowedBigSmall || constraints.allowedBigSmall.has(shape.bigSmall);
    const isConsecutiveValid = shape.maxConsecutive <= constraints.maxConsecutive;
    const isACValid = shape.ac >= constraints.minAC;
    const isZoneValid = shape.zonesCovered >= constraints.minZonesCovered;
    // v2026-06-22: 加 minTailPairs 检查（默认 0 即不强制）
    const isTailValid = shape.tailPairsCount <= constraints.maxTailPairs
      && shape.tailPairsCount >= (constraints.minTailPairs || 0);

    const valid = isSumValid && isOddEvenValid && isBigSmallValid && isConsecutiveValid && isACValid && isZoneValid && isTailValid;

    return {
      valid,
      sum: shape.sum,
      oddEven: shape.oddEven,
      bigSmall: shape.bigSmall,
      pairs: shape.pairs,
      ac: shape.ac,
      zonesCovered: shape.zonesCovered,
      tailPairsCount: shape.tailPairsCount,
      sumMin: constraints.sumMin,
      sumMax: constraints.sumMax,
      minAC: constraints.minAC,
      minZonesCovered: constraints.minZonesCovered,
      minTailPairs: constraints.minTailPairs || 0
    };
  }

  /**
   * 生成单注预测号码
   * @param {Array} data - 开奖数据
   * @param {string} strategy - 策略：cold/hot/balanced/gap/random
   * @returns {{ front, back, scores, reasoning }}
   */
  
  /**
   * 检验后区号码是否符合训练窗口分位数约束
   */
  function evaluateBackCombination(back, constraints = defaultBackConstraints()) {
    const sorted = back.slice().sort((a, b) => a - b);
    const sum = sorted[0] + sorted[1];
    const diff = sorted[1] - sorted[0];
    const valid = sum >= constraints.sumMin && sum <= constraints.sumMax && diff >= constraints.diffMin && diff <= constraints.diffMax;
    return { valid, sum, diff, ...constraints };
  }

  function generatePrediction(data, strategy = 'balanced', options = {}) {
    if (!data || data.length < 10) {
      throw new Error('数据不足，至少需要 10 期历史数据');
    }

    const isPl3 = detectLotteryType(data) === 'pl3';
    updateLotteryParams(isPl3 ? 'pl3' : 'dlt');
    const rng = options.rng || Math.random;
    const context = options.context || createPredictionContext(data, options.dataEnd);

    if (isPl3) {
      return generatePredictionPL3(data, strategy, { ...options, rng, context });
    }

    const { frontScores, backScores, coMatrix, exactDrawSet, frontConstraints, backConstraints,
      transitionSignal, biasReport, overKillWarn } = context;
    const backSoftKill = options.backSoftKill != null ? options.backSoftKill : BACK_SOFT_KILL_DEFAULT;
    const useDanLayer = options.useDanLayer === true;

    let front = [];
    let back = [];
    let evalResult = {};
    let backEvalResult = {};
    let bollingerResult = null;
    let danTuoMeta = null;  // 胆码分层元信息
    let attempts = 0;
    const maxAttempts = 500; // 断路器：为应对全量去重与复合过滤，上限提升至 500

    // 过滤与约束循环：寻找满足高阶指标且非历史一等奖的号码
    while (attempts < maxAttempts) {
      if (strategy === 'random') {
        bollingerResult = generateBollingerPrediction(data, context, rng);
        front = bollingerResult.front;
        back = bollingerResult.back;
      } else if (useDanLayer) {
        const result = selectWithDanLayer(frontScores, coMatrix, { rng });
        front = result.front;
        danTuoMeta = { danNums: result.danNums, danCount: result.danNums.length, danStrategy: 'auto' };
        back = selectByStrategy(backScores, strategy, BACK_COUNT, null, rng);
      } else {
        front = selectByStrategy(frontScores, strategy, FRONT_COUNT, coMatrix, rng);
        back = selectByStrategy(backScores, strategy, BACK_COUNT, null, rng);
      }
      evalResult = evaluateFrontCombination(front, frontConstraints);
      backEvalResult = evaluateBackCombination(back, backConstraints);

      // 全库防重复校验：绝对不能和历史上任何一期的 5+2 开奖号完全相同
      const isExactMatch = exactDrawSet && exactDrawSet.has(drawKey(front, back));

      // 后区非硬排时跳过 backEvalResult 校验
      const backPass = backSoftKill || backEvalResult.valid;
      if (evalResult.valid && backPass && !isExactMatch) {
        break;
      }
      attempts++;
    }

    // 保底机制
    if (attempts >= maxAttempts) {
      if (strategy === 'random') {
        bollingerResult = generateBollingerPrediction(data, context, rng);
        front = bollingerResult.front;
        back = bollingerResult.back;
      } else if (useDanLayer) {
        const result = selectWithDanLayer(frontScores, coMatrix, { rng });
        front = result.front;
        danTuoMeta = { danNums: result.danNums, danCount: result.danNums.length, danStrategy: 'auto' };
        back = selectByStrategy(backScores, strategy, BACK_COUNT, null, rng);
      } else {
        front = selectByStrategy(frontScores, strategy, FRONT_COUNT, coMatrix, rng);
        back = selectByStrategy(backScores, strategy, BACK_COUNT, null, rng);
      }
      evalResult = evaluateFrontCombination(front, frontConstraints);
      backEvalResult = evaluateBackCombination(back, backConstraints);
    }

    const strategyNames = {
      cold: '冷号优先',
      hot: '热号优先',
      balanced: '均衡策略',
      gap: '遗漏追号',
      random: '布林线策略',
      danTuo: '胆码分层'
    };
    const displayStrategy = useDanLayer ? 'danTuo' : strategy;

    const hotCold = context.hotCold || hotColdAnalysis(data);
    const frontHot = front.filter(n => hotCold.front.hot.includes(n));
    const frontCold = front.filter(n => hotCold.front.cold.includes(n));
    const frontWarm = front.filter(n => hotCold.front.warm.includes(n));

    const sumLabel = evalResult.sum;
    const sumVerdict = evalResult.valid ? '训练区间' : '偏离区间';
    const consecLabel = evalResult.pairs > 0 ? `有 (${evalResult.pairs}组连号)` : '无 (散号组合)';
    const tailLabel = evalResult.tailPairsCount > 0 ? `有 (${evalResult.tailPairsCount}组同尾)` : '无 (全异尾)';
    const backSumLabel = backSoftKill
      ? `观察层 (软排, 和${backEvalResult.sum})`
      : `和${backEvalResult.sum}(${backEvalResult.sumMin}-${backEvalResult.sumMax})/差${backEvalResult.diff}(${backEvalResult.diffMin}-${backEvalResult.diffMax})`;
    const bollingerLines = [];
    if (strategy === 'random' && bollingerResult) {
      const analysis = bollingerResult.analysis;
      bollingerLines.push(
        `布林趋势: 前区${analysis.frontTrend} / 后区${analysis.backTrend} | 目标和值: 前区${bollingerResult.targets.frontSum}, 后区${bollingerResult.targets.backSum}`,
        `近${analysis.analyzedPeriods}期热号池: 前区${analysis.hotFront.join(' ')} | 后区${analysis.hotBack.join(' ')}`
      );
    }

    // 元层信号摘要
    const overKillFrontNums = (overKillWarn && overKillWarn.front && Array.from(overKillWarn.front)) || [];
    const overKillBackNums = (overKillWarn && overKillWarn.back && Array.from(overKillWarn.back)) || [];
    const metaLines = [];
    if (transitionSignal) {
      const hotZones = [];
      for (let i = 1; i <= TRANSITION_CONFIG.zoneCount; i++) {
        const lo = (i - 1) * TRANSITION_CONFIG.zoneSize + 1;
        const hi = Math.min(lo + TRANSITION_CONFIG.zoneSize - 1, FRONT_MAX);
        const sampleNum = lo;
        const w = transitionSignal.get(sampleNum) || 1.0;
        if (w < 0.95) hotZones.push(`${lo}-${hi}(降权)`);
        else if (w > 1.05) hotZones.push(`${lo}-${hi}(升权)`);
      }
      if (hotZones.length) metaLines.push(`区间过渡: ${hotZones.join(', ')}`);
    }
    if (biasReport && (biasReport.zone.detected || biasReport.tail.detected || biasReport.ac.detected)) {
      const flags = [];
      if (biasReport.zone.detected) flags.push(`区间${biasReport.zone.hotZoneIdx + 1}`);
      if (biasReport.tail.detected) flags.push(`尾数${biasReport.tail.hotTail}`);
      if (biasReport.ac.detected) flags.push(`低AC`);
      metaLines.push(`偏态检测: ${flags.join('+')} 聚集 (反聚集加权)`);
    }
    if (overKillFrontNums.length > 0) {
      metaLines.push(`前区误杀预警: ${overKillFrontNums.sort((a, b) => a - b).join(' ')}`);
    }
    if (overKillBackNums.length > 0) {
      metaLines.push(`后区误杀预警: ${overKillBackNums.sort((a, b) => a - b).join(' ')}`);
    }
    if (backSoftKill) {
      metaLines.push(`后区策略: 观察层软排 (非硬约束)`);
    }
    if (useDanLayer && danTuoMeta) {
      metaLines.push(`胆码分层: 胆码 ${danTuoMeta.danCount} 个 + 拖码 ${FRONT_COUNT - danTuoMeta.danCount} 个 (coMatrix 补位)`);
    }

    const reasoning = [
      `【${strategyNames[displayStrategy] || displayStrategy} · 统计约束模型】`,
      ...bollingerLines,
      ...metaLines,
      `前区奇偶: ${evalResult.oddEven} | 大小: ${evalResult.bigSmall}`,
      `前区和值: ${sumLabel} (${evalResult.sumMin}-${evalResult.sumMax} · ${sumVerdict}) | 后区高阶: ${backSumLabel}`,
      `连号状态: ${consecLabel} | 同尾状态: ${tailLabel}`,
      `前区AC值: ${evalResult.ac} (>=${evalResult.minAC}) | 覆盖 ${evalResult.zonesCovered} 个分区 (>=${evalResult.minZonesCovered})`,
      `冷热结构: ${frontHot.length}热 / ${frontWarm.length}温 / ${frontCold.length}冷`,
      `结合${strategy === 'random' ? '布林线和值约束与70%热号抽样' : useDanLayer ? '胆码分层 + 伴生矩阵补位' : strategy === 'balanced' ? '冷热分层抽样' : '伴生概率矩阵'}、近期时间衰减权重、元层信号 (transition/bias/overKill) 及全库去重生成 (计算碰撞: ${attempts}次)`
    ].join('\n');

    // 误杀预警：标记选中的号码是否在预警集合里
    const frontOverKillHit = overKillWarn && overKillWarn.front
      ? front.filter(n => overKillWarn.front.has(n))
      : [];
    const backOverKillHit = overKillWarn && overKillWarn.back
      ? back.filter(n => overKillWarn.back.has(n))
      : [];

    return {
      front,
      back,
      scores: {
        front: frontScores,
        back: backScores
      },
      meta: {
        // 选中的号码中落在预警集合里的（交集）— 用于 UI 高亮
        overKillHit: { front: frontOverKillHit, back: backOverKillHit },
        // 完整预警集合（全集）— 用于 app.js 持久化到 record，供回测校准用
        overKillWarn: {
          front: overKillWarn && overKillWarn.front ? Array.from(overKillWarn.front) : [],
          back: overKillWarn && overKillWarn.back ? Array.from(overKillWarn.back) : []
        },
        transitionSignalApplied: !!transitionSignal,
        biasDetected: biasReport ? (biasReport.zone.detected || biasReport.tail.detected || biasReport.ac.detected) : false,
        backSoftKill,
        useDanLayer
      },
      reasoning
    };
  }

  /**
   * 排列三专属智能预测生成器
   */
  function selectPL3Digit(positionScores, strategy, rng = Math.random) {
    const w = getStrategyWeights(strategy);
    const items = Array.from(positionScores.entries()).map(([num, s]) => {
      const baseScore = s.gapScore * w.gap + s.freqDeviationScore * w.freqDev + s.trendScore * w.trend;
      const bonus = w.statusBonus[s.status] || 1.0;
      const jitter = strategy === 'random' ? rng() * 0.5 : rng() * 0.15;
      return { value: num, weight: Math.max(0.01, baseScore * bonus + jitter) };
    });
    return weightedSample(items, 1, rng)[0];
  }

  function evaluatePL3Combination(nums, constraints = defaultPL3Constraints()) {
    const sum = nums.reduce((s, v) => s + v, 0);
    const span = Math.max(...nums) - Math.min(...nums);
    return {
      valid: sum >= constraints.sumMin && sum <= constraints.sumMax && span >= constraints.spanMin && span <= constraints.spanMax,
      sum,
      span,
      sumMin: constraints.sumMin,
      sumMax: constraints.sumMax,
      spanMin: constraints.spanMin,
      spanMax: constraints.spanMax
    };
  }

  function generatePredictionPL3(data, strategy = 'balanced', options = {}) {
    const rng = options.rng || Math.random;
    const context = options.context || createPredictionContext(data, options.dataEnd);
    const positionScores = context.positionScores || computePL3PositionScores(data);
    const pl3Constraints = context.pl3Constraints || defaultPL3Constraints();

    let finalNums = [];
    let evalResult = {};
    let attempts = 0;
    const maxAttempts = 500;

    while (attempts < maxAttempts) {
      const selected = [
        selectPL3Digit(positionScores[0], strategy, rng),
        selectPL3Digit(positionScores[1], strategy, rng),
        selectPL3Digit(positionScores[2], strategy, rng)
      ];

      evalResult = evaluatePL3Combination(selected, pl3Constraints);
      const isRecentDuplicate = context.recentKeys
        ? context.recentKeys.has(selected.join(','))
        : data.slice(0, 10).some(draw => draw.front.join(',') === selected.join(','));

      if (evalResult.valid && !isRecentDuplicate) {
        finalNums = selected;
        break;
      }
      attempts++;
    }

    if (finalNums.length === 0) {
      // 兜底保底
      finalNums = [
        Math.floor(rng() * 10),
        Math.floor(rng() * 10),
        Math.floor(rng() * 10)
      ];
      evalResult = evaluatePL3Combination(finalNums, pl3Constraints);
    }

    const uniqueCount = new Set(finalNums).size;
    const patternLabel = uniqueCount === 1 ? '豹子组合' : uniqueCount === 2 ? '组三组合' : '组六组合';

    const strategyNames = {
      cold: '冷号优先',
      hot: '热号优先',
      balanced: '均衡推荐',
      gap: '遗漏回补',
      random: '布林线策略'
    };

    const reasoning = [
      `【${strategyNames[strategy] || strategy} · 排列三位置概率引擎】`,
      `号码形态: ${patternLabel} | 跨度大小: ${evalResult.span} (${evalResult.spanMin}-${evalResult.spanMax})`,
      `组合和值: ${evalResult.sum} (${evalResult.sumMin}-${evalResult.sumMax})`,
      `依据百/十/个位位置频率、遗漏与近期趋势生成 (碰撞尝试: ${attempts}次)`
    ].join('\n');

    return {
      front: finalNums,
      back: [],
      scores: {
        front: context.frontScores,
        back: new Map()
      },
      reasoning
    };
  }

  // ============================================================
  // 9. 生成多注预测
  // ============================================================

  // 固定策略顺序（之前由 evolution 权重动态排序，现在平权）
  // 新版：第一注用胆码分层（最高把握），其余 4 注按原 5 策略轮转
  function buildStrategyOrder(count) {
    const tail = Array.from({ length: Math.max(0, count - 1) }, (_, i) => DEFAULT_STRATEGIES[i % DEFAULT_STRATEGIES.length]);
    return ['danTuo', ...tail];
  }

  // 计算一注号码的"最弱号码得分"（决定 confidence tier 的地板）
  function computeMinScoreForPrediction(frontScores, backScores, front, back, strategy) {
    const w = getStrategyWeights(strategy);
    const values = [];
    const collect = (n, s) => {
      const baseScore = s.gapScore * w.gap + s.freqDeviationScore * w.freqDev + s.trendScore * w.trend;
      const meta = computeMetaWeight(s);
      const bonus = w.statusBonus[s.status] || 1.0;
      values.push(baseScore * meta * bonus);
    };
    for (const n of front) {
      if (frontScores.has(n)) collect(n, frontScores.get(n));
    }
    for (const n of back) {
      if (backScores.has(n)) collect(n, backScores.get(n));
    }
    return values.length > 0 ? Math.min(...values) : 0;
  }

  // 给 5 注按 minScore 排序打置信度标签
  function tagPredictionsWithConfidence(predictions, frontScores, backScores) {
    if (!predictions || predictions.length === 0) return predictions;
    const minScores = predictions.map(p => computeMinScoreForPrediction(
      frontScores, backScores, p.front || [], p.back || [], p.strategy
    ));
    // 拷贝以避免污染
    const sortedIdx = minScores.map((v, i) => i).sort((a, b) => minScores[b] - minScores[a]);
    const tiers = new Array(predictions.length);
    const n = predictions.length;
    // 1/3 高把握，1/3 平衡，1/3 博冷
    const highCut = Math.max(1, Math.floor(n / 3));
    const balancedCut = Math.max(highCut + 1, Math.floor((n * 2) / 3));
    for (let rank = 0; rank < n; rank++) {
      const origIdx = sortedIdx[rank];
      if (rank < highCut) tiers[origIdx] = 'high';
      else if (rank < balancedCut) tiers[origIdx] = 'balanced';
      else tiers[origIdx] = 'aggressive';
    }
    return predictions.map((p, i) => ({
      ...p,
      confidence: tiers[i],
      minScore: Number(minScores[i].toFixed(4))
    }));
  }

  /**
   * 使用多种策略生成多注预测号码
   * @param {Array} data - 开奖数据
   * @param {number} count - 生成注数，默认 5
   * @returns {Array<{ front, back, scores, reasoning, strategy, confidence, minScore }>}
   */
  function generateMultiplePredictions(data, count = 5, options = {}) {
    const strategies = buildStrategyOrder(count);
    const predictions = [];
    const context = options.context || createPredictionContext(data, options.dataEnd);
    const rng = options.rng || Math.random;
    const seen = new Set();
    const maxAttempts = Math.max(count * 25, strategies.length);
    let attempts = 0;

    while (predictions.length < count && attempts < maxAttempts) {
      const strategy = strategies[attempts % strategies.length];
      // 胆码分层策略 + 5 策略轮转
      const useDanLayer = strategy === 'danTuo';
      const realStrategy = useDanLayer ? 'balanced' : strategy;
      const prediction = generatePrediction(data, realStrategy, {
        ...options,
        rng,
        context,
        useDanLayer,
        backSoftKill: options.backSoftKill != null ? options.backSoftKill : BACK_SOFT_KILL_DEFAULT
      });
      const key = predictionKey(prediction.front, prediction.back, context.type);

      if (!seen.has(key)) {
        seen.add(key);
        predictions.push({
          ...prediction,
          strategy: useDanLayer ? 'danTuo' : strategy
        });
      }
      attempts++;
    }

    while (predictions.length < count) {
      const strategy = strategies[predictions.length % strategies.length];
      const useDanLayer = strategy === 'danTuo';
      const realStrategy = useDanLayer ? 'balanced' : strategy;
      const prediction = generatePrediction(data, realStrategy, {
        ...options,
        rng,
        context,
        useDanLayer,
        backSoftKill: options.backSoftKill != null ? options.backSoftKill : BACK_SOFT_KILL_DEFAULT
      });
      predictions.push({
        ...prediction,
        strategy: useDanLayer ? 'danTuo' : strategy
      });
    }

    // 置信度分层输出
    return tagPredictionsWithConfidence(predictions, context.frontScores, context.backScores);
  }



  // ============================================================
  // 导出全局 Predictor 对象
  // ============================================================

  window.Predictor = {
    // 分析函数
    frequencyAnalysis,
    hotColdAnalysis,
    gapAnalysis,
    oddEvenAnalysis,
    sumAnalysis,
    bigSmallAnalysis,

    // 预测函数
    generatePrediction,
    generateMultiplePredictions,

    // 工具函数（供外部使用）
    computeScores,

    // ===== 元层信号（v2026-06-22 增强） =====
    computeTransitionSignal,
    detectBias,
    computeOverKillWarn,
    selectWithDanLayer,
    tagPredictionsWithConfidence,
    computeMinScoreForPrediction,
    computeMetaWeight,
    getStyleBoost,
    calibrateOverKill,
    getOverKillRuntime,
    resetOverKillRuntime,
    computeRecentFrequency,

    // 元层配置
    TRANSITION_CONFIG,
    BIAS_CONFIG,
    OVERKILL_CONFIG,
    TREND_DUAL_WINDOW_CONFIG,
    META_WEIGHT_CONFIG,
    RAW_COMPOSITE_WEIGHTS,
    RECENT_FREQ_CONFIG,
    BACK_SOFT_KILL_DEFAULT,

    // 常量/变量获取器
    getParams: () => ({
      FRONT_MIN,
      FRONT_MAX,
      BACK_MIN,
      BACK_MAX,
      FRONT_COUNT,
      BACK_COUNT
    })
  };

})();
