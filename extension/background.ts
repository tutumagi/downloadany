import { candidatesFrom, type Candidate, type Observation } from './detect.ts';
import { expireTemporaryFiles } from './temp.ts';

export { expireTemporaryFiles } from './temp.ts';

export type Scan = { at: number; candidates: Candidate[]; inaccessible?: true };
export const SCAN_AGE_MS = 5 * 60 * 1000;

function observeTab(): Observation[] {
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

export async function scanAndOpen(tab: Pick<chrome.tabs.Tab, 'id'>) {
  if (tab.id === undefined) return;
  let scan: Scan;
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: observeTab });
    scan = { at: Date.now(), candidates: candidatesFrom(result ?? []) };
  } catch {
    scan = { at: Date.now(), candidates: [], inaccessible: true };
  }

  const stored = await chrome.storage.session.get(null);
  const expired = Object.entries(stored).filter(([key, value]) =>
    key.startsWith('scan:') && Date.now() - (value as Scan).at > SCAN_AGE_MS).map(([key]) => key);
  if (expired.length) await chrome.storage.session.remove(expired);
  const key = 'scan:' + crypto.randomUUID();
  await chrome.storage.session.set({ [key]: scan });
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + '#' + key });
  } catch {
    await chrome.storage.session.remove(key);
  }
}

chrome.action.onClicked.addListener((tab) => { void scanAndOpen(tab).catch(() => {}); });

const CLEANUP_ALARM = 'expire-temporary-mp4';
async function startCleanup() {
  if (!(await chrome.alarms.get(CLEANUP_ALARM))) {
    await chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 60 });
  }
  await expireTemporaryFiles();
}
chrome.runtime.onStartup.addListener(() => { void startCleanup().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { void startCleanup().catch(() => {}); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLEANUP_ALARM) void expireTemporaryFiles().catch(() => {});
});
