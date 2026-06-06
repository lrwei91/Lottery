/**
 * 设备管理面板
 * - 展示当前 deviceId + 二维码（qrcodejs CDN）
 * - 支持复制 ID / 手动绑定其他设备 ID / 重置
 * - 不依赖 css 文件中的具体选择器，用内联 class
 */
;(function () {
  'use strict';

  let qrInstance = null;
  let overlayEl = null;

  function ensurePanel() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'ticaiDevicePanel';
    overlayEl.className = 'modal-overlay device-panel-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-labelledby', 'ticaiDevicePanelTitle');
    overlayEl.style.display = 'none';
    overlayEl.innerHTML = `
      <div class="modal-card card device-panel-card" role="document">
        <div class="modal-header">
          <h3 id="ticaiDevicePanelTitle">设备管理 · 跨端同步</h3>
          <button class="modal-close" data-device-action="close" aria-label="关闭">×</button>
        </div>
        <div class="modal-body device-panel-body">
          <p class="device-panel-desc">
            首次访问时会自动生成一个<strong>设备 ID</strong>。在另一台设备上把同样的 ID 粘进去，
            两端的预测记录和复盘结果就会聚合到同一份「全量真相」。
          </p>

          <div class="device-panel-id-row">
            <span class="device-panel-label">当前设备 ID</span>
            <code class="device-panel-id" id="ticaiDevicePanelId">--</code>
            <button class="btn-icon" data-device-action="copy" title="复制 ID">复制</button>
          </div>

          <div class="device-panel-qr-wrap">
            <div class="device-panel-qr" id="ticaiDevicePanelQr"></div>
            <p class="device-panel-qr-hint">用手机扫一扫，把 ID 带到另一台设备</p>
          </div>

          <details class="device-panel-details">
            <summary>手动绑定（输入另一台设备的 ID）</summary>
            <div class="device-panel-manual-row">
              <input type="text" id="ticaiDevicePanelInput" placeholder="例如：550e8400-e29b-41d4-a716-446655440000" autocomplete="off" spellcheck="false" />
              <button class="btn btn-primary" data-device-action="bind">绑定并刷新</button>
            </div>
          </details>

          <details class="device-panel-details device-panel-danger">
            <summary>重置当前设备</summary>
            <p class="device-panel-danger-hint">将生成新的设备 ID，并清空本机<strong>所有</strong>预测记录与策略缓存（云端数据不受影响）。</p>
            <button class="btn btn-danger" data-device-action="reset">确认重置</button>
          </details>

          <p class="device-panel-status" id="ticaiDevicePanelStatus"></p>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);

    // 事件代理
    overlayEl.addEventListener('click', function (e) {
      const target = e.target;
      if (target === overlayEl) return hide();
      const action = target.getAttribute && target.getAttribute('data-device-action');
      if (!action) return;
      if (action === 'close') hide();
      else if (action === 'copy') handleCopy();
      else if (action === 'bind') handleBind();
      else if (action === 'reset') handleReset();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && overlayEl && overlayEl.style.display !== 'none') hide();
    });
    return overlayEl;
  }

  function refreshQr() {
    const qrEl = document.getElementById('ticaiDevicePanelQr');
    if (!qrEl) return;
    qrEl.innerHTML = '';

    if (typeof QRCode === 'undefined') {
      // CDN 不可用时降级：展示手动复制提示（不影响功能）
      qrEl.style.background = 'rgba(255, 200, 100, 0.06)';
      qrEl.style.color = '#d4a558';
      qrEl.style.fontSize = '0.82rem';
      qrEl.style.padding = '20px';
      qrEl.style.lineHeight = '1.6';
      qrEl.innerHTML = '二维码库未加载<br>请直接复制上方设备 ID';
      console.warn('[device-panel] QRCode 库未加载，已降级为文字提示');
      return;
    }
    try {
      qrEl.style.cssText = '';
      qrInstance = new QRCode(qrEl, {
        text: window.TicaiDevice.getId(),
        width: 200,
        height: 200,
        colorDark: '#1a1d29',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (err) {
      console.warn('[device-panel] 二维码生成失败:', err);
    }
  }

  function handleCopy() {
    const id = document.getElementById('ticaiDevicePanelId').textContent;
    const status = document.getElementById('ticaiDevicePanelStatus');
    const setStatus = (text) => {
      if (status) {
        status.textContent = text;
        setTimeout(() => {
          if (status.textContent === text) status.textContent = '';
        }, 1800);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(
        () => setStatus('已复制到剪贴板'),
        () => fallbackCopy(id, setStatus)
      );
    } else {
      fallbackCopy(id, setStatus);
    }
  }

  function fallbackCopy(text, setStatus) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      setStatus('已复制到剪贴板');
    } catch (err) {
      setStatus('复制失败，请手动选中');
    }
    document.body.removeChild(ta);
  }

  function handleBind() {
    const input = document.getElementById('ticaiDevicePanelInput');
    const status = document.getElementById('ticaiDevicePanelStatus');
    const value = (input.value || '').trim();
    if (!value) {
      if (status) status.textContent = '请先粘贴设备 ID';
      return;
    }
    if (!window.TicaiDevice.isValidId(value)) {
      if (status) status.textContent = '设备 ID 格式不对（应为 8-64 位字母/数字/中划线）';
      return;
    }
    if (value === window.TicaiDevice.getId()) {
      if (status) status.textContent = '该 ID 已是当前设备';
      return;
    }
    const ok = window.TicaiDevice.setId(value);
    if (!ok) {
      if (status) status.textContent = '绑定失败';
      return;
    }
    if (status) status.textContent = '绑定成功，3 秒后刷新...';
    if (window.TicaiCloud) window.TicaiCloud.clearReviewCache();
    setTimeout(() => window.location.reload(), 1200);
  }

  function handleReset() {
    if (!window.confirm('确定要重置当前设备吗？\n\n将清空本机所有预测记录与策略缓存（云端不受影响）。')) return;
    // 清理本机缓存的所有 lottery 类型
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith('ticai_prediction_records_v1_') ||
        k.startsWith('ticai_strategy_evolution_v1_')
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    window.TicaiDevice.resetId();
    window.location.reload();
  }

  function show() {
    ensurePanel();
    const idEl = document.getElementById('ticaiDevicePanelId');
    if (idEl) idEl.textContent = window.TicaiDevice.getId();
    const input = document.getElementById('ticaiDevicePanelInput');
    if (input) input.value = '';
    const status = document.getElementById('ticaiDevicePanelStatus');
    if (status) status.textContent = '';
    refreshQr();
    overlayEl.style.display = 'flex';
  }

  function hide() {
    if (overlayEl) overlayEl.style.display = 'none';
  }

  window.TicaiDevicePanel = { show, hide };
})();
