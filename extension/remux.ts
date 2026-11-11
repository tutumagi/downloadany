import muxjs from 'mux.js';
import { fetchBytes, HlsError, OUTPUT_LIMIT, SEGMENT_LIMIT, type MediaPlaylist } from './hls.ts';

type Options = { signal?: AbortSignal; fetcher?: typeof fetch; progress?: (done: number, total: number) => void };
type Sink = (bytes: Uint8Array) => Promise<unknown>;

function boxes(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: { name: string; body: Uint8Array }[] = [];
  for (let offset = 0; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) throw new HlsError('media');
    let length = view.getUint32(offset);
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let header = 8;
    if (length === 1) {
      if (offset + 16 > bytes.byteLength) throw new HlsError('media');
      length = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (length === 0) length = bytes.byteLength - offset;
    if (length < header || length > bytes.byteLength - offset || found.length >= 4096) {
      throw new HlsError('media');
    }
    found.push({ name, body: bytes.subarray(offset + header, offset + length) });
    offset += length;
  }
  return found;
}

function hasProtectedTrack(bytes: Uint8Array) {
  // Only the small moov metadata is scanned, never compressed video payload.
  const metadata = new TextDecoder('latin1').decode(bytes);
  return /encv|enca|sinf|pssh/.test(metadata);
}

function checkInit(bytes: Uint8Array) {
  const parsed = boxes(bytes);
  const moov = parsed.find(({ name }) => name === 'moov');
  if (!moov || !parsed.some(({ name }) => name === 'ftyp')) throw new HlsError('media');
  if (parsed.some(({ name }) => name === 'pssh') || hasProtectedTrack(moov.body)) throw new HlsError('encrypted');
  const handlers = boxes(moov.body).filter(({ name }) => name === 'trak').map(({ body }) => {
    const media = boxes(body).find(({ name }) => name === 'mdia');
    const handler = media && boxes(media.body).find(({ name }) => name === 'hdlr');
    return handler && String.fromCharCode(...handler.body.subarray(8, 12));
  });
  if (!handlers.includes('vide') || !handlers.includes('soun')) throw new HlsError('media');
}

function checkFragment(bytes: Uint8Array) {
  const parsed = boxes(bytes);
  const fragments = parsed.filter(({ name }) => name === 'moof');
  if (!fragments.length || !parsed.some(({ name }) => name === 'mdat') || parsed.some(({ name }) => name === 'moov')) {
    throw new HlsError('media');
  }
  if (parsed.some(({ name }) => name === 'pssh') || fragments.some(({ body }) =>
    boxes(body).filter(({ name }) => name === 'traf').some((track) =>
      boxes(track.body).some(({ name }) => name === 'senc')))) throw new HlsError('encrypted');
}

function looksLikeTs(bytes: Uint8Array) {
  return bytes.length >= 188 * 3 && bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47;
}

export async function writeHlsMp4(media: MediaPlaylist, sink: Sink, options: Options = {}) {
  if (!media.segments.length) throw new HlsError('media');
  let size = 0;
  async function write(bytes: Uint8Array) {
    options.signal?.throwIfAborted();
    size += bytes.byteLength;
    if (size > OUTPUT_LIMIT) throw new HlsError('size');
    await sink(bytes);
  }

  if (media.init) {
    const init = await fetchBytes(media.init, SEGMENT_LIMIT, options);
    checkInit(init);
    await write(init);
    for (const [index, url] of media.segments.entries()) {
      const bytes = await fetchBytes(url, SEGMENT_LIMIT, options);
      checkFragment(bytes);
      await write(bytes);
      options.progress?.(index + 1, media.segments.length);
    }
    return size;
  }

  const transmuxer = new muxjs.mp4.Transmuxer({ remux: true });
  const output: { initSegment: Uint8Array; data: Uint8Array; type: string }[] = [];
  transmuxer.on('data', (segment) => output.push(segment));
  let wroteInit = false;
  try {
    for (const [index, url] of media.segments.entries()) {
      const bytes = await fetchBytes(url, SEGMENT_LIMIT, options);
      if (!looksLikeTs(bytes)) throw new HlsError('media');
      transmuxer.push(bytes);
      transmuxer.flush();
      if (output.length !== 1 || output[0].type !== 'combined') throw new HlsError('media');
      const segment = output.pop()!;
      if (!wroteInit) {
        checkInit(segment.initSegment);
        await write(segment.initSegment);
        wroteInit = true;
      }
      await write(segment.data);
      options.progress?.(index + 1, media.segments.length);
    }
    return size;
  } finally {
    transmuxer.dispose();
  }
}
