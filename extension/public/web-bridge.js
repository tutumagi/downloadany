(() => {
  const trusted = new Set([
    'http://127.0.0.1:8787',
    'http://localhost:8787',
    'https://download.tutudev.com',
    'https://downloadany.tufei-fly.workers.dev',
  ]);
  if (window.top !== window || !trusted.has(location.origin)) return;
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.channel !== 'downloadany:web'
      || data.type !== 'launch-playback' || typeof data.id !== 'string' || !/^[\da-f-]{36}$/i.test(data.id)
      || typeof data.url !== 'string' || data.url.length > 8192) return;
    let result = 'failed';
    if (navigator.userActivation.isActive) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'launch-playback', url: data.url });
        if (response?.opened === true) result = 'opened';
      } catch { /* reloading the extension can invalidate this content script */ }
    }
    window.postMessage({ channel: 'downloadany:extension', id: data.id, result }, location.origin);
  });
})();
