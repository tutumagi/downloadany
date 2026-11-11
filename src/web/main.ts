import './style.css';
import { extractPlaybackUrl, playbackTarget, shouldRouteLocally } from '../stream-flow.ts';
import { launchPlayback } from './playback.ts';
import {
  DEMO_DIRECT, DEMO_PAGE, MAX_BROWSER_BYTES, PLATFORM_NAMES,
  type ErrorCode, type InspectFailure, type InspectResult, type Video,
} from '../shared.ts';

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const form = byId<HTMLFormElement>('inspect-form');
const input = byId<HTMLInputElement>('video-url');
const submit = byId<HTMLButtonElement>('submit');
const statusLine = byId('status');
const results = byId('results');
const list = byId<HTMLUListElement>('video-list');
const sourceLink = byId<HTMLAnchorElement>('source-link');
const retry = byId<HTMLButtonElement>('retry');
const playback = byId<HTMLButtonElement>('playback');
const installHelp = byId<HTMLAnchorElement>('install-help');
let busy = false;

const messages: Record<ErrorCode, string> = {
  invalid_url: '请输入有效的 HTTP 或 HTTPS 视频网址。',
  multiple_urls: '发现多个网址，请只保留一条再解析。',
  source_not_allowed: '这个来源暂未开放。你可以先试用下方的内置示例。',
  platform_disabled: '这个平台暂未开放。',
  no_video: '没有在页面中找到可直下的 MP4。如果视频在播放后才加载，可以在播放页识别。',
  upstream_restricted: '源站要求登录、验证或限制了访问。请在原站查看。',
  expired: '这个链接已失效或已被删除。请重新获取链接。',
  upstream_error: '暂时无法访问源站，请稍后重新解析。',
  timeout: '解析超时，请稍后再试。',
  page_limit: '页面超出解析范围，未在已扫描的内容里找到 MP4。',
  rate_limited: '解析请求有点频繁，请稍等一分钟再试。',
  invalid_request: '无法读取该网址，请检查后重试。',
};

function setStatus(message = '', kind = 'idle') {
  statusLine.textContent = message;
  statusLine.dataset.kind = kind;
}

function externalLink(url: string, label: string, className: string) {
  const link = document.createElement('a');
  link.href = url;
  link.textContent = label;
  link.className = className;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

async function saveVideo(video: Video, button: HTMLButtonElement, note: HTMLElement) {
  button.disabled = true;
  note.textContent = '正在获取 MP4…';
  try {
    const response = await fetch(video.url, {
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(45000),
    });
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!response.ok || response.status !== 200 || !response.body
      || (mime !== 'video/mp4' && mime !== 'application/mp4'
        && !(mime === 'application/octet-stream' && /\.mp4$/i.test(new URL(video.url).pathname)))) {
      throw new Error('Unavailable video');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BROWSER_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error('Media too large');
      }
      chunks.push(new Uint8Array(value));
    }
    if (!bytes) throw new Error('Empty video');
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = video.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    note.textContent = '已发起下载，请查看浏览器的下载记录。';
  } catch {
    note.replaceChildren('暂时无法保存。你可以重新解析，或 ', externalLink(video.url, '打开源视频 ↗', 'text-link'));
  } finally {
    button.disabled = false;
  }
}

function sizeText(bytes?: number) {
  if (!bytes) return '';
  const [value, unit] = bytes >= 1048576 ? [bytes / 1048576, 'MB'] : [Math.max(1, bytes / 1024), 'KB'];
  return ' · ' + new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value) + ' ' + unit;
}

function videoRow(video: Video, index: number) {
  const row = document.createElement('li');
  const number = document.createElement('span');
  number.className = 'row-number';
  number.textContent = String(index + 1).padStart(2, '0');
  number.setAttribute('aria-hidden', 'true');

  const details = document.createElement('div');
  details.className = 'video-details';
  const title = document.createElement('strong');
  title.textContent = video.title;
  const meta = document.createElement('span');
  meta.className = 'video-meta';
  meta.textContent = 'MP4' + sizeText(video.size) + (video.delivery === 'open' ? ' · 仅可打开' : '');
  const note = document.createElement('span');
  note.className = 'video-note';
  note.setAttribute('aria-live', 'polite');
  details.append(title, meta, note);

  const actions = document.createElement('div');
  actions.className = 'video-actions';
  if (video.delivery === 'attachment') {
    const link = externalLink(video.url, '下载', 'download-action');
    if (new URL(video.url).origin === location.origin) link.download = video.filename;
    link.addEventListener('click', () => { note.textContent = '已发起下载，请查看浏览器的下载记录。'; });
    actions.append(link);
  } else if (video.delivery === 'browser') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'download-action';
    button.textContent = '下载';
    button.addEventListener('click', () => void saveVideo(video, button, note));
    actions.append(button);
  } else {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'text-link';
    copy.textContent = '复制链接';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(video.url);
        note.textContent = '已复制源视频链接。';
      } catch {
        note.textContent = '复制失败，请打开源视频后从地址栏复制。';
      }
    });
    actions.append(externalLink(video.url, '打开源视频 ↗', 'text-link'), copy);
  }
  row.append(number, details, actions);
  return row;
}

