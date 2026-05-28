/**
 * ============================================================
 * 体彩超级大乐透 - 图表可视化引擎
 * ============================================================
 * 
 * 使用 Canvas API 绘制统计图表
 * 深色主题配色，支持 Retina 高清屏
 * 
 * 导出：window.Charts 全局对象
 */

;(function() {
  'use strict';

  // ============================================================
  // 配色常量
  // ============================================================
  const COLORS = {
    grid: 'rgba(255, 255, 255, 0.06)',
    text: '#94a3b8',
    textLight: '#64748b',
    front: '#ff4757',
    frontGrad1: '#ff6b35',
    frontGrad2: '#ff2e63',
    back: '#00d2ff',
    backGrad1: '#00d2ff',
    backGrad2: '#3a7bd5',
    accent: '#31d997',
    hot: '#ef4444',
    cold: '#3b82f6',
    warm: '#f59e0b',
    purple: '#36c5f0',
    green: '#10b981'
  };

  // 用于多线条的颜色组
  const LINE_COLORS = ['#ff4757', '#00d2ff', '#31d997', '#36c5f0', '#f59e0b'];

  // ============================================================
  // 工具函数
  // ============================================================

  /**
   * 初始化 Canvas 以支持高 DPI 屏幕
   */
  function setupCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(260, rect.width - 32); // 减去 padding
    
    // 缓存初始高度，避免高DPI屏幕下修改canvas.height造成属性二次读取时翻倍
    if (!canvas._originalHeight) {
      canvas._originalHeight = parseInt(canvas.getAttribute('height')) || 350;
    }
    const h = canvas._originalHeight;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    return { canvas, ctx, w, h, dpr };
  }

  /**
   * 绘制背景网格线
   */
  function drawGrid(ctx, w, h, padding, rows, cols) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;

    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // 横向网格
    if (rows > 0) {
      for (let i = 0; i <= rows; i++) {
        const y = padding.top + (i / rows) * plotH;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();
      }
    }

    // 纵向网格（可选）
    if (cols > 0) {
      for (let i = 0; i <= cols; i++) {
        const x = padding.left + (i / cols) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, h - padding.bottom);
        ctx.stroke();
      }
    }
  }

  function padNum(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function safeMax(values, fallback = 1) {
    if (!values || values.length === 0) return fallback;
    const max = Math.max(...values);
    return Number.isFinite(max) && max > 0 ? max : fallback;
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ============================================================
  // Resize Observer - 自动重绘图表
  // ============================================================
  const _chartCallbacks = new Map();

  function _trackChart(canvasId, fn, args) {
    _chartCallbacks.set(canvasId, { fn, args });
    const canvas = document.getElementById(canvasId);
    if (canvas && canvas.parentElement && !canvas.parentElement._resizeObserved) {
      canvas.parentElement._resizeObserved = true;
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          const entry = _chartCallbacks.get(canvasId);
          if (entry) entry.fn(...entry.args);
        });
        ro.observe(canvas.parentElement);
      }
    }
  }

  // ============================================================
  // 1. 频率柱状图
  // ============================================================

  /**
   * 绘制号码出现频率柱状图
   * @param {string} canvasId - Canvas 元素 ID
   * @param {{ front: Map, back: Map }} freqData - 频率数据
   * @param {string} zone - 'front' 或 'back'
   */
  function drawFrequencyChart(canvasId, freqData, zone = 'front') {
    _trackChart(canvasId, drawFrequencyChart, [canvasId, freqData, zone]);
    const setup = setupCanvas(canvasId);
    if (!setup) return;
    const { ctx, w, h } = setup;

    const freqMap = zone === 'front' ? freqData.front : freqData.back;
    const keys = Array.from(freqMap.keys()).map(Number).sort((a, b) => a - b);
    if (keys.length === 0) return;
    const minNum = keys[0];
    const maxNum = keys[keys.length - 1];
    const count = keys.length;

    // 获取频率值；频率分析使用时间衰减权重，图表展示统一取整，便于阅读。
    const values = [];
    for (let i = minNum; i <= maxNum; i++) {
      values.push(freqMap.get(i) || 0);
    }
    const maxVal = safeMax(values);
    const minVal = Math.min(...values);

    // 布局
    const padding = { top: 30, right: 20, bottom: 45, left: 50 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;
    const barW = Math.max(8, (plotW / count) - 4);
    const gap = (plotW - barW * count) / (count + 1);

    // 清除画布
    ctx.clearRect(0, 0, w, h);

    // 绘制网格
    drawGrid(ctx, w, h, padding, 5, 0);

    // Y轴标签
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const val = Math.round(maxVal * (1 - i / 5));
      const y = padding.top + (i / 5) * plotH;
      ctx.fillText(val.toString(), padding.left - 8, y);
    }

    // 计算平均值线
    const avgVal = values.reduce((a, b) => a + b, 0) / values.length;
    const avgY = padding.top + (1 - avgVal / maxVal) * plotH;

    // 绘制平均值线
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, avgY);
    ctx.lineTo(w - padding.right, avgY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 平均值标签
    ctx.fillStyle = COLORS.accent;
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`平均: ${avgVal.toFixed(0)}`, w - padding.right - 60, avgY - 8);

    // 绘制柱子
    for (let i = 0; i < count; i++) {
      const val = values[i];
      const displayVal = Math.round(val);
      const x = padding.left + gap + i * (barW + gap);
      const barH = (val / maxVal) * plotH;
      const y = padding.top + plotH - barH;

      // 柱子颜色 - 根据频率高低着色
      const ratio = (val - minVal) / (maxVal - minVal || 1);
      let color;
      if (ratio > 0.7) {
        color = COLORS.hot;
      } else if (ratio < 0.3) {
        color = COLORS.cold;
      } else {
        color = zone === 'front' ? COLORS.front : COLORS.back;
      }

      // 渐变填充
      const grad = ctx.createLinearGradient(x, y, x, padding.top + plotH);
      grad.addColorStop(0, color);
      grad.addColorStop(1, hexToRgba(color, 0.28));

      ctx.fillStyle = grad;
      ctx.beginPath();
      // 圆角顶部矩形
      const r = Math.min(3, barW / 2);
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.arcTo(x + barW, y, x + barW, y + r, r);
      ctx.lineTo(x + barW, padding.top + plotH);
      ctx.lineTo(x, padding.top + plotH);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.fill();

      // X轴号码标签
      ctx.fillStyle = COLORS.text;
      ctx.font = `${count > 20 ? 9 : 11}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(padNum(minNum + i), x + barW / 2, padding.top + plotH + 6);

      // 柱顶数值
      if (barH > 15) {
        ctx.fillStyle = '#fff';
        ctx.font = '9px Outfit, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(displayVal.toString(), x + barW / 2, y - 3);
      }
    }

    // 标题
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(zone === 'front' ? '前区号码 (1-35)' : '后区号码 (1-12)', padding.left, 6);
  }

  // ============================================================
  // 2. 遗漏值图表
  // ============================================================

  /**
   * 绘制当前遗漏值横向柱状图
   */
  function drawGapChart(canvasId, gapData, zone = 'front') {
    _trackChart(canvasId, drawGapChart, [canvasId, gapData, zone]);
    const setup = setupCanvas(canvasId);
    if (!setup) return;
    const { ctx, w, h } = setup;

    const gapMap = zone === 'front' ? gapData.front : gapData.back;
    const keys = Array.from(gapMap.keys()).map(Number).sort((a, b) => a - b);
    if (keys.length === 0) return;
    const minNum = keys[0];
    const maxNum = keys[keys.length - 1];
    const count = keys.length;

    // 获取数据
    const items = [];
    let maxGap = 0;
    for (let i = minNum; i <= maxNum; i++) {
      const g = gapMap.get(i) || { current: 0, max: 0, avg: 0 };
      items.push({ num: i, ...g });
      maxGap = Math.max(maxGap, g.current);
    }
    maxGap = Math.max(maxGap, 1);

    // 布局
    const padding = { top: 30, right: 60, bottom: 20, left: 45 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;
    const barH = Math.max(6, (plotH / count) - 3);
    const gap = (plotH - barH * count) / (count + 1);

    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, w, h, padding, 0, 5);

    // X轴标签
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 5; i++) {
      const val = Math.round(maxGap * (i / 5));
      const x = padding.left + (i / 5) * plotW;
      ctx.fillText(val.toString(), x, h - padding.bottom + 4);
    }

    // 绘制柱子
    for (let i = 0; i < count; i++) {
      const item = items[i];
      const y = padding.top + gap + i * (barH + gap);
      const bw = Math.max(1, (item.current / maxGap) * plotW);

      // 颜色强度与遗漏值正相关
      const intensity = item.current / maxGap;
      let color;
      if (intensity > 0.7) color = COLORS.hot;
      else if (intensity > 0.4) color = COLORS.warm;
      else color = COLORS.cold;

      const grad = ctx.createLinearGradient(padding.left, y, padding.left + bw, y);
      grad.addColorStop(0, hexToRgba(color, 0.2));
      grad.addColorStop(1, color);

      ctx.fillStyle = grad;
      ctx.beginPath();
      const r = Math.min(3, barH / 2);
      ctx.moveTo(padding.left, y);
      ctx.lineTo(Math.max(padding.left, padding.left + bw - r), y);
      ctx.arcTo(padding.left + bw, y, padding.left + bw, y + r, r);
      ctx.arcTo(padding.left + bw, y + barH, Math.max(padding.left, padding.left + bw - r), y + barH, r);
      ctx.lineTo(padding.left, y + barH);
      ctx.fill();

      // 号码标签
      ctx.fillStyle = COLORS.text;
      ctx.font = `${count > 20 ? 9 : 11}px Outfit, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(padNum(item.num), padding.left - 6, y + barH / 2);

      // 数值标签
      ctx.fillStyle = color;
      ctx.font = '10px Outfit, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${item.current} (平均${item.avg})`, padding.left + bw + 6, y + barH / 2);
    }

    // 标题
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`当前遗漏值 - ${zone === 'front' ? '前区' : '后区'}`, padding.left, 6);
  }

  // ============================================================
  // 3. 走势图
  // ============================================================

  /**
   * 绘制号码出现走势图
   * @param {string} canvasId - Canvas ID
   * @param {Array} data - 开奖数据
   * @param {number[]} selectedNumbers - 选中要查看的号码
   */
  function drawTrendChart(canvasId, data, selectedNumbers = []) {
    _trackChart(canvasId, drawTrendChart, [canvasId, data, selectedNumbers]);
    const setup = setupCanvas(canvasId);
    if (!setup) return;
    const { ctx, w, h } = setup;

    if (selectedNumbers.length === 0 || data.length === 0) {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS.textLight;
      ctx.font = '14px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('请点击号码查看走势', w / 2, h / 2);
      return;
    }

    // 取最近 60 期
    const recentData = data.slice(0, 60).reverse(); // 从旧到新
    const periods = recentData.length;

    const padding = { top: 40, right: 20, bottom: 40, left: 50 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, w, h, padding, selectedNumbers.length, Math.min(10, periods));

    // X轴标签（每隔几期显示）
    const step = Math.max(1, Math.floor(periods / 10));
    ctx.fillStyle = COLORS.textLight;
    ctx.font = '9px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < periods; i += step) {
      const x = padding.left + (i / Math.max(1, periods - 1)) * plotW;
      ctx.fillText(recentData[i].issue, x, h - padding.bottom + 8);
    }

    // 为每个选中号码绘制走势线
    selectedNumbers.forEach((num, numIdx) => {
      const color = LINE_COLORS[numIdx % LINE_COLORS.length];
      const yBase = padding.top + ((numIdx + 0.5) / selectedNumbers.length) * plotH;

      // 在每个期号位置标记是否出现
      for (let i = 0; i < periods; i++) {
        const x = padding.left + (i / Math.max(1, periods - 1)) * plotW;
        const appeared = recentData[i].front.includes(num);

        if (appeared) {
          // 出现时画实心圆
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, yBase, 5, 0, Math.PI * 2);
          ctx.fill();

          // 发光效果
          ctx.fillStyle = color + '30';
          ctx.beginPath();
          ctx.arc(x, yBase, 10, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // 未出现画小空心点
          ctx.strokeStyle = color + '40';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, yBase, 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 号码标签
      ctx.fillStyle = color;
      ctx.font = 'bold 12px Outfit, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(padNum(num), padding.left - 10, yBase);
    });

    // 标题
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('号码走势 (最近 60 期)', padding.left, 6);
  }

  // ============================================================
  // 4. 和值分布直方图
  // ============================================================

  /**
   * 绘制和值分布直方图
   */
  function drawSumDistribution(canvasId, sumData) {
    _trackChart(canvasId, drawSumDistribution, [canvasId, sumData]);
    const setup = setupCanvas(canvasId);
    if (!setup) return;
    const { ctx, w, h } = setup;

    const distribution = sumData.distribution;
    const labels = [...distribution.keys()];
    const values = [...distribution.values()];
    const maxVal = safeMax(values);
    const count = labels.length;
    if (count === 0) return;

    const padding = { top: 30, right: 20, bottom: 55, left: 50 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;
    const barW = Math.max(20, (plotW / count) - 8);
    const gap = (plotW - barW * count) / (count + 1);

    ctx.clearRect(0, 0, w, h);
    drawGrid(ctx, w, h, padding, 5, 0);

    // Y轴标签
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const val = Math.round(maxVal * (1 - i / 5));
      const y = padding.top + (i / 5) * plotH;
      ctx.fillText(val.toString(), padding.left - 8, y);
    }

    // 绘制柱子
    for (let i = 0; i < count; i++) {
      const val = values[i];
      const x = padding.left + gap + i * (barW + gap);
      const bh = (val / maxVal) * plotH;
      const y = padding.top + plotH - bh;

      const grad = ctx.createLinearGradient(x, y, x, padding.top + plotH);
      grad.addColorStop(0, COLORS.accent);
      grad.addColorStop(1, hexToRgba(COLORS.accent, 0.18));

      ctx.fillStyle = grad;
      const r = Math.min(4, barW / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.arcTo(x + barW, y, x + barW, y + r, r);
      ctx.lineTo(x + barW, padding.top + plotH);
      ctx.lineTo(x, padding.top + plotH);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.fill();

      // 标签
      ctx.fillStyle = COLORS.text;
      ctx.font = '9px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      // 旋转标签
      ctx.save();
      ctx.translate(x + barW / 2, padding.top + plotH + 6);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();

      // 柱顶数值
      if (bh > 12) {
        ctx.fillStyle = '#fff';
        ctx.font = '10px Outfit, sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.textAlign = 'center';
        ctx.fillText(val.toString(), x + barW / 2, y - 3);
      }
    }

    // 绘制正态分布曲线
    const avg = sumData.avg;
    const sd = sumData.stdDev;
    if (sd > 0) {
      ctx.strokeStyle = COLORS.purple;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();

      const totalCount = sumData.sums.length;
      const bucketWidth = (sumData.max - sumData.min + 1) / count;

      for (let px = 0; px <= plotW; px++) {
        const sumVal = sumData.min + (px / plotW) * (sumData.max - sumData.min);
        // 正态分布概率密度
        const z = (sumVal - avg) / sd;
        const pdf = Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
        const expectedCount = pdf * totalCount * bucketWidth;
        const y = padding.top + plotH - (expectedCount / maxVal) * plotH;

        if (px === 0) ctx.moveTo(padding.left + px, y);
        else ctx.lineTo(padding.left + px, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 标题
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`和值分布 (平均: ${avg.toFixed(1)}, 标准差: ${sd.toFixed(1)})`, padding.left, 6);
  }

  // ============================================================
  // 5. 热力图
  // ============================================================

  /**
   * 绘制号码热力图
   */
  function drawHeatmap(canvasId, data, zone = 'front') {
    _trackChart(canvasId, drawHeatmap, [canvasId, data, zone]);
    const setup = setupCanvas(canvasId);
    if (!setup) return;
    const { ctx, w, h } = setup;

    const maxNum = zone === 'front' ? 35 : 12;
    const minNum = 1;
    const numCount = maxNum - minNum + 1;

    // 按 10 期分组
    const groupSize = 10;
    const groups = [];
    for (let i = 0; i < Math.min(data.length, 200); i += groupSize) {
      const group = data.slice(i, i + groupSize);
      groups.push(group);
    }

    const padding = { top: 30, right: 20, bottom: 20, left: 45 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;
    const cellW = plotW / numCount;
    const cellH = Math.min(20, plotH / groups.length);

    ctx.clearRect(0, 0, w, h);

    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      for (let n = minNum; n <= maxNum; n++) {
        let count = 0;
        for (const draw of group) {
          const nums = zone === 'front' ? draw.front : draw.back;
          if (nums.includes(n)) count++;
        }

        const x = padding.left + (n - minNum) * cellW;
        const y = padding.top + g * cellH;

        // 颜色强度
        const intensity = count / groupSize;
        const color = zone === 'front' ? COLORS.front : COLORS.back;
        ctx.fillStyle = `rgba(${zone === 'front' ? '255, 71, 87' : '0, 210, 255'}, ${intensity * 0.8})`;
        ctx.fillRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);
      }
    }

    // 标题
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`号码热力图 - ${zone === 'front' ? '前区' : '后区'}`, padding.left, 12);
  }

  // ============================================================
  // 6. 饼图/环形图
  // ============================================================

  /**
   * 绘制环形图
   * @param {string} canvasId - Canvas ID
   * @param {Object} ratioData - 比例数据 { '3:2': count, ... }
   * @param {string} title - 图表标题
   */
  function drawPieChart(canvasId, ratioData, title) {
    _trackChart(canvasId, drawPieChart, [canvasId, ratioData, title]);
    const setup = setupCanvas(canvasId);
    if (!setup) return;
    const { ctx, w, h } = setup;

    const entries = Object.entries(ratioData).filter(([, v]) => v > 0);
    const total = entries.reduce((s, [, v]) => s + v, 0);

    if (total === 0) return;

    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 + 10;
    const outerR = Math.min(w, h) / 2 - 50;
    const innerR = outerR * 0.55;

    const pieColors = [
      '#ff4757', '#00d2ff', '#31d997', '#36c5f0', '#f59e0b', '#10b981',
      '#ec4899', '#8b5cf6'
    ];

    let startAngle = -Math.PI / 2;

    entries.forEach(([label, value], i) => {
      const sliceAngle = (value / total) * Math.PI * 2;
      const endAngle = startAngle + sliceAngle;
      const color = pieColors[i % pieColors.length];

      // 绘制扇区
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fill();

      // 边框
      ctx.strokeStyle = 'rgba(10, 14, 26, 0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 标签线和文字
      const midAngle = startAngle + sliceAngle / 2;
      const pct = ((value / total) * 100).toFixed(1);

      if (sliceAngle > 0.15) { // 足够大才显示标签
        const labelR = outerR + 20;
        const lx = cx + Math.cos(midAngle) * labelR;
        const ly = cy + Math.sin(midAngle) * labelR;

        ctx.fillStyle = COLORS.text;
        ctx.font = '11px Outfit, sans-serif';
        ctx.textAlign = midAngle > Math.PI / 2 && midAngle < Math.PI * 1.5 ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${label} (${pct}%)`, lx, ly);
      }

      startAngle = endAngle;
    });

    // 中心文字
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 16px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total.toString(), cx, cy - 6);
    ctx.font = '10px Outfit, sans-serif';
    ctx.fillStyle = COLORS.textLight;
    ctx.fillText('总期数', cx, cy + 12);

    // 标题
    ctx.fillStyle = COLORS.text;
    ctx.font = '13px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(title, cx, 8);
  }

  // ============================================================
  // 导出全局 Charts 对象
  // ============================================================

  window.Charts = {
    drawFrequencyChart,
    drawGapChart,
    drawTrendChart,
    drawSumDistribution,
    drawHeatmap,
    drawPieChart
  };

})();
