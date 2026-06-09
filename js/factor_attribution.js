/**
 * 2026 World Cup — Factor Attribution (JS port of mikobinbin v3.4.2)
 *
 * Counterfactual attribution: decompose final_prob into per-factor absolute
 * contribution in probability space, using Elo-equivalent conversion
 * (score * 3000 Elo points → probability delta via _elo_to_prob).
 *
 * Factors: age / exp / form / coaching / mystic / calibration (residual).
 */
;(function (global) {
  'use strict';

  const FACTOR_LABELS = {
    age: '年龄结构',
    exp: '大赛经验',
    form: '近期状态',
    coaching: '教练因素',
    mystic: '玄学因子',
    calibration: '历史校准'
  };

  // Mirrors upstream `team_scoring._elo_to_prob`:
  // p = C * exp(elo / K), clipped to [0.0001, 0.20]
  function eloToProb(elo) {
    const K = 300.0;
    const C = 2.05e-4;
    return Math.max(0.0001, Math.min(0.20, C * Math.exp(elo / K)));
  }

  function _factorDetail(factor, delta) {
    const dp = delta * 100;
    const sign = delta > 0 ? '+' : '';
    const explanations = {
      age:        delta > 0 ? `阵容年龄结构优秀(${sign}${dp.toFixed(2)}%)` : `年龄结构偏年轻或偏老(${sign}${dp.toFixed(2)}%)`,
      exp:        delta > 0 ? `有丰富的大赛淘汰赛经验(${sign}${dp.toFixed(2)}%)` : `缺乏顶级大赛正赛经验(${sign}${dp.toFixed(2)}%)`,
      form:       delta > 0 ? `近期胜率高，状态出色(${sign}${dp.toFixed(2)}%)` : `近期战绩一般，状态低迷(${sign}${dp.toFixed(2)}%)`,
      coaching:   delta > 0 ? `教练经验丰富，战术素养高(${sign}${dp.toFixed(2)}%)` : `教练执教能力有待验证(${sign}${dp.toFixed(2)}%)`,
      mystic:     delta > 0 ? `受主场/新星/易经等正向玄学加持(${sign}${dp.toFixed(2)}%)` : `受热门诅咒等负向玄学影响(${sign}${dp.toFixed(2)}%)`,
      calibration: delta > 0 ? `历史数据和2026特定调整正向(${sign}${dp.toFixed(2)}%)` : `历史数据和2026特定调整负向(${sign}${dp.toFixed(2)}%)`
    };
    return explanations[factor] || `(${sign}${dp.toFixed(2)}%)`;
  }

  function attributeTeam(t) {
    const elo = t.elo || 1700;
    const age = t.age_score || 0;
    const exp = t.exp_score || 0;
    const form = t.form_score || 0;
    const coach = t.coach_score || 0;
    const mystic = t.mystic_score || 0;
    const finalProb = t.final_prob || 0.03;
    const country = t.country || '';

    const eloBaseline = eloToProb(elo);

    // Convert each factor's raw score into a probability delta via Elo equivalent
    const ageDelta = eloToProb(elo + age * 3000) - eloBaseline;
    const expDelta = eloToProb(elo + exp * 3000) - eloBaseline;
    const formDelta = eloToProb(elo + form * 3000) - eloBaseline;
    const coachDelta = eloToProb(elo + coach * 3000) - eloBaseline;
    // mystic_score is already roughly probability-scale
    const mysticDelta = mystic * 0.01;

    const sumDelta = ageDelta + expDelta + formDelta + coachDelta + mysticDelta;
    // Calibration absorbs the residual so attribution sums to total_adjustment
    let calDelta = finalProb - eloBaseline - sumDelta;
    calDelta = Math.max(-0.05, Math.min(0.05, calDelta));

    const rawAttrs = [
      { factor: 'age', delta: ageDelta },
      { factor: 'exp', delta: expDelta },
      { factor: 'form', delta: formDelta },
      { factor: 'coaching', delta: coachDelta },
      { factor: 'mystic', delta: mysticDelta },
      { factor: 'calibration', delta: calDelta }
    ].filter(a => Math.abs(a.delta) > 0.0001);

    const totalAdjustment = finalProb - eloBaseline;
    const totalRaw = rawAttrs.reduce((s, a) => s + a.delta, 0);

    const attributions = rawAttrs.map(a => {
      // Normalize so the sum equals totalAdjustment
      const normalized = totalRaw !== 0 ? a.delta * (totalAdjustment / totalRaw) : 0;
      const pct = totalAdjustment !== 0 ? (normalized / Math.abs(totalAdjustment) * 100) : 0;
      const direction = normalized > 0.001 ? '正向贡献' : (normalized < -0.001 ? '负向拖累' : '中性');
      const label = FACTOR_LABELS[a.factor];
      return {
        factor: a.factor,
        label,
        contribution: normalized,
        contribution_pct: pct,
        direction,
        explanation: `${label} ${direction} ${_factorDetail(a.factor, normalized)}`
      };
    });

    attributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      country,
      final_probability: finalProb,
      elo_baseline: eloBaseline,
      total_adjustment: totalAdjustment,
      attributions
    };
  }

  function attributeAllTeams(teams) {
    return teams.map(attributeTeam);
  }

  global.WorldCupAttribution = {
    attributeTeam,
    attributeAllTeams,
    eloToProb,
    FACTOR_LABELS
  };
})(typeof window !== 'undefined' ? window : globalThis);
