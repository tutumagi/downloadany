export type Candidate = { url: string; kind: 'hls' | 'dash' };
export type Observation = { url: string; type?: string };

const hlsTypes = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl']);

export function sourceUrl(raw: string, base?: string) {
  if (raw.length > 8192 || raw.includes('{$')) return;
  let url: URL;
  try { url = new URL(raw, base); } catch { return; }
  if (url.username || url.password) return;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) return;
  url.hash = '';
  return url;
}

export function candidatesFrom(observed: Observation[]): Candidate[] {
  const result = new Map<string, Candidate>();
  for (const { url: raw, type } of observed) {
    const url = sourceUrl(raw);
    if (!url || result.has(url.href)) continue;
    const mime = type?.split(';')[0].trim().toLowerCase() ?? '';
    const kind = hlsTypes.has(mime) || /\.m3u8$/i.test(url.pathname) ? 'hls'
      : mime === 'application/dash+xml' || /\.mpd$/i.test(url.pathname) ? 'dash' : undefined;
    if (kind) result.set(url.href, { url: url.href, kind });
    if (result.size === 12) break;
  }
  return [...result.values()];
}
