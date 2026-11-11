export const MAX_BROWSER_BYTES = 25 * 1024 * 1024;
export const DEMO_PAGE = '/demo/clips';
export const DEMO_DIRECT = '/demo/signal.mp4';
export const DEMO_INLINE = '/demo/orbit.mp4';

export const PLATFORM_NAMES = {
  bilibili: 'B 站', douyin: '抖音', xiaohongshu: '小红书', youtube: 'YouTube',
} as const;

export type Platform = keyof typeof PLATFORM_NAMES;
export type ErrorCode =
  | 'invalid_url' | 'multiple_urls' | 'source_not_allowed' | 'platform_disabled'
  | 'no_video' | 'upstream_restricted' | 'expired' | 'upstream_error' | 'timeout'
  | 'page_limit' | 'rate_limited' | 'invalid_request';

export interface Video {
  url: string;
  title: string;
  filename: string;
  delivery: 'attachment' | 'browser' | 'open';
  size?: number;
}

export interface InspectResult {
  videos: Video[];
  hostname: string;
  limited: boolean;
}

export interface InspectFailure {
  error: ErrorCode;
  source?: Platform;
  retryable: boolean;
}
