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
    llmPredictions: null,   // { generatedAt, model, predictions: [{matchId, ...}] } — h2h 单场
    llmOutright: null,      // { generatedAt, model, predictions: [{country, winProb, ...}] } — 冠军 outright
    oddsSnapshots: null,    // { meta, polymarket, 'the-odds-api', 'football-data' }
    oddsHistory: null       // { 'the-odds-api': [{ fetchedAt, events: [...] }, ...] } — 最近 28 个时间点
  };

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
    if (COUNTRY_FLAGS[country]) return COUNTRY_FLAGS[country];
    const alias = COUNTRY_ALIAS && COUNTRY_ALIAS[country];
    if (alias && COUNTRY_FLAGS[alias]) return COUNTRY_FLAGS[alias];
    return '🏳️';
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
  // 这张表同时被 polyCountryToTicai 和 findTeam 引用, 是唯一的国家名 alias 来源
  const COUNTRY_ALIAS = {
    'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
    'Cabo Verde': 'Cape Verde',
    'Congo DR': 'DR Congo',
    'Czechia': 'Czech Republic',
    'Turkiye': 'Turkey',
    'United States': 'USA'
  };
  // 保留旧名 (向后兼容历史代码 / 文档)
  const POLY_TO_TICAI_ALIAS = COUNTRY_ALIAS;

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
    if (COUNTRY_ALIAS[trimmed]) return COUNTRY_ALIAS[trimmed];
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

  // 场馆 → 当地 IANA 时区（用于把 FIFA date+time 当地时间换算到 UTC 再到 UTC+8）
  const VENUE_TZ = {
    'Mexico City Stadium, Mexico City': 'America/Mexico_City',
    'Guadalajara Stadium, Guadalajara': 'America/Mexico_City',
    'Monterrey Stadium, Monterrey': 'America/Mexico_City',
    'Atlanta Stadium, Atlanta': 'America/New_York',
    'Boston Stadium, Boston': 'America/New_York',
    'Dallas Stadium, Dallas': 'America/Chicago',
    'Houston Stadium, Houston': 'America/Chicago',
    'Kansas City Stadium, Kansas City': 'America/Chicago',
    'Los Angeles Stadium, Los Angeles': 'America/Los_Angeles',
    'Miami Stadium, Miami': 'America/New_York',
    'New York/New Jersey Stadium, New Jersey': 'America/New_York',
    'Philadelphia Stadium, Philadelphia': 'America/New_York',
    'San Francisco Bay Area Stadium, San Francisco Bay Area': 'America/Los_Angeles',
    'Seattle Stadium, Seattle': 'America/Los_Angeles',
    'BC Place Vancouver, Vancouver': 'America/Vancouver',
    'Toronto Stadium, Toronto': 'America/Toronto'
  };

  function getBeijingTimeInfo(date, time) {
    try {
      // FIFA date+time 是当地场馆时间。优先从 venue 查 IANA 时区,
      // 没匹配则把原 date+time 当 UTC 处理（与旧逻辑兼容）。
      const tz = (date && time && arguments.length >= 1) ? null : null;
      let d;
      // 当前调用方没传 venue — 老路径就当 UTC。
      d = new Date(date + 'T' + time + ':00Z');

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

  // 给 today panel 用：根据 venue 当地 IANA 时区, 把当地 date+time 转成北京 (UTC+8) 显示
  function getMatchBeijingTime(venue, date, time) {
    const tz = VENUE_TZ[venue];
    if (!tz || !date || !time) {
      return getBeijingTimeInfo(date, time);  // 兜底走原 UTC 假设
    }
    try {
      // 把当地 wall time 当成 tz 时区的本地时间,直接格式化到 Asia/Shanghai
      const localFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      // Intl 不能从 wall time 解析,必须用 wall time 转 UTC 时刻
      // 取当地年月日 → 当作那天 00:00,再用 time 累加
      const [hh, mm] = (time || '00:00').split(':').map(n => parseInt(n, 10) || 0);
      // 用 America/Toronto 2026-06-12 19:00 → 直接造 ISO local 然后说 "this is in tz"
      // 招数: 拼接 ISO 然后 + offset via Intl
      const localISO = `${date}T${pad2(hh)}:${pad2(mm)}:00`;
      // 探测当地当天与 UTC 的偏移 (分钟)
      const probe = new Date(localISO + 'Z');  // 假装是 UTC
      const tzWall = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(probe);
      const get = t => parseInt(tzWall.find(p => p.type === t).value, 10);
      const probeWall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
      const offsetMin = (probeWall - probe.getTime()) / 60000;  // tz 实际 wall - UTC wall
      // 真正的 UTC 时刻 = localWallTime - offset
      const utcMs = Date.UTC(parseInt(date.slice(0,4), 10), parseInt(date.slice(5,7), 10) - 1, parseInt(date.slice(8,10), 10), hh, mm) - offsetMin * 60000;
      const d = new Date(utcMs);
      const sh = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
      });
      const parts = sh.formatToParts(d);
      const get2 = t => parts.find(p => p.type === t).value;
      let weekday = get2('weekday');
      if (weekday.length === 1) weekday = '周' + weekday;
      return {
        date: get2('month') + '-' + get2('day'),
        dateStr: get2('month') + '月' + get2('day') + '日',
        time: get2('hour') + ':' + get2('minute'),
        day: weekday
      };
    } catch (e) {
      return getBeijingTimeInfo(date, time);
    }
  }

  function sortedTeams() {
    return state.teams.slice().sort((a, b) => (b.final_prob || 0) - (a.final_prob || 0));
  }

  function findTeam(country) {
    const found = state.teams.find(team => team.country === country);
    if (found) return found;
    // Alias fallback — 复用上面声明的 COUNTRY_ALIAS (跟 polyCountryToTicai 同一份)
    const alias = COUNTRY_ALIAS[country];
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

    // Kimi 2026 增量: 加载 benchmarks (Elo 校准表 / MC 参数 / 校准矩阵 / 概率基准)
    if (window.KimiBenchmarks) {
      try {
        const b = await window.KimiBenchmarks.load();
        window._kimiBenchCache = b;
        console.info('[KimiBenchmarks] loaded:', {
          teams: b.championBenchmarks?.teams?.length || 0,
          eloRows: b.eloMappingTable?.rows?.length || 0,
          calBins: b.calibrationMatrix?.bins?.length || 0
        });
      } catch (e) {
        console.warn('[KimiBenchmarks] load failed:', e);
      }
    }

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
      if (!res.ok) {
        if (res.status !== 503) console.info('[odds] history HTTP', res.status);
        return;
      }
      const payload = await res.json();
      state.oddsHistory = { 'the-odds-api': payload.history || [] };
    } catch (e) {
      // 静默 — 缺失不影响主功能
    }
  }

  // 实时数据快照（Polymarket / The Odds API / football-data / Polymarket outright）
  // 由 Vercel Cron 每天 0:00 UTC 写入 KV，前端直接 fetch
  async function loadOddsSnapshots() {
    try {
      const res = await fetch('/api/odds/snapshots', { headers: { accept: 'application/json' } });
      if (!res.ok) {
        // 503 通常 = Vercel 没配 Upstash env (开发/预览环境常见), 静默
        if (res.status !== 503) {
          console.info('[odds] /api/odds/snapshots HTTP', res.status);
        }
        return;
      }
      const payload = await res.json();
      state.oddsSnapshots = payload;
      // 健康度检查：避免上游改了 tag/丢了 key 时静默坏数据
      state.oddsHealth = checkOddsHealth(payload);
      if (!state.oddsHealth.ok) {
        // 用 info 替代 warn — 缺源是部署/配置问题, 不阻塞用户
        console.info('ℹ️ [odds] 部分源缺失（部署侧配置问题）:', state.oddsHealth.issues);
      }
      // 拉到新数据后重渲染：market tab 用到了 polymarket-outright
      if (state.loaded) render();
    } catch (e) {
      console.info('[odds] 快照加载失败:', e?.message || e);
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
    // Kimi 2026 增量: 从 match.venue 解析主场/海拔/WBGT, 传给 h2hCalc
    // 主场对位判定: 世界杯主队就是 match.home
    const matchCtx = (window.KimiBenchmarks && window.KimiBenchmarks.buildMatchContext)
      ? window.KimiBenchmarks.buildMatchContext(match.venue, 'A')
      : { home: 'A' };
    const h2hResult = h2hCalc(teamA, teamB, matchCtx);
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
            <span class="wc-kicker">2026 FIFA World Cup · 数据分析</span>
            <h2 class="wc-hero-title">2026 世界杯</h2>
            <p class="wc-hero-sub">用 AI 和代码，算这场世界杯</p>
          </div>
        </div>
        <div class="wc-top-strip" id="wcTopStrip"></div>
      </div>

      <div class="wc-tabs" id="worldcupTabs">
        <button class="wc-tab active" data-wc-tab="matches">最近比赛</button>
        <button class="wc-tab" data-wc-tab="champion">冠军概率</button>
        <button class="wc-tab" data-wc-tab="factor">因子拆解</button>
        <button class="wc-tab" data-wc-tab="mystic">玄学分析</button>
        <button class="wc-tab" data-wc-tab="squad">球队阵容</button>
        ${state.oddsHealth && !state.oddsHealth.ok
          ? `<span class="wc-odds-health-badge" title="${escapeHtml(state.oddsHealth.issues.join(' / '))}">⚠️ 数据源异常</span>`
          : ''}
      </div>

      <div class="wc-panel active" id="wcPanelMatches"><div id="wcTodayPanel" class="wc-today-panel-host"></div></div>
      <div class="wc-panel" id="wcPanelChampion">${renderMarketPanel()}</div>
      <div class="wc-panel" id="wcPanelFactor">${renderFactorPanel()}</div>
      <div class="wc-panel" id="wcPanelMystic">${renderMysticPanel()}</div>
      <div class="wc-panel" id="wcPanelSquad">${renderSquadPanel()}</div>
    `;

    bindPanelEvents();
    renderTopStrip();
    switchTab(state.activeTab);
    updateSquad();
    renderTodayPanel();
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

  // ============================================================
  // 最近比赛面板 (UTC+8, 今天 + 明天)
  // - 顶部 hero 风格大卡片，1 张主推 + 多场横向 scroll-snap 轮播
  // - 比分预测: 复用 scorePredictions() 的 featured
  // - 天气: /api/weather（Open-Meteo + Upstash 缓存），失败时降级到 WBGT
  // ============================================================
  function getBeijingDateKey() {
    // 2026-06-12 形式的北京日期
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return fmt.format(new Date()); // en-CA 输出 YYYY-MM-DD
  }

  // 北京日期 + N 天, 返回 YYYY-MM-DD
  function getBeijingDateOffset(days) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return fmt.format(d);
  }

  // 最近比赛 = 今天 + 明天 (UTC+8 当日)
  // 用 getMatchBeijingTime 把 m.date+time+venue 换算成北京日历日,再跟 today/tomorrow 比较
  // 原因: m.date 是当地日历日, 跨日比赛(当地晚 23:00 ↔ 北京次日)容易漏
  function getUpcomingMatches() {
    const md = state.matchesData;
    if (!md || !md.groups) return [];
    const todayKey = getBeijingDateKey();
    const tomorrowKey = getBeijingDateOffset(1);
    const allowed = new Set([todayKey, tomorrowKey]);
    const all = [];
    Object.values(md.groups).forEach(g => {
      (g.matches || []).forEach(m => {
        if (!m.date || !m.time || !m.venue) return;
        const t = getMatchBeijingTime(m.venue, m.date, m.time);
        // t.date 是 "MM-DD",要拼成 "YYYY-MM-DD" — 用 todayKey 的年份
        const year = todayKey.slice(0, 4);
        const beijingKey = `${year}-${t.date}`;
        if (allowed.has(beijingKey)) {
          all.push({ ...m, _group: g.teams ? g.teams[0] : '' });
        }
      });
    });
    all.sort((a, b) => {
      const ta = (a.date + 'T' + (a.time || '00:00')).replace(' ', 'T');
      const tb = (b.date + 'T' + (b.time || '00:00')).replace(' ', 'T');
      return ta.localeCompare(tb);
    });
    return all;
  }

  // 兼容旧引用
  function getTodayMatches() {
    return getUpcomingMatches();
  }

  // 复用 modal 里的逻辑：从 scorePredictions 拿 featured 主推比分
  // scorePredictions 在当前分支尚未完工（返回 undefined），我们自己用 Poisson + 算主推比分
  // 给 today 卡用的精选比分 + 综合推荐 + 校准胜率
  // 跟 modal 里同源（用 scorePredictions + ensemblePredict + Conformal）
  function computeTodayExtras(match) {
    const out = { featured: null, recLabel: null, recPct: null, calPct: null, calColor: null, calSet: null };
    try {
      const teamA = findTeam(match.home);
      const teamB = findTeam(match.away);
      if (!teamA || !teamB) return out;
      const matchCtx = (window.KimiBenchmarks && window.KimiBenchmarks.buildMatchContext)
        ? window.KimiBenchmarks.buildMatchContext(match.venue, 'A')
        : { home: 'A' };
      const scores = scorePredictions(teamA, teamB, matchCtx);
      if (scores && scores.featured) {
        out.featured = scores.featured;
      }
      // 综合推荐（4 源融合）
      const oddsMarket = extractH2HMarket(findOddsApiMatch(match.home, match.away));
      const polymarketEvent = findPolymarketByCountry(match.home, match.away);
      const llmPred = findLLMPrediction(match.id);
      const h2hResult = h2hCalc(teamA, teamB, matchCtx);
      const ens = ensemblePredict(h2hResult, oddsMarket, polymarketEvent, llmPred);
      if (ens && ens.final) {
        const maxKey = ens.final.home >= ens.final.draw && ens.final.home >= ens.final.away ? 'home'
                     : ens.final.away >= ens.final.draw ? 'away' : 'draw';
        out.recLabel = maxKey === 'home' ? `${countryName(match.home)} 胜`
                     : maxKey === 'away' ? `${countryName(match.away)} 胜` : '平局';
        out.recPct = Math.round((ens.final[maxKey] || 0) * 100);
      }
      // 校准胜率（Conformal 校准后）
      const cp = state.h2hConformal?.[teamA.country]?.[teamB.country];
      if (cp && ens && ens.final) {
        const adj = window.WorldCupConformal.conformalCalibrateProbs(
          ens.final.home, ens.final.draw, ens.final.away, cp.prediction_set,
          {
            confidence: cp.confidence,
            qhat: cp._qhat,
            ensembleAgreement: ens.ensembleAgreement,
            drawFloor: 0.15
          }
        );
        const maxKey = adj.home >= adj.draw && adj.home >= adj.away ? 'home'
                     : adj.away >= adj.draw ? 'away' : 'draw';
        out.calPct = Math.round((adj[maxKey] || 0) * 100);
        const size = cp.set_size;
        out.calColor = size === 1 ? '#00a86b' : size === 2 ? '#faad14' : '#ff4757';
        out.calSet = cp.prediction_set.join('/');
      }
    } catch (e) {
      // 静默 — 单场失败不影响主流程
    }
    return out;
  }

  // WBGT 等级（已有 KimiBenchmarks,失败时前端用基础分级）
  function wbgtFallbackLabel(tempC) {
    if (tempC == null) return null;
    if (tempC >= 32) return { label: '极高温', icon: '🥵' };
    if (tempC >= 28) return { label: '高温',   icon: '🔥' };
    if (tempC >= 23) return { label: '温暖',   icon: '☀️' };
    if (tempC >= 15) return { label: '舒适',   icon: '🌤️' };
    if (tempC >= 5)  return { label: '凉爽',   icon: '🧥' };
    return { label: '寒冷', icon: '❄️' };
  }

  async function fetchWeather(match) {
    if (!match.venue || !match.date) return null;
    const time = match.time || '20:00';
    try {
      const url = `/api/weather?venue=${encodeURIComponent(match.venue)}&date=${encodeURIComponent(match.date)}&time=${encodeURIComponent(time)}`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.ok) return data;
      return null;
    } catch (e) {
      return null;
    }
  }

  function buildTodayCard(match, extras, weather, isFeatured) {
    const homeCn = countryName(match.home);
    const awayCn = countryName(match.away);
    const homeCode = code(match.home);
    const awayCode = code(match.away);
    const homeFlag = flag(match.home);
    const awayFlag = flag(match.away);
    const timeInfo = getMatchBeijingTime(match.venue, match.date, match.time);
    const localTime = `${match.date} ${match.time}`;
    const beijingTime = `${timeInfo.dateStr} ${timeInfo.day} ${timeInfo.time}`;
    // 场馆城市中文 (从 venue 字符串里抓逗号前的 "Stadium" 部分 → 实在不行就原样)
    const venueCityZh = (() => {
      const map = {
        'Mexico City': '墨西哥城', 'Guadalajara': '瓜达拉哈拉', 'Monterrey': '蒙特雷',
        'Atlanta': '亚特兰大', 'Boston': '波士顿', 'Dallas': '达拉斯',
        'Houston': '休斯顿', 'Kansas City': '堪萨斯城', 'Inglewood': '洛杉矶',
        'Los Angeles': '洛杉矶', 'Miami Gardens': '迈阿密', 'Miami': '迈阿密',
        'East Rutherford': '纽约', 'New York/New Jersey': '纽约', 'Philadelphia': '费城',
        'Santa Clara': '旧金山', 'San Francisco Bay Area': '旧金山',
        'Seattle': '西雅图', 'Vancouver': '温哥华', 'Toronto': '多伦多'
      };
      const segs = (match.venue || '').split(',').map(s => s.trim());
      for (const seg of segs) if (map[seg]) return map[seg];
      return segs[segs.length - 1] || match.venue || '';
    })();
    const groupKey = match.group || match._group || '';
    const roundLabel = groupKey ? `${groupKey} 组 · 小组赛` : '小组赛';

    const featured = extras && extras.featured;
    const featuredLine = featured
      ? `<span class="wc-today-featured-score">${featured.goalsA} - ${featured.goalsB}<span class="wc-today-question">?</span></span>`
      : `<span class="wc-today-featured-score wc-today-pending">VS</span>`;

    // 推荐胜率 / 校准胜率 chip (左下一行)
    const recChip = (extras && extras.recLabel && extras.recPct != null)
      ? `<span class="wc-today-pct-inline is-rec" title="4 源综合推荐">
           <span class="wc-today-pct-inline-label">📊 推荐</span>
           <span class="wc-today-pct-inline-value">${extras.recPct}%</span>
           <span class="wc-today-pct-inline-sub">${escapeHtml(extras.recLabel)}</span>
         </span>`
      : '';
    const calChip = (extras && extras.calPct != null && extras.calSet)
      ? `<span class="wc-today-pct-inline is-cal" title="校准后 (${escapeHtml(extras.calSet)})">
           <span class="wc-today-pct-inline-label">🛡 校准</span>
           <span class="wc-today-pct-inline-value" style="color:${extras.calColor || '#6ee7b7'}">${extras.calPct}%</span>
           <span class="wc-today-pct-inline-sub">${escapeHtml(extras.calSet)}</span>
         </span>`
      : '';

    // 当地时间 / 天气 chip (左下一行, 跟胜率并排)
    const localChip = `<span class="wc-today-chip is-venue">
        <span class="wc-today-chip-icon">📍</span>
        ${escapeHtml(venueCityZh)} · 当地
      </span>
      <span class="wc-today-chip is-time">
        <span class="wc-today-chip-icon">🕒</span>
        ${escapeHtml(localTime)}
      </span>`;

    const weatherLine = weather
      ? `<span class="wc-today-chip"><span class="wc-today-chip-icon">${weather.icon || '🌡️'}</span>${Math.round(weather.tempC)}°C · ${escapeHtml(weather.label)}${weather.humidity != null ? ' · 湿度 ' + Math.round(weather.humidity) + '%' : ''}</span>`
      : `<span class="wc-today-chip is-muted"><span class="wc-today-chip-icon">⏳</span>天气加载中</span>`;

    return `
      <article class="wc-today-card${isFeatured ? ' is-featured' : ''}" data-match-id="${escapeHtml(match.id || '')}" data-home="${escapeHtml(match.home)}" data-away="${escapeHtml(match.away)}">
        <header class="wc-today-head">
          <span class="wc-today-kicker">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              <path d="M2 12h20"/>
            </svg>
            FIFA WORLD CUP 2026 · ${escapeHtml(roundLabel)}
          </span>
        </header>
        <div class="wc-today-stage">
          <div class="wc-today-team is-home">
            <div class="wc-today-team-flag">${homeFlag}</div>
            <div class="wc-today-team-name">${escapeHtml(homeCn)}</div>
            <div class="wc-today-team-code">${homeCode}</div>
          </div>
          <div class="wc-today-score">
            ${featuredLine}
            <small>AI 预测比分</small>
            <span class="wc-today-bj-time" title="北京时间">
              <span class="wc-today-chip-icon">🇨🇳</span>
              ${escapeHtml(beijingTime)}
            </span>
          </div>
          <div class="wc-today-team is-away">
            <div class="wc-today-team-flag">${awayFlag}</div>
            <div class="wc-today-team-name">${escapeHtml(awayCn)}</div>
            <div class="wc-today-team-code">${awayCode}</div>
          </div>
        </div>
        <footer class="wc-today-foot">
          <div class="wc-today-foot-row wc-today-foot-row--left">
            ${recChip}
            ${calChip}
            ${localChip}
            ${weatherLine}
          </div>
        </footer>
      </article>
    `;
  }

  async function renderTodayPanel() {
    const host = el('wcTodayPanel');
    if (!host) return;
    const matches = getTodayMatches();

    if (matches.length === 0) {
      host.innerHTML = `
        <section class="wc-today-empty card">
          <div class="wc-today-empty-title">今天没有比赛</div>
          <div class="wc-today-empty-sub">看看其他 tab 里的深度分析 ↓</div>
        </section>
      `;
      return;
    }

    // 骨架先渲染（不等天气，避免延迟感）
    const extrasById = {};
    matches.forEach(m => { extrasById[m.id] = computeTodayExtras(m); });
    host.innerHTML = `
      <section class="wc-today card">
        <div class="wc-today-head-bar">
          <div>
            <h2 class="wc-today-h2">最近比赛</h2>
            <p class="wc-today-sub">UTC+8 今天 + 明天 · 共 <strong>${matches.length}</strong> 场${matches.length > 1 ? ' · 向下滚动查看下一场' : ''}</p>
          </div>
          <div class="wc-today-dots" id="wcTodayDots">
            <span class="wc-today-dot-meta">1 / ${matches.length}</span>
          </div>
        </div>
        <div class="wc-today-strip" id="wcTodayStrip">
          ${matches.map((m, i) => buildTodayCard(m, extrasById[m.id], null, i === 0)).join('')}
        </div>
        <p class="wc-today-disclaimer">⚠️ 免责声明：本卡片仅为 AI 数据分析研究分享</p>
      </section>
    `;
    bindTodayPanelEvents();

    // 异步拉天气，逐一填回
    matches.forEach(async (m, idx) => {
      const w = await fetchWeather(m);
      if (!w) return;
      const card = host.querySelector(`.wc-today-card[data-match-id="${CSS.escape(m.id || '')}"] .wc-today-foot-row:last-child`);
      if (!card) return;
      // 找第二行最后一个 .wc-today-chip (天气那个) 替换
      const chips = card.querySelectorAll('.wc-today-chip');
      const target = chips[chips.length - 1];
      if (!target) return;
      target.outerHTML = `<span class="wc-today-chip"><span class="wc-today-chip-icon">${w.icon || '🌡️'}</span>${Math.round(w.tempC)}°C · ${escapeHtml(w.label)}${w.humidity != null ? ' · 湿度 ' + Math.round(w.humidity) + '%' : ''}</span>`;
    });
  }

  function bindTodayPanelEvents() {
    const strip = el('wcTodayStrip');
    if (!strip) return;
    // 点击卡片打开预测 modal
    strip.addEventListener('click', e => {
      const card = e.target.closest('.wc-today-card');
      if (!card) return;
      showMatchPredictionModal(card.dataset.home, card.dataset.away, card.dataset.matchId);
    });
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
    // 3.4.x 增强: 动态权重 (分歧大时偏向市场)
    // 理由: 市场聚合信息通常比单一模型准, 但模型可以捕捉市场没消化的新信息
    //   - 分歧小 (|model-market| < 1pp): 两源高度一致, 维持 w_model = 0.5
    //   - 分歧中 (1-5pp): 略偏市场, w_model = 0.50~0.55
    //   - 分歧大 (>5pp): 强偏市场, w_model = 0.55~0.70 (clamp 上限)
    //   - 任意情况 w_market = 1 - w_model
    const weightMap = {};
    candidateTeams.forEach(team => {
      const model = team.final_prob || 0;
      const market = marketMap[team.country];
      const edge = Math.abs(model - market);
      // 公式: w_model = 0.5 + edge * 4, 范围 [0.5, 0.7] (edge > 5pp 时上限 0.7)
      const wModel = Math.max(0.5, Math.min(0.7, 0.5 + edge * 4));
      weightMap[team.country] = wModel;
    });
    const rawFusion = {};
    candidateTeams.forEach(team => {
      const model = team.final_prob || 0;
      const market = marketMap[team.country];
      const wModel = weightMap[team.country];
      rawFusion[team.country] = wModel * model + (1 - wModel) * market;
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
      // 该队实际权重 (动态计算)
      const wModel = weightMap[team.country] || 0.5;
      const wMarket = 1 - wModel;
      return `
        <div class="wc-market-row has-fused">
          <span class="wc-rank ${idx < 3 ? 'top' : ''}" title="按融合概率排名">#${rank}</span>
          <span class="wc-code">${code(team.country)}</span>
          <span class="wc-team-name">${escapeHtml(countryName(team.country))}</span>
          <div class="wc-market-bars is-triple" title="上：上游模型 / 中：Polymarket / 下：双源融合 · 实际权重 模型 ${(wModel * 100).toFixed(0)}% / 市场 ${(wMarket * 100).toFixed(0)}%">
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
    // 3.4.x 增强: 引入 Conformal CI 半宽做风控
    //   - ciHalfWidth > 10pp 标 "⚠️ 信心不足", 跟 edge 共同决定推荐
    //   - Kelly 仓位按 ciHalfWidth 折扣: 越宽 → 越保守 (CI 半宽 0% 时 ×1, 20% 时 ×0)
    const valuePicks = candidateTeams
      .filter(team => (fusedMap[team.country] || 0) - marketMap[team.country] > 0.01)
      .map(team => {
        const market = marketMap[team.country];
        const fused = fusedMap[team.country];
        const model = team.final_prob || 0;
        const edge = OddsUtils.ev.edge(fused, market);
        const ev = OddsUtils.ev.expectedValue(1 / market, fused);
        const kelly25Raw = OddsUtils.kelly.fractionalKelly(1 / market, fused, 0.25);
        // CI 半宽: conformal_ci_high - conformal_ci_low (enrich 时已算到 team 对象上)
        const ciLo = team.conformal_ci_low;
        const ciHi = team.conformal_ci_high;
        const ciHalfWidth = (ciLo != null && ciHi != null) ? Math.max(0, (ciHi - ciLo) / 2) : null;
        // CI 半宽 0 → 折扣 1 (不动), 0.2 → 折扣 0 (不下注)
        const ciDiscount = ciHalfWidth != null ? Math.max(0, 1 - ciHalfWidth / 0.2) : 1;
        const kelly25 = kelly25Raw * ciDiscount;
        // 信心不足: ciHalfWidth > 0.10 (10pp)
        const lowConfidence = ciHalfWidth != null && ciHalfWidth > 0.10;
        return { team, edge, ev, kelly25, kelly25Raw, ciHalfWidth, ciDiscount, lowConfidence, market, fused, model };
      })
      .sort((a, b) => {
        // 先按 edge * fused 排 (基础信号), 信心不足的降权
        const aScore = a.edge * a.fused * (a.lowConfidence ? 0.5 : 1);
        const bScore = b.edge * b.fused * (b.lowConfidence ? 0.5 : 1);
        return bScore - aScore;
      })
      .slice(0, 3);

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>冠军概率</h2>
            <p class="wc-desc">上游模型 + Polymarket 冠军 outright 市场按权重加权后归一化。
              <br><small>⚙️ <b>动态权重</b>：每队按 <code>|模型 - 市场|</code> 分歧度计算实际权重
              （分歧小 50:50，分歧大 70:30 偏市场）。鼠标悬停每行查看该队实际权重。</small></p>
          </div>
        </div>
        <div class="wc-value-grid">
          ${valuePicks.map(({ team, edge, ev, kelly25, kelly25Raw, ciHalfWidth, ciDiscount, lowConfidence, market, fused, model }) => {
            const ciBadge = ciHalfWidth != null
              ? `<span class="wc-value-ci" title="Conformal 90% 置信区间半宽 ${(ciHalfWidth * 100).toFixed(1)}pp${ciDiscount < 1 ? `, Kelly 折扣 ×${ciDiscount.toFixed(2)}` : ''}">${lowConfidence ? '⚠️ ' : ''}CI±${(ciHalfWidth * 100).toFixed(1)}pp</span>`
              : '';
            return `
            <div class="wc-value-card${lowConfidence ? ' is-low-conf' : ''}">
              <span>${code(team.country)} ${escapeHtml(countryName(team.country))} ${ciBadge}</span>
              <strong class="${clsByShift(edge)}">${signedPct(edge, 1)}</strong>
              <small>模型 ${pct(model, 1)} · 市场 ${pct(market, 1)} · 融合 <b>${pct(fused, 1)}</b></small>
              <small>EV ${signedPct(ev, 1)} · Kelly¼ 仓位 ${(kelly25 * 100).toFixed(1)}% 资金${ciDiscount < 1 ? ` <span class="wc-value-discount" title="原始 ${(kelly25Raw * 100).toFixed(1)}%, CI 折扣后">(${ciDiscount.toFixed(2)}×)</span>` : ''}</small>
            </div>
            `;
          }).join('') || '<div class="empty-state">当前没有超过 1% 的正向偏离。</div>'}
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

  // ============================================================
  // Kimi 2026 Benchmarks 集成钩子
  // 优先用 PDF 校准表 (Table B.1) + 主场调整 (65 Elo pts)
  // 没加载到 benchmarks 时回退原启发式
  // ============================================================
  function bench() {
    const f = (window.KimiBenchmarks && window.KimiBenchmarks.flags) || { enabled: true };
    if (!f.enabled) return null;
    return window._kimiBenchCache || null;
  }

  function h2hCalc(teamA, teamB, opts) {
    opts = opts || {};
    const eloA = teamA.mod_elo || teamA.elo || 1700;
    const eloB = teamB.mod_elo || teamB.elo || 1700;
    // 主场优势调整 (Kimi Table D.2: 65 Elo pts)
    const b = bench();
    const useKimiElo = b && window.KimiBenchmarks.flags.useKimiEloTable;
    const homeAdv = (b && window.KimiBenchmarks.flags.useKimiMCParams) ? window.KimiBenchmarks.homeAdvantageElo(b) : 65;
    const isHome = opts.home != null ? opts.home : null;
    let effectiveA = eloA, effectiveB = eloB;
    if (isHome === 'A') effectiveA += homeAdv;
    else if (isHome === 'B') effectiveB += homeAdv;
    const diff = effectiveA - effectiveB;

    // 海拔调整 (Mexico City Azteca 2240m → 1.20x)
    let altMulA = 1.0, altMulB = 1.0;
    if (b && opts.venue) {
      const mul = window.KimiBenchmarks.altitudeMultiplier(b, opts.venue);
      if (/mexico|azteca/i.test(opts.venue || '')) {
        // 主队获得 multiplier 加成 (按主队对位)
        if (isHome === 'A') altMulA = mul;
        else if (isHome === 'B') altMulB = mul;
      }
    }

    // 高温惩罚 (WBGT 简化为 0/1 触发, 默认无)
    const heat = (b && opts.wbgt != null) ? window.KimiBenchmarks.heatPenalty(b, opts.wbgt) : 1.0;
    // 把热衰减转化为 lambda 倍率 (后传给 scorePredictions)

    // Elo 差 → 胜率: 优先用 PDF Table B.1 校准, fallback 用 logistic
    const winA = useKimiElo
      ? window.KimiBenchmarks.eloWinProbability(b, diff)
      : 1 / (1 + Math.pow(10, -diff / 400));
    // 平局校准: 同样优先用 PDF Table B.1
    const draw = useKimiElo
      ? window.KimiBenchmarks.eloDrawProbability(b, diff)
      : Math.max(0.10, Math.min(0.35, 0.30 - Math.abs(diff) / 1500));
    const winTotal = 1 - draw;
    const rawA = winA * winTotal + 0.03;
    const rawB = (1 - winA) * winTotal + 0.03;
    const rawTotal = rawA + rawB;
    let outWinA = rawA / rawTotal * winTotal;
    let outWinB = rawB / rawTotal * winTotal;
    let outDraw = draw;

    // 注意: h2h 单源不再单独走 calibrate 矩阵。
    // 历史原因: ensemblePredict 在 4 源加权融合后会再 calibrate 一次, h2h 这条路径
    // 会吃两次校准, 破坏 4 源公平性。统一交给 ensemble 后处理。
    return {
      winA: outWinA,
      winB: outWinB,
      draw: outDraw,
      diff,
      // 新增 context 字段 (供 Poisson / 校准使用)
      _altMulA: altMulA,
      _altMulB: altMulB,
      _heatMul: heat,
      _isHome: isHome,
      _homeAdv: homeAdv
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

  function scorePredictions(teamA, teamB, opts) {
    opts = opts || {};
    let lambdaA = 1.3 + ((teamA.mod_elo || teamA.elo || 1700) - 1700) / 500;
    let lambdaB = 1.3 + ((teamB.mod_elo || teamB.elo || 1700) - 1700) / 500;
    lambdaA = Math.max(0.3, Math.min(4, lambdaA * (1 + (teamA.shift || 0) * 3)));
    lambdaB = Math.max(0.3, Math.min(4, lambdaB * (1 + (teamB.shift || 0) * 3)));

    // Kimi 2026 增量: 海拔/主场/高温/主场优势 baseline 替换
    const b = bench();
    const useMCParams = b && window.KimiBenchmarks.flags.useKimiMCParams;
    if (b && useMCParams) {
      const pBase = window.KimiBenchmarks.poissonBase(b);
      // 主场优势 (Kimi: 65 Elo pts ≈ 1.18x lambda)
      const homeAdv = window.KimiBenchmarks.homeAdvantageElo(b);
      if (opts.home === 'A') {
        // 把 65 Elo 优势转成 lambda 倍率 (~0.13, 与 home 1.18 系数一致)
        lambdaA *= 1 + (homeAdv / 500);
      } else if (opts.home === 'B') {
        lambdaB *= 1 + (homeAdv / 500);
      }
      // 海拔 multiplier (Mexico City 1.20x)
      if (opts.venue && /mexico|azteca/i.test(opts.venue)) {
        const mul = window.KimiBenchmarks.altitudeMultiplier(b, opts.venue);
        if (opts.home === 'A') lambdaA *= mul;
        else if (opts.home === 'B') lambdaB *= mul;
      }
      // 高温惩罚
      if (opts.wbgt != null) {
        const heat = window.KimiBenchmarks.heatPenalty(b, opts.wbgt);
        lambdaA *= heat;
        lambdaB *= heat;
      }
    }

    // Poisson 矩阵 0..5: 算每个 (goalsA, goalsB) 概率, 排序
    const raw = [];
    for (let ga = 0; ga <= 5; ga++) {
      for (let gb = 0; gb <= 5; gb++) {
        const prob = poisson(ga, lambdaA) * poisson(gb, lambdaB);
        raw.push({ goalsA: ga, goalsB: gb, prob, total: ga + gb });
      }
    }
    const sorted = raw.slice().sort((a, b) => b.prob - a.prob);
    const featured = sorted[0] || { goalsA: 1, goalsB: 1, prob: 0 };

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

    // Kimi 2026 增量: 校准调整矩阵 (Table 9.13)
    // 0-5% 区间 +1.5pp (厚尾补偿), >25% -1.0pp (过自信修正)
    const b = bench();
    if (b && window.KimiBenchmarks.flags.useCalibrationMatrix) {
      final.home = window.KimiBenchmarks.calibrate(b, final.home);
      final.draw = window.KimiBenchmarks.calibrate(b, final.draw);
      final.away = window.KimiBenchmarks.calibrate(b, final.away);
      // 校准后再次归一化 (calibrate 单独改每个维度可能不再和为1)
      const sum2 = final.home + final.draw + final.away;
      if (sum2 > 0) {
        final.home /= sum2; final.draw /= sum2; final.away /= sum2;
      }
    }

    // 置信度：1 - 归一化熵，再按"源完整性"打折
    // 之前只用熵, 单源也可以很"自信", 但用户看不出 4 源齐不齐
    // 现在加一个 completenessFactor: 4 源齐 ×1, 1 源 ×0.5 (sqrt 缩放)
    const H = -Object.values(final).reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);
    const maxH = Math.log2(3);
    const entropyConfidence = maxH > 0 ? (1 - H / maxH) : 0;
    const TOTAL_SOURCES = 4;
    const sourceCount = parts.length;
    const completenessFactor = Math.sqrt(sourceCount / TOTAL_SOURCES);
    const confidence = entropyConfidence * completenessFactor;

    // 4 源一致性: 各源 home 概率的变异系数 (CV) 反推
    //   CV 小 → 各源接近 → agreement 高
    //   CV 大 → 各源打架 → agreement 低
    // 用于传给 Conformal 校正, 让 4 源一致时多保留 raw, 分歧大时多拉向均匀
    let ensembleAgreement = 0;
    if (sourceCount >= 2) {
      const homeProbs = parts.map(p => p.probs.home);
      const mean = homeProbs.reduce((s, x) => s + x, 0) / homeProbs.length;
      const variance = homeProbs.reduce((s, x) => s + (x - mean) ** 2, 0) / homeProbs.length;
      const std = Math.sqrt(variance);
      // mean 太小 (<0.01) 时 CV 容易爆, clamp 到 1.0 表示"完全不一致"
      const cv = mean > 0.01 ? std / mean : 1.0;
      ensembleAgreement = Math.max(0, Math.min(1, 1 - cv));
    }

    return {
      final,
      parts,
      confidence,
      sourceCount,
      totalSources: TOTAL_SOURCES,
      ensembleAgreement,
      // 4 源 home 概率, 调试 / 透明度用
      homeProbsBySource: Object.fromEntries(parts.map(p => [p.key, p.probs.home]))
    };
  }

  // Kimi 2026 增量: 拿某支强队的 ensemble 冠军概率基准
  // 用于"我们对 X 的预测 vs 20-model 共识" 偏差诊断
  function benchmarkChampionGap(country) {
    const b = bench();
    if (!b) return null;
    const ref = window.KimiBenchmarks.ensembleProb(b, country);
    if (ref == null) return null;
    return { ref, interval: window.KimiBenchmarks.championInterval(b, country) };
  }

  function renderEnsembleCard(ensemble, teamA, teamB) {
    const { final, parts, confidence, sourceCount, totalSources, ensembleAgreement } = ensemble;
    const homePct = (final.home * 100).toFixed(1);
    const drawPct = (final.draw * 100).toFixed(1);
    const awayPct = (final.away * 100).toFixed(1);

    // 推荐结果
    const rec = final.home >= final.draw && final.home >= final.away ? 'home'
              : final.away >= final.draw ? 'away' : 'draw';
    const recLabel = rec === 'home' ? `主胜` : rec === 'away' ? `客胜` : '平局';

    // 源完整性 badge
    // 4/4 = 完整, 3/4 = 部分 (一个源缺失), 2/4 = 弱 (只有 h2h+一个市场), 1/4 = 极弱
    const completeCls = sourceCount === totalSources ? 'is-complete' : (sourceCount >= 3 ? 'is-partial' : 'is-weak');
    const agreementPct = (ensembleAgreement * 100).toFixed(0);
    const agreementCls = ensembleAgreement >= 0.7 ? 'is-good' : (ensembleAgreement >= 0.4 ? 'is-mid' : 'is-bad');
    const completenessHint = sourceCount === totalSources
      ? '4 源齐'
      : `缺 ${totalSources - sourceCount} 源（已自动重分配权重）`;

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
      return `<div class="wc-ensemble-source">
        <div class="wc-ensemble-source-head">
          <span class="wc-ensemble-icon">${p.icon}</span>
          <span class="wc-ensemble-name">${escapeHtml(p.name)}</span>
          <span class="wc-ensemble-weight">${actualWeight.toFixed(0)}% 权重</span>
        </div>
        <div class="wc-ensemble-pct-grid">
          <span class="wc-ensemble-pct is-home" title="主胜 ${ph}%">主 ${ph}%</span>
          <span class="wc-ensemble-pct is-draw" title="平 ${pd}%">平 ${pd}%</span>
          <span class="wc-ensemble-pct is-away" title="客胜 ${pa}%">客 ${pa}%</span>
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
        <div class="wc-ensemble-meta">
          <span class="wc-ensemble-sources ${completeCls}" title="${escapeHtml(completenessHint)}">
            📡 ${sourceCount}/${totalSources} 源参与
          </span>
          <span class="wc-ensemble-agreement ${agreementCls}" title="4 源 home 概率的 1 - 变异系数 (CV)">
            🤝 源一致度 ${agreementPct}%
          </span>
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

    // Kimi 2026 增量: 从 scheduleMatch.venue 解析 context 传给 h2hCalc + scorePredictions
    const matchCtx = (window.KimiBenchmarks && window.KimiBenchmarks.buildMatchContext)
      ? window.KimiBenchmarks.buildMatchContext(scheduleMatch?.venue, 'A')
      : { home: 'A' };
    const result = h2hCalc(teamA, teamB, matchCtx);
    const scores = scorePredictions(teamA, teamB, matchCtx);
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
            //  - set_size=2: 向 0.5/0.5/0 收缩 (draw 给 0.15 floor, 避免压成 0)
            //  - set_size=3: 向 1/3/1/3/1/3 收缩
            //
            // v3.4.3 增强: 传 qhat + ensembleAgreement 让 conf 跟 4 源对齐
            //   - qhat: Elo 校准阈值, 反映校准集分散度
            //   - ensembleAgreement: 4 源 home 概率的一致度 (1 - CV)
            //   - drawFloor: 平局先验下限, 保护 draw 不被压成 0
            if (!state.h2hConformal || !window.WorldCupConformal) return '';
            const cp = state.h2hConformal[teamA.country]?.[teamB.country];
            if (!cp) return '';
            const ens = ensemblePredict(result, oddsMarket, polymarketEvent, llmPred);
            const raw = ens.final;  // {home, draw, away}
            // 注意: 第 5 参传对象, 启用 qhat + agreement 联动
            // cp.confidence 是 predictH2H 给的, 这里覆盖 (calibrateProbs 内部会用 ens.agreement 微调)
            const adj = window.WorldCupConformal.conformalCalibrateProbs(
              raw.home, raw.draw, raw.away, cp.prediction_set,
              {
                confidence: cp.confidence,
                qhat: cp._qhat,
                ensembleAgreement: ens.ensembleAgreement,
                drawFloor: 0.15
              }
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
            const conf = (adj.keep * 100).toFixed(0);  // 用实际 keep (可能跟 cp.confidence 不同)
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
                    <span class="wc-ensemble-rec-label">🛡 校准胜率</span>
                    <strong style="color:${setColor}">${setLbl}</strong>
                  </div>
                  <div class="wc-ensemble-conf">
                    <span class="wc-ensemble-rec-label">🎯 校准置信度</span>
                    <strong style="color:${setColor}">${conf}%</strong>
                  </div>
                </div>
                <div class="cp-raw-compare">
                  <span>4 维融合: 主 ${rawPh}% / 平 ${rawPd}% / 客 ${rawPa}%</span>
                  <span class="cp-arrow">→</span>
                  <span>校准后: 主 ${ph}% / 平 ${pd}% / 客 ${pa}%</span>
                </div>
                <div class="wc-expected-grid">
                  <div class="wc-expected-card is-home" title="校准后主胜概率">
                    <span class="wc-expected-team">${escapeHtml(countryName(teamA.country))} 胜</span>
                    <span class="wc-expected-pct">${ph}%</span>
                  </div>
                  <div class="wc-expected-card is-draw" title="校准后平局概率">
                    <span class="wc-expected-team">平局</span>
                    <span class="wc-expected-pct">${pd}%</span>
                  </div>
                  <div class="wc-expected-card is-away" title="校准后客胜概率">
                    <span class="wc-expected-team">${escapeHtml(countryName(teamB.country))} 胜</span>
                    <span class="wc-expected-pct">${pa}%</span>
                  </div>
                </div>
                <div class="cp-delta-row">
                  <span>主 ${fmtDelta(dHome)}</span>
                  <span>平 ${fmtDelta(dDraw)}</span>
                  <span>客 ${fmtDelta(dAway)}</span>
                </div>
                <p class="cp-calibrate-note">
                  基于 Split Conformal Prediction（2006-2022 世界杯 95 场校准，约 90% 覆盖率）。
                  校正 = 4 维融合 ${conf}% + 集内均匀分布 ${100 - Math.round(adj.keep * 100)}% 线性混合（Conformal 置信度 ${conf}%${
                    ens.ensembleAgreement != null
                      ? `，4 源一致度 ${(ens.ensembleAgreement * 100).toFixed(0)}%${ens.ensembleAgreement >= 0.7 ? '（上调）' : ens.ensembleAgreement < 0.4 ? '（下调）' : ''}`
                      : ''
                  }）。
                  set_size=${size} 给出 ${size} 种可能结果（${cp.prediction_set.join('/')}），
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
