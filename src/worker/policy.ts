import { DEMO_DIRECT, DEMO_INLINE, DEMO_PAGE, type ErrorCode, type Platform } from '../shared.ts';
import { platformFor } from '../platform.ts';

const demoPaths = new Set([DEMO_PAGE, DEMO_PAGE + '.html', DEMO_DIRECT, DEMO_INLINE]);
export class InspectError extends Error {
  code: ErrorCode;
  source?: Platform;
  constructor(code: ErrorCode, source?: Platform) {
    super(code);
    this.code = code;
    this.source = source;
  }
}

export function parseInput(input: string): URL {
  const urls = new Set(input.match(/https?:\/\/[^\s<>"'，。；！？、（）【】]+/gi) ?? []);
  if (urls.size > 1) throw new InspectError('multiple_urls');
  const raw = urls.values().next().value;
  if (!raw || raw.length > 4096) throw new InspectError('invalid_url');
  try {
    const url = new URL(raw);
    if (url.username || url.password) throw new Error();
    url.hash = '';
    return url;
  } catch {
    throw new InspectError('invalid_url');
  }
}

function isPublicHostname(host: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(host)
    && !/\.(?:localhost|local|internal|lan|home|arpa)$/i.test(host);
}

export function createPolicy(origin: string, allowedHosts = '') {
  const hosts = new Set(allowedHosts.split(',').map((host) => host.trim().toLowerCase()).filter(isPublicHostname));
  const demo = (url: URL) => url.origin === origin && demoPaths.has(url.pathname) && !url.search;
  return {
    demo,
    check(url: URL): URL {
      if (!/^https?:$/.test(url.protocol) || url.port || url.username || url.password) {
        // The dev server uses a loopback port, and only its exact built-in demo paths can be fetched.
        if (!(demo(url) && /^https?:$/.test(url.protocol) && !url.username && !url.password)) {
          throw new InspectError('source_not_allowed');
        }
      }
      const source = platformFor(url.hostname);
      if (source) throw new InspectError('platform_disabled', source);
      if (demo(url) || (url.origin !== origin && hosts.has(url.hostname))) return url;
      throw new InspectError('source_not_allowed');
    },
  };
}
