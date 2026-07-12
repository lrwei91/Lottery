/**
 * 彩票应用的静态配置与状态工厂，渲染/交互仍由 app.js 负责。
 */
;(function (global) {
  'use strict';

  const PREDICTION_HISTORY_LIMIT = 20;
  const PREDICTION_HISTORY_VISIBLE_LIMIT = 3;
  const LOTTERY_SECTION_NAMES = Object.freeze(['home', 'history', 'stats', 'predict']);

  const LOTTERY_CONFIG = Object.freeze({
    dlt: Object.freeze({
      label: '超级大乐透', logo: ['乐', '透'], subtitle: '数据分析与智能预测',
      filepath: 'data/lottery_data.json', drawLabel: '最新开奖结果', frontLabel: '前区', backLabel: '后区',
      historyFrontHeader: '前区号码', historyBackHeader: '后区号码', rulesNote: '超级大乐透中奖条件及奖金对照表',
      statsLabels: ['最热前区号码', '最冷前区号码', '最热后区号码', '最冷后区号码'], selectedTrendNumbers: [1, 5, 10],
      checkerPlaceholder: '输入格式示例：\n09 10 20 33 35 + 04 11\n02 06 14 22 24 + 08 11',
      checkerHelp: '请输入您的号码组合，支持核对多组（每组一行）。可以直接粘贴“一键复制”的内容：'
    }),
    pl3: Object.freeze({
      label: '排列三', logo: ['排', '三'], subtitle: '位置概率分析与智能预测',
      filepath: 'data/pl3_data.json', drawLabel: '最新开奖结果', frontLabel: '开奖号码', backLabel: '',
      historyFrontHeader: '开奖号码', rulesNote: '排列三直选、组三、组六中奖条件及奖金对照表',
      statsLabels: ['最热中奖号码', '最冷中奖号码', '最热后区号码', '最冷后区号码'], selectedTrendNumbers: [1, 3, 5],
      checkerPlaceholder: '输入格式示例：\n5 4 4\n4 6 6\n039',
      checkerHelp: '请输入您的排列三号码，支持核对多组（每组一行），每组 3 位数字。'
    }),
    worldcup: Object.freeze({
      label: '2026 世界杯', logo: ['世', '杯'], subtitle: '冠军概率与对战预测', updateTime: '数据日期 2026-05-30'
    })
  });

  const STRATEGY_LABELS = Object.freeze({
    cold: '冷号优先', hot: '热号优先', balanced: '均衡推荐', gap: '遗漏回补', random: '布林线策略', danTuo: '胆码分层'
  });
  const CONFIDENCE_LABELS = Object.freeze({
    high: { text: '高把握', color: '#22c55e' },
    balanced: { text: '平衡', color: '#fbbf24' },
    aggressive: { text: '博冷', color: '#f97316' }
  });

  function createState() {
    return {
      currentLottery: '', data: [], total: 0, updateTime: '', currentSection: 'home',
      historyPage: 1, historyPageSize: 20, searchKeyword: '', yearFilter: '', filteredData: [],
      selectedTrendNumbers: [1, 5, 10], predictions: [], predictionRecords: [], countdownTimerId: null
    };
  }

  global.TicaiAppConfig = {
    CONFIDENCE_LABELS,
    LOTTERY_CONFIG,
    LOTTERY_SECTION_NAMES,
    PREDICTION_HISTORY_LIMIT,
    PREDICTION_HISTORY_VISIBLE_LIMIT,
    STRATEGY_LABELS,
    createState
  };
})(window);
