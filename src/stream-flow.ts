import { platformFor } from './platform.ts';

export type PlaybackTarget = { url: string; origin: string; direct?: 'hls' | 'dash' };

export function trustedWebOrigin(origin: string) {
  return origin === 'http://127.0.0.1:8787' || origin === 'http://localhost:8787'
    || origin === 'https://download.tutudev.com';
}

export function extractPlaybackUrl(input: string): string | undefined {
  const values = new Set(input.match(/https?:\/\/[^\s<>"'，。；！？、（）【】]+/gi) ?? []);
  if (values.size === 1) return values.values().next().value;
}

function gaotuOrigin(url: URL) {
  if (url.port) return;
  if (url.hostname === 'xuexi861.com' && /^\/a\/[a-z\d_-]+\/?$/i.test(url.pathname)) {
    return 'https://interactive.gaotu100.com';
  }
  if (url.protocol === 'https:' && url.hostname === 'interactive.gaotu100.com'
    && url.pathname === '/gaotu-live-student/gtlive/playback.html') return url.origin;
}

export function playbackTarget(raw: string): PlaybackTarget | undefined {
  if (raw.length > 8192) return;
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  if (url.username || url.password || !/^https?:$/.test(url.protocol) || platformFor(url.hostname)) return;
  const replayOrigin = gaotuOrigin(url);
  if (replayOrigin) return { url: url.href, origin: replayOrigin };
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1') return;
  const direct = /\.m3u8$/i.test(url.pathname) ? 'hls' : /\.mpd$/i.test(url.pathname) ? 'dash' : undefined;
  return { url: url.href, origin: url.origin, ...(direct ? { direct } : {}) };
}

export function shouldRouteLocally(raw: string) {
  const target = playbackTarget(raw);
  return !!target && (!!target.direct || !!gaotuOrigin(new URL(target.url)));
}
