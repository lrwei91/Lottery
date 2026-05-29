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

  const DEFAULT_STRATEGIES = ['cold', 'hot', 'balanced', 'gap', 'random'];

  const STRATEGY_WEIGHTS = {
    cold:     { gap: 0.3, freqDev: 0.2, trend: 0.1, statusBonus: { cold: 2.0, warm: 0.5, hot: 0.1 } },
    hot:      { gap: 0.1, freqDev: 0.2, trend: 0.4, statusBonus: { cold: 0.1, warm: 0.5, hot: 2.0 } },
    balanced: { gap: 0.3, freqDev: 0.3, trend: 0.3, statusBonus: { cold: 1.0, warm: 1.0, hot: 1.0 } },
    gap:      { gap: 0.6, freqDev: 0.1, trend: 0.1, statusBonus: { cold: 1.2, warm: 1.0, hot: 0.8 } },
    random:   { gap: 0.33, freqDev: 0.33, trend: 0.33, statusBonus: { cold: 1.0, warm: 1.0, hot: 1.0 } }
  };

  const DEFAULT_BACKTEST_PERIODS = 500;
  const DEFAULT_BACKTEST_WINDOWS = [500, 1000];
  function getDefaultBacktestSeeds() {
    const base = new Date();
    const fmt = d => parseInt(`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`);
    return [fmt(base), fmt(new Date(base - 86400000)), fmt(new Date(base - 172800000)), fmt(new Date(base - 259200000)), fmt(new Date(base - 345600000))];
  }
  const DEFAULT_BACKTEST_SEEDS_FN = getDefaultBacktestSeeds;
  const BOLLINGER_CONFIG = {
    analysisPeriods: 50,
    hotNumberRatio: 0.7,
    frontSumTolerance: 15,
    backSumTolerance: 4,
    stdMultiplier: 0.3
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

  function createSeededRandom(seed) {
    let state = (seed || 1) >>> 0;
    return function seededRandom() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function deriveSeed(seed, label) {
    let state = (seed || 1) >>> 0;
    for (let i = 0; i < label.length; i++) {
      state = Math.imul(state ^ label.charCodeAt(i), 2654435761) >>> 0;
    }
    return state || 1;
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

  function _dataSignature(data, dataEnd) {
    const len = dataEnd != null ? dataEnd : data.length;
    return `${data.length}:${len}`;
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

      const hotThreshold = Math.ceil(avgExpected * 1.15);
      const coldThreshold = Math.floor(avgExpected * 0.85);

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
  function consecutiveAnalysis(data) {
    const result = { 0: 0, 1: 0, 2: 0, '3+': 0 };

    for (const draw of data) {
      const sorted = draw.front.slice().sort((a, b) => a - b);
      let pairs = 0;

      // 计算相邻号码对数
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] - sorted[i - 1] === 1) {
          pairs++;
        }
      }

      if (pairs === 0) result[0]++;
      else if (pairs === 1) result[1]++;
      else if (pairs === 2) result[2]++;
      else result['3+']++;
    }

    return result;
  }

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

  function computeScores(data, dataEnd) {
    updateLotteryParams(detectLotteryType(data));

    const gapData = gapAnalysis(data, dataEnd);
    const freqData = frequencyAnalysis(data, dataEnd);
    const hotCold = hotColdAnalysis(data, 300, dataEnd);
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
        data.slice(0, windowSize),
        data.slice(windowSize, windowSize * 2),
        data.slice(windowSize * 2, windowSize * 3)
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
        trendScore = Math.min(1, Math.max(0, trendScore));

        // 冷热状态
        let status = 'warm';
        if (hotColdInfo.hot.includes(num)) status = 'hot';
        else if (hotColdInfo.cold.includes(num)) status = 'cold';

        scores.set(num, {
          gapScore,
          freqDeviationScore,
          trendScore,
          status,
          currentGap: gap.current,
          frequency: freq,
          composite: 0 // 会根据策略计算
        });
      }

      return scores;
    }

    const effectiveEnd = dataEnd != null ? dataEnd : data.length;
    return {
      frontScores: scoreZone(FRONT_MIN, FRONT_MAX, gapData.front, freqData.front, hotCold.front, effectiveEnd, FRONT_COUNT),
      backScores: isPl3 ? new Map() : scoreZone(BACK_MIN, BACK_MAX, gapData.back, freqData.back, hotCold.back, effectiveEnd, BACK_COUNT),
      hotCold
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
      hotCold: scoreBundle.hotCold
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
        const item = { value: num, weight: Math.max(0.01, baseScore + rng() * 0.15) };
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
        pool.push({ value: num, baseWeight: baseScore * bonus });
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
      items.push({ value: num, weight: Math.max(0.01, baseScore * bonus + jitter) });
    }
    return weightedSample(items, count, rng);
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
      sumMin: 70,
      sumMax: 125,
      allowedOddEven: new Set(['4:1', '3:2', '2:3', '1:4']),
      allowedBigSmall: new Set(['4:1', '3:2', '2:3', '1:4']),
      maxConsecutive: 2,
      minAC: 4,
      minZonesCovered: 3,
      maxTailPairs: 2
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
      sumMin: roundPercentile(shapes.map(shape => shape.sum), 0.1),
      sumMax: roundPercentile(shapes.map(shape => shape.sum), 0.9),
      allowedOddEven: topGroupsCovering(shapes.map(shape => shape.oddEven), 0.95),
      allowedBigSmall: topGroupsCovering(shapes.map(shape => shape.bigSmall), 0.95),
      maxConsecutive: Math.max(2, roundPercentile(shapes.map(shape => shape.maxConsecutive), 0.95)),
      minAC: Math.max(0, Math.floor(percentile(shapes.map(shape => shape.ac), 0.08))),
      minZonesCovered: Math.max(1, Math.floor(percentile(shapes.map(shape => shape.zonesCovered), 0.08))),
      maxTailPairs: Math.max(2, roundPercentile(shapes.map(shape => shape.tailPairsCount), 0.99))
    };

    if (constraints.sumMin > constraints.sumMax) {
      return defaultFrontConstraints();
    }

    return constraints;
  }

  function defaultBackConstraints() {
    return {
      sumMin: 6,
      sumMax: 19,
      diffMin: 1,
      diffMax: 9
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
      sumMin: roundPercentile(sums, 0.1),
      sumMax: roundPercentile(sums, 0.9),
      diffMin: Math.max(1, Math.floor(percentile(diffs, 0.05))),
      diffMax: Math.max(1, Math.ceil(percentile(diffs, 0.95)))
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
    const isTailValid = shape.tailPairsCount <= constraints.maxTailPairs;

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
      minZonesCovered: constraints.minZonesCovered
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

    const { frontScores, backScores, coMatrix, exactDrawSet, frontConstraints, backConstraints } = context;

    let front = [];
    let back = [];
    let evalResult = {};
    let backEvalResult = {};
    let bollingerResult = null;
    let attempts = 0;
    const maxAttempts = 500; // 断路器：为应对全量去重与复合过滤，上限提升至 500

    // 过滤与约束循环：寻找满足高阶指标且非历史一等奖的号码
    while (attempts < maxAttempts) {
      if (strategy === 'random') {
        bollingerResult = generateBollingerPrediction(data, context, rng);
        front = bollingerResult.front;
        back = bollingerResult.back;
      } else {
        front = selectByStrategy(frontScores, strategy, FRONT_COUNT, coMatrix, rng);
        back = selectByStrategy(backScores, strategy, BACK_COUNT, null, rng);
      }
      evalResult = evaluateFrontCombination(front, frontConstraints);
      backEvalResult = evaluateBackCombination(back, backConstraints);

      // 全库防重复校验：绝对不能和历史上任何一期的 5+2 开奖号完全相同
      const isExactMatch = exactDrawSet && exactDrawSet.has(drawKey(front, back));

      if (evalResult.valid && backEvalResult.valid && !isExactMatch) {
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
      random: '布林线策略'
    };

    const hotCold = context.hotCold || hotColdAnalysis(data);
    const frontHot = front.filter(n => hotCold.front.hot.includes(n));
    const frontCold = front.filter(n => hotCold.front.cold.includes(n));
    const frontWarm = front.filter(n => hotCold.front.warm.includes(n));

    const sumLabel = evalResult.sum;
    const sumVerdict = evalResult.valid ? '训练区间' : '偏离区间';
    const consecLabel = evalResult.pairs > 0 ? `有 (${evalResult.pairs}组连号)` : '无 (散号组合)';
    const tailLabel = evalResult.tailPairsCount > 0 ? `有 (${evalResult.tailPairsCount}组同尾)` : '无 (全异尾)';
    const backSumLabel = `和${backEvalResult.sum}(${backEvalResult.sumMin}-${backEvalResult.sumMax})/差${backEvalResult.diff}(${backEvalResult.diffMin}-${backEvalResult.diffMax})`;
    const bollingerLines = [];
    if (strategy === 'random' && bollingerResult) {
      const analysis = bollingerResult.analysis;
      bollingerLines.push(
        `布林趋势: 前区${analysis.frontTrend} / 后区${analysis.backTrend} | 目标和值: 前区${bollingerResult.targets.frontSum}, 后区${bollingerResult.targets.backSum}`,
        `近${analysis.analyzedPeriods}期热号池: 前区${analysis.hotFront.join(' ')} | 后区${analysis.hotBack.join(' ')}`
      );
    }

    const reasoning = [
      `【${strategyNames[strategy] || strategy} · 统计约束模型】`,
      ...bollingerLines,
      `前区奇偶: ${evalResult.oddEven} | 大小: ${evalResult.bigSmall}`,
      `前区和值: ${sumLabel} (${evalResult.sumMin}-${evalResult.sumMax} · ${sumVerdict}) | 后区高阶: ${backSumLabel}`,
      `连号状态: ${consecLabel} | 同尾状态: ${tailLabel}`,
      `前区AC值: ${evalResult.ac} (>=${evalResult.minAC}) | 覆盖 ${evalResult.zonesCovered} 个分区 (>=${evalResult.minZonesCovered})`,
      `冷热结构: ${frontHot.length}热 / ${frontWarm.length}温 / ${frontCold.length}冷`,
      `结合${strategy === 'random' ? '布林线和值约束与70%热号抽样' : strategy === 'balanced' ? '冷热分层抽样' : '伴生概率矩阵'}、近期时间衰减权重及全库去重生成 (计算碰撞: ${attempts}次)`
    ].join('\n');

    return {
      front,
      back,
      scores: {
        front: frontScores,
        back: backScores
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

  function getEvolutionMultiplier(evolution, strategy) {
    const stat = evolution && evolution.strategyStats && evolution.strategyStats[strategy];
    if (!stat || !Number.isFinite(stat.weightMultiplier)) return 1;
    return Math.max(0.75, Math.min(1.25, stat.weightMultiplier));
  }

  function buildStrategyOrder(evolution, count) {
    const ranked = DEFAULT_STRATEGIES
      .map(strategy => ({
        strategy,
        multiplier: getEvolutionMultiplier(evolution, strategy)
      }))
      .sort((a, b) => b.multiplier - a.multiplier || DEFAULT_STRATEGIES.indexOf(a.strategy) - DEFAULT_STRATEGIES.indexOf(b.strategy))
      .map(item => item.strategy);

    if (count <= DEFAULT_STRATEGIES.length) return ranked;

    const expanded = ranked.slice();
    while (expanded.length < count) {
      const next = ranked
        .slice()
        .sort((a, b) => getEvolutionMultiplier(evolution, b) - getEvolutionMultiplier(evolution, a));
      expanded.push(...next);
    }
    return expanded;
  }

  function formatEvolutionReason(evolution, strategy) {
    const stat = evolution && evolution.strategyStats && evolution.strategyStats[strategy];
    if (!stat || !stat.reviewCount) return '策略进化: 暂无复盘样本，沿用基础权重';
    const direction = stat.direction === 'up'
      ? '上调'
      : stat.direction === 'down'
        ? '下调'
        : '稳定';
    return `策略进化: ${direction}至 ${stat.weightMultiplier}x | 复盘${stat.reviewCount}次 / 中奖${stat.winCount}次 / 近期表现${stat.recentPerformance}`;
  }

  /**
   * 使用多种策略生成多注预测号码
   * @param {Array} data - 开奖数据
   * @param {number} count - 生成注数，默认 5
   * @returns {Array<{ front, back, scores, reasoning, strategy }>}
   */
  function generateMultiplePredictions(data, count = 5, options = {}) {
    const strategies = buildStrategyOrder(options.evolution, count);
    const predictions = [];
    const context = options.context || createPredictionContext(data);
    const rng = options.rng || Math.random;
    const seen = new Set();
    const maxAttempts = Math.max(count * 25, strategies.length);
    let attempts = 0;

    while (predictions.length < count && attempts < maxAttempts) {
      const strategy = strategies[attempts % strategies.length];
      const prediction = generatePrediction(data, strategy, { ...options, rng, context });
      const key = predictionKey(prediction.front, prediction.back, context.type);

      if (!seen.has(key)) {
        seen.add(key);
        predictions.push({
          ...prediction,
          reasoning: `${prediction.reasoning || ''}\n${formatEvolutionReason(options.evolution, strategy)}`.trim(),
          strategy
        });
      }
      attempts++;
    }

    while (predictions.length < count) {
      const strategy = strategies[predictions.length % strategies.length];
      const prediction = generatePrediction(data, strategy, { ...options, rng, context });
      predictions.push({
        ...prediction,
        reasoning: `${prediction.reasoning || ''}\n${formatEvolutionReason(options.evolution, strategy)}`.trim(),
        strategy
      });
    }

    return predictions;
  }

  function createMatchStats(isPl3) {
    return isPl3 ? {
      front0: 0, front1: 0, front2: 0, front3: 0,
      back0: 0
    } : {
      front0: 0, front1: 0, front2: 0, front3: 0, front4: 0, front5: 0,
      back0: 0, back1: 0, back2: 0
    };
  }

  function createMatchAccumulator(isPl3) {
    return {
      totalTests: 0,
      matchStats: createMatchStats(isPl3),
      totalFrontMatch: 0,
      totalBackMatch: 0
    };
  }

  function recordMatch(acc, prediction, targetDraw, isPl3) {
    acc.totalTests++;

    if (isPl3) {
      let frontMatches = 0;
      for (let j = 0; j < 3; j++) {
        if (prediction.front[j] === targetDraw.front[j]) {
          frontMatches++;
        }
      }
      acc.matchStats[`front${frontMatches}`]++;
      acc.totalFrontMatch += frontMatches;
      acc.matchStats.back0++;
      return;
    }

    const frontMatches = prediction.front.filter(n => targetDraw.front.includes(n)).length;
    acc.matchStats[`front${frontMatches}`]++;
    acc.totalFrontMatch += frontMatches;

    const backMatches = prediction.back.filter(n => targetDraw.back.includes(n)).length;
    acc.matchStats[`back${backMatches}`]++;
    acc.totalBackMatch += backMatches;
  }

  function finalizeMatchAccumulator(acc) {
    const total = acc.totalTests || 1;
    return {
      totalTests: acc.totalTests,
      matchStats: { ...acc.matchStats },
      avgFrontMatch: Math.round((acc.totalFrontMatch / total) * 1000) / 1000,
      avgBackMatch: Math.round((acc.totalBackMatch / total) * 1000) / 1000
    };
  }

  function createBacktestRunState(seed, strategies, isPl3) {
    const strategyAccumulators = {};
    const strategyRngs = {};
    strategies.forEach(strategy => {
      strategyAccumulators[strategy] = createMatchAccumulator(isPl3);
      strategyRngs[strategy] = createSeededRandom(deriveSeed(seed, `strategy:${strategy}`));
    });

    return {
      seed,
      rng: createSeededRandom(seed),
      strategyAccumulators,
      strategyRngs,
      baselineAccumulators: {
        random: createMatchAccumulator(isPl3),
        constrainedRandom: createMatchAccumulator(isPl3)
      },
      baselineRngs: {
        random: createSeededRandom(deriveSeed(seed, 'baseline:random')),
        constrainedRandom: createSeededRandom(deriveSeed(seed, 'baseline:constrainedRandom'))
      }
    };
  }

  function finalizeBacktestRun(runState, strategies, isPl3) {
    const strategyStats = {};
    for (const strategy of strategies) {
      strategyStats[strategy] = finalizeMatchAccumulator(runState.strategyAccumulators[strategy]);
    }

    const baselineStats = {};
    for (const [name, acc] of Object.entries(runState.baselineAccumulators)) {
      baselineStats[name] = finalizeMatchAccumulator(acc);
    }

    const primary = strategyStats.balanced || strategyStats[strategies[0]] || finalizeMatchAccumulator(createMatchAccumulator(isPl3));

    return {
      totalTests: primary.totalTests,
      matchStats: primary.matchStats,
      avgFrontMatch: primary.avgFrontMatch,
      avgBackMatch: primary.avgBackMatch,
      strategyStats,
      baselineStats,
      seed: runState.seed
    };
  }

  function roundMetric(value) {
    return Math.round(value * 1000) / 1000;
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function summarizeSeedStats(statsList) {
    const validStats = statsList.filter(Boolean);
    const frontValues = validStats.map(stat => stat.avgFrontMatch);
    const backValues = validStats.map(stat => stat.avgBackMatch);

    if (validStats.length === 0) {
      return {
        seedCount: 0,
        totalTests: 0,
        avgFrontMatch: 0,
        frontStd: 0,
        frontMin: 0,
        frontMax: 0,
        avgBackMatch: 0,
        backStd: 0,
        backMin: 0,
        backMax: 0
      };
    }

    return {
      seedCount: validStats.length,
      totalTests: validStats[0].totalTests,
      avgFrontMatch: roundMetric(average(frontValues)),
      frontStd: roundMetric(stdDev(frontValues)),
      frontMin: roundMetric(Math.min(...frontValues)),
      frontMax: roundMetric(Math.max(...frontValues)),
      avgBackMatch: roundMetric(average(backValues)),
      backStd: roundMetric(stdDev(backValues)),
      backMin: roundMetric(Math.min(...backValues)),
      backMax: roundMetric(Math.max(...backValues))
    };
  }

  function aggregateSeedRuns(seedRuns) {
    const strategyNames = new Set();
    const baselineNames = new Set();

    seedRuns.forEach(run => {
      Object.keys(run.strategyStats || {}).forEach(name => strategyNames.add(name));
      Object.keys(run.baselineStats || {}).forEach(name => baselineNames.add(name));
    });

    const strategyStats = {};
    for (const name of strategyNames) {
      strategyStats[name] = summarizeSeedStats(seedRuns.map(run => run.strategyStats && run.strategyStats[name]));
    }

    const baselineStats = {};
    for (const name of baselineNames) {
      baselineStats[name] = summarizeSeedStats(seedRuns.map(run => run.baselineStats && run.baselineStats[name]));
    }

    return {
      strategyStats,
      baselineStats
    };
  }

  function normalizeSeedList(requestedSeeds) {
    const seedList = Array.isArray(requestedSeeds) ? requestedSeeds : [requestedSeeds];
    const seeds = Array.from(new Set(seedList
      .map(Number)
      .filter(seed => Number.isFinite(seed))));

    if (seeds.length === 0) {
      seeds.push(20260525);
    }

    return seeds;
  }

  function resolveBacktestWindows(data, requestedWindows) {
    const maxAvailable = Math.max(0, data.length - 300);
    const windowList = Array.isArray(requestedWindows) ? requestedWindows : [requestedWindows];
    const windows = Array.from(new Set(windowList
      .map(Number)
      .filter(window => Number.isFinite(window) && window > 0)))
      .filter(window => window <= maxAvailable)
      .sort((a, b) => a - b);

    if (windows.length === 0 && maxAvailable > 0) {
      windows.push(maxAvailable);
    }

    return windows;
  }

  function setRunStateRng(runState, rng) {
    runState.rng = rng;
    Object.keys(runState.strategyRngs).forEach(strategy => {
      runState.strategyRngs[strategy] = rng;
    });
    Object.keys(runState.baselineRngs).forEach(name => {
      runState.baselineRngs[name] = rng;
    });
  }

  function recordBacktestPeriod(runStates, strategies, targetDraw, fullData, dataEnd, context, isPl3) {
    for (const runState of runStates) {
      for (const strategy of strategies) {
        const prediction = generatePrediction(fullData, strategy, {
          rng: runState.strategyRngs[strategy] || runState.rng,
          context,
          dataEnd
        });
        recordMatch(runState.strategyAccumulators[strategy], prediction, targetDraw, isPl3);
      }

      recordMatch(
        runState.baselineAccumulators.random,
        generateRandomPrediction(context, runState.baselineRngs.random || runState.rng, false),
        targetDraw,
        isPl3
      );
      recordMatch(
        runState.baselineAccumulators.constrainedRandom,
        generateRandomPrediction(context, runState.baselineRngs.constrainedRandom || runState.rng, true),
        targetDraw,
        isPl3
      );
    }
  }

  function createBacktestSummaryConfig(data, options = {}) {
    const type = detectLotteryType(data);
    const isPl3 = type === 'pl3';
    updateLotteryParams(type);

    const windows = resolveBacktestWindows(data, options.windows || DEFAULT_BACKTEST_WINDOWS);
    const seeds = normalizeSeedList(options.seeds || DEFAULT_BACKTEST_SEEDS_FN());
    const strategies = options.strategies || DEFAULT_STRATEGIES;

    return { type, isPl3, windows, seeds, strategies };
  }

  function createEmptyBacktestSummary(type, isPl3, seeds) {
    return {
      reportType: 'multiSeedWindow',
      type,
      windows: [],
      seeds,
      seedCount: seeds.length,
      windowReports: [],
      totalTests: 0,
      matchStats: createMatchStats(isPl3),
      avgFrontMatch: 0,
      avgBackMatch: 0,
      strategyStats: {},
      baselineStats: {}
    };
  }

  function finalizeBacktestSummary(config, seedRunsByWindow) {
    const { type, isPl3, windows, seeds, strategies } = config;
    const windowReports = windows.map(window => {
      const seedRuns = seedRunsByWindow.get(window) || [];
      return {
        window,
        seeds: seeds.slice(),
        seedCount: seedRuns.length,
        seedRuns,
        summary: aggregateSeedRuns(seedRuns)
      };
    });

    const primaryReport = windowReports[0];
    const primaryRun = primaryReport && primaryReport.seedRuns[0]
      ? primaryReport.seedRuns[0]
      : finalizeBacktestRun(createBacktestRunState(seeds[0], strategies, isPl3), strategies, isPl3);

    return {
      reportType: 'multiSeedWindow',
      type,
      windows,
      seeds,
      seedCount: seeds.length,
      primaryWindow: primaryReport ? primaryReport.window : 0,
      windowReports,
      totalTests: primaryRun.totalTests,
      matchStats: primaryRun.matchStats,
      avgFrontMatch: primaryRun.avgFrontMatch,
      avgBackMatch: primaryRun.avgBackMatch,
      strategyStats: primaryRun.strategyStats,
      baselineStats: primaryRun.baselineStats,
      seed: primaryRun.seed
    };
  }

  function yieldBacktestControl() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function uniformSample(min, max, count, rng) {
    return weightedSample(range(min, max).map(num => ({ value: num, weight: 1 })), count, rng);
  }

  function generateRandomPrediction(context, rng, constrained = false) {
    if (context.type === 'pl3') {
      for (let attempts = 0; attempts < 500; attempts++) {
        const front = [
          Math.floor(rng() * 10),
          Math.floor(rng() * 10),
          Math.floor(rng() * 10)
        ];
        const duplicate = context.recentKeys && context.recentKeys.has(front.join(','));
        if (!constrained || (evaluatePL3Combination(front, context.pl3Constraints).valid && !duplicate)) {
          return { front, back: [] };
        }
      }
      return {
        front: [
          Math.floor(rng() * 10),
          Math.floor(rng() * 10),
          Math.floor(rng() * 10)
        ],
        back: []
      };
    }

    for (let attempts = 0; attempts < 500; attempts++) {
      const front = uniformSample(1, 35, 5, rng);
      const back = uniformSample(1, 12, 2, rng);
      const duplicate = context.exactDrawSet && context.exactDrawSet.has(drawKey(front, back));
      if (!constrained || (
        evaluateFrontCombination(front, context.frontConstraints).valid &&
        evaluateBackCombination(back, context.backConstraints).valid &&
        !duplicate
      )) {
        return { front, back };
      }
    }

    return {
      front: uniformSample(1, 35, 5, rng),
      back: uniformSample(1, 12, 2, rng)
    };
  }

  // ============================================================
  // 10. 回测验证
  // ============================================================

  /**
   * 使用历史数据进行回测
   * @param {Array} data - 开奖数据（最新期在前）
   * @param {number} testPeriods - 回测期数，默认 500
   * @returns {{ totalTests, matchStats, avgFrontMatch, avgBackMatch }}
   */
  function backtestPrediction(data, testPeriods = DEFAULT_BACKTEST_PERIODS, options = {}) {
    const isPl3 = detectLotteryType(data) === 'pl3';
    updateLotteryParams(isPl3 ? 'pl3' : 'dlt');

    const actualTests = Math.min(testPeriods, data.length - 300); // 确保有足够历史数据
    if (actualTests <= 0) {
      return {
        totalTests: 0,
        matchStats: isPl3 ? {
          front0: 0, front1: 0, front2: 0, front3: 0,
          back0: 0
        } : {
          front0: 0, front1: 0, front2: 0, front3: 0, front4: 0, front5: 0,
          back0: 0, back1: 0, back2: 0
        },
        avgFrontMatch: 0,
        avgBackMatch: 0,
        strategyStats: {},
        baselineStats: {}
      };
    }

    const strategies = options.strategies || DEFAULT_STRATEGIES;
    const runState = createBacktestRunState(options.seed || 20260525, strategies, isPl3);
    if (options.rng) {
      setRunStateRng(runState, options.rng);
    }

    for (let i = 0; i < actualTests; i++) {
      const targetDraw = data[i];
      const context = createPredictionContext(data, i + 1);
      recordBacktestPeriod([runState], strategies, targetDraw, data, i + 1, context, isPl3);
    }

    return finalizeBacktestRun(runState, strategies, isPl3);
  }

  function backtestSummaryReport(data, options = {}) {
    const config = createBacktestSummaryConfig(data, options);
    const { type, isPl3, windows, seeds, strategies } = config;

    if (windows.length === 0) {
      return createEmptyBacktestSummary(type, isPl3, seeds);
    }

    const runStates = seeds.map(seed => createBacktestRunState(seed, strategies, isPl3));
    const checkpoints = new Set(windows);
    const maxWindow = Math.max(...windows);
    const seedRunsByWindow = new Map();

    for (let i = 0; i < maxWindow; i++) {
      const targetDraw = data[i];
      const context = createPredictionContext(data, i + 1);
      recordBacktestPeriod(runStates, strategies, targetDraw, data, i + 1, context, isPl3);

      const completedWindow = i + 1;
      if (checkpoints.has(completedWindow)) {
        seedRunsByWindow.set(
          completedWindow,
          runStates.map(runState => finalizeBacktestRun(runState, strategies, isPl3))
        );
      }
    }

    return finalizeBacktestSummary(config, seedRunsByWindow);
  }

  async function backtestSummaryReportAsync(data, options = {}) {
    const config = createBacktestSummaryConfig(data, options);
    const { type, isPl3, windows, seeds, strategies } = config;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const chunkSize = Math.max(1, Number(options.chunkSize) || 10);

    if (windows.length === 0) {
      return createEmptyBacktestSummary(type, isPl3, seeds);
    }

    const runStates = seeds.map(seed => createBacktestRunState(seed, strategies, isPl3));
    const checkpoints = new Set(windows);
    const maxWindow = Math.max(...windows);
    const seedRunsByWindow = new Map();

    for (let i = 0; i < maxWindow; i++) {
      const targetDraw = data[i];
      const context = createPredictionContext(data, i + 1);
      recordBacktestPeriod(runStates, strategies, targetDraw, data, i + 1, context, isPl3);

      const completedWindow = i + 1;
      if (checkpoints.has(completedWindow)) {
        seedRunsByWindow.set(
          completedWindow,
          runStates.map(runState => finalizeBacktestRun(runState, strategies, isPl3))
        );
      }

      if (onProgress && (completedWindow === 1 || completedWindow === maxWindow || completedWindow % chunkSize === 0)) {
        onProgress({
          completed: completedWindow,
          total: maxWindow,
          percent: Math.round((completedWindow / maxWindow) * 100),
          windows,
          seeds: seeds.length
        });
      }

      if (completedWindow < maxWindow && completedWindow % chunkSize === 0) {
        await yieldBacktestControl();
      }
    }

    return finalizeBacktestSummary(config, seedRunsByWindow);
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
    consecutiveAnalysis,

    // 预测函数
    generatePrediction,
    generateMultiplePredictions,
    backtestPrediction,
    backtestSummaryReport,
    backtestSummaryReportAsync,

    // 工具函数（供外部使用）
    computeScores,

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
