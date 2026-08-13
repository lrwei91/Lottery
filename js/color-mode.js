/**
 * ticai 颜色模式控制器
 *
 * 同步加载以避免首次绘制闪烁。偏好仅保存在当前设备，
 * 不进入云同步，也不改变任何业务数据。
 */
;(function (global) {
  'use strict';

  const STORAGE_KEY = 'ticai.colorMode';
  const VALID_PREFERENCES = new Set(['light', 'dark', 'system']);
  const root = document.documentElement;
  const media = typeof global.matchMedia === 'function'
    ? global.matchMedia('(prefers-color-scheme: dark)')
    : null;
  const listeners = new Set();

  function normalize(value) {
    return VALID_PREFERENCES.has(value) ? value : 'system';
  }

  function readPreference() {
    try {
      return normalize(global.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return 'system';
    }
  }

  function resolve(preference) {
    if (preference === 'system') return media && media.matches ? 'dark' : 'light';
    return preference;
  }

  let preference = readPreference();
  let resolved = resolve(preference);

  function updateThemeColor(mode) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#11110f' : '#ffffff');
  }

  function apply(nextPreference, notify) {
    const previousPreference = preference;
    const previousResolved = resolved;
    preference = normalize(nextPreference);
    resolved = resolve(preference);

    root.setAttribute('data-color-preference', preference);
    root.setAttribute('data-color-mode', resolved);
    root.style.colorScheme = resolved;
    updateThemeColor(resolved);

    if (notify && (previousPreference !== preference || previousResolved !== resolved)) {
      listeners.forEach((listener) => {
        try {
          listener({ preference, resolved });
        } catch (error) {
          console.warn('[color-mode] 监听器执行失败:', error);
        }
      });
    }
  }

  function setPreference(nextPreference) {
    const normalized = normalize(nextPreference);
    try {
      global.localStorage.setItem(STORAGE_KEY, normalized);
    } catch (error) {
      // 存储不可用时仍应用当前会话选择。
    }
    apply(normalized, true);
    return resolved;
  }

  function handleSystemChange() {
    if (preference === 'system') apply('system', true);
  }

  if (media) {
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleSystemChange);
    } else if (typeof media.addListener === 'function') {
      media.addListener(handleSystemChange);
    }
  }

  global.TicaiColorMode = Object.freeze({
    getPreference() {
      return preference;
    },
    getResolved() {
      return resolved;
    },
    setPreference,
    subscribe(listener) {
      if (typeof listener !== 'function') return function () {};
      listeners.add(listener);
      return function unsubscribe() {
        listeners.delete(listener);
      };
    }
  });

  apply(preference, false);
})(window);
