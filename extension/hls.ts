import { sourceUrl } from './detect.ts';

export type HlsCode = 'manifest' | 'encrypted' | 'live' | 'unsupported' | 'cross_origin'
  | 'access' | 'network' | 'size' | 'media';
export class HlsError extends Error {
  code: HlsCode;
  constructor(code: HlsCode) { super(code); this.code = code; }
}

export type MediaPlaylist = { kind: 'media'; segments: string[]; init?: string };
type MasterPlaylist = { kind: 'master'; variant: string };
type FetchOptions = { fetcher?: typeof fetch; signal?: AbortSignal };

const MANIFEST_LIMIT = 1024 * 1024;
const MAX_SEGMENTS = 6000;
export const SEGMENT_LIMIT = 32 * 1024 * 1024;
export const OUTPUT_LIMIT = 2 * 1024 * 1024 * 1024;

function attributes(line: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of line.matchAll(/(?:^|,)\s*([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) {
    found.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  return found;
}

export function parsePlaylist(text: string, location: string): MediaPlaylist | MasterPlaylist {
  const base = sourceUrl(location);
  if (!base) throw new HlsError('manifest');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new HlsError('manifest');
  for (const line of lines) {
    if (line.startsWith('#EXT-X-SESSION-KEY') || (line.startsWith('#EXT-X-KEY:')
      && attributes(line.slice('#EXT-X-KEY:'.length)).get('METHOD') !== 'NONE')) throw new HlsError('encrypted');
    if (/^#EXT-X-(?:BYTERANGE:|DISCONTINUITY$|I-FRAMES-ONLY$|GAP$|DEFINE:|SKIP:)/.test(line)) {
      throw new HlsError('unsupported');
    }
  }
  function resolve(raw: string) {
    const url = sourceUrl(raw, base!.href);
    if (!url || url.origin !== base!.origin) throw new HlsError('cross_origin');
    return url.href;
  }

  const inBand = new Map<string, boolean>();
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attrs = attributes(line.slice('#EXT-X-MEDIA:'.length));
    const type = attrs.get('TYPE');
    const group = attrs.get('GROUP-ID');
    if (!group || (type !== 'AUDIO' && type !== 'VIDEO')) continue;
    const key = type + ':' + group;
    inBand.set(key, inBand.get(key) !== false && !attrs.has('URI'));
  }

  const variants: { bandwidth: number; uri: string }[] = [];
  let hasVariants = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    hasVariants = true;
    const attrs = attributes(line.slice('#EXT-X-STREAM-INF:'.length));
    const uri = lines[i + 1];
    if (!uri || uri.startsWith('#')) throw new HlsError('manifest');
    const codecs = attrs.get('CODECS');
    const muxed = ['AUDIO', 'VIDEO'].every((type) =>
      !attrs.has(type) || inBand.get(type + ':' + attrs.get(type)) === true);
    if (muxed
      && (!codecs || /(?:avc[13]|hev1|hvc1|av01|vp09)/i.test(codecs))) {
      variants.push({ bandwidth: Number(attrs.get('BANDWIDTH')) || 0, uri });
    }
  }
  if (hasVariants) {
    const variant = variants.sort((a, b) => b.bandwidth - a.bandwidth).find(({ uri }) =>
      sourceUrl(uri, base.href)?.origin === base.origin);
    if (variant) return { kind: 'master', variant: resolve(variant.uri) };
    throw new HlsError(variants.length ? 'cross_origin' : 'unsupported');
  }

  if (!lines.includes('#EXT-X-ENDLIST')) throw new HlsError('live');
  const segments: string[] = [];
  let init: string | undefined;
  let expectingSegment = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXTINF:')) {
      if (expectingSegment) throw new HlsError('manifest');
      expectingSegment = true;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = attributes(line.slice('#EXT-X-MAP:'.length));
      const uri = attrs.get('URI');
      if (!uri || attrs.has('BYTERANGE') || (segments.length && !init)) throw new HlsError('unsupported');
      const mapped = resolve(uri);
      if (init && mapped !== init) throw new HlsError('unsupported');
      init = mapped;
    } else if (!line.startsWith('#')) {
      if (!expectingSegment) throw new HlsError('manifest');
      if (segments.length >= MAX_SEGMENTS) throw new HlsError('size');
      segments.push(resolve(line));
      expectingSegment = false;
    }
  }
  if (expectingSegment || !segments.length) throw new HlsError('manifest');
  return { kind: 'media', segments, ...(init ? { init } : {}) };
}

export async function fetchBytes(url: string, limit: number, options: FetchOptions = {}) {
  const { signal, fetcher = fetch } = options;
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(45000);
  let response: Response;
  try {
    response = await fetcher(url, {
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    signal?.throwIfAborted();
    throw new HlsError('network');
  }
  if (response.status !== 200 || !response.body || Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new HlsError(response.status === 401 || response.status === 403 ? 'access'
      : response.status !== 200 ? 'network' : 'size');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new HlsError('size');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    signal?.throwIfAborted();
    if (error instanceof HlsError) throw error;
    throw new HlsError('network');
  }
  const content = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
  return content;
}

export async function prepareHls(raw: string, options?: FetchOptions): Promise<MediaPlaylist> {
  const url = sourceUrl(raw);
  if (!url) throw new HlsError('manifest');
  const decoder = new TextDecoder();
  async function load(href: string) {
    return parsePlaylist(decoder.decode(await fetchBytes(href, MANIFEST_LIMIT, options)), href);
  }
  const first = await load(url.href);
  if (first.kind === 'media') return first;
  const variant = await load(first.variant);
  if (variant.kind !== 'media') throw new HlsError('unsupported');
  return variant;
}
