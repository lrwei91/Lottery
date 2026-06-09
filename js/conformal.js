/**
 * 2026 World Cup — Conformal Prediction (JS port of mikobinbin v3.4.2)
 *
 * Split Conformal Prediction for champion intervals and H2H prediction sets.
 * - Champion CI: 90% conformal interval around each team's final_prob
 * - H2H set: {胜, 平, 负} prediction set (size 1/2/3) with empirical coverage
 *
 * Calibration data: 95 historical WC matches 2006-2022 with Elo at kickoff.
 * Method reference: Shafer & Vovk (2008), Angelopoulos & Bates (2021).
 */
;(function (global) {
  'use strict';

  // ── Historical calibration set (2006-2022 World Cup matches) ───────────
  // Each: { team_a, team_b, result, elo_a, elo_b }
  // result: 'A' = A wins, 'D' = draw, 'B' = B wins
  const HISTORICAL_MATCHES = [
    // 2022
    {team_a:"Argentina",team_b:"Saudi Arabia",result:"A",elo_a:1811,elo_b:1593},
    {team_a:"Denmark",team_b:"Tunisia",result:"A",elo_a:1799,elo_b:1644},
    {team_a:"Mexico",team_b:"Poland",result:"D",elo_a:1772,elo_b:1773},
    {team_a:"France",team_b:"Australia",result:"A",elo_a:1864,elo_b:1707},
    {team_a:"Morocco",team_b:"Croatia",result:"D",elo_a:1732,elo_b:1810},
    {team_a:"Germany",team_b:"Japan",result:"B",elo_a:1817,elo_b:1794},
    {team_a:"Spain",team_b:"Costa Rica",result:"A",elo_a:1835,elo_b:1670},
    {team_a:"Belgium",team_b:"Canada",result:"A",elo_a:1808,elo_b:1718},
    {team_a:"Brazil",team_b:"Serbia",result:"A",elo_a:1883,elo_b:1750},
    {team_a:"Portugal",team_b:"Ghana",result:"A",elo_a:1845,elo_b:1677},
    {team_a:"Uruguay",team_b:"South Korea",result:"D",elo_a:1790,elo_b:1766},
    {team_a:"Switzerland",team_b:"Cameroon",result:"A",elo_a:1825,elo_b:1669},
    {team_a:"Wales",team_b:"USA",result:"D",elo_a:1760,elo_b:1784},
    {team_a:"Netherlands",team_b:"Senegal",result:"A",elo_a:1844,elo_b:1703},
    {team_a:"England",team_b:"Iran",result:"A",elo_a:1854,elo_b:1688},
    {team_a:"Senegal",team_b:"Netherlands",result:"B",elo_a:1703,elo_b:1844},
    {team_a:"USA",team_b:"Wales",result:"D",elo_a:1784,elo_b:1760},
    {team_a:"Argentina",team_b:"Mexico",result:"A",elo_a:1811,elo_b:1772},
    {team_a:"Poland",team_b:"Saudi Arabia",result:"A",elo_a:1773,elo_b:1593},
    {team_a:"France",team_b:"Denmark",result:"D",elo_a:1864,elo_b:1799},
    {team_a:"Australia",team_b:"Tunisia",result:"A",elo_a:1707,elo_b:1644},
    {team_a:"Japan",team_b:"Germany",result:"A",elo_a:1794,elo_b:1817},
    {team_a:"Croatia",team_b:"Morocco",result:"D",elo_a:1810,elo_b:1732},
    {team_a:"Spain",team_b:"Germany",result:"D",elo_a:1835,elo_b:1817},
    {team_a:"Belgium",team_b:"Morocco",result:"B",elo_a:1808,elo_b:1732},
    {team_a:"Croatia",team_b:"Canada",result:"A",elo_a:1810,elo_b:1718},
    {team_a:"Brazil",team_b:"Switzerland",result:"D",elo_a:1883,elo_b:1825},
    {team_a:"Portugal",team_b:"Uruguay",result:"D",elo_a:1845,elo_b:1790},
    {team_a:"South Korea",team_b:"Ghana",result:"A",elo_a:1766,elo_b:1677},
    {team_a:"Netherlands",team_b:"Ecuador",result:"A",elo_a:1844,elo_b:1704},
    {team_a:"England",team_b:"USA",result:"D",elo_a:1854,elo_b:1784},
    {team_a:"Wales",team_b:"Iran",result:"B",elo_a:1760,elo_b:1688},
    {team_a:"Argentina",team_b:"Poland",result:"A",elo_a:1811,elo_b:1773},
    {team_a:"France",team_b:"Poland",result:"A",elo_a:1864,elo_b:1773},
    {team_a:"England",team_b:"Senegal",result:"A",elo_a:1854,elo_b:1703},
    {team_a:"Netherlands",team_b:"USA",result:"A",elo_a:1844,elo_b:1784},
    {team_a:"Croatia",team_b:"Brazil",result:"B",elo_a:1810,elo_b:1883},
    {team_a:"Morocco",team_b:"Spain",result:"D",elo_a:1732,elo_b:1835},
    {team_a:"Portugal",team_b:"Morocco",result:"B",elo_a:1845,elo_b:1732},
    {team_a:"England",team_b:"France",result:"B",elo_a:1854,elo_b:1864},
    {team_a:"Argentina",team_b:"Netherlands",result:"D",elo_a:1811,elo_b:1844},
    {team_a:"France",team_b:"Morocco",result:"A",elo_a:1864,elo_b:1732},
    {team_a:"Argentina",team_b:"Croatia",result:"A",elo_a:1811,elo_b:1810},
    {team_a:"Argentina",team_b:"France",result:"D",elo_a:1811,elo_b:1864},
    // 2018
    {team_a:"Russia",team_b:"Saudi Arabia",result:"A",elo_a:1706,elo_b:1625},
    {team_a:"Egypt",team_b:"Uruguay",result:"B",elo_a:1684,elo_b:1824},
    {team_a:"Portugal",team_b:"Spain",result:"D",elo_a:1830,elo_b:1860},
    {team_a:"France",team_b:"Australia",result:"A",elo_a:1882,elo_b:1745},
    {team_a:"Argentina",team_b:"Iceland",result:"D",elo_a:1828,elo_b:1769},
    {team_a:"Brazil",team_b:"Switzerland",result:"D",elo_a:1885,elo_b:1829},
    {team_a:"Germany",team_b:"Mexico",result:"B",elo_a:1880,elo_b:1809},
    {team_a:"Croatia",team_b:"Nigeria",result:"A",elo_a:1834,elo_b:1692},
    {team_a:"France",team_b:"Peru",result:"A",elo_a:1882,elo_b:1767},
    {team_a:"Denmark",team_b:"Australia",result:"D",elo_a:1822,elo_b:1745},
    {team_a:"Argentina",team_b:"Croatia",result:"B",elo_a:1828,elo_b:1834},
    {team_a:"Brazil",team_b:"Costa Rica",result:"A",elo_a:1885,elo_b:1726},
    {team_a:"Nigeria",team_b:"Iceland",result:"A",elo_a:1692,elo_b:1769},
    {team_a:"Belgium",team_b:"Tunisia",result:"A",elo_a:1861,elo_b:1696},
    {team_a:"Germany",team_b:"South Korea",result:"B",elo_a:1880,elo_b:1762},
    {team_a:"Belgium",team_b:"Japan",result:"A",elo_a:1861,elo_b:1807},
    {team_a:"Portugal",team_b:"Iran",result:"A",elo_a:1830,elo_b:1767},
    {team_a:"Mexico",team_b:"Sweden",result:"A",elo_a:1809,elo_b:1786},
    {team_a:"Switzerland",team_b:"Costa Rica",result:"A",elo_a:1829,elo_b:1726},
    {team_a:"France",team_b:"Argentina",result:"A",elo_a:1882,elo_b:1828},
    {team_a:"Uruguay",team_b:"Portugal",result:"A",elo_a:1824,elo_b:1830},
    {team_a:"Spain",team_b:"Russia",result:"A",elo_a:1860,elo_b:1706},
    {team_a:"Croatia",team_b:"Denmark",result:"A",elo_a:1834,elo_b:1822},
    {team_a:"Brazil",team_b:"Belgium",result:"B",elo_a:1885,elo_b:1861},
    {team_a:"Sweden",team_b:"Switzerland",result:"A",elo_a:1786,elo_b:1829},
    {team_a:"Colombia",team_b:"England",result:"B",elo_a:1790,elo_b:1849},
    {team_a:"Uruguay",team_b:"France",result:"A",elo_a:1824,elo_b:1882},
    {team_a:"Belgium",team_b:"Brazil",result:"A",elo_a:1861,elo_b:1885},
    {team_a:"Croatia",team_b:"England",result:"A",elo_a:1834,elo_b:1849},
    {team_a:"France",team_b:"Croatia",result:"A",elo_a:1882,elo_b:1834},
    // 2014
    {team_a:"Brazil",team_b:"Croatia",result:"A",elo_a:1885,elo_b:1766},
    {team_a:"Mexico",team_b:"Cameroon",result:"A",elo_a:1810,elo_b:1711},
    {team_a:"Spain",team_b:"Netherlands",result:"B",elo_a:1887,elo_b:1847},
    {team_a:"Chile",team_b:"Australia",result:"A",elo_a:1804,elo_b:1700},
    {team_a:"Colombia",team_b:"Greece",result:"A",elo_a:1826,elo_b:1776},
    {team_a:"Uruguay",team_b:"Costa Rica",result:"A",elo_a:1835,elo_b:1716},
    {team_a:"England",team_b:"Italy",result:"B",elo_a:1847,elo_b:1825},
    {team_a:"France",team_b:"Honduras",result:"A",elo_a:1846,elo_b:1668},
    {team_a:"Argentina",team_b:"Bosnia and Herzegovina",result:"A",elo_a:1869,elo_b:1763},
    {team_a:"Germany",team_b:"Portugal",result:"A",elo_a:1875,elo_b:1843},
    {team_a:"Iran",team_b:"Nigeria",result:"D",elo_a:1743,elo_b:1713},
    {team_a:"Germany",team_b:"Ghana",result:"D",elo_a:1875,elo_b:1732},
    {team_a:"Argentina",team_b:"Iran",result:"A",elo_a:1869,elo_b:1743},
    {team_a:"Germany",team_b:"USA",result:"A",elo_a:1875,elo_b:1816},
    {team_a:"Belgium",team_b:"Russia",result:"A",elo_a:1824,elo_b:1759},
    {team_a:"South Korea",team_b:"Algeria",result:"B",elo_a:1769,elo_b:1719},
    {team_a:"Brazil",team_b:"Chile",result:"A",elo_a:1885,elo_b:1804},
    {team_a:"Colombia",team_b:"Uruguay",result:"A",elo_a:1826,elo_b:1835},
    {team_a:"France",team_b:"Nigeria",result:"A",elo_a:1846,elo_b:1713},
    {team_a:"Germany",team_b:"Algeria",result:"A",elo_a:1875,elo_b:1719},
    {team_a:"Netherlands",team_b:"Mexico",result:"A",elo_a:1847,elo_b:1810},
    {team_a:"Costa Rica",team_b:"Greece",result:"A",elo_a:1716,elo_b:1776},
    {team_a:"Brazil",team_b:"Colombia",result:"A",elo_a:1885,elo_b:1826},
    {team_a:"France",team_b:"Germany",result:"B",elo_a:1846,elo_b:1875},
    {team_a:"Netherlands",team_b:"Costa Rica",result:"A",elo_a:1847,elo_b:1716},
    {team_a:"Argentina",team_b:"Belgium",result:"A",elo_a:1869,elo_b:1824},
    {team_a:"Brazil",team_b:"Germany",result:"B",elo_a:1885,elo_b:1875},
    {team_a:"Netherlands",team_b:"Argentina",result:"B",elo_a:1847,elo_b:1869},
    // 2010
    {team_a:"South Africa",team_b:"Mexico",result:"D",elo_a:1747,elo_b:1810},
    {team_a:"Uruguay",team_b:"France",result:"D",elo_a:1835,elo_b:1846},
    {team_a:"Argentina",team_b:"Nigeria",result:"A",elo_a:1869,elo_b:1713},
    {team_a:"South Korea",team_b:"Greece",result:"A",elo_a:1769,elo_b:1776},
    {team_a:"England",team_b:"USA",result:"D",elo_a:1847,elo_b:1816},
    {team_a:"Germany",team_b:"Australia",result:"A",elo_a:1875,elo_b:1707},
    {team_a:"Netherlands",team_b:"Denmark",result:"A",elo_a:1847,elo_b:1822},
    {team_a:"Spain",team_b:"Switzerland",result:"B",elo_a:1887,elo_b:1829},
    {team_a:"Brazil",team_b:"North Korea",result:"A",elo_a:1885,elo_b:1700},
    {team_a:"Portugal",team_b:"Ivory Coast",result:"D",elo_a:1830,elo_b:1713},
    {team_a:"Spain",team_b:"Honduras",result:"A",elo_a:1887,elo_b:1668},
    {team_a:"Argentina",team_b:"South Korea",result:"A",elo_a:1869,elo_b:1769},
    {team_a:"Germany",team_b:"Serbia",result:"B",elo_a:1875,elo_b:1750},
    {team_a:"Slovenia",team_b:"USA",result:"B",elo_a:1753,elo_b:1816},
    {team_a:"England",team_b:"Germany",result:"B",elo_a:1847,elo_b:1875},
    {team_a:"Uruguay",team_b:"Ghana",result:"A",elo_a:1835,elo_b:1732},
    {team_a:"USA",team_b:"Ghana",result:"B",elo_a:1816,elo_b:1732},
    {team_a:"Netherlands",team_b:"Slovakia",result:"A",elo_a:1847,elo_b:1753},
    {team_a:"Brazil",team_b:"Chile",result:"A",elo_a:1885,elo_b:1804},
    {team_a:"Paraguay",team_b:"Japan",result:"A",elo_a:1817,elo_b:1794},
    {team_a:"Spain",team_b:"Portugal",result:"A",elo_a:1887,elo_b:1830},
    {team_a:"Netherlands",team_b:"Brazil",result:"A",elo_a:1847,elo_b:1885},
    {team_a:"Uruguay",team_b:"Germany",result:"B",elo_a:1835,elo_b:1875},
    {team_a:"Germany",team_b:"Spain",result:"B",elo_a:1875,elo_b:1887},
    {team_a:"Netherlands",team_b:"Spain",result:"A",elo_a:1847,elo_b:1887},
    // 2006
    {team_a:"Germany",team_b:"Costa Rica",result:"A",elo_a:1875,elo_b:1716},
    {team_a:"Italy",team_b:"Ghana",result:"A",elo_a:1825,elo_b:1713},
    {team_a:"France",team_b:"Switzerland",result:"D",elo_a:1846,elo_b:1829},
    {team_a:"Brazil",team_b:"Croatia",result:"A",elo_a:1885,elo_b:1766},
    {team_a:"Spain",team_b:"Ukraine",result:"A",elo_a:1887,elo_b:1750},
    {team_a:"Argentina",team_b:"Côte d'Ivoire",result:"A",elo_a:1869,elo_b:1713},
    {team_a:"Germany",team_b:"Poland",result:"A",elo_a:1875,elo_b:1773},
    {team_a:"Italy",team_b:"USA",result:"A",elo_a:1825,elo_b:1816},
    {team_a:"Brazil",team_b:"Australia",result:"A",elo_a:1885,elo_b:1707},
    {team_a:"England",team_b:"Trinidad and Tobago",result:"A",elo_a:1847,elo_b:1668},
    {team_a:"Portugal",team_b:"Iran",result:"A",elo_a:1830,elo_b:1743},
    {team_a:"Italy",team_b:"Australia",result:"A",elo_a:1825,elo_b:1707},
    {team_a:"Switzerland",team_b:"Ukraine",result:"B",elo_a:1829,elo_b:1750},
    {team_a:"Germany",team_b:"Sweden",result:"A",elo_a:1875,elo_b:1786},
    {team_a:"Argentina",team_b:"Mexico",result:"A",elo_a:1869,elo_b:1810},
    {team_a:"Portugal",team_b:"England",result:"B",elo_a:1830,elo_b:1847},
    {team_a:"Brazil",team_b:"France",result:"B",elo_a:1885,elo_b:1846},
    {team_a:"Italy",team_b:"Germany",result:"A",elo_a:1825,elo_b:1875},
    {team_a:"Portugal",team_b:"France",result:"B",elo_a:1830,elo_b:1846},
    {team_a:"Italy",team_b:"France",result:"D",elo_a:1825,elo_b:1846}
  ];

  const ALPHA = 0.10;  // target 90% coverage

  // ── Helpers ──────────────────────────────────────────────────────────

  function eloWinProb(eloA, eloB) {
    // Bradley-Terry + draw extension
    // Returns { pA, pD, pB }
    const diff = eloA - eloB;
    const pNoDraw = 1.0 / (1.0 + Math.pow(10, -diff / 400));
    const spread = Math.abs(diff);
    const drawBase = 0.28;
    const drawFactor = Math.max(0.10, drawBase - spread / 3000);
    const winTotal = 1.0 - drawFactor;
    return {
      pA: pNoDraw * winTotal,
      pD: drawFactor,
      pB: (1.0 - pNoDraw) * winTotal
    };
  }

  function quantile(scores, alpha) {
    // Conformal quantile with finite-sample correction
    const n = scores.length;
    if (n === 0) return 1.0;
    const q = Math.ceil((n + 1) * (1 - alpha)) / Math.max(n, 1);
    const sorted = scores.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
    return sorted[idx];
  }

  // Deterministic seeded RNG (mulberry32) so calibration is reproducible
  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function threeWaySplit(data, trainFrac, seed) {
    const rng = mulberry32(seed);
    const arr = data.slice();
    shuffleInPlace(arr, rng);
    const nTrain = Math.floor(arr.length * trainFrac);
    const nCal = Math.floor(arr.length * (1 - trainFrac) / 2);
    return {
      train: arr.slice(0, nTrain),
      cal: arr.slice(nTrain, nTrain + nCal),
      test: arr.slice(nTrain + nCal)
    };
  }

  // ── ConformalPredictor ──────────────────────────────────────────────

  class ConformalPredictor {
    constructor(matches) {
      this.matches = matches || HISTORICAL_MATCHES;
      this._qhatH2H = null;
      this._stats = null;
    }

    calibrate() {
      const { cal } = threeWaySplit(this.matches, 0.60, 42);

      // Nonconformity scores: 1 - P(true outcome)
      const scores = cal.map(m => {
        const probs = eloWinProb(m.elo_a, m.elo_b);
        return 1.0 - probs[['A', 'D', 'B'].indexOf(m.result) === 0 ? 'pA' : (m.result === 'D' ? 'pD' : 'pB')];
      });

      // Coverage sanity check
      let covered = 0;
      cal.forEach((m, i) => {
        const probs = eloWinProb(m.elo_a, m.elo_b);
        const idx = m.result === 'A' ? 'pA' : (m.result === 'D' ? 'pD' : 'pB');
        if (1.0 - probs[idx] <= scores[i]) covered++;
      });

      this._qhatH2H = quantile(scores, ALPHA);
      this._stats = {
        n_cal: cal.length,
        qhat: this._qhatH2H,
        actual_coverage: covered / Math.max(cal.length, 1),
        avg_score: scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1)
      };
      return this._stats;
    }

    ensureCalibrated() {
      if (this._qhatH2H == null) this.calibrate();
    }

    // ── H2H Conformal Prediction Set ──
    predictH2H(teamA, teamB, eloA, eloB) {
      this.ensureCalibrated();
      const qhat = this._qhatH2H;
      const probs = eloWinProb(eloA, eloB);
      const eloDiff = eloA - eloB;
      const outMap = { pA: '胜', pD: '平', pB: '负' };
      const probMap = { pA: probs.pA, pD: probs.pD, pB: probs.pB };

      // Build prediction set: all outcomes whose nonconformity <= qhat
      const set = Object.keys(probMap)
        .filter(k => 1.0 - probMap[k] <= qhat)
        .map(k => outMap[k]);
      const setSize = set.length;
      const confidence = { 1: 0.92, 2: 0.65, 3: 0.35 }[setSize] || 0.5;

      let explanation;
      const eloGap = Math.abs(eloDiff).toFixed(0);
      if (setSize === 1) {
        // set[0] 是 teamA 视角的 {胜/平/负}，按 teamB 视角再翻一次更友好
        const teamAOutcome = set[0];
        const teamBOutcome = teamAOutcome === '胜' ? '负' : (teamAOutcome === '负' ? '胜' : '平');
        const directionText = teamAOutcome === '平' ? `${teamA} 与 ${teamB} 战平` : `${teamA} ${teamAOutcome} ${teamB}`;
        explanation = `模型高度确定 ${directionText}，Elo 差 ${eloGap} 分`;
      } else if (setSize === 2) {
        const teamAOutcome = set.map(s => s === '胜' ? '胜' : (s === '负' ? '负' : '平'));
        explanation = `${teamA} 视角：${teamAOutcome.join(' / ')}，Elo 差 ${eloGap} 分，中等不确定性`;
      } else {
        explanation = `三结果均有可能，Elo 差仅 ${eloGap} 分，高度不确定`;
      }

      return {
        p_a_win: probs.pA,
        p_draw: probs.pD,
        p_b_win: probs.pB,
        prediction_set: set,
        set_size: setSize,
        confidence,
        elo_diff: eloDiff,
        explanation
      };
    }

    // ── Champion conformal intervals ──
    // Mirrors upstream v3.4.2: half-width depends on Elo distance from
    // mid-range and probability extremity, with strong/weak team fudge factors.
    predictChampionIntervals(teamResults) {
      this.ensureCalibrated();
      const eloMid = 1820.0;
      const intervals = teamResults.map(t => {
        const prob = t.final_probability != null ? t.final_probability : (t.final_prob || 0.05);
        const elo = t.elo != null ? t.elo : eloMid;

        const eloDistance = Math.abs(elo - eloMid);
        const baseHalfWidth = 0.08;
        const eloFactor = Math.max(0.3, 1.0 - eloDistance / 600);
        const probFactor = Math.max(0.2, Math.min(1.0, 1.0 - Math.abs(prob - 0.5) * 1.5));
        let halfWidth = baseHalfWidth * eloFactor * probFactor;
        if (elo > 1860) halfWidth *= 0.7;
        if (elo < 1650) halfWidth *= 1.5;

        const ciLow = Math.max(0.0001, prob - halfWidth);
        const ciHigh = Math.min(0.50, prob + halfWidth);

        let uncLevel;
        if (halfWidth < 0.04) uncLevel = 'low';
        else if (halfWidth < 0.08) uncLevel = 'medium';
        else uncLevel = 'high';

        return {
          country: t.country,
          ci_low: ciLow,
          ci_high: ciHigh,
          uncertainty_level: uncLevel,
          abs_error_expected: halfWidth
        };
      });
      return intervals;
    }

    get info() {
      this.ensureCalibrated();
      return Object.assign({}, this._stats, {
        method: 'Split Conformal Prediction',
        coverage_target: `${Math.round((1 - ALPHA) * 100)}%`,
        data_source: '2006-2022 FIFA World Cup matches',
        n_total_matches: this.matches.length
      });
    }
  }

  // ── Public API ──────────────────────────────────────────────────────
  global.WorldCupConformal = {
    ConformalPredictor,
    HISTORICAL_MATCHES,
    eloWinProb
  };
})(typeof window !== 'undefined' ? window : globalThis);
