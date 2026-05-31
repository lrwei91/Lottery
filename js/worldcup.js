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
    selectedA: '',
    selectedB: '',
    selectedSquad: '',
    selectedGroup: 'ALL',
    countdownTimerId: null
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
    Italy: 'IT',
    Belgium: 'BE',
    Croatia: 'HR',
    Switzerland: 'CH',
    Austria: 'AT',
    Poland: 'PL',
    Ukraine: 'UA',
    Romania: 'RO',
    'Czech Republic': 'CZ',
    Turkey: 'TR',
    Serbia: 'RS',
    Sweden: 'SE',
    Morocco: 'MA',
    Senegal: 'SN',
    Egypt: 'EG',
    Cameroon: 'CM',
    Nigeria: 'NG',
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
    'Costa Rica': 'CR',
    Honduras: 'HN',
    Jamaica: 'JM',
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
    'DR Congo': 'CD'
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
    'Italy': '🇮🇹',
    'Belgium': '🇧🇪',
    'Croatia': '🇭🇷',
    'Switzerland': '🇨🇭',
    'Austria': '🇦🇹',
    'Poland': '🇵🇱',
    'Ukraine': '🇺🇦',
    'Romania': '🇷🇴',
    'Czech Republic': '🇨🇿',
    'Turkey': '🇹🇷',
    'Serbia': '🇷🇸',
    'Sweden': '🇸🇪',
    'Morocco': '🇲🇦',
    'Senegal': '🇸🇳',
    'Egypt': '🇪🇬',
    'Cameroon': '🇨🇲',
    'Nigeria': '🇳🇬',
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
    'Costa Rica': '🇨🇷',
    'Honduras': '🇭🇳',
    'Jamaica': '🇯🇲',
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
    'DR Congo': '🇨🇩'
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

  function translateText(text) {
    if (!text) return '';
    let result = text;
    for (const en of Object.keys(COUNTRY_CN)) {
      result = result.split(en).join(countryName(en));
    }
    return result;
  }

  const H2H_RECORDS = {
    'Argentina|Brazil': { wA: 41, d: 26, wB: 47, t: 114, note: '南美经典对决，巴西总体占优。' },
    'Argentina|France': { wA: 5, d: 3, wB: 4, t: 12, note: '2022 决赛重演，阿根廷点球险胜。' },
    'Brazil|France': { wA: 6, d: 4, wB: 8, t: 18, note: '两队在淘汰赛阶段多次制造关键转折。' },
    'France|Germany': { wA: 13, d: 4, wB: 14, t: 31, note: '欧洲强强对话，大赛多次相遇。' },
    'England|Germany': { wA: 13, d: 5, wB: 14, t: 32, note: '经典大战，点球记忆影响心理预期。' },
    'England|France': { wA: 7, d: 7, wB: 17, t: 31, note: '法国近期大赛占优。' },
    'Germany|Spain': { wA: 8, d: 6, wB: 11, t: 25, note: '传控与整体执行的代表性对抗。' },
    'Portugal|Spain': { wA: 18, d: 8, wB: 11, t: 37, note: '伊比利亚德比，风格反差明显。' },
    'Brazil|Germany': { wA: 9, d: 5, wB: 9, t: 23, note: '2014 半决赛 1-7 是重要心理样本。' },
    'Argentina|Germany': { wA: 8, d: 4, wB: 8, t: 20, note: '世界杯决赛级别的经典对抗。' },
    'Croatia|England': { wA: 2, d: 3, wB: 3, t: 8, note: '2018 世界杯半决赛克罗地亚加时胜。' },
    'Uruguay|Brazil': { wA: 31, d: 18, wB: 27, t: 76, note: '南美高强度对决之一。' },
    'Netherlands|Germany': { wA: 14, d: 15, wB: 16, t: 45, note: '欧洲老牌劲旅长期拉锯。' },
    'Italy|Germany': { wA: 15, d: 13, wB: 9, t: 37, note: '历史淘汰赛样本丰富。' },
    'Spain|France': { wA: 16, d: 7, wB: 13, t: 36, note: '技术流与冲击力的直接比较。' },
    'Belgium|France': { wA: 5, d: 4, wB: 9, t: 18, note: '法国近期杯赛表现更稳定。' },
    'England|Brazil': { wA: 9, d: 5, wB: 13, t: 27, note: '英巴对抗常体现节奏控制差异。' },
    'Portugal|Argentina': { wA: 2, d: 1, wB: 4, t: 7, note: '样本较少，但关注度很高。' }
  };

  const H2H_TACTICAL = {
    'Brazil|France': '桑巴前场创造力 vs 法式纵深推进。',
    'Argentina|France': '潘帕斯控制与反击效率 vs 欧洲铁军冲击。',
    'Argentina|Brazil': '南美双雄，个人灵感与整体压迫同时在线。',
    'France|Germany': '个人爆点 vs 整体执行。',
    'England|Germany': '边路传中与定位球 vs 中路组织和纪律。',
    'Portugal|Spain': '转换速度 vs 控球压制。',
    'Brazil|Germany': '进攻艺术 vs 纪律铁军。'
  };

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
    Italy: { price: 0.003 },
    Australia: { price: 0.002 },
    Nigeria: { price: 0.002 },
    'Ivory Coast': { price: 0.002 },
    Algeria: { price: 0.002 },
    Serbia: { price: 0.002 },
    Poland: { price: 0.001 },
    Ukraine: { price: 0.001 },
    Cameroon: { price: 0.001 },
    Egypt: { price: 0.001 },
    Paraguay: { price: 0.001 },
    Qatar: { price: 0.001 },
    Romania: { price: 0.001 },
    'Saudi Arabia': { price: 0.001 },
    Tunisia: { price: 0.001 },
    Uzbekistan: { price: 0.001 },
    'Czech Republic': { price: 0.001 }
  };

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

  function sortedTeams() {
    return state.teams.slice().sort((a, b) => (b.final_prob || 0) - (a.final_prob || 0));
  }

  function findTeam(country) {
    return state.teams.find(team => team.country === country);
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
      state.teams = Array.isArray(payload.teams) ? payload.teams : [];
      state.ucl = payload.ucl || {};
      const teams = sortedTeams();
      state.selectedA = teams[0]?.country || '';
      state.selectedB = teams[1]?.country || '';
      state.selectedSquad = teams[0]?.country || '';
      state.loaded = true;
      render();
    } catch (error) {
      console.error('World Cup data load failed:', error);
      if (root) {
        root.innerHTML = '<div class="card"><div class="error-state">世界杯预测数据加载失败，请稍后重试。</div></div>';
      }
    } finally {
      state.loading = false;
    }
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
            <p>整合 Elo 修正冠军概率、玄学因子、H2H 胜平负与 Poisson 比分矩阵，面向赛前推演和概率对照。</p>
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
        <button class="wc-tab" data-wc-tab="market">市场博弈</button>
        <button class="wc-tab" data-wc-tab="info">模型说明</button>
      </div>

      <div class="wc-panel active" id="wcPanelMatches">${renderMatchPanel()}</div>
      <div class="wc-panel" id="wcPanelChampion">${renderChampionPanel()}</div>
      <div class="wc-panel" id="wcPanelFactor">${renderFactorPanel()}</div>
      <div class="wc-panel" id="wcPanelMystic">${renderMysticPanel()}</div>
      <div class="wc-panel" id="wcPanelSquad">${renderSquadPanel()}</div>
      <div class="wc-panel" id="wcPanelMarket">${renderMarketPanel()}</div>
      <div class="wc-panel" id="wcPanelInfo">${renderInfoPanel()}</div>
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

      let scoreHtml;
      if (isCompleted && match.homeScore != null) {
        scoreHtml = '<div class="wc-match-score-badge">' + match.homeScore + ' - ' + match.awayScore + '</div>';
      } else {
        scoreHtml = '<div class="wc-match-vs-badge">VS</div>';
      }

      const timeInfo = (() => {
        try {
          // Input time is in UTC (Z) timezone from the official ICS file
          const d = new Date(match.date + 'T' + match.time + ':00Z');
          
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
            time: hour + ':' + minute,
            day: weekday
          };
        } catch (e) {
          console.error("Time zone conversion failed:", e);
          return {
            date: match.date.slice(5),
            time: match.time,
            day: ''
          };
        }
      })();

      // Beautiful SVG Stadium Icon
      const stadiumIconSvg = '<svg class="wc-venue-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="10"/>' +
        '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' +
        '<path d="M2 12h20"/>' +
        '</svg>';

      return '<div class="wc-match-card is-clickable" data-home="' + match.home + '" data-away="' + match.away + '" title="点击查看对战预测分析">' +
        '<div class="wc-match-header">' +
          '<div class="wc-match-time-badge">' +
            '<span class="wc-match-date">' + timeInfo.date + '</span>' +
            '<span class="wc-match-day">' + timeInfo.day + '</span>' +
            '<span class="wc-match-time">' + timeInfo.time + '</span>' +
          '</div>' +
          (isScheduled ? '<span class="wc-match-status is-scheduled">未开始</span>' : '') +
          (isCompleted && match.homeScore != null ? '<span class="wc-match-status is-final">已结束</span>' : '') +
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

      return '<details class="wc-match-group' + hiddenClass + '"' + isOpen + ' data-group="' + label + '">' +
        '<summary>' +
          '<span class="wc-group-badge">' + label + ' 组</span>' +
          '<span class="wc-group-teams">' + teams.map(t => escapeHtml(countryName(t))).join(' · ') + '</span>' +
        '</summary>' +
        '<div class="wc-match-grid">' +
          matches.map(matchRow).join('') +
        '</div>' +
      '</details>';
    }

    const groupTabsHtml = '<div class="wc-group-selector" id="wcGroupSelector">' +
      '<button class="wc-group-tab active" data-group="ALL">全部小组</button>' +
      groupLabels.map(label => '<button class="wc-group-tab" data-group="' + label + '">' + label + ' 组</button>').join('') +
      '</div>';

    return '<div class="card">' +
      '<div class="card-header wc-matches-header">' +
        '<div>' +
          '<h2>2026 世界杯 · 小组赛赛程</h2>' +
          '<p class="wc-desc">数据每日更新，展示各小组实时对战安排。共 12 组 72 场小组赛。</p>' +
        '</div>' +
        (lastUpdated ? '<span class="wc-update-badge">' + lastUpdated + '</span>' : '') +
      '</div>' +
      groupTabsHtml +
      '<div class="wc-match-board">' +
        groupLabels.map(groupBlock).join('') +
      '</div>' +
    '</div>';
  }

  function renderChampionPanel() {
    const rows = sortedTeams().map((team, index) => {
      const probability = (team.final_prob || 0) * 100;
      return `
        <div class="wc-board-row">
          <div class="wc-rank ${index < 3 ? `is-top-${index + 1}` : ''}">${index + 1}</div>
          <div class="wc-code">${code(team.country)}</div>
          <div class="wc-team-main">
            <div class="wc-team-name">${escapeHtml(countryName(team.country))}</div>
            <div class="wc-team-sub">Elo ${(team.elo || 0).toFixed(0)} · 修正 Elo ${(team.mod_elo || team.elo || 0).toFixed(0)}</div>
            <div class="wc-progress"><span style="width:${Math.min(100, probability * 4).toFixed(1)}%"></span></div>
          </div>
          <div class="wc-prob">
            <strong>${probability.toFixed(2)}%</strong>
            <span class="${clsByShift(team.shift)}">${signedPct(team.shift)}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>冠军概率排行榜</h2>
            <p class="wc-desc">上游模型将 Elo、年龄结构、大赛经验、近期状态、教练因素和玄学偏移合成为最终概率。</p>
          </div>
        </div>
        <div class="wc-board">${rows}</div>
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

      return `
        <details class="wc-detail-row">
          <summary>
            <span class="wc-code">${code(team.country)}</span>
            <span class="wc-team-name">${escapeHtml(countryName(team.country))}</span>
            <strong>${pct(team.final_prob, 1)}</strong>
          </summary>
          <div class="wc-factor-list">${bars}</div>
          <p class="wc-narrative">${escapeHtml(team.narrative || '暂无补充叙述')}</p>
        </details>
      `;
    }).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>因子拆解</h2>
            <p class="wc-desc">各队因子的相对强弱按源模型输出展示。负向值保留为红色，表示该维度对最终判断形成压制。</p>
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

  function renderH2hPanel() {
    const options = sortedTeams().map(team => (
      `<option value="${escapeHtml(team.country)}">${code(team.country)} ${escapeHtml(countryName(team.country))} · ${pct(team.final_prob, 1)}</option>`
    )).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>H2H 对战预测</h2>
            <p class="wc-desc">使用修正 Elo 计算胜平负，再通过 Poisson xG 生成比分概率矩阵。</p>
          </div>
        </div>
        <div class="wc-h2h-controls">
          <label>球队 A<select id="wcTeamA">${options}</select></label>
          <div class="wc-vs">VS</div>
          <label>球队 B<select id="wcTeamB">${options}</select></label>
        </div>
        <div class="wc-h2h-result" id="wcH2hResult"></div>
      </div>
    `;
  }

  function renderSquadPanel() {
    const options = sortedTeams().map(team => (
      `<option value="${escapeHtml(team.country)}">${code(team.country)} ${escapeHtml(countryName(team.country))} · ${pct(team.final_prob, 1)}</option>`
    )).join('');

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>球队阵容</h2>
            <p class="wc-desc">上游数据来自 Wikipedia 处理结果；无完整名单的球队使用源模型的样本阵容。</p>
          </div>
          <select class="wc-select" id="wcSquadSelect">${options}</select>
        </div>
        <div id="wcSquadContent"></div>
      </div>
    `;
  }

  function renderMarketPanel() {
    const rows = sortedTeams()
      .filter(team => POLY_WINNER[team.country])
      .map(team => {
        const market = POLY_WINNER[team.country].price;
        const model = team.final_prob || 0;
        const diff = model - market;
        const max = Math.max(model, market, 0.001);
        return `
          <div class="wc-market-row">
            <span class="wc-code">${code(team.country)}</span>
            <span class="wc-team-name">${escapeHtml(countryName(team.country))}</span>
            <div class="wc-market-bars">
              <span style="width:${(model / max * 100).toFixed(0)}%"></span>
              <i style="width:${(market / max * 100).toFixed(0)}%"></i>
            </div>
            <span>${pct(model, 1)} / ${pct(market, 1)}</span>
            <strong class="${clsByShift(diff)}">${signedPct(diff, 1)}</strong>
          </div>
        `;
      }).join('');

    const valuePicks = sortedTeams()
      .filter(team => POLY_WINNER[team.country] && team.final_prob - POLY_WINNER[team.country].price > 0.01)
      .sort((a, b) => ((b.final_prob - POLY_WINNER[b.country].price) * b.final_prob) - ((a.final_prob - POLY_WINNER[a.country].price) * a.final_prob))
      .slice(0, 3);

    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>市场博弈</h2>
            <p class="wc-desc">对比模型概率与源项目内置的 Polymarket 冠军价格。蓝色为模型，黄色为市场。</p>
          </div>
        </div>
        <div class="wc-value-grid">
          ${valuePicks.map(team => `
            <div class="wc-value-card">
              <span>${code(team.country)} ${escapeHtml(countryName(team.country))}</span>
              <strong>${signedPct(team.final_prob - POLY_WINNER[team.country].price, 1)}</strong>
              <small>模型 ${pct(team.final_prob, 1)} · 市场 ${pct(POLY_WINNER[team.country].price, 1)}</small>
            </div>
          `).join('') || '<div class="empty-state">当前没有超过 1% 的正向偏离。</div>'}
        </div>
        <div class="wc-market-list">${rows}</div>
      </div>
    `;
  }

  function renderInfoPanel() {
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>模型说明</h2>
            <p class="wc-desc">迁移自 mikobinbin/2026-world-cup-predictor，已适配 Lottery 的静态文件结构。</p>
          </div>
        </div>
        <div class="wc-info-grid">
          <div class="wc-info-block">
            <h3>数据来源</h3>
            <p>Wikipedia 球员名单、FiveThirtyEight Elo 缓存、源项目手工校准参数。</p>
          </div>
          <div class="wc-info-block">
            <h3>冠军概率</h3>
            <p>使用修正 Elo、年龄结构、大赛经验、近期状态、教练因素和 Monte Carlo/Logistic 混合校准输出。</p>
          </div>
          <div class="wc-info-block">
            <h3>对战预测</h3>
            <p>胜平负基于修正 Elo 差值，比分矩阵基于 Poisson xG，并保留大比分尾部增强逻辑。</p>
          </div>
          <div class="wc-info-block">
            <h3>静态迁移</h3>
            <p>Python 模型输出已固化为 <code>data/worldcup_2026.json</code>，前端不依赖 Streamlit、Gradio 或 Python 服务。</p>
          </div>
        </div>
        <div class="wc-source-line">
          <span>源仓库：<a href="${escapeHtml(state.metadata?.sourceRepo || '#')}" target="_blank" rel="noopener">2026-world-cup-predictor</a></span>
          <span>源提交：${escapeHtml(state.metadata?.sourceCommit || '--')}</span>
          <span>生成时间：${formatDateTime(state.metadata?.generatedAt)}</span>
        </div>
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
          const label = details.dataset.group;
          const isVisible = (group === 'ALL' || label === group);
          details.classList.toggle('is-hidden', !isVisible);
          if (group !== 'ALL' && label === group) {
            details.setAttribute('open', '');
          } else if (group === 'ALL') {
            details.setAttribute('open', '');
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
        showMatchPredictionModal(home, away);
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

  function showMatchPredictionModal(home, away) {
    const teamA = findTeam(home);
    const teamB = findTeam(away);

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
    const recKey = `${teamA.country}|${teamB.country}`;
    const recKeyRev = `${teamB.country}|${teamA.country}`;
    const record = H2H_RECORDS[recKey] || H2H_RECORDS[recKeyRev];
    const isReversed = !!H2H_RECORDS[recKeyRev] && !H2H_RECORDS[recKey];
    const tactic = H2H_TACTICAL[recKey] || H2H_TACTICAL[recKeyRev];

    // Remove existing modal if any
    const existing = el('wcH2hModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'modal-overlay wc-h2h-modal-overlay';
    modal.id = 'wcH2hModal';
    modal.style.display = 'flex';

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
          <div class="wc-modal-prediction-title">
            <h3>H2H 对战智能预测</h3>
            <p>基于双方 Elo 实力差、玄学偏移、大比分修正模型及 Poisson 分布模拟计算所得。</p>
          </div>
          <div class="wc-winbar">
            <span style="width:${aPct.toFixed(1)}%">${aPct.toFixed(1)}%</span>
            <i style="width:${dPct.toFixed(1)}%">${dPct.toFixed(1)}%</i>
            <b style="width:${bPct.toFixed(1)}%">${bPct.toFixed(1)}%</b>
          </div>
          <div class="wc-h2h-metrics">
            <div><span>${code(teamA.country)} 胜</span><strong>${aPct.toFixed(1)}%</strong></div>
            <div><span>平局</span><strong>${dPct.toFixed(1)}%</strong></div>
            <div><span>${code(teamB.country)} 胜</span><strong>${bPct.toFixed(1)}%</strong></div>
          </div>
          <div class="wc-score-card">
            <div class="wc-expected">
              <span>${escapeHtml(countryName(teamA.country))} xG <strong>${scores.lambdaA.toFixed(2)}</strong></span>
              <span>精选比分 <strong>${scores.featured.goalsA}-${scores.featured.goalsB}</strong></span>
              <span>${escapeHtml(countryName(teamB.country))} xG <strong>${scores.lambdaB.toFixed(2)}</strong></span>
            </div>
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
              <h3>交锋历史与风格</h3>
              ${record ? `
                <div class="wc-record">
                  <div><strong>${isReversed ? record.wB : record.wA}</strong><span>${code(teamA.country)} 胜</span></div>
                  <div><strong>${record.d}</strong><span>平</span></div>
                  <div><strong>${isReversed ? record.wA : record.wB}</strong><span>${code(teamB.country)} 胜</span></div>
                </div>
                <p>${escapeHtml(record.note)} <span>${record.t} 场样本</span></p>
              ` : '<p>暂无内置历史交锋样本。</p>'}
              ${tactic ? `<p style="margin-top: 8px;"><strong>战术风格：</strong>${escapeHtml(tactic)}</p>` : ''}
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
        <strong>${pct(team.final_prob, 2)}</strong>
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
                  <td><span class="wc-pos">${escapeHtml(player.position || '--')}</span></td>
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
