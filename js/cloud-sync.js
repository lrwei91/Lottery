/**
 * 云端同步封装
 * - 拉取：pullRecords / pullReviews（带 try-catch，KV 不可用时降级）
 * - 写入：syncRecord / syncReview（fire-and-forget，不阻塞 UI）
 * - 去重：review 用 recordId::strategy::issue 当 key，重复写入仅触发一次
 */
;(function () {
  'use strict';

  const REVIEW_DEDUP_MAX = 2000; // 防止 Set 无限膨胀
  const syncedReviewKeys = new Set();

  function getDeviceId() {
    if (!window.TicaiDevice) return null;
    return window.TicaiDevice.getId();
  }

  async function pullRecords() {
    const deviceId = getDeviceId();
    if (!deviceId || !window.TicaiRuntime?.canUseApi()) return [];
    try {
      const res = await window.TicaiRuntime.fetchWithTimeout(`/api/records?deviceId=${encodeURIComponent(deviceId)}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        console.warn('[cloud] 拉取预测记录失败 HTTP', res.status);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data.records) ? data.records : [];
    } catch (err) {
      console.warn('[cloud] 拉取预测记录异常（Upstash 未接或网络问题，本地数据不受影响）:', err);
      return [];
    }
  }

  async function pullReviews() {
    const deviceId = getDeviceId();
    if (!deviceId || !window.TicaiRuntime?.canUseApi()) return [];
    try {
      const res = await window.TicaiRuntime.fetchWithTimeout(`/api/reviews?deviceId=${encodeURIComponent(deviceId)}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        console.warn('[cloud] 拉取复盘结果失败 HTTP', res.status);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data.reviews) ? data.reviews : [];
    } catch (err) {
      console.warn('[cloud] 拉取复盘结果异常:', err);
      return [];
    }
  }

  function syncRecord(record) {
    const deviceId = getDeviceId();
    if (!deviceId || !record || !record.id || !window.TicaiRuntime?.canUseApi()) return;
    window.TicaiRuntime.fetchWithTimeout('/api/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, record }),
    }).then(function (res) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }).catch(function (err) {
      console.warn('[cloud] 同步预测记录失败:', err);
    });
  }

  function makeReviewKey(review) {
    return `${review.recordId || ''}::${review.strategy || ''}::${review.issue || ''}`;
  }

  function syncReview(review) {
    if (!review || !window.TicaiRuntime?.canUseApi()) return;
    const key = makeReviewKey(review);
    if (!key || key === '::') return;
    if (syncedReviewKeys.has(key)) return;

    // Set 上限保护
    if (syncedReviewKeys.size >= REVIEW_DEDUP_MAX) {
      // 超过上限直接清空（实际场景远到不了）
      syncedReviewKeys.clear();
    }
    syncedReviewKeys.add(key);

    const deviceId = getDeviceId();
    if (!deviceId) return;

    window.TicaiRuntime.fetchWithTimeout('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, review }),
    }).then(function (res) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }).catch(function (err) {
      console.warn('[cloud] 同步复盘失败:', err);
      // 失败时移除 key，下次 render 允许重试
      syncedReviewKeys.delete(key);
    });
  }

  function clearReviewCache() {
    syncedReviewKeys.clear();
  }

  // 从云端拉取赔率/赛程快照（Vercel daily cron 刷新）
  async function pullOddsSnapshots() {
    if (!window.TicaiRuntime?.canUseApi()) return null;
    try {
      const res = await window.TicaiRuntime.fetchWithTimeout('/api/odds/snapshots', {
        headers: { accept: 'application/json' }
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('[cloud] 拉取 odds 快照失败:', err);
      return null;
    }
  }

  // 从云端拉取 LLM 预测快照（本地 LLM 跑完 git push 后由 Vercel 部署）
  async function pullLLMPredictions() {
    try {
      const res = await fetch('data/wc_llm_predictions.json?t=' + Date.now(), {
        cache: 'no-cache'
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('[cloud] 拉取 LLM 预测失败:', err);
      return null;
    }
  }

  function getStatus() {
    return {
      deviceId: getDeviceId(),
      syncedReviewCount: syncedReviewKeys.size,
    };
  }

  window.TicaiCloud = {
    pullRecords,
    pullReviews,
    pullOddsSnapshots,
    pullLLMPredictions,
    syncRecord,
    syncReview,
    clearReviewCache,
    getStatus
  };
})();
