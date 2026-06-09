/**
 * 2026 World Cup Predictor tab
 * Static frontend port of mikobinbin/2026-world-cup-predictor.
 */
;(function () {
  'use strict';

  const DATA_URL = 'data/worldcup_2026.json';
  const MATCHES_URL = 'data/worldcup_matches.json';

  const state = {
    loaded: false,
    loading: false,
    metadata: null,
    teams: [],
    ucl: {},
    matchesData: null,
    matchesLoaded: false,
    activeTab: 'matches',
    selectedSquad: '',
    selectedGroup: 'TIME',
    countdownTimerId: null,
    llmPredictions: null,   // { generatedAt, model, predictions: [{matchId, ...}] } — h2h 单场
    llmOutright: null,      // { generatedAt, model, predictions: [{country, winProb, ...}] } — 冠军 outright
    oddsSnapshots: null,    // { meta, polymarket, 'the-odds-api', 'football-data' }
    oddsHistory: null       // { 'the-odds-api': [{ fetchedAt, events: [...] }, ...] } — 最近 28 个时间点
  };

  const WORLD_CUP_START = new Date('2026-06-11T19:00:00Z');

  const COUNTRY_CODE = {
    Argentina: 'AR',
    Brazil: 'BR',
    France: 'FR',
    Germany: 'DE',
    Spain: 'ES',
    England: 'EN',
    Portugal: 'PT',
    Netherlands: 'NL',
    Belgium: 'BE',
    Croatia: 'HR',
    Switzerland: 'CH',
    Austria: 'AT',
    'Czech Republic': 'CZ',
    Turkey: 'TR',
    Sweden: 'SE',
    Morocco: 'MA',
    Senegal: 'SN',
    Egypt: 'EG',
    Algeria: 'DZ',
    Ghana: 'GH',
    'Ivory Coast': 'CI',
    Tunisia: 'TN',
    Japan: 'JP',
    'South Korea': 'KR',
    Iran: 'IR',
    Qatar: 'QA',
    'Saudi Arabia': 'SA',
    Australia: 'AU',
    USA: 'US',
    Mexico: 'MX',
    Canada: 'CA',
    Panama: 'PA',
    Haiti: 'HT',
    'New Zealand': 'NZ',
    Ecuador: 'EC',
    Paraguay: 'PY',
    Colombia: 'CO',
    Uruguay: 'UY',
    Norway: 'NO',
    Uzbekistan: 'UZ',
    Jordan: 'JO',
    'Cape Verde': 'CV',
    'DR Congo': 'CD',
    'South Africa': 'ZA',
    'Bosnia and Herzegovina': 'BA',
    'Scotland': 'SCT',
    'Curaçao': 'CW',
    'Iraq': 'IQ'
  };

  const COUNTRY_FLAGS = {
    'Argentina': '🇦🇷',
    'Brazil': '🇧🇷',
    'France': '🇫🇷',
    'Germany': '🇩🇪',
    'Spain': '🇪🇸',
    'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'Portugal': '🇵🇹',
    'Netherlands': '🇳🇱',
    'Belgium': '🇧🇪',
    'Croatia': '🇭🇷',
    'Switzerland': '🇨🇭',
    'Austria': '🇦🇹',
    'Czech Republic': '🇨🇿',
    'Turkey': '🇹🇷',
    'Sweden': '🇸🇪',
    'Morocco': '🇲🇦',
    'Senegal': '🇸🇳',
    'Egypt': '🇪🇬',
    'Algeria': '🇩🇿',
    'Ghana': '🇬🇭',
    'Ivory Coast': '🇨🇮',
    'Tunisia': '🇹🇳',
    'Japan': '🇯🇵',
    'South Korea': '🇰🇷',
    'Iran': '🇮🇷',
    'Qatar': '🇶🇦',
    'Saudi Arabia': '🇸🇦',
    'Australia': '🇦🇺',
    'USA': '🇺🇸',
    'Mexico': '🇲🇽',
    'Canada': '🇨🇦',
    'Panama': '🇵🇦',
    'Haiti': '🇭🇹',
    'New Zealand': '🇳🇿',
    'Ecuador': '🇪🇨',
    'Paraguay': '🇵🇾',
    'Colombia': '🇨🇴',
    'Uruguay': '🇺🇾',
    'Norway': '🇳🇴',
    'Uzbekistan': '🇺🇿',
    'Jordan': '🇯🇴',
    'Cape Verde': '🇨🇻',
    'DR Congo': '🇨🇩',
    'South Africa': '🇿🇦',
    'Bosnia and Herzegovina': '🇧🇦',
    'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'Curaçao': '🇨🇼',
    'Iraq': '🇮🇶'
  };

  function flag(country) {
    return COUNTRY_FLAGS[country] || '🏳️';
  }

  // Translations loaded from data/worldcup_names.json
  let COUNTRY_CN = {};
  let PLAYER_CN = {};

  function countryName(english) {
    return COUNTRY_CN[english] || english;
  }

  function playerName(english) {
    return PLAYER_CN[english] || english;
  }

  const POSITION_CN = { GK: '门将', DF: '后卫', MF: '中场', FW: '前锋' };

  function translateText(text) {
    if (!text) return '';
    let result = text;
    for (const en of Object.keys(COUNTRY_CN)) {
      result = result.split(en).join(countryName(en));
    }
    return result;
  }

  const POLY_WINNER = {
    France: { price: 0.18 },
    Spain: { price: 0.17 },
    England: { price: 0.11 },
    Portugal: { price: 0.10 },
    Brazil: { price: 0.09 },
    Argentina: { price: 0.08 },
    Germany: { price: 0.05 },
    Netherlands: { price: 0.03 },
    Norway: { price: 0.02 },
    Japan: { price: 0.02 },
    Colombia: { price: 0.018 },
    Belgium: { price: 0.018 },
    Morocco: { price: 0.015 },
    USA: { price: 0.012 },
    Uruguay: { price: 0.011 },
    Mexico: { price: 0.011 },
    Switzerland: { price: 0.010 },
    Croatia: { price: 0.009 },
    Ecuador: { price: 0.008 },
    Turkey: { price: 0.007 },
    Senegal: { price: 0.007 },
    Austria: { price: 0.006 },
    Sweden: { price: 0.006 },
    Canada: { price: 0.004 },
    'South Korea': { price: 0.003 },
    Ghana: { price: 0.003 },
    Australia: { price: 0.002 },
    'Ivory Coast': { price: 0.002 },
    Algeria: { price: 0.002 },
    Egypt: { price: 0.001 },
    Paraguay: { price: 0.001 },
    Qatar: { price: 0.001 },
    'Saudi Arabia': { price: 0.001 },
    Tunisia: { price: 0.001 },
    Uzbekistan: { price: 0.001 },
    'Czech Republic': { price: 0.001 }
  };

  // Polymarket 用的国家名跟 ticai 数据源略有差异，做一下映射
  // 优先直接相等，找不到再走 alias 表
  const POLY_TO_TICAI_ALIAS = {
    'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
    'Congo DR': 'DR Congo',
    'Czechia': 'Czech Republic',
    'Turkiye': 'Turkey',
    'United States': 'USA'
  };

  // 地区/特殊市场，ticai 没有单国对应 → null
  const POLY_NON_COUNTRY = new Set([
    'Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania',
    'Any Other Team', 'Another Continent', 'another continent'
  ]);
  // Polymarket 的 "Team A?" placeholder markets
  const POLY_TEAM_PLACEHOLDER = /^Team [A-Z]{1,2}$/;

  // 把 Polymarket outright 的 country 名映射到 ticai 数据里的 country
  // 返回 null 表示不是 ticai 单国市场（地区、placeholder、未知队）
  function polyCountryToTicai(name) {
    if (!name) return null;
    const trimmed = name.trim();
    if (POLY_NON_COUNTRY.has(trimmed)) return null;
    if (POLY_TEAM_PLACEHOLDER.test(trimmed)) return null;
    if (POLY_TO_TICAI_ALIAS[trimmed]) return POLY_TO_TICAI_ALIAS[trimmed];
    return trimmed;
  }

  const FACTORS = [
    { key: 'elo_score', label: 'Elo 锚点', color: 'var(--back-start)', scale: 0.15 },
    { key: 'age_score', label: '年龄结构', color: 'var(--accent)', scale: 0.10 },
    { key: 'exp_score', label: '大赛经验', color: 'var(--warning)', scale: 0.12 },
    { key: 'form_score', label: '近期状态', color: '#9ca3af', scale: 0.06 },
    { key: 'coach_score', label: '教练因素', color: '#ac8e68', scale: 0.06 },
    { key: 'mystic_score', label: '玄学因子', color: 'var(--front-start)', scale: 0.08 }
  ];

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pct(value, digits = 1) {
    return `${((value || 0) * 100).toFixed(digits)}%`;
  }

  function signedPct(value, digits = 2) {
    if (!value) return '0.00%';
    const num = (value * 100).toFixed(digits);
    return `${value > 0 ? '+' : ''}${num}%`;
  }

  function pad2(value) {
    return value < 10 ? `0${value}` : String(value);
  }

  function code(country) {
    return COUNTRY_CODE[country] || country.slice(0, 2).toUpperCase();
  }

  function clsByShift(value) {
    if (value > 0.0001) return 'is-positive';
    if (value < -0.0001) return 'is-negative';
    return 'is-neutral';
  }

  function getBeijingTimeInfo(date, time) {
    try {
      // Input time is UTC from the official FIFA calendar API.
      const d = new Date(date + 'T' + time + ':00Z');
      
      // Format parts in UTC+8 (Asia/Shanghai)
      const formatter = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false
      });
      const parts = formatter.formatToParts(d);
      const month = parts.find(p => p.type === 'month').value;
      const day = parts.find(p => p.type === 'day').value;
      const hour = parts.find(p => p.type === 'hour').value;
      const minute = parts.find(p => p.type === 'minute').value;
      let weekday = parts.find(p => p.type === 'weekday').value;
      
      if (weekday.length === 1) {
        weekday = '周' + weekday;
      }
      
      return {
        date: month + '-' + day,
        dateStr: month + '月' + day + '日',
        time: hour + ':' + minute,
        day: weekday
      };
    } catch (e) {
      console.error("Time zone conversion failed:", e);
      return {
        date: date.slice(5),
        dateStr: date.slice(5),
        time: time,
        day: ''
      };
    }
  }

  function sortedTeams() {
    return state.teams.slice().sort((a, b) => (b.final_prob || 0) - (a.final_prob || 0));
  }

  function findTeam(country) {
    const found = state.teams.find(team => team.country === country);
    if (found) return found;
    // Alias fallback for name variants across data sources
    const aliases = {
      'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
      'Cabo Verde': 'Cape Verde',
    };
    const alias = aliases[country];
    if (alias) return state.teams.find(team => team.country === alias) || null;
    return null;
  }

  function findScheduleMatch(matchId, home, away) {
    if (!state.matchesData || !state.matchesData.groups) return null;
    for (const group of Object.values(state.matchesData.groups)) {
      const match = (group.matches || []).find(item => (
        (matchId && item.id === matchId) ||
        (!matchId && item.home === home && item.away === away)
      ));
      if (match) return match;
    }
    return null;
  }

  async function loadNames() {
    try {
      const res = await fetch('data/worldcup_names.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const names = await res.json();
      COUNTRY_CN = names.countryNames || {};
      PLAYER_CN = names.playerNames || {};
    } catch (e) {
      console.warn('Failed to load name translations:', e);
    }
  }

  async function loadData() {
    if (state.loaded || state.loading) return;
    state.loading = true;
    const root = el('worldcupRoot');
    if (root) root.innerHTML = '<div class="card"><div class="empty-state">正在加载世界杯预测数据...</div></div>';

    await loadNames();

    try {
      await loadMatches();

      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      state.metadata = payload.metadata || {};
      const rawTeams = Array.isArray(payload.teams) ? payload.teams : [];
      if (state.matchesData && state.matchesData.groups) {
        const participatingTeams = new Set();
        Object.keys(state.matchesData.groups).forEach(groupKey => {
          const g = state.matchesData.groups[groupKey];
          if (g && g.teams) g.teams.forEach(t => participatingTeams.add(t));
        });
        const rawToMatch = { 'Bosnia and Herzegovina': 'Bosnia-Herzegovina', 'Cape Verde': 'Cabo Verde' };
        state.teams = rawTeams.filter(team => {
          if (participatingTeams.has(team.country)) return true;
          const matchName = rawToMatch[team.country];
          return matchName && participatingTeams.has(matchName);
        });
      } else {
        state.teams = rawTeams;
      }
      state.ucl = payload.ucl || {};
      const teams = sortedTeams();
      state.selectedSquad = teams[0]?.country || '';
      // v3.4.2: Conformal Prediction + Factor Attribution
      // 计算结果挂在 state.conformal / state.attribution 上，渲染层从这里取
      enrichTeamsWithConformalAndAttribution();
      state.loaded = true;
      // 实时数据快照（赔率/Polymarket）跟核心数据并行加载：保证首次 render 就有赔率，
      // 避免"先空再补"的窗口被网络抖动卡住
      await Promise.all([
        loadOddsSnapshots(),
        loadOddsHistory()
      ]);
      render();
      // LLM 预测快照（用户本地跑 LLM 后才生成，fire-and-forget 合理）
      loadLLMPredictions();
      loadLLMOutright();
    } catch (error) {
      console.error('World Cup data load failed:', error);
      if (root) {
        root.innerHTML = '<div class="card"><div class="error-state">世界杯预测数据加载失败，请稍后重试。</div></div>';
      }
    } finally {
      state.loading = false;
    }
  }

  // 本地 LLM 跑完的预测快照（fire-and-forget，不阻塞主加载）
  async function loadLLMPredictions() {
    try {
      const res = await fetch('data/wc_llm_predictions.json?t=' + Date.now(), { cache: 'no-cache' });
      if (!res.ok) return;
      const payload = await res.json();
      state.llmPredictions = payload;
      // LLM 预测加载完，刷新对战卡片（如果已经渲染了）
      if (state.loaded) render();
    } catch (e) {
      // 文件不存在是正常（用户还没跑 LLM）
    }
  }

  // 本地 LLM 跑完的冠军 outright 预测（独立文件，独立 fire-and-forget）
  async function loadLLMOutright() {
    try {
      const res = await fetch('data/wc_llm_outright.json?t=' + Date.now(), { cache: 'no-cache' });
      if (!res.ok) return;
      const payload = await res.json();
      state.llmOutright = payload;
      // 冠军概率 tab 用了 LLM outright
      if (state.loaded) render();
    } catch (e) {
      // 文件不存在是正常（用户还没跑 LLM outright）
    }
  }

  // 赔率历史快照（cron 每 6h 累积一次，保留最近 28 个点 = 约 7 天）
  async function loadOddsHistory() {
    try {
      const res = await fetch('/api/odds/history?source=the-odds-api', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const payload = await res.json();
      state.oddsHistory = { 'the-odds-api': payload.history || [] };
    } catch (e) {
      console.warn('odds history 加载失败:', e);
    }
  }

  // 实时数据快照（Polymarket / The Odds API / football-data / Polymarket outright）
  // 由 Vercel Cron 每天 0:00 UTC 写入 KV，前端直接 fetch
  async function loadOddsSnapshots() {
    try {
      const res = await fetch('/api/odds/snapshots', { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const payload = await res.json();
      state.oddsSnapshots = payload;
      // 健康度检查：避免上游改了 tag/丢了 key 时静默坏数据
      state.oddsHealth = checkOddsHealth(payload);
      if (!state.oddsHealth.ok) {
        console.warn('⚠️ odds 数据源异常:', state.oddsHealth.issues);
      }
      // 拉到新数据后重渲染：market tab 用到了 polymarket-outright
      if (state.loaded) render();
    } catch (e) {
      console.warn('odds 快照加载失败:', e);
    }
  }

  // 赔率数据健康度：检查 4 个源是否拉到了正确类型的数据
  // - the-odds-api.events 应有 sport_key 含 'world_cup' 或 'fifa'
  // - polymarket.events 标题应含 'World Cup' / 'FIFA' / '2026' 之一
  // - polymarket-outright.countries 至少 ≥ 20 个国家
  // - football-data.matches 应非空
  function checkOddsHealth(payload) {
    const issues = [];
    if (!payload) return { ok: false, issues: ['snapshots endpoint returned null'] };

    // the-odds-api
    const oddsApi = payload['the-odds-api'];
    if (!oddsApi) {
      issues.push('the-odds-api 源缺失');
    } else if (!Array.isArray(oddsApi.events) || oddsApi.events.length === 0) {
      issues.push('the-odds-api 0 场赔率');
    } else {
      const hasWorldCup = oddsApi.events.some(ev =>
        (ev.sport || '').toLowerCase().includes('world_cup') ||
        (ev.sport || '').toLowerCase().includes('fifa')
      );
      if (!hasWorldCup) issues.push(`the-odds-api sport 异常: ${oddsApi.events[0]?.sport || 'N/A'}`);
    }

    // polymarket
    const pm = payload.polymarket;
    if (!pm) {
      issues.push('polymarket 源缺失');
    } else if (Array.isArray(pm.events) && pm.events.length > 0) {
      const hasWorldCup = pm.events.some(ev =>
        /world cup|fifa|2026/i.test(ev.title || '')
      );
      if (!hasWorldCup) {
        issues.push(`polymarket 标题异常（前 3）: ${pm.events.slice(0,3).map(e => e.title || '?').join(' | ').slice(0, 120)}`);
      }
    }

    // polymarket-outright
    const pmo = payload['polymarket-outright'];
    if (pmo && typeof pmo.countryCount === 'number' && pmo.countryCount < 20) {
      issues.push(`polymarket-outright 国家数偏低: ${pmo.countryCount}`);
    }

    return { ok: issues.length === 0, issues };
  }

  // ============ 数据源查找 helpers ============
  // The Odds API 找 h2h event：按 home + away country 匹配
  function findOddsApiMatch(homeCountry, awayCountry) {
    const payload = state.oddsSnapshots?.['the-odds-api'];
    if (!payload || !Array.isArray(payload.events)) return null;
    return payload.events.find(ev =>
      ev.home === homeCountry && ev.away === awayCountry
    ) || null;
  }

  // football-data 找已结束 / 进行中比赛
  function findFootballDataMatch(matchId) {
    const payload = state.oddsSnapshots?.['football-data'];
    if (!payload || !Array.isArray(payload.matches)) return null;
    return payload.matches.find(m => String(m.id) === String(matchId)) || null;
  }

  // LLM 预测查找
  function findLLMPrediction(matchId) {
    return state.llmPredictions?.predictions?.find(p => p.matchId === matchId) || null;
  }

  // Polymarket h2h event（按 country 匹配，title 含双方国家名）
  function findPolymarketByCountry(homeCountry, awayCountry) {
    const payload = state.oddsSnapshots?.polymarket;
    if (!payload || !Array.isArray(payload.events)) return null;
    const nameA = countryName(homeCountry).toLowerCase();
    const nameB = countryName(awayCountry).toLowerCase();
    return payload.events.find(ev => {
      const t = (ev.title || '').toLowerCase();
      return t.includes(nameA) && t.includes(nameB);
    }) || null;
  }

  // 给定一场比赛，调全部 4 源（Elo + The Odds API + Polymarket + LLM）算综合预测
  // 用于对战卡片右上角显示"综合胜率"
  function computeMatchEnsemble(match) {
    const teamA = findTeam(match.home);
    const teamB = findTeam(match.away);
    if (!teamA || !teamB) return null;
    const h2hResult = h2hCalc(teamA, teamB);
    const oddsMarket = extractH2HMarket(findOddsApiMatch(match.home, match.away));
    const polymarketEvent = findPolymarketByCountry(match.home, match.away);
    const llmPred = findLLMPrediction(match.id);
    return ensemblePredict(h2hResult, oddsMarket, polymarketEvent, llmPred);
  }

  // 综合胜率徽章 HTML（4 源融合）
  function formatEnsembleBadge(match) {
    const ens = computeMatchEnsemble(match);
    if (!ens) return '';
    const { final, parts } = ens;
    let maxKey, maxProb;
    if (final.home >= final.draw && final.home >= final.away) {
      maxKey = 'home'; maxProb = final.home;
    } else if (final.away >= final.draw) {
      maxKey = 'away'; maxProb = final.away;
    } else {
      maxKey = 'draw'; maxProb = final.draw;
    }
    const cn = maxKey === 'home' ? countryName(match.home) : maxKey === 'away' ? countryName(match.away) : '平局';
    const sourcesCount = parts.length;
    const sourcesList = parts.map(p => p.name).join(' + ');
    return `<span class="wc-match-status is-ensemble" title="4 源融合（${escapeHtml(sourcesList)}）共 ${sourcesCount} 源参与">🏆 ${escapeHtml(cn)} ${(maxProb * 100).toFixed(0)}%</span>`;
  }

  // 提取 The Odds API 的 h2h 主盘（最高赔率做代表）
  function extractH2HMarket(oddsEvent) {
    if (!oddsEvent || !oddsEvent.bookmakers) return null;
    for (const bk of oddsEvent.bookmakers) {
      const h2h = (bk.markets || []).find(m => m.key === 'h2h');
      if (!h2h) continue;
      const home = h2h.outcomes.find(o => o.name === oddsEvent.home);
      const away = h2h.outcomes.find(o => o.name === oddsEvent.away);
      const draw = h2h.outcomes.find(o => o.name === 'Draw');
      if (home && away) {
        return {
          bookmaker: bk.title || bk.key,
          home: { name: home.name, decimalOdds: home.decimalOdds },
          draw: draw ? { name: draw.name, decimalOdds: draw.decimalOdds } : null,
          away: { name: away.name, decimalOdds: away.decimalOdds }
        };
      }
    }
    return null;
  }

  // 把 h2h 赔率打包成单行紧凑字符串（卡片用）："1.43 / 4.33 / 7.75"
  function formatOddsCompact(oddsMarket) {
    if (!oddsMarket) return '';
    const h = oddsMarket.home.decimalOdds.toFixed(2);
    const d = oddsMarket.draw ? oddsMarket.draw.decimalOdds.toFixed(2) : '—';
    const a = oddsMarket.away.decimalOdds.toFixed(2);
    return `${h} / ${d} / ${a}`;
  }

  // 生成对战卡片用的赔率徽章 HTML
  function formatOddsBadge(oddsMarket) {
    if (!oddsMarket) return '';
    return `<span class="wc-match-status is-odds" title="The Odds API h2h · ${escapeHtml(oddsMarket.bookmaker)}">💰 ${escapeHtml(formatOddsCompact(oddsMarket))}</span>`;
  }

  async function loadMatches() {
    try {
      const res = await fetch(MATCHES_URL + '?t=' + Date.now(), { cache: 'no-cache' });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const payload = await res.json();
      state.matchesData = payload;
      state.matchesLoaded = true;
    } catch (error) {
      console.error("Match schedule load failed:", error);
      state.matchesData = null;
      state.matchesLoaded = true;
    }
  }

  function render() {
    const root = el('worldcupRoot');
    if (!root || !state.loaded) return;

    root.innerHTML = `
      <div class="wc-hero card">
        <div class="wc-hero-main">
          <div>
            <span class="wc-kicker">2026 FIFA World Cup</span>
            <h2>世界杯预测中心</h2>
          </div>
        </div>
        <div class="wc-top-strip" id="wcTopStrip"></div>
      </div>

      <div class="countdown wc-countdown card" id="wcCountdownCard">
        <div class="card-header">
          <h2>世界杯开赛倒计时</h2>
          <span class="countdown-label" id="wcCountdownLabel">--</span>
        </div>
        <div class="countdown-timer" id="wcCountdownTimer">
          <div class="countdown-unit">
            <span class="countdown-value" id="wcCdDays">0</span>
            <span class="countdown-text">天</span>
          </div>
          <div class="countdown-sep">:</div>
          <div class="countdown-unit">
            <span class="countdown-value" id="wcCdHours">00</span>
            <span class="countdown-text">时</span>
          </div>
          <div class="countdown-sep">:</div>
          <div class="countdown-unit">
            <span class="countdown-value" id="wcCdMinutes">00</span>
            <span class="countdown-text">分</span>
          </div>
          <div class="countdown-sep">:</div>
          <div class="countdown-unit">
            <span class="countdown-value" id="wcCdSeconds">00</span>
            <span class="countdown-text">秒</span>
          </div>
        </div>
      </div>

      <div class="wc-tabs" id="worldcupTabs">
        <button class="wc-tab active" data-wc-tab="matches">对战表</button>
        <button class="wc-tab" data-wc-tab="champion">冠军概率</button>
        <button class="wc-tab" data-wc-tab="factor">因子拆解</button>
        <button class="wc-tab" data-wc-tab="mystic">玄学分析</button>
        <button class="wc-tab" data-wc-tab="squad">球队阵容</button>
        ${state.oddsHealth && !state.oddsHealth.ok
          ? `<span class="wc-odds-health-badge" title="${escapeHtml(state.oddsHealth.issues.join(' / '))}">⚠️ 数据源异常</span>`
          : ''}
      </div>

      <div class="wc-panel active" id="wcPanelMatches">${renderMatchPanel()}</div>
      <div class="wc-panel" id="wcPanelChampion">${renderMarketPanel()}</div>
      <div class="wc-panel" id="wcPanelFactor">${renderFactorPanel()}</div>
      <div class="wc-panel" id="wcPanelMystic">${renderMysticPanel()}</div>
      <div class="wc-panel" id="wcPanelSquad">${renderSquadPanel()}</div>
    `;

    bindPanelEvents();
    renderTopStrip();
    startWorldCupCountdown();
    switchTab(state.activeTab);
    updateSquad();
  }

  function resetWorldCupCountdownMarkup() {
    const timer = el('wcCountdownTimer');
    if (!timer) return;

    timer.innerHTML = `
      <div class="countdown-unit">
        <span class="countdown-value" id="wcCdDays">0</span>
        <span class="countdown-text">天</span>
      </div>
      <div class="countdown-sep">:</div>
      <div class="countdown-unit">
        <span class="countdown-value" id="wcCdHours">00</span>
        <span class="countdown-text">时</span>
      </div>
      <div class="countdown-sep">:</div>
      <div class="countdown-unit">
        <span class="countdown-value" id="wcCdMinutes">00</span>
        <span class="countdown-text">分</span>
      </div>
      <div class="countdown-sep">:</div>
      <div class="countdown-unit">
        <span class="countdown-value" id="wcCdSeconds">00</span>
        <span class="countdown-text">秒</span>
      </div>
    `;
  }

  function startWorldCupCountdown() {
    if (state.countdownTimerId !== null) {
      clearInterval(state.countdownTimerId);
    }

    const updateCountdown = () => {
      const timer = el('wcCountdownTimer');
      const label = el('wcCountdownLabel');
      if (!timer || !label) return;

      const diff = WORLD_CUP_START.getTime() - Date.now();
      if (diff <= 0) {
        timer.innerHTML = '<div class="countdown-live">世界杯进行中</div>';
        label.textContent = '2026年6月11日 墨西哥城开幕';
        return;
      }

      if (!el('wcCdDays')) {
        resetWorldCupCountdownMarkup();
      }

      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      el('wcCdDays').textContent = days;
      el('wcCdHours').textContent = pad2(hours);
      el('wcCdMinutes').textContent = pad2(minutes);
      el('wcCdSeconds').textContent = pad2(seconds);
      label.textContent = '6月12日 周五 03:00 北京时间';
    };

    updateCountdown();
    state.countdownTimerId = setInterval(updateCountdown, 1000);
  }

  function renderTopStrip() {
    const target = el('wcTopStrip');
    if (!target) return;
    target.innerHTML = sortedTeams().slice(0, 3).map((team, index) => `
      <div class="wc-top-card">
        <span class="wc-rank">${index + 1}</span>
        <span class="wc-code">${code(team.country)}</span>
        <span class="wc-name">${escapeHtml(countryName(team.country))}</span>
        <strong>${pct(team.final_prob, 2)}</strong>
      </div>
    `).join('');
  }

  function renderMatchPanel() {
    const md = state.matchesData;
    if (!md || !md.groups) {
      return '<div class="card"><div class="empty-state">暂无比赛数据。</div></div>';
    }

    const lastUpdated = md.metadata?.lastUpdated ? (() => {
      try {
        const d = new Date(md.metadata.lastUpdated);
        if (Number.isNaN(d.getTime())) return '';
        return '数据更新于 ' + d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      } catch { return ''; }
    })() : '';

    const groupLabels = Object.keys(md.groups).sort();

    function matchRow(match) {
      const homeCn = countryName(match.home);
      const awayCn = countryName(match.away);
      const homeCode = code(match.home);
      const awayCode = code(match.away);
      const homeFlag = flag(match.home);
      const awayFlag = flag(match.away);
      const isScheduled = match.status === 'scheduled';
      const isCompleted = match.status === 'completed';

      // 综合预测徽章（4 源融合：Elo + The Odds API + Polymarket + LLM）
      const ensembleBadge = formatEnsembleBadge(match);

      // The Odds API 赔率徽章（h2h 主盘，The Odds API 数据未同步时不显示）
      const oddsApiEventForBadge = findOddsApiMatch(match.home, match.away);
      const oddsMarketForBadge = extractH2HMarket(oddsApiEventForBadge);
      const oddsBadge = formatOddsBadge(oddsMarketForBadge);

      let scoreHtml;
      if (isCompleted && match.homeScore != null) {
        scoreHtml = '<div class="wc-match-score-badge">' + match.homeScore + ' - ' + match.awayScore + '</div>';
      } else {
        scoreHtml = '<div class="wc-match-vs-badge">VS</div>';
      }

      const timeInfo = getBeijingTimeInfo(match.date, match.time);

      // Beautiful SVG Stadium Icon
      const stadiumIconSvg = '<svg class="wc-venue-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="10"/>' +
        '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' +
        '<path d="M2 12h20"/>' +
        '</svg>';

      return '<div class="wc-match-card is-clickable" data-match-id="' + escapeHtml(match.id || '') + '" data-home="' + escapeHtml(match.home) + '" data-away="' + escapeHtml(match.away) + '" title="点击查看对战预测分析">' +
        '<div class="wc-match-header">' +
          '<div class="wc-match-time-badge">' +
            '<span class="wc-match-date">' + timeInfo.date + '</span>' +
            '<span class="wc-match-day">' + timeInfo.day + '</span>' +
            '<span class="wc-match-time">' + timeInfo.time + '</span>' +
          '</div>' +
          (isScheduled ? '<span class="wc-match-status is-scheduled">未开始</span>' : '') +
          (isCompleted && match.homeScore != null ? '<span class="wc-match-status is-final">已结束</span>' : '') +
          oddsBadge +
          ensembleBadge +
        '</div>' +
        '<div class="wc-match-body">' +
          '<div class="wc-match-team is-home">' +
            '<span class="wc-match-name">' + escapeHtml(homeCn) + '</span>' +
            '<span class="wc-match-badge">' + homeFlag + ' <small class="wc-match-code">' + homeCode + '</small></span>' +
          '</div>' +
          scoreHtml +
          '<div class="wc-match-team is-away">' +
            '<span class="wc-match-badge"><small class="wc-match-code">' + awayCode + '</small> ' + awayFlag + '</span>' +
            '<span class="wc-match-name">' + escapeHtml(awayCn) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="wc-match-footer">' +
          stadiumIconSvg +
          '<span class="wc-match-venue" title="' + escapeHtml(match.venue) + '">' + escapeHtml(match.venue) + '</span>' +
        '</div>' +
      '</div>';
    }

    function groupBlock(label) {
      const g = md.groups[label];
      if (!g) return '';
      const teams = g.teams || [];
      const matches = g.matches || [];

      // Initially open based on active filter
      const isSelected = state.selectedGroup === 'ALL' || state.selectedGroup === label;
      const hiddenClass = isSelected ? '' : ' is-hidden';
      const isOpen = (state.selectedGroup === label || state.selectedGroup === 'ALL') ? ' open' : '';

      return '<details class="wc-match-group letter-group-block' + hiddenClass + '"' + isOpen + ' data-group="' + label + '">' +
        '<summary>' +
          '<span class="wc-group-badge">' + label + ' 组</span>' +
          '<span class="wc-group-teams">' + teams.map(t => escapeHtml(countryName(t))).join(' · ') + '</span>' +
        '</summary>' +
        '<div class="wc-match-grid">' +
          matches.map(matchRow).join('') +
        '</div>' +
      '</details>';
    }

    // Build Time-based blocks
    const allMatches = [];
    groupLabels.forEach(label => {
      const g = md.groups[label];
      if (g && g.matches) {
        allMatches.push(...g.matches);
      }
    });

    allMatches.sort((a, b) => {
      const timeA = new Date(a.date + 'T' + a.time + ':00Z').getTime();
      const timeB = new Date(b.date + 'T' + b.time + ':00Z').getTime();
      return timeA - timeB;
    });

    const matchesByDate = {};
    allMatches.forEach(match => {
      const timeInfo = getBeijingTimeInfo(match.date, match.time);
      const dateKey = timeInfo.date; // e.g. "06-11"
      const dateStr = timeInfo.dateStr; // e.g. "6月11日"
      const weekday = timeInfo.day; // e.g. "周四"
      
      if (!matchesByDate[dateKey]) {
        matchesByDate[dateKey] = {
          dateStr: dateStr,
          weekday: weekday,
          matches: []
        };
      }
      matchesByDate[dateKey].matches.push(match);
    });

    const sortedDateKeys = Object.keys(matchesByDate).sort();

    function timeGroupBlock(dateKey) {
      const g = matchesByDate[dateKey];
      const matches = g.matches;
      
      const isSelected = state.selectedGroup === 'TIME';
      const hiddenClass = isSelected ? '' : ' is-hidden';
      const isOpen = isSelected ? ' open' : '';

      return '<details class="wc-match-group time-group-block' + hiddenClass + '"' + isOpen + ' data-group="TIME" data-date="' + dateKey + '">' +
        '<summary>' +
          '<span class="wc-group-badge">' + g.dateStr + ' ' + g.weekday + '</span>' +
          '<span class="wc-group-teams">' + matches.length + ' 场比赛 · ' + matches.map(m => escapeHtml(countryName(m.home)) + ' vs ' + escapeHtml(countryName(m.away))).slice(0, 3).join(', ') + (matches.length > 3 ? '等' : '') + '</span>' +
        '</summary>' +
        '<div class="wc-match-grid">' +
          matches.map(matchRow).join('') +
        '</div>' +
      '</details>';
    }

    const groupTabsHtml = '<div class="wc-group-selector" id="wcGroupSelector">' +
      '<button class="wc-group-tab" data-group="TIME">按时间</button>' +
      '<button class="wc-group-tab" data-group="ALL">全部小组</button>' +
      groupLabels.map(label => '<button class="wc-group-tab" data-group="' + label + '">' + label + ' 组</button>').join('') +
      '</div>';

    return '<div class="card">' +
      '<div class="card-header wc-matches-header">' +
        '<div>' +
          '<h2>2026 世界杯 · 小组赛赛程</h2>' +
          '<p class="wc-desc">数据每日从 FIFA 官方赛程接口更新，展示小组赛对战、场馆与比分状态。共 12 组 72 场小组赛。</p>' +
        '</div>' +
        (lastUpdated ? '<span class="wc-update-badge">' + lastUpdated + '</span>' : '') +
      '</div>' +
      groupTabsHtml +
      '<div class="wc-match-board">' +
        sortedDateKeys.map(timeGroupBlock).join('') +
        groupLabels.map(groupBlock).join('') +
      '</div>' +
    '</div>';
  }

  function renderChampionPanel() {
    // 整合自原「市场博弈」面板：双源融合 + 价值 picks + 完整排行榜
    // （已删除独立的「冠军概率排行榜」和「市场博弈」两个 tab 重复）
    return renderMarketPanel();
  }

  // ============================================================
  // v3.4.2: Conformal Prediction + Factor Attribution 集成
  // - 计算结果挂在 state.conformal / state.attribution 上
  // - 渲染层只读，避免重复计算
  // - 兼容旧版 JSON（缺 final_prob 时退回 logical_prob）
  // ============================================================
  function enrichTeamsWithConformalAndAttribution() {
    if (!window.WorldCupConformal || !window.WorldCupAttribution) return;
    if (!state.teams || state.teams.length === 0) return;
    if (state.conformal && state.attribution) return;  // 已算过

    const cp = new window.WorldCupConformal.ConformalPredictor();
    const teams = state.teams.map(t => ({
      country: t.country,
      final_probability: t.final_prob || t.prob || 0.03,
      elo: t.mod_elo || t.elo || 1700,
      age_score: t.age_score || 0,
      exp_score: t.exp_score || 0,
      form_score: t.form_score || 0,
      coach_score: t.coach_score || 0,
      mystic_score: t.mystic_score || 0
    }));

    // Champion intervals: 写回原 team 对象，渲染时直接读
    const intervals = cp.predictChampionIntervals(teams);
    state.conformal = { intervals, predictor: cp };
    intervals.forEach(iv => {
      const team = state.teams.find(t => t.country === iv.country);
      if (team) {
        team.conformal_ci_low = iv.ci_low;
        team.conformal_ci_high = iv.ci_high;
        team.conformal_uncertainty = iv.uncertainty_level;
        team.conformal_half_width = iv.abs_error_expected;
      }
    });

    // Factor attribution: 每队的 6 因子贡献
    // 注意：attributeTeam 内部用 raw elo（不是 mod_elo）算 baseline
    const attrInputs = state.teams.map(t => ({
      country: t.country,
      final_prob: t.final_prob || t.prob || 0.03,
      elo: t.elo || 1700,        // ← 用 raw elo，不是 mod_elo
      age_score: t.age_score || 0,
      exp_score: t.exp_score || 0,
      form_score: t.form_score || 0,
      coach_score: t.coach_score || 0,
      mystic_score: t.mystic_score || 0
    }));
    const attributions = window.WorldCupAttribution.attributeAllTeams(attrInputs);
    state.attribution = attributions;
    attributions.forEach(attr => {
      const team = state.teams.find(t => t.country === attr.country);
      if (team) {
        team.attribution = attr;
      }
    });

    // 预计算 H2H conformal map: { countryA: { countryB: {prediction_set, ...} } }
    const h2hMap = {};
    state.teams.forEach(a => {
      h2hMap[a.country] = {};
      state.teams.forEach(b => {
        if (a.country === b.country) return;
        h2hMap[a.country][b.country] = cp.predictH2H(
          a.country, b.country,
          a.mod_elo || a.elo || 1700,
          b.mod_elo || b.elo || 1700
        );
      });
    });
    state.h2hConformal = h2hMap;
  }

  // 渲染辅助：不确定度 badge HTML
  function uncBadgeHtml(level) {
    const map = {
      low:    { cls: 'unc-low', text: '低不确定' },
      medium: { cls: 'unc-med', text: '中不确定' },
      high:   { cls: 'unc-high', text: '高不确定' }
    };
    const m = map[level] || map.medium;
    return `<span class="unc-badge ${m.cls}">${m.text}</span>`;
  }

  // 渲染辅助：归因柱状条 HTML
  function attributionHtml(attr) {
    if (!attr || !attr.attributions || attr.attributions.length === 0) return '';
    const lo = (attr.elo_baseline * 100).toFixed(2);
    const hi = (attr.final_probability * 100).toFixed(2);
      const rows = attr.attributions
        .filter(a => Math.abs(a.contribution) > 0.0001)
        .map(a => {
          const isPos = a.contribution > 0;
          const sign = isPos ? '+' : '';
          const width = Math.min(100, Math.abs(a.contribution) * 2000);
          // 主题适配：worldcup 主题的 --accent 是红色，正向贡献用 --front-start（绿色）
          const bg = isPos ? 'var(--front-start, #00a86b)' : 'var(--danger, #ff4757)';
          return `
          <div class="attr-row">
            <span class="attr-lbl">${a.label}</span>
            <div class="attr-bar"><div class="attr-seg" style="width:${width.toFixed(1)}%;background:${bg}"></div></div>
            <span class="attr-val ${isPos ? 'is-pos' : 'is-neg'}">${sign}${(a.contribution * 100).toFixed(3)}%</span>
          </div>
        `;
        }).join('');
    return `
      <div class="attr-block">
        <div class="attr-hd">概率归因</div>
        <div class="attr-base">Elo 基准 ${lo}% → 最终 ${hi}%</div>
        <div class="attr-rows">${rows}</div>
      </div>
    `;
  }

  function renderFactorPanel() {
    const rows = sortedTeams().slice(0, 28).map(team => {
      const bars = FACTORS.map(factor => {
        const raw = team[factor.key] || 0;
        const width = Math.min(100, Math.abs(raw) / factor.scale * 100);
        return `
          <div class="wc-factor-bar">
            <span>${factor.label}</span>
            <div><i style="width:${width.toFixed(1)}%;background:${factor.color}"></i></div>
            <strong class="${clsByShift(raw)}">${signedPct(raw, 1)}</strong>
          </div>
        `;
      }).join('');

      // Conformal 置信区间
      const ciLo = team.conformal_ci_low;
      const ciHi = team.conformal_ci_high;
      const uncLvl = team.conformal_uncertainty;
      const ciText = (ciLo != null && ciHi != null)
        ? `<div class="wc-factor-ci">置信区间 ${(ciLo * 100).toFixed(2)}% ~ ${(ciHi * 100).toFixed(2)}%</div>`
        : '';
      const badge = uncLvl ? uncBadgeHtml(uncLvl) : '';

      // Factor attribution
      const attrHtml = attributionHtml(team.attribution);

      return `
        <details class="wc-detail-row">
          <summary>
            <span class="wc-code">${code(team.country)}</span>
            <span class="wc-team-name">${escapeHtml(countryName(team.country))}</span>
            <span class="wc-factor-meta">
              ${badge}
              <strong>${pct(team.final_prob, 1)}</strong>
            </span>
          </summary>
          <div class="wc-factor-list">${bars}</div>
          ${ciText}
          ${attrHtml}
          <p class="wc-narrative">${escapeHtml(team.narrative || '暂无补充叙述')}</p>
        </details>
      `;
    }).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>因子拆解</h2>
            <p class="wc-desc">各队因子的相对强弱按源模型输出展示。负向值保留为红色，表示该维度对最终判断形成压制。展开后查看 Conformal 置信区间（基于 2006-2022 世界杯历史校准）和各因子的概率绝对贡献。</p>
          </div>
        </div>
        <div class="wc-detail-list">${rows}</div>
      </div>
    `;
  }

  function renderMysticPanel() {
    const rows = sortedTeams().map(team => `
      <details class="wc-detail-row">
        <summary>
          <span class="wc-code">${code(team.country)}</span>
          <span class="wc-team-name">${escapeHtml(countryName(team.country))}</span>
          <span class="wc-pill">${escapeHtml(translateText(team.verdict) || '玄学中性')}</span>
          <strong>${pct(team.final_prob, 2)}</strong>
        </summary>
        <div class="wc-mystic-grid">
          <div><span>逻辑概率</span><strong>${pct(team.logical_prob, 2)}</strong></div>
          <div><span>玄学偏移</span><strong class="${clsByShift(team.shift)}">${signedPct(team.shift)}</strong></div>
          <div><span>彩票悖论</span><strong>${(team.contrarian || 0).toFixed(3)}</strong></div>
          <div><span>热门诅咒</span><strong>${(team.fav_curse || 0).toFixed(3)}</strong></div>
          <div><span>置信度</span><strong>${pct(team.confidence, 0)}</strong></div>
          <div><span>易经标签</span><strong>${escapeHtml(team.iching || '--')}</strong></div>
        </div>
        <div class="wc-tags">
          <span>${escapeHtml(team.zen || '--')}</span>
          <span>${escapeHtml(team.tao || '--')}</span>
        </div>
      </details>
    `).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>玄学因子分析</h2>
            <p class="wc-desc">保留源项目的三重境界、道德经、易经和彩票悖论输出，仅去掉了移动端整页壳。</p>
          </div>
        </div>
        <div class="wc-ucl-grid">${renderUclCards()}</div>
        <div class="wc-detail-list">${rows}</div>
      </div>
    `;
  }

  function renderUclCards() {
    const countries = Object.keys(state.ucl || {});
    if (!countries.length) return '';
    return countries.map(country => {
      const item = state.ucl[country] || {};
      const players = (item.players || []).map(player => `
        <div class="wc-ucl-player">
          <span>${escapeHtml(playerName(player.name))}</span>
          <strong class="${clsByShift(player.mentality_signal)}">${(player.mentality_signal || 0).toFixed(2)}</strong>
        </div>
      `).join('');
      return `
        <div class="wc-ucl-card">
          <div class="wc-code">${code(country)}</div>
          <div>
            <h3>${escapeHtml(countryName(country))}</h3>
            <p>${escapeHtml(item.description || '欧冠心态信号')}</p>
            <strong class="${clsByShift(item.total_bonus)}">${signedPct(item.total_bonus, 2)}</strong>
          </div>
          <div class="wc-ucl-players">${players}</div>
        </div>
      `;
    }).join('');
  }

  function renderSquadPanel() {
    const options = sortedTeams().map(team => (
      `<option value="${escapeHtml(team.country)}">${code(team.country)} ${escapeHtml(countryName(team.country))}</option>`
    )).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>球队阵容</h2>
          </div>
          <select class="wc-select" id="wcSquadSelect">${options}</select>
        </div>
        <div id="wcSquadContent"></div>
      </div>
    `;
  }

  function renderMarketPanel() {
    // ============ 双源融合：上游模型 + Polymarket 冠军 outright ============
    // 权重：上游模型 60% + 市场 40%（产品定位是上游模型的展示厅，模型权重略高）
    const WEIGHT_MODEL = 0.6;
    const WEIGHT_MARKET = 0.4;

    // 1) 拉取 Polymarket 隐含冠军概率（live KV 优先，POLY_WINNER 静态数据兜底）
    const liveOutright = state.oddsSnapshots?.['polymarket-outright'];
    const marketMap = {};   // { ticaiCountry -> yesPrice }
    let marketSource = 'static-fallback';
    if (liveOutright && liveOutright.countries && Object.keys(liveOutright.countries).length) {
      Object.entries(liveOutright.countries).forEach(([polyCountry, info]) => {
        const ticaiName = polyCountryToTicai(polyCountry);
        if (ticaiName && info && Number.isFinite(info.yesPrice) && info.yesPrice > 0 && info.yesPrice < 1) {
          marketMap[ticaiName] = info.yesPrice;
        }
      });
      marketSource = `polymarket-live (${Object.keys(marketMap).length} 国 · ${(liveOutright.fetchedAt || '').slice(0, 10)})`;
    } else {
      Object.entries(POLY_WINNER).forEach(([country, info]) => {
        if (info && Number.isFinite(info.price) && info.price > 0) {
          marketMap[country] = info.price;
        }
      });
    }

    // 2) 只统计双方都有数据的国家（live 模式下 POLY 覆盖广，static 模式下可能缺一些）
    //    先按上游模型粗排（保证 fusedMap 算完后 rank 稳定），fusedMap 算完再切到按融合概率排
    const candidateTeams = sortedTeams().filter(team => marketMap[team.country] != null);
    if (!candidateTeams.length) {
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>冠军概率</h2>
            <p class="wc-desc">Polymarket outright 数据尚未同步，先看上游模型。</p>
          </div>
        </div>
      </div>
    `;
  }

    // 3) raw fusion + 归一化
    const rawFusion = {};
    candidateTeams.forEach(team => {
      const model = team.final_prob || 0;
      const market = marketMap[team.country];
      rawFusion[team.country] = WEIGHT_MODEL * model + WEIGHT_MARKET * market;
    });
    const totalRaw = Object.values(rawFusion).reduce((a, b) => a + b, 0);
    const fusedMap = {};
    if (totalRaw > 0) {
      candidateTeams.forEach(team => {
        fusedMap[team.country] = rawFusion[team.country] / totalRaw;
      });
    }

    // 4) 排名 + 渲染每队行（按融合概率降序，3 柱条：模型 / Polymarket / 融合）
    const ranked = candidateTeams
      .map(team => ({ team, fused: fusedMap[team.country] || 0 }))
      .sort((a, b) => b.fused - a.fused);
    const rows = ranked.map(({ team }, idx) => {
      const model = team.final_prob || 0;
      const market = marketMap[team.country];
      const fused = fusedMap[team.country] || 0;
      const edge = OddsUtils.ev.edge(model, market);          // model vs market
      const fusionShift = fused - market;                     // 融合 vs 市场
      const ev = OddsUtils.ev.expectedValue(1 / market, model);
      const max = Math.max(model, market, fused, 0.001);
      const rank = idx + 1;
      return `
        <div class="wc-market-row has-fused">
          <span class="wc-rank ${idx < 3 ? 'top' : ''}" title="按融合概率排名">#${rank}</span>
          <span class="wc-code">${code(team.country)}</span>
          <span class="wc-team-name">${escapeHtml(countryName(team.country))}</span>
          <div class="wc-market-bars is-triple" title="上：上游模型 / 中：Polymarket / 下：双源融合">
            <span style="width:${(model / max * 100).toFixed(0)}%"></span>
            <i style="width:${(market / max * 100).toFixed(0)}%"></i>
            <b style="width:${(fused / max * 100).toFixed(0)}%"></b>
          </div>
          <span class="wc-market-pcts" title="模型 / Polymarket / 融合">
            ${pct(model, 1)} · ${pct(market, 1)} · <b>${pct(fused, 1)}</b>
          </span>
          <strong class="${clsByShift(edge)}" title="模型 - 市场">${signedPct(edge, 1)}</strong>
          <em class="wc-market-fusion ${clsByShift(fusionShift)}" title="融合 - 市场（融合相对市场的偏离）">${signedPct(fusionShift, 1)}</em>
          <em class="wc-market-ev" title="净 EV（按 1 单位本金）">EV ${signedPct(ev, 1)}</em>
        </div>
      `;
    }).join('');

    // 5) 价值 picks：用 融合 概率算 EV + Kelly（比单用 model 更稳）
    const valuePicks = candidateTeams
      .filter(team => (fusedMap[team.country] || 0) - marketMap[team.country] > 0.01)
      .map(team => {
        const market = marketMap[team.country];
        const fused = fusedMap[team.country];
        const model = team.final_prob || 0;
        const edge = OddsUtils.ev.edge(fused, market);
        const ev = OddsUtils.ev.expectedValue(1 / market, fused);
        const kelly25 = OddsUtils.kelly.fractionalKelly(1 / market, fused, 0.25);
        return { team, edge, ev, kelly25, market, fused, model };
      })
      .sort((a, b) => b.edge * b.fused - a.edge * a.fused)
      .slice(0, 3);

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>冠军概率</h2>
            <p class="wc-desc">上游模型（${(WEIGHT_MODEL * 100).toFixed(0)}%）+ Polymarket 冠军 outright 市场（${(WEIGHT_MARKET * 100).toFixed(0)}%）按权重加权后归一化。</p>
          </div>
        </div>
        <div class="wc-value-grid">
          ${valuePicks.map(({ team, edge, ev, kelly25, market, fused, model }) => `
            <div class="wc-value-card">
              <span>${code(team.country)} ${escapeHtml(countryName(team.country))}</span>
              <strong class="${clsByShift(edge)}">${signedPct(edge, 1)}</strong>
              <small>模型 ${pct(model, 1)} · 市场 ${pct(market, 1)} · 融合 <b>${pct(fused, 1)}</b></small>
              <small>EV ${signedPct(ev, 1)} · Kelly¼ 仓位 ${(kelly25 * 100).toFixed(1)}% 资金</small>
            </div>
          `).join('') || '<div class="empty-state">当前没有超过 1% 的正向偏离。</div>'}
        </div>
        <div class="wc-market-list">${rows}</div>
        ${renderLLMPerspectiveSection(marketMap)}
      </div>
    `;
  }

  // 赔率 24h 趋势段（modal 详情用，从 KV 历史快照算）
  // 数据不足时显示"趋势累积中"提示
  function renderOddsTrend(oddsMarket, oddsApiEvent, homeCountry, awayCountry) {
    const history = state.oddsHistory?.['the-odds-api'] || [];
    if (history.length < 2) {
      return `<div class="wc-odds-trend">
        <span class="wc-odds-trend-label">📈 赔率趋势</span>
        <span class="wc-odds-trend-empty">数据累积中（当前 ${history.length} / 至少 2 个时间点）</span>
      </div>`;
    }
    // 按时间倒序（最新在前）
    const points = [...history].sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt));
    // 在历史中找跟当前场次匹配的 event（按 home/away name 匹配）
    const matchKey = (ev) => ev && ev.home === homeCountry && ev.away === awayCountry;
    // 找出最早 + 最新都包含这场比赛的点
    const currentPoint = oddsApiEvent ? { fetchedAt: new Date().toISOString(), events: [oddsApiEvent] } : null;
    const findIn = (point) => (point?.events || []).find(matchKey);

    // 主胜赔率 24h 变化：找 ~24h 前的点
    const now = Date.now();
    const targetTime = now - 24 * 60 * 60 * 1000;
    let baselinePoint = null;
    for (const p of points) {
      const t = new Date(p.fetchedAt).getTime();
      if (t <= targetTime) { baselinePoint = p; break; }
    }
    if (!baselinePoint) baselinePoint = points[points.length - 1];  // 兜底用最旧的一个

    const currentEvt = currentPoint ? findIn(currentPoint) : null;
    const baselineEvt = findIn(baselinePoint);
    if (!currentEvt || !baselineEvt) {
      return `<div class="wc-odds-trend">
        <span class="wc-odds-trend-label">📈 赔率趋势</span>
        <span class="wc-odds-trend-empty">这场比赛的历史赔率尚未累积到</span>
      </div>`;
    }
    const curMarket = extractH2HMarket(currentEvt);
    const baseMarket = extractH2HMarket(baselineEvt);
    if (!curMarket || !baseMarket) {
      return `<div class="wc-odds-trend">
        <span class="wc-odds-trend-label">📈 赔率趋势</span>
        <span class="wc-odds-trend-empty">h2h 赔率抽取失败</span>
      </div>`;
    }
    const curH = curMarket.home.decimalOdds;
    const baseH = baseMarket.home.decimalOdds;
    const curA = curMarket.away.decimalOdds;
    const baseA = baseMarket.away.decimalOdds;
    const curD = curMarket.draw?.decimalOdds;
    const baseD = baseMarket.draw?.decimalOdds;
    const shiftH = curH - baseH;
    const shiftA = curA - baseA;
    const shiftD = (curD != null && baseD != null) ? curD - baseD : null;
    const baseAgoHrs = Math.round((now - new Date(baselinePoint.fetchedAt).getTime()) / (60 * 60 * 1000));
    const fmt = (n) => (n > 0 ? '+' : '') + n.toFixed(2);

    return `<div class="wc-odds-trend">
      <span class="wc-odds-trend-label">📈 赔率 ${baseAgoHrs}h 变化</span>
      <div class="wc-odds-trend-values">
        <span>主胜 <strong>${baseH.toFixed(2)}</strong> → <strong>${curH.toFixed(2)}</strong></span>
        ${curD != null ? `<span>平 <strong>${baseD.toFixed(2)}</strong> → <strong>${curD.toFixed(2)}</strong></span>` : ''}
        <span>客胜 <strong>${baseA.toFixed(2)}</strong> → <strong>${curA.toFixed(2)}</strong></span>
      </div>
      <span class="wc-odds-trend-shift ${shiftH < 0 ? 'is-positive' : shiftH > 0 ? 'is-negative' : 'is-neutral'}">主 ${fmt(shiftH)}</span>
    </div>`;
  }

  // LLM AI 视角对比面板：3 源（上游 / Polymarket / LLM）独立判断
  // 不参与融合计算，仅做对比展示
  function renderLLMPerspectiveSection(marketMap) {
    const llm = state.llmOutright;
    if (!llm || !Array.isArray(llm.predictions) || llm.predictions.length === 0) return '';
    const top8 = llm.predictions.slice(0, 8);
    const llmMeta = [
      llm.provider || '',
      llm.model || '',
      (llm.generatedAt || '').slice(0, 10),
      llm.llmProvided != null ? `直接给 ${llm.llmProvided} 国` : ''
    ].filter(Boolean).join(' · ');

    const teams = sortedTeams();
    const rows = top8.map(p => {
      const country = p.country;
      const cn = countryName(country);
      const c = code(country);
      const ticaiTeam = teams.find(t => t.country === country);
      const modelP = ticaiTeam ? (ticaiTeam.final_prob || 0) : 0;
      const marketP = marketMap[country] != null ? marketMap[country] : 0;  // Polymarket Yes 价格
      const llmP = p.winProb || 0;
      const llmVsMarket = llmP - marketP;
      const llmVsModel = llmP - modelP;
      return `
        <div class="wc-llm-row">
          <span class="wc-llm-name">
            <span class="wc-code">${c}</span>
            <span>${escapeHtml(cn)}</span>
          </span>
          <span class="wc-llm-cell" title="上游模型 final_prob">${pct(modelP, 1)}</span>
          <span class="wc-llm-cell" title="Polymarket Yes 价格">${pct(marketP, 1)}</span>
          <span class="wc-llm-cell is-llm-main" title="LLM 独立判断">${pct(llmP, 1)}</span>
          <span class="wc-llm-cell ${clsByShift(llmVsMarket)}" title="LLM − Polymarket（市场偏离）">${signedPct(llmVsMarket, 1)}</span>
          <span class="wc-llm-cell ${clsByShift(llmVsModel)}" title="LLM − 上游模型（模型偏离）">${signedPct(llmVsModel, 1)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="wc-llm-perspective">
        <div class="wc-llm-head">
          <h3>🤖 AI 视角（LLM top 8 vs 上游 + 市场）</h3>
          <span class="wc-llm-meta">${escapeHtml(llmMeta)}</span>
        </div>
        <div class="wc-llm-table">
          <div class="wc-llm-header">
            <span>国家</span><span>上游</span><span>Polymarket</span><span>LLM</span><span>LLM−市场</span><span>LLM−模型</span>
          </div>
          ${rows}
        </div>
        <p class="wc-llm-insight">三源独立判断：上游 Elo 模型（确定性） + Polymarket 市场（真钱投票） + LLM AI（综合推理）。LLM 跟市场/模型偏离越大，越值得人工复盘 —— LLM 看到了市场没消化的信息，还是在 Elo 上复读？</p>
      </div>
    `;
  }

  function formatDateTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function bindPanelEvents() {
    const tabs = el('worldcupTabs');
    if (tabs) {
      tabs.addEventListener('click', event => {
        const button = event.target.closest('.wc-tab');
        if (!button) return;
        switchTab(button.dataset.wcTab);
      });
    }

    const groupSelector = el('wcGroupSelector');
    if (groupSelector) {
      groupSelector.querySelectorAll('.wc-group-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.group === state.selectedGroup);
      });

      groupSelector.addEventListener('click', event => {
        const button = event.target.closest('.wc-group-tab');
        if (!button) return;

        const group = button.dataset.group;
        state.selectedGroup = group;

        groupSelector.querySelectorAll('.wc-group-tab').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.group === group);
        });

        const groupsList = document.querySelectorAll('.wc-match-group');
        groupsList.forEach(details => {
          const isTimeBlock = details.classList.contains('time-group-block');
          const label = details.dataset.group;

          if (group === 'TIME') {
            if (isTimeBlock) {
              details.classList.remove('is-hidden');
              details.setAttribute('open', '');
            } else {
              details.classList.add('is-hidden');
            }
          } else {
            if (isTimeBlock) {
              details.classList.add('is-hidden');
            } else {
              const isVisible = (group === 'ALL' || label === group);
              details.classList.toggle('is-hidden', !isVisible);
              if (group !== 'ALL' && label === group) {
                details.setAttribute('open', '');
              } else if (group === 'ALL') {
                details.setAttribute('open', '');
              }
            }
          }
        });
      });
    }

    const matchBoard = document.querySelector('.wc-match-board');
    if (matchBoard) {
      matchBoard.addEventListener('click', event => {
        const card = event.target.closest('.wc-match-card.is-clickable');
        if (!card) return;
        const home = card.dataset.home;
        const away = card.dataset.away;
        showMatchPredictionModal(home, away, card.dataset.matchId);
      });
    }

    const squad = el('wcSquadSelect');
    if (squad) {
      squad.value = state.selectedSquad;
      squad.addEventListener('change', () => {
        state.selectedSquad = squad.value;
        updateSquad();
      });
    }
  }

  function switchTab(tabName) {
    state.activeTab = tabName || 'champion';
    document.querySelectorAll('#sectionWorldcup .wc-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.wcTab === state.activeTab);
    });
    document.querySelectorAll('#sectionWorldcup .wc-panel').forEach(panel => {
      const id = `wcPanel${state.activeTab.charAt(0).toUpperCase()}${state.activeTab.slice(1)}`;
      panel.classList.toggle('active', panel.id === id);
    });
  }

  function h2hCalc(teamA, teamB) {
    const eloA = teamA.mod_elo || teamA.elo || 1700;
    const eloB = teamB.mod_elo || teamB.elo || 1700;
    const diff = eloA - eloB;
    const eloWinA = 1 / (1 + Math.pow(10, -diff / 400));
    const draw = Math.max(0.10, Math.min(0.35, 0.30 - Math.abs(diff) / 1500));
    const winTotal = 1 - draw;
    const rawA = eloWinA * winTotal + 0.03;
    const rawB = (1 - eloWinA) * winTotal + 0.03;
    const rawTotal = rawA + rawB;
    return {
      winA: rawA / rawTotal * winTotal,
      winB: rawB / rawTotal * winTotal,
      draw,
      diff
    };
  }

  function poisson(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    let probability = Math.exp(-lambda);
    for (let i = 1; i <= k; i += 1) probability *= lambda / i;
    return probability;
  }

  function hashNumber(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash &= hash;
    }
    return Math.abs(hash) / 2147483647;
  }

  function scorePredictions(teamA, teamB) {
    let lambdaA = 1.3 + ((teamA.mod_elo || teamA.elo || 1700) - 1700) / 500;
    let lambdaB = 1.3 + ((teamB.mod_elo || teamB.elo || 1700) - 1700) / 500;
    lambdaA = Math.max(0.3, Math.min(4, lambdaA * (1 + (teamA.shift || 0) * 3)));
    lambdaB = Math.max(0.3, Math.min(4, lambdaB * (1 + (teamB.shift || 0) * 3)));

    const raw = [];
    for (let goalsA = 0; goalsA <= 5; goalsA += 1) {
      for (let goalsB = 0; goalsB <= 5; goalsB += 1) {
        const total = goalsA + goalsB;
        const base = poisson(goalsA, lambdaA) * poisson(goalsB, lambdaB);
        raw.push({
          goalsA,
          goalsB,
          total,
          boosted: total >= 5 ? base * 3 : base
        });
      }
    }

    const boostedTotal = raw.reduce((sum, item) => sum + item.boosted, 0) || 1;
    raw.forEach(item => { item.prob = item.boosted / boostedTotal; });
    const sorted = raw.slice().sort((a, b) => b.prob - a.prob);
    const top3 = sorted.slice(0, 3);
    const seed = hashNumber(`${teamA.country} vs ${teamB.country}`);
    const top3Total = top3.reduce((sum, item) => sum + item.prob, 0) || 1;
    let cursor = 0;
    let featured = top3[0];
    for (const item of top3) {
      cursor += item.prob / top3Total;
      if (seed <= cursor) {
        featured = item;
        break;
      }
    }

    return {
      lambdaA,
      lambdaB,
      featured,
      likely: sorted.slice(0, 6),
      high: raw.filter(item => item.total >= 3).sort((a, b) => b.prob - a.prob).slice(0, 6)
    };
  }

  function factorDiff(teamA, teamB) {
    return FACTORS.map(factor => {
      const valueA = teamA[factor.key] || 0;
      const valueB = teamB[factor.key] || 0;
      const max = Math.max(Math.abs(valueA), Math.abs(valueB), 0.001);
      return `
        <div class="wc-h2h-factor">
          <span>${factor.label}</span>
          <div><i style="width:${Math.abs(valueA) / max * 100}%;background:var(--back-start)"></i><b style="width:${Math.abs(valueB) / max * 100}%;background:var(--warning)"></b></div>
          <strong>${valueA > valueB ? 'A' : valueB > valueA ? 'B' : '='}</strong>
        </div>
      `;
    }).join('');
  }

  // ============================================================
  // 4 源综合预测（融合模型 + 赔率市场 + Polymarket + LLM）
  // ============================================================
  // 预设权重（缺源时按比例分给剩余）
  const ENSEMBLE_WEIGHTS = { h2h: 0.30, odds: 0.30, poly: 0.20, llm: 0.20 };

  function buildOddsApiProbs(market) {
    // The Odds API 3 outcome (含平) → devig
    if (!market) return null;
    const items = [{ decimalOdds: market.home.decimalOdds }];
    if (market.draw) items.push({ decimalOdds: market.draw.decimalOdds });
    items.push({ decimalOdds: market.away.decimalOdds });
    const fair = window.OddsUtils.devig.proportionalDevig(items);
    return {
      home: fair[0]?.fairProbability ?? 0,
      draw: fair[1]?.fairProbability ?? 0,
      away: fair[fair.length - 1]?.fairProbability ?? 0
    };
  }

  function buildPolymarketProbs(event) {
    // Polymarket 通常 2 outcome (Up/Down)，归一化到 home/away
    if (!event || !Array.isArray(event.outcomes) || event.outcomes.length < 2) return null;
    const odds = event.outcomes.map(o => ({ decimalOdds: o.decimalOdds || 1 }));
    const fair = window.OddsUtils.devig.proportionalDevig(odds);
    return {
      home: fair[0]?.fairProbability ?? 0,
      draw: 0,
      away: 1 - (fair[0]?.fairProbability ?? 0)
    };
  }

  function ensemblePredict(h2hResult, oddsMarket, polymarketEvent, llmPred) {
    const parts = [];
    // Elo 推演（必有，自算 Elo + Poisson）
    parts.push({
      key: 'h2h', name: 'Elo 推演', icon: '🧠', weight: ENSEMBLE_WEIGHTS.h2h,
      probs: { home: h2hResult.winA, draw: h2hResult.draw, away: h2hResult.winB },
      detail: `Elo 差 ${h2hResult.diff.toFixed(0)}`
    });
    // The Odds API（机构盘口，去水后）
    if (oddsMarket) {
      const p = buildOddsApiProbs(oddsMarket);
      if (p) {
        parts.push({
          key: 'odds', name: 'The Odds API', icon: '📊', weight: ENSEMBLE_WEIGHTS.odds,
          probs: p,
          detail: `${oddsMarket.bookmaker} · 主 ${oddsMarket.home.decimalOdds.toFixed(2)} / 平 ${oddsMarket.draw?.decimalOdds.toFixed(2) || '—'} / 客 ${oddsMarket.away.decimalOdds.toFixed(2)}`
        });
      }
    }
    // Polymarket（预测市场）
    if (polymarketEvent) {
      const p = buildPolymarketProbs(polymarketEvent);
      if (p) {
        const homeO = polymarketEvent.outcomes[0];
        const awayO = polymarketEvent.outcomes[polymarketEvent.outcomes.length - 1];
        parts.push({
          key: 'poly', name: 'Polymarket', icon: '🌐', weight: ENSEMBLE_WEIGHTS.poly,
          probs: p,
          detail: `${polymarketEvent.outcomes.length} outcomes · ${homeO.name} vs ${awayO.name}`
        });
      }
    }
    // LLM（本地推理）
    if (llmPred) {
      parts.push({
        key: 'llm', name: 'LLM 预测', icon: '🤖', weight: ENSEMBLE_WEIGHTS.llm,
        probs: { home: llmPred.homeWinProb, draw: llmPred.drawProb, away: llmPred.awayWinProb },
        detail: `${state.llmPredictions?.model || ''} · 置信度 ${(llmPred.confidence * 100).toFixed(0)}%`
      });
    }

    // 加权融合
    const totalW = parts.reduce((s, p) => s + p.weight, 0);
    const final = { home: 0, draw: 0, away: 0 };
    parts.forEach(p => {
      const w = p.weight / totalW;
      final.home += p.probs.home * w;
      final.draw += p.probs.draw * w;
      final.away += p.probs.away * w;
    });
    // 归一化（容差 0.01）
    const sum = final.home + final.draw + final.away;
    if (sum > 0) {
      final.home /= sum; final.draw /= sum; final.away /= sum;
    }

    // 置信度：1 - 归一化熵
    const H = -Object.values(final).reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);
    const maxH = Math.log2(3);
    const confidence = maxH > 0 ? (1 - H / maxH) : 0;

    return { final, parts, confidence };
  }

  function renderEnsembleCard(ensemble, teamA, teamB) {
    const { final, parts, confidence } = ensemble;
    const homePct = (final.home * 100).toFixed(1);
    const drawPct = (final.draw * 100).toFixed(1);
    const awayPct = (final.away * 100).toFixed(1);

    // 推荐结果
    const rec = final.home >= final.draw && final.home >= final.away ? 'home'
              : final.away >= final.draw ? 'away' : 'draw';
    const recLabel = rec === 'home' ? `主胜` : rec === 'away' ? '客胜' : '平局';

    // 各源贡献 = 权重 × 该源概率；固定遍历全部 4 源，缺源标"暂无数据"
    const ENSEMBLE_ALL_SOURCES = [
      { key: 'h2h',  name: 'Elo 推演',    icon: '🧠' },
      { key: 'odds', name: 'The Odds API', icon: '📊' },
      { key: 'poly', name: 'Polymarket',   icon: '🌐' },
      { key: 'llm',  name: 'LLM 预测',    icon: '🤖' }
    ];
    const totalWeight = parts.reduce((s, x) => s + x.weight, 0);
    const sourceRows = ENSEMBLE_ALL_SOURCES.map(meta => {
      const p = parts.find(x => x.key === meta.key);
      if (!p) {
        return `<div class="wc-ensemble-source is-empty">
          <div class="wc-ensemble-source-head">
            <span class="wc-ensemble-icon">${meta.icon}</span>
            <span class="wc-ensemble-name">${escapeHtml(meta.name)}</span>
            <span class="wc-ensemble-weight">未参与</span>
          </div>
          <div class="wc-ensemble-empty">暂无数据</div>
        </div>`;
      }
      const actualWeight = (p.weight / totalWeight) * 100;
      const ph = (p.probs.home * 100).toFixed(1);
      const pd = (p.probs.draw * 100).toFixed(1);
      const pa = (p.probs.away * 100).toFixed(1);
      // 段太窄（<10%）不显示数字，避免溢出/截断
      const showText = (n) => parseFloat(n) >= 10;
      return `<div class="wc-ensemble-source">
        <div class="wc-ensemble-source-head">
          <span class="wc-ensemble-icon">${p.icon}</span>
          <span class="wc-ensemble-name">${escapeHtml(p.name)}</span>
          <span class="wc-ensemble-weight">${actualWeight.toFixed(0)}% 权重</span>
        </div>
        <div class="wc-ensemble-bars">
          <span style="width:${ph}%" title="主胜 ${ph}%">${showText(ph) ? '主 ' + ph + '%' : ''}</span>
          <i style="width:${pd}%" title="平 ${pd}%">${showText(pd) ? '平 ' + pd + '%' : ''}</i>
          <b style="width:${pa}%" title="客胜 ${pa}%">${showText(pa) ? '客 ' + pa + '%' : ''}</b>
        </div>
      </div>`;
    }).join('');

    // 胜平负 3 卡片（显示融合后的概率，颜色按胜/平/客区分）
    const homeName = teamA ? countryName(teamA.country) : '主胜';
    const awayName = teamB ? countryName(teamB.country) : '客胜';

    return `
      <div class="wc-ensemble-card">
        <div class="wc-ensemble-banner">
          <div class="wc-ensemble-rec">
            <span class="wc-ensemble-rec-label">📊 综合推荐</span>
            <strong>${escapeHtml(recLabel)}</strong>
          </div>
          <div class="wc-ensemble-conf">
            <span class="wc-ensemble-rec-label">🎯 综合置信度</span>
            <strong>${(confidence * 100).toFixed(0)}%</strong>
          </div>
        </div>
        <div class="wc-expected-grid">
          <div class="wc-expected-card is-home" title="融合后主胜概率">
            <span class="wc-expected-team">${escapeHtml(homeName)} 胜</span>
            <span class="wc-expected-pct">${homePct}%</span>
          </div>
          <div class="wc-expected-card is-draw" title="融合后平局概率">
            <span class="wc-expected-team">平局</span>
            <span class="wc-expected-pct">${drawPct}%</span>
          </div>
          <div class="wc-expected-card is-away" title="融合后客胜概率">
            <span class="wc-expected-team">${escapeHtml(awayName)} 胜</span>
            <span class="wc-expected-pct">${awayPct}%</span>
          </div>
        </div>
        <div class="wc-winbar wc-ensemble-winbar">
          <span style="width:${homePct}%">${homePct}%</span>
          <i style="width:${drawPct}%">${drawPct}%</i>
          <b style="width:${awayPct}%">${awayPct}%</b>
        </div>
        <h4>各源贡献分解</h4>
        <div class="wc-ensemble-sources">${sourceRows}</div>
      </div>
    `;
  }

  function playerMatchups(teamA, teamB) {
    const positions = [
      ['GK', '门将'],
      ['DF', '后卫'],
      ['MF', '中场'],
      ['FW', '前锋']
    ];

    const groups = positions.map(([pos, label]) => {
      const playersA = (teamA.players || []).filter(player => player.position === pos).slice(0, 3);
      const playersB = (teamB.players || []).filter(player => player.position === pos).slice(0, 3);
      const length = Math.max(playersA.length, playersB.length);
      if (!length) return '';
      const rows = [];
      for (let index = 0; index < length; index += 1) {
        const playerA = playersA[index];
        const playerB = playersB[index];
        rows.push(`
          <div class="wc-player-vs">
            <span>${playerA ? `${escapeHtml(playerName(playerA.name))} <small>${(playerA.market_value || 0).toFixed(1)}M</small>` : '--'}</span>
            <i>vs</i>
            <span>${playerB ? `<small>${(playerB.market_value || 0).toFixed(1)}M</small> ${escapeHtml(playerName(playerB.name))}` : '--'}</span>
          </div>
        `);
      }
      return `<div class="wc-player-group"><h4>${label}</h4>${rows.join('')}</div>`;
    }).join('');

    return groups || '<div class="empty-state">暂无可比对球员数据。</div>';
  }

  async function loadTeamsOnly() {
    // Independent team load for modal use (no guard, no overlay)
    try {
      await loadMatches();
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-cache' });
      if (!res.ok) return;
      const payload = await res.json();
      const rawTeams = Array.isArray(payload.teams) ? payload.teams : [];
      if (state.matchesData && state.matchesData.groups) {
        const participatingTeams = new Set();
        Object.keys(state.matchesData.groups).forEach(groupKey => {
          const g = state.matchesData.groups[groupKey];
          if (g && g.teams) g.teams.forEach(t => participatingTeams.add(t));
        });
        const rawToMatch = { 'Bosnia and Herzegovina': 'Bosnia-Herzegovina', 'Cape Verde': 'Cabo Verde' };
        state.teams = rawTeams.filter(team => {
          if (participatingTeams.has(team.country)) return true;
          const matchName = rawToMatch[team.country];
          return matchName && participatingTeams.has(matchName);
        });
      } else {
        state.teams = rawTeams;
      }
      enrichTeamsWithConformalAndAttribution();
    } catch (e) { /* silent */ }
  }

  async function showMatchPredictionModal(home, away, matchId = '') {
    if (state.teams.length === 0) await loadTeamsOnly();
    if (state.teams.length > 0 && !state.conformal) enrichTeamsWithConformalAndAttribution();
    const teamA = findTeam(home);
    const teamB = findTeam(away);
    const scheduleMatch = findScheduleMatch(matchId, home, away);

    // Remove existing modal if any
    const existing = el('wcH2hModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay wc-h2h-modal-overlay';
    modal.id = 'wcH2hModal';
    modal.style.display = 'flex';

    if (!teamA || !teamB) {
      const missingTeams = [];
      if (!teamA) missingTeams.push(escapeHtml(countryName(home)));
      if (!teamB) missingTeams.push(escapeHtml(countryName(away)));
      
      modal.innerHTML = `
        <div class="modal-card card wc-h2h-modal-card" style="max-width: 460px;">
          <div class="modal-header wc-h2h-modal-header" style="border-bottom: none; margin-bottom: 0;">
            <h3 style="font-size: 1.15rem; color: var(--danger); font-weight: 700;">⚠️ 预测数据不足</h3>
            <button class="modal-close" id="wcH2hModalClose" aria-label="关闭预测窗口">×</button>
          </div>
          <div class="modal-body" style="text-align: center; padding: 0 var(--space-lg) var(--space-lg) var(--space-lg);">
            <div class="wc-modal-prediction-title" style="margin-bottom: var(--space-md);">
              <span style="font-size: 3rem; display: block; margin-bottom: 12px; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.3));">📊</span>
              <h4 style="font-size: 1.05rem; font-weight: 800; color: var(--text-primary); margin-bottom: 8px;">
                ${escapeHtml(countryName(home))} VS ${escapeHtml(countryName(away))}
              </h4>
              <p style="color: var(--text-secondary); font-size: 0.82rem; line-height: 1.6; margin-bottom: var(--space-md);">
                非常抱歉！由于队伍 <strong style="color: var(--danger); font-weight: 800;">${missingTeams.join(' 和 ')}</strong> 缺失 Elo 历史战绩、战术因子及球员身价等核心模型数据，系统无法对此场比赛进行 Poisson 模拟和对战推演。
              </p>
              <button class="btn btn-secondary" id="wcH2hModalCloseBtn" style="min-height: 38px; padding: 6px 24px; font-weight: 700;">我知道了</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      
      const closeBtn = modal.querySelector('#wcH2hModalClose');
      const closeBtn2 = modal.querySelector('#wcH2hModalCloseBtn');
      const closeModal = () => {
        modal.classList.add('fade-out');
        setTimeout(() => modal.remove(), 200);
      };
      if (closeBtn) closeBtn.addEventListener('click', closeModal);
      if (closeBtn2) closeBtn2.addEventListener('click', closeModal);
      modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
      });
      return;
    }

    const result = h2hCalc(teamA, teamB);
    const scores = scorePredictions(teamA, teamB);
    const aPct = result.winA * 100;
    const bPct = result.winB * 100;
    const dPct = result.draw * 100;
    const officialH2h = scheduleMatch?.headToHead || null;
    const record = officialH2h ? {
      wA: officialH2h.wHome,
      d: officialH2h.draws,
      wB: officialH2h.wAway,
      t: officialH2h.total,
      note: `FIFA 官方历史交锋统计，进球 ${officialH2h.goalsHome}-${officialH2h.goalsAway}。`
    } : null;

    // 实时数据查找
    const oddsApiEvent = findOddsApiMatch(home, away);
    const oddsMarket = extractH2HMarket(oddsApiEvent);
    const fdMatch = findFootballDataMatch(matchId);
    const llmPred = findLLMPrediction(matchId);

    // Polymarket h2h event（按 country 匹配，title 含双方国家名）
    const polymarketEvent = (() => {
      const payload = state.oddsSnapshots?.polymarket;
      if (!payload || !Array.isArray(payload.events)) return null;
      return payload.events.find(ev => {
        const t = (ev.title || '').toLowerCase();
        const nameA = countryName(teamA.country).toLowerCase();
        const nameB = countryName(teamB.country).toLowerCase();
        return t.includes(nameA) && t.includes(nameB);
      }) || null;
    })();

    // LLM / Odds 数据可用性标记（已移除实时数据徽章）
    // const meta = state.oddsSnapshots?.meta || null;
    // const dataSourcesBadge = meta ? (() => {
    //   const ts = new Date(meta.finishedAt || meta.startedAt);
    //   const time = ts.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    //   return `<span class="wc-h2h-meta" title="实时数据拉取于 ${escapeHtml(time)}">📡 实时数据 ${escapeHtml(time)}</span>`;
    // })() : '';

    modal.innerHTML = `
      <div class="modal-card card wc-h2h-modal-card">
        <div class="modal-header wc-h2h-modal-header">
          <div class="wc-modal-title-teams">
            <span class="wc-modal-flag-badge">${flag(teamA.country)} ${escapeHtml(countryName(teamA.country))}</span>
            <span class="wc-modal-vs">VS</span>
            <span class="wc-modal-flag-badge">${flag(teamB.country)} ${escapeHtml(countryName(teamB.country))}</span>
          </div>
          <button class="modal-close" id="wcH2hModalClose" aria-label="关闭预测窗口">×</button>
        </div>
        <div class="modal-body wc-h2h-modal-body">
          ${(() => {
            const ens = ensemblePredict(result, oddsMarket, polymarketEvent, llmPred);
            return renderEnsembleCard(ens, teamA, teamB);
          })()}
          ${(() => {
            // v3.4.2: Conformal 校正后的"安全边际"最终预测
            // 4 维融合 (ensemble) 输出连续概率 → 用 Conformal 预测集做收缩
            //  - set_size=1: 保留 raw
            //  - set_size=2: 向 0.5/0.5/0 收缩
            //  - set_size=3: 向 1/3/1/3/1/3 收缩
            if (!state.h2hConformal || !window.WorldCupConformal) return '';
            const cp = state.h2hConformal[teamA.country]?.[teamB.country];
            if (!cp) return '';
            const ens = ensemblePredict(result, oddsMarket, polymarketEvent, llmPred);
            const raw = ens.final;  // {home, draw, away}
            const adj = window.WorldCupConformal.conformalCalibrateProbs(
              raw.home, raw.draw, raw.away, cp.prediction_set
            );
            const ph = (adj.home * 100).toFixed(1);
            const pd = (adj.draw * 100).toFixed(1);
            const pa = (adj.away * 100).toFixed(1);
            const rawPh = (raw.home * 100).toFixed(1);
            const rawPd = (raw.draw * 100).toFixed(1);
            const rawPa = (raw.away * 100).toFixed(1);
            const setLbl = cp.prediction_set.join('/');
            const size = cp.set_size;
            const setColor = size === 1 ? '#00a86b' : size === 2 ? '#faad14' : '#ff4757';
            const conf = (cp.confidence * 100).toFixed(0);
            // 各结果的偏移 (校正后 - 4 维融合)
            const dHome = (adj.home - raw.home) * 100;
            const dDraw = (adj.draw - raw.draw) * 100;
            const dAway = (adj.away - raw.away) * 100;
            // delta < 0.5 不显示（set_size=1 全部 < 0.5 视为"无变化"）
            const fmtDelta = (d) => {
              if (Math.abs(d) < 0.5) return '';
              const s = d > 0 ? '+' : '';
              const cls = d > 0 ? 'is-pos' : 'is-neg';
              return `<span class="cp-delta ${cls}">${s}${d.toFixed(1)}</span>`;
            };
            return `
              <div class="wc-ensemble-card cp-calibrated">
                <div class="wc-ensemble-banner">
                  <div class="wc-ensemble-rec">
                    <span class="wc-ensemble-rec-label">🛡 Conformal 校正后</span>
                    <strong>${setLbl}</strong>
                  </div>
                  <div class="wc-ensemble-conf">
                    <span class="wc-ensemble-rec-label">🎯 校准置信度</span>
                    <strong style="color:${setColor}">${conf}%</strong>
                  </div>
                </div>
                <div class="cp-raw-compare">
                  <span>4 维融合: 主 ${rawPh}% / 平 ${rawPd}% / 客 ${rawPa}%</span>
                  <span class="cp-arrow">→</span>
                  <span>校正后: 主 ${ph}% / 平 ${pd}% / 客 ${pa}%</span>
                </div>
                <div class="wc-winbar wc-ensemble-winbar cp-calibrated-bar">
                  <span style="width:${ph}%" title="校正后主胜 ${ph}% (${fmtDelta(dHome)})">主 ${ph}% ${fmtDelta(dHome)}</span>
                  <i style="width:${pd}%" title="校正后平 ${pd}% (${fmtDelta(dDraw)})">平 ${pd}% ${fmtDelta(dDraw)}</i>
                  <b style="width:${pa}%" title="校正后客胜 ${pa}% (${fmtDelta(dAway)})">客 ${pa}% ${fmtDelta(dAway)}</b>
                </div>
                <p class="cp-calibrate-note">
                  基于 Split Conformal Prediction（2006-2022 世界杯 95 场校准，约 90% 覆盖率）。
                  set_size=${size} 时把 4 维融合向${size === 1 ? '原值' : (size === 2 ? '0.5/0.5/0' : '1/3/1/3/1/3')} 收缩，
                  给"实力接近"的比赛戴上安全边际。
                </p>
              </div>
            `;
          })()}
          ${(() => {
            // v3.4.2: Conformal Prediction Set — {胜/平/负} 预测集
            if (!state.h2hConformal) return '';
            const cp = state.h2hConformal[teamA.country]?.[teamB.country];
            if (!cp) return '';
            const setLbl = cp.prediction_set.join('/');
            const size = cp.set_size;
            // 主题适配：worldcup 主题 --accent 是红色，不适合做"绿色"语义
            // 用显式语义色：size=1 高度确定=绿，size=2=黄，size=3=红
            const color = size === 1 ? '#00a86b' : size === 2 ? '#faad14' : '#ff4757';
            const bg = size === 1 ? 'rgba(0,168,107,0.10)' : size === 2 ? 'rgba(250,173,20,0.10)' : 'rgba(255,71,87,0.10)';
            const confidence = (cp.confidence * 100).toFixed(0);
            return `
              <div class="cp-set-box" style="background:${bg};border:1px solid ${color};border-radius:12px;padding:12px 14px;margin-bottom:14px">
                <div class="cp-set-hd">
                  <span class="cp-set-lbl">Conformal 预测集</span>
                  <span class="cp-set-badge" style="background:${color};color:#0a0a0a">${setLbl}</span>
                </div>
                <div class="cp-set-exp">${escapeHtml(cp.explanation)}</div>
                <div class="cp-set-conf">置信度 ${confidence}% · 基于 2006-2022 世界杯历史校准（约 90% 覆盖率）</div>
              </div>
            `;
          })()}
          <div class="wc-score-card">
            ${renderOddsTrend(oddsMarket, oddsApiEvent, home, away)}
            <h3>精选比分</h3>
            <div class="wc-score-grid">
              ${scores.likely.map(item => `
                <div class="${item === scores.featured ? 'is-featured' : ''}">
                  <strong>${item.goalsA} - ${item.goalsB}</strong>
                  <span>${pct(item.prob, 1)}</span>
                </div>
              `).join('')}
            </div>
            <h3>大比分博弈区</h3>
            <div class="wc-score-grid is-high">
              ${scores.high.map(item => `
                <div>
                  <strong>${item.goalsA} - ${item.goalsB}</strong>
                  <span>${pct(item.prob, 1)}</span>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="wc-h2h-split">
            <div class="wc-h2h-card">
              <h3>核心因子对比</h3>
              ${factorDiff(teamA, teamB)}
            </div>
            <div class="wc-h2h-card">
              <h3>官方交锋样本</h3>
              ${record ? `
                <div class="wc-record">
                  <div><strong>${record.wA}</strong><span>${code(teamA.country)} 胜</span></div>
                  <div><strong>${record.d}</strong><span>平</span></div>
                  <div><strong>${record.wB}</strong><span>${code(teamB.country)} 胜</span></div>
                </div>
                <p>${escapeHtml(record.note)} <span>${record.t} 场样本</span></p>
                ${officialH2h && officialH2h.matches?.length ? `
                  <div class="wc-official-h2h-list">
                    ${officialH2h.matches.slice(0, 3).map(item => `
                      <div>
                        <span>${escapeHtml(item.date || '--')}</span>
                        <strong>${escapeHtml(countryName(item.home))} ${item.homeScore ?? '-'}-${item.awayScore ?? '-'} ${escapeHtml(countryName(item.away))}</strong>
                        <small>${escapeHtml(item.competition || item.stage || '')}</small>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              ` : '<p>FIFA 官方接口暂无这两队的历史交锋样本，历史战绩不做推断。</p>'}
            </div>
          </div>
          <div class="wc-h2h-card">
            <h3>球员位置对位较量</h3>
            ${playerMatchups(teamA, teamB)}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('#wcH2hModalClose');
    const closeModal = () => {
      modal.classList.add('fade-out');
      setTimeout(() => modal.remove(), 200);
    };
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        closeModal();
      }
    });
  }

  function updateSquad() {
    const target = el('wcSquadContent');
    if (!target) return;
    const team = findTeam(state.selectedSquad);
    if (!team) {
      target.innerHTML = '<div class="empty-state">暂无球队数据。</div>';
      return;
    }

    const players = team.players || [];
    target.innerHTML = `
      <div class="wc-squad-head">
        <div class="wc-code">${code(team.country)}</div>
        <div>
          <h3>${escapeHtml(countryName(team.country))}</h3>
          <p>Elo ${(team.elo || 0).toFixed(0)} · 修正 Elo ${(team.mod_elo || team.elo || 0).toFixed(0)} · ${players.length} players</p>
        </div>
      </div>
      ${players.length ? `
        <div class="table-wrapper">
          <table class="data-table wc-squad-table">
            <thead>
              <tr>
                <th>位置</th>
                <th>球员</th>
                <th>年龄</th>
                <th>出场</th>
                <th>进球</th>
                <th>估值</th>
              </tr>
            </thead>
            <tbody>
              ${players.map(player => `
                <tr>
                  <td><span class="wc-pos">${escapeHtml(POSITION_CN[player.position] || player.position || '--')}</span></td>
                  <td>
                    <strong>${escapeHtml(playerName(player.name))}</strong>
                    <span>${escapeHtml(player.club || '')}</span>
                  </td>
                  <td>${player.age || '--'}</td>
                  <td>${player.national_caps || 0}</td>
                  <td>${player.national_goals || 0}</td>
                  <td>${(player.market_value || 0).toFixed(1)}M</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty-state">该队暂无球员列表。</div>'}
    `;
  }

  window.WorldCup = {
    init: loadData,
    getMetadata: () => state.metadata,
    render,
    switchTab
  };
})();
