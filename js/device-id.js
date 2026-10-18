/**
 * 设备 ID 管理：所有平台统一使用同一同步空间。
 * 保留旧 ID 供历史数据追溯；本地预测记录与策略缓存不受切换影响。
 */
;(function () {
  'use strict';

  const STORAGE_KEY = 'ticai_device_id';
  const PREVIOUS_ID_KEY = 'ticai_previous_device_id';
  const DEFAULT_ID = '3722bf95-31b6-452b-9ced-76a39ccceeb0';

  function isValidId(id) {
    return typeof id === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(id.trim());
  }

  function getId() {
    try {
      const previous = localStorage.getItem(STORAGE_KEY);
      if (previous !== DEFAULT_ID) {
        if (isValidId(previous) && !localStorage.getItem(PREVIOUS_ID_KEY)) {
          localStorage.setItem(PREVIOUS_ID_KEY, previous);
        }
        localStorage.setItem(STORAGE_KEY, DEFAULT_ID);
      }
    } catch (_) {
      // 隐私模式或存储不可用时仍返回稳定的统一 ID。
    }
    return DEFAULT_ID;
  }

  function setId(newId) {
    if (!isValidId(newId) || newId.trim() !== DEFAULT_ID) return false;
    getId();
    return true;
  }

  function resetId() {
    return getId();
  }

  window.TicaiDevice = Object.freeze({
    getId,
    setId,
    resetId,
    isValidId,
    STORAGE_KEY,
    DEFAULT_ID,
  });
})();
