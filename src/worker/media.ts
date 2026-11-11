import { DEMO_INLINE, MAX_BROWSER_BYTES, type Video } from '../shared.ts';

export const isMp4Path = (url: URL) => /\.mp4$/i.test(url.pathname);
export const contentType = (response: Response) => response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();

function mediaSize(response: Response): number | undefined {
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') return;
  const range = response.headers.get('content-range') ?? '';
  const raw = response.status === 206
    ? /^bytes \d+-\d+\/(\d+)$/i.exec(range)?.[1]
    : response.headers.get('content-length');
  if (!raw || !/^\d+$/.test(raw)) return;
  const size = Number(raw);
  return Number.isSafeInteger(size) && size > 0 ? size : undefined;
}

function safeFilename(name: string) {
  const clean = name.replace(/[\\/:*?"<>|\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/^\.+|\s+$/g, '').slice(0, 110);
  if (!clean) return 'video.mp4';
  return /\.mp4$/i.test(clean) ? clean : clean + '.mp4';
}

export function openMedia(url: string, title?: string): Video {
  const parsed = new URL(url);
  let name = parsed.pathname.split('/').pop() || 'video';
  try { name = decodeURIComponent(name); } catch { /* keep the encoded path */ }
  const filename = safeFilename(name);
  return { url, filename, title: title || filename, delivery: 'open' };
}

export function classifyMedia(
  response: Response, url: string, appOrigin: string, title?: string,
  mode: 'navigation' | 'cors' = 'navigation',
): Video | undefined {
  const mime = contentType(response);
  if (!response.ok || (mime !== 'video/mp4' && mime !== 'application/mp4'
    && !(mime === 'application/octet-stream' && isMp4Path(new URL(url))))) return;
  const video = openMedia(url, title);
  const size = mediaSize(response);
  if (size !== undefined) video.size = size;
  const source = new URL(url);
  if (response.status !== 200 || (appOrigin.startsWith('https:') && source.protocol !== 'https:')) return video;
  if (mode === 'navigation' && /^attachment(?:\s*;|\s*$)/i.test(response.headers.get('content-disposition') ?? '')) {
    video.delivery = 'attachment';
  } else {
    const cors = response.headers.get('access-control-allow-origin');
    const sameOrigin = source.origin === appOrigin;
    const readable = sameOrigin || (mode === 'cors' && (cors === appOrigin || cors === '*'));
    // The asset binding may omit Content-Length for this built-in, build-time fixture.
    const small = size !== undefined ? size <= MAX_BROWSER_BYTES : sameOrigin && source.pathname === DEMO_INLINE && !source.search;
    if (readable && small) video.delivery = 'browser';
  }
  return video;
}
