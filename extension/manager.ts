import './style.css';
import type { Candidate } from './detect.ts';
import type { PlaybackJob, Scan } from './background.ts';
import { readCandidates } from './observe.ts';
import { HlsError, prepareHls, type HlsCode } from './hls.ts';
import { writeHlsMp4 } from './remux.ts';
import { expireTemporaryFiles, LINK_TTL_MS, openTempDirectory } from './temp.ts';
import { playbackTarget } from '../src/stream-flow.ts';

const status = document.querySelector<HTMLElement>('#status')!;
const list = document.querySelector<HTMLElement>('#sources')!;
const scanAge = 5 * 60 * 1000;

const messages: Record<HlsCode, string> = {
  access: '源站拒绝直接读取，当前无法生成文件。请使用原站提供的下载方式。',
  network: '读取失败。来源可能已失效、发生跳转或不允许读取；回到原标签页重新播放后再试。',
  manifest: '未收到有效的 HLS 播放清单。',
  encrypted: '此视频使用加密，扩展无法生成文件。请使用原站提供的下载方式。',
  live: '这是未结束的直播或未封闭的回放，暂不支持保存。',
  unsupported: '这条 HLS 使用分离音轨、范围分片或其他暂不支持的格式。',
  cross_origin: '清单引用了其他域名的资源，当前版本暂不支持这种结构。',
  size: '超过本地处理上限，未生成文件。',
  media: '分片或音轨格式无法合并成带声音的 MP4。',
};

function permissionFor(url: URL) {
  return url.protocol + '//' + url.hostname + '/*';
}

function createButton(text: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  return button;
}

function renderSource(candidate: Candidate, index: number, auto = false) {
  const item = document.createElement('li');
  const url = new URL(candidate.url);
  const heading = document.createElement('strong');
  heading.textContent = (candidate.kind === 'hls' ? 'HLS' : 'DASH') + ' · ' + url.host;
  const note = document.createElement('p');
  note.setAttribute('aria-live', 'polite');
  item.append(heading, note);

  if (candidate.kind === 'dash') {
    note.textContent = '检测到 DASH 分片。这个版本可以识别，暂时不能导出。';
    return item;
  }

  const prepare = createButton('生成 MP4');
  const cancel = createButton('取消');
  const grant = createButton('允许读取此来源');
  cancel.hidden = true;
  grant.hidden = true;
  item.append(prepare, grant, cancel);
  let running: AbortController | undefined;

  async function run(showGrant: boolean) {
    if (running) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(50 * 60 * 1000)]);
    running = controller;
    prepare.disabled = true;
    grant.hidden = true;
    cancel.hidden = false;
    note.textContent = '正在读取 HLS 播放清单…';
    let dir: FileSystemDirectoryHandle | undefined;
    let temp: string | undefined;
    let writer: FileSystemWritableFileStream | undefined;
    try {
      const media = await prepareHls(candidate.url, { signal });
      await expireTemporaryFiles();
      dir = await openTempDirectory(true);
      temp = Date.now() + '-' + crypto.randomUUID() + '.mp4';
      const file = await dir.getFileHandle(temp, { create: true });
      writer = await file.createWritable();
      const output = writer;
      await writeHlsMp4(media, async (bytes) => output.write(new Uint8Array(bytes)), {
        signal,
        progress: (done, total) => { note.textContent = '正在生成 MP4：' + done + ' / ' + total + ' 段'; },
      });
      signal.throwIfAborted();
      await writer.close();
      writer = undefined;
      const objectUrl = URL.createObjectURL(await file.getFile());
      const save = document.createElement('a');
      save.className = 'save';
      save.href = objectUrl;
      save.download = 'DownloadAny-' + (index + 1) + '.mp4';
      save.textContent = '保存 MP4';
      item.append(save);
      const cleanup = () => {
        URL.revokeObjectURL(objectUrl);
        save.remove();
        prepare.hidden = false;
        note.textContent = '保存链接已过期，需要时可以重新生成。';
      };
      window.setTimeout(cleanup, LINK_TTL_MS);
      save.addEventListener('click', () => {
        note.textContent = '已发起保存，请查看浏览器下载记录。';
      });
      temp = undefined;
      prepare.hidden = true;
      note.textContent = 'MP4 已生成，点击保存。';
      if (auto) {
        save.click();
        note.textContent = 'MP4 已生成并尝试下载。如下载记录中没有文件，请点击「保存 MP4」。';
      }
      save.focus();
    } catch (error) {
      if (writer) await writer.abort().catch(() => {});
      if (dir && temp) await dir.removeEntry(temp).catch(() => {});
      note.textContent = controller.signal.aborted ? '已取消，未生成文件。'
        : signal.aborted ? '本地处理超时，未生成文件。'
        : error instanceof HlsError ? messages[error.code] : '无法写入本地文件，请检查浏览器可用空间后重试。';
      if (!controller.signal.aborted && showGrant && error instanceof HlsError && error.code === 'network') {
        try {
          grant.hidden = await chrome.permissions.contains({ origins: [permissionFor(url)] });
        } catch { /* host permissions are unavailable in this browser */ }
        if (!grant.hidden) note.textContent += ' 可仅授权这个媒体域名后重试。';
      }
    } finally {
      cancel.hidden = true;
      prepare.disabled = false;
      running = undefined;
    }
  }

  prepare.addEventListener('click', () => { void run(true); });
  cancel.addEventListener('click', () => running?.abort());
  grant.addEventListener('click', async () => {
    grant.disabled = true;
    try {
      if (await chrome.permissions.request({ origins: [permissionFor(url)] })) await run(false);
      else note.textContent = '未授予来源读取权限，未下载。';
    } catch {
      note.textContent = '无法为这个媒体来源授权。';
    } finally {
      grant.disabled = false;
    }
  });
  if (auto) queueMicrotask(() => { void run(true); });
  return item;
}

