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
    if (!deviceId) return [];
    try {
      const res = await fetch(`/api/records?deviceId=${encodeURIComponent(deviceId)}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        console.warn('[cloud] 拉取预测记录失败 HTTP', res.status);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data.records) ? data.records : [];
    } catch (err) {
      console.warn('[cloud] 拉取预测记录异常（KV 未接或网络问题，本地数据不受影响）:', err);
      return [];
    }
  }

  async function pullReviews() {
    const deviceId = getDeviceId();
    if (!deviceId) return [];
    try {
      const res = await fetch(`/api/reviews?deviceId=${encodeURIComponent(deviceId)}`, {
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
    if (!deviceId || !record || !record.id) return;
    fetch('/api/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, record }),
    }).catch(function (err) {
      console.warn('[cloud] 同步预测记录失败:', err);
    });
  }

  function makeReviewKey(review) {
    return `${review.recordId || ''}::${review.strategy || ''}::${review.issue || ''}`;
  }

  function syncReview(review) {
    if (!review) return;
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

    fetch('/api/reviews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId, review }),
    }).catch(function (err) {
      console.warn('[cloud] 同步复盘失败:', err);
      // 失败时移除 key，下次 render 允许重试
      syncedReviewKeys.delete(key);
    });
  }

  function clearReviewCache() {
    syncedReviewKeys.clear();
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
    syncRecord,
    syncReview,
    clearReviewCache,
    getStatus,
  };
})();
