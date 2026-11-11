import type { Candidate } from './detect.ts';
import { readCandidates } from './observe.ts';
import { playbackTarget, trustedWebOrigin, type PlaybackTarget } from '../src/stream-flow.ts';
import { expireTemporaryFiles } from './temp.ts';

export { expireTemporaryFiles } from './temp.ts';
export { readCandidates } from './observe.ts';

export type Scan = { at: number; candidates: Candidate[]; inaccessible?: true };
export const SCAN_AGE_MS = 5 * 60 * 1000;

export async function scanAndOpen(tab: Pick<chrome.tabs.Tab, 'id'>) {
  if (tab.id === undefined) return;
  let scan: Scan;
  try {
    scan = { at: Date.now(), candidates: await readCandidates(tab.id) };
  } catch {
    scan = { at: Date.now(), candidates: [], inaccessible: true };
  }

  const stored = await chrome.storage.session.get(null);
  const expired = Object.entries(stored).filter(([key, value]) =>
    (key.startsWith('scan:') || key.startsWith('play:')) && Date.now() - (value as Scan).at > SCAN_AGE_MS).map(([key]) => key);
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

export type PlaybackJob = { at: number; target: PlaybackTarget };
const launching = new Set<number>();

chrome.runtime.onMessage.addListener((data, sender, respond) => {
  if (data?.type !== 'launch-playback' || typeof data.url !== 'string' || sender.id !== chrome.runtime.id
    || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url) return;
  if (!trustedWebOrigin(new URL(sender.url).origin)) return;
  const target = playbackTarget(data.url);
  const tabId = sender.tab.id;
  if (!target || launching.has(tabId)) {
    respond({ opened: false });
    return;
  }
  launching.add(tabId);
  const key = 'play:' + crypto.randomUUID();
  void (async () => {
    try {
      const entries = await chrome.storage.session.get(null);
      const expired = Object.entries(entries).filter(([name, value]) => name.startsWith('play:')
        && Date.now() - (value as PlaybackJob).at > SCAN_AGE_MS).map(([name]) => name);
      if (expired.length) await chrome.storage.session.remove(expired);
      await chrome.storage.session.set({ [key]: { at: Date.now(), target } satisfies PlaybackJob });
      await chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + '#' + key });
      respond({ opened: true });
    } catch {
      await chrome.storage.session.remove(key).catch(() => {});
      respond({ opened: false });
    } finally {
      launching.delete(tabId);
    }
  })();
  return true;
});