function render(data: InspectResult) {
  byId('result-title').textContent = '找到 ' + data.videos.length + ' 个视频';
  byId('result-host').textContent = data.hostname;
  list.replaceChildren(...data.videos.map(videoRow));
  results.hidden = false;
  if (data.limited) setStatus('页面较大或视频较多，结果可能不完整。', 'notice');
  else setStatus('找到 ' + data.videos.length + ' 个视频。', 'success');
}

function originalLink(text: string) {
  const candidate = text.match(/https?:\/\/[^\s<>"'，。；！？、（）【】]+/i)?.[0];
  if (!candidate) return;
  try {
    const url = new URL(candidate);
    if (!url.username && !url.password) {
      sourceLink.href = url.href;
      sourceLink.hidden = false;
    }
  } catch { /* no link for malformed input */ }
}

async function openStream(url: string) {
  playback.disabled = true;
  playback.hidden = true;
  installHelp.hidden = true;
  setStatus('正在打开流媒体下载面板…', 'loading');
  try {
    const result = await launchPlayback(url);
    if (result === 'opened') {
      setStatus('已打开下载面板。需要时先授权播放站点，视频载入后会自动识别。', 'notice');
    } else {
      setStatus(result === 'missing'
        ? '还没连接到 DownloadAny 扩展。安装或重新加载后，请刷新本页重试。'
        : '无法打开下载面板。请检查扩展是否已启用，刷新后重试。', 'error');
      installHelp.hidden = false;
      playback.hidden = false;
    }
  } finally {
    playback.disabled = false;
  }
}

async function submitInput() {
  if (busy) return;
  const value = input.value.trim();
  if (!value) {
    input.reportValidity();
    return;
  }
  busy = true;
  submit.disabled = true;
  for (const id of ['example-direct', 'example-page']) byId<HTMLButtonElement>(id).disabled = true;
  submit.setAttribute('aria-busy', 'true');
  setStatus('正在查找视频…', 'loading');
  results.hidden = true;
  list.replaceChildren();
  retry.hidden = true;
  playback.hidden = true;
  installHelp.hidden = true;
  sourceLink.hidden = true;
  sourceLink.removeAttribute('href');
  try {
    const url = extractPlaybackUrl(value);
    if (url && shouldRouteLocally(url)) {
      await openStream(url);
      return;
    }
    const response = await fetch('/api/v1/inspect', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: value }), signal: AbortSignal.timeout(11000),
    });
    if (!response.ok) {
      const failure = await response.json() as InspectFailure;
      setStatus(failure.source && failure.error === 'platform_disabled'
        ? PLATFORM_NAMES[failure.source] + ' 暂未开放。'
        : (messages[failure.error] ?? messages.upstream_error), 'error');
      retry.hidden = !failure.retryable;
      if (failure.source || failure.error === 'upstream_restricted') originalLink(value);
      if (url && playbackTarget(url) && (failure.error === 'source_not_allowed' || failure.error === 'no_video')) {
        playback.hidden = false;
      }
      return;
    }
    render(await response.json() as InspectResult);
  } catch {
    setStatus('暂时无法完成解析，请稍后再试。', 'error');
    retry.hidden = false;
  } finally {
    busy = false;
    submit.disabled = false;
    for (const id of ['example-direct', 'example-page']) byId<HTMLButtonElement>(id).disabled = false;
    submit.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); void submitInput(); });
retry.addEventListener('click', () => void submitInput());
playback.addEventListener('click', () => {
  const url = extractPlaybackUrl(input.value);
  if (url && playbackTarget(url)) void openStream(url);
  else setStatus('请输入可打开的播放页网址。', 'error');
});
for (const [id, path] of [['example-direct', DEMO_DIRECT], ['example-page', DEMO_PAGE]]) {
  byId(id).addEventListener('click', () => {
    input.value = new URL(path, location.origin).href;
    void submitInput();
  });
}

void fetch('/api/v1/sources').then(async (response) => {
  if (!response.ok) return;
  const { hosts } = await response.json() as { hosts: string[] };
  if (hosts.length) byId('allowed').textContent = '当前支持内置示例和以下来源：' + hosts.join('、') + '。';
}).catch(() => {});
