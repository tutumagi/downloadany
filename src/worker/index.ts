import { DEMO_DIRECT, DEMO_PAGE, type ErrorCode, type InspectFailure } from '../shared.ts';
import { inspect } from './inspect.ts';
import { createPolicy, InspectError } from './policy.ts';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ALLOWED_HOSTS?: string;
  INSPECT_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const BODY_LIMIT = 8 * 1024;
const statuses: Record<ErrorCode, number> = {
  invalid_url: 400, multiple_urls: 400, invalid_request: 400,
  platform_disabled: 422, source_not_allowed: 422, no_video: 422, page_limit: 422,
  expired: 404, upstream_restricted: 403, upstream_error: 502, timeout: 504, rate_limited: 429,
};

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  } });
}

function fail(error: InspectError) {
  const data: InspectFailure = {
    error: error.code,
    ...(error.source ? { source: error.source } : {}),
    retryable: ['upstream_error', 'timeout', 'rate_limited'].includes(error.code),
  };
  return reply(data, statuses[error.code]);
}

async function readInput(request: Request, signal: AbortSignal) {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' || !request.body) throw new InspectError('invalid_request');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let json = '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        cancel();
        throw new InspectError('invalid_request');
      }
      json += decoder.decode(value, { stream: true });
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', cancel);
  }
  try {
    const value: unknown = JSON.parse(json + decoder.decode());
    if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string') throw new Error();
    return value.url;
  } catch {
    throw new InspectError('invalid_request');
  }
}

async function inspectRequest(request: Request, env: Env, origin: string) {
  const suppliedOrigin = request.headers.get('origin');
  if (suppliedOrigin && suppliedOrigin !== origin) return fail(new InspectError('invalid_request'));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, 8000);
  request.signal.addEventListener('abort', cancel, { once: true });
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new InspectError('timeout')), { once: true });
  });
  if (request.signal.aborted) cancel();
  async function run() {
    if (env.INSPECT_LIMIT) {
      const key = request.headers.get('cf-connecting-ip') ?? 'local';
      if (!(await env.INSPECT_LIMIT.limit({ key })).success) return fail(new InspectError('rate_limited'));
    }
    controller.signal.throwIfAborted();
    const input = await readInput(request, controller.signal);
    const demo = createPolicy(origin).demo;
    const result = await inspect(input, {
      origin,
      allowedHosts: env.ALLOWED_HOSTS,
      signal: controller.signal,
      fetcher: (url, init) => demo(url) ? env.ASSETS.fetch(new Request(url, init)) : fetch(url, init),
    });
    return reply(result);
  }
  try {
    return await Promise.race([run(), timeout]);
  } catch (error) {
    return fail(controller.signal.aborted ? new InspectError('timeout')
      : error instanceof InspectError ? error : new InspectError('upstream_error'));
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { origin, pathname } = new URL(request.url);
    if (pathname === '/api/v1/inspect') {
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
      return inspectRequest(request, env, origin);
    }
    if (pathname === '/api/v1/sources' && request.method === 'GET') {
      return reply({
        demoPage: DEMO_PAGE, demoDirect: DEMO_DIRECT,
        hosts: (env.ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean),
      });
    }
    if (pathname.startsWith('/api/')) return new Response(null, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
