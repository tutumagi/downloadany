import type { InspectResult, Video } from '../shared.ts';
import { classifyMedia, contentType, isMp4Path, openMedia } from './media.ts';
import { createPolicy, InspectError, parseInput } from './policy.ts';

const HTML_LIMIT = 1024 * 1024;
const MAX_CANDIDATES = 10;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;
interface Options {
  origin: string;
  allowedHosts?: string;
  fetcher: Fetcher;
  signal?: AbortSignal;
}

function discard(response: Response) {
  void response.body?.cancel().catch(() => {});
}

function errorForStatus(status: number) {
  if (status === 401 || status === 403) return new InspectError('upstream_restricted');
  if (status === 404 || status === 410) return new InspectError('expired');
  return new InspectError('upstream_error');
}

function limitedHtml(body: ReadableStream<Uint8Array>, markLimited: () => void) {
  const reader = body.getReader();
  let remaining = HTML_LIMIT;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value.subarray(0, remaining));
      remaining -= value.byteLength;
      if (remaining < 0) {
        markLimited();
        controller.close();
        void reader.cancel().catch(() => {});
      }
    },
    cancel: () => reader.cancel(),
  });
}

async function scanHtml(response: Response, pageUrl: URL, policy: ReturnType<typeof createPolicy>) {
  const candidates = new Map<string, string>();
  let base: URL | undefined;
  let limited = false;
  if (!response.body) return { candidates, limited };

  function add(raw: string | null, title: string, explicit: boolean) {
    if (!raw) return;
    try {
      const url = new URL(raw, base ?? pageUrl);
      url.hash = '';
      policy.check(url);
      if (!explicit && !isMp4Path(url)) return;
      if (candidates.has(url.href)) return;
      if (candidates.size === MAX_CANDIDATES) {
        limited = true;
        return;
      }
      candidates.set(url.href, title.trim().slice(0, 120));
    } catch { /* ignore invalid or disallowed media in a page */ }
  }

  function fromElement(element: Element) {
    const type = element.getAttribute('type')?.split(';')[0].trim().toLowerCase();
    if (type && type !== 'video/mp4' && type !== 'application/mp4') return;
    add(element.getAttribute('src'), element.getAttribute('title') ?? '', true);
  }

  const html = new Response(limitedHtml(response.body, () => { limited = true; }), {
    headers: { 'content-type': response.headers.get('content-type') ?? 'text/html' },
  });
  const rewritten = new HTMLRewriter()
    .on('base[href]', { element(element) {
      if (base) return;
      try {
        const value = new URL(element.getAttribute('href') ?? '', pageUrl);
        if (/^https?:$/.test(value.protocol)) base = value;
      } catch { /* invalid base */ }
    } })
    .on('video[src]', { element: fromElement })
    .on('video source[src]', { element: fromElement })
    .on('meta[property][content]', { element(element) {
      const name = element.getAttribute('property')?.toLowerCase();
      if (name === 'og:video' || name === 'og:video:url' || name === 'og:video:secure_url') {
        add(element.getAttribute('content'), '', false);
      }
    } })
    .transform(html);
  // Consume the rewritten stream to drive the parser without retaining the transformed HTML.
  await rewritten.body?.pipeTo(new WritableStream());
  return { candidates, limited };
}

export async function inspect(input: string, { origin, allowedHosts, fetcher, signal }: Options): Promise<InspectResult> {
  const policy = createPolicy(origin, allowedHosts);
  let subrequests = 0;
  let budgetReached = false;

  async function get(start: URL, cors = false) {
    let url = start;
    for (let depth = 0; ; depth++) {
      signal?.throwIfAborted();
      policy.check(url);
      if (subrequests >= 48) {
        budgetReached = true;
        throw new InspectError('page_limit');
      }
      subrequests++;
      const headers = new Headers(cors ? { origin } : undefined);
      const response = await fetcher(url, {
        method: 'GET', headers, redirect: 'manual', signal,
      });
      // Browser Blob fetches disallow redirects, so the CORS probe must too.
      if (cors || !REDIRECTS.has(response.status)) return { url, response };
      const target = response.headers.get('location');
      discard(response);
      if (!target || depth === 3) throw new InspectError('upstream_error');
      try {
        url = new URL(target, url);
        url.hash = '';
      } catch {
        throw new InspectError('upstream_error');
      }
    }
  }

  async function classify(response: Response, url: URL, title?: string) {
    const video = classifyMedia(response, url.href, origin, title);
    if (!video) return;
    discard(response);
    if (video.delivery !== 'open' || response.status !== 200 || url.origin === origin
      || (origin.startsWith('https:') && url.protocol !== 'https:')) return video;
    try {
      const cors = await get(url, true);
      const supported = classifyMedia(cors.response, url.href, origin, title, 'cors');
      discard(cors.response);
      if (supported?.delivery === 'browser') return supported;
    } catch {
      signal?.throwIfAborted();
    }
    return video;
  }

  const unprobeable = (status: number, url: URL, title?: string) =>
    (status === 405 || status === 416) && isMp4Path(url) ? openMedia(url.href, title) : undefined;

  const start = parseInput(input);
  const { url, response } = await get(start);
  if (!response.ok) {
    discard(response);
    const open = unprobeable(response.status, url);
    if (open) return { videos: [open], hostname: url.hostname, limited: false };
    throw errorForStatus(response.status);
  }
  const direct = await classify(response, url);
  if (direct) {
    return { videos: [direct], hostname: url.hostname, limited: false };
  }
  if (contentType(response) !== 'text/html' || response.status !== 200) {
    discard(response);
    throw new InspectError('no_video');
  }

  const { candidates, limited } = await scanHtml(response, url, policy);
  const entries = [...candidates];
  const videos: (Video | undefined)[] = [];
  let restricted: InspectError | undefined;
  let transient = false;
  for (let index = 0; index < entries.length; index += 4) {
    const batch = await Promise.all(entries.slice(index, index + 4).map(async ([href, title]) => {
      try {
        const media = await get(new URL(href));
        const video = await classify(media.response, media.url, title);
        if (video) return video;
        discard(media.response);
        if (media.response.status === 401 || media.response.status === 403 || media.response.status === 404 || media.response.status === 410) {
          restricted ??= errorForStatus(media.response.status);
        }
        if (media.response.status === 429 || media.response.status >= 500) transient = true;
        return unprobeable(media.response.status, media.url, title);
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof InspectError) || error.code === 'upstream_error') transient = true;
      }
    }));
    videos.push(...batch);
  }

  const seen = new Set<string>();
  const unique = videos.filter((video): video is Video => {
    if (!video || seen.has(video.url)) return false;
    seen.add(video.url);
    return true;
  });
  if (!unique.length) {
    throw new InspectError(transient ? 'upstream_error' : restricted?.code
      ?? (limited || budgetReached ? 'page_limit' : 'no_video'));
  }
  return { videos: unique, hostname: url.hostname, limited: limited || budgetReached };
}
