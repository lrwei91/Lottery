/**
 * 超级大乐透 - 主应用逻辑
 * 负责数据加载、页面渲染、交互逻辑
 */

;(function() {
  'use strict';

  // ==================== 应用状态 ====================
  const state = {
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
    predictions: []
  };

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
      const res = await fetch('data/lottery_data.json');
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
    const years = new Set();
    state.data.forEach(d => {
      if (d.date) {
        const y = d.date.substring(0, 4);
        years.add(y);
      }
    });
    const select = document.getElementById('yearFilter');
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
    
    list.innerHTML = recent.map(d => `
      <div class="draw-item">
        <div class="draw-item-info">
          <span class="draw-item-issue">第 ${d.issue} 期</span>
          <span class="draw-item-date">${d.date}</span>
        </div>
        <div class="draw-item-balls">
          ${d.front.map(n => createBallHTML(n, 'front small')).join('')}
          <span class="draw-item-plus">+</span>
          ${d.back.map(n => createBallHTML(n, 'back small')).join('')}
        </div>
      </div>
    `).join('');
  }

  // ==================== 倒计时 ====================
  function getNextDrawTime() {
    const now = new Date();
    // 大乐透开奖时间：周一、三、六 20:30
    const drawDays = [1, 3, 6]; // 周一=1, 周三=3, 周六=6
    const drawHour = 20;
    const drawMinute = 30;
    
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
        `${next.getMonth()+1}月${next.getDate()}日 ${dayNames[next.getDay()]} 20:30`;
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
    
    const hotCold = Predictor.hotColdAnalysis(state.data, 300);
    
    // 获取频率数据以找出最热最冷
    const freq = Predictor.frequencyAnalysis(state.data);
    
    // 最热前区
    let maxFrontFreq = 0, hottestFront = [];
    freq.front.forEach((count, num) => {
      if (count > maxFrontFreq) { maxFrontFreq = count; hottestFront = [num]; }
      else if (count === maxFrontFreq) hottestFront.push(num);
    });
    
    // 最冷前区
    let minFrontFreq = Infinity, coldestFront = [];
    freq.front.forEach((count, num) => {
      if (count < minFrontFreq) { minFrontFreq = count; coldestFront = [num]; }
      else if (count === minFrontFreq) coldestFront.push(num);
    });
    
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
    
    document.getElementById('hottestFront').textContent = hottestFront.map(padNum).join(', ');
    document.getElementById('coldestFront').textContent = coldestFront.map(padNum).join(', ');
    document.getElementById('hottestBack').textContent = hottestBack.map(padNum).join(', ');
    document.getElementById('coldestBack').textContent = coldestBack.map(padNum).join(', ');
  }

  function renderFrequencyStats() {
    const freq = Predictor.frequencyAnalysis(state.data);
    Charts.drawFrequencyChart('chartFreqFront', freq, 'front');
    Charts.drawFrequencyChart('chartFreqBack', freq, 'back');
  }

  function renderHotColdStats() {
    const hc = Predictor.hotColdAnalysis(state.data, 300);
    
    function renderGrid(containerId, data, maxNum) {
      const container = document.getElementById(containerId);
      let html = '';
      for (let i = 1; i <= maxNum; i++) {
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
    
    renderGrid('hotcoldFrontGrid', hc.front, 35);
    renderGrid('hotcoldBackGrid', hc.back, 12);
  }

  function renderGapStats() {
    const gap = Predictor.gapAnalysis(state.data);
    Charts.drawGapChart('chartGapFront', gap, 'front');
    Charts.drawGapChart('chartGapBack', gap, 'back');
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
    // 号码选择器
    const selector = document.getElementById('trendSelector');
    let html = '<div class="trend-nums">';
    for (let i = 1; i <= 35; i++) {
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
    
    renderPredictions(predictions);
    
    // 显示复制按钮与回测区域
    document.getElementById('btnCopyAll').style.display = 'inline-flex';
    document.getElementById('backtestSection').style.display = 'block';
  }

  function copyAllPredictions() {
    if (!state.predictions || state.predictions.length === 0) return;

    // 格式化文本：每组号码一行。例如：09 10 20 33 35 + 04 11
    const text = state.predictions.map(p => {
      const frontStr = p.front.map(padNum).join(' ');
      const backStr = p.back.map(padNum).join(' ');
      return `${frontStr} + ${backStr}`;
    }).join('\n');

    navigator.clipboard.writeText(text).then(() => {
      // 成功后的微交互反馈
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
    }).catch(err => {
      console.error('复制失败:', err);
      alert('复制失败，请手动选择复制');
    });
  }

  function renderPredictions(predictions) {
    const grid = document.getElementById('predictionsGrid');
    
    const strategyLabels = {
      cold: '❄️ 冷号优先',
      hot: '🔥 热号优先',
      balanced: '⚖️ 均衡推荐',
      gap: '📊 遗漏回补',
      random: '🎲 随机加权'
    };
    
    grid.innerHTML = predictions.map((p, i) => `
      <div class="prediction-card card" style="animation-delay: ${i * 0.1}s">
        <div class="pred-header">
          <span class="pred-label">${strategyLabels[p.strategy] || p.strategy}</span>
          <span class="pred-num">方案 ${i + 1}</span>
        </div>
        <div class="pred-balls">
          <div class="pred-zone">
            <span class="zone-tag">前区</span>
            <div class="ball-row">
              ${p.front.map(n => createBallHTML(n, 'front')).join('')}
            </div>
          </div>
          <div class="pred-zone">
            <span class="zone-tag">后区</span>
            <div class="ball-row">
              ${p.back.map(n => createBallHTML(n, 'back')).join('')}
            </div>
          </div>
        </div>
        <div class="pred-reasoning">${p.reasoning || ''}</div>
      </div>
    `).join('');
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

    const lines = inputVal.split('\n');
    let html = '<h4>核对结果对比（对比最新第 ' + latestDraw.issue + ' 期）</h4>';
    let hasValidLines = false;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // 提取行中所有的数字
      const nums = trimmed.match(/\d+/g);
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

      hasValidLines = true;

      // 比对号码
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
    });

    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'flex';
  }

  function runBacktest() {
    if (state.data.length < 100) {
      alert('数据量不足，需要至少 100 期数据进行回测');
      return;
    }
    
    const results = Predictor.backtestPrediction(state.data, 50);
    renderBacktestResults(results);
  }

  function renderBacktestResults(results) {
    const container = document.getElementById('backtestResults');
    
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

  // ==================== 事件绑定 ====================
  function bindEvents() {
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
  async function init() {
    initParticles();
    bindEvents();
    
    const loaded = await loadData();
    
    // 隐藏加载遮罩
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
    showWinningChecker,
    hideWinningChecker,
    checkCustomNumbers,
    runBacktest,
    switchSection
  };

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
