/**
 * 运行时能力：区分 GitHub Pages 静态站与 Vercel API，并统一网络超时。
 */
;(function (global) {
  'use strict';

  const DEFAULT_TIMEOUT_MS = 5000;

  function isGitHubPages() {
    const hostname = global.location?.hostname || '';
    return hostname === 'github.io' || hostname.endsWith('.github.io');
  }

  function canUseApi() {
    return !isGitHubPages();
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = options.signal;
    const abortFromExternal = () => controller.abort();
    if (externalSignal) externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternal);
    }
  }

  global.TicaiRuntime = {
    DEFAULT_TIMEOUT_MS,
    isGitHubPages,
    canUseApi,
    fetchWithTimeout
  };
})(window);
