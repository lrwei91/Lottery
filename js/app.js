/**
 * 超级大乐透 - 主应用逻辑
 * 负责数据加载、页面渲染、交互逻辑
 */

;(function() {
  'use strict';

  // ==================== 应用状态 ====================
  const state = {
    currentLottery: 'dlt', // 'dlt' (超级大乐透) 或 'pl3' (排列三)
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
    predictionRecords: []
  };

  const PREDICTION_HISTORY_LIMIT = 20;

  // ==================== 工具函数 ====================
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

  function inferNextIssue(issue) {
    const raw = String(issue || '');
    if (!/^\d+$/.test(raw)) return '下一期';
    return String(Number(raw) + 1).padStart(raw.length, '0');
  }

  function createBall(num, zone) {
    const ball = document.createElement('div');
    ball.className = `ball ${zone}`;
    ball.textContent = padNum(num);
    return ball;
  }

  function createBallHTML(num, zone) {
    return `<div class="ball ${zone}">${padNum(num)}</div>`;
  }

  // ==================== 数据加载 ====================
  async function loadData() {
    try {
      const isPl3 = state.currentLottery === 'pl3';
      const filepath = isPl3 ? 'data/pl3_data.json' : 'data/lottery_data.json';
      const res = await fetch(filepath + '?t=' + Date.now(), { cache: 'no-cache' });
      if (!res.ok) throw new Error('数据文件加载失败');
      const json = await res.json();
      
      state.data = json.data || [];
      state.total = json.total || state.data.length;
      state.updateTime = json.updateTime || '';
      state.filteredData = [...state.data];
      
      // 更新数据徽章
      document.getElementById('dataCount').innerHTML = 
        `<span class="badge-dot"></span>共 ${state.total} 期数据`;
      
      if (state.updateTime) {
        const d = new Date(state.updateTime);
        document.getElementById('updateTime').textContent = 
          `更新于 ${d.getFullYear()}-${padNum(d.getMonth()+1)}-${padNum(d.getDate())}`;
      }
      
      // 初始化年份筛选
      initYearFilter();
      
      return true;
    } catch (e) {
      console.error('加载数据失败:', e);
      document.getElementById('dataCount').innerHTML = 
        `<span class="badge-dot error"></span>数据加载失败`;
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
    if (state.data.length === 0) return;
    
    const latest = state.data[0];
    
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
    latest.back.forEach((num, i) => {
      const ball = createBall(num, 'back');
      ball.style.animationDelay = (0.6 + i * 0.12) + 's';
      backContainer.appendChild(ball);
    });
    
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
    const isPl3 = state.currentLottery === 'pl3';
    
    list.innerHTML = recent.map(d => `
      <div class="draw-item">
        <div class="draw-item-info">
          <span class="draw-item-issue">第 ${d.issue} 期</span>
          <span class="draw-item-date">${d.date}</span>
        </div>
        <div class="draw-item-balls">
          ${d.front.map(n => createBallHTML(n, 'front small')).join('')}
          ${isPl3 ? '' : `
            <span class="draw-item-plus">+</span>
            ${d.back.map(n => createBallHTML(n, 'back small')).join('')}
          `}
        </div>
      </div>
    `).join('');
  }

  // ==================== 倒计时 ====================
  function getNextDrawTime() {
    const now = new Date();
    const isPl3 = state.currentLottery === 'pl3';

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
    
    let next = new Date(now);
    
    for (let i = 0; i < 7; i++) {
      next = new Date(now.getTime() + i * 86400000);
      const day = next.getDay();
      if (drawDays.includes(day)) {
        next.setHours(drawHour, drawMinute, 0, 0);
        if (next > now) return next;
      }
    }
    
    // Fallback: next week
    next = new Date(now.getTime() + 7 * 86400000);
    return next;
  }

  function startCountdown() {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    function update() {
      const now = new Date();
      const next = getNextDrawTime();
      const diff = next - now;
      
      if (diff <= 0) {
        document.getElementById('countdownTimer').innerHTML = '<div class="countdown-live">🔴 开奖中...</div>';
        return;
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
    setInterval(update, 1000);
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
    const page = state.historyPage;
    const start = (page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const pageData = data.slice(start, end);
    
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = pageData.map(d => `
      <tr>
        <td><span class="issue-num">${d.issue}</span></td>
        <td>${d.date || '--'}</td>
        <td>
          <div class="ball-row table-balls">
            ${d.front.map(n => createBallHTML(n, 'front mini')).join('')}
          </div>
        </td>
        <td>
          <div class="ball-row table-balls">
            ${d.back.map(n => createBallHTML(n, 'back mini')).join('')}
          </div>
        </td>
        <td>${formatMoney(d.sales)}</td>
        <td>${formatMoney(d.pool)}</td>
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
    
    // 页码
    const maxVisible = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
      html += `<button class="page-btn" data-page="1">1</button>`;
      if (startPage > 2) html += `<span class="page-ellipsis">...</span>`;
    }
    
    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<span class="page-ellipsis">...</span>`;
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
    
    const isPl3 = state.currentLottery === 'pl3';
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
    }
  }

  function renderFrequencyStats() {
    const freq = Predictor.frequencyAnalysis(state.data);
    renderFrequencySummary('freqFrontSummary', freq.front);
    Charts.drawFrequencyChart('chartFreqFront', freq, 'front');
    if (state.currentLottery !== 'pl3') {
      renderFrequencySummary('freqBackSummary', freq.back);
      Charts.drawFrequencyChart('chartFreqBack', freq, 'back');
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
    const isPl3 = state.currentLottery === 'pl3';
    
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
    if (state.currentLottery !== 'pl3') {
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
    const isPl3 = state.currentLottery === 'pl3';
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
    
    const predictions = Predictor.generateMultiplePredictions(state.data, 5);
    state.predictions = predictions;
    savePredictionRecord(predictions);
    
    renderPredictions(predictions);
    renderPredictionHistory();
    
    // 显示复制按钮与回测区域
    document.getElementById('btnCopyAll').style.display = 'inline-flex';
    document.getElementById('backtestSection').style.display = 'block';
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
      return {
        frontMatches: result.fCount,
        backMatches: 0,
        prize: result.prize,
        matchedFront: prediction.front.filter((n, index) => {
          if (result.prize === '直选') return n === draw.front[index];
          return result.prize && draw.front.includes(n);
        }),
        matchedBack: []
      };
    }

    const matchedFront = prediction.front.filter(n => draw.front.includes(n));
    const matchedBack = prediction.back.filter(n => draw.back.includes(n));
    const prize = getPrizeTierName(matchedFront.length, matchedBack.length);
    return {
      frontMatches: matchedFront.length,
      backMatches: matchedBack.length,
      prize,
      matchedFront,
      matchedBack
    };
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
    return numbers.map(num => {
      const isMatch = matched.includes(num);
      return `<span class="history-ball ${zone} ${isMatch ? 'match' : ''}">${padNum(num)}</span>`;
    }).join('');
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

    const isPl3 = state.currentLottery === 'pl3';
    const strategyLabels = {
      cold: '冷号优先',
      hot: '热号优先',
      balanced: '均衡推荐',
      gap: '遗漏回补',
      random: '布林线策略'
    };

    section.style.display = 'block';
    list.innerHTML = state.predictionRecords.map(record => {
      const reviewDraw = resolveReviewDraw(record);
      const statusText = reviewDraw
        ? `已按第 ${reviewDraw.issue} 期复盘`
        : `等待第 ${record.targetIssue} 期开奖`;
      const statusClass = reviewDraw ? 'reviewed' : 'pending';

      const tickets = record.predictions.map((prediction, index) => {
        const evaluation = evaluatePrediction(prediction, reviewDraw, isPl3);
        const resultText = !evaluation
          ? '待开奖'
          : isPl3
            ? (evaluation.prize ? `命中 ${evaluation.prize}` : `位置命中 ${evaluation.frontMatches}/3`)
            : `${evaluation.frontMatches}+${evaluation.backMatches}${evaluation.prize ? ' · ' + evaluation.prize : ''}`;

        return `
          <div class="prediction-history-ticket">
            <div class="history-ticket-meta">
              <span>${index + 1}. ${strategyLabels[prediction.strategy] || prediction.strategy}</span>
              <strong class="${evaluation && evaluation.prize ? 'win' : ''}">${resultText}</strong>
            </div>
            <div class="history-ticket-balls">
              ${renderMiniBalls(prediction.front, 'front', evaluation ? evaluation.matchedFront : [])}
              ${isPl3 ? '' : '<span class="history-plus">+</span>'}
              ${isPl3 ? '' : renderMiniBalls(prediction.back, 'back', evaluation ? evaluation.matchedBack : [])}
            </div>
          </div>
        `;
      }).join('');

      return `
        <article class="prediction-history-item">
          <div class="history-record-head">
            <div>
              <h3>${record.type === 'pl3' ? '排列三' : '大乐透'} · ${formatRecordTime(record.createdAt)}</h3>
              <p>使用截至第 ${record.baseIssue || '--'} 期的历史数据，预测第 ${record.targetIssue} 期</p>
            </div>
            <span class="history-status ${statusClass}">${statusText}</span>
          </div>
          <div class="prediction-history-tickets">
            ${tickets}
          </div>
        </article>
      `;
    }).join('');
  }

  function clearPredictionHistory() {
    if (!state.predictionRecords.length) return;
    state.predictionRecords = [];
    persistPredictionRecords();
    renderPredictionHistory();
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
    
    const strategyLabels = {
      cold: '❄️ 冷号优先',
      hot: '🔥 热号优先',
      balanced: '⚖️ 均衡推荐',
      gap: '📊 遗漏回补',
      random: '📉 布林线策略'
    };

    const isPl3 = state.currentLottery === 'pl3';
    
    grid.innerHTML = predictions.map((p, i) => `
      <div class="prediction-card card" style="animation-delay: ${i * 0.1}s">
        <div class="pred-header">
          <span class="pred-label">${strategyLabels[p.strategy] || p.strategy}</span>
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
        <div class="pred-reasoning">${p.reasoning || ''}</div>
      </div>
    `).join('');
  }

  function copyAllPredictions() {
    if (!state.predictions || state.predictions.length === 0) return;

    const isPl3 = state.currentLottery === 'pl3';
    const text = state.predictions.map(p => {
      const frontStr = p.front.map(padNum).join(' ');
      if (isPl3) return frontStr;
      const backStr = p.back.map(padNum).join(' ');
      return `${frontStr} + ${backStr}`;
    }).join('\n');

    const doFeedback = () => {
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
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(doFeedback).catch(err => {
        console.warn('Navigator clipboard failed, trying fallback:', err);
        fallbackCopy(text, doFeedback);
      });
    } else {
      fallbackCopy(text, doFeedback);
    }
  }

  // ==================== 号码比对模块 ====================
  function showWinningChecker() {
    const modal = document.getElementById('winningCheckerModal');
    if (!modal) return;
    
    // 清空上次的数据与结果
    document.getElementById('customNumbersInput').value = '';
    const resultsContainer = document.getElementById('checkerResults');
    resultsContainer.innerHTML = '';
    resultsContainer.style.display = 'none';
    
    modal.style.display = 'flex';
  }

  function hideWinningChecker() {
    const modal = document.getElementById('winningCheckerModal');
    if (modal) {
      modal.style.display = 'none';
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
    const isPl3 = state.currentLottery === 'pl3';

    const lines = inputVal.split('\n');
    let html = '<h4>核对结果对比（对比最新第 ' + latestDraw.issue + ' 期）</h4>';
    let hasValidLines = false;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const nums = trimmed.match(/\d+/g);

      if (isPl3) {
        if (!nums || nums.length < 3) {
          html += `
            <div class="checker-item" style="border-color: var(--hot); margin-bottom: 8px;">
              <span style="color: var(--hot); font-size: 0.8rem;">❌ 第 ${index + 1} 行格式有误，请确保包含 3 位排列三号码（例如：4 4 3）</span>
            </div>
          `;
          return;
        }

        const digits = nums.slice(0, 3).map(Number);
        const isRangeValid = digits.every(n => n >= 0 && n <= 9);

        if (!isRangeValid) {
          html += `
            <div class="checker-item" style="border-color: var(--hot); margin-bottom: 8px;">
              <span style="color: var(--hot); font-size: 0.8rem;">❌ 第 ${index + 1} 行号码范围超出限制 (每位数字0-9)</span>
            </div>
          `;
          return;
        }

        hasValidLines = true;
        const checkResult = checkPL3Winning(digits, frontTarget);
        const prizeName = checkResult.prize;

        html += `
          <div class="checker-item ${prizeName ? 'win' : ''}" style="margin-bottom: 8px;">
            <div class="checker-item-balls">
              ${digits.map((n, j) => {
                const isMatch = (prizeName === '直选' && n === frontTarget[j]) || (prizeName && frontTarget.includes(n));
                return `<span class="checker-ball front ${isMatch ? 'match' : ''}">${n}</span>`;
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
          html += `
            <div class="checker-item" style="border-color: var(--hot); margin-bottom: 8px;">
              <span style="color: var(--hot); font-size: 0.8rem;">❌ 第 ${index + 1} 行格式有误，请确保包含 5个前区 + 2个后区号码</span>
            </div>
          `;
          return;
        }

        const front = nums.slice(0, 5).map(Number).sort((a, b) => a - b);
        const back = nums.slice(5, 7).map(Number).sort((a, b) => a - b);

        // 验证范围
        const isFrontValid = front.every(n => n >= 1 && n <= 35);
        const isBackValid = back.every(n => n >= 1 && n <= 12);

        if (!isFrontValid || !isBackValid) {
          html += `
            <div class="checker-item" style="border-color: var(--hot); margin-bottom: 8px;">
              <span style="color: var(--hot); font-size: 0.8rem;">❌ 第 ${index + 1} 行号码范围超出限制 (前区1-35，后区1-12)</span>
            </div>
          `;
          return;
        }

        const frontSet = new Set(front);
        const backSet = new Set(back);
        if (frontSet.size !== 5 || backSet.size !== 2) {
          html += `
            <div class="checker-item" style="border-color: var(--hot); margin-bottom: 8px;">
              <span style="color: var(--hot); font-size: 0.8rem;">❌ 第 ${index + 1} 行包含重复号码，前区5个和后区2个号码均不能重复</span>
            </div>
          `;
          return;
        }

        hasValidLines = true;

        const matchedFront = front.filter(n => frontTarget.includes(n));
        const matchedBack = back.filter(n => backTarget.includes(n));
        const fCount = matchedFront.length;
        const bCount = matchedBack.length;

        const prizeName = getPrizeTierName(fCount, bCount);

        html += `
          <div class="checker-item ${prizeName ? 'win' : ''}" style="margin-bottom: 8px;">
            <div class="checker-item-balls">
              ${front.map(n => {
                const isMatch = frontTarget.includes(n);
                return `<span class="checker-ball front ${isMatch ? 'match' : ''}">${padNum(n)}</span>`;
              }).join('')}
              
              <span class="checker-ball plus">+</span>
              
              ${back.map(n => {
                const isMatch = backTarget.includes(n);
                return `<span class="checker-ball back ${isMatch ? 'match' : ''}">${padNum(n)}</span>`;
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

    const strategyLabels = {
      cold: '冷号优先',
      hot: '热号优先',
      balanced: '均衡推荐',
      gap: '遗漏回补',
      random: '布林线策略'
    };
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
      .map(([name, stat]) => row(strategyLabels[name] || name, stat, 'strategy'))
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

    const strategyLabels = {
      cold: '冷号优先',
      hot: '热号优先',
      balanced: '均衡推荐',
      gap: '遗漏回补',
      random: '布林线策略'
    };
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
        .map(name => row(strategyLabels[name] || name, strategyStats[name], 'strategy'))
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
    const isPl3 = state.currentLottery === 'pl3';

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
    // 顶级彩种切换
    document.getElementById('lotterySelector').addEventListener('click', (e) => {
      const tab = e.target.closest('.selector-tab');
      if (!tab) return;
      const lottery = tab.dataset.lottery;
      switchLottery(lottery);
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
    
    // 搜索筛选
    document.getElementById('searchInput').addEventListener('input', (e) => {
      state.searchKeyword = e.target.value.trim();
      filterHistory();
    });
    
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
          // 最多选5个
          const oldNum = state.selectedTrendNumbers.shift();
          const oldBtn = document.querySelector(`.trend-num-btn[data-num="${oldNum}"]`);
          if (oldBtn) oldBtn.classList.remove('active');
        }
        state.selectedTrendNumbers.push(num);
        btn.classList.add('active');
      }
      
      Charts.drawTrendChart('chartTrend', state.data, state.selectedTrendNumbers);
    });
  }

  function switchSection(name) {
    state.currentSection = name;
    
    // 切换标签
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-section="${name}"]`).classList.add('active');
    
    // 切换区域
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('section' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
    
    // 按需渲染
    switch(name) {
      case 'history':
        if (document.getElementById('historyBody').innerHTML === '') {
          renderHistory();
        }
        break;
      case 'stats':
        renderStatsOverview();
        renderStats('frequency');
        break;
      case 'predict':
        break;
    }
  }

  // ==================== 背景粒子 ====================
  function initParticles() {
    const container = document.getElementById('bgParticles');
    const count = 30;
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = Math.random() * 100 + '%';
      particle.style.top = Math.random() * 100 + '%';
      particle.style.animationDelay = Math.random() * 8 + 's';
      particle.style.animationDuration = (8 + Math.random() * 12) + 's';
      particle.style.width = particle.style.height = (2 + Math.random() * 4) + 'px';
      container.appendChild(particle);
    }
  }

  // ==================== 初始化 ====================
  // ==================== 彩种智能切换 ====================
  async function switchLottery(type) {
    if (state.currentLottery === type) return;

    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = 'flex';
    overlay.classList.remove('fade-out');

    state.currentLottery = type;

    // 切换 active tabs
    document.querySelectorAll('.selector-tab').forEach(t => {
      if (t.dataset.lottery === type) t.classList.add('active');
      else t.classList.remove('active');
    });

    const appEl = document.getElementById('app');
    if (type === 'pl3') {
      appEl.classList.remove('theme-dlt');
      appEl.classList.add('theme-pl3');

      document.getElementById('logoBallRed').textContent = '排';
      document.getElementById('logoBallBlue').textContent = '三';
      document.getElementById('logoTitle').textContent = '排列三';
      document.getElementById('logoSubtitle').textContent = '位置概率分析与智能预测';
      document.getElementById('rulesSubNote').textContent = '排列三直选、组三、组六中奖条件及奖金对照表';

      document.querySelector('.stats-overview .stat-card:nth-child(1) .stat-label').textContent = '最热中奖号码';
      document.querySelector('.stats-overview .stat-card:nth-child(2) .stat-label').textContent = '最冷中奖号码';

      state.selectedTrendNumbers = [1, 3, 5];
    } else {
      appEl.classList.remove('theme-pl3');
      appEl.classList.add('theme-dlt');

      document.getElementById('logoBallRed').textContent = '乐';
      document.getElementById('logoBallBlue').textContent = '透';
      document.getElementById('logoTitle').textContent = '超级大乐透';
      document.getElementById('logoSubtitle').textContent = '数据分析与智能预测';
      document.getElementById('rulesSubNote').textContent = '超级大乐透中奖条件及奖金对照表';

      document.querySelector('.stats-overview .stat-card:nth-child(1) .stat-label').textContent = '最热前区号码';
      document.querySelector('.stats-overview .stat-card:nth-child(2) .stat-label').textContent = '最冷前区号码';

      state.selectedTrendNumbers = [1, 5, 10];
    }

    state.searchKeyword = '';
    state.yearFilter = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('yearFilter').value = '';

    document.getElementById('historyBody').innerHTML = '';
    document.getElementById('predictionsGrid').innerHTML = '';
    document.getElementById('btnCopyAll').style.display = 'none';
    document.getElementById('backtestSection').style.display = 'none';

    const loaded = await loadData();
    loadPredictionRecords();
    renderPredictionHistory();

    overlay.classList.add('fade-out');
    setTimeout(() => overlay.style.display = 'none', 500);

    if (loaded) {
      renderHome();
      switchSection(state.currentSection);
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

  // ==================== 初始化 ====================
  async function init() {
    document.getElementById('app').classList.add('theme-dlt');
    initParticles();
    bindEvents();
    
    const loaded = await loadData();
    loadPredictionRecords();
    renderPredictionHistory();
    
    const overlay = document.getElementById('loadingOverlay');
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.style.display = 'none', 500);
    
    if (loaded) {
      renderHome();
    }
  }

  // 暴露全局接口
  window.App = {
    generatePredictions,
    copyAllPredictions,
    clearPredictionHistory,
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
