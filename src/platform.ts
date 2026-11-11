import type { Platform } from './shared.ts';

const platformDomains: Record<Platform, string[]> = {
  bilibili: ['bilibili.com', 'b23.tv', 'bili2233.cn', 'bilibili.tv', 'bilivideo.com', 'bilivideo.cn'],
  douyin: ['douyin.com', 'iesdouyin.com', 'douyinvod.com'],
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com', 'xhscdn.com'],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com'],
};

export function platformFor(host: string): Platform | undefined {
  const name = host.toLowerCase().replace(/\.$/, '');
  for (const [platform, domains] of Object.entries(platformDomains)) {
    if (domains.some((domain) => name === domain || name.endsWith('.' + domain))) {
      return platform as Platform;
    }
  }
}
