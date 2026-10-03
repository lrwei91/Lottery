/**
 * 大乐透 / 排列三共享预测配置。保持数据不可变，不保存“当前彩种”状态。
 */
;(function (global) {
  'use strict';

  const LOTTERY_PARAMS = Object.freeze({
    dlt: Object.freeze({ FRONT_MIN: 1, FRONT_MAX: 35, BACK_MIN: 1, BACK_MAX: 12, FRONT_COUNT: 5, BACK_COUNT: 2 }),
    pl3: Object.freeze({ FRONT_MIN: 0, FRONT_MAX: 9, BACK_MIN: 1, BACK_MAX: 0, FRONT_COUNT: 3, BACK_COUNT: 0 })
  });

  // 策略中文名的唯一来源。predictor.js 与 app-config.js 都从这里取，
  // 避免两处各维护一份导致同策略显示不同名称。
  const STRATEGY_LABELS = Object.freeze({
    gap: '遗漏回补',
    cold: '冷号优先',
    random: '布林线策略',
    balanced: '均衡推荐',
    hot: '热号优先',
    danTuo: '胆码分层'
  });

  function detectLotteryType(data) {
    if (!data || data.length === 0) return 'dlt';
    return data[0].front.length === 3 ? 'pl3' : 'dlt';
  }

  function getParams(typeOrData) {
    const type = Array.isArray(typeOrData) ? detectLotteryType(typeOrData) : typeOrData;
    return LOTTERY_PARAMS[type === 'pl3' ? 'pl3' : 'dlt'];
  }

  global.PredictorConfig = { LOTTERY_PARAMS, STRATEGY_LABELS, detectLotteryType, getParams };
})(window);
