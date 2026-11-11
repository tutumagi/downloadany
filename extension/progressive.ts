import { sourceUrl } from './detect.ts';
import { HlsError, OUTPUT_LIMIT } from './hls.ts';

type Options = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  progress?: (bytes: number, total?: number) => void;
};

export async function writeProgressiveMp4(
  raw: string, sink: (chunk: Uint8Array) => Promise<unknown>, options: Options = {},
) {
  const url = sourceUrl(raw);
  if (!url) throw new HlsError('media');
  const { fetcher = fetch, signal, progress } = options;
  signal?.throwIfAborted();
  const idle = new AbortController();
  const combined = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), 45000);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    resetTimer();
    const response = await fetcher(url.href, {
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal: combined,
    });
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const pathMp4 = /\.mp4$/i.test(url.pathname);
    const declared = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    const total = declared && /^\d+$/.test(declared) && (!encoding || encoding === 'identity')
      ? Number(declared) : undefined;
    const supportedMime = mime === 'video/mp4' || mime === 'application/mp4'
      || (pathMp4 && (!mime || mime === 'application/octet-stream'));
    if (response.status !== 200 || !response.body || !supportedMime || (total !== undefined && total > OUTPUT_LIMIT)) {
      void response.body?.cancel().catch(() => {});
      throw new HlsError(response.status === 401 || response.status === 403 ? 'access'
        : total !== undefined && total > OUTPUT_LIMIT ? 'size' : 'media');
    }

    reader = response.body.getReader();
    let bytes = 0;
    let validated = false;
    const header = new Uint8Array(8);
    let headBytes = 0;
    const pending: Uint8Array[] = [];
    for (;;) {
      resetTimer();
      combined.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > OUTPUT_LIMIT || (total !== undefined && bytes > total)) {
        throw new HlsError(bytes > OUTPUT_LIMIT ? 'size' : 'media');
      }
      if (!validated) {
        pending.push(value);
        const fragment = value.subarray(0, header.length - headBytes);
        header.set(fragment, headBytes);
        headBytes += fragment.length;
        if (headBytes < header.length) continue;
        const boxLength = new DataView(header.buffer).getUint32(0);
        if (boxLength < 16 || String.fromCharCode(...header.subarray(4)) !== 'ftyp') throw new HlsError('media');
        for (const chunk of pending) await sink(chunk);
        pending.length = 0;
        validated = true;
      } else {
        await sink(value);
      }
      progress?.(bytes, total);
    }
    if (!validated || (total !== undefined && bytes !== total)) throw new HlsError('media');
    return bytes;
  } catch (error) {
    void reader?.cancel().catch(() => {});
    signal?.throwIfAborted();
    if (error instanceof HlsError) throw error;
    throw new HlsError('network');
  } finally {
    clearTimeout(timer);
  }
}
