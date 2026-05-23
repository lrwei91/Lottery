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
  // 常量定义
  // ============================================================
  const FRONT_MIN = 1;
  const FRONT_MAX = 35;
  const BACK_MIN = 1;
  const BACK_MAX = 12;
  const FRONT_COUNT = 5; // 每期前区选号个数
  const BACK_COUNT = 2;  // 每期后区选号个数

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
   * Fisher-Yates 洗牌算法
   */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * 按权重随机选择 count 个不重复元素
   * @param {Array<{value: number, weight: number}>} items - 带权重的候选项
   * @param {number} count - 选取数量
   * @returns {number[]} 选中的值
   */
  function weightedSample(items, count) {
    const pool = items.slice();
    const selected = [];

    for (let i = 0; i < count && pool.length > 0; i++) {
      const totalWeight = pool.reduce((sum, it) => sum + it.weight, 0);
      let rand = Math.random() * totalWeight;
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
  // 1. 频率分析
  // ============================================================

  /**
   * 统计每个号码在所有历史数据中出现的频率（带有时间衰减权重）
   * @param {Array} data - 开奖数据数组
   * @returns {{ front: Map<number, number>, back: Map<number, number> }}
   */
  function frequencyAnalysis(data) {
    const front = new Map();
    const back = new Map();

    // 初始化所有号码计数为 0
    for (let i = FRONT_MIN; i <= FRONT_MAX; i++) front.set(i, 0);
    for (let i = BACK_MIN; i <= BACK_MAX; i++) back.set(i, 0);

    // 遍历每期数据累加计数，引入时间衰减机制
    const total = data.length;
    for (let i = 0; i < total; i++) {
      const draw = data[i];
      // 线性衰减：最近的一期权重为 1.5，最远的一期权重为 0.5
      // 这使得引擎具备“近期嗅觉”，能更敏锐地捕捉热号回暖
      const weight = total > 1 ? 1.5 - (i / (total - 1)) : 1.0;
      
      for (const num of draw.front) {
        front.set(num, (front.get(num) || 0) + weight);
      }
      for (const num of draw.back) {
        back.set(num, (back.get(num) || 0) + weight);
      }
    }

    return { front, back };
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
  function hotColdAnalysis(data, recentN = 300) {
    const recentData = data.slice(0, recentN);
    const freq = frequencyAnalysis(recentData);

    function classify(freqMap, total) {
      const hot = [], cold = [], warm = [];
      // 动态阈值：基于期数调整冷热判定标准
      const avgExpected = total * 5 / 35; // 前区期望出现次数
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
      front: classify(freq.front, recentN),
      back: classify(freq.back, recentN)
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
  function gapAnalysis(data) {
    function analyzeZone(data, min, max, getNumbers) {
      const result = new Map();

      for (let num = min; num <= max; num++) {
        let currentGap = -1;   // -1 表示尚未找到第一次出现
        let maxGap = 0;
        let totalGap = 0;
        let gapCount = 0;
        let lastSeenIdx = -1;

        // 从最新期向历史遍历
        for (let i = 0; i < data.length; i++) {
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
          currentGap = data.length;
        }

        // 末尾遗漏也纳入统计
        if (lastSeenIdx !== -1 && lastSeenIdx < data.length - 1) {
          const tailGap = data.length - 1 - lastSeenIdx;
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
      front: analyzeZone(data, FRONT_MIN, FRONT_MAX, d => d.front),
      back: analyzeZone(data, BACK_MIN, BACK_MAX, d => d.back)
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
    const distribution = {
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
    const distribution = {
      '5:0': 0, '4:1': 0, '3:2': 0,
      '2:3': 0, '1:4': 0, '0:5': 0
    };

    for (const draw of data) {
      const bigCount = draw.front.filter(n => n >= 18).length;
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
   * 计算号码综合评分
   * @param {Array} data - 开奖数据
   * @returns {{ frontScores: Map<number, object>, backScores: Map<number, object> }}
   */
  
  /**
   * 构建前区号码的伴生概率矩阵 (Co-occurrence Matrix)
   * 记录历史上每两个红球同时出现的次数
   */
  function buildCoOccurrenceMatrix(data) {
    const matrix = Array.from({ length: 36 }, () => Array(36).fill(0));
    for (const draw of data) {
      const front = draw.front;
      for (let i = 0; i < front.length; i++) {
        for (let j = i + 1; j < front.length; j++) {
          matrix[front[i]][front[j]]++;
          matrix[front[j]][front[i]]++;
        }
      }
    }
    return matrix;
  }

  function computeScores(data) {
    const gapData = gapAnalysis(data);
    const freqData = frequencyAnalysis(data);
    const hotCold = hotColdAnalysis(data);

    function scoreZone(min, max, gapMap, freqMap, hotColdInfo, totalDraws, pickCount) {
      const scores = new Map();

      // 获取所有遗漏值用于归一化
      const allGaps = [];
      const allFreqs = [];
      for (let num = min; num <= max; num++) {
        allGaps.push(gapMap.get(num).current);
        allFreqs.push(freqMap.get(num));
      }
      const gapMin = Math.min(...allGaps);
      const gapMax = Math.max(...allGaps);
      const freqMin = Math.min(...allFreqs);
      const freqMax = Math.max(...allFreqs);

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
            const nums = min <= 12 && max <= 12 ? d.back : d.front;
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

    return {
      frontScores: scoreZone(FRONT_MIN, FRONT_MAX, gapData.front, freqData.front, hotCold.front, data.length, FRONT_COUNT),
      backScores: scoreZone(BACK_MIN, BACK_MAX, gapData.back, freqData.back, hotCold.back, data.length, BACK_COUNT)
    };
  }

  /**
   * 根据策略和评分选号
   * @param {Map} scores - 号码评分
   * @param {string} strategy - 策略名
   * @param {number} count - 选号数量
   * @returns {number[]} 选中号码
   */
  /**
   * 根据策略和评分选号
   * @param {Map} scores - 号码评分
   * @param {string} strategy - 策略名
   * @param {number} count - 选号数量
   * @returns {number[]} 选中号码
   */
  function selectByStrategy(scores, strategy, count, coMatrix = null) {
    if (strategy === 'balanced' && count === FRONT_COUNT) {
      // 保持原有黄金比例抽样
      const targetHotCount = Math.random() < 0.6 ? 1 : 2;
      const targetWarmCount = targetHotCount === 1 ? 3 : 2;
      const targetColdCount = 1;

      const hotPool = [], warmPool = [], coldPool = [];
      const weights = { gap: 0.3, freqDev: 0.3, trend: 0.3 };

      for (const [num, s] of scores) {
        const baseScore = s.gapScore * weights.gap + s.freqDeviationScore * weights.freqDev + s.trendScore * weights.trend;
        const item = { value: num, weight: Math.max(0.01, baseScore + Math.random() * 0.15) };
        if (s.status === 'hot') hotPool.push(item);
        else if (s.status === 'cold') coldPool.push(item);
        else warmPool.push(item);
      }

      const selected = [];
      if (hotPool.length >= targetHotCount && warmPool.length >= targetWarmCount && coldPool.length >= targetColdCount) {
        selected.push(...weightedSample(hotPool, targetHotCount));
        selected.push(...weightedSample(warmPool, targetWarmCount));
        selected.push(...weightedSample(coldPool, targetColdCount));
        return selected.sort((a, b) => a - b);
      }
    }

    const weights = {
      cold:     { gap: 0.3, freqDev: 0.2, trend: 0.1, statusBonus: { cold: 2.0, warm: 0.5, hot: 0.1 } },
      hot:      { gap: 0.1, freqDev: 0.2, trend: 0.4, statusBonus: { cold: 0.1, warm: 0.5, hot: 2.0 } },
      balanced: { gap: 0.3, freqDev: 0.3, trend: 0.3, statusBonus: { cold: 1.0, warm: 1.0, hot: 1.0 } },
      gap:      { gap: 0.6, freqDev: 0.1, trend: 0.1, statusBonus: { cold: 1.2, warm: 1.0, hot: 0.8 } },
      random:   { gap: 0.33, freqDev: 0.33, trend: 0.33, statusBonus: { cold: 1.0, warm: 1.0, hot: 1.0 } }
    };
    const w = weights[strategy] || weights.balanced;

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
            // 计算与已选中号码的平均伴生热度
            let totalCo = 0;
            for (const sel of selected) {
              totalCo += coMatrix[sel][p.value];
            }
            // 伴生频次越高，bonus 越大 (上限翻倍)
            coBonus = 1.0 + Math.min(totalCo / (selected.length * 50), 1.0); 
          }
          const jitter = strategy === 'random' ? Math.random() * 0.5 : Math.random() * 0.15;
          return { value: p.value, weight: Math.max(0.01, p.baseWeight * coBonus + jitter) };
        });

        const picked = weightedSample(currentItems, 1)[0];
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
      const jitter = strategy === 'random' ? Math.random() * 0.5 : Math.random() * 0.15;
      items.push({ value: num, weight: Math.max(0.01, baseScore * bonus + jitter) });
    }
    return weightedSample(items, count);
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

  /**
   * 检验前区号码是否符合历史概率的高频统计特征（和值、奇偶比、大小比、连号、AC值、区间覆盖）
   * @param {number[]} front - 选中的5个前区号码
   * @returns {{ valid: boolean, sum: number, oddEven: string, bigSmall: string, pairs: number, ac: number, zonesCovered,
      tailPairsCount: number }}
   */
  function evaluateFrontCombination(front) {
    const sorted = front.slice().sort((a, b) => a - b);
    
    // 1. 计算和值 (历史高频和值区间通常在 70-125 之间，占比超 80%)
    const sum = sorted.reduce((a, b) => a + b, 0);
    const isSumValid = sum >= 70 && sum <= 125;
    
    // 2. 奇偶比 (排除极端的 5:0 和 0:5)
    const oddCount = sorted.filter(n => n % 2 === 1).length;
    const evenCount = FRONT_COUNT - oddCount;
    const isOddEvenValid = oddCount >= 1 && oddCount <= 4;
    
    // 3. 大小比 (1-17为小，18-35为大，排除极端的 5:0 和 0:5)
    const bigCount = sorted.filter(n => n >= 18).length;
    const smallCount = FRONT_COUNT - bigCount;
    const isBigSmallValid = bigCount >= 1 && bigCount <= 4;
    
    // 4. 连号分析 (只允许单组或两组 2 连号，不允许 3 连号及以上)
    let maxConsecutive = 1;
    let currentConsecutive = 1;
    let pairs = 0; // 连号组数
    
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
    const isConsecutiveValid = maxConsecutive <= 2;
    
    // 5. AC 值过滤 (历史开奖中，AC >= 4 占比超 92%)
    const ac = calculateACValue(front);
    const isACValid = ac >= 4;
    
    // 6. 区间覆盖率过滤 (五分度：覆盖至少 3 个区间，防数字过度拥挤扎堆)
    const zoneSet = new Set();
    for (const num of sorted) {
      if (num <= 7) zoneSet.add(1);
      else if (num <= 14) zoneSet.add(2);
      else if (num <= 21) zoneSet.add(3);
      else if (num <= 28) zoneSet.add(4);
      else zoneSet.add(5);
    }
    const zonesCovered = zoneSet.size;
    const isZoneValid = zonesCovered >= 3;
    
    
    // 7. 同尾号分析 (历史规律：同尾组数极少超过 2 组)
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
    const isTailValid = tailPairsCount <= 2;

    const valid = isSumValid && isOddEvenValid && isBigSmallValid && isConsecutiveValid && isACValid && isZoneValid && isTailValid;

    
    return {
      valid,
      sum,
      oddEven: `${oddCount}:${evenCount}`,
      bigSmall: `${bigCount}:${smallCount}`,
      pairs,
      ac,
      zonesCovered
    };
  }

  /**
   * 生成单注预测号码
   * @param {Array} data - 开奖数据
   * @param {string} strategy - 策略：cold/hot/balanced/gap/random
   * @returns {{ front, back, scores, reasoning }}
   */
  
  /**
   * 检验后区号码过滤 (和值 6-19，差值 1-9)
   */
  function evaluateBackCombination(back) {
    const sorted = back.slice().sort((a, b) => a - b);
    const sum = sorted[0] + sorted[1];
    const diff = sorted[1] - sorted[0];
    const valid = sum >= 6 && sum <= 19 && diff >= 1 && diff <= 9;
    return { valid, sum, diff };
  }

  function generatePrediction(data, strategy = 'balanced') {
    if (!data || data.length < 10) {
      throw new Error('数据不足，至少需要 10 期历史数据');
    }

    const { frontScores, backScores } = computeScores(data);
    const coMatrix = buildCoOccurrenceMatrix(data);

    let front = [];
    let back = [];
    let evalResult = {};
    let backEvalResult = {};
    let attempts = 0;
    const maxAttempts = 500; // 断路器：为应对全量去重与复合过滤，上限提升至 500

    // 过滤与约束循环：寻找满足高阶指标且非历史一等奖的号码
    while (attempts < maxAttempts) {
      front = selectByStrategy(frontScores, strategy, FRONT_COUNT, coMatrix);
      evalResult = evaluateFrontCombination(front);
      back = selectByStrategy(backScores, strategy, BACK_COUNT, null);
      backEvalResult = evaluateBackCombination(back);

      // 全库防重复校验：绝对不能和历史上任何一期的 5+2 开奖号完全相同
      let isExactMatch = false;
      for (const draw of data) {
        const frontMatch = draw.front.every(n => front.includes(n));
        const backMatch = draw.back.every(n => back.includes(n));
        if (frontMatch && backMatch) {
          isExactMatch = true;
          break;
        }
      }

      if (evalResult.valid && backEvalResult.valid && !isExactMatch) {
        break;
      }
      attempts++;
    }

    // 保底机制
    if (attempts >= maxAttempts) {
      front = selectByStrategy(frontScores, strategy, FRONT_COUNT, coMatrix);
      back = selectByStrategy(backScores, strategy, BACK_COUNT, null);
      evalResult = evaluateFrontCombination(front);
      backEvalResult = evaluateBackCombination(back);
    }

    const strategyNames = {
      cold: '冷号优先',
      hot: '热号优先',
      balanced: '均衡策略',
      gap: '遗漏追号',
      random: '加权随机'
    };

    const hotCold = hotColdAnalysis(data);
    const frontHot = front.filter(n => hotCold.front.hot.includes(n));
    const frontCold = front.filter(n => hotCold.front.cold.includes(n));
    const frontWarm = front.filter(n => hotCold.front.warm.includes(n));

    const sumLabel = evalResult.sum;
    const sumVerdict = evalResult.sum >= 70 && evalResult.sum <= 125 ? '🎯 常规高频' : '⚠️ 偏离区间';
    const consecLabel = evalResult.pairs > 0 ? `有 (${evalResult.pairs}组连号)` : '无 (散号组合)';
    const tailLabel = evalResult.tailPairsCount > 0 ? `有 (${evalResult.tailPairsCount}组同尾)` : '无 (全异尾)';
    const backSumLabel = `和${backEvalResult.sum}/差${backEvalResult.diff}`;

    const reasoning = [
      `【${strategyNames[strategy] || strategy} · 高阶机器学习模型】`,
      `📊 前区奇偶: ${evalResult.oddEven} | 大小: ${evalResult.bigSmall}`,
      `📐 前区和值: ${sumLabel} (${sumVerdict}) | 🎯 后区高阶: ${backSumLabel}`,
      `🔗 连号状态: ${consecLabel} | 👯 同尾状态: ${tailLabel}`,
      `🧩 前区AC值: ${evalResult.ac} (🎯 ≥4) | 🗺️ 覆盖 ${evalResult.zonesCovered} 个分区`,
      `📈 冷热结构: ${frontHot.length}热 / ${frontWarm.length}温 / ${frontCold.length}冷`,
      `💡 结合伴生概率矩阵、近期时间衰减权重及全库去重防杀算法生成 (计算碰撞: ${attempts}次)`
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

  // ============================================================
  // 9. 生成多注预测
  // ============================================================

  /**
   * 使用多种策略生成多注预测号码
   * @param {Array} data - 开奖数据
   * @param {number} count - 生成注数，默认 5
   * @returns {Array<{ front, back, scores, reasoning, strategy }>}
   */
  function generateMultiplePredictions(data, count = 5) {
    const strategies = ['cold', 'hot', 'balanced', 'gap', 'random'];
    const predictions = [];

    for (let i = 0; i < count; i++) {
      const strategy = strategies[i % strategies.length];
      const prediction = generatePrediction(data, strategy);
      predictions.push({
        ...prediction,
        strategy
      });
    }

    return predictions;
  }

  // ============================================================
  // 10. 回测验证
  // ============================================================

  /**
   * 使用历史数据进行回测
   * 用第 N 期之前的数据预测第 N 期，对比实际开奖结果
   * @param {Array} data - 开奖数据（最新期在前）
   * @param {number} testPeriods - 回测期数，默认 50
   * @returns {{ totalTests, matchStats, avgFrontMatch, avgBackMatch }}
   */
  function backtestPrediction(data, testPeriods = 50) {
    const actualTests = Math.min(testPeriods, data.length - 300); // 确保有足够历史数据
    if (actualTests <= 0) {
      return {
        totalTests: 0,
        matchStats: {
          front0: 0, front1: 0, front2: 0, front3: 0, front4: 0, front5: 0,
          back0: 0, back1: 0, back2: 0
        },
        avgFrontMatch: 0,
        avgBackMatch: 0
      };
    }

    const matchStats = {
      front0: 0, front1: 0, front2: 0, front3: 0, front4: 0, front5: 0,
      back0: 0, back1: 0, back2: 0
    };

    let totalFrontMatch = 0;
    let totalBackMatch = 0;

    for (let i = 0; i < actualTests; i++) {
      // 第 i 期为目标期，用 i+1 往后的数据作为训练数据
      const targetDraw = data[i];
      const trainingData = data.slice(i + 1);

      // 使用均衡策略进行预测
      const prediction = generatePrediction(trainingData, 'balanced');

      // 统计前区匹配数
      const frontMatches = prediction.front.filter(n => targetDraw.front.includes(n)).length;
      matchStats[`front${frontMatches}`]++;
      totalFrontMatch += frontMatches;

      // 统计后区匹配数
      const backMatches = prediction.back.filter(n => targetDraw.back.includes(n)).length;
      matchStats[`back${backMatches}`]++;
      totalBackMatch += backMatches;
    }

    return {
      totalTests: actualTests,
      matchStats,
      avgFrontMatch: Math.round((totalFrontMatch / actualTests) * 1000) / 1000,
      avgBackMatch: Math.round((totalBackMatch / actualTests) * 1000) / 1000
    };
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

    // 工具函数（供外部使用）
    computeScores,

    // 常量
    FRONT_MIN,
    FRONT_MAX,
    BACK_MIN,
    BACK_MAX,
    FRONT_COUNT,
    BACK_COUNT
  };

})();
