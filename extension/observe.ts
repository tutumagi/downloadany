import { candidatesFrom, type Observation } from './detect.ts';

function observeTab(expectedOrigin?: string): Observation[] {
  if (expectedOrigin && location.origin !== expectedOrigin) return [];
  const observed: Observation[] = [];
  const scopes = [{ page: document, timing: performance, depth: 0 }];
  for (const { page, timing, depth } of scopes) {
    for (const el of Array.from(page.querySelectorAll('video, video source')).slice(0, 40)) {
      const url = (el.localName === 'video' ? (el as HTMLVideoElement).currentSrc : '') || (el as HTMLSourceElement).src;
      if (url) observed.push({ url, type: el.getAttribute('type') || undefined });
    }
    for (const entry of timing.getEntriesByType('resource').slice(-600).reverse()) {
      const type = (entry as PerformanceResourceTiming & { contentType?: string }).contentType;
      if (/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(entry.name)
        || (type && /mpegurl|dash\+xml/i.test(type))) observed.push({ url: entry.name, type });
    }
    if (depth < 2) {
      for (const frame of Array.from(page.querySelectorAll('iframe')).slice(0, 12)) {
        if (scopes.length >= 12) break;
        // contentDocument is unavailable for a cross-origin or sandboxed frame.
        if (frame.contentDocument && frame.contentWindow) {
          try { scopes.push({ page: frame.contentDocument, timing: frame.contentWindow.performance, depth: depth + 1 }); }
          catch { /* the iframe navigated while scanning */ }
        }
      }
    }
  }
  return observed;
}

export async function readCandidates(tabId: number, expectedOrigin?: string) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, func: observeTab, args: [expectedOrigin ?? ''],
  });
  return candidatesFrom(result ?? []);
}
