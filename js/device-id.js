/**
 * 设备 ID 管理
 * - 首次访问：自动生成 UUID v4 存 localStorage
 * - 跨端同步：暴露 getId / setId，UI 层用二维码让用户把 ID 带到另一台设备
 * - 不依赖任何第三方库
 */
;(function () {
  'use strict';

  const STORAGE_KEY = 'ticai_device_id';

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // 旧浏览器兜底
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function isValidId(id) {
    if (typeof id !== 'string') return false;
    const trimmed = id.trim();
    if (trimmed.length < 8 || trimmed.length > 64) return false;
    return /^[a-zA-Z0-9-]+$/.test(trimmed);
  }

  function getId() {
    if (typeof localStorage === 'undefined') return generateId();
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id || !isValidId(id)) {
      id = generateId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  }

  function setId(newId) {
    if (!isValidId(newId)) return false;
    localStorage.setItem(STORAGE_KEY, newId.trim());
    return true;
  }

  function resetId() {
    localStorage.removeItem(STORAGE_KEY);
    return getId();
  }

  window.TicaiDevice = {
    getId,
    setId,
    resetId,
    isValidId,
    STORAGE_KEY,
  };
})();