function showSources(candidates: Candidate[], auto: boolean) {
  status.textContent = '找到 ' + candidates.length + ' 个分片来源。';
  const singleHls = candidates.length === 1 && candidates[0].kind === 'hls';
  list.replaceChildren(...candidates.map((candidate, index) =>
    renderSource(candidate, index, auto && singleHls && candidate.kind === 'hls')));
}

async function openPlayback({ target }: PlaybackJob) {
  if (target.direct) {
    showSources([{ url: target.url, kind: target.direct }], true);
    return;
  }
  const origin = new URL(target.origin);
  const permission = { origins: [permissionFor(origin)] };
  const manager = await chrome.tabs.getCurrent();
  const controls = document.createElement('div');
  controls.className = 'playback-controls';
  const start = createButton('允许并打开播放页');
  const stop = createButton('停止识别');
  stop.hidden = true;
  controls.append(start, stop);
  status.after(controls);
  let active = false;
  let stopped = false;
  stop.addEventListener('click', () => { stopped = true; });

  async function watch() {
    if (active) return;
    active = true;
    stopped = false;
    start.hidden = true;
    stop.hidden = false;
    try {
      const playback = await chrome.tabs.create({ url: target.url });
      if (playback.id === undefined) throw new Error('missing tab');
      const tabId = playback.id;
      const deadline = Date.now() + 120000;
      const found = new Map<string, Candidate>();
      let changedAt = 0;
      status.textContent = '已打开播放页，正在识别视频。若页面没有自动播放，请在新标签页点播放。';
      while (!stopped && Date.now() < deadline) {
        const tab = await chrome.tabs.get(tabId).catch(() => undefined);
        if (!tab) {
          status.textContent = '播放页已关闭，识别已停止。';
          return;
        }
        const candidates = await readCandidates(tabId, target.origin).catch(() => []);
        if (stopped) break;
        for (const candidate of candidates) {
          if (found.size < 12 && !found.has(candidate.url) && playbackTarget(candidate.url)) {
            found.set(candidate.url, candidate);
            changedAt = Date.now();
          }
        }
        const hasHls = [...found.values()].some((candidate) => candidate.kind === 'hls');
        if (hasHls && Date.now() - changedAt >= 2500) {
          controls.remove();
          showSources([...found.values()], true);
          if (manager?.id !== undefined && tab.active) {
            await chrome.tabs.update(manager.id, { active: true }).catch(() => {});
          }
          return;
        }
        if (found.size && !hasHls) status.textContent = '已发现 DASH，正在继续检查是否还有 HLS 来源。';
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (found.size) {
        controls.remove();
        showSources([...found.values()], false);
        return;
      }
      status.textContent = stopped ? '已停止识别，播放页仍然打开。'
        : '未识别到分片。请确认视频已播放；如果页面跳转到其他域名，可以在实际播放页点击扩展图标。';
    } catch {
      status.textContent = '无法打开播放页，请回到 DownloadAny 网页重试。';
    } finally {
      active = false;
      stop.hidden = true;
      start.hidden = false;
      start.textContent = '重新打开播放页';
    }
  }

  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      if (await chrome.permissions.request(permission)) await watch();
      else status.textContent = '没有获得读取权限，未打开播放页。';
    } catch {
      status.textContent = '浏览器未允许读取这个播放站点。';
    } finally {
      start.disabled = false;
    }
  });
  if (await chrome.permissions.contains(permission)) {
    status.textContent = '正在打开播放页…';
    void watch();
  } else {
    status.textContent = '浏览器需要先允许读取 ' + origin.hostname + '，才能在播放时识别分片。';
  }
}

async function init() {
  const key = location.hash.slice(1);
  if (!/^(?:scan|play):[\da-f-]{36}$/i.test(key)) {
    status.textContent = '请在播放页点击 DownloadAny 扩展图标。';
    return;
  }
  const { [key]: session } = await chrome.storage.session.get(key) as Record<string, Scan | PlaybackJob | undefined>;
  await chrome.storage.session.remove(key);
  history.replaceState(null, '', location.pathname);
  if (!session || Date.now() - session.at > scanAge) {
    status.textContent = '识别结果已失效，请回到播放页重新点击扩展图标。';
  } else if ('target' in session) {
    await openPlayback(session);
  } else if (session.inaccessible) {
    status.textContent = '无法读取这个标签页。请在正常的网页播放页点击扩展图标。';
  } else if (!session.candidates.length) {
    status.textContent = '没有找到 HLS 或 DASH。请回到原标签页开始播放，等视频载入后再点击扩展图标。';
  } else {
    showSources(session.candidates, false);
  }
}
void init().catch(() => { status.textContent = '无法读取识别结果，请回到播放页重试。'; });
