/**
 * 大乐透 / 排列三共享预测配置。保持数据不可变，不保存“当前彩种”状态。
 */
;(function (global) {
  'use strict';

  const LOTTERY_PARAMS = Object.freeze({
    dlt: Object.freeze({ FRONT_MIN: 1, FRONT_MAX: 35, BACK_MIN: 1, BACK_MAX: 12, FRONT_COUNT: 5, BACK_COUNT: 2 }),
    pl3: Object.freeze({ FRONT_MIN: 0, FRONT_MAX: 9, BACK_MIN: 1, BACK_MAX: 0, FRONT_COUNT: 3, BACK_COUNT: 0 })
  });

  function detectLotteryType(data) {
    if (!data || data.length === 0) return 'dlt';
    return data[0].front.length === 3 ? 'pl3' : 'dlt';
  }

  function getParams(typeOrData) {
    const type = Array.isArray(typeOrData) ? detectLotteryType(typeOrData) : typeOrData;
    return LOTTERY_PARAMS[type === 'pl3' ? 'pl3' : 'dlt'];
  }

  global.PredictorConfig = { LOTTERY_PARAMS, detectLotteryType, getParams };
})(window);
