export function launchPlayback(url: string): Promise<'opened' | 'failed' | 'missing'> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const done = (result: 'opened' | 'failed' | 'missing') => {
      window.removeEventListener('message', receive);
      clearTimeout(timer);
      resolve(result);
    };
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || event.origin !== location.origin || data?.channel !== 'downloadany:extension'
        || data.id !== id || (data.result !== 'opened' && data.result !== 'failed')) return;
      done(data.result);
    };
    const timer = window.setTimeout(() => done('missing'), 2000);
    window.addEventListener('message', receive);
    window.postMessage({ channel: 'downloadany:web', type: 'launch-playback', id, url }, location.origin);
  });
}
