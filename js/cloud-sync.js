/**
 * 云端同步封装
 * - 拉取：pullRecords / pullReviews（带 try-catch，KV 不可用时降级）
 * - 写入：syncRecord / syncReview（fire-and-forget，不阻塞 UI）
 * - 去重：review 用 recordId::strategy::issue 当 key，重复写入仅触发一次
 */
;(function () {
  'use strict';

  // 云端每设备最多保留 1000 条复盘（api/_lib/device-sync.js 的 V1_REVIEW_LIMIT），
  // 超出后云端裁剪最旧记录。客户端去重上限必须 >= 云端上限，否则会误判"已同步"并阻止重传。
  const REVIEW_DEDUP_MAX = 2000;
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

    // Set 上限保护：淘汰最旧项而非整体清空，避免丢失仍在云端的记录标记导致重复上传
    if (syncedReviewKeys.size >= REVIEW_DEDUP_MAX) {
      const oldest = syncedReviewKeys.values().next().value;
      if (oldest !== undefined) syncedReviewKeys.delete(oldest);
    }
    syncedReviewKeys.add(key);

    const deviceId = getDeviceId();
    if (!deviceId) {
      syncedReviewKeys.delete(key);
      return;
    }

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
    getStatus
  };
})();
