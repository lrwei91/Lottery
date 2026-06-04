/**
 * 超级大乐透 - 主应用逻辑
 * 负责数据加载、页面渲染、交互逻辑
 */

;(function() {
  'use strict';

  // ==================== 应用状态 ====================
  const state = {
    currentLottery: '', // 'dlt' (超级大乐透), 'pl3' (排列三) 或 'worldcup' (世界杯)
    data: [],           // 所有开奖数据
    total: 0,           // 数据总量
    updateTime: '',     // 最后更新时间
    currentSection: 'home',
    historyPage: 1,
    historyPageSize: 20,
    searchKeyword: '',
    yearFilter: '',
    filteredData: [],
    selectedTrendNumbers: [1, 5, 10],
    predictions: [],
    predictionRecords: [],
    strategyEvolution: null,
    countdownTimerId: null
  };

  const PREDICTION_HISTORY_LIMIT = 20;
  const PREDICTION_HISTORY_VISIBLE_LIMIT = 3;
  const LOTTERY_SECTION_NAMES = ['home', 'history', 'stats', 'predict'];

  const LOTTERY_CONFIG = {
    dlt: {
      label: '超级大乐透',
      logo: ['乐', '透'],
      subtitle: '数据分析与智能预测',
      filepath: 'data/lottery_data.json',
      drawLabel: '最新开奖结果',
      frontLabel: '前区',
      backLabel: '后区',
      historyFrontHeader: '前区号码',
      historyBackHeader: '后区号码',
      rulesNote: '超级大乐透中奖条件及奖金对照表',
      statsLabels: ['最热前区号码', '最冷前区号码', '最热后区号码', '最冷后区号码'],
      selectedTrendNumbers: [1, 5, 10],
      checkerPlaceholder: '输入格式示例：\n09 10 20 33 35 + 04 11\n02 06 14 22 24 + 08 11',
      checkerHelp: '请输入您的号码组合，支持核对多组（每组一行）。可以直接粘贴“一键复制”的内容：'
    },
    pl3: {
      label: '排列三',
      logo: ['排', '三'],
      subtitle: '位置概率分析与智能预测',
      filepath: 'data/pl3_data.json',
      drawLabel: '最新开奖结果',
      frontLabel: '开奖号码',
      backLabel: '',
      // PL3 没有后区，renderHistory 通过 colspan 隐藏后区列头，因此这里不再单独定义 historyBackHeader
      historyFrontHeader: '开奖号码',
      rulesNote: '排列三直选、组三、组六中奖条件及奖金对照表',
      statsLabels: ['最热中奖号码', '最冷中奖号码', '最热后区号码', '最冷后区号码'],
      selectedTrendNumbers: [1, 3, 5],
      checkerPlaceholder: '输入格式示例：\n5 4 4\n4 6 6\n039',
      checkerHelp: '请输入您的排列三号码，支持核对多组（每组一行），每组 3 位数字。'
    },
    worldcup: {
      label: '2026 世界杯',
      logo: ['世', '杯'],
      subtitle: '冠军概率与对战预测',
      updateTime: '数据日期 2026-05-30'
    }
  };

  const STRATEGY_LABELS = {
    cold: '冷号优先',
    hot: '热号优先',
    balanced: '均衡推荐',
    gap: '遗漏回补',
    random: '布林线策略' // 策略 key 沿用 'random'（与 predictor.js / localStorage 兼容），展示用 "布林线策略"
  };

  // ==================== 工具函数 ====================
  function getLotteryConfig(type = state.currentLottery) {
    return LOTTERY_CONFIG[type] || LOTTERY_CONFIG.dlt;
  }

  function isPL3() {
    return state.currentLottery === 'pl3';
  }

  function isWorldCup() {
    return state.currentLottery === 'worldcup';
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function copyToClipboard(text, onSuccess) {
    const doCallback = () => { if (onSuccess) onSuccess(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(doCallback).catch(err => {
        console.warn('Navigator clipboard failed, trying fallback:', err);
        fallbackCopy(text, doCallback);
      });
    } else {
      fallbackCopy(text, doCallback);
    }
  }

  function showToast(message, duration = 2000) {
    let toast = document.getElementById('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 20px;background:var(--bg-tertiary);color:var(--accent);border:1px solid var(--accent);border-radius:var(--radius-md);font-size:0.85rem;opacity:0;transition:opacity 0.3s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, duration);
  }
  function formatMoney(num) {
    if (!num) return '--';
    if (num >= 100000000) return (num / 100000000).toFixed(2) + ' 亿元';
    if (num >= 10000) return (num / 10000).toFixed(0) + ' 万元';
    return num.toLocaleString() + ' 元';
  }

  function padNum(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function getPredictionStorageKey(type = state.currentLottery) {
    return `ticai_prediction_records_v1_${type}`;
  }

  function getEvolutionStorageKey(type = state.currentLottery) {
    return `ticai_strategy_evolution_v1_${type}`;
  }

  function loadPredictionRecords() {
    try {
      const raw = localStorage.getItem(getPredictionStorageKey());
      const parsed = raw ? JSON.parse(raw) : [];
      state.predictionRecords = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('预测记录读取失败:', error);
      state.predictionRecords = [];
    }
  }

  function persistPredictionRecords() {
    try {
      localStorage.setItem(
        getPredictionStorageKey(),
        JSON.stringify(state.predictionRecords.slice(0, PREDICTION_HISTORY_LIMIT))
      );
    } catch (error) {
      console.warn('预测记录保存失败:', error);
    }
  }

  function loadStrategyEvolution() {
    try {
      const raw = localStorage.getItem(getEvolutionStorageKey());
      state.strategyEvolution = raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn('策略进化读取失败:', error);
      state.strategyEvolution = null;
    }
  }

  function persistStrategyEvolution(evolution) {
    state.strategyEvolution = evolution;
    try {
      localStorage.setItem(getEvolutionStorageKey(), JSON.stringify(evolution));
    } catch (error) {
      console.warn('策略进化保存失败:', error);
    }
  }

  function inferNextIssue(issue) {
    const raw = String(issue || '');
    if (!/^\d+$/.test(raw)) return '下一期';
    return String(Number(raw) + 1).padStart(raw.length, '0');
  }

  function ballZoneLabel(zone) {
    if (zone === 'front') return '前区';
    if (zone === 'back') return '后区';
    if (zone.startsWith('front ')) return '前区';
    if (zone.startsWith('back ')) return '后区';
    if (zone.includes('variant')) return '前区';
    return zone;
  }

  function createBall(num, zone) {
    const ball = document.createElement('div');
    ball.className = `ball ${zone}`;
    ball.textContent = padNum(num);
    ball.setAttribute('role', 'img');
    ball.setAttribute('aria-label', `${ballZoneLabel(zone)} ${padNum(num)} 号`);
    return ball;
  }

  function createBallHTML(num, zone) {
    return `<div class="ball ${zone}" role="img" aria-label="${ballZoneLabel(zone)} ${padNum(num)} 号">${padNum(num)}</div>`;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setDisplay(id, value) {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
  }

  function getActiveStatName() {
    const active = document.querySelector('#statsTabs .sub-tab.active');
    return active ? active.dataset.stat : 'frequency';
  }

  function resetStatsTabs() {
    document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.sub-tab[data-stat="frequency"]').classList.add('active');
    document.querySelectorAll('.stat-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panelFrequency').classList.add('active');
  }

  function resetCountdownMarkup() {
    const timer = document.getElementById('countdownTimer');
    timer.innerHTML = `
      <div class="countdown-unit">
        <span class="countdown-value" id="cdDays">0</span>
        <span class="countdown-text">天</span>
      </div>
      <div class="countdown-sep">:</div>
      <div class="countdown-unit">
        <span class="countdown-value" id="cdHours">00</span>
        <span class="countdown-text">时</span>
      </div>
      <div class="countdown-sep">:</div>
      <div class="countdown-unit">
        <span class="countdown-value" id="cdMinutes">00</span>
        <span class="countdown-text">分</span>
      </div>
      <div class="countdown-sep">:</div>
      <div class="countdown-unit">
        <span class="countdown-value" id="cdSeconds">00</span>
        <span class="countdown-text">秒</span>
      </div>
    `;
  }

  function applyLotteryCopy() {
    const cfg = getLotteryConfig();
    const appEl = document.getElementById('app');
    appEl.classList.toggle('theme-pl3', state.currentLottery === 'pl3');
    appEl.classList.toggle('theme-worldcup', isWorldCup());
    appEl.classList.toggle('theme-dlt', state.currentLottery === 'dlt');

    // Reset dataCount display state when switching
    setDisplay('dataCount', '');

    setText('logoBallRed', cfg.logo[0]);
    setText('logoBallBlue', cfg.logo[1]);
    setText('logoTitle', cfg.label);
    setText('logoSubtitle', cfg.subtitle);

    if (isWorldCup()) {
      const metadata = window.WorldCup?.getMetadata?.();
      const sourceDate = metadata?.sourceDataDate || '2026-05-30';
      const teamCount = metadata?.teamCount || 48;
      document.getElementById('dataCount').innerHTML =
        `<span class="badge-dot"></span>${teamCount} 支球队`;
      document.getElementById('updateTime').textContent = `数据日期 ${sourceDate}`;
      setText('footerTitle', '世界杯预测工具 · 仅供学习参考');
      setText('footerSubtitle', '数据来源：2026-world-cup-predictor 静态导出 · 所有预测仅供概率研究参考');
      return;
    }

    setText('footerTitle', '体彩数据分析工具 · 仅供学习参考');
    setText('footerSubtitle', '数据来源：中国体育彩票 · 所有数据仅供参考，以官方公布为准');

    setText('latestFrontLabel', cfg.frontLabel);
    setText('latestBackLabel', cfg.backLabel);
    setText('historyFrontHeader', cfg.historyFrontHeader);
    setText('historyBackHeader', cfg.historyBackHeader);
    setText('rulesSubNote', cfg.rulesNote);

    const statLabels = document.querySelectorAll('.stats-overview .stat-label');
    cfg.statsLabels.forEach((label, index) => {
      if (statLabels[index]) statLabels[index].textContent = label;
    });

    const textarea = document.getElementById('customNumbersInput');
    if (textarea) textarea.placeholder = cfg.checkerPlaceholder;
    const modalDesc = document.querySelector('.modal-desc');
    if (modalDesc) modalDesc.textContent = cfg.checkerHelp;
  }

  function resetLotteryState() {
    state.searchKeyword = '';
    state.yearFilter = '';
    state.historyPage = 1;
    state.filteredData = [];
    state.predictions = [];
    state.selectedTrendNumbers = getLotteryConfig().selectedTrendNumbers.slice();

    document.getElementById('searchInput').value = '';
    document.getElementById('yearFilter').value = '';
    document.getElementById('historyBody').innerHTML = '';
    document.getElementById('historyPagination').innerHTML = '';
    document.getElementById('predictionsGrid').innerHTML = '';
    document.getElementById('backtestResults').innerHTML = '';
    document.getElementById('trendSelector').innerHTML = '';
    document.getElementById('freqFrontSummary').innerHTML = '';
    document.getElementById('freqBackSummary').innerHTML = '';
    document.getElementById('hotcoldFrontGrid').innerHTML = '';
    document.getElementById('hotcoldBackGrid').innerHTML = '';
    document.getElementById('sumStats').innerHTML = '';
    setDisplay('btnCopyAll', 'none');
    setDisplay('backtestSection', 'none');
    resetStatsTabs();
  }

  // ==================== 数据加载 ====================
  async function loadData() {
    try {
      const filepath = getLotteryConfig().filepath;
      const res = await fetch(filepath + '?t=' + Date.now(), { cache: 'no-cache' });
      if (!res.ok) throw new Error('数据文件加载失败');
      const json = await res.json();
      
      state.data = Array.isArray(json.data) ? json.data : [];
      state.total = json.total || state.data.length;
      state.updateTime = json.updateTime || '';
      state.filteredData = [...state.data];
      
      // 更新数据徽章
      document.getElementById('dataCount').innerHTML = 
        `<span class="badge-dot"></span>共 ${state.total} 期数据`;
      
      if (state.updateTime) {
        const d = new Date(state.updateTime);
        document.getElementById('updateTime').textContent = Number.isNaN(d.getTime())
          ? ''
          : `更新于 ${d.getFullYear()}-${padNum(d.getMonth()+1)}-${padNum(d.getDate())}`;
      } else {
        document.getElementById('updateTime').textContent = '';
      }
      
      // 初始化年份筛选
      initYearFilter();
      
      return true;
    } catch (e) {
      console.error('加载数据失败:', e);
      document.getElementById('dataCount').innerHTML = 
        `<span class="badge-dot error"></span>数据加载失败`;
      document.getElementById('updateTime').textContent = '';
      state.data = [];
      state.filteredData = [];
      return false;
    }
  }

  function initYearFilter() {
    const select = document.getElementById('yearFilter');
    select.innerHTML = '<option value="">全部年份</option>'; // 重置选项
    
    const years = new Set();
    state.data.forEach(d => {
      if (d.date) {
        const y = d.date.substring(0, 4);
        years.add(y);
      }
    });
    const sortedYears = [...years].sort().reverse();
    sortedYears.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y + ' 年';
      select.appendChild(opt);
    });
  }

  // ==================== 首页渲染 ====================
  function renderHome() {
    applyLotteryCopy();
    if (state.data.length === 0) {
      document.getElementById('latestIssue').textContent = '--';
      document.getElementById('latestDate').textContent = '--';
      document.getElementById('latestFront').innerHTML = '<div class="empty-state">暂无开奖数据</div>';
      document.getElementById('latestBack').innerHTML = '';
      document.getElementById('latestSales').textContent = '--';
      document.getElementById('latestPool').textContent = '--';
      document.getElementById('recentDrawsList').innerHTML = '<div class="empty-state">暂无近期开奖记录</div>';
      return;
    }
    
    const latest = state.data[0];
    const showBack = !isPL3();
    
    // 最新期号和日期
    document.getElementById('latestIssue').textContent = `第 ${latest.issue} 期`;
    document.getElementById('latestDate').textContent = latest.date;
    
    // 前区球
    const frontContainer = document.getElementById('latestFront');
    frontContainer.innerHTML = '';
    latest.front.forEach((num, i) => {
      const ball = createBall(num, 'front');
      ball.style.animationDelay = (i * 0.12) + 's';
      frontContainer.appendChild(ball);
    });
    
    // 后区球
    const backContainer = document.getElementById('latestBack');
    backContainer.innerHTML = '';
    if (showBack) {
      latest.back.forEach((num, i) => {
        const ball = createBall(num, 'back');
        ball.style.animationDelay = (0.6 + i * 0.12) + 's';
        backContainer.appendChild(ball);
      });
    }
    
    // 销售额和奖池
    document.getElementById('latestSales').textContent = formatMoney(latest.sales);
    document.getElementById('latestPool').textContent = formatMoney(latest.pool);
    
    // 近期开奖列表
    renderRecentDraws();
    
    // 倒计时
    startCountdown();
  }

  function renderRecentDraws() {
    const list = document.getElementById('recentDrawsList');
    const recent = state.data.slice(1, 11); // 最近10期（排除最新一期）
    const showBack = !isPL3();
    if (recent.length === 0) {
      list.innerHTML = '<div class="empty-state">暂无近期开奖记录</div>';
      return;
    }
    
    list.innerHTML = recent.map(d => `
      <div class="draw-item" tabindex="0" aria-label="第 ${d.issue} 期 ${d.date} 开奖记录">
        <div class="draw-item-info">
          <span class="draw-item-issue">第 ${d.issue} 期</span>
          <span class="draw-item-date">${d.date}</span>
        </div>
        <div class="draw-item-balls">
          ${d.front.map(n => createBallHTML(n, 'front small')).join('')}
          ${showBack ? `
            <span class="draw-item-plus">+</span>
            ${d.back.map(n => createBallHTML(n, 'back small')).join('')}
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  // ==================== 倒计时 ====================
  function getNextDrawTime() {
    const now = new Date();
    const isPl3 = isPL3();

    if (isPl3) {
      // 排列三开奖时间：每天 21:25
      let next = new Date(now);
      next.setHours(21, 25, 0, 0);
      if (next > now) return next;

      next = new Date(now.getTime() + 86400000);
      next.setHours(21, 25, 0, 0);
      return next;
    }

    // 大乐透开奖时间：周一、三、六 21:25
    const drawDays = [1, 3, 6]; // 周一=1, 周三=3, 周六=6
    const drawHour = 21;
    const drawMinute = 25;

    for (let i = 0; i < 7; i++) {
      const candidate = new Date(now.getTime() + i * 86400000);
      if (drawDays.includes(candidate.getDay())) {
        candidate.setHours(drawHour, drawMinute, 0, 0);
        if (candidate > now) return candidate;
      }
    }

    // 7 天内必然命中一个开奖日，到这里说明时钟异常，安全返回
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() + 7);
    fallback.setHours(drawHour, drawMinute, 0, 0);
    return fallback;
  }

  function startCountdown() {
    if (state.countdownTimerId !== null) {
      clearInterval(state.countdownTimerId);
    }
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    function update() {
      const now = new Date();
      const next = getNextDrawTime();
      const diff = next - now;
      
      if (diff <= 0) {
        document.getElementById('countdownTimer').innerHTML = '<div class="countdown-live">开奖中...</div>';
        return;
      }

      if (!document.getElementById('cdDays')) {
        resetCountdownMarkup();
      }
      
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      
      document.getElementById('cdDays').textContent = days;
      document.getElementById('cdHours').textContent = padNum(hours);
      document.getElementById('cdMinutes').textContent = padNum(minutes);
      document.getElementById('cdSeconds').textContent = padNum(seconds);
      
      document.getElementById('nextDrawDay').textContent = 
        `${next.getMonth()+1}月${next.getDate()}日 ${dayNames[next.getDay()]} 21:25`;
    }
    
    update();
    state.countdownTimerId = setInterval(update, 1000);
  }

  // ==================== 历史数据 ====================
  function filterHistory() {
    let data = [...state.data];
    
    if (state.searchKeyword) {
      const kw = state.searchKeyword.toLowerCase();
      data = data.filter(d => 
        d.issue.toString().includes(kw) || 
        (d.date && d.date.includes(kw))
      );
    }
    
    if (state.yearFilter) {
      data = data.filter(d => d.date && d.date.startsWith(state.yearFilter));
    }
    
    state.filteredData = data;
    state.historyPage = 1;
    renderHistory();
  }

  function renderHistory() {
    const data = state.filteredData;
    const total = data.length;
    const pageSize = state.historyPageSize;
    const totalPages = Math.ceil(total / pageSize);
    const page = totalPages > 0 ? Math.min(state.historyPage, totalPages) : 1;
    state.historyPage = page;
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const pageData = data.slice(start, end);
    const showBack = !isPL3();
    
    const tbody = document.getElementById('historyBody');
    if (pageData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="${showBack ? 6 : 4}">
            <div class="empty-state">未找到符合条件的开奖记录</div>
          </td>
        </tr>
      `;
      renderPagination(totalPages, page);
      return;
    }

    tbody.innerHTML = pageData.map(d => `
      <tr>
        <td><span class="issue-num">${escapeHtml(d.issue)}</span></td>
        <td>${escapeHtml(d.date) || '--'}</td>
        <td>
          <div class="ball-row table-balls">
            ${d.front.map(n => createBallHTML(n, 'front mini')).join('')}
          </div>
        </td>
        <td class="col-back">
          <div class="ball-row table-balls">
            ${showBack ? d.back.map(n => createBallHTML(n, 'back mini')).join('') : ''}
          </div>
        </td>
        <td class="col-sales">${formatMoney(d.sales)}</td>
        <td class="col-pool">${showBack ? formatMoney(d.pool) : '--'}</td>
      </tr>
    `).join('');
    
    renderPagination(totalPages, page);
  }

  function renderPagination(totalPages, currentPage) {
    const container = document.getElementById('historyPagination');
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }
    
    let html = '';

    // 上一页
    html += `<button class="page-btn ${currentPage === 1 ? 'disabled' : ''}"
              data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;

    // 首页
    if (currentPage > 3) {
      html += `<button class="page-btn" data-page="1">1</button>`;
      if (currentPage > 4) html += `<span class="page-ellipsis">...</span>`;
    }

    // 页码范围
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    // 末页
    if (currentPage < totalPages - 2) {
      if (currentPage < totalPages - 3) html += `<span class="page-ellipsis">...</span>`;
      html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    // 下一页
    html += `<button class="page-btn ${currentPage === totalPages ? 'disabled' : ''}"
              data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
    
    container.innerHTML = html;
  }

  // ==================== 统计分析 ====================
  function renderStats(panel) {
    if (state.data.length === 0) return;
    
    switch(panel) {
      case 'frequency': renderFrequencyStats(); break;
      case 'hotcold': renderHotColdStats(); break;
      case 'gap': renderGapStats(); break;
      case 'oddeven': renderOddEvenStats(); break;
      case 'sum': renderSumStats(); break;
      case 'trend': renderTrendStats(); break;
    }
  }

  function renderStatsOverview() {
    if (state.data.length === 0) return;
    
    const isPl3 = isPL3();
    const freq = Predictor.frequencyAnalysis(state.data);
    
    // 最热前区/主要选区
    let maxFrontFreq = 0, hottestFront = [];
    freq.front.forEach((count, num) => {
      if (count > maxFrontFreq) { maxFrontFreq = count; hottestFront = [num]; }
      else if (count === maxFrontFreq) hottestFront.push(num);
    });
    
    // 最冷前区/主要选区
    let minFrontFreq = Infinity, coldestFront = [];
    freq.front.forEach((count, num) => {
      if (count < minFrontFreq) { minFrontFreq = count; coldestFront = [num]; }
      else if (count === minFrontFreq) coldestFront.push(num);
    });
    
    document.getElementById('hottestFront').textContent = hottestFront.map(padNum).join(', ');
    document.getElementById('coldestFront').textContent = coldestFront.map(padNum).join(', ');

    if (!isPl3) {
      // 最热后区
      let maxBackFreq = 0, hottestBack = [];
      freq.back.forEach((count, num) => {
        if (count > maxBackFreq) { maxBackFreq = count; hottestBack = [num]; }
        else if (count === maxBackFreq) hottestBack.push(num);
      });
      
      // 最冷后区
      let minBackFreq = Infinity, coldestBack = [];
      freq.back.forEach((count, num) => {
        if (count < minBackFreq) { minBackFreq = count; coldestBack = [num]; }
        else if (count === minBackFreq) coldestBack.push(num);
      });
      
      document.getElementById('hottestBack').textContent = hottestBack.map(padNum).join(', ');
      document.getElementById('coldestBack').textContent = coldestBack.map(padNum).join(', ');
    } else {
      document.getElementById('hottestBack').textContent = '--';
      document.getElementById('coldestBack').textContent = '--';
    }
  }

  function renderFrequencyStats() {
    const freq = Predictor.frequencyAnalysis(state.data);
    renderFrequencySummary('freqFrontSummary', freq.front);
    Charts.drawFrequencyChart('chartFreqFront', freq, 'front');
    if (!isPL3()) {
      renderFrequencySummary('freqBackSummary', freq.back);
      Charts.drawFrequencyChart('chartFreqBack', freq, 'back');
    } else {
      document.getElementById('freqBackSummary').innerHTML = '';
    }
  }

  function renderFrequencySummary(containerId, freqMap) {
    const container = document.getElementById(containerId);
    if (!container || !freqMap || freqMap.size === 0) return;

    const entries = Array.from(freqMap.entries())
      .map(([num, count]) => ({ num: Number(num), count: Number(count) || 0 }));
    const sortedHigh = entries.slice().sort((a, b) => b.count - a.count || a.num - b.num);
    const sortedLow = entries.slice().sort((a, b) => a.count - b.count || a.num - b.num);
    const avg = entries.reduce((sum, item) => sum + item.count, 0) / entries.length;

    function nums(items) {
      return items.slice(0, 3).map(item => padNum(item.num)).join(' ');
    }

    container.innerHTML = `
      <div class="frequency-chip hot">
        <span>高频</span>
        <strong>${nums(sortedHigh)}</strong>
        <em>${Math.round(sortedHigh[0].count)}</em>
      </div>
      <div class="frequency-chip cold">
        <span>低频</span>
        <strong>${nums(sortedLow)}</strong>
        <em>${Math.round(sortedLow[0].count)}</em>
      </div>
      <div class="frequency-chip avg">
        <span>平均</span>
        <strong>${Math.round(avg)}</strong>
        <em>次</em>
      </div>
    `;
  }

  function renderHotColdStats() {
    const hc = Predictor.hotColdAnalysis(state.data, 300);
    const isPl3 = isPL3();
    
    function renderGrid(containerId, data, maxNum, minNum = 1) {
      const container = document.getElementById(containerId);
      let html = '';
      for (let i = minNum; i <= maxNum; i++) {
        let status = 'warm';
        if (data.hot.includes(i)) status = 'hot';
        else if (data.cold.includes(i)) status = 'cold';
        
        html += `<div class="heatmap-cell ${status}" title="号码 ${padNum(i)} - ${
          status === 'hot' ? '热号' : status === 'cold' ? '冷号' : '温号'
        }">
          <span class="cell-num">${padNum(i)}</span>
          <span class="cell-tag tag ${status}">${
            status === 'hot' ? '热' : status === 'cold' ? '冷' : '温'
          }</span>
        </div>`;
      }
      container.innerHTML = html;
    }
    
    renderGrid('hotcoldFrontGrid', hc.front, isPl3 ? 9 : 35, isPl3 ? 0 : 1);
    if (!isPl3) {
      renderGrid('hotcoldBackGrid', hc.back, 12, 1);
    }
  }

  function renderGapStats() {
    const gap = Predictor.gapAnalysis(state.data);
    Charts.drawGapChart('chartGapFront', gap, 'front');
    if (!isPL3()) {
      Charts.drawGapChart('chartGapBack', gap, 'back');
    }
  }

  function renderOddEvenStats() {
    const oe = Predictor.oddEvenAnalysis(state.data);
    Charts.drawPieChart('chartOddEven', oe, '奇偶比分布');
    
    const bs = Predictor.bigSmallAnalysis(state.data);
    Charts.drawPieChart('chartBigSmall', bs, '大小比分布');
  }

  function renderSumStats() {
    const sumData = Predictor.sumAnalysis(state.data);
    Charts.drawSumDistribution('chartSum', sumData);
    
    const statsDiv = document.getElementById('sumStats');
    statsDiv.innerHTML = `
      <div class="sum-stat-row">
        <div class="sum-stat-item">
          <span class="sum-stat-label">平均和值</span>
          <span class="sum-stat-value">${sumData.avg.toFixed(1)}</span>
        </div>
        <div class="sum-stat-item">
          <span class="sum-stat-label">最小和值</span>
          <span class="sum-stat-value">${sumData.min}</span>
        </div>
        <div class="sum-stat-item">
          <span class="sum-stat-label">最大和值</span>
          <span class="sum-stat-value">${sumData.max}</span>
        </div>
        <div class="sum-stat-item">
          <span class="sum-stat-label">标准差</span>
          <span class="sum-stat-value">${sumData.stdDev.toFixed(1)}</span>
        </div>
      </div>
    `;
  }

  function renderTrendStats() {
    const selector = document.getElementById('trendSelector');
    const isPl3 = isPL3();
    const minNum = isPl3 ? 0 : 1;
    const maxNum = isPl3 ? 9 : 35;
    
    let html = '<div class="trend-nums">';
    for (let i = minNum; i <= maxNum; i++) {
      const isSelected = state.selectedTrendNumbers.includes(i);
      html += `<button class="trend-num-btn ${isSelected ? 'active' : ''}" data-num="${i}">${padNum(i)}</button>`;
    }
    html += '</div>';
    selector.innerHTML = html;
    
    Charts.drawTrendChart('chartTrend', state.data, state.selectedTrendNumbers);
  }

  // ==================== 预测功能 ====================
  function generatePredictions() {
    if (state.data.length === 0) return;

    const btn = document.getElementById('btnGenerate');
    if (btn.dataset.loading === '1') return; // 防重入
    btn.dataset.loading = '1';
    btn.disabled = true;
    const labelEl = btn.querySelector('.btn-label');
    const originalLabel = labelEl ? labelEl.textContent : '生成预测号码';
    if (labelEl) labelEl.textContent = '生成中...';
    btn.setAttribute('aria-busy', 'true');

    try {
      const evolution = rebuildStrategyEvolution();
      const predictions = Predictor.generateMultiplePredictions(state.data, 5, { evolution });
      state.predictions = predictions;
      savePredictionRecord(predictions);

      renderPredictions(predictions);
      renderPredictionHistory();

      document.getElementById('btnCopyAll').style.display = 'inline-flex';
      document.getElementById('backtestSection').style.display = 'block';
    } catch (error) {
      console.error('预测生成失败:', error);
      document.getElementById('predictionsGrid').innerHTML = '<div class="error-state">预测生成失败，请稍后重试。</div>';
    } finally {
      btn.disabled = false;
      btn.dataset.loading = '0';
      btn.removeAttribute('aria-busy');
      if (labelEl) labelEl.textContent = originalLabel;
    }
  }

  function savePredictionRecord(predictions) {
    const latestDraw = state.data[0] || {};
    const record = {
      id: `${state.currentLottery}-${Date.now()}`,
      type: state.currentLottery,
      createdAt: new Date().toISOString(),
      baseIssue: latestDraw.issue || '',
      targetIssue: inferNextIssue(latestDraw.issue),
      predictions: predictions.map(prediction => ({
        strategy: prediction.strategy,
        front: prediction.front,
        back: prediction.back || [],
        reasoning: prediction.reasoning || ''
      }))
    };

    state.predictionRecords = [record, ...state.predictionRecords].slice(0, PREDICTION_HISTORY_LIMIT);
    persistPredictionRecords();
  }

  function formatRecordTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function evaluatePrediction(prediction, draw, isPl3) {
    if (!draw) return null;

    if (isPl3) {
      const result = checkPL3Winning(prediction.front, draw.front);
      const positionMatches = prediction.front.filter((n, index) => n === draw.front[index]).length;
      const matchedValues = getMultisetMatches(prediction.front, draw.front);
      const valueMatches = matchedValues.length;
      const prize = result.prize;
      const reason = buildPL3ReviewReason(prediction.front, draw.front, prize, positionMatches, valueMatches);
      const matchedFront = prize === '直选'
        ? prediction.front.filter((n, index) => n === draw.front[index])
        : prize
          ? matchedValues
          : prediction.front.filter((n, index) => n === draw.front[index]);
      return {
        frontMatches: positionMatches,
        backMatches: 0,
        valueMatches,
        prize,
        matchedFront,
        matchedBack: [],
        reason,
        tag: prize ? `命中${prize}` : (valueMatches > positionMatches ? '位置错位' : '未达门槛'),
        score: prize ? (prize === '直选' ? 3.5 : 3) : (positionMatches * 0.45 + valueMatches * 0.35)
      };
    }

    const matchedFront = prediction.front.filter(n => draw.front.includes(n));
    const matchedBack = prediction.back.filter(n => draw.back.includes(n));
    const prize = getPrizeTierName(matchedFront.length, matchedBack.length);
    const reason = buildDLTReviewReason(matchedFront.length, matchedBack.length, prize);
    return {
      frontMatches: matchedFront.length,
      backMatches: matchedBack.length,
      prize,
      matchedFront,
      matchedBack,
      reason,
      tag: prize ? prize : getDLTFailureTag(matchedFront.length, matchedBack.length),
      score: matchedFront.length + matchedBack.length * 1.2 + (prize ? 2 : 0)
    };
  }

  function getMultisetMatches(input, target) {
    const remaining = target.slice();
    const matches = [];
    input.forEach(num => {
      const idx = remaining.indexOf(num);
      if (idx >= 0) {
        matches.push(num);
        remaining.splice(idx, 1);
      }
    });
    return matches;
  }

  function buildDLTReviewReason(frontMatches, backMatches, prize) {
    if (prize) {
      return `命中前区 ${frontMatches} 个、后区 ${backMatches} 个，达到${prize}条件。`;
    }
    if (backMatches === 2 && frontMatches < 1) {
      return `后区全中，但前区仅命中 ${frontMatches} 个，低于九等奖的前区补强门槛。`;
    }
    if (frontMatches >= 3 && backMatches === 0) {
      return `前区命中 ${frontMatches} 个，但后区未命中，缺少后区支撑。`;
    }
    if (frontMatches < 3 && backMatches < 2) {
      return `前区仅命中 ${frontMatches} 个、后区命中 ${backMatches} 个，整体低于九等奖组合门槛。`;
    }
    return `命中 ${frontMatches}+${backMatches}，距离最低奖级仍差前区或后区关键命中。`;
  }

  function getDLTFailureTag(frontMatches, backMatches) {
    if (frontMatches >= 3 && backMatches === 0) return '后区失配';
    if (backMatches === 2 && frontMatches === 0) return '前区不足';
    return '中奖门槛不足';
  }

  function buildPL3ReviewReason(input, target, prize, positionMatches, valueMatches) {
    if (prize === '直选') return `三位号码与开奖位置完全一致，命中直选。`;
    if (prize) return `三位数字集合与开奖号一致，但顺序不同，命中${prize}。`;
    if (valueMatches > positionMatches) {
      return `命中 ${valueMatches} 个数字，但仅 ${positionMatches} 个在正确位置，主要问题是位置错位。`;
    }
    if (positionMatches > 0) {
      return `有 ${positionMatches} 个位置命中，但数字集合未达到组选条件。`;
    }
    return `预测 ${input.join('')} 与开奖号 ${target.join('')} 无位置命中，数字集合也未形成组选命中。`;
  }

  function resolveReviewDraw(record) {
    if (!state.data.length) return null;
    const exact = state.data.find(draw => String(draw.issue) === String(record.targetIssue));
    if (exact) return exact;
    const latest = state.data[0];
    if (record.baseIssue && String(latest.issue) !== String(record.baseIssue)) {
      return latest;
    }
    return null;
  }

  function renderMiniBalls(numbers, zone, matched = []) {
    const matchedIndexes = new Set();
    return numbers.map(num => {
      const matchedIndex = matched.findIndex((match, index) => match === num && !matchedIndexes.has(index));
      const isMatch = matchedIndex >= 0;
      if (isMatch) matchedIndexes.add(matchedIndex);
      return `<span class="history-ball ${zone} ${isMatch ? 'match' : ''}">${padNum(num)}</span>`;
    }).join('');
  }

  function renderDrawBalls(draw, isPl3) {
    if (!draw) return '';
    return `
      <div class="review-draw-balls">
        ${renderMiniBalls(draw.front || [], 'front')}
        ${isPl3 ? '' : '<span class="history-plus">+</span>'}
        ${isPl3 ? '' : renderMiniBalls(draw.back || [], 'back')}
      </div>
    `;
  }

  function createEmptyStrategyStat(strategy) {
    return {
      strategy,
      reviewCount: 0,
      winCount: 0,
      totalFrontMatches: 0,
      totalBackMatches: 0,
      totalScore: 0,
      averageMatch: 0,
      recentPerformance: 0,
      weightMultiplier: 1,
      lastReviewIssue: '',
      direction: 'stable'
    };
  }

  function clamp(num, min, max) {
    return Math.max(min, Math.min(max, num));
  }

  function rebuildStrategyEvolution() {
    const isPl3 = isPL3();
    const stats = {};
    Object.keys(STRATEGY_LABELS).forEach(strategy => {
      stats[strategy] = createEmptyStrategyStat(strategy);
      stats[strategy].recentScores = [];
    });

    state.predictionRecords.slice().reverse().forEach(record => {
      const reviewDraw = resolveReviewDraw(record);
      if (!reviewDraw) return;

      (record.predictions || []).forEach(prediction => {
        const strategy = prediction.strategy || 'balanced';
        if (!stats[strategy]) stats[strategy] = createEmptyStrategyStat(strategy);
        if (!stats[strategy].recentScores) stats[strategy].recentScores = [];

        const evaluation = evaluatePrediction(prediction, reviewDraw, isPl3);
        if (!evaluation) return;

        stats[strategy].reviewCount += 1;
        stats[strategy].winCount += evaluation.prize ? 1 : 0;
        stats[strategy].totalFrontMatches += evaluation.frontMatches || 0;
        stats[strategy].totalBackMatches += evaluation.backMatches || 0;
        stats[strategy].totalScore += evaluation.score || 0;
        stats[strategy].lastReviewIssue = String(reviewDraw.issue || '');
        stats[strategy].recentScores.push(evaluation.score || 0);
        stats[strategy].recentScores = stats[strategy].recentScores.slice(-6);
      });
    });

    Object.values(stats).forEach(stat => {
      if (!stat.reviewCount) {
        stat.recentPerformance = 0;
        stat.weightMultiplier = 1;
        stat.direction = 'stable';
        delete stat.recentScores;
        return;
      }

      const baseDivisor = isPl3 ? stat.reviewCount : stat.reviewCount;
      stat.averageMatch = Math.round(((stat.totalFrontMatches + stat.totalBackMatches) / baseDivisor) * 100) / 100;
      stat.recentPerformance = Math.round((stat.recentScores.reduce((sum, score) => sum + score, 0) / stat.recentScores.length) * 100) / 100;

      const baseline = isPl3 ? 1.05 : 2.15;
      const winLift = stat.winCount > 0 ? Math.min(0.12, stat.winCount / stat.reviewCount * 0.18) : 0;
      const performanceDelta = clamp((stat.recentPerformance - baseline) / baseline, -0.3, 0.3);
      stat.weightMultiplier = Math.round(clamp(1 + performanceDelta * 0.45 + winLift, 0.75, 1.25) * 100) / 100;
      stat.direction = stat.weightMultiplier >= 1.06 ? 'up' : stat.weightMultiplier <= 0.94 ? 'down' : 'stable';
      delete stat.recentScores;
    });

    const advice = buildEvolutionAdvice(stats);
    const evolution = {
      type: state.currentLottery,
      updatedAt: new Date().toISOString(),
      strategyStats: stats,
      summary: advice.summary,
      mode: advice.mode
    };
    persistStrategyEvolution(evolution);
    return evolution;
  }

  function buildEvolutionAdvice(stats) {
    const reviewed = Object.values(stats).filter(stat => stat.reviewCount > 0);
    if (!reviewed.length) {
      return {
        mode: 'pending',
        summary: '暂无已复盘记录，策略进化将在开奖后自动生成。'
      };
    }

    const sorted = reviewed.slice().sort((a, b) => b.weightMultiplier - a.weightMultiplier);
    const top = sorted[0];
    const weak = sorted[sorted.length - 1];
    const topLabel = STRATEGY_LABELS[top.strategy] || top.strategy;
    const weakLabel = STRATEGY_LABELS[weak.strategy] || weak.strategy;

    if (top.strategy === weak.strategy || Math.abs(top.weightMultiplier - weak.weightMultiplier) < 0.08) {
      return {
        mode: 'balanced',
        summary: '各策略近期表现接近，下期维持均衡轮转，避免单期复盘过拟合。'
      };
    }
    return {
      mode: 'weighted',
      summary: `${topLabel}近期命中更稳，下期提高优先级；${weakLabel}连续表现偏弱，温和降低权重。`
    };
  }

  function getStrategyEvolutionTag(strategy, evolution = state.strategyEvolution) {
    if (evolution?.mode === 'balanced') return '策略权重稳定';
    const stat = evolution?.strategyStats?.[strategy];
    if (!stat || !stat.reviewCount) return '策略待观察';
    if (stat.direction === 'up') return '策略加权上调';
    if (stat.direction === 'down') return '策略加权下调';
    return '策略权重稳定';
  }

  function renderPredictionRecordItem(record, isPl3, evolution) {
    const reviewDraw = resolveReviewDraw(record);
    const statusText = reviewDraw
      ? `已按第 ${escapeHtml(reviewDraw.issue)} 期复盘`
      : `等待第 ${escapeHtml(record.targetIssue)} 期开奖`;
    const statusClass = reviewDraw ? 'reviewed' : 'pending';

    const tickets = record.predictions.map((prediction, index) => {
        const evaluation = evaluatePrediction(prediction, reviewDraw, isPl3);
        const resultText = !evaluation
          ? '待开奖'
          : isPl3
            ? (evaluation.prize ? `命中 ${evaluation.prize}` : `位置命中 ${evaluation.frontMatches}/3`)
            : `${evaluation.frontMatches}+${evaluation.backMatches}${evaluation.prize ? ' · ' + evaluation.prize : ''}`;
        const reasonText = evaluation ? evaluation.reason : '等待开奖后自动生成复盘原因。';
        const resultTag = evaluation ? evaluation.tag : '待开奖';
        const evolutionTag = getStrategyEvolutionTag(prediction.strategy, evolution);

        return `
          <div class="prediction-history-ticket">
            <div class="history-ticket-meta">
              <span>${index + 1}. ${escapeHtml(STRATEGY_LABELS[prediction.strategy] || prediction.strategy)}</span>
              <strong class="${evaluation && evaluation.prize ? 'win' : ''}">${escapeHtml(resultText)}</strong>
            </div>
            <div class="history-ticket-balls">
              ${renderMiniBalls(prediction.front, 'front', evaluation ? evaluation.matchedFront : [])}
              ${isPl3 ? '' : '<span class="history-plus">+</span>'}
              ${isPl3 ? '' : renderMiniBalls(prediction.back, 'back', evaluation ? evaluation.matchedBack : [])}
            </div>
            <div class="history-ticket-tags">
              <span class="review-tag ${evaluation && evaluation.prize ? 'win' : ''}">${escapeHtml(resultTag)}</span>
              <span class="review-tag evolution">${escapeHtml(evolutionTag)}</span>
            </div>
            <p class="history-ticket-reason">${escapeHtml(reasonText)}</p>
          </div>
        `;
      }).join('');

    const reviewSummary = reviewDraw
      ? `
          <div class="history-review-summary">
            <div>
              <span class="review-kicker">本期开奖号码</span>
              <strong>第 ${escapeHtml(reviewDraw.issue)} 期</strong>
            </div>
            ${renderDrawBalls(reviewDraw, isPl3)}
          </div>
          <div class="history-evolution-advice">
            <span>策略进化建议</span>
            <p>${escapeHtml(evolution.summary)}</p>
          </div>
        `
        : `
          <div class="history-evolution-advice pending">
            <span>策略进化建议</span>
            <p>等待第 ${escapeHtml(record.targetIssue)} 期开奖后生成复盘结论，并反哺下一轮预测权重。</p>
          </div>
        `;

    return `
        <article class="prediction-history-item">
          <div class="history-record-head">
            <div>
              <h3>${escapeHtml(record.type === 'pl3' ? '排列三' : '大乐透')} · ${escapeHtml(formatRecordTime(record.createdAt))}</h3>
              <p>使用截至第 ${escapeHtml(record.baseIssue || '--')} 期的历史数据，预测第 ${escapeHtml(record.targetIssue)} 期</p>
            </div>
            <div class="history-record-actions">
              <span class="history-status ${statusClass}">${statusText}</span>
              <button class="history-copy-btn" data-copy-record-id="${escapeHtml(record.id)}" onclick="App.copyPredictionRecord('${escapeHtml(record.id)}')">
                复制本轮
              </button>
            </div>
          </div>
          ${reviewSummary}
          <div class="prediction-history-tickets">
            ${tickets}
          </div>
        </article>
      `;
  }

  function renderPredictionHistory() {
    const section = document.getElementById('predictionHistorySection');
    const list = document.getElementById('predictionHistoryList');
    if (!section || !list) return;

    if (!state.predictionRecords.length) {
      section.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    const isPl3 = isPL3();
    const evolution = rebuildStrategyEvolution();
    const historyBtn = document.getElementById('btnShowPredictionHistory');
    const visibleRecords = state.predictionRecords.slice(0, PREDICTION_HISTORY_VISIBLE_LIMIT);

    if (historyBtn) {
      historyBtn.style.display = state.predictionRecords.length > PREDICTION_HISTORY_VISIBLE_LIMIT ? 'inline-flex' : 'none';
    }

    section.style.display = 'block';
    list.innerHTML = visibleRecords.map(record => renderPredictionRecordItem(record, isPl3, evolution)).join('');
  }

  function showPredictionHistoryModal() {
    if (state.predictionRecords.length <= PREDICTION_HISTORY_VISIBLE_LIMIT) return;

    const modal = document.getElementById('predictionHistoryModal');
    const list = document.getElementById('predictionHistoryModalList');
    if (!modal || !list) return;

    const isPl3 = isPL3();
    const evolution = rebuildStrategyEvolution();
    list.innerHTML = state.predictionRecords
      .map(record => renderPredictionRecordItem(record, isPl3, evolution))
      .join('');
    _lastFocusedBeforeModal = document.activeElement;
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
      const closeBtn = modal.querySelector('.modal-close');
      if (closeBtn) closeBtn.focus();
    });
  }

  function hidePredictionHistoryModal() {
    const modal = document.getElementById('predictionHistoryModal');
    if (!modal) return;
    modal.style.display = 'none';
    if (_lastFocusedBeforeModal && typeof _lastFocusedBeforeModal.focus === 'function') {
      _lastFocusedBeforeModal.focus();
    }
    _lastFocusedBeforeModal = null;
  }

  function formatPredictionLines(predictions, isPl3) {
    return predictions.map(p => {
      const frontStr = p.front.map(padNum).join(' ');
      if (isPl3) return frontStr;
      const backStr = (p.back || []).map(padNum).join(' ');
      return `${frontStr} + ${backStr}`;
    }).join('\n');
  }

  function fallbackCopy(text, callback) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        callback();
      } else {
        throw new Error('execCommand copy unsuccessful');
      }
    } catch (err) {
      console.error('Fallback copy failed:', err);
      alert('复制失败，请手动选择复制');
    }
  }

  function renderPredictions(predictions) {
    const grid = document.getElementById('predictionsGrid');

    const isPl3 = isPL3();

    grid.innerHTML = predictions.map((p, i) => `
      <div class="prediction-card card" style="animation-delay: ${i * 0.1}s">
        <div class="pred-header">
          <span class="pred-label">${escapeHtml(STRATEGY_LABELS[p.strategy] || p.strategy)}</span>
          <span class="pred-num">方案 ${i + 1}</span>
        </div>
        <div class="pred-balls">
          <div class="pred-zone">
            <span class="zone-tag">${isPl3 ? '开奖号码' : '前区'}</span>
            <div class="ball-row">
              ${p.front.map(n => createBallHTML(n, 'front')).join('')}
            </div>
          </div>
          ${isPl3 ? '' : `
          <div class="pred-zone">
            <span class="zone-tag">后区</span>
            <div class="ball-row">
              ${p.back.map(n => createBallHTML(n, 'back')).join('')}
            </div>
          </div>
          `}
        </div>
        <div class="pred-reasoning">${escapeHtml(p.reasoning || '')}</div>
      </div>
    `).join('');
  }

  function copyAllPredictions() {
    if (!state.predictions || state.predictions.length === 0) return;

    const text = formatPredictionLines(state.predictions, isPL3());

    copyToClipboard(text, () => {
      const btn = document.getElementById('btnCopyAll');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> 复制成功！`;
      btn.style.borderColor = 'var(--accent)';
      btn.style.color = 'var(--accent)';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.style.borderColor = '';
        btn.style.color = '';
      }, 2000);
    });
  }

  function copyPredictionRecord(recordId) {
    const record = state.predictionRecords.find(item => item.id === recordId);
    if (!record) return;

    const text = formatPredictionLines(record.predictions, record.type === 'pl3');
    const btn = document.querySelector(`[data-copy-record-id="${recordId}"]`);

    copyToClipboard(text, () => {
      if (!btn) return;
      const originalText = btn.textContent;
      btn.textContent = '已复制';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('copied');
      }, 1600);
    });
  }

  // ==================== 号码比对模块 ====================
  let _lastFocusedBeforeModal = null;

  function showWinningChecker() {
    const modal = document.getElementById('winningCheckerModal');
    if (!modal) return;
    applyLotteryCopy();

    // 清空上次的数据与结果
    document.getElementById('customNumbersInput').value = '';
    const resultsContainer = document.getElementById('checkerResults');
    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'none';

    _lastFocusedBeforeModal = document.activeElement;
    modal.style.display = 'flex';
    // 下一帧再 focus，避免被 display 切换打断
    requestAnimationFrame(() => {
      const input = document.getElementById('customNumbersInput');
      if (input) input.focus();
    });
  }

  function hideWinningChecker() {
    const modal = document.getElementById('winningCheckerModal');
    if (modal) {
      modal.style.display = 'none';
      if (_lastFocusedBeforeModal && typeof _lastFocusedBeforeModal.focus === 'function') {
        _lastFocusedBeforeModal.focus();
      }
      _lastFocusedBeforeModal = null;
    }
  }

  function getPrizeTierName(fCount, bCount) {
    if (fCount === 5 && bCount === 2) return '一等奖';
    if (fCount === 5 && bCount === 1) return '二等奖';
    if (fCount === 5 && bCount === 0) return '三等奖';
    if (fCount === 4 && bCount === 2) return '四等奖';
    if (fCount === 4 && bCount === 1) return '五等奖';
    if (fCount === 3 && bCount === 2) return '六等奖';
    if (fCount === 4 && bCount === 0) return '七等奖';
    if (fCount === 3 && bCount === 1) return '八等奖';
    if (fCount === 2 && bCount === 2) return '八等奖';
    if (fCount === 3 && bCount === 0) return '九等奖';
    if (fCount === 2 && bCount === 1) return '九等奖';
    if (fCount === 1 && bCount === 2) return '九等奖';
    if (fCount === 0 && bCount === 2) return '九等奖';
    return null;
  }

  function invalidCheckerItem(message) {
    return `
      <div class="checker-item error">
        <span class="checker-message">${escapeHtml(message)}</span>
      </div>
    `;
  }

  function checkCustomNumbers() {
    const inputVal = document.getElementById('customNumbersInput').value.trim();
    const resultsContainer = document.getElementById('checkerResults');
    
    if (!inputVal) {
      alert('请输入要比对的号码');
      return;
    }

    if (state.data.length === 0) {
      alert('开奖数据尚未加载成功，请稍后再试');
      return;
    }

    const latestDraw = state.data[0];
    const frontTarget = latestDraw.front;
    const backTarget = latestDraw.back;
    const isPl3 = isPL3();

    const lines = inputVal.split('\n');
    let html = '<h4>核对结果对比（对比最新第 ' + escapeHtml(latestDraw.issue) + ' 期）</h4>';
    let hasValidLines = false;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const nums = trimmed.match(/\d+/g);

      if (isPl3) {
        if (!nums || nums.length < 3) {
          html += invalidCheckerItem(`第 ${index + 1} 行格式有误，请确保包含 3 位排列三号码（例如：4 4 3）`);
          return;
        }

        const digits = nums.slice(0, 3).map(Number);
        const isRangeValid = digits.every(n => n >= 0 && n <= 9);

        if (!isRangeValid) {
          html += invalidCheckerItem(`第 ${index + 1} 行号码范围超出限制（每位数字 0-9）`);
          return;
        }

        hasValidLines = true;
        const checkResult = checkPL3Winning(digits, frontTarget);
        const prizeName = checkResult.prize;

        html += `
          <div class="checker-item ${prizeName ? 'win' : ''}" tabindex="0" aria-label="号码 ${digits.join(' ')}${prizeName ? '，命中' + prizeName : '，未中奖'}">
            <div class="checker-item-balls">
              ${digits.map((n, j) => {
                const isMatch = (prizeName === '直选' && n === frontTarget[j]) || (prizeName && frontTarget.includes(n));
                return `<span class="checker-ball front ${isMatch ? 'match' : ''}" role="img" aria-label="号码 ${n}${isMatch ? '，命中' : ''}">${n}</span>`;
              }).join('')}
            </div>
            <div class="checker-item-verdict">
              <span class="match-count">${prizeName ? '匹配成功' : '未中奖'}</span>
              <span class="prize-result-badge ${prizeName ? 'win' : 'lose'}">
                ${prizeName ? '恭喜中 ' + prizeName : '未中奖'}
              </span>
            </div>
          </div>
        `;
      } else {
        if (!nums || nums.length < 7) {
          html += invalidCheckerItem(`第 ${index + 1} 行格式有误，请确保包含 5 个前区 + 2 个后区号码`);
          return;
        }

        const front = nums.slice(0, 5).map(Number).sort((a, b) => a - b);
        const back = nums.slice(5, 7).map(Number).sort((a, b) => a - b);

        // 验证范围
        const isFrontValid = front.every(n => n >= 1 && n <= 35);
        const isBackValid = back.every(n => n >= 1 && n <= 12);

        if (!isFrontValid || !isBackValid) {
          html += invalidCheckerItem(`第 ${index + 1} 行号码范围超出限制（前区 1-35，后区 1-12）`);
          return;
        }

        const frontSet = new Set(front);
        const backSet = new Set(back);
        if (frontSet.size !== 5 || backSet.size !== 2) {
          html += invalidCheckerItem(`第 ${index + 1} 行包含重复号码，前区 5 个和后区 2 个号码均不能重复`);
          return;
        }

        hasValidLines = true;

        const matchedFront = front.filter(n => frontTarget.includes(n));
        const matchedBack = back.filter(n => backTarget.includes(n));
        const fCount = matchedFront.length;
        const bCount = matchedBack.length;

        const prizeName = getPrizeTierName(fCount, bCount);

        html += `
          <div class="checker-item ${prizeName ? 'win' : ''}" tabindex="0" aria-label="前区 ${front.map(padNum).join(' ')} 加 后区 ${back.map(padNum).join(' ')}，${prizeName ? '命中' + prizeName : '未中奖'}">
            <div class="checker-item-balls">
              ${front.map(n => {
                const isMatch = frontTarget.includes(n);
                return `<span class="checker-ball front ${isMatch ? 'match' : ''}" role="img" aria-label="前区 ${padNum(n)}${isMatch ? '，命中' : ''}">${padNum(n)}</span>`;
              }).join('')}

              <span class="checker-ball plus" aria-hidden="true">+</span>

              ${back.map(n => {
                const isMatch = backTarget.includes(n);
                return `<span class="checker-ball back ${isMatch ? 'match' : ''}" role="img" aria-label="后区 ${padNum(n)}${isMatch ? '，命中' : ''}">${padNum(n)}</span>`;
              }).join('')}
            </div>
            <div class="checker-item-verdict">
              <span class="match-count">中 ${fCount} + ${bCount}</span>
              <span class="prize-result-badge ${prizeName ? 'win' : 'lose'}">
                ${prizeName ? '恭喜中 ' + prizeName : '未中奖'}
              </span>
            </div>
          </div>
        `;
      }
    });

    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'flex';
  }

  async function runBacktest() {
    if (state.data.length < 100) {
      alert('数据量不足，需要至少 100 期数据进行回测');
      return;
    }

    const btn = document.getElementById('btnBacktest');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '多窗口回测中...';
    document.getElementById('backtestResults').innerHTML = `
      <div class="backtest-summary">
        <p>正在进行 500/1000 期 × 5 seeds 滚动回测，请稍候...</p>
      </div>
    `;

    await new Promise(resolve => setTimeout(resolve, 30));

    try {
      const results = Predictor.backtestSummaryReportAsync
        ? await Predictor.backtestSummaryReportAsync(state.data, {
            chunkSize: 10,
            onProgress(progress) {
              document.getElementById('backtestResults').innerHTML = `
                <div class="backtest-summary">
                  <p>正在进行 500/1000 期 × 5 seeds 滚动回测，已完成 ${progress.completed} / ${progress.total} 期 (${progress.percent}%)...</p>
                </div>
              `;
            }
          })
        : Predictor.backtestSummaryReport(state.data);
      renderBacktestResults(results);
    } catch (error) {
      console.error('回测失败:', error);
      document.getElementById('backtestResults').innerHTML = `
        <div class="backtest-summary">
          <p>回测运行失败，请稍后重试。</p>
        </div>
      `;
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function renderBacktestComparison(results, isPl3) {
    if (!results.strategyStats && !results.baselineStats) return '';

    const baselineLabels = {
      random: '纯随机基线',
      constrainedRandom: '约束随机基线'
    };
    const denom = isPl3 ? 3 : 5;

    function row(label, stat, type) {
      if (!stat) return '';
      const frontPct = Math.min(100, (stat.avgFrontMatch / denom) * 100).toFixed(1);
      const value = isPl3
        ? `${stat.avgFrontMatch.toFixed(3)} / 3`
        : `${stat.avgFrontMatch.toFixed(3)} / 5 · ${stat.avgBackMatch.toFixed(3)} / 2`;
      return `<div class="bt-bar-row ${type}">
        <span class="bt-bar-label">${label}</span>
        <div class="progress-bar"><div class="progress-fill" style="width: ${frontPct}%"></div></div>
        <span class="bt-bar-value">${value}</span>
      </div>`;
    }

    const strategyRows = Object.entries(results.strategyStats || {})
      .map(([name, stat]) => row(STRATEGY_LABELS[name] || name, stat, 'strategy'))
      .join('');
    const baselineRows = Object.entries(results.baselineStats || {})
      .map(([name, stat]) => row(baselineLabels[name] || name, stat, 'baseline'))
      .join('');

    return `
      <div class="backtest-detail">
        <h4>策略与基线对比 <span class="bt-seed">seed ${results.seed || '-'}</span></h4>
        <div class="backtest-bars">
          ${strategyRows}
          ${baselineRows}
        </div>
      </div>
    `;
  }

  function renderBacktestAggregateReport(report, isPl3) {
    if (!report.windowReports || report.windowReports.length === 0) {
      return `
        <div class="backtest-summary">
          <p>当前数据量不足，无法生成多窗口回测报告。</p>
        </div>
      `;
    }

    const baselineLabels = {
      random: '纯随机基线',
      constrainedRandom: '约束随机基线'
    };
    const strategyOrder = ['cold', 'hot', 'balanced', 'gap', 'random'];
    const baselineOrder = ['random', 'constrainedRandom'];
    const denom = isPl3 ? 3 : 5;

    function fmt(value) {
      return Number(value || 0).toFixed(3);
    }

    function row(label, stat, type) {
      if (!stat) return '';
      const frontPct = Math.min(100, (stat.avgFrontMatch / denom) * 100).toFixed(1);
      const range = isPl3
        ? `范围 ${fmt(stat.frontMin)}-${fmt(stat.frontMax)}`
        : `前区范围 ${fmt(stat.frontMin)}-${fmt(stat.frontMax)}，后区范围 ${fmt(stat.backMin)}-${fmt(stat.backMax)}`;
      const value = isPl3
        ? `${fmt(stat.avgFrontMatch)} ± ${fmt(stat.frontStd)} / 3`
        : `前 ${fmt(stat.avgFrontMatch)} ± ${fmt(stat.frontStd)} / 5 · 后 ${fmt(stat.avgBackMatch)} ± ${fmt(stat.backStd)} / 2`;

      return `<div class="bt-bar-row ${type}">
        <span class="bt-bar-label">${label}</span>
        <div class="progress-bar"><div class="progress-fill" style="width: ${frontPct}%"></div></div>
        <span class="bt-bar-value" title="${range}">${value}</span>
      </div>`;
    }

    const windowsText = report.windows.join(' / ');
    const seedsText = report.seeds.join(', ');
    const windowHtml = report.windowReports.map(windowReport => {
      const strategyStats = windowReport.summary.strategyStats || {};
      const baselineStats = windowReport.summary.baselineStats || {};
      const strategyRows = strategyOrder
        .map(name => row(STRATEGY_LABELS[name] || name, strategyStats[name], 'strategy'))
        .join('');
      const baselineRows = baselineOrder
        .map(name => row(baselineLabels[name] || name, baselineStats[name], 'baseline'))
        .join('');

      return `
        <div class="backtest-detail">
          <h4>${windowReport.window} 期窗口 <span class="bt-seed">${windowReport.seedCount} seeds</span></h4>
          <div class="backtest-bars">
            ${strategyRows}
            ${baselineRows}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="backtest-summary">
        <p>多 seed、多窗口汇总：窗口 <strong>${windowsText}</strong> 期，<strong>${report.seedCount}</strong> 个 seeds。</p>
        <div class="backtest-grid">
          <div class="backtest-item">
            <span class="bt-label">回测窗口</span>
            <span class="bt-value">${windowsText}</span>
          </div>
          <div class="backtest-item">
            <span class="bt-label">随机种子</span>
            <span class="bt-value">${report.seedCount}</span>
          </div>
        </div>
        <p class="bt-seed-list">seeds: ${seedsText}</p>
        ${windowHtml}
      </div>
    `;
  }

  function renderBacktestResults(results) {
    const container = document.getElementById('backtestResults');
    const isPl3 = isPL3();

    if (results && results.reportType === 'multiSeedWindow') {
      container.innerHTML = renderBacktestAggregateReport(results, isPl3);
      return;
    }

    const comparisonHtml = renderBacktestComparison(results, isPl3);
    
    if (isPl3) {
      container.innerHTML = `
        <div class="backtest-summary">
          <p>在最近 <strong>${results.totalTests}</strong> 期中进行位置命中回测验证：</p>
          <div class="backtest-grid">
            <div class="backtest-item">
              <span class="bt-label">平均直选位置命中</span>
              <span class="bt-value">${results.avgFrontMatch.toFixed(2)} / 3</span>
            </div>
          </div>
          ${comparisonHtml}
          <div class="backtest-detail">
            <h4>直选命中位置数分布</h4>
            <div class="backtest-bars">
              ${Object.entries(results.matchStats)
                .filter(([k]) => k.startsWith('front'))
                .map(([k, v]) => {
                  const n = k.replace('front', '');
                  const pct = ((v / results.totalTests) * 100).toFixed(1);
                  return `<div class="bt-bar-row">
                    <span class="bt-bar-label">精准命中 ${n} 位</span>
                    <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
                    <span class="bt-bar-value">${v} 次 (${pct}%)</span>
                  </div>`;
                }).join('')}
            </div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="backtest-summary">
          <p>在最近 <strong>${results.totalTests}</strong> 期中进行回测验证：</p>
          <div class="backtest-grid">
            <div class="backtest-item">
              <span class="bt-label">平均前区命中</span>
              <span class="bt-value">${results.avgFrontMatch.toFixed(2)} / 5</span>
            </div>
            <div class="backtest-item">
              <span class="bt-label">平均后区命中</span>
              <span class="bt-value">${results.avgBackMatch.toFixed(2)} / 2</span>
            </div>
          </div>
          ${comparisonHtml}
          <div class="backtest-detail">
            <h4>前区命中分布</h4>
            <div class="backtest-bars">
              ${Object.entries(results.matchStats)
                .filter(([k]) => k.startsWith('front'))
                .map(([k, v]) => {
                  const n = k.replace('front', '');
                  const pct = ((v / results.totalTests) * 100).toFixed(1);
                  return `<div class="bt-bar-row">
                    <span class="bt-bar-label">命中 ${n} 个</span>
                    <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
                    <span class="bt-bar-value">${v} 次 (${pct}%)</span>
                  </div>`;
                }).join('')}
            </div>
            <h4>后区命中分布</h4>
            <div class="backtest-bars">
              ${Object.entries(results.matchStats)
                .filter(([k]) => k.startsWith('back'))
                .map(([k, v]) => {
                  const n = k.replace('back', '');
                  const pct = ((v / results.totalTests) * 100).toFixed(1);
                  return `<div class="bt-bar-row">
                    <span class="bt-bar-label">命中 ${n} 个</span>
                    <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
                    <span class="bt-bar-value">${v} 次 (${pct}%)</span>
                  </div>`;
                }).join('')}
            </div>
          </div>
        </div>
      `;
    }
  }

  // ==================== 事件绑定 ====================
  function bindEvents() {
    // 顶级彩种切换：先同步视觉反馈（active class），再走 hash 路由异步加载
    document.getElementById('lotterySelector').addEventListener('click', (e) => {
      const tab = e.target.closest('.selector-tab');
      if (!tab) return;
      const lottery = tab.dataset.lottery;
      if (tab.classList.contains('active')) return;
      document.querySelectorAll('.selector-tab').forEach(t => t.classList.toggle('active', t === tab));
      window.location.hash = lottery;
    });

    // 导航标签切换
    document.getElementById('navTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.nav-tab');
      if (!tab) return;
      
      const section = tab.dataset.section;
      switchSection(section);
    });
    
    // 统计子标签
    document.getElementById('statsTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.sub-tab');
      if (!tab) return;
      
      const stat = tab.dataset.stat;
      
      // 切换标签样式
      document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // 切换面板
      document.querySelectorAll('.stat-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('panel' + stat.charAt(0).toUpperCase() + stat.slice(1));
      if (panel) {
        panel.classList.add('active');
        // 延迟渲染图表以确保面板可见
        setTimeout(() => renderStats(stat), 50);
      }
    });

    document.getElementById('winningCheckerModal').addEventListener('click', (e) => {
      if (e.target.id === 'winningCheckerModal') {
        hideWinningChecker();
      }
    });

    document.getElementById('predictionHistoryModal').addEventListener('click', (e) => {
      if (e.target.id === 'predictionHistoryModal') {
        hidePredictionHistoryModal();
      }
    });
    
    // 搜索筛选
    const debouncedFilter = debounce(() => {
      state.searchKeyword = document.getElementById('searchInput').value.trim();
      filterHistory();
    }, 250);
    document.getElementById('searchInput').addEventListener('input', debouncedFilter);
    
    document.getElementById('yearFilter').addEventListener('change', (e) => {
      state.yearFilter = e.target.value;
      filterHistory();
    });
    
    // 分页
    document.getElementById('historyPagination').addEventListener('click', (e) => {
      const btn = e.target.closest('.page-btn');
      if (!btn || btn.disabled) return;
      state.historyPage = parseInt(btn.dataset.page);
      renderHistory();
      // 滚动到表格顶部
      document.getElementById('sectionHistory').scrollIntoView({ behavior: 'smooth' });
    });
    
    // 走势号码选择
    document.getElementById('trendSelector').addEventListener('click', (e) => {
      const btn = e.target.closest('.trend-num-btn');
      if (!btn) return;
      
      const num = parseInt(btn.dataset.num);
      const idx = state.selectedTrendNumbers.indexOf(num);
      
      if (idx >= 0) {
        state.selectedTrendNumbers.splice(idx, 1);
        btn.classList.remove('active');
      } else {
        if (state.selectedTrendNumbers.length >= 5) {
          const oldNum = state.selectedTrendNumbers.shift();
          const oldBtn = document.querySelector(`.trend-num-btn[data-num="${oldNum}"]`);
          if (oldBtn) oldBtn.classList.remove('active');
          showToast('最多选择 5 个号码');
        }
        state.selectedTrendNumbers.push(num);
        btn.classList.add('active');
      }
      
      Charts.drawTrendChart('chartTrend', state.data, state.selectedTrendNumbers);
    });
  }

  function switchSection(name) {
    if (isWorldCup() && name !== 'worldcup') {
      return;
    }

    state.currentSection = name;
    
    // 切换标签
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector(`.nav-tab[data-section="${name}"]`);
    if (activeTab) activeTab.classList.add('active');
    
    // 切换区域
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
    
    // 按需渲染
    switch(name) {
      case 'history':
        renderHistory();
        break;
      case 'stats':
        renderStatsOverview();
        renderStats(getActiveStatName());
        break;
      case 'predict':
        break;
    }
  }

  async function showWorldCup() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = 'flex';
    overlay.classList.remove('fade-out');

    state.currentLottery = 'worldcup';
    applyLotteryCopy();

    document.querySelectorAll('.selector-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.lottery === 'worldcup');
    });

    if (state.countdownTimerId !== null) {
      clearInterval(state.countdownTimerId);
      state.countdownTimerId = null;
    }

    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('sectionWorldcup').classList.add('active');

    const loadStart = Date.now();
    if (window.WorldCup && typeof window.WorldCup.init === 'function') {
      await window.WorldCup.init();
    }
    applyLotteryCopy();

    const elapsed = Date.now() - loadStart;
    const minDisplay = 300;
    if (elapsed < minDisplay) await new Promise(r => setTimeout(r, minDisplay - elapsed));

    overlay.classList.add('fade-out');
    setTimeout(() => overlay.style.display = 'none', 500);
  }

  // ==================== 初始化 ====================
  // ==================== 彩种智能切换 ====================
  async function switchLottery(type) {
    if (!LOTTERY_CONFIG[type] || state.currentLottery === type) return;

    if (type === 'worldcup') {
      await showWorldCup();
      return;
    }

    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = 'flex';
    overlay.classList.remove('fade-out');

    state.currentLottery = type;
    applyLotteryCopy();
    resetLotteryState();

    // 切换 active tabs
    document.querySelectorAll('.selector-tab').forEach(t => {
      if (t.dataset.lottery === type) t.classList.add('active');
      else t.classList.remove('active');
    });

    if (!LOTTERY_SECTION_NAMES.includes(state.currentSection)) {
      state.currentSection = 'home';
    }

    const loadStart = Date.now();
    const loaded = await loadData();
    loadPredictionRecords();
    loadStrategyEvolution();
    renderPredictionHistory();

    const elapsed = Date.now() - loadStart;
    const minDisplay = 300;
    if (elapsed < minDisplay) await new Promise(r => setTimeout(r, minDisplay - elapsed));

    overlay.classList.add('fade-out');
    setTimeout(() => overlay.style.display = 'none', 500);

    if (loaded) {
      renderHome();
      switchSection(state.currentSection);
    } else {
      renderHome();
    }
  }

  // ==================== 排列三中奖比对算法 ====================
  function checkPL3Winning(input, target) {
    if (input[0] === target[0] && input[1] === target[1] && input[2] === target[2]) {
      return { prize: '直选', fCount: 3, bCount: 0 };
    }

    const sInput = [...input].sort((a, b) => a - b);
    const sTarget = [...target].sort((a, b) => a - b);

    if (sInput[0] === sTarget[0] && sInput[1] === sTarget[1] && sInput[2] === sTarget[2]) {
      const targetSet = new Set(target);
      if (targetSet.size === 2) {
        return { prize: '组三', fCount: 2, bCount: 1 };
      } else if (targetSet.size === 3) {
        return { prize: '组六', fCount: 3, bCount: 0 };
      }
    }

    return { prize: null, fCount: 0, bCount: 0 };
  }

  async function handleHashRoute() {
    const hash = window.location.hash.substring(1);
    const validRoutes = ['dlt', 'pl3', 'worldcup'];
    if (!hash || !validRoutes.includes(hash)) {
      window.location.hash = 'dlt';
      return;
    }
    await switchLottery(hash);
  }

  // ==================== 初始化 ====================
  async function init() {
    try {
      resetStatsTabs();
      bindEvents();

      // 监听哈希路由变化
      window.addEventListener('hashchange', handleHashRoute);

      // 首次加载时处理路由
      await handleHashRoute();
    } catch (error) {
      console.error('应用初始化失败:', error);
    }
  }

  // 暴露全局接口
  window.App = {
    generatePredictions,
    copyAllPredictions,
    copyPredictionRecord,
    showPredictionHistoryModal,
    hidePredictionHistoryModal,
    showWinningChecker,
    hideWinningChecker,
    checkCustomNumbers,
    runBacktest,
    switchSection,
    switchLottery
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
