/**
 * 世界杯数据访问层：静态核心并行加载，实时 API 作为非阻塞增强。
 */
;(function (global) {
  'use strict';

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return response.json();
  }

  async function loadStaticBundle() {
    const stamp = Date.now();
    const namesPromise = fetchJson('data/worldcup_names.json', { cache: 'no-cache' }).catch(() => ({}));
    const benchmarkPromise = global.KimiBenchmarks
      ? global.KimiBenchmarks.load().catch(() => null)
      : Promise.resolve(null);
    const matchesPromise = fetchJson(`data/worldcup_matches.json?t=${stamp}`, { cache: 'no-cache' }).catch(() => null);
    const corePromise = fetchJson(`data/worldcup_2026.json?t=${stamp}`, { cache: 'no-cache' });
    const [names, benchmark, matches, core] = await Promise.all([
      namesPromise, benchmarkPromise, matchesPromise, corePromise
    ]);
    return { names, benchmark, matches, core };
  }

  async function loadOptionalStatic(url) {
    try {
      return await fetchJson(`${url}?t=${Date.now()}`, { cache: 'no-cache' });
    } catch {
      return null;
    }
  }

  async function loadApi(url) {
    if (!global.TicaiRuntime?.canUseApi()) return null;
    const response = await global.TicaiRuntime.fetchWithTimeout(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return response.json();
  }

  global.WorldCupData = { loadApi, loadOptionalStatic, loadStaticBundle };
})(window);
