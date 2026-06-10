/**
 * Kimi 2026 World Cup Benchmarks — 移植自 Kimi 2026 FIFA WC Analysis Report (June 2026)
 *
 * 提供:
 *   - 20-model 集成冠军概率基准 (8 支强队 + others 残差)
 *   - Monte Carlo 模拟参数 (K-factor、altitude、heat、Dixon-Coles ρ)
 *   - Elo 差 → 胜率 + 平局校准表 (Table B.1, s=400)
 *   - 概率校准调整矩阵 (Table 9.13, 0-5% 区间 +1.5pp 等)
 *   - 48 队新赛制规则 (第三名4分晋级、平局率 27-30% 调整)
 *   - 强队特异化数据 (Germany 被低估信号、Spain 拥挤、England 偏差)
 *
 * 配套数据文件: data/kimi_2026_benchmarks.json
 * 引用示例:
 *   const bench = await KimiBenchmarks.load();
 *   const pSpain = KimiBenchmarks.ensembleProb(bench, 'Spain');  // 0.168
 *   const adjP = KimiBenchmarks.calibrate(bench, 0.04);          // 0.055 (厚尾补偿)
 *   const draw = KimiBenchmarks.eloDrawProbability(bench, 300);  // 0.09
 */
;(function (global) {
  'use strict';

  const DEFAULT_URL = 'data/kimi_2026_benchmarks.json';
  let _cache = null;
  let _loadingPromise = null;

  // ============================================================
  // 数据加载
  // ============================================================

  async function load(url) {
    if (_cache) return _cache;
    if (_loadingPromise) return _loadingPromise;
    const target = url || DEFAULT_URL;
    _loadingPromise = fetch(target, { cache: 'no-store' })
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load ${target}: ${r.status}`);
        return r.json();
      })
      .then(data => {
        _cache = data;
        return data;
      })
      .catch(err => {
        // 失败回退到硬编码 fallback (确保前端不离线也能跑)
        console.warn('[KimiBenchmarks] JSON load failed, using fallback:', err);
        _cache = fallbackData();
        return _cache;
      });
    return _loadingPromise;
  }

  function fallbackData() {
    return {
      championBenchmarks: {
        teams: [
          { country: 'Spain',       ensemble: 16.8, ciLow: 13.2, ciHigh: 20.4, confidence: 'high' },
          { country: 'France',      ensemble: 14.3, ciLow: 11.0, ciHigh: 17.6, confidence: 'high' },
          { country: 'Germany',     ensemble: 11.8, ciLow:  8.8, ciHigh: 14.8, confidence: 'medium' },
          { country: 'England',     ensemble: 11.2, ciLow:  8.2, ciHigh: 14.2, confidence: 'medium' },
          { country: 'Argentina',   ensemble:  9.9, ciLow:  7.2, ciHigh: 12.6, confidence: 'medium' },
          { country: 'Brazil',      ensemble:  7.8, ciLow:  5.2, ciHigh: 10.4, confidence: 'low' },
          { country: 'Portugal',    ensemble:  6.0, ciLow:  3.8, ciHigh:  8.2, confidence: 'low' },
          { country: 'Netherlands', ensemble:  4.7, ciLow:  2.8, ciHigh:  6.6, confidence: 'low' }
        ],
        other39TeamsEnsemble: 15.5
      },
      monteCarloParams: {
        eloScalingFactor: 400,
        kFactor: { worldCup: 60, continental: 50, qualifier: 40, friendly: 20 },
        homeAdvantageElo: 65,
        altitude: { mexicoCityMultiplier: 1.20, altitudeMeters: 2240 },
        heat: { wbgt30Penalty: 0.85 },
        dixonColesRho: -0.048,
        timeDecay: { rate: 0.35, halfLifeYears: 1.98 },
        poisson: { baseGoalsPerMatch: 1.42, homeGoalsMultiplier: 1.18 }
      },
      eloMappingTable: { rows: [
        { diff:   0, winHigher: 50.0, drawEmpirical: 25 },
        { diff:  50, winHigher: 57.1, drawEmpirical: 22 },
        { diff: 100, winHigher: 64.0, drawEmpirical: 19 },
        { diff: 200, winHigher: 76.0, drawEmpirical: 14 },
        { diff: 300, winHigher: 84.9, drawEmpirical:  9 },
        { diff: 400, winHigher: 90.9, drawEmpirical:  5 },
        { diff: 500, winHigher: 94.6, drawEmpirical:  3 }
      ]},
      calibrationMatrix: { bins: [
        { lo:  0.0, hi:  5.0, adjustment:  0.015 },
        { lo:  5.0, hi: 10.0, adjustment:  0.008 },
        { lo: 10.0, hi: 15.0, adjustment:  0.003 },
        { lo: 15.0, hi: 20.0, adjustment:  0.0   },
        { lo: 20.0, hi: 25.0, adjustment: -0.005 },
        { lo: 25.0, hi:  1.01,adjustment: -0.010 }
      ]},
      groupRules: {
        thirdPlaceFourPoints: { advanceProbability: 0.98 },
        drawRateAdjustment: {
          historicalRange: [0.22, 0.25],
          projectedRange2026: [0.27, 0.30]
        }
      }
    };
  }

  function reset() {
    _cache = null;
    _loadingPromise = null;
  }

  // ============================================================
  // 冠军概率基准
  // ============================================================

  /**
   * 拿某支球队的集成共识概率
   * @param {object} bench - load() 返回
   * @param {string} country - 'Spain' / 'France' / ...
   * @returns {number|null} 0-1 之间
   */
  function ensembleProb(bench, country) {
    if (!bench || !bench.championBenchmarks) return null;
    const t = (bench.championBenchmarks.teams || []).find(
      x => x.country.toLowerCase() === (country || '').toLowerCase()
    );
    if (!t) return null;
    return (t.ensemble || 0) / 100;
  }

  /**
   * 拿置信区间 (0-1)
   */
  function championInterval(bench, country) {
    if (!bench || !bench.championBenchmarks) return null;
    const t = (bench.championBenchmarks.teams || []).find(
      x => x.country.toLowerCase() === (country || '').toLowerCase()
    );
    if (!t) return null;
    return { low: t.ciLow / 100, high: t.ciHigh / 100, confidence: t.confidence };
  }

  // ============================================================
  // MC 参数
  // ============================================================

  /**
   * 拿 MC 参数
   */
  function mcParams(bench) {
    return bench && bench.monteCarloParams ? bench.monteCarloParams : null;
  }

  /**
   * K-factor 选择 (按比赛类型)
   *   kFor(bench, 'worldCup' | 'continental' | 'qualifier' | 'friendly')
   */
  function kFor(bench, matchType) {
    const p = mcParams(bench);
    if (!p) return 40; // fallback
    return (p.kFactor || {})[matchType] || 40;
  }

  /**
   * 主场调整 (Elo pts)
   */
  function homeAdvantageElo(bench) {
    const p = mcParams(bench);
    return p ? (p.homeAdvantageElo || 65) : 65;
  }

  /**
   * 海拔 multiplier
   */
  function altitudeMultiplier(bench, venue) {
    const p = mcParams(bench);
    if (!p) return 1.0;
    const base = (p.altitude || {}).mexicoCityMultiplier || 1.0;
    // 简化: 只有 Mexico City (含 Azteca 2,240m) 触发强加成
    if (venue && /mexico|azteca/i.test(venue)) return base;
    return 1.0;
  }

  /**
   * 高温惩罚
   */
  function heatPenalty(bench, wbgt) {
    const p = mcParams(bench);
    if (!p || wbgt == null) return 1.0;
    const base = (p.heat || {}).wbgt30Penalty || 0.85;
    if (wbgt >= 30) return base;
    if (wbgt >= 28) return 1 - (1 - base) * 0.5;
    return 1.0;
  }

  /**
   * Dixon-Coles ρ
   */
  function dixonColesRho(bench) {
    const p = mcParams(bench);
    return p ? (p.dixonColesRho != null ? p.dixonColesRho : -0.048) : -0.048;
  }

  /**
   * Poisson 基础参数
   */
  function poissonBase(bench) {
    const p = mcParams(bench);
    const poisson = (p && p.poisson) || { baseGoalsPerMatch: 1.42, homeGoalsMultiplier: 1.18 };
    return {
      baseGoals: poisson.baseGoalsPerMatch || 1.42,
      homeMultiplier: poisson.homeGoalsMultiplier || 1.18
    };
  }

  // ============================================================
  // Elo 差 → 胜率映射 (校准表)
  // ============================================================

  /**
   * 拿 Elo 差对应的 draw 平局校准 (来自 Table B.1)
   * 用线性插值，平局率随 Elo 差下降
   * @param {object} bench
   * @param {number} eloDiff - 整数 Elo 差
   * @returns {number} 0-1 之间的平局概率
   */
  function eloDrawProbability(bench, eloDiff) {
    const t = bench && bench.eloMappingTable;
    if (!t || !t.rows || t.rows.length === 0) {
      // fallback 线性: draw = max(0.05, 0.28 - |diff| / 1500)
      return Math.max(0.05, 0.28 - Math.abs(eloDiff) / 1500);
    }
    const d = Math.abs(eloDiff);
    const rows = t.rows;
    if (d <= rows[0].diff) return rows[0].drawEmpirical / 100;
    if (d >= rows[rows.length - 1].diff) return rows[rows.length - 1].drawEmpirical / 100;
    for (let i = 0; i < rows.length - 1; i += 1) {
      const a = rows[i], b = rows[i + 1];
      if (d >= a.diff && d <= b.diff) {
        const t01 = (d - a.diff) / (b.diff - a.diff);
        return (a.drawEmpirical + (b.drawEmpirical - a.drawEmpirical) * t01) / 100;
      }
    }
    return 0.25;
  }

  /**
   * 拿 Elo 差对应的胜率 (linear interp)
   */
  function eloWinProbability(bench, eloDiff) {
    const t = bench && bench.eloMappingTable;
    if (!t || !t.rows || t.rows.length === 0) {
      return 1 / (1 + Math.pow(10, -eloDiff / 400));
    }
    const d = Math.abs(eloDiff);
    const rows = t.rows;
    if (d <= rows[0].diff) return rows[0].winHigher / 100;
    if (d >= rows[rows.length - 1].diff) return rows[rows.length - 1].winHigher / 100;
    for (let i = 0; i < rows.length - 1; i += 1) {
      const a = rows[i], b = rows[i + 1];
      if (d >= a.diff && d <= b.diff) {
        const t01 = (d - a.diff) / (b.diff - a.diff);
        return (a.winHigher + (b.winHigher - a.winHigher) * t01) / 100;
      }
    }
    return 0.5;
  }

  // ============================================================
  // 校准调整矩阵
  // ============================================================

  /**
   * 把原始概率做校准调整 (Table 9.13)
   * 0-5% 区间 +1.5pp (厚尾补偿)
   * >25% 区间 -1.0pp (Goldman Sachs 26% correction)
   * @param {object} bench
   * @param {number} rawProb - 0-1
   * @returns {number} 校准后概率 (clamp [0, 1])
   */
  function calibrate(bench, rawProb) {
    if (rawProb == null || isNaN(rawProb)) return rawProb;
    const p = Math.max(0, Math.min(1, rawProb));
    const matrix = bench && bench.calibrationMatrix;
    const bins = (matrix && matrix.bins) || [
      { lo:  0.0, hi:  5.0, adjustment:  0.015 },
      { lo:  5.0, hi: 10.0, adjustment:  0.008 },
      { lo: 10.0, hi: 15.0, adjustment:  0.003 },
      { lo: 15.0, hi: 20.0, adjustment:  0.0   },
      { lo: 20.0, hi: 25.0, adjustment: -0.005 },
      { lo: 25.0, hi:  1.01,adjustment: -0.010 }
    ];
    const pct = p * 100;
    for (const b of bins) {
      if (pct >= b.lo && pct < b.hi) {
        return Math.max(0, Math.min(1, p + b.adjustment));
      }
    }
    return p;
  }

  // ============================================================
  // 48 队新赛制规则
  // ============================================================

  /**
   * 第三名晋级规则: 4 分 (1胜1平1负) 几乎必然晋级
   * @returns {object} { advance: bool, probability: 0.98 }
   */
  function thirdPlaceAdvance(bench, points) {
    const rule = bench && bench.groupRules && bench.groupRules.thirdPlaceFourPoints;
    const baseProb = rule ? rule.advanceProbability : 0.98;
    // 简化启发式: 0分 0%, 1分 0%, 2分 5%, 3分 50%, 4分 98%, 5分 99.9%, 6分 99.99%, 7分 100%
    if (points == null || points < 0) return { advance: false, probability: 0 };
    const table = [0, 0, 0.05, 0.5, baseProb, 0.999, 0.9999, 1.0];
    const idx = Math.min(table.length - 1, Math.max(0, Math.round(points)));
    return { advance: table[idx] > 0.5, probability: table[idx] };
  }

  /**
   * 平局率调整: 2026 战略性平局多发, 强队 vs 中游 last-match 平局率上调
   * @param {object} bench
   * @param {object} ctx - { matchday, strongTeamRank, bothAdvancingDecided }
   * @returns {number} 平局率上浮
   */
  function drawUplift(bench, ctx) {
    const rules = bench && bench.groupRules;
    if (!rules) return 0;
    const adj = rules.drawRateAdjustment || {};
    const projected = (adj.projectedRange2026 || [0.27, 0.30]);
    const historical = (adj.historicalRange || [0.22, 0.25]);
    // 平均历史 → 平均预测: 0.235 → 0.285, 差 +0.05
    const hAvg = (historical[0] + historical[1]) / 2;
    const pAvg = (projected[0] + projected[1]) / 2;
    let baseUplift = pAvg - hAvg; // 0.05
    if (!ctx) return baseUplift;
    // 第3场 + 强队基本晋级: 再加 upset 5-10pp 中的下界
    if (ctx.matchday === 3 && ctx.strongTeamRank != null && ctx.strongTeamRank <= 12) {
      baseUplift += 0.05;
    }
    return baseUplift;
  }

  // ============================================================
  // Dixon-Coles 低分修正函数
  // ============================================================

  /**
   * Dixon-Coles tau 修正 (低分互依: 0-0, 1-0, 0-1, 1-1)
   * 把修正系数 clamp 到 [0.2, 3.0] 防止数值失稳 (尤其当 λ > 1 时)
   * @param {number} x - 主场进球
   * @param {number} y - 客场进球
   * @param {number} lambdaA - 主场期望进球 (lambda)
   * @param {number} lambdaB - 客场期望进球
   * @param {number} rho - 相关参数, 默认 -0.048
   * @returns {number} 修正系数 (clamp 到 [0.2, 3.0])
   */
  function dixonColesTau(x, y, lambdaA, lambdaB, rho) {
    if (rho == null) rho = -0.048;
    let tau = 1.0;
    if (x === 0 && y === 0) {
      tau = 1 - (lambdaA * lambdaB * rho) / ((1 - lambdaA) * (1 - lambdaB));
    } else if (x === 0 && y === 1) {
      tau = 1 + (lambdaA * rho) / (1 - lambdaA);
    } else if (x === 1 && y === 0) {
      tau = 1 + (lambdaB * rho) / (1 - lambdaB);
    } else if (x === 1 && y === 1) {
      tau = 1 - rho;
    }
    return Math.max(0.2, Math.min(3.0, tau));
  }

  // ============================================================
  // 比赛 venue → context 解析
  // 把 "Mexico City Stadium, Mexico City" 这种字符串解析成结构化数据
  // 数据源: PDF Page 208-209 WBGT exceedance probability, Page 211 altitude
  // ============================================================

  // 16 个 2026 世界杯场馆 + WBGT/海拔 (基于 PDF + 常识)
  // WBGT: 6月平均下午比赛条件 (PDF Page 208-209)
  // altitude: 米
  const VENUE_DB = {
    'mexico city':      { city: 'Mexico City',       altitude: 2240, wbgt: 24, country: 'MX' },
    'guadalajara':      { city: 'Guadalajara',       altitude: 1566, wbgt: 26, country: 'MX' },
    'monterrey':        { city: 'Monterrey',         altitude:  540, wbgt: 30, country: 'MX' },
    'dallas':           { city: 'Dallas',            altitude:  131, wbgt: 32, country: 'US' },
    'houston':          { city: 'Houston',           altitude:   13, wbgt: 33, country: 'US' },
    'kansas city':      { city: 'Kansas City',       altitude:  265, wbgt: 30, country: 'US' },
    'atlanta':          { city: 'Atlanta',           altitude:  320, wbgt: 29, country: 'US' },
    'miami':            { city: 'Miami',             altitude:    2, wbgt: 31, country: 'US' },
    'philadelphia':     { city: 'Philadelphia',      altitude:   12, wbgt: 28, country: 'US' },
    'new york':         { city: 'New York/New Jersey', altitude: 9, wbgt: 27, country: 'US' },
    'new jersey':       { city: 'New York/New Jersey', altitude: 9, wbgt: 27, country: 'US' },
    'boston':           { city: 'Boston',            altitude:   43, wbgt: 26, country: 'US' },
    'washington':       { city: 'Washington DC',     altitude:  125, wbgt: 28, country: 'US' },
    'seattle':          { city: 'Seattle',           altitude:   56, wbgt: 22, country: 'US' },
    'los angeles':      { city: 'Los Angeles',       altitude:   71, wbgt: 24, country: 'US' },
    'san francisco':    { city: 'San Francisco Bay', altitude:   16, wbgt: 22, country: 'US' },
    'vancouver':        { city: 'Vancouver',         altitude:   70, wbgt: 21, country: 'CA' },
    'toronto':          { city: 'Toronto',           altitude:   76, wbgt: 26, country: 'CA' }
  };

  /**
   * 解析 venue 字符串 → context
   * 输入: "Mexico City Stadium, Mexico City" / "Dallas Stadium, Dallas" / 等等
   * 输出: { city, altitude, wbgt, country, isMexico, isHighHeat, isHighAltitude } | null
   */
  function venueToContext(venue) {
    if (!venue || typeof venue !== 'string') return null;
    const lower = venue.toLowerCase();
    // 优先匹配最具体的关键词 (避免 "new york/new jersey" 误匹配 "york")
    const keys = Object.keys(VENUE_DB).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (lower.includes(key)) {
        const v = VENUE_DB[key];
        return {
          city: v.city,
          altitude: v.altitude,
          wbgt: v.wbgt,
          country: v.country,
          isMexico: v.country === 'MX',
          isHighHeat: v.wbgt >= 30,
          isHighAltitude: v.altitude >= 1500
        };
      }
    }
    return null;
  }

  /**
   * 一键把 venue 字符串 + 主场对位转换成 h2hCalc/scorePredictions 的 opts
   * @param {string} venue - 'Mexico City Stadium, Mexico City'
   * @param {string} homeTeam - 'A' | 'B' (主队对位)
   */
  function buildMatchContext(venue, homeTeam) {
    const ctx = venueToContext(venue);
    if (!ctx) return { home: homeTeam, venue: venue || null };
    return {
      home: homeTeam,
      venue: ctx.city,
      wbgt: ctx.wbgt
    };
  }

  // ============================================================
  // 公开 API
  // ============================================================

  /**
   * 拿 8 强队 + 残差，全部加起来 = 100% 的冠军概率分布
   * (供"冠军榜"Tab 显示 20-model 共识基准)
   */
  function championDistribution(bench) {
    if (!bench || !bench.championBenchmarks) return [];
    const teams = bench.championBenchmarks.teams || [];
    return teams.map(t => ({
      country: t.country,
      prob: (t.ensemble || 0) / 100,
      ciLow: (t.ciLow || 0) / 100,
      ciHigh: (t.ciHigh || 0) / 100,
      confidence: t.confidence
    }));
  }

  /**
   * 全局配置: 是否启用 Kimi 2026 增量 (默认 true, 便于出问题时一键关闭)
   */
  const flags = {
    enabled: true,
    useKimiEloTable: true,       // Elo 差 → 胜率/平局用 Table B.1
    useKimiMCParams: true,        // K-factor / altitude / heat / 主场优势
    useDixonColes: true,          // ρ = -0.048 低分互依
    useCalibrationMatrix: true,   // Table 9.13 后处理
    useDrawUplift: true,          // 27-30% 平局率调整
    useBenchmarkProbs: true       // 8 强队 ensemble 概率 (读引用, 不改主模型)
  };

  function setFlag(key, value) {
    if (key in flags) flags[key] = !!value;
  }

  global.KimiBenchmarks = {
    load,
    reset,
    // 冠军概率
    ensembleProb,
    championInterval,
    championDistribution,
    // MC 参数
    mcParams,
    kFor,
    homeAdvantageElo,
    altitudeMultiplier,
    heatPenalty,
    dixonColesRho,
    poissonBase,
    // Elo 校准
    eloDrawProbability,
    eloWinProbability,
    // 校准矩阵
    calibrate,
    // 赛制规则
    thirdPlaceAdvance,
    drawUplift,
    // Dixon-Coles
    dixonColesTau,
    // Venue 解析
    venueToContext,
    buildMatchContext,
    // Flags
    flags,
    setFlag
  };
})(typeof window !== 'undefined' ? window : globalThis);
